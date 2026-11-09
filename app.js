// ---------- Configuração da API (Cloudflare Worker + D1/SQLite) ----------
const API_URL_PRODUCAO = 'https://gerenciador-canais-api.gerenciador-canais-api.workers.dev';
const API_URL_LOCAL = 'http://localhost:8789';
// Local = servido em localhost ou aberto direto do disco (file://).
const IS_LOCALHOST = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
// Permite trocar a API sem editar o código: localStorage.setItem('gc_api_url', 'https://...')
const API_URL_OVERRIDE = localStorage.getItem('gc_api_url') || '';
const API_URL = (API_URL_OVERRIDE || (IS_LOCALHOST ? API_URL_LOCAL : API_URL_PRODUCAO)).replace(/\/+$/, '');
// Chave do banco de TESTES local (wrangler dev). Não vale na nuvem.
const API_KEY_LOCAL = 'teste-local-gerenciador';
const USA_API_LOCAL = IS_LOCALHOST && !API_URL_OVERRIDE;
const API_KEY_STORAGE = USA_API_LOCAL ? 'gc_api_key_local' : 'gc_api_key';
const CACHE_STORAGE = 'gc_cache_v2';

// ---------- Domínio ----------

const TIPOS = {
  short: 'Short',
  longo: 'Vídeo longo',
  live: 'Live',
  post: 'Post'
};

const STATUS = {
  planejado: 'Planejado',
  em_producao: 'Em produção',
  pronto: 'Pronto',
  publicado: 'Publicado'
};

const CHECKLIST = [
  ['roteiro', 'Roteiro'],
  ['gravacao', 'Gravação / narração'],
  ['edicao', 'Edição'],
  ['thumbnail', 'Thumbnail / capa'],
  ['publicado', 'Publicado']
];

const PALETA = ['#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d'];
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// ---------- Datas (sempre no fuso local) ----------

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getTodayISO() {
  return toISODate(new Date());
}

function addDays(iso, n) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + n);
  return toISODate(date);
}

function startOfWeek(iso) {
  const date = parseISODate(iso);
  const offset = (date.getDay() + 6) % 7; // segunda = 0
  date.setDate(date.getDate() - offset);
  return toISODate(date);
}

function normalizeDateOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);

  const raw = String(value).trim();
  if (!raw) return '';

  const isoMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : toISODate(parsed);
}

function formatDateBR(value) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return 'Sem data';
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

function formatDiaMes(iso) {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

function formatSemana(inicio) {
  const fim = addDays(inicio, 6);
  const opts = { day: '2-digit', month: 'short' };
  const a = parseISODate(inicio).toLocaleDateString('pt-BR', opts);
  const b = parseISODate(fim).toLocaleDateString('pt-BR', { ...opts, year: 'numeric' });
  return `${a} – ${b}`;
}

// ---------- Estado ----------

const state = {
  tab: 'semana',
  // Semana
  weekStart: startOfWeek(getTodayISO()),
  semanaCanalId: '',
  semanaTipo: '',
  // Canais
  canalAbertoId: '',
  canalTipo: '',
  // Produção
  search: '',
  selectedCanalId: '',
  selectedTipo: '',
  selectedDate: '',
  ignoreDateFilter: true,
  // Dashboard / anotações
  anotacoesCanalFilterId: '',
  showAnotacaoForm: false,
  anotacaoEditing: null,
  // Dados
  canais: [],
  videos: [],
  // Interface
  syncMessage: '',
  showSyncMessage: false,
  isSyncing: false,
  editingCanalId: null,
  editingVideoId: null,
  showCanalForm: false,
  showVideoForm: false
};

// ---------- Acesso à API ----------

function canUseApi() {
  return Boolean(API_URL && /^https?:\/\//.test(API_URL));
}

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || (USA_API_LOCAL ? API_KEY_LOCAL : '');
}

// Mostra o campo para digitar a chave de acesso (fica salva só neste navegador).
function showKeyForm(show = true) {
  const form = byId('key-form');
  if (!form) return;
  form.classList.toggle('hide', !show);
  if (show) setTimeout(() => byId('api-key-input')?.focus(), 0);
}

async function apiRequest(method, path, body) {
  if (!canUseApi()) throw new Error('URL da API não configurada (API_URL_PRODUCAO no app.js)');
  const key = getApiKey();
  if (!key) {
    showKeyForm(true);
    throw new Error('informe a chave de acesso');
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* resposta sem JSON */
  }

  if (response.status === 401) {
    localStorage.removeItem(API_KEY_STORAGE);
    showKeyForm(true);
    throw new Error('chave de acesso inválida — informe de novo');
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_STORAGE, JSON.stringify({ canais: state.canais, videos: state.videos }));
  } catch {
    /* sem espaço / modo privado */
  }
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_STORAGE) || 'null');
    if (cached && Array.isArray(cached.canais) && Array.isArray(cached.videos)) {
      applyData(cached);
      return true;
    }
  } catch {
    /* cache corrompido */
  }
  return false;
}

function applyData(data) {
  const incomingCanais = Array.isArray(data?.canais) ? data.canais : [];
  const incomingVideos = Array.isArray(data?.videos) ? data.videos : [];

  state.canais = incomingCanais.map((canal) => ({
    id: String(canal.id),
    nome: String(canal.nome || ''),
    url: String(canal.url || ''),
    nicho: String(canal.nicho || ''),
    descricao: String(canal.descricao || ''),
    cor: safeColor(canal.cor),
    anotacoes: serializeCanalNotes(parseCanalNotes(canal.anotacoes))
  }));

  state.videos = incomingVideos.map((video) => {
    const status = STATUS[video.status] ? String(video.status) : 'planejado';
    const publicado = Boolean(video.publicado) || status === 'publicado';
    return {
      id: String(video.id),
      titulo: String(video.titulo || ''),
      canalId: String(video.canalId || ''),
      dataPublicacao: normalizeDateOnly(video.dataPublicacao),
      horario: /^\d{2}:\d{2}$/.test(String(video.horario || '')) ? String(video.horario) : '',
      tipo: TIPOS[video.tipo] ? String(video.tipo) : 'longo',
      status: publicado ? 'publicado' : status,
      roteiro: Boolean(video.roteiro),
      gravacao: Boolean(video.gravacao),
      edicao: Boolean(video.edicao),
      thumbnail: Boolean(video.thumbnail),
      publicado,
      url: String(video.url || ''),
      notas: String(video.notas || '')
    };
  });
}

