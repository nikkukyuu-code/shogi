# shogi-ranking (Cloudflare Worker + D1)
- Worker: https://shogi-ranking.nikkukyuu.workers.dev (D1 `shogi-ranking`, binding `DB`)
- Same rules as the local ranking: per difficulty, best (shortest) own-turn time to win vs COM, top 100. Medals = current 1〜3位 per difficulty.
- Anti-cheat: single-use token per COM game, score encrypted (AES-GCM) + HMAC-signed with token-derived key, ≥10 s wall clock, ms ≤ wall clock, ms ≥ 2 s and ≥150 ms/move, ≥3 moves, 40 tokens/h/player, 80/h/IP, 10 registrations/h/IP.
