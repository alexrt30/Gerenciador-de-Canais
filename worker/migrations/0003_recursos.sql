-- Biblioteca: prompts, links de skills, referências e outros recursos.
CREATE TABLE IF NOT EXISTS recursos (
  id          TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL DEFAULT 'prompt',   -- prompt | skill | link | referencia | outro
  titulo      TEXT NOT NULL,
  conteudo    TEXT NOT NULL DEFAULT '',         -- texto do prompt / descrição
  url         TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',         -- separadas por vírgula
  canal_id    TEXT REFERENCES canais(id) ON DELETE SET NULL, -- NULL = geral
  favorito    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_recursos_canal ON recursos(canal_id);
