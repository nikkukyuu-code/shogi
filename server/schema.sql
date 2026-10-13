CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, nickname TEXT NOT NULL, ip TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS players_nick ON players(nickname);
CREATE INDEX IF NOT EXISTS players_ip ON players(ip, created_at);
CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, ip TEXT, difficulty TEXT NOT NULL, issued_at INTEGER NOT NULL, used_at INTEGER);
CREATE INDEX IF NOT EXISTS tokens_player ON tokens(player_id, issued_at);
CREATE INDEX IF NOT EXISTS tokens_ip ON tokens(ip, issued_at);
CREATE TABLE IF NOT EXISTS bests (player_id TEXT NOT NULL, difficulty TEXT NOT NULL, ms INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (player_id, difficulty));
CREATE INDEX IF NOT EXISTS bests_board ON bests(difficulty, ms, at);
