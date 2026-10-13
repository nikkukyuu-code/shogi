-- Installed on shogi-ranking (prod) and shogi-ranking-test. Additive only.
CREATE TRIGGER IF NOT EXISTS protect_players_delete BEFORE DELETE ON players BEGIN SELECT RAISE(ABORT, 'players are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_players_update BEFORE UPDATE ON players WHEN NEW.id IS NOT OLD.id OR NEW.secret_hash IS NOT OLD.secret_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT, 'players: only nickname may change'); END;
CREATE TRIGGER IF NOT EXISTS protect_bests_delete BEFORE DELETE ON bests BEGIN SELECT RAISE(ABORT, 'bests are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_bests_update BEFORE UPDATE ON bests WHEN NEW.player_id IS NOT OLD.player_id OR NEW.difficulty IS NOT OLD.difficulty OR NEW.ms > OLD.ms BEGIN SELECT RAISE(ABORT, 'bests may only improve (lower ms)'); END;
