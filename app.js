const SHEETS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbytjuhth_YUID2xC7pUoeV0v9KivPCQ8n0yQLyFnk5j89usYM4V48Zjk1RppNixlH5mww/exec';
let syncTimer = null;

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  if (!value) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const isoMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return '';
}

function formatDateBR(value) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return 'Sem data';
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

const state = {
  tab: 'canais',
  search: '',
  selectedCanalId: '',
  selectedDate: getTodayISO(),
  ignoreDateFilter: false,
  registroCanalId: '',
  anotacoesCanalFilterId: '',
  showAnotacaoForm: false,
  anotacaoEditing: null,
  canais: [],
  videos: [],
  allowDestructiveNextSync: false,
  cloudLoadOk: false,
  syncMessage: '',
  showSyncMessage: false,
  isSyncing: false,
  editingCanalId: null,
  editingVideoId: null,
  showCanalForm: false,
  showVideoForm: false
};

function saveState() {
  scheduleSync();
}

function canSyncSheets() {
  return Boolean(SHEETS_WEB_APP_URL && SHEETS_WEB_APP_URL.startsWith('https://'));
}

function scheduleSync() {
  if (!canSyncSheets()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncToSheets('auto');
  }, 800);
}

function mergeById(remoteItems = [], localItems = []) {
  const merged = new Map();

  remoteItems.forEach((item) => {
    const id = String(item?.id || '');
    if (!id) return;
    merged.set(id, { ...item, id });
  });

  localItems.forEach((item) => {
    const id = String(item?.id || uid());
    merged.set(id, { ...item, id });
  });

  return Array.from(merged.values());
}

async function syncToSheets(source = 'manual') {
  if (!canSyncSheets() || state.isSyncing) return;

  if (!state.cloudLoadOk) {
    if (source === 'auto') {
      return;
    }

    state.showSyncMessage = true;
    state.syncMessage = 'Planilha: carga inicial não confirmada; sincronização manual permitida com proteção anti-perda.';
    renderSyncStatus();
  }

  state.isSyncing = true;
  state.showSyncMessage = true;
  state.syncMessage = `Planilha: sincronizando (${source})...`;
  renderSyncStatus();

  let syncCanais = [...state.canais];
  let syncVideos = [...state.videos];
  const allowDestructiveSync = state.allowDestructiveNextSync;

  if (!allowDestructiveSync) {
    try {
      const remotePayload = await loadFromSheetsRemote();
      if (remotePayload?.ok && remotePayload?.data) {
        const remoteCanais = Array.isArray(remotePayload.data.canais) ? remotePayload.data.canais : [];
        const remoteVideos = Array.isArray(remotePayload.data.videos) ? remotePayload.data.videos : [];

        syncCanais = mergeById(remoteCanais, state.canais);
        syncVideos = mergeById(remoteVideos, state.videos);

        if (syncCanais.length !== state.canais.length || syncVideos.length !== state.videos.length) {
          state.canais = syncCanais;
          state.videos = syncVideos;
        }
      }
    } catch {
      // segue com dados locais quando não conseguir ler a nuvem
    }
  }

  const payload = {
    action: 'replace_all',
    source,
    allowEmptyOverwrite: false,
    allowDestructiveSync,
    generatedAt: new Date().toISOString(),
    data: {
      canais: syncCanais,
      videos: syncVideos
    }
  };

  try {
    const response = await fetch(SHEETS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Falha de sincronização');
    }

    state.syncMessage = `Planilha: sincronizado em ${new Date().toLocaleTimeString('pt-BR')}`;
  } catch (error) {
    state.syncMessage = `Planilha: falha ao sincronizar (${error.message})`;
  } finally {
    state.allowDestructiveNextSync = false;
    state.isSyncing = false;
    renderSyncStatus();
  }
}