function setStatus(message) {
  state.showSyncMessage = true;
  state.syncMessage = message;
  renderSyncStatus();
}

async function loadData() {
  if (state.isSyncing) return false;
  state.isSyncing = true;
  setStatus('Banco: carregando...');

  try {
    const payload = await apiRequest('GET', '/api/data');
    applyData(payload.data);
    saveCache();
    state.syncMessage = `Banco: dados carregados às ${new Date().toLocaleTimeString('pt-BR')}`;
    return true;
  } catch (error) {
    const hasCache = loadCache();
    if (USA_API_LOCAL && /fetch|network|load failed/i.test(error.message)) {
      error.message = `API local não está rodando em ${API_URL} — rode "npm run dev" na pasta worker`;
    }
    state.syncMessage = hasCache
      ? `Banco: falha ao carregar (${error.message}). Mostrando a última cópia salva neste navegador.`
      : `Banco: falha ao carregar (${error.message}).`;
    return false;
  } finally {
    state.isSyncing = false;
    state.showSyncMessage = true;
    render();
  }
}

// Salva um registro no banco. A tela já foi atualizada antes; se falhar, avisa.
async function persist(method, path, body, okMessage) {
  saveCache();
  try {
    await apiRequest(method, path, body);
    setStatus(okMessage || `Banco: salvo às ${new Date().toLocaleTimeString('pt-BR')}`);
    return true;
  } catch (error) {
    setStatus(`Banco: NÃO salvo (${error.message}). Clique em "Recarregar dados" para ver o que está no banco.`);
    return false;
  }
}

function saveCanal(canalId, okMessage) {
  const canal = state.canais.find((c) => c.id === canalId);
  if (!canal) return Promise.resolve(false);
  return persist('PUT', `/api/canais/${encodeURIComponent(canalId)}`, canal, okMessage);
}

function saveVideo(videoId, okMessage) {
  const video = state.videos.find((v) => v.id === videoId);
  if (!video) return Promise.resolve(false);
  return persist('PUT', `/api/videos/${encodeURIComponent(videoId)}`, video, okMessage);
}

function renderSyncStatus() {
  const statusEl = byId('sync-status');
  const buttonEl = byId('btn-sync');
  if (statusEl) {
    statusEl.textContent = state.syncMessage;
    statusEl.classList.toggle('hide', !state.showSyncMessage || !state.syncMessage);
  }
  if (buttonEl) {
    buttonEl.disabled = state.isSyncing;
    buttonEl.textContent = state.isSyncing ? 'Carregando...' : 'Recarregar dados';
  }
}

// ---------- Utilidades ----------

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escapeHtml;

function safeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : '';
}

function safeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

function canalById(canalId) {
  return state.canais.find((c) => c.id === canalId);
}

function canalNome(canalId) {
  return canalById(canalId)?.nome || 'Canal não encontrado';
}

function canalCor(canalId) {
  const canal = canalById(canalId);
  if (canal?.cor) return canal.cor;
  const index = state.canais.findIndex((c) => c.id === canalId);
  return PALETA[(index >= 0 ? index : 0) % PALETA.length];
}

function isPublicado(video) {
  return video.publicado || video.status === 'publicado';
}

function isAtrasado(video, hoje = getTodayISO()) {
  return Boolean(video.dataPublicacao) && video.dataPublicacao < hoje && !isPublicado(video);
}

function progresso(video) {
  const done = CHECKLIST.filter(([k]) => video[k]).length;
  return Math.round((done / CHECKLIST.length) * 100);
}

function compareAgenda(a, b) {
  const da = a.dataPublicacao || '9999-99-99';
  const db = b.dataPublicacao || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  const ha = a.horario || '99:99';
  const hb = b.horario || '99:99';
  if (ha !== hb) return ha < hb ? -1 : 1;
  return a.titulo.localeCompare(b.titulo, 'pt-BR');
}

