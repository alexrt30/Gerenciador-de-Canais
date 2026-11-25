-- Usuários do Gerenciador e quais canais (projetos) cada um pode ver/editar.
-- Admin vê tudo; membro só os canais ligados a ele em usuario_canais.
-- Os e-mails do secret ALLOWED_EMAILS continuam sendo admins fixos (donos).

CREATE TABLE IF NOT EXISTS usuarios (
  email          TEXT PRIMARY KEY,               -- sempre minúsculo
  nome           TEXT NOT NULL DEFAULT '',
  foto           TEXT NOT NULL DEFAULT '',
  papel          TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
  ativo          INTEGER NOT NULL DEFAULT 1,
  ultimo_acesso  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS usuario_canais (
  email     TEXT NOT NULL REFERENCES usuarios(email) ON DELETE CASCADE,
  canal_id  TEXT NOT NULL REFERENCES canais(id) ON DELETE CASCADE,
  PRIMARY KEY (email, canal_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_canais_canal ON usuario_canais(canal_id);