async function loadFromSheets() {
  if (!canSyncSheets()) return false;

  const previousMessage = state.syncMessage;
  const previousVisibility = state.showSyncMessage;

  try {
    const payload = await loadFromSheetsRemote();
    if (!payload.ok || !payload.data) {
      throw new Error(payload.error || 'Resposta inválida');
    }

    const incomingCanais = Array.isArray(payload.data.canais) ? payload.data.canais : [];
    const incomingVideos = Array.isArray(payload.data.videos) ? payload.data.videos : [];

    state.canais = incomingCanais.map((canal) => ({
      id: String(canal.id || uid()),
      nome: String(canal.nome || ''),
      url: String(canal.url || ''),
      nicho: String(canal.nicho || ''),
      descricao: String(canal.descricao || ''),
      anotacoes: serializeCanalNotes(parseCanalNotes(canal.anotacoes))
    }));

    state.videos = incomingVideos.map((video) => ({
      id: String(video.id || uid()),
      titulo: String(video.titulo || ''),
      canalId: String(video.canalId || ''),
      dataPublicacao: normalizeDateOnly(video.dataPublicacao),
      status: String(video.status || 'planejado'),
      roteiro: Boolean(video.roteiro),
      gravacao: Boolean(video.gravacao),
      edicao: Boolean(video.edicao),
      thumbnail: Boolean(video.thumbnail),
      publicado: Boolean(video.publicado),
      url: String(video.url || ''),
      notas: String(video.notas || '')
    }));

    state.cloudLoadOk = true;
    state.syncMessage = `Planilha: dados carregados em ${new Date().toLocaleTimeString('pt-BR')}`;
    return true;
  } catch (error) {
    state.syncMessage = `Planilha: falha ao carregar (${error.message}).`;
    state.showSyncMessage = true;
    return false;
  } finally {
    renderSyncStatus();
  }
}

async function loadFromSheetsRemote() {
  const errors = [];

  try {
    return await loadFromSheetsPost();
  } catch (error) {
    errors.push(`POST: ${error.message}`);
  }

  try {
    return await loadFromSheetsGet();
  } catch (error) {
    errors.push(`GET: ${error.message}`);
  }

  try {
    return await loadFromSheetsJsonp();
  } catch (error) {
    errors.push(`JSONP: ${error.message}`);
  }

  throw new Error(errors.join(' | '));
}

function parseSheetsResponse(text, sourceLabel) {
  try {
    const payload = JSON.parse(text);
    if (!payload?.ok) {
      throw new Error(payload?.error || `Falha no ${sourceLabel} export_all`);
    }
    return payload;
  } catch {
    const htmlErrorMatch = text.match(/ReferenceError:[^<\n]+/i);
    if (htmlErrorMatch) {
      throw new Error(htmlErrorMatch[0]);
    }

    if (text.includes('<title>Erro</title>')) {
      throw new Error('Endpoint do Apps Script retornou página de erro HTML');
    }

    throw new Error(`Resposta inválida no ${sourceLabel} export_all`);
  }
}

async function loadFromSheetsPost() {
  const response = await fetch(SHEETS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'export_all' })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return parseSheetsResponse(text, 'POST');
}