function canaisOrdenados() {
  return state.canais.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function optionsCanais(selected, vazio) {
  return `${vazio ? `<option value="">${esc(vazio)}</option>` : ''}${canaisOrdenados()
    .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.nome)}</option>`)
    .join('')}`;
}

function optionsTipos(selected, vazio) {
  return `${vazio ? `<option value="">${esc(vazio)}</option>` : ''}${Object.entries(TIPOS)
    .map(([k, label]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(label)}</option>`)
    .join('')}`;
}

function contarPorTipo(videos) {
  const out = Object.fromEntries(Object.keys(TIPOS).map((k) => [k, 0]));
  videos.forEach((v) => {
    out[v.tipo] = (out[v.tipo] || 0) + 1;
  });
  return out;
}

// ---------- Anotações (guardadas como JSON no canal) ----------

function parseCanalNotes(value) {
  if (!value) return [];
  let list = value;
  if (!Array.isArray(value)) {
    const raw = String(value).trim();
    if (!raw) return [];
    try {
      list = JSON.parse(raw);
    } catch {
      return [{ id: uid(), text: raw, createdAt: new Date().toISOString() }];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((note) => ({
      id: String(note?.id || uid()),
      text: String(note?.text || '').trim(),
      createdAt: String(note?.createdAt || new Date().toISOString())
    }))
    .filter((note) => note.text);
}

function serializeCanalNotes(notes) {
  return JSON.stringify(
    notes.map((note) => ({
      id: String(note.id || uid()),
      text: String(note.text || '').trim(),
      createdAt: String(note.createdAt || new Date().toISOString())
    }))
  );
}

function getCanalNotes(canal) {
  return parseCanalNotes(canal?.anotacoes || '');
}

function setCanalNotes(canalId, notes) {
  state.canais = state.canais.map((canal) =>
    canal.id === canalId ? { ...canal, anotacoes: serializeCanalNotes(notes) } : canal
  );
}

function getFilteredNotes() {
  const items = [];
  state.canais.forEach((canal) => {
    if (state.anotacoesCanalFilterId && canal.id !== state.anotacoesCanalFilterId) return;
    getCanalNotes(canal).forEach((note) => {
      items.push({ canalId: canal.id, canalNome: canal.nome, note });
    });
  });
  return items.sort((a, b) => new Date(b.note.createdAt) - new Date(a.note.createdAt));
}

function startNewAnotacao() {
  state.showAnotacaoForm = true;
  state.anotacaoEditing = null;
  render();
}

function startEditAnotacao(canalId, noteId) {
  state.showAnotacaoForm = true;
  state.anotacaoEditing = { canalId, noteId };
  render();
}

function cancelAnotacaoForm() {
  state.showAnotacaoForm = false;
  state.anotacaoEditing = null;
  render();
}

function saveAnotacaoForm() {
  const canalId = String(byId('anotacao-canal')?.value || '');
  const text = String(byId('anotacao-texto')?.value || '').trim();
  if (!canalId || !text) return;

  const canal = canalById(canalId);
  if (!canal) return;

  const notes = getCanalNotes(canal);
  const editing = state.anotacaoEditing;

  if (editing?.noteId) {
    const index = notes.findIndex((note) => note.id === editing.noteId);
    if (index >= 0) notes[index] = { ...notes[index], text };
  } else {
    notes.unshift({ id: uid(), text, createdAt: new Date().toISOString() });
  }

  setCanalNotes(canalId, notes);
  state.showAnotacaoForm = false;
  state.anotacaoEditing = null;
  render();
  saveCanal(canalId, 'Anotação salva com sucesso.');
}

function deleteCanalAnotacao(canalId, noteId) {
  const canal = canalById(canalId);
  if (!canal) return;
  if (!confirm('Excluir esta anotação?')) return;
  setCanalNotes(canalId, getCanalNotes(canal).filter((note) => note.id !== noteId));
  render();
  saveCanal(canalId, `Anotação removida de ${canalNome(canalId)}.`);
}

// ---------- Ações de canal ----------

function openCanalForm(canalId = null) {
  const canal = canalId ? canalById(canalId) : null;
  state.editingCanalId = canal ? canal.id : null;
  state.showCanalForm = true;
  byId('canal-nome').value = canal?.nome || '';
  byId('canal-cor').value = canal ? canalCor(canal.id) : PALETA[state.canais.length % PALETA.length];
  byId('canal-url').value = canal?.url || '';
  byId('canal-nicho').value = canal?.nicho || '';
  byId('canal-descricao').value = canal?.descricao || '';
  byId('canal-form-titulo').textContent = canal ? 'Editar canal' : 'Novo canal';
  byId('canal-submit').textContent = canal ? 'Salvar canal' : 'Adicionar canal';
  render();
  setTimeout(() => byId('canal-nome').focus(), 0);
}

function closeCanalForm() {
  state.showCanalForm = false;
  state.editingCanalId = null;
  render();
}

function upsertCanal(e) {
  e.preventDefault();
  const canal = {
    nome: byId('canal-nome').value.trim(),
    cor: safeColor(byId('canal-cor').value),
    url: byId('canal-url').value.trim(),
    nicho: byId('canal-nicho').value.trim(),
    descricao: byId('canal-descricao').value.trim()
  };
  if (!canal.nome) return;

  const canalId = state.editingCanalId || uid();
  if (state.editingCanalId) {
    state.canais = state.canais.map((c) => (c.id === canalId ? { ...c, ...canal } : c));
  } else {
    state.canais.push({ id: canalId, ...canal, anotacoes: '[]' });
  }

  closeCanalForm();
  saveCanal(canalId);
}

function deleteCanal(id) {
  const total = state.videos.filter((v) => v.canalId === id).length;
  if (!confirm(`Excluir o canal "${canalNome(id)}" e ${total} conteúdo(s) dele?`)) return;
  state.canais = state.canais.filter((c) => c.id !== id);
  state.videos = state.videos.filter((v) => v.canalId !== id);
  if (state.canalAbertoId === id) state.canalAbertoId = '';
  render();
  persist('DELETE', `/api/canais/${encodeURIComponent(id)}`, undefined, 'Canal excluído.');
}

// ---------- Ações de conteúdo ----------

function htmlChecklistForm(video) {
  return `
    <div class="field">
      <label>Checklist</label>
      <div class="checklist">
        ${CHECKLIST.map(([key, label]) => `
          <label class="check-item">
            <input type="checkbox" id="check-${key}" ${video?.[key] ? 'checked' : ''}>
            <span>${esc(label)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

// prefill: { canalId, dataPublicacao, tipo }
function openVideoForm(videoId = null, prefill = {}) {
  if (!state.canais.length) {
    alert('Cadastre um canal antes de criar conteúdos.');
    return;
  }
  const video = videoId ? state.videos.find((v) => v.id === videoId) : null;
  state.editingVideoId = video ? video.id : null;
  state.showVideoForm = true;

  const defaultCanal =
    prefill.canalId || state.canalAbertoId || state.semanaCanalId || state.selectedCanalId || '';

  byId('video-canal').innerHTML = optionsCanais(video?.canalId || defaultCanal, 'Selecione o canal');
  byId('video-tipo').innerHTML = optionsTipos(video?.tipo || prefill.tipo || state.semanaTipo || 'longo');
  byId('video-titulo').value = video?.titulo || '';
  byId('video-data').value = video?.dataPublicacao || prefill.dataPublicacao || '';
  byId('video-horario').value = video?.horario || '';
  byId('video-status').value = video?.status || 'planejado';
  byId('video-url').value = video?.url || '';
  byId('video-notas').value = video?.notas || '';
  byId('video-checklist').innerHTML = htmlChecklistForm(video);
  byId('video-form-titulo').textContent = video ? 'Editar conteúdo' : 'Novo conteúdo';
  byId('video-submit').textContent = video ? 'Salvar' : 'Adicionar';
  byId('delete-video').classList.toggle('hide', !video);
  render();
  setTimeout(() => byId('video-titulo').focus(), 0);
}

function closeVideoForm() {
  state.showVideoForm = false;
  state.editingVideoId = null;
  render();
}

function upsertVideo(e) {
  e.preventDefault();
  const anterior = state.editingVideoId ? state.videos.find((v) => v.id === state.editingVideoId) : null;

  const base = {
    titulo: byId('video-titulo').value.trim(),
    canalId: byId('video-canal').value,
    tipo: byId('video-tipo').value || 'longo',
    dataPublicacao: normalizeDateOnly(byId('video-data').value),
    horario: byId('video-horario').value || '',
    status: byId('video-status').value,
    url: byId('video-url').value.trim(),
    notas: byId('video-notas').value.trim()
  };
  CHECKLIST.forEach(([key]) => {
    base[key] = Boolean(byId(`check-${key}`)?.checked);
  });
  if (!base.titulo || !base.canalId) return;

  // Status "Publicado" e o item "Publicado" do checklist andam juntos.
  const marcouAgora = base.publicado && !anterior?.publicado;
  if (base.status === 'publicado' || marcouAgora) {
    base.status = 'publicado';
    base.publicado = true;
  } else {
    base.publicado = false;
  }

  const videoId = state.editingVideoId || uid();
  if (anterior) {
    state.videos = state.videos.map((v) => (v.id === videoId ? { ...v, ...base } : v));
  } else {
    state.videos.push({ id: videoId, ...base });
  }

  closeVideoForm();
  saveVideo(videoId);
}

function deleteVideo(id) {
  const video = state.videos.find((v) => v.id === id);
  if (!video || !confirm(`Excluir "${video.titulo}"?`)) return;
  state.videos = state.videos.filter((v) => v.id !== id);
  if (state.editingVideoId === id) {
    state.showVideoForm = false;
    state.editingVideoId = null;
  }
  render();
  persist('DELETE', `/api/videos/${encodeURIComponent(id)}`, undefined, 'Conteúdo excluído.');
}

function marcarPublicado(id) {
  const hoje = getTodayISO();
  state.videos = state.videos.map((v) =>
    v.id === id
      ? { ...v, status: 'publicado', publicado: true, dataPublicacao: v.dataPublicacao || hoje }
      : v
  );
  render();
  saveVideo(id, 'Marcado como publicado.');
}

function moverParaData(id, dataPublicacao) {
  state.videos = state.videos.map((v) => (v.id === id ? { ...v, dataPublicacao } : v));
  render();
  saveVideo(id, `Movido para ${formatDateBR(dataPublicacao)}.`);
}

// ---------- Componentes de lista ----------

function htmlTipo(tipo) {
  return `<span class="tipo tipo-${esc(tipo)}">${esc(TIPOS[tipo] || tipo)}</span>`;
}

function htmlStatus(video) {
  const status = isPublicado(video) ? 'publicado' : video.status;
  return `<span class="badge ${esc(status)}">${esc(STATUS[status] || status)}</span>`;
}

// Cartão compacto usado na semana, no canal e nas listas.
function htmlItem(video, { mostrarData = false, mostrarCanal = true, draggable = false } = {}) {
  const publicado = isPublicado(video);
  const atrasado = isAtrasado(video);
  const link = safeUrl(video.url);
  return `
    <div class="item ${publicado ? 'is-publicado' : ''} ${atrasado ? 'is-atrasado' : ''}"
         style="--c:${canalCor(video.canalId)}"
         data-action="edit-video" data-id="${esc(video.id)}"
         ${draggable ? 'draggable="true"' : ''} title="Clique para editar">
      <div class="item-top">
        ${htmlTipo(video.tipo)}
        ${video.horario ? `<span class="item-hora">${esc(video.horario)}</span>` : ''}
        ${mostrarData ? `<span class="item-hora">${esc(formatDateBR(video.dataPublicacao))}</span>` : ''}
      </div>
      <div class="item-title">${esc(video.titulo)}</div>
      <div class="item-meta">
        ${mostrarCanal ? `<span class="item-canal"><i class="dot"></i>${esc(canalNome(video.canalId))}</span>` : ''}
        ${htmlStatus(video)}
        ${atrasado ? '<span class="badge atrasado">Atrasado</span>' : ''}
      </div>
      <div class="item-actions">
        ${publicado
          ? (link ? `<a class="btn mini" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-stop="1">Abrir</a>` : '')
          : `<button class="btn mini ok" data-action="mark-published" data-id="${esc(video.id)}" title="Marcar como publicado">✓ Marcar postado</button>`}
      </div>
    </div>
  `;
}

function htmlFiltroChips(atual, acao, incluirTodos = true) {
  const chips = incluirTodos ? [['', 'Todos']] : [];
  Object.entries(TIPOS).forEach(([k, label]) => chips.push([k, label]));
  return `<div class="chips">${chips
    .map(([k, label]) => `<button class="chip ${atual === k ? 'active' : ''}" data-action="${acao}" data-value="${k}">${esc(label)}</button>`)
    .join('')}</div>`;
}

// ---------- Aba: Semana ----------

function videosFiltradosSemana() {
  return state.videos.filter(
    (v) =>
      (!state.semanaCanalId || v.canalId === state.semanaCanalId) &&
      (!state.semanaTipo || v.tipo === state.semanaTipo)
  );
}

function htmlSemana() {
  if (!state.canais.length) {
    return '<div class="card empty">Cadastre um canal na aba <strong>Canais</strong> para começar a montar a agenda.</div>';
  }

  const hoje = getTodayISO();
  const inicio = state.weekStart;
  const fim = addDays(inicio, 6);
  const base = videosFiltradosSemana();
  const daSemana = base.filter((v) => v.dataPublicacao >= inicio && v.dataPublicacao <= fim).sort(compareAgenda);
  const publicados = daSemana.filter(isPublicado);
  const atrasados = base.filter((v) => isAtrasado(v, hoje)).sort(compareAgenda);
  const semData = base.filter((v) => !v.dataPublicacao && !isPublicado(v)).sort(compareAgenda);
  const porTipo = contarPorTipo(daSemana);

  const resumoCanais = canaisOrdenados()
    .map((c) => {
      const lista = daSemana.filter((v) => v.canalId === c.id);
      if (!lista.length) return '';
      const pub = lista.filter(isPublicado).length;
      const pct = Math.round((pub / lista.length) * 100);
      return `
        <div class="canal-progress" style="--c:${canalCor(c.id)}">
          <div class="canal-progress-head">
            <span><i class="dot"></i><strong>${esc(c.nome)}</strong></span>
            <span class="muted">${pub}/${lista.length} publicados</span>
          </div>
          <div class="progress"><span style="width:${pct}%; background:${canalCor(c.id)}"></span></div>
        </div>
      `;
    })
    .join('');

  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicio, i));

  return `
    <div class="semana-toolbar">
      <div class="actions">
        <button class="btn" data-action="semana-prev" aria-label="Semana anterior">◀</button>
        <button class="btn" data-action="semana-hoje">Hoje</button>
        <button class="btn" data-action="semana-next" aria-label="Próxima semana">▶</button>
        <strong class="semana-label">${esc(formatSemana(inicio))}</strong>
      </div>
      <div class="actions">
        <select id="semana-canal" aria-label="Filtrar por canal">${optionsCanais(state.semanaCanalId, 'Todos os canais')}</select>
      </div>
    </div>
    ${htmlFiltroChips(state.semanaTipo, 'semana-tipo')}

    <div class="kpi" style="margin:12px 0;">
      <div class="card"><p class="muted">Programados</p><strong>${daSemana.length}</strong></div>
      <div class="card"><p class="muted">Publicados</p><strong>${publicados.length}</strong></div>
      <div class="card"><p class="muted">Faltam</p><strong>${daSemana.length - publicados.length}</strong></div>
      <div class="card"><p class="muted">Por tipo</p>
        <div class="tipo-resumo">${Object.entries(porTipo).filter(([, n]) => n).map(([k, n]) => `${htmlTipo(k)} <b>${n}</b>`).join(' ') || '<span class="muted">—</span>'}</div>
      </div>
    </div>

    ${resumoCanais ? `<div class="card" style="margin-bottom:12px;"><h3 style="margin-bottom:8px;">Por canal nesta semana</h3><div class="list">${resumoCanais}</div></div>` : ''}

    <div class="week">
      ${dias.map((dia, i) => {
        const doDia = daSemana.filter((v) => v.dataPublicacao === dia);
        return `
          <div class="day ${dia === hoje ? 'is-today' : ''} ${dia < hoje ? 'is-past' : ''}" data-dia="${dia}">
            <div class="day-head">
              <span><strong>${DIAS_SEMANA[i]}</strong> <span class="muted">${formatDiaMes(dia)}</span></span>
              <button class="btn mini" data-action="novo-no-dia" data-dia="${dia}" aria-label="Novo conteúdo em ${formatDiaMes(dia)}">+</button>
            </div>
            <div class="day-list">
              ${doDia.map((v) => htmlItem(v, { draggable: true })).join('') || '<p class="day-empty">—</p>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <p class="muted dica">Dica: arraste um card para outro dia para remarcar.</p>

    ${atrasados.length ? `
      <div class="card section-alert" style="margin-top:12px;">
        <h3>Atrasados <span class="muted">(${atrasados.length})</span></h3>
        <p class="muted" style="margin:4px 0 10px;">Tinham data para sair e ainda não foram publicados.</p>
        <div class="item-grid">${atrasados.map((v) => htmlItem(v, { mostrarData: true })).join('')}</div>
      </div>` : ''}

    ${semData.length ? `
      <details class="card" style="margin-top:12px;">
        <summary><strong>Ideias sem data</strong> <span class="muted">(${semData.length})</span> — arraste para um dia ou edite para agendar</summary>
        <div class="item-grid" style="margin-top:10px;">${semData.map((v) => htmlItem(v, { draggable: true })).join('')}</div>
      </details>` : ''}
  `;
}

// ---------- Aba: Canais ----------

function htmlCanais() {
  if (state.canalAbertoId && canalById(state.canalAbertoId)) return htmlCanalDetalhe(state.canalAbertoId);
  if (!state.canais.length) return '<div class="card empty">Nenhum canal cadastrado.</div>';

  const hoje = getTodayISO();
  const inicio = startOfWeek(hoje);
  const fim = addDays(inicio, 6);

  return `<div class="grid">${canaisOrdenados().map((c) => {
    const videos = state.videos.filter((v) => v.canalId === c.id);
    const publicados = videos.filter(isPublicado);
    const semana = videos.filter((v) => v.dataPublicacao >= inicio && v.dataPublicacao <= fim);
    const proximo = videos.filter((v) => !isPublicado(v) && v.dataPublicacao >= hoje).sort(compareAgenda)[0];
    const atrasados = videos.filter((v) => isAtrasado(v, hoje)).length;
    const porTipo = contarPorTipo(videos);
    const link = safeUrl(c.url);
    return `
      <div class="card canal-card" style="--c:${canalCor(c.id)}">
        <div class="toolbar" style="margin-bottom:6px;">
          <h3><i class="dot"></i>${esc(c.nome)}</h3>
          <div class="actions">
            <button class="btn mini" data-action="edit-canal" data-id="${esc(c.id)}">Editar</button>
            <button class="btn mini" data-action="del-canal" data-id="${esc(c.id)}">Excluir</button>
          </div>
        </div>
        ${c.nicho ? `<p class="muted" style="margin:0 0 8px;">${esc(c.nicho)}</p>` : ''}
        <div class="mini-stats">
          <div><strong>${semana.length}</strong><span>esta semana</span></div>
          <div><strong>${publicados.length}</strong><span>publicados</span></div>
          <div><strong>${videos.length - publicados.length}</strong><span>na fila</span></div>
        </div>
        <div class="tipo-resumo" style="margin:8px 0;">
          ${Object.entries(porTipo).filter(([, n]) => n).map(([k, n]) => `${htmlTipo(k)} <b>${n}</b>`).join(' ') || '<span class="muted">Sem conteúdos</span>'}
        </div>
        <p class="muted" style="margin:0 0 4px;">
          Próximo: ${proximo ? `<strong>${esc(proximo.titulo)}</strong> — ${esc(formatDateBR(proximo.dataPublicacao))}${proximo.horario ? ` ${esc(proximo.horario)}` : ''}` : 'nada agendado'}
        </p>
        ${atrasados ? `<p class="text-alert" style="margin:0 0 4px;">${atrasados} atrasado(s)</p>` : ''}
        <div class="actions" style="margin-top:10px;">
          <button class="btn primary" data-action="abrir-canal" data-id="${esc(c.id)}">Abrir canal</button>
          ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a>` : ''}
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

function htmlCanalDetalhe(canalId) {
  const canal = canalById(canalId);
  const hoje = getTodayISO();
  const todos = state.videos.filter((v) => v.canalId === canalId);
  const videos = todos.filter((v) => !state.canalTipo || v.tipo === state.canalTipo);

  const proximos = videos.filter((v) => !isPublicado(v) && v.dataPublicacao && v.dataPublicacao >= hoje).sort(compareAgenda);
  const atrasados = videos.filter((v) => isAtrasado(v, hoje)).sort(compareAgenda);
  const ideias = videos.filter((v) => !isPublicado(v) && !v.dataPublicacao).sort(compareAgenda);
  const publicados = videos.filter(isPublicado).sort((a, b) => compareAgenda(b, a));
  const porTipo = contarPorTipo(todos);
  const link = safeUrl(canal.url);

  const secao = (titulo, lista, vazio, opts = {}) => `
    <div class="card ${opts.alerta ? 'section-alert' : ''}" style="margin-top:12px;">
      <div class="toolbar" style="margin-bottom:8px;">
        <h3>${esc(titulo)} <span class="muted">(${lista.length})</span></h3>
      </div>
      ${lista.length
        ? `<div class="item-grid">${lista.map((v) => htmlItem(v, { mostrarData: true, mostrarCanal: false })).join('')}</div>`
        : `<p class="muted" style="margin:0;">${esc(vazio)}</p>`}
    </div>
  `;

  return `
    <div class="canal-header" style="--c:${canalCor(canalId)}">
      <button class="btn" data-action="fechar-canal">← Canais</button>
      <div style="flex:1; min-width:200px;">
        <h2><i class="dot big"></i>${esc(canal.nome)}</h2>
        ${canal.nicho ? `<p class="muted" style="margin:2px 0 0;">${esc(canal.nicho)}</p>` : ''}
      </div>
      <div class="actions">
        ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a>` : ''}
        <button class="btn" data-action="edit-canal" data-id="${esc(canalId)}">Editar canal</button>
        <button class="btn primary" data-action="novo-no-canal" data-id="${esc(canalId)}">Novo conteúdo</button>
      </div>
    </div>
    ${canal.descricao ? `<p class="muted">${esc(canal.descricao)}</p>` : ''}

    <div class="kpi" style="margin:12px 0;">
      ${Object.entries(TIPOS).map(([k, label]) => {
        const lista = todos.filter((v) => v.tipo === k);
        return `<div class="card"><p class="muted">${esc(label)}</p><strong>${lista.filter(isPublicado).length}</strong><span class="muted"> / ${lista.length} publicados</span></div>`;
      }).join('')}
    </div>

    ${htmlFiltroChips(state.canalTipo, 'canal-tipo')}
    ${atrasados.length ? secao('Atrasados', atrasados, '', { alerta: true }) : ''}
    ${secao('Próximos', proximos, 'Nada agendado. Use "Novo conteúdo" ou dê data a uma ideia.')}
    ${secao('Ideias sem data', ideias, 'Nenhuma ideia guardada.')}
    ${secao('Publicados', publicados, 'Nada publicado ainda.')}
    <p class="muted" style="margin-top:12px;">Total no canal: ${todos.length} · ${Object.entries(porTipo).filter(([, n]) => n).map(([k, n]) => `${esc(TIPOS[k])}: ${n}`).join(' · ') || 'sem conteúdos'}</p>
  `;
}

// ---------- Aba: Produção (kanban) ----------

function filteredVideos() {
  const query = state.search.toLowerCase().trim();
  const selectedDate = normalizeDateOnly(state.selectedDate);

  return state.videos.filter((video) => {
    const canalMatch = !state.selectedCanalId || video.canalId === state.selectedCanalId;
    const tipoMatch = !state.selectedTipo || video.tipo === state.selectedTipo;
    const dateMatch = state.ignoreDateFilter || !selectedDate || video.dataPublicacao === selectedDate;
    const searchMatch =
      !query ||
      video.titulo.toLowerCase().includes(query) ||
      canalNome(video.canalId).toLowerCase().includes(query);
    return canalMatch && tipoMatch && dateMatch && searchMatch;
  });
}

function htmlPlanejamento() {
  const data = filteredVideos().sort(compareAgenda);
  if (!state.videos.length) return '<div class="card empty">Nenhum conteúdo cadastrado.</div>';

  const colunas = [
    ['planejado', 'Ideias / planejado'],
    ['em_producao', 'Em produção'],
    ['pronto', 'Pronto para postar'],
    ['publicado', 'Publicado']
  ];

  const renderItem = (video) => `
    <div class="kanban-item" style="--c:${canalCor(video.canalId)}" data-action="edit-video" data-id="${esc(video.id)}">
      <div class="item-top">${htmlTipo(video.tipo)}<span class="item-hora">${esc(formatDateBR(video.dataPublicacao))}${video.horario ? ` ${esc(video.horario)}` : ''}</span></div>
      <h4>${esc(video.titulo)}</h4>
      <p class="kanban-meta"><i class="dot"></i>${esc(canalNome(video.canalId))}</p>
      <div class="progress" style="margin-top:6px;"><span style="width:${progresso(video)}%"></span></div>
      <p class="kanban-meta" style="margin-top:4px;">Checklist: ${progresso(video)}%</p>
    </div>
  `;

  return `
    <div class="kanban-board">
      ${colunas.map(([status, titulo], i) => {
        const lista = data.filter((v) => (status === 'publicado' ? isPublicado(v) : !isPublicado(v) && v.status === status));
        return `
          <div class="kanban-col">
            <div class="kanban-head"><span class="kanban-index">${i + 1}</span><span>${esc(titulo)}</span><span class="muted">(${lista.length})</span></div>
            <div class="kanban-list">
              ${lista.map(renderItem).join('') || '<p class="kanban-meta">Nada aqui com estes filtros.</p>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ---------- Aba: Anotações ----------

function htmlAnotacoes() {
  if (!state.canais.length) return '<div class="card empty">Cadastre um canal para criar anotações.</div>';

  const editing = state.anotacaoEditing;
  const editingCanal = editing?.canalId ? canalById(editing.canalId) : null;
  const editingNote = editingCanal && editing?.noteId
    ? getCanalNotes(editingCanal).find((note) => note.id === editing.noteId)
    : null;

  const allNotes = getFilteredNotes();
  const defaultCanalId = editing?.canalId || state.anotacoesCanalFilterId || canaisOrdenados()[0]?.id || '';

  return `
    <div class="card" style="margin-bottom:10px;">
      <div class="toolbar" style="margin-bottom:0;">
        <div class="field" style="max-width:360px;">
          <label for="anotacoes-canal-filter">Filtrar anotações por canal</label>
          <select id="anotacoes-canal-filter">${optionsCanais(state.anotacoesCanalFilterId, 'Todos os canais')}</select>
        </div>
        <button class="btn primary" data-action="nova-anotacao">Criar anotação</button>
      </div>
    </div>

    ${state.showAnotacaoForm ? `
      <div class="card">
        <h3 style="margin-bottom:10px;">${editingNote ? 'Editar anotação' : 'Nova anotação'}</h3>
        <div class="field" style="margin-bottom:10px; max-width:360px;">
          <label for="anotacao-canal">Canal</label>
          <select id="anotacao-canal" ${editingNote ? 'disabled' : ''}>${optionsCanais(defaultCanalId)}</select>
        </div>
        <div class="field" style="margin-bottom:10px;">
          <label for="anotacao-texto">Anotação</label>
          <textarea id="anotacao-texto" rows="4" placeholder="Escreva sua anotação...">${esc(editingNote?.text || '')}</textarea>
        </div>
        <div class="actions">
          <button class="btn primary" data-action="salvar-anotacao-form">Salvar</button>
          <button class="btn" data-action="cancelar-anotacao-form">Cancelar</button>
        </div>
      </div>
    ` : ''}

    <div class="card" style="padding:0; overflow:hidden; margin-top:10px;">
      <div class="toolbar" style="padding:12px 14px; border-bottom:1px solid var(--border); margin:0;">
        <h3>Lista de anotações</h3>
        <span class="muted">${allNotes.length} item(ns)</span>
      </div>
      <div class="notes-list" style="padding:10px;">
        ${allNotes.length
          ? allNotes.map(({ canalId, canalNome: nomeCanal, note }) => `
            <div class="note-item" style="--c:${canalCor(canalId)}">
              <div class="toolbar" style="margin-bottom:6px;">
                <div>
                  <strong><i class="dot"></i>${esc(nomeCanal)}</strong>
                  <p class="muted" style="margin:2px 0 0 0;">${esc(new Date(note.createdAt).toLocaleString('pt-BR'))}</p>
                </div>
                <div class="actions">
                  <button class="btn mini" data-action="editar-anotacao" data-id="${esc(canalId)}" data-note-id="${esc(note.id)}">Editar</button>
                  <button class="btn mini" data-action="del-anotacao" data-id="${esc(canalId)}" data-note-id="${esc(note.id)}">Excluir</button>
                </div>
              </div>
              <p class="muted" style="margin:0; white-space:pre-wrap;">${esc(note.text)}</p>
            </div>
          `).join('')
          : '<p class="muted" style="padding:4px 2px;">Nenhuma anotação para o filtro selecionado.</p>'}
      </div>
    </div>
  `;
}

// ---------- Aba: Dashboard ----------

function htmlDashboard() {
  const hoje = getTodayISO();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const total = state.videos.length;
  const publicados = state.videos.filter(isPublicado);
  const noMes = publicados.filter((v) => v.dataPublicacao >= inicioMes && v.dataPublicacao <= hoje).length;
  const atrasados = state.videos.filter((v) => isAtrasado(v, hoje)).length;

  const linhas = canaisOrdenados().map((c) => {
    const videos = state.videos.filter((v) => v.canalId === c.id);
    const pubs = videos.filter(isPublicado);
    const ultimo = pubs.filter((v) => v.dataPublicacao).sort((a, b) => compareAgenda(b, a))[0];
    const celulas = Object.keys(TIPOS).map((k) => {
      const lista = videos.filter((v) => v.tipo === k);
      return `<td>${lista.filter(isPublicado).length}<span class="muted">/${lista.length}</span></td>`;
    }).join('');
    return `
      <tr style="--c:${canalCor(c.id)}">
        <td><i class="dot"></i><a href="#" data-action="abrir-canal" data-id="${esc(c.id)}">${esc(c.nome)}</a></td>
        ${celulas}
        <td><strong>${pubs.length}</strong><span class="muted">/${videos.length}</span></td>
        <td>${ultimo ? esc(formatDateBR(ultimo.dataPublicacao)) : '<span class="muted">—</span>'}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="kpi">
      <div class="card"><p class="muted">Conteúdos</p><strong>${total}</strong></div>
      <div class="card"><p class="muted">Publicados</p><strong>${publicados.length}</strong></div>
      <div class="card"><p class="muted">Publicados este mês</p><strong>${noMes}</strong></div>
      <div class="card"><p class="muted">Atrasados</p><strong class="${atrasados ? 'text-alert' : ''}">${atrasados}</strong></div>
    </div>
    <div class="card" style="margin-top:12px; overflow-x:auto;">
      <h3 style="margin-bottom:8px;">Publicados por canal e tipo</h3>
      ${linhas ? `
        <table class="tabela">
          <thead><tr><th>Canal</th>${Object.values(TIPOS).map((l) => `<th>${esc(l)}</th>`).join('')}<th>Total</th><th>Último post</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>` : '<p class="muted">Sem canais cadastrados.</p>'}
    </div>
  `;
}

// ---------- Render ----------

const TITULOS_ABA = {
  semana: 'Semana',
  canais: 'Canais',
  planejamento: 'Produção',
  anotacoes: 'Anotações',
  dashboard: 'Dashboard'
};

function render() {
  const hoje = getTodayISO();
  const inicio = startOfWeek(hoje);
  const fim = addDays(inicio, 6);

  byId('total-canais').textContent = state.canais.length;
  byId('total-semana').textContent = state.videos.filter((v) => v.dataPublicacao >= inicio && v.dataPublicacao <= fim).length;
  byId('total-publicados').textContent = state.videos.filter(isPublicado).length;

  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === state.tab));
  const abrindoCanal = state.tab === 'canais' && state.canalAbertoId;
  byId('painel-titulo').textContent = abrindoCanal ? 'Canal' : TITULOS_ABA[state.tab];

  byId('canal-form-card').classList.toggle('hide', !state.showCanalForm);
  byId('video-form-card').classList.toggle('hide', !state.showVideoForm);
  document.body.classList.toggle('modal-open', state.showCanalForm || state.showVideoForm);

  byId('search-wrap').classList.toggle('hide', state.tab !== 'planejamento');
  byId('btn-novo-canal').classList.toggle('hide', state.tab !== 'canais' || Boolean(abrindoCanal));
  byId('btn-novo-video').classList.toggle('hide', !['semana', 'planejamento'].includes(state.tab));
  byId('btn-novo-video').disabled = !state.canais.length;

  const content = byId('content');
  if (state.tab === 'semana') content.innerHTML = htmlSemana();
  if (state.tab === 'canais') content.innerHTML = htmlCanais();
  if (state.tab === 'anotacoes') content.innerHTML = htmlAnotacoes();
  if (state.tab === 'planejamento') content.innerHTML = htmlPlanejamento();
  if (state.tab === 'dashboard') content.innerHTML = htmlDashboard();

  const semanaCanal = byId('semana-canal');
  if (semanaCanal) {
    semanaCanal.onchange = (e) => {
      state.semanaCanalId = e.target.value;
      render();
    };
  }

  const anotacoesFiltro = byId('anotacoes-canal-filter');
  if (anotacoesFiltro) {
    anotacoesFiltro.onchange = (e) => {
      state.anotacoesCanalFilterId = e.target.value;
      render();
    };
  }

  if (state.tab === 'planejamento') {
    byId('filter-canal').innerHTML = optionsCanais(state.selectedCanalId, 'Todos os canais');
    byId('filter-tipo').innerHTML = optionsTipos(state.selectedTipo, 'Todos os tipos');
    byId('filter-date').value = state.selectedDate;
    byId('filter-date').disabled = state.ignoreDateFilter;
    byId('filter-all-dates').checked = state.ignoreDateFilter;
  }

  renderSyncStatus();
}

// ---------- Eventos ----------

function setTab(tab) {
  state.tab = tab;
  if (tab !== 'canais') state.canalAbertoId = '';
  render();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.tab === 'canais') state.canalAbertoId = '';
      setTab(el.dataset.tab);
    };
  });

  byId('btn-novo-canal').onclick = () => openCanalForm();
  byId('btn-novo-video').onclick = () => openVideoForm();
  byId('btn-sync').onclick = () => loadData();

  byId('canal-form').onsubmit = upsertCanal;
  byId('video-form').onsubmit = upsertVideo;
  byId('cancel-canal').onclick = closeCanalForm;
  byId('cancel-video').onclick = closeVideoForm;
  byId('delete-video').onclick = () => deleteVideo(state.editingVideoId);

  // Fecha a janela clicando fora ou com Esc.
  byId('canal-form-card').addEventListener('mousedown', (e) => {
    if (e.target.id === 'canal-form-card') closeCanalForm();
  });
  byId('video-form-card').addEventListener('mousedown', (e) => {
    if (e.target.id === 'video-form-card') closeVideoForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.showVideoForm) closeVideoForm();
    else if (state.showCanalForm) closeCanalForm();
  });

  byId('key-form').onsubmit = (e) => {
    e.preventDefault();
    const key = byId('api-key-input').value.trim();
    if (!key) return;
    localStorage.setItem(API_KEY_STORAGE, key);
    byId('api-key-input').value = '';
    showKeyForm(false);
    loadData();
  };

  byId('search').oninput = (e) => {
    state.search = e.target.value;
    render();
  };
  byId('filter-canal').onchange = (e) => {
    state.selectedCanalId = e.target.value;
    render();
  };
  byId('filter-tipo').onchange = (e) => {
    state.selectedTipo = e.target.value;
    render();
  };
  byId('filter-date').onchange = (e) => {
    state.selectedDate = normalizeDateOnly(e.target.value);
    if (state.selectedDate) state.ignoreDateFilter = false;
    render();
  };
  byId('filter-all-dates').onchange = (e) => {
    state.ignoreDateFilter = e.target.checked;
    if (state.ignoreDateFilter) state.selectedDate = '';
    render();
  };

  const content = byId('content');

  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; // links externos
    const el = e.target.closest('[data-action]');
    if (!el || !content.contains(el)) return;
    const { action, id, noteId, value, dia } = el.dataset;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();

    switch (action) {
      case 'edit-video': return openVideoForm(id);
      case 'mark-published': return marcarPublicado(id);
      case 'novo-no-dia': return openVideoForm(null, { dataPublicacao: dia });
      case 'novo-no-canal': return openVideoForm(null, { canalId: id });
      case 'semana-prev': state.weekStart = addDays(state.weekStart, -7); return render();
      case 'semana-next': state.weekStart = addDays(state.weekStart, 7); return render();
      case 'semana-hoje': state.weekStart = startOfWeek(getTodayISO()); return render();
      case 'semana-tipo': state.semanaTipo = value; return render();
      case 'canal-tipo': state.canalTipo = value; return render();
      case 'abrir-canal': state.tab = 'canais'; state.canalAbertoId = id; state.canalTipo = ''; window.scrollTo(0, 0); return render();
      case 'fechar-canal': state.canalAbertoId = ''; return render();
      case 'edit-canal': return openCanalForm(id);
      case 'del-canal': return deleteCanal(id);
      case 'nova-anotacao': return startNewAnotacao();
      case 'editar-anotacao': return startEditAnotacao(id, noteId);
      case 'salvar-anotacao-form': return saveAnotacaoForm();
      case 'cancelar-anotacao-form': return cancelAnotacaoForm();
      case 'del-anotacao': return deleteCanalAnotacao(id, noteId);
      default: return undefined;
    }
  });

  // Arrastar cards entre os dias da semana para remarcar.
  content.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.item[draggable="true"]');
    if (!item) return;
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  content.addEventListener('dragend', (e) => {
    e.target.closest?.('.item')?.classList.remove('dragging');
    content.querySelectorAll('.day.drop').forEach((d) => d.classList.remove('drop'));
  });
  content.addEventListener('dragover', (e) => {
    const day = e.target.closest('.day');
    if (!day) return;
    e.preventDefault();
    content.querySelectorAll('.day.drop').forEach((d) => d !== day && d.classList.remove('drop'));
    day.classList.add('drop');
  });
  content.addEventListener('drop', (e) => {
    const day = e.target.closest('.day');
    if (!day) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const video = state.videos.find((v) => v.id === id);
    if (video && video.dataPublicacao !== day.dataset.dia) moverParaData(id, day.dataset.dia);
  });
}

async function init() {
  bindEvents();
  loadCache(); // mostra a última cópia na hora, enquanto o banco responde
  render();

  if (canUseApi()) {
    await loadData();
  } else {
    setStatus('Banco: URL da API não configurada (API_URL_PRODUCAO no app.js).');
  }
  if (USA_API_LOCAL) {
    document.title = '[LOCAL] ' + document.title;
    const sub = document.querySelector('.header p');
    if (sub) sub.innerHTML = '<span class="badge em_producao">MODO LOCAL</span> banco de testes — nada aqui vai para a nuvem';
  }
}

init();
