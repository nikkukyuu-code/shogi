// 7GET将棋 online ranking — same rules as the local ranking: per difficulty, a player's best (shortest)
// own-turn time to WIN vs COM, ascending, top 100. Medals = current 1〜3位 per difficulty.
const ORIGINS = ['https://nikkukyuu-code.github.io'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DIFFS = ['beginner', 'intermediate', 'advanced', 'serious'];
const MIN_WALL_SEC = 10, MAX_AGE_SEC = 6 * 3600, MIN_MS = 2000, MS_PER_MOVE = 150, MIN_MOVES = 3;
const SEAL_SECRET = 'SET_AT_DEPLOY'; // real value only in the deployed Worker (also embedded obfuscated in the client)
const TOK_PLAYER_H = 40, TOK_IP_H = 80, REG_IP_H = 10, TOP = 100;
const cors = (q) => { const o = q.headers.get('Origin') || ''; return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) || LOCAL.test(o) ? o : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }; };
const J = (q, d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(q) } });
const E = (q, c, m, s = 400) => J(q, { ok: false, error: c, message: m }, s);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const nick = (s) => { let n = String(s == null ? '' : s).normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim(); n = [...n].slice(0, 12).join(''); return n || '名無し'; };
async function auth(env, id, secret) {
  if (typeof id !== 'string' || typeof secret !== 'string' || id.length > 64 || secret.length > 128) return null;
  const r = await env.DB.prepare('SELECT id, nickname, secret_hash FROM players WHERE id = ?').bind(id).first();
  return r && r.secret_hash === await sha(secret) ? r : null;
}
async function claim(base, write) {
  for (let i = 1; i <= 500; i++) {
    let n = base; if (i > 1) { const s = String(i); n = [...base].slice(0, 12 - s.length).join('') + s; }
    try { await write(n); return { nickname: n, adjusted: i > 1 }; } catch (e) { if (!/UNIQUE/i.test(String(e && e.message))) throw e; }
  }
  throw new Error('nickname exhausted');
}

// Score sealing: AES-GCM + HMAC-SHA256, keys derived from SEAL_SECRET and the single-use match token.
const b64d = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
async function sealKeys(token) {
  const enc = new TextEncoder();
  const a = await crypto.subtle.digest('SHA-256', enc.encode('enc|' + SEAL_SECRET + '|' + token));
  const m = await crypto.subtle.digest('SHA-256', enc.encode('mac|' + SEAL_SECRET + '|' + token));
  return {
    aes: await crypto.subtle.importKey('raw', a, 'AES-GCM', false, ['decrypt']),
    mac: await crypto.subtle.importKey('raw', m, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
  };
}
async function openSeal(token, b) {
  if (typeof b.iv !== 'string' || typeof b.ct !== 'string' || typeof b.mac !== 'string' || b.ct.length > 4000) return null;
  try {
    const k = await sealKeys(token);
    const ok = await crypto.subtle.verify('HMAC', k.mac, b64d(b.mac), new TextEncoder().encode(b.iv + '.' + b.ct));
    if (!ok) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(b.iv) }, k.aes, b64d(b.ct));
    const o = JSON.parse(new TextDecoder().decode(pt));
    return o && o.t === token && typeof o.n === 'string' && o.n.length >= 8 ? o : null;
  } catch (_) { return null; }
}