async function loadFromSheetsGet() {
  const response = await fetch(`${SHEETS_WEB_APP_URL}?action=export_all&_=${Date.now()}`, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return parseSheetsResponse(text, 'GET');
}

function loadFromSheetsJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = `sheetCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout ao carregar planilha'));
    }, 12000);

    function cleanup() {
      clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Falha de carregamento JSONP'));
    };

    script.src = `${SHEETS_WEB_APP_URL}?action=export_all&callback=${callbackName}&_=${Date.now()}`;
    document.body.appendChild(script);
  });
}

function renderSyncStatus() {
  const statusEl = byId('sync-status');
  const buttonEl = byId('btn-sync');
  if (statusEl) {
    statusEl.textContent = state.syncMessage;
    statusEl.classList.toggle('hide', !state.showSyncMessage || !state.syncMessage);
  }
  if (buttonEl) {
    buttonEl.disabled = state.isSyncing || !canSyncSheets();
    buttonEl.textContent = state.isSyncing ? 'Sincronizando...' : 'Sincronizar Planilha';
  }
}

function uid() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function noteTextToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function parseCanalNotes(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((note) => ({
        id: String(note?.id || uid()),
        text: String(note?.text || '').trim(),
        createdAt: String(note?.createdAt || new Date().toISOString())
      }))
      .filter((note) => note.text);
  }

  const raw = String(value).trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((note) => ({
          id: String(note?.id || uid()),
          text: String(note?.text || '').trim(),
          createdAt: String(note?.createdAt || new Date().toISOString())
        }))
        .filter((note) => note.text);
    }
  } catch {
    return [{ id: uid(), text: raw, createdAt: new Date().toISOString() }];
  }

  return [];
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

    const notes = getCanalNotes(canal);
    notes.forEach((note) => {
      items.push({
        canalId: canal.id,
        canalNome: canal.nome,
        note
      });
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

  const canal = state.canais.find((item) => item.id === canalId);
  if (!canal) return;

  const notes = getCanalNotes(canal);
  const editing = state.anotacaoEditing;

  if (editing?.noteId) {
    const index = notes.findIndex((note) => note.id === editing.noteId);
    if (index >= 0) {
      notes[index] = {
        ...notes[index],
        text,
        createdAt: notes[index].createdAt || new Date().toISOString()
      };
    }
  } else {
    notes.unshift({ id: uid(), text, createdAt: new Date().toISOString() });
  }

  setCanalNotes(canalId, notes);
  saveState();
  state.showAnotacaoForm = false;
  state.anotacaoEditing = null;
  state.showSyncMessage = true;
  state.syncMessage = 'Anotação salva com sucesso.';
  render();
}

function deleteCanalAnotacao(canalId, noteId) {
  const canal = state.canais.find((item) => item.id === canalId);
  if (!canal) return;

  const notes = getCanalNotes(canal).filter((note) => note.id !== noteId);
  setCanalNotes(canalId, notes);
  saveState();
  state.showSyncMessage = true;
  state.syncMessage = `Anotação removida de ${canalNome(canalId)}.`;
  render();
}

function canalNome(canalId) {
  return state.canais.find(c => c.id === canalId)?.nome || 'Canal não encontrado';
}

function progresso(video) {
  const keys = ['roteiro', 'gravacao', 'edicao', 'thumbnail', 'publicado'];
  const done = keys.filter(k => video[k]).length;
  return Math.round((done / keys.length) * 100);
}

function setTab(tab) {
  state.tab = tab;
  render();
}

function filteredVideos() {
  const query = state.search.toLowerCase().trim();

  return state.videos.filter((video) => {
    const canalMatch = !state.selectedCanalId || video.canalId === state.selectedCanalId;
    const videoDate = normalizeDateOnly(video.dataPublicacao);
    const selectedDate = normalizeDateOnly(state.selectedDate);
    const dateMatch = state.ignoreDateFilter || !selectedDate || videoDate === selectedDate;
    const searchMatch =
      !query ||
      video.titulo.toLowerCase().includes(query) ||
      canalNome(video.canalId).toLowerCase().includes(query);

    return canalMatch && dateMatch && searchMatch;
  });
}

function resetCanalForm() {
  byId('canal-nome').value = '';
  byId('canal-url').value = '';
  byId('canal-nicho').value = '';
  byId('canal-descricao').value = '';
  state.editingCanalId = null;
}

function resetVideoForm() {
  byId('video-titulo').value = '';
  byId('video-canal').value = '';
  byId('video-data').value = '';
  byId('video-status').value = 'planejado';
  byId('video-url').value = '';
  byId('video-notas').value = '';
  state.editingVideoId = null;
}

function upsertCanal(e) {
  e.preventDefault();
  const canal = {
    nome: byId('canal-nome').value.trim(),
    url: byId('canal-url').value.trim(),
    nicho: byId('canal-nicho').value.trim(),
    descricao: byId('canal-descricao').value.trim()
  };
  if (!canal.nome) return;

  if (state.editingCanalId) {
    state.canais = state.canais.map(c => c.id === state.editingCanalId ? { ...c, ...canal } : c);
  } else {
    state.canais.push({ id: uid(), ...canal, anotacoes: '[]' });
  }

  state.showCanalForm = false;
  resetCanalForm();
  saveState();
  render();
}

function upsertVideo(e) {
  e.preventDefault();
  const base = {
    titulo: byId('video-titulo').value.trim(),
    canalId: byId('video-canal').value,
    dataPublicacao: normalizeDateOnly(byId('video-data').value),
    status: byId('video-status').value,
    url: byId('video-url').value.trim(),
    notas: byId('video-notas').value.trim()
  };

  if (!base.titulo || !base.canalId) return;

  if (state.editingVideoId) {
    state.videos = state.videos.map(v => v.id === state.editingVideoId ? { ...v, ...base } : v);
  } else {
    state.videos.push({
      id: uid(),
      ...base,
      roteiro: false,
      gravacao: false,
      edicao: false,
      thumbnail: false,
      publicado: false
    });
  }

  state.showVideoForm = false;
  resetVideoForm();
  saveState();
  render();
}

function deleteCanal(id) {
  if (!confirm('Excluir canal e vídeos vinculados?')) return;
  state.canais = state.canais.filter(c => c.id !== id);
  state.videos = state.videos.filter(v => v.canalId !== id);
  state.allowDestructiveNextSync = true;
  saveState();
  render();
}

function deleteVideo(id) {
  if (!confirm('Excluir vídeo?')) return;
  state.videos = state.videos.filter(v => v.id !== id);
  state.allowDestructiveNextSync = true;
  saveState();
  render();
}

function editCanal(id) {
  const canal = state.canais.find(c => c.id === id);
  if (!canal) return;
  state.showCanalForm = true;
  state.editingCanalId = id;
  byId('canal-nome').value = canal.nome || '';
  byId('canal-url').value = canal.url || '';
  byId('canal-nicho').value = canal.nicho || '';
  byId('canal-descricao').value = canal.descricao || '';
  render();
}

function editVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;
  state.showVideoForm = true;
  state.editingVideoId = id;
  byId('video-titulo').value = video.titulo || '';
  byId('video-canal').value = video.canalId || '';
  byId('video-data').value = video.dataPublicacao || '';
  byId('video-status').value = video.status || 'planejado';
  byId('video-url').value = video.url || '';
  byId('video-notas').value = video.notas || '';
  render();
}

function toggleCheck(videoId, field) {
  state.videos = state.videos.map(v => v.id === videoId ? { ...v, [field]: !v[field] } : v);
  saveState();
  render();
}

function htmlCanais() {
  if (!state.canais.length) {
    return '<div class="card empty">Nenhum canal cadastrado.</div>';
  }

  return `<div class="grid">${state.canais.map(c => `
    <div class="card">
      <div class="toolbar">
        <h3>${c.nome}</h3>
        <div class="actions">
          <button class="btn" data-action="edit-canal" data-id="${c.id}">Editar</button>
          <button class="btn" data-action="del-canal" data-id="${c.id}">Excluir</button>
        </div>
      </div>
      ${c.nicho ? `<p><strong>Nicho:</strong> ${c.nicho}</p>` : ''}
      ${c.descricao ? `<p class="muted">${c.descricao}</p>` : ''}
      ${c.url ? `<p><a href="${c.url}" target="_blank" rel="noopener noreferrer">Abrir canal</a></p>` : ''}
      <p class="muted">Vídeos: ${state.videos.filter(v => v.canalId === c.id).length}</p>
    </div>
  `).join('')}</div>`;
}

function saveCanalAnotacoes(canalId) {
  const canal = state.canais.find((item) => item.id === canalId);
  if (!canal) return;
  setCanalNotes(canalId, getCanalNotes(canal));
  saveState();
  state.showSyncMessage = true;
  state.syncMessage = `Anotações salvas para ${canalNome(canalId)}.`;
  renderSyncStatus();
}

function htmlAnotacoes() {
  if (!state.canais.length) {
    return '<div class="card empty">Cadastre um canal para criar anotações.</div>';
  }

  const editing = state.anotacaoEditing;
  const editingCanal = editing?.canalId
    ? state.canais.find((canal) => canal.id === editing.canalId)
    : null;
  const editingNote = editingCanal && editing?.noteId
    ? getCanalNotes(editingCanal).find((note) => note.id === editing.noteId)
    : null;

  const allNotes = getFilteredNotes();
  const defaultCanalId =
    editing?.canalId || state.anotacoesCanalFilterId || state.canais[0]?.id || '';

  return `
    <div class="card" style="margin-bottom:10px;">
      <div class="toolbar" style="margin-bottom:0;">
        <div class="field" style="max-width:360px;">
          <label for="anotacoes-canal-filter">Filtrar anotações por canal</label>
          <select id="anotacoes-canal-filter">
            <option value="">Todos os canais</option>
            ${state.canais
              .slice()
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((canal) => `<option value="${canal.id}">${escapeHtml(canal.nome)}</option>`)
              .join('')}
          </select>
        </div>
        <button class="btn primary" data-action="nova-anotacao">Criar anotação</button>
      </div>
    </div>

    ${state.showAnotacaoForm ? `
      <div class="card">
        <h3 style="margin-bottom:10px;">${editingNote ? 'Editar anotação' : 'Nova anotação'}</h3>
        <div class="field" style="margin-bottom:10px; max-width:360px;">
          <label for="anotacao-canal">Canal</label>
          <select id="anotacao-canal" ${editingNote ? 'disabled' : ''}>
            ${state.canais
              .slice()
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((canal) => `<option value="${canal.id}" ${canal.id === defaultCanalId ? 'selected' : ''}>${escapeHtml(canal.nome)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field" style="margin-bottom:10px;">
          <label for="anotacao-texto">Anotação</label>
          <textarea id="anotacao-texto" rows="4" placeholder="Escreva sua anotação...">${escapeHtml(editingNote?.text || '')}</textarea>
        </div>
        <div class="actions">
          <button class="btn primary" data-action="salvar-anotacao-form">Salvar</button>
          <button class="btn" data-action="cancelar-anotacao-form">Cancelar</button>
        </div>
      </div>
    ` : ''}

    <div class="list">
      <div class="card" style="padding:0; overflow:hidden;">
        <div class="toolbar" style="padding:12px 14px; border-bottom:1px solid var(--border); margin:0;">
          <h3>Lista de anotações</h3>
          <span class="muted">${allNotes.length} item(ns)</span>
        </div>
        <div class="notes-list" style="padding:10px;">
          ${allNotes.length
            ? allNotes.map(({ canalId, canalNome: nomeCanal, note }) => `
              <div class="note-item">
                <div class="toolbar" style="margin-bottom:6px;">
                  <div>
                    <strong>${escapeHtml(nomeCanal)}</strong>
                    <p class="muted" style="margin:2px 0 0 0;">${new Date(note.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  <div class="actions">
                    <button class="btn mini" data-action="editar-anotacao" data-id="${canalId}" data-note-id="${note.id}">Editar</button>
                    <button class="btn mini" data-action="del-anotacao" data-id="${canalId}" data-note-id="${note.id}">Excluir</button>
                  </div>
                </div>
                <p class="muted" style="margin:0; white-space:pre-wrap;">${noteTextToHtml(note.text)}</p>
              </div>
            `).join('')
            : '<p class="muted" style="padding:4px 2px;">Nenhuma anotação para o filtro selecionado.</p>'}
        </div>
      </div>
    </div>
  `;
}

function statusNome(status) {
  if (status === 'em_producao') return 'Em produção';
  if (status === 'pronto') return 'Pronto';
  if (status === 'publicado') return 'Publicado';
  return 'Planejado';
}

function groupVideosByCanal(videos) {
  const grouped = new Map();

  videos.forEach((video) => {
    const canalId = video.canalId || '__sem_canal__';
    if (!grouped.has(canalId)) {
      grouped.set(canalId, {
        canalId,
        canalNome: canalNome(video.canalId),
        videos: []
      });
    }
    grouped.get(canalId).videos.push(video);
  });

  const groups = Array.from(grouped.values());

  groups.forEach((group) => {
    group.videos.sort((a, b) => {
      if (!a.dataPublicacao && !b.dataPublicacao) return a.titulo.localeCompare(b.titulo, 'pt-BR');
      if (!a.dataPublicacao) return 1;
      if (!b.dataPublicacao) return -1;
      return new Date(a.dataPublicacao) - new Date(b.dataPublicacao);
    });
  });

  groups.sort((a, b) => a.canalNome.localeCompare(b.canalNome, 'pt-BR'));
  return groups;
}

function htmlPlanejamento() {
  const data = filteredVideos();
  if (!data.length) {
    return '<div class="card empty">Nenhum vídeo planejado.</div>';
  }

  const backlog = data.filter((video) => video.status === 'planejado' && !video.publicado);
  const producao = data.filter((video) => video.status === 'em_producao' && !video.publicado);
  const pronto = data.filter((video) => video.status === 'pronto' && !video.publicado);
  const publicado = data.filter((video) => video.status === 'publicado' || video.publicado);

  const renderItem = (video) => `
    <div class="kanban-item">
      <h4>${video.titulo}</h4>
      <p class="kanban-meta">${canalNome(video.canalId)}</p>
      <p class="kanban-meta">${formatDateBR(video.dataPublicacao)}</p>
      <div class="progress" style="margin-top:6px;">
        <span style="width:${progresso(video)}%"></span>
      </div>
      <p class="kanban-meta" style="margin-top:6px;">Progresso: ${progresso(video)}%</p>
      <div class="kanban-actions">
        <button class="btn" data-action="edit-video" data-id="${video.id}">Editar</button>
        <button class="btn" data-action="del-video" data-id="${video.id}">Excluir</button>
      </div>
    </div>
  `;

  const renderColumn = (index, title, videos, emptyText) => `
    <div class="kanban-col">
      <div class="kanban-head">
        <span class="kanban-index">${index}</span>
        <span>${title}</span>
      </div>
      <div class="kanban-list">
        ${videos.length ? videos.map(renderItem).join('') : `<p class="kanban-meta">${emptyText}</p>`}
      </div>
    </div>
  `;

  const editingVideo = state.editingVideoId
    ? state.videos.find((video) => video.id === state.editingVideoId)
    : null;

  const checklistSection = editingVideo
    ? `
      <div class="card" style="margin-top:12px;">
        <h3 style="margin-bottom:10px;">CHECKLIST DO VÍDEO EM EDIÇÃO</h3>
        ${htmlChecklistForVideo(editingVideo)}
      </div>
    `
    : '';

  return `
    <div id="kanban-section">
      <div class="kanban-title">KANBAN BOARD</div>
      <div class="kanban-board">
        ${renderColumn(1, 'BACKLOG', backlog, 'Sem vídeos nesta coluna para o filtro atual.')}
        ${renderColumn(2, 'PRODUÇÃO', producao, 'Sem vídeos nesta coluna para o filtro atual.')}
        ${renderColumn(3, 'PRONTO', pronto, 'Sem vídeos nesta coluna para o filtro atual.')}
        ${renderColumn(4, 'PUBLICADO', publicado, 'Sem vídeos nesta coluna para o filtro atual.')}
      </div>
    </div>
    ${checklistSection}
  `;
}

function htmlChecklistContent(data) {
  const items = [
    ['roteiro', 'Roteiro'],
    ['gravacao', 'Gravação'],
    ['edicao', 'Edição'],
    ['thumbnail', 'Thumbnail'],
    ['publicado', 'Publicado']
  ];

  const groups = groupVideosByCanal(data);

  return `<div class="list">${groups.map(group => `
    <div class="card">
      <div class="toolbar" style="margin-bottom:10px;">
        <h3>${group.canalNome}</h3>
        <span class="muted">${group.videos.length} vídeo(s)</span>
      </div>

      <div class="list">
        ${group.videos.map(v => `
          <div class="card" style="border-style:dashed;">
            <div class="toolbar">
              <div>
                <h3>${v.titulo}</h3>
                <p class="muted">Progresso: ${progresso(v)}%</p>
              </div>
            </div>
            ${items.map(([key, label]) => `
              <label class="check-item">
                <input type="checkbox" ${v[key] ? 'checked' : ''} data-action="toggle" data-id="${v.id}" data-field="${key}">
                <span style="${v[key] ? 'text-decoration:line-through; color:#64748b;' : ''}">${label}</span>
              </label>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('')}</div>`;
}

function htmlChecklistForVideo(video) {
  const items = [
    ['roteiro', 'Roteiro'],
    ['gravacao', 'Gravação'],
    ['edicao', 'Edição'],
    ['thumbnail', 'Thumbnail'],
    ['publicado', 'Publicado']
  ];

  return `
    <div class="card">
      <div class="toolbar" style="margin-bottom:10px;">
        <div>
          <h3>${video.titulo}</h3>
          <p class="muted">${canalNome(video.canalId)} • Progresso: ${progresso(video)}%</p>
        </div>
      </div>
      ${items.map(([key, label]) => `
        <label class="check-item">
          <input type="checkbox" ${video[key] ? 'checked' : ''} data-action="toggle" data-id="${video.id}" data-field="${key}">
          <span style="${video[key] ? 'text-decoration:line-through; color:#64748b;' : ''}">${label}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function htmlDashboard() {
  const total = state.videos.length;
  const publicados = state.videos.filter(v => v.publicado).length;
  const emProd = state.videos.filter(v => !v.publicado).length;

  const registros = state.videos
    .filter((video) => !state.registroCanalId || video.canalId === state.registroCanalId)
    .sort((a, b) => {
      if (!a.dataPublicacao && !b.dataPublicacao) return b.id.localeCompare(a.id);
      if (!a.dataPublicacao) return 1;
      if (!b.dataPublicacao) return -1;
      return new Date(b.dataPublicacao) - new Date(a.dataPublicacao);
    });

  return `
    <div class="kpi">
      <div class="card"><p class="muted">Canais</p><strong>${state.canais.length}</strong></div>
      <div class="card"><p class="muted">Vídeos</p><strong>${total}</strong></div>
      <div class="card"><p class="muted">Publicados</p><strong>${publicados}</strong></div>
      <div class="card"><p class="muted">Em produção</p><strong>${emProd}</strong></div>
    </div>
    <div class="card" style="margin-top:12px;">
      <h3>Postagem por canal</h3>
      <div class="list" style="margin-top:8px;">
        ${state.canais.map(c => {
          const videosCanal = state.videos.filter(v => v.canalId === c.id);
          const pub = videosCanal.filter(v => v.publicado).length;
          return `<div><strong>${c.nome}</strong> — ${pub}/${videosCanal.length} publicados</div>`;
        }).join('') || '<p class="muted">Sem canais cadastrados.</p>'}
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="toolbar" style="margin-bottom:10px;">
        <h3>Registros dos canais</h3>
        <div class="field" style="min-width:260px;">
          <label for="registros-canal-filter">Filtrar por canal</label>
          <select id="registros-canal-filter">
            <option value="">Todos os canais</option>
            ${state.canais.map((canal) => `<option value="${canal.id}">${canal.nome}</option>`).join('')}
          </select>
        </div>
      </div>

      ${registros.length ? `
        <div class="list">
          ${registros.map((video) => `
            <div class="card" style="border-style:dashed;">
              <div class="toolbar" style="margin-bottom:6px;">
                <div>
                  <h3>${video.titulo}</h3>
                  <p class="muted">${canalNome(video.canalId)}</p>
                </div>
                <div class="actions" style="align-items:center;">
                  <span class="badge ${video.status}">${statusNome(video.status)}</span>
                  <button class="btn mini" data-action="edit-video" data-id="${video.id}">Editar</button>
                  <button class="btn mini" data-action="del-video" data-id="${video.id}">Excluir</button>
                </div>
              </div>
              <p class="muted">Data: ${formatDateBR(video.dataPublicacao)}</p>
              <p class="muted">Publicado: ${video.publicado ? 'Sim' : 'Não'} • Progresso: ${progresso(video)}%</p>
            </div>
          `).join('')}
        </div>
      ` : '<p class="muted">Nenhum registro para o filtro selecionado.</p>'}
    </div>
  `;
}

function render() {
  const canalFormSnapshot = {
    nome: byId('canal-nome')?.value || '',
    url: byId('canal-url')?.value || '',
    nicho: byId('canal-nicho')?.value || '',
    descricao: byId('canal-descricao')?.value || ''
  };

  const videoFormSnapshot = {
    titulo: byId('video-titulo')?.value || '',
    canalId: byId('video-canal')?.value || '',
    dataPublicacao: byId('video-data')?.value || '',
    status: byId('video-status')?.value || 'planejado',
    url: byId('video-url')?.value || '',
    notas: byId('video-notas')?.value || ''
  };

  const videoCanalEl = byId('video-canal');
  const currentVideoCanalValue = videoCanalEl ? videoCanalEl.value : '';

  byId('total-canais').textContent = state.canais.length;
  byId('total-publicados').textContent = state.videos.filter(v => v.publicado).length;

  byId('tab-canais').classList.toggle('active', state.tab === 'canais');
  byId('tab-anotacoes').classList.toggle('active', state.tab === 'anotacoes');
  byId('tab-planejamento').classList.toggle('active', state.tab === 'planejamento');
  byId('tab-dashboard').classList.toggle('active', state.tab === 'dashboard');

  byId('canal-form-card').classList.toggle('hide', !state.showCanalForm);
  byId('video-form-card').classList.toggle('hide', !state.showVideoForm);

  const searchVisible = state.tab === 'planejamento';
  byId('search-wrap').classList.toggle('hide', !searchVisible);

  byId('btn-novo-canal').classList.toggle('hide', state.tab !== 'canais');
  byId('btn-novo-video').classList.toggle('hide', state.tab !== 'planejamento');
  byId('btn-novo-video').disabled = !state.canais.length;

  if (state.tab === 'canais') byId('content').innerHTML = htmlCanais();
  if (state.tab === 'anotacoes') byId('content').innerHTML = htmlAnotacoes();
  if (state.tab === 'planejamento') byId('content').innerHTML = htmlPlanejamento();
  if (state.tab === 'dashboard') byId('content').innerHTML = htmlDashboard();

  if (state.tab === 'dashboard') {
    const registrosCanalFilterEl = byId('registros-canal-filter');
    if (registrosCanalFilterEl) {
      registrosCanalFilterEl.value = state.registroCanalId;
      registrosCanalFilterEl.onchange = (e) => {
        state.registroCanalId = e.target.value;
        render();
      };
    }
  }

  if (state.tab === 'anotacoes') {
    const anotacoesCanalFilterEl = byId('anotacoes-canal-filter');
    if (anotacoesCanalFilterEl) {
      anotacoesCanalFilterEl.value = state.anotacoesCanalFilterId;
      anotacoesCanalFilterEl.onchange = (e) => {
        state.anotacoesCanalFilterId = e.target.value;
        render();
      };
    }
  }

  const kanbanSection = byId('kanban-section');
  const hideKanbanWhileEditing = state.tab === 'planejamento' && Boolean(state.editingVideoId);
  if (kanbanSection) {
    kanbanSection.classList.toggle('hide', hideKanbanWhileEditing);
  }

  byId('video-canal').innerHTML = `<option value="">Selecione o canal</option>${state.canais
    .map(c => `<option value="${c.id}">${c.nome}</option>`)
    .join('')}`;

  if (state.showCanalForm) {
    const editingCanal = state.editingCanalId
      ? state.canais.find((canal) => canal.id === state.editingCanalId)
      : null;

    byId('canal-nome').value = canalFormSnapshot.nome || editingCanal?.nome || '';
    byId('canal-url').value = canalFormSnapshot.url || editingCanal?.url || '';
    byId('canal-nicho').value = canalFormSnapshot.nicho || editingCanal?.nicho || '';
    byId('canal-descricao').value = canalFormSnapshot.descricao || editingCanal?.descricao || '';
  }

  if (state.showVideoForm) {
    const editingVideo = state.editingVideoId
      ? state.videos.find((video) => video.id === state.editingVideoId)
      : null;

    byId('video-titulo').value = videoFormSnapshot.titulo || editingVideo?.titulo || '';
    byId('video-canal').value =
      videoFormSnapshot.canalId || currentVideoCanalValue || editingVideo?.canalId || '';
    byId('video-data').value = videoFormSnapshot.dataPublicacao || editingVideo?.dataPublicacao || '';
    byId('video-status').value = videoFormSnapshot.status || editingVideo?.status || 'planejado';
    byId('video-url').value = videoFormSnapshot.url || editingVideo?.url || '';
    byId('video-notas').value = videoFormSnapshot.notas || editingVideo?.notas || '';
  }

  byId('filter-canal').innerHTML = `<option value="">Todos os canais</option>${state.canais
    .map(c => `<option value="${c.id}">${c.nome}</option>`)
    .join('')}`;
  byId('filter-canal').value = state.selectedCanalId;
  byId('filter-date').value = state.selectedDate;
  byId('filter-date').disabled = state.ignoreDateFilter;
  byId('filter-all-dates').checked = state.ignoreDateFilter;

  byId('canal-submit').textContent = state.editingCanalId ? 'Salvar Canal' : 'Adicionar Canal';
  byId('video-submit').textContent = state.editingVideoId ? 'Salvar Vídeo' : 'Adicionar Vídeo';
  renderSyncStatus();
}

function bindEvents() {
  byId('tab-canais').onclick = () => setTab('canais');
  byId('tab-anotacoes').onclick = () => setTab('anotacoes');
  byId('tab-planejamento').onclick = () => setTab('planejamento');
  byId('tab-dashboard').onclick = () => setTab('dashboard');

  byId('btn-novo-canal').onclick = () => {
    state.showCanalForm = !state.showCanalForm;
    if (!state.showCanalForm) resetCanalForm();
    render();
  };

  byId('btn-novo-video').onclick = () => {
    state.showVideoForm = !state.showVideoForm;
    if (!state.showVideoForm) resetVideoForm();
    render();
  };

  byId('canal-form').onsubmit = upsertCanal;
  byId('video-form').onsubmit = upsertVideo;

  byId('cancel-canal').onclick = () => {
    state.showCanalForm = false;
    resetCanalForm();
    render();
  };

  byId('cancel-video').onclick = () => {
    state.showVideoForm = false;
    resetVideoForm();
    render();
  };

  byId('search').oninput = (e) => {
    state.search = e.target.value;
    render();
  };

  byId('filter-canal').onchange = (e) => {
    state.selectedCanalId = e.target.value;
    render();
  };

  byId('filter-date').onchange = (e) => {
    state.selectedDate = normalizeDateOnly(e.target.value);
    if (state.selectedDate) {
      state.ignoreDateFilter = false;
      byId('filter-all-dates').checked = false;
    }
    render();
  };

  byId('filter-all-dates').onchange = (e) => {
    state.ignoreDateFilter = e.target.checked;
    if (state.ignoreDateFilter) {
      state.selectedDate = '';
    }
    render();
  };

  byId('btn-sync').onclick = () => {
    if (!canSyncSheets()) {
      state.showSyncMessage = true;
      state.syncMessage = 'Planilha: configure a URL do Apps Script no app.js';
      renderSyncStatus();
      return;
    }
    syncToSheets('manual');
  };

  byId('content').addEventListener('click', (e) => {
    const { action, id, field, noteId } = e.target.dataset;
    if (!action) return;
    if (action === 'edit-canal') return editCanal(id);
    if (action === 'del-canal') return deleteCanal(id);
    if (action === 'save-anotacoes') return saveCanalAnotacoes(id);
    if (action === 'nova-anotacao') return startNewAnotacao();
    if (action === 'editar-anotacao') return startEditAnotacao(id, noteId);
    if (action === 'salvar-anotacao-form') return saveAnotacaoForm();
    if (action === 'cancelar-anotacao-form') return cancelAnotacaoForm();
    if (action === 'del-anotacao') return deleteCanalAnotacao(id, noteId);
    if (action === 'edit-video') return editVideo(id);
    if (action === 'del-video') return deleteVideo(id);
  });

  byId('content').addEventListener('change', (e) => {
    const { action, id, field } = e.target.dataset;
    if (action === 'toggle') toggleCheck(id, field);
  });
}

async function init() {
  state.canais = [];
  state.videos = [];
  if (canSyncSheets()) {
    state.syncMessage = 'Planilha: pronta para sincronizar';
  }
  bindEvents();

  if (canSyncSheets()) {
    await loadFromSheets();
  } else {
    state.showSyncMessage = true;
    state.syncMessage = 'Planilha: URL de sincronização não configurada.';
  }

  render();
}

init();
