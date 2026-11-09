// API do Gerenciador de Canais: Cloudflare Worker + D1 (SQLite).
//
// Rotas (todas exigem `Authorization: Bearer <API_KEY>`):
//   GET    /api/data              -> { ok, data: { canais, videos } }
//   PUT    /api/canais/:id        -> cria/atualiza canal
//   DELETE /api/canais/:id        -> apaga canal (e os vídeos dele)
//   PUT    /api/videos/:id        -> cria/atualiza vídeo
//   DELETE /api/videos/:id        -> apaga vídeo
//   PUT    /api/recursos/:id      -> cria/atualiza item da biblioteca
//   DELETE /api/recursos/:id      -> apaga item da biblioteca
//   POST   /api/import            -> { canais, videos } em lote (migração)

const STATUS = ['planejado', 'em_producao', 'pronto', 'publicado'];
const CHECKS = ['roteiro', 'gravacao', 'edicao', 'thumbnail', 'publicado'];
const TIPOS = ['short', 'longo', 'live', 'post'];
const TIPOS_RECURSO = ['prompt', 'skill', 'link', 'referencia', 'outro'];
const MAX_TEXT = 20000;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (!env.API_KEY) {
        return json({ ok: false, error: 'API_KEY não configurada no servidor' }, 500, cors);
      }
      if (!(await isAuthorized(request, env.API_KEY))) {
        return json({ ok: false, error: 'Chave de acesso inválida' }, 401, cors);
      }

      const url = new URL(request.url);
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', ...]
      if (parts[0] !== 'api') return json({ ok: false, error: 'Rota não encontrada' }, 404, cors);

      const [, resource, rawId] = parts;
      const id = rawId ? decodeURIComponent(rawId) : '';

      if (resource === 'data' && request.method === 'GET') {
        return json({ ok: true, data: await exportAll(env.DB) }, 200, cors);
      }

      if (resource === 'import' && request.method === 'POST') {
        const body = await readJson(request);
        const result = await importAll(env.DB, body);
        return json({ ok: true, ...result }, 200, cors);
      }

      if (['canais', 'videos', 'recursos'].includes(resource) && id) {
        if (!isValidId(id)) return json({ ok: false, error: 'id inválido' }, 400, cors);

        if (request.method === 'PUT') {
          const body = await readJson(request);
          const upsert = { canais: upsertCanal, videos: upsertVideo, recursos: upsertRecurso }[resource];
          const saved = await upsert(env.DB, { ...body, id });
          return json({ ok: true, item: saved }, 200, cors);
        }

        if (request.method === 'DELETE') {
          if (resource === 'canais') {
            // Garante o efeito mesmo se foreign_keys estiver desligado.
            await env.DB.batch([
              env.DB.prepare('DELETE FROM videos WHERE canal_id = ?').bind(id),
              env.DB.prepare('UPDATE recursos SET canal_id = NULL WHERE canal_id = ?').bind(id),
              env.DB.prepare('DELETE FROM canais WHERE id = ?').bind(id)
            ]);
          } else {
            const table = resource === 'videos' ? 'videos' : 'recursos';
            await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
          }
          return json({ ok: true }, 200, cors);
        }
      }

      return json({ ok: false, error: 'Rota não encontrada' }, 404, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return json({ ok: false, error: err.message || 'Erro interno' }, status, cors);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- autenticação / CORS ----------

async function isAuthorized(request, apiKey) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  // Compara os hashes para não vazar informação pelo tempo de resposta.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(apiKey))
  ]);
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(a, b)
    : equalBytes(new Uint8Array(a), new Uint8Array(b));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(payload, status, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

// ---------- validação ----------

function isValidId(id) {
  return typeof id === 'string' && /^[\w.-]{1,64}$/.test(id);
}

function text(value, field, { required = false, max = MAX_TEXT } = {}) {
  const v = value == null ? '' : String(value).trim();
  if (required && !v) throw new HttpError(400, `Campo obrigatório: ${field}`);
  if (v.length > max) throw new HttpError(400, `Campo muito longo: ${field}`);
  return v;
}

function httpUrl(value, field) {
  const v = text(value, field, { max: 2000 });
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    /* cai no erro abaixo */
  }
  throw new HttpError(400, `URL inválida: ${field}`);
}

function dateOnly(value) {
  const v = text(value, 'dataPublicacao', { max: 40 });
  if (!v) return '';
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new HttpError(400, 'dataPublicacao deve ser YYYY-MM-DD');
  return m[1];
}

