-- Esquema inicial do Gerenciador de Canais (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS canais (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  nicho       TEXT NOT NULL DEFAULT '',
  descricao   TEXT NOT NULL DEFAULT '',
  anotacoes   TEXT NOT NULL DEFAULT '[]', -- JSON: [{ id, text, createdAt }]
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS videos (
  id               TEXT PRIMARY KEY,
  titulo           TEXT NOT NULL,
  canal_id         TEXT NOT NULL REFERENCES canais(id) ON DELETE CASCADE,
  data_publicacao  TEXT NOT NULL DEFAULT '', -- YYYY-MM-DD
  status           TEXT NOT NULL DEFAULT 'planejado'
                   CHECK (status IN ('planejado', 'em_producao', 'pronto', 'publicado')),
  roteiro          INTEGER NOT NULL DEFAULT 0,
  gravacao         INTEGER NOT NULL DEFAULT 0,
  edicao           INTEGER NOT NULL DEFAULT 0,
  thumbnail        INTEGER NOT NULL DEFAULT 0,
  publicado        INTEGER NOT NULL DEFAULT 0,
  url              TEXT NOT NULL DEFAULT '',
  notas            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_canal ON videos(canal_id);
CREATE INDEX IF NOT EXISTS idx_videos_data ON videos(data_publicacao);
