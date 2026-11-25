// API do Gerenciador de Canais: Cloudflare Worker + D1 (SQLite).
//
// Acesso: `Authorization: Bearer <API_KEY>` (admin) ou `Bearer <ID token do Google>`.
// Quem entra com Google: e-mails do secret ALLOWED_EMAILS são admins fixos (donos).
// Com CADASTRO_ABERTO=1, qualquer conta Google entra e ganha o próprio espaço (membro);
// sem ele, só quem um admin cadastrou na tabela `usuarios`.
// Papéis: admin trabalha no espaço da equipe (canais sem dono) e gerencia usuários;
// membro vê os canais que criou (dono_email) e os que um admin liberou (usuario_canais).
//
// Rotas:
//   GET    /api/data              -> { ok, data: { canais, videos, recursos }, me }
//   GET    /api/me                -> { ok, me }
//   PUT    /api/canais/:id        -> cria (admin) / atualiza canal
//   DELETE /api/canais/:id        -> apaga canal e os vídeos dele (admin)
//   PUT    /api/videos/:id        -> cria/atualiza vídeo
//   DELETE /api/videos/:id        -> apaga vídeo
//   PUT    /api/recursos/:id      -> cria/atualiza item da biblioteca
//   DELETE /api/recursos/:id      -> apaga item da biblioteca
//   POST   /api/import            -> { canais, videos } em lote (admin)
//   GET    /api/usuarios          -> lista de usuários e seus canais (admin)
//   PUT    /api/usuarios/:email   -> { nome, papel, ativo, canais: [ids] } (admin)
//   DELETE /api/usuarios/:email   -> remove o acesso (admin)