function notesJson(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = value.trim() ? JSON.parse(value) : [];
    } catch {
      list = [{ text: value }];
    }
  }
  if (!Array.isArray(list)) list = [];
  const clean = list
    .map((n) => ({
      id: String(n?.id || crypto.randomUUID()).slice(0, 64),
      text: String(n?.text || '').trim().slice(0, MAX_TEXT),
      createdAt: String(n?.createdAt || new Date().toISOString()).slice(0, 40)
    }))
    .filter((n) => n.text);
  return JSON.stringify(clean);
}

function bool(value) {
  if (typeof value === 'string') return ['true', '1', 'sim'].includes(value.trim().toLowerCase()) ? 1 : 0;
  return value ? 1 : 0;
}

function cleanCanal(input) {
  if (!isValidId(String(input?.id || ''))) throw new HttpError(400, 'id de canal inválido');
  return {
    id: String(input.id),
    nome: text(input.nome, 'nome', { required: true, max: 200 }),
    url: httpUrl(input.url, 'url'),
    nicho: text(input.nicho, 'nicho', { max: 200 }),
    descricao: text(input.descricao, 'descricao'),
    anotacoes: notesJson(input.anotacoes),
    cor: /^#[0-9a-fA-F]{6}$/.test(String(input.cor || '')) ? String(input.cor).toLowerCase() : ''
  };
}

function cleanVideo(input) {
  if (!isValidId(String(input?.id || ''))) throw new HttpError(400, 'id de vídeo inválido');
  const status = String(input.status || 'planejado');
  if (!STATUS.includes(status)) throw new HttpError(400, 'status inválido');
  const tipo = String(input.tipo || 'longo');
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'tipo inválido');
  const horario = String(input.horario || '').trim();
  if (horario && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) throw new HttpError(400, 'horario deve ser HH:MM');
  const video = {
    id: String(input.id),
    titulo: text(input.titulo, 'titulo', { required: true, max: 300 }),
    canalId: text(input.canalId, 'canalId', { required: true, max: 64 }),
    dataPublicacao: dateOnly(input.dataPublicacao),
    status,
    tipo,
    horario,
    url: httpUrl(input.url, 'url'),
    notas: text(input.notas, 'notas')
  };
  CHECKS.forEach((k) => {
    video[k] = bool(input[k]);
  });
  // Status "publicado" e checklist "publicado" andam juntos.
  if (video.status === 'publicado') video.publicado = 1;
  else if (video.publicado) video.status = 'publicado';
  return video;
}

function cleanRecurso(input) {
  if (!isValidId(String(input?.id || ''))) throw new HttpError(400, 'id de recurso inválido');
  const tipo = String(input.tipo || 'prompt');
  if (!TIPOS_RECURSO.includes(tipo)) throw new HttpError(400, 'tipo de recurso inválido');
  const canalId = text(input.canalId, 'canalId', { max: 64 });
  const tags = text(input.tags, 'tags', { max: 500 })
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join(', ');
  return {
    id: String(input.id),
    tipo,
    titulo: text(input.titulo, 'titulo', { required: true, max: 300 }),
    conteudo: text(input.conteudo, 'conteudo', { max: 100000 }),
    url: httpUrl(input.url, 'url'),
    tags,
    canalId: canalId || null,
    favorito: bool(input.favorito)
  };
}

// ---------- SQL ----------

const UPSERT_CANAL = `
  INSERT INTO canais (id, nome, url, nicho, descricao, anotacoes, cor)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT(id) DO UPDATE SET
    nome = excluded.nome, url = excluded.url, nicho = excluded.nicho,
    descricao = excluded.descricao, anotacoes = excluded.anotacoes, cor = excluded.cor,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

const UPSERT_VIDEO = `
  INSERT INTO videos (id, titulo, canal_id, data_publicacao, status,
                      roteiro, gravacao, edicao, thumbnail, publicado, url, notas, tipo, horario)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
  ON CONFLICT(id) DO UPDATE SET
    titulo = excluded.titulo, canal_id = excluded.canal_id,
    data_publicacao = excluded.data_publicacao, status = excluded.status,
    tipo = excluded.tipo, horario = excluded.horario,
    roteiro = excluded.roteiro, gravacao = excluded.gravacao, edicao = excluded.edicao,
    thumbnail = excluded.thumbnail, publicado = excluded.publicado,
    url = excluded.url, notas = excluded.notas,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

