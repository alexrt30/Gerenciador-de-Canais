const SHEET_CANAIS = 'Canais';
const SHEET_VIDEOS = 'Videos';
const SHEET_LOG = 'LogSync';
const SPREADSHEET_ID = '1L7F_Zg1fFM5_p1QqvthpXBkUHh80F-XSx8htz6M8_WI';

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'export_all';
    const callback = e && e.parameter && e.parameter.callback;
    if (action !== 'export_all') {
      return jsonResponse({ ok: false, error: 'Ação inválida' }, 400);
    }

    const payload = buildExportPayload();

    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${JSON.stringify(payload)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'export_all') {
      return jsonResponse(buildExportPayload());
    }

    if (body.action !== 'replace_all') {
      return jsonResponse({ ok: false, error: 'Ação inválida' }, 400);
    }

    const data = body.data || {};
    const canais = Array.isArray(data.canais) ? data.canais : [];
    const videos = Array.isArray(data.videos) ? data.videos : [];
    const allowEmptyOverwrite = Boolean(body.allowEmptyOverwrite);
    const allowDestructiveSync = Boolean(body.allowDestructiveSync);

    const ss = getSpreadsheet();
    const canaisSheet = getOrCreateSheet(ss, SHEET_CANAIS);
    const videosSheet = getOrCreateSheet(ss, SHEET_VIDEOS);
    const logSheet = getOrCreateSheet(ss, SHEET_LOG);

    const incomingIsEmpty = canais.length === 0 && videos.length === 0;
    const currentHasData = hasSheetData(canaisSheet) || hasSheetData(videosSheet);
    const incomingTotal = canais.length + videos.length;
    const currentTotal = getDataCount(canaisSheet) + getDataCount(videosSheet);

    if (incomingIsEmpty && currentHasData && !allowEmptyOverwrite) {
      return jsonResponse({
        ok: false,
        error: 'Sincronização bloqueada para evitar apagamento acidental (payload vazio).'
      }, 409);
    }

    if (incomingTotal < currentTotal && !allowDestructiveSync) {
      return jsonResponse({
        ok: false,
        error: 'Sincronização bloqueada para evitar perda de registros (payload menor que dados atuais).'
      }, 409);
    }

    replaceCanais(canaisSheet, canais);
    replaceVideos(videosSheet, videos);
    appendLog(logSheet, body.source || 'unknown', canais.length, videos.length);

    return jsonResponse({ ok: true, canais: canais.length, videos: videos.length }, 200);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function replaceCanais(sheet, canais) {
  const headers = ['id', 'nome', 'url', 'nicho', 'descricao', 'anotacoes', 'updatedAt'];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (!canais.length) return;

  const now = new Date();
  const rows = canais.map((c) => [
    c.id || '',
    c.nome || '',
    c.url || '',
    c.nicho || '',
    c.descricao || '',
    c.anotacoes || '',
    now
  ]);
  
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function replaceVideos(sheet, videos) {
  const headers = [
    'id',
    'titulo',
    'canalId',
    'dataPublicacao',
    'status',
    'roteiro',
    'gravacao',
    'edicao',
    'thumbnail',
    'publicado',
    'url',
    'notas',
    'updatedAt'
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (!videos.length) return;

  const now = new Date();
  const rows = videos.map((v) => [
    v.id || '',
    v.titulo || '',
    v.canalId || '',
    v.dataPublicacao || '',
    v.status || '',
    Boolean(v.roteiro),
    Boolean(v.gravacao),
    Boolean(v.edicao),
    Boolean(v.thumbnail),
    Boolean(v.publicado),
    v.url || '',
    v.notas || '',
    now
  ]);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function appendLog(sheet, source, canaisTotal, videosTotal) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 4).setValues([['timestamp', 'source', 'canais', 'videos']]);
  }
  sheet.appendRow([new Date(), source, canaisTotal, videosTotal]);
}

function readSheetAsObjects(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol || lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return data
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[String(header)] = row[index];
      });
      return item;
    });
}

function toBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'sim';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function buildExportPayload() {
  const ss = getSpreadsheet();
  const canaisSheet = getOrCreateSheet(ss, SHEET_CANAIS);
  const videosSheet = getOrCreateSheet(ss, SHEET_VIDEOS);

  const canais = readSheetAsObjects(canaisSheet);
  const videos = readSheetAsObjects(videosSheet).map((video) => ({
    ...video,
    roteiro: toBool(video.roteiro),
    gravacao: toBool(video.gravacao),
    edicao: toBool(video.edicao),
    thumbnail: toBool(video.thumbnail),
    publicado: toBool(video.publicado)
  }));

  return {
    ok: true,
    data: { canais, videos },
    generatedAt: new Date().toISOString()
  };
}

function hasSheetData(sheet) {
  return sheet.getLastRow() > 1;
}

function getDataCount(sheet) {
  return Math.max(sheet.getLastRow() - 1, 0);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