const body = async (q) => { try { return await q.json(); } catch (_) { return {}; } };
const BOARD = 'SELECT b.player_id, b.ms, b.at, p.nickname FROM bests b JOIN players p ON p.id = b.player_id WHERE b.difficulty = ? ORDER BY b.ms ASC, b.at ASC, b.player_id ASC';
export default {
  async fetch(q, env) {
    if (q.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(q) });
    const url = new URL(q.url), path = url.pathname.replace(/\/+$/, '') || '/', ip = q.headers.get('CF-Connecting-IP') || '0', now = Date.now();
    try {
      if (path === '/' || path === '/health') return J(q, { ok: true, service: 'shogi-ranking', now });
      if (path === '/register' && q.method === 'POST') {
        const b = await body(q);
        const c = await env.DB.prepare('SELECT COUNT(*) c FROM players WHERE ip = ? AND created_at > ?').bind(ip, now - 3600e3).first();
        if (c.c >= REG_IP_H) return E(q, 'rate', '登録が多すぎます。しばらく待ってください', 429);
        const id = 'g' + rnd(12), secret = rnd(24), h = await sha(secret);
        const r = await claim(nick(b.nickname), (n) => env.DB.prepare('INSERT INTO players (id, secret_hash, nickname, ip, created_at) VALUES (?,?,?,?,?)').bind(id, h, n, ip, now).run());
        return J(q, { ok: true, id, secret, ...r });
      }
      if (path === '/nickname' && q.method === 'POST') {
        const b = await body(q), p = await auth(env, b.id, b.secret);
        if (!p) return E(q, 'auth', '認証に失敗しました', 401);
        const want = nick(b.nickname);
        if (want === p.nickname) return J(q, { ok: true, nickname: want, adjusted: false });
        return J(q, { ok: true, ...await claim(want, (n) => env.DB.prepare('UPDATE players SET nickname = ? WHERE id = ?').bind(n, p.id).run()) });
      }
      if (path === '/match/start' && q.method === 'POST') {
        const b = await body(q), p = await auth(env, b.id, b.secret);
        if (!p) return E(q, 'auth', '認証に失敗しました', 401);
        if (!DIFFS.includes(b.difficulty)) return E(q, 'diff', '難易度が不正です');
        const h = now - 3600e3;
        const [x, y] = await env.DB.batch([
          env.DB.prepare('SELECT COUNT(*) c FROM tokens WHERE player_id = ? AND issued_at > ?').bind(p.id, h),
          env.DB.prepare('SELECT COUNT(*) c FROM tokens WHERE ip = ? AND issued_at > ?').bind(ip, h)]);
        if (x.results[0].c >= TOK_PLAYER_H || y.results[0].c >= TOK_IP_H) return E(q, 'rate', '対局回数が多すぎます（1時間あたりの上限）', 429);
        const token = rnd(16);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO tokens (token, player_id, ip, difficulty, issued_at) VALUES (?,?,?,?,?)').bind(token, p.id, ip, b.difficulty, now),
          env.DB.prepare('DELETE FROM tokens WHERE issued_at < ?').bind(now - 2 * 86400e3)]);
        return J(q, { ok: true, token });
      }
      if (path === '/match/submit' && q.method === 'POST') {
        const b = await body(q), p = await auth(env, b.id, b.secret);
        if (!p) return E(q, 'auth', '認証に失敗しました', 401);
        if (typeof b.token !== 'string' || b.token.length > 64) return E(q, 'token', 'トークンがありません');
        const o = await openSeal(b.token, b);
        if (!o) return E(q, 'seal', '記録の署名が不正です（改ざん）', 422);
        const ms = Number(o.s), moves = Number(o.m);
        if (!Number.isSafeInteger(ms) || !Number.isSafeInteger(moves) || ms < 0 || moves < 0) return E(q, 'value', '記録が不正です');
        const t = await env.DB.prepare('UPDATE tokens SET used_at = ?1 WHERE token = ?2 AND player_id = ?3 AND used_at IS NULL RETURNING issued_at, difficulty').bind(now, b.token, p.id).first();
        if (!t) return E(q, 'token', 'トークンが無効か使用済みです', 409);
        const wall = now - t.issued_at;
        if (wall < MIN_WALL_SEC * 1000) return E(q, 'fast', '対局時間が短すぎます', 422);
        if (wall > MAX_AGE_SEC * 1000) return E(q, 'expired', 'トークンの期限切れです', 422);
        if (moves < MIN_MOVES) return E(q, 'moves', '手数が少なすぎます', 422);
        if (ms < MIN_MS || ms < moves * MS_PER_MOVE) return E(q, 'cap', '記録が速すぎます', 422);
        if (ms > wall + 2000) return E(q, 'time', '対局時間と記録が一致しません', 422);
        const d = t.difficulty;
        const prev = await env.DB.prepare('SELECT ms FROM bests WHERE player_id = ? AND difficulty = ?').bind(p.id, d).first();
        const updated = !prev || ms < prev.ms;
        if (updated) await env.DB.prepare('INSERT INTO bests (player_id, difficulty, ms, at) VALUES (?,?,?,?) ON CONFLICT(player_id, difficulty) DO UPDATE SET ms = excluded.ms, at = excluded.at').bind(p.id, d, ms, now).run();
        const best = updated ? ms : prev.ms;
        const r = await env.DB.prepare('SELECT COUNT(*) c FROM bests WHERE difficulty = ? AND (ms < ? OR (ms = ? AND at < (SELECT at FROM bests WHERE player_id = ? AND difficulty = ?)))').bind(d, best, best, p.id, d).first();
        return J(q, { ok: true, difficulty: d, updated, ms, best, rank: r.c + 1 });
      }
      if (path === '/ranking' && q.method === 'GET') {
        const d = DIFFS.includes(url.searchParams.get('difficulty')) ? url.searchParams.get('difficulty') : 'serious';
        const me = url.searchParams.get('id') || '';
        const { results } = await env.DB.prepare(BOARD + ' LIMIT 5000').bind(d).all();
        const top = results.slice(0, TOP).map((r, i) => ({ rank: i + 1, id: r.player_id, nickname: r.nickname, ms: r.ms, at: r.at }));
        let mine = null;
        if (me) { const i = results.findIndex((r) => r.player_id === me); if (i >= 0) mine = { rank: i + 1, ms: results[i].ms, at: results[i].at }; }
        return J(q, { ok: true, difficulty: d, total: results.length, top, me: mine });
      }
      if (path === '/medals' && q.method === 'GET') {
        const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => /^g[0-9a-f]{24}$/.test(s)).slice(0, 4);
        const out = {}; for (const id of ids) out[id] = { medals: [] };
        if (ids.length) {
          const ph = ids.map(() => '?').join(',');
          const { results } = await env.DB.prepare(`WITH r AS (SELECT player_id, difficulty, ms, ROW_NUMBER() OVER (PARTITION BY difficulty ORDER BY ms ASC, at ASC, player_id ASC) rn FROM bests) SELECT * FROM r WHERE rn <= 3 AND player_id IN (${ph})`).bind(...ids).all();
          for (const r of results) out[r.player_id].medals.push({ difficulty: r.difficulty, rank: r.rn, ms: r.ms });
          const n = await env.DB.prepare(`SELECT id, nickname FROM players WHERE id IN (${ph})`).bind(...ids).all();
          for (const r of n.results) out[r.id].nickname = r.nickname;
        }
        return J(q, { ok: true, medals: out });
      }
      return E(q, 'notfound', 'not found', 404);
    } catch (e) { return E(q, 'server', 'サーバーエラー: ' + String(e && e.message || e).slice(0, 120), 500); }
  },
};