const STATUS = ['planejado', 'em_producao', 'pronto', 'publicado'];
const CHECKS = ['roteiro', 'gravacao', 'edicao', 'thumbnail', 'publicado'];
const TIPOS = ['short', 'longo', 'live', 'post'];
const TIPOS_RECURSO = ['prompt', 'skill', 'link', 'referencia', 'outro'];
const PAPEIS = ['admin', 'membro'];
const MAX_TEXT = 20000;
const MAX_CANAIS_PROPRIOS = 30;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (!env.API_KEY && !env.GOOGLE_CLIENT_ID) {
        return json({ ok: false, error: 'Nenhum método de acesso configurado no servidor' }, 500, cors);
      }
      const auth = await authorize(request, env);
      if (!auth.ok) {
        return json({ ok: false, error: auth.error }, 401, cors);
      }
      const me = auth.user;

      const url = new URL(request.url);
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', ...]
      if (parts[0] !== 'api') return json({ ok: false, error: 'Rota não encontrada' }, 404, cors);

      const [, resource, rawId] = parts;
      const id = rawId ? decodeURIComponent(rawId) : '';

      if (resource === 'me' && request.method === 'GET') {
        return json({ ok: true, me: publicMe(me) }, 200, cors);
      }

      if (resource === 'data' && request.method === 'GET') {
        return json({ ok: true, data: filtrarPara(me, await exportAll(env.DB)), me: publicMe(me) }, 200, cors);
      }

      if (resource === 'import' && request.method === 'POST') {
        exigirAdmin(me);
        const body = await readJson(request);
        const result = await importAll(env.DB, body);
        return json({ ok: true, ...result }, 200, cors);
      }

      if (resource === 'usuarios') {
        exigirAdmin(me);
        if (request.method === 'GET' && !id) {
          return json({ ok: true, usuarios: await listarUsuarios(env), canais: await todosCanaisIds(env.DB) }, 200, cors);
        }
        const email = normEmail(id);
        if (!email) return json({ ok: false, error: 'e-mail inválido' }, 400, cors);
        if (donos(env).includes(email)) {
          throw new HttpError(400, 'Este e-mail é dono (ALLOWED_EMAILS) e não pode ser alterado aqui');
        }
        if (request.method === 'PUT') {
          const body = await readJson(request);
          const usuario = await salvarUsuario(env.DB, email, body);
          return json({ ok: true, usuario }, 200, cors);
        }
        if (request.method === 'DELETE') {
          if (email === me.email) throw new HttpError(400, 'Você não pode remover o próprio acesso');
          await env.DB.batch([
            env.DB.prepare('DELETE FROM usuario_canais WHERE email = ?').bind(email),
            env.DB.prepare('DELETE FROM usuarios WHERE email = ?').bind(email)
          ]);
          return json({ ok: true }, 200, cors);
        }
      }

      if (['canais', 'videos', 'recursos'].includes(resource) && id) {
        if (!isValidId(id)) return json({ ok: false, error: 'id inválido' }, 400, cors);

        if (request.method === 'PUT') {
          const body = await readJson(request);
          await checarEscrita(env.DB, me, resource, id, body);
          const upsert = { canais: upsertCanal, videos: upsertVideo, recursos: upsertRecurso }[resource];
          const saved = await upsert(env.DB, { ...body, id }, donoDe(me));
          return json({ ok: true, item: saved }, 200, cors);
        }

        if (request.method === 'DELETE') {
          await checarEscrita(env.DB, me, resource, id, null);
          if (resource === 'canais') {
            // Garante o efeito mesmo se foreign_keys estiver desligado.
            await env.DB.batch([
              env.DB.prepare('DELETE FROM videos WHERE canal_id = ?').bind(id),
              env.DB.prepare('UPDATE recursos SET canal_id = NULL WHERE canal_id = ?').bind(id),
              env.DB.prepare('DELETE FROM usuario_canais WHERE canal_id = ?').bind(id),
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

// ---------- usuários / permissões ----------

function normEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v) ? v : '';
}

function donos(env) {
  return String(env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// me = { email, nome, foto, papel, dono, canais: Set | null (null = todos) }
function publicMe(me) {
  return {
    email: me.email,
    nome: me.nome || '',
    foto: me.foto || '',
    papel: me.papel,
    dono: Boolean(me.dono),
    canais: me.canais ? [...me.canais] : null
  };
}

function exigirAdmin(me) {
  if (me.papel !== 'admin') throw new HttpError(403, 'Só administradores podem fazer isso');
}

function podeCanal(me, canalId) {
  return me.papel === 'admin' || Boolean(canalId && me.canais?.has(canalId));
}

// Dono gravado nos itens novos: '' = espaço da equipe (admins); e-mail = espaço da pessoa.
function donoDe(me) {
  return me.papel === 'admin' ? '' : me.email;
}

function filtrarPara(me, data) {
  const admin = me.papel === 'admin';
  // Admin: canais da equipe e os que ele mesmo criou quando era membro.
  const vejoCanal = (c) => (admin ? !c.dono || c.dono === me.email : me.canais.has(c.id));
  const canais = data.canais.filter(vejoCanal);
  const ids = new Set(canais.map((c) => c.id));
  const meuEspaco = admin ? (d) => !d || d === me.email : (d) => d === me.email;
  return {
    canais: canais.map(({ dono, ...c }) => ({ ...c, podeExcluir: admin || dono === me.email })),
    videos: data.videos.filter((v) => ids.has(v.canalId)),
    // Biblioteca: itens dos canais visíveis + itens gerais do próprio espaço.
    recursos: data.recursos
      .filter((r) => (r.canalId ? ids.has(r.canalId) : meuEspaco(r.dono)))
      .map(({ dono, ...r }) => r)
  };
}

async function checarEscrita(db, me, resource, id, body) {
  if (me.papel === 'admin') return;
  const negar = () => { throw new HttpError(403, 'Você não tem acesso a este canal'); };

  if (resource === 'canais') {
    const atual = await db.prepare('SELECT dono_email FROM canais WHERE id = ?').bind(id).first();
    if (!atual) {
      if (!body) return; // apagar algo que não existe: sem efeito
      const { n } = await db.prepare('SELECT COUNT(*) AS n FROM canais WHERE dono_email = ?').bind(me.email).first();
      if (n >= MAX_CANAIS_PROPRIOS) throw new HttpError(403, `Limite de ${MAX_CANAIS_PROPRIOS} canais por pessoa`);
      return; // canal novo: fica no espaço da pessoa
    }
    if (!body && atual.dono_email !== me.email) throw new HttpError(403, 'Só quem criou o canal (ou um admin) pode excluí-lo');
    if (!podeCanal(me, id)) negar();
    return;
  }

  const table = resource === 'videos' ? 'videos' : 'recursos';
  const cols = resource === 'videos' ? 'canal_id' : 'canal_id, dono_email';
  const atual = await db.prepare(`SELECT ${cols} FROM ${table} WHERE id = ?`).bind(id).first();
  if (atual) {
    if (atual.canal_id) {
      if (!podeCanal(me, atual.canal_id)) negar();
    } else if (resource === 'videos' || atual.dono_email !== me.email) {
      throw new HttpError(403, 'Este item não é seu');
    }
  }
  // Destino do item (PUT): precisa ter acesso ao canal novo.
  if (body) {
    const destino = String(body.canalId || '').trim();
    if ((destino || resource === 'videos') && !podeCanal(me, destino)) negar();
  }
}

async function carregarUsuario(env, email, claims) {
  if (donos(env).includes(email)) {
    return { email, nome: claims?.name || '', foto: claims?.picture || '', papel: 'admin', dono: true, canais: null };
  }
  let u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();
  const agora = new Date();
  if (!u) {
    // Cadastro aberto: a primeira entrada com Google cria o espaço da pessoa.
    if (!claims || env.CADASTRO_ABERTO !== '1') return null;
    await env.DB.prepare(
      `INSERT INTO usuarios (email, nome, foto, papel, origem, ultimo_acesso)
       VALUES (?1, ?2, ?3, 'membro', 'cadastro', ?4) ON CONFLICT(email) DO NOTHING`
    ).bind(email, String(claims.name || '').slice(0, 200), String(claims.picture || '').slice(0, 500), agora.toISOString()).run();
    u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();
    if (!u) return null;
  }
  if (!u.ativo) return null; // acesso pausado por um admin
  let canais = null;
  if (u.papel !== 'admin') {
    const rs = await env.DB.prepare(
      'SELECT canal_id AS id FROM usuario_canais WHERE email = ?1 UNION SELECT id FROM canais WHERE dono_email = ?1'
    ).bind(email).all();
    canais = new Set(rs.results.map((r) => r.id));
  }
  // Guarda nome/foto do Google e a hora do acesso (no máximo a cada 5 min).
  if (claims && (!u.ultimo_acesso || agora - new Date(u.ultimo_acesso) > 5 * 60 * 1000)) {
    await env.DB.prepare(
      `UPDATE usuarios SET ultimo_acesso = ?2,
         nome = CASE WHEN nome = '' THEN ?3 ELSE nome END, foto = ?4 WHERE email = ?1`
    ).bind(email, agora.toISOString(), String(claims.name || '').slice(0, 200), String(claims.picture || '').slice(0, 500)).run();
  }
  return { email, nome: u.nome || claims?.name || '', foto: claims?.picture || u.foto || '', papel: u.papel, dono: false, canais };
}

async function listarUsuarios(env) {
  const [us, links, proprios] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM usuarios ORDER BY papel, created_at DESC'),
    env.DB.prepare('SELECT email, canal_id FROM usuario_canais'),
    env.DB.prepare(`SELECT c.dono_email AS email, c.nome, COUNT(v.id) AS videos
                    FROM canais c LEFT JOIN videos v ON v.canal_id = c.id
                    WHERE c.dono_email <> '' GROUP BY c.id ORDER BY c.nome COLLATE NOCASE`)
  ]);
  const porEmail = {};
  links.results.forEach((l) => (porEmail[l.email] ||= []).push(l.canal_id));
  const propriosPor = {};
  proprios.results.forEach((p) => (propriosPor[p.email] ||= []).push({ nome: p.nome, videos: p.videos }));
  const lista = us.results
    .filter((u) => !donos(env).includes(u.email))
    .map((u) => ({
      email: u.email,
      nome: u.nome,
      foto: u.foto,
      papel: u.papel,
      ativo: Boolean(u.ativo),
      dono: false,
      ultimoAcesso: u.ultimo_acesso,
      criadoEm: u.created_at,
      origem: u.origem || 'convite',
      proprios: propriosPor[u.email] || [],
      canais: porEmail[u.email] || []
    }));
  const fixos = donos(env).map((email) => ({ email, nome: '', foto: '', papel: 'admin', ativo: true, dono: true, ultimoAcesso: '', origem: 'convite', proprios: [], canais: [] }));
  return [...fixos, ...lista];
}

async function todosCanaisIds(db) {
  const rs = await db.prepare("SELECT id FROM canais WHERE dono_email = ''").all();
  return rs.results.map((r) => r.id);
}

async function salvarUsuario(db, email, body) {
  const papel = PAPEIS.includes(body?.papel) ? body.papel : 'membro';
  const nome = text(body?.nome, 'nome', { max: 200 });
  const ativo = body?.ativo === undefined ? 1 : bool(body.ativo);
  const pedidos = Array.isArray(body?.canais) ? body.canais.map(String).filter(isValidId) : [];
  const existentes = new Set(await todosCanaisIds(db));
  const canais = [...new Set(pedidos)].filter((c) => existentes.has(c));

  await db.batch([
    db.prepare(
      `INSERT INTO usuarios (email, nome, papel, ativo) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, papel = excluded.papel,
         ativo = excluded.ativo, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).bind(email, nome, papel, ativo),
    db.prepare('DELETE FROM usuario_canais WHERE email = ?').bind(email),
    ...canais.map((c) => db.prepare('INSERT INTO usuario_canais (email, canal_id) VALUES (?, ?)').bind(email, c))
  ]);
  return { email, nome, papel, ativo: Boolean(ativo), canais };
}

// ---------- autenticação / CORS ----------

async function authorize(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, error: 'Faça login' };

  // ID token do Google = JWT (três partes separadas por ponto).
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    if (!env.GOOGLE_CLIENT_ID) return { ok: false, error: 'Login com Google não configurado no servidor' };
    let claims;
    try {
      claims = await verifyGoogleIdToken(token, env.GOOGLE_CLIENT_ID);
    } catch (err) {
      return { ok: false, error: `Login do Google inválido (${err.message})` };
    }
    const email = String(claims.email || '').toLowerCase();
    const user = claims.email_verified ? await carregarUsuario(env, email, claims) : null;
    if (!user) return { ok: false, error: `A conta ${email || 'Google'} não tem acesso. Peça a um administrador.` };
    return { ok: true, user };
  }

  if (env.API_KEY && (await isApiKey(token, env.API_KEY))) {
    // Só para testes locais: DEV_IMPERSONATE=1 no .dev.vars permite agir como outro e-mail.
    const como = env.DEV_IMPERSONATE === '1' ? normEmail(request.headers.get('X-Dev-As')) : '';
    if (como) {
      const user = await carregarUsuario(env, como, { name: '', picture: '' }); // simula um login Google
      if (!user) return { ok: false, error: `A conta ${como} não tem acesso. Peça a um administrador.` };
      return { ok: true, user };
    }
    return { ok: true, user: { email: 'chave-de-acesso', nome: 'Chave de acesso', papel: 'admin', dono: true, canais: null } };
  }
  return { ok: false, error: 'Chave de acesso inválida' };
}

// --- verificação do ID token do Google (RS256, chaves públicas do Google) ---

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let googleKeysCache = { keys: null, expires: 0 };

async function getGoogleKeys(forceRefresh = false) {
  if (!forceRefresh && googleKeysCache.keys && Date.now() < googleKeysCache.expires) {
    return googleKeysCache.keys;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error('não consegui buscar as chaves do Google');
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1] || 3600);
  googleKeysCache = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifyGoogleIdToken(token, clientId) {
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (header.alg !== 'RS256') throw new Error('algoritmo inesperado');

  let jwk = (await getGoogleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getGoogleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('chave de assinatura desconhecida');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) throw new Error('assinatura inválida');

  const now = Math.floor(Date.now() / 1000);
  const auds = String(clientId).split(',').map((s) => s.trim());
  if (!auds.includes(claims.aud)) throw new Error('token de outro app');
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('emissor inválido');
  if (!(claims.exp > now - 60)) throw new Error('sessão expirada');
  return claims;
}

async function isApiKey(token, apiKey) {
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dev-As',
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
  INSERT INTO canais (id, nome, url, nicho, descricao, anotacoes, cor, dono_email)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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

function canalStmt(db, c, dono = '') {
  return db.prepare(UPSERT_CANAL).bind(c.id, c.nome, c.url, c.nicho, c.descricao, c.anotacoes, c.cor, dono);
}

function videoStmt(db, v) {
  return db.prepare(UPSERT_VIDEO).bind(
    v.id, v.titulo, v.canalId, v.dataPublicacao, v.status,
    v.roteiro, v.gravacao, v.edicao, v.thumbnail, v.publicado, v.url, v.notas, v.tipo, v.horario
  );
}

async function upsertCanal(db, input, dono = '') {
  const canal = cleanCanal(input);
  await canalStmt(db, canal, dono).run();
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
  INSERT INTO recursos (id, tipo, titulo, conteudo, url, tags, canal_id, favorito, dono_email)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  ON CONFLICT(id) DO UPDATE SET
    tipo = excluded.tipo, titulo = excluded.titulo, conteudo = excluded.conteudo,
    url = excluded.url, tags = excluded.tags, canal_id = excluded.canal_id,
    favorito = excluded.favorito,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

async function upsertRecurso(db, input, dono = '') {
  const r = cleanRecurso(input);
  if (r.canalId) {
    const canal = await db.prepare('SELECT 1 FROM canais WHERE id = ?').bind(r.canalId).first();
    if (!canal) throw new HttpError(400, 'Canal do recurso não existe');
  }
  await db.prepare(UPSERT_RECURSO)
    .bind(r.id, r.tipo, r.titulo, r.conteudo, r.url, r.tags, r.canalId, r.favorito, dono)
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
      dono: c.dono_email || '',
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
      dono: r.dono_email || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  };
}
