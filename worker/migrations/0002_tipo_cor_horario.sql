-- Tipo de conteúdo e horário de postagem nos vídeos; cor de identificação nos canais.
ALTER TABLE videos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'longo';   -- short | longo | live | post
ALTER TABLE videos ADD COLUMN horario TEXT NOT NULL DEFAULT '';     -- HH:MM
ALTER TABLE canais ADD COLUMN cor TEXT NOT NULL DEFAULT '';         -- #rrggbb

-- Status e checklist "publicado" passam a andar juntos.
UPDATE videos SET publicado = 1 WHERE status = 'publicado';
UPDATE videos SET status = 'publicado' WHERE publicado = 1;