function canalStmt(db, c) {
  return db.prepare(UPSERT_CANAL).bind(c.id, c.nome, c.url, c.nicho, c.descricao, c.anotacoes, c.cor);
}

function videoStmt(db, v) {
  return db.prepare(UPSERT_VIDEO).bind(
    v.id, v.titulo, v.canalId, v.dataPublicacao, v.status,
    v.roteiro, v.gravacao, v.edicao, v.thumbnail, v.publicado, v.url, v.notas, v.tipo, v.horario
  );
}

async function upsertCanal(db, input) {
  const canal = cleanCanal(input);
  await canalStmt(db, canal).run();
  return canal;
}

async function upsertVideo(db, input) {
  const video = cleanVideo(input);
  const canal = await db.prepare('SELECT 1 FROM canais WHERE id = ?').bind(video.canalId).first();
  if (!canal) throw new HttpError(400, 'Canal do vídeo não existe');
  await videoStmt(db, video).run();
  return video;
}

const UPSERT_RECURSO = `
  INSERT INTO recursos (id, tipo, titulo, conteudo, url, tags, canal_id, favorito)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  ON CONFLICT(id) DO UPDATE SET
    tipo = excluded.tipo, titulo = excluded.titulo, conteudo = excluded.conteudo,
    url = excluded.url, tags = excluded.tags, canal_id = excluded.canal_id,
    favorito = excluded.favorito,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

async function upsertRecurso(db, input) {
  const r = cleanRecurso(input);
  if (r.canalId) {
    const canal = await db.prepare('SELECT 1 FROM canais WHERE id = ?').bind(r.canalId).first();
    if (!canal) throw new HttpError(400, 'Canal do recurso não existe');
  }
  await db.prepare(UPSERT_RECURSO)
    .bind(r.id, r.tipo, r.titulo, r.conteudo, r.url, r.tags, r.canalId, r.favorito)
    .run();
  return r;
}

async function importAll(db, body) {
  const canais = (Array.isArray(body?.canais) ? body.canais : []).map(cleanCanal);
  const ids = new Set(canais.map((c) => c.id));
  const existentes = await db.prepare('SELECT id FROM canais').all();
  existentes.results.forEach((r) => ids.add(r.id));

  const videos = [];
  const ignorados = [];
  (Array.isArray(body?.videos) ? body.videos : []).forEach((v) => {
    const clean = cleanVideo(v);
    if (ids.has(clean.canalId)) videos.push(clean);
    else ignorados.push(clean.id);
  });

  const stmts = [...canais.map((c) => canalStmt(db, c)), ...videos.map((v) => videoStmt(db, v))];
  if (stmts.length) await db.batch(stmts); // batch = transação única
  return { canais: canais.length, videos: videos.length, videosIgnorados: ignorados };
}

async function exportAll(db) {
  const [canais, videos, recursos] = await db.batch([
    db.prepare('SELECT * FROM canais ORDER BY nome COLLATE NOCASE'),
    db.prepare('SELECT * FROM videos ORDER BY data_publicacao, titulo COLLATE NOCASE'),
    db.prepare('SELECT * FROM recursos ORDER BY favorito DESC, updated_at DESC')
  ]);
  return {
    canais: canais.results.map((c) => ({
      id: c.id,
      nome: c.nome,
      url: c.url,
      nicho: c.nicho,
      descricao: c.descricao,
      anotacoes: c.anotacoes,
      cor: c.cor || '',
      updatedAt: c.updated_at
    })),
    videos: videos.results.map((v) => ({
      id: v.id,
      titulo: v.titulo,
      canalId: v.canal_id,
      dataPublicacao: v.data_publicacao,
      status: v.status,
      tipo: v.tipo || 'longo',
      horario: v.horario || '',
      roteiro: Boolean(v.roteiro),
      gravacao: Boolean(v.gravacao),
      edicao: Boolean(v.edicao),
      thumbnail: Boolean(v.thumbnail),
      publicado: Boolean(v.publicado),
      url: v.url,
      notas: v.notas,
      updatedAt: v.updated_at
    })),
    recursos: recursos.results.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      titulo: r.titulo,
      conteudo: r.conteudo,
      url: r.url,
      tags: r.tags,
      canalId: r.canal_id || '',
      favorito: Boolean(r.favorito),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  };
}
