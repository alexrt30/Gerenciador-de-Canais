-- Cadastro aberto: cada pessoa tem o próprio espaço.
-- dono_email = '' -> espaço dos administradores (tudo o que já existia).
-- dono_email = e-mail -> canal/item criado por essa pessoa (só ela e quem tiver o canal liberado veem).
ALTER TABLE canais ADD COLUMN dono_email TEXT NOT NULL DEFAULT '';
ALTER TABLE recursos ADD COLUMN dono_email TEXT NOT NULL DEFAULT '';
-- Como a pessoa chegou: 'convite' (cadastrada por um admin) ou 'cadastro' (entrou sozinha).
ALTER TABLE usuarios ADD COLUMN origem TEXT NOT NULL DEFAULT 'convite';

CREATE INDEX IF NOT EXISTS idx_canais_dono ON canais(dono_email);
CREATE INDEX IF NOT EXISTS idx_recursos_dono ON recursos(dono_email);
