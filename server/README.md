# shogi-ranking (Cloudflare Worker + D1)
- Worker: https://shogi-ranking.nikkukyuu.workers.dev (D1 `shogi-ranking`, binding `DB`)
- Same rules as the local ranking: per difficulty, best (shortest) own-turn time to win vs COM, top 100. Medals = current 1〜3位 per difficulty.
- Anti-cheat: single-use token per COM game, score encrypted (AES-GCM) + HMAC-signed with token-derived key, ≥10 s wall clock, ms ≤ wall clock, ms ≥ 2 s and ≥150 ms/move, ≥3 moves, 40 tokens/h/player, 80/h/IP, 10 registrations/h/IP.

## ⚠️ PRODUCTION DATA SAFETY (read before touching anything)
**Never DELETE / DROP / TRUNCATE / bulk-UPDATE in a production ranking DB. Never write test rows to production.**
Ranking data loss is fatal (a real player's data was once wiped by a "cleanup" — never again).

| | Production (real players) | Test (use for ALL testing) |
|---|---|---|
| shooting | Worker `stb-ranking` / D1 `stb-ranking` (ecdbefd9-bbdf-422b-be2a-285825c8db1a) | Worker https://stb-ranking-test.nikkukyuu.workers.dev / D1 `stb-ranking-test` (0a92e300-0fa7-4227-9612-eda0101e9b94) |
| shogi | Worker `shogi-ranking` / D1 `shogi-ranking` (2ba6b0b1-ee4d-4eee-a07e-fe46151f2352) | Worker https://shogi-ranking-test.nikkukyuu.workers.dev / D1 `shogi-ranking-test` (772524f6-a8d3-4440-9b2d-10f6e8fb5eb2) |

Rules:
1. curl / Playwright / seeding → test Worker URLs only (for client tests, point `RANK_API` / `ONLINE_API` at the test Worker locally; never commit that change). Test DBs have the same triggers, so test rows simply stay there; that's fine.
2. Production may only be **read** (SELECT COUNT etc.) by agents. Code changes are deployed by uploading the Worker; schema changes only as additive `CREATE ... IF NOT EXISTS` migrations after checking row counts before/after.
3. Workers have no delete/reset endpoints. Only `tokens` (throwaway match tokens) may be deleted.
4. DB triggers (`server/protect_triggers.sql`, installed on prod + test) RAISE(ABORT) on:
   - DELETE on players / scores / medals / closed (shooting), players / bests (shogi)
   - UPDATE of players except nickname; any UPDATE of scores / medals; bests UPDATE unless the time improves (lower ms).
   Triggers do not stop `DROP TABLE` or deleting the whole database → never run those; backups below cover it.
5. Backups: Worker `ranking-backup` (https://ranking-backup.nikkukyuu.workers.dev, GET = run history/counts only) copies every row of both prod DBs daily at 00:40 JST (cron `40 15 * * *`) into D1 `ranking-backup` (af699ba6-5e91-4c04-b8b5-69d1a2f1a3d5), tables `snapshots` (JSON per table, chunks of 500 rows) and `runs`; append-only (DELETE/UPDATE blocked by triggers), kept forever (≥30 days). Manual run: `POST /run` with header `X-Backup-Key` (Worker secret `BACKUP_KEY`; copy kept in the bot store `secrets/ranking-backup-key.txt`). R2 is not used (needs enabling in the dashboard with billing).
6. D1 Time Travel (point-in-time restore to any minute): 7 days on Workers Free, 30 days on Paid. Restore = `wrangler d1 time-travel restore <db> --timestamp=...` (or the REST API). Restoring rolls the whole DB back, so first export/back up the current state.
