// Copia canais, vídeos e anotações da planilha Google (Apps Script) para o banco D1.
// Só lê a planilha; não altera nada nela.
//
// Uso:
//   API_URL=http://localhost:8789 API_KEY=... node scripts/migrar-planilha.mjs
//   API_URL=https://gerenciador-canais-api.SEU-USUARIO.workers.dev API_KEY=... node scripts/migrar-planilha.mjs
// Opcional: SHEETS_URL=<url do Apps Script> (padrão: a URL antiga usada pelo app)

const SHEETS_URL = process.env.SHEETS_URL ||
  'https://script.google.com/macros/s/AKfycbytjuhth_YUID2xC7pUoeV0v9KivPCQ8n0yQLyFnk5j89usYM4V48Zjk1RppNixlH5mww/exec';
const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || '';

if (!API_URL || !API_KEY) {
  console.error('Defina API_URL e API_KEY. Ex.: API_URL=http://localhost:8789 API_KEY=xxx node scripts/migrar-planilha.mjs');
  process.exit(1);
}

// A planilha devolve datas como instante UTC (meia-noite no fuso da planilha).
// Converte para o dia no fuso de São Paulo.
function dataSP(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

const sheetRes = await fetch(`${SHEETS_URL}?action=export_all&_=${Date.now()}`, { redirect: 'follow' });
const sheet = await sheetRes.json();
if (!sheet?.ok) throw new Error(`Falha ao ler a planilha: ${sheet?.error || sheetRes.status}`);

const canais = (sheet.data.canais || [])
  .filter((c) => String(c.id || '').trim() && String(c.nome || '').trim())
  .map((c) => ({
    id: String(c.id).trim(),
    nome: String(c.nome).trim(),
    url: String(c.url || '').trim(),
    nicho: String(c.nicho || '').trim(),
    descricao: String(c.descricao || '').trim(),
    anotacoes: c.anotacoes || '[]'
  }));

const videos = (sheet.data.videos || [])
  .filter((v) => String(v.id || '').trim() && String(v.titulo || '').trim())
  .map((v) => ({
    id: String(v.id).trim(),
    titulo: String(v.titulo).trim(),
    canalId: String(v.canalId || '').trim(),
    dataPublicacao: dataSP(v.dataPublicacao),
    status: ['planejado', 'em_producao', 'pronto', 'publicado'].includes(v.status) ? v.status : 'planejado',
    roteiro: v.roteiro, gravacao: v.gravacao, edicao: v.edicao,
    thumbnail: v.thumbnail, publicado: v.publicado,
    url: String(v.url || '').trim(),
    notas: String(v.notas || '')
  }));

console.log(`Planilha: ${canais.length} canais, ${videos.length} vídeos.`);

const res = await fetch(`${API_URL}/api/import`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ canais, videos })
});
const out = await res.json();
if (!out.ok) throw new Error(`Falha ao importar: ${out.error || res.status}`);

console.log(`Importado: ${out.canais} canais, ${out.videos} vídeos.`);
if (out.videosIgnorados?.length) {
  console.log(`Vídeos ignorados (canal inexistente): ${out.videosIgnorados.join(', ')}`);
}
