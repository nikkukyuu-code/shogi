// ranking-backup: daily JSON snapshot of production ranking D1s (stb-ranking, shogi-ranking) into the
// append-only D1 "ranking-backup" (snapshots table; DELETE/UPDATE blocked by triggers). Read-only on production.
const SOURCES = {
  stb: { db: 'STB', tables: ['players', 'scores', 'medals', 'closed'] },
  shogi: { db: 'SHOGI', tables: ['players', 'bests'] },
};
const CHUNK = 500;
async function runBackup(env, reason) {
  const now = Date.now();
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  const summary = {};
  for (const [game, src] of Object.entries(SOURCES)) {
    const db = env[src.db];
    summary[game] = {};
    for (const tbl of src.tables) {
      const { results } = await db.prepare(`SELECT * FROM ${tbl}`).all();
      summary[game][tbl] = results.length;
      const parts = Math.max(1, Math.ceil(results.length / CHUNK));
      const stmts = [];
      for (let i = 0; i < parts; i++) {
        const rows = results.slice(i * CHUNK, (i + 1) * CHUNK);
        stmts.push(env.BK.prepare('INSERT INTO snapshots (taken_at, day, game, tbl, part, parts, row_count, rows_json, reason) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(now, day, game, tbl, i, parts, rows.length, JSON.stringify(rows), reason));
      }
      await env.BK.batch(stmts);
    }
  }
  await env.BK.prepare('INSERT INTO runs (taken_at, day, reason, summary_json) VALUES (?,?,?,?)').bind(now, day, reason, JSON.stringify(summary)).run();
  return { taken_at: now, day, summary };
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run' && req.method === 'POST') {
      if (!env.BACKUP_KEY || req.headers.get('X-Backup-Key') !== env.BACKUP_KEY) return json({ ok: false, error: 'auth' }, 401);
      return json({ ok: true, ...(await runBackup(env, 'manual')) });
    }
    // Public status: counts only (never row data).
    const { results } = await env.BK.prepare('SELECT taken_at, day, reason, summary_json FROM runs ORDER BY taken_at DESC LIMIT 10').all();
    return json({ ok: true, service: 'ranking-backup', runs: results.map((r) => ({ taken_at: r.taken_at, day: r.day, reason: r.reason, summary: JSON.parse(r.summary_json) })) });
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(runBackup(env, 'cron')); },
};
