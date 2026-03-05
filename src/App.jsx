import { useState } from 'react';
import {
  Plus,
  Youtube,
  Calendar,
  CheckSquare,
  Trash2,
  Edit2,
  BarChart3,
  Search
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('canais');
  const [canais, setCanais] = useState([]);
  const [videos, setVideos] = useState([]);
  const [showCanalForm, setShowCanalForm] = useState(false);
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [editingCanal, setEditingCanal] = useState(null);
  const [editingVideo, setEditingVideo] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [canalForm, setCanalForm] = useState({
    nome: '',
    url: '',
    nicho: '',
    descricao: ''
  });

  const initialVideoForm = {
    titulo: '',
    canalId: '',
    dataPublicacao: '',
    status: 'planejado',
    roteiro: false,
    gravacao: false,
    edicao: false,
    thumbnail: false,
    publicado: false,
    url: '',
    notas: ''
  };

  const [videoForm, setVideoForm] = useState(initialVideoForm);

  const handleCanalSubmit = (e) => {
    e.preventDefault();

    if (editingCanal) {
      setCanais(
        canais.map((canal) =>
          canal.id === editingCanal.id ? { ...canalForm, id: canal.id } : canal
        )
      );
      setEditingCanal(null);
    } else {
      setCanais([...canais, { ...canalForm, id: Date.now().toString() }]);
    }

    setCanalForm({ nome: '', url: '', nicho: '', descricao: '' });
    setShowCanalForm(false);
  };

  const handleVideoSubmit = (e) => {
    e.preventDefault();

    if (editingVideo) {
      setVideos(
        videos.map((video) =>
          video.id === editingVideo.id ? { ...videoForm, id: video.id } : video
        )
      );
      setEditingVideo(null);
    } else {
      setVideos([...videos, { ...videoForm, id: Date.now().toString() }]);
    }

    setVideoForm(initialVideoForm);
    setShowVideoForm(false);
  };

  const deleteCanal = (id) => {
    if (window.confirm('Tem certeza que deseja excluir este canal?')) {
      setCanais(canais.filter((canal) => canal.id !== id));
      setVideos(videos.filter((video) => video.canalId !== id));
    }
  };

  const deleteVideo = (id) => {
    if (window.confirm('Tem certeza que deseja excluir este vídeo?')) {
      setVideos(videos.filter((video) => video.id !== id));
    }
  };

  const startEditCanal = (canal) => {
    setCanalForm({
      nome: canal.nome,
      url: canal.url,
      nicho: canal.nicho,
      descricao: canal.descricao
    });
    setEditingCanal(canal);
    setShowCanalForm(true);
  };

  const startEditVideo = (video) => {
    setVideoForm(video);
    setEditingVideo(video);
    setShowVideoForm(true);
  };

  const toggleChecklistItem = (videoId, field) => {
    setVideos(
      videos.map((video) =>
        video.id === videoId ? { ...video, [field]: !video[field] } : video
      )
    );
  };

  const calcularProgresso = (video) => {
    const campos = ['roteiro', 'gravacao', 'edicao', 'thumbnail', 'publicado'];
    const concluidos = campos.filter((campo) => video[campo]).length;
    return Math.round((concluidos / campos.length) * 100);
  };

  const videosFiltrados = videos.filter((video) => {
    const nomeCanal = canais.find((canal) => canal.id === video.canalId)?.nome || '';
    return (
      video.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      nomeCanal.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const stats = {
    totalCanais: canais.length,
    totalVideos: videos.length,
    videosPublicados: videos.filter((video) => video.publicado).length,
    videosEmProducao: videos.filter((video) => !video.publicado).length
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-50 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-lg bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Youtube className="h-10 w-10 text-red-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Gerenciador de Canais YouTube</h1>
                <p className="text-gray-600">Organize seus canais, vídeos e cronogramas</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="rounded-lg bg-red-50 p-3">
                <div className="text-2xl font-bold text-red-600">{stats.totalCanais}</div>
                <div className="text-xs text-gray-600">Canais</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="text-2xl font-bold text-green-600">{stats.videosPublicados}</div>
                <div className="text-xs text-gray-600">Publicados</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('canais')}
            className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition ${
              activeTab === 'canais'
                ? 'bg-red-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Youtube className="h-5 w-5" />
            Canais
          </button>
          <button
            onClick={() => setActiveTab('planejamento')}
            className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition ${
              activeTab === 'planejamento'
                ? 'bg-red-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Calendar className="h-5 w-5" />
            Planejamento
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition ${
              activeTab === 'checklist'
                ? 'bg-red-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <CheckSquare className="h-5 w-5" />
            Checklist
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition ${
              activeTab === 'dashboard'
                ? 'bg-red-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <BarChart3 className="h-5 w-5" />
            Dashboard
          </button>
        </div>

        {activeTab === 'canais' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-800">Meus Canais</h2>
              <button
                onClick={() => {
                  setCanalForm({ nome: '', url: '', nicho: '', descricao: '' });
                  setEditingCanal(null);
                  setShowCanalForm(!showCanalForm);
                }}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-700"
              >
                <Plus className="h-5 w-5" />
                Novo Canal
              </button>
            </div>

            {showCanalForm && (
              <div className="mb-6 rounded-lg bg-white p-6 shadow-lg">
                <h3 className="mb-4 text-xl font-bold">
                  {editingCanal ? 'Editar Canal' : 'Adicionar Novo Canal'}
                </h3>
                <form onSubmit={handleCanalSubmit} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Nome do Canal *</label>
                    <input
                      type="text"
                      required
                      value={canalForm.nome}
                      onChange={(e) => setCanalForm({ ...canalForm, nome: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      placeholder="Ex: Meu Canal de Tecnologia"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">URL do Canal</label>
                    <input
                      type="url"
                      value={canalForm.url}
                      onChange={(e) => setCanalForm({ ...canalForm, url: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      placeholder="https://youtube.com/@seucanal"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Nicho</label>
                    <input
                      type="text"
                      value={canalForm.nicho}
                      onChange={(e) => setCanalForm({ ...canalForm, nicho: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      placeholder="Ex: Tecnologia, Educação, Gaming"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Descrição</label>
                    <textarea
                      value={canalForm.descricao}
                      onChange={(e) => setCanalForm({ ...canalForm, descricao: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      rows="3"
                      placeholder="Descreva seu canal..."
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700"
                    >
                      {editingCanal ? 'Salvar Alterações' : 'Adicionar Canal'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCanalForm(false);
                        setEditingCanal(null);
                      }}
                      className="rounded-lg border border-gray-300 px-4 py-2 transition hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {canais.map((canal) => (
                <div key={canal.id} className="rounded-lg bg-white p-5 shadow-lg transition hover:shadow-xl">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Youtube className="h-6 w-6 text-red-600" />
                      <h3 className="text-lg font-bold text-gray-800">{canal.nome}</h3>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEditCanal(canal)} className="text-blue-600 hover:text-blue-800">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => deleteCanal(canal.id)} className="text-red-600 hover:text-red-800">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {canal.nicho && (
                    <span className="mb-2 inline-block rounded-full bg-red-100 px-3 py-1 text-xs text-red-800">
                      {canal.nicho}
                    </span>
                  )}

                  {canal.descricao && <p className="mb-3 text-sm text-gray-600">{canal.descricao}</p>}

                  {canal.url && (
                    <a
                      href={canal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-red-600 hover:underline"
                    >
                      Visitar canal →
                    </a>
                  )}

                  <div className="mt-4 border-t border-gray-200 pt-4">
                    <div className="text-sm text-gray-600">
                      <strong>{videos.filter((video) => video.canalId === canal.id).length}</strong> vídeos cadastrados
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {canais.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-lg">
                <Youtube className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="mb-2 text-xl font-bold text-gray-800">Nenhum canal cadastrado</h3>
                <p className="text-gray-600">Clique em "Novo Canal" para começar</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'planejamento' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-800">Planejamento de Vídeos</h2>
              <button
                onClick={() => {
                  setVideoForm(initialVideoForm);
                  setEditingVideo(null);
                  setShowVideoForm(!showVideoForm);
                }}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={canais.length === 0}
              >
                <Plus className="h-5 w-5" />
                Novo Vídeo
              </button>
            </div>

            {canais.length === 0 && (
              <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-yellow-800">Você precisa cadastrar pelo menos um canal antes de adicionar vídeos.</p>
              </div>
            )}

            {showVideoForm && (
              <div className="mb-6 rounded-lg bg-white p-6 shadow-lg">
                <h3 className="mb-4 text-xl font-bold">
                  {editingVideo ? 'Editar Vídeo' : 'Adicionar Novo Vídeo'}
                </h3>
                <form onSubmit={handleVideoSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Título do Vídeo *</label>
                      <input
                        type="text"
                        required
                        value={videoForm.titulo}
                        onChange={(e) => setVideoForm({ ...videoForm, titulo: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                        placeholder="Ex: Como fazer..."
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Canal *</label>
                      <select
                        required
                        value={videoForm.canalId}
                        onChange={(e) => setVideoForm({ ...videoForm, canalId: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      >
                        <option value="">Selecione um canal</option>
                        {canais.map((canal) => (
                          <option key={canal.id} value={canal.id}>
                            {canal.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Data de Publicação</label>
                      <input
                        type="date"
                        value={videoForm.dataPublicacao}
                        onChange={(e) => setVideoForm({ ...videoForm, dataPublicacao: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Status</label>
                      <select
                        value={videoForm.status}
                        onChange={(e) => setVideoForm({ ...videoForm, status: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      >
                        <option value="planejado">Planejado</option>
                        <option value="em_producao">Em Produção</option>
                        <option value="pronto">Pronto para Publicar</option>
                        <option value="publicado">Publicado</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">URL do Vídeo (se já publicado)</label>
                    <input
                      type="url"
                      value={videoForm.url}
                      onChange={(e) => setVideoForm({ ...videoForm, url: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Notas</label>
                    <textarea
                      value={videoForm.notas}
                      onChange={(e) => setVideoForm({ ...videoForm, notas: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-red-500"
                      rows="3"
                      placeholder="Anotações sobre o vídeo..."
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700"
                    >
                      {editingVideo ? 'Salvar Alterações' : 'Adicionar Vídeo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowVideoForm(false);
                        setEditingVideo(null);
                      }}
                      className="rounded-lg border border-gray-300 px-4 py-2 transition hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar vídeos..."
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="space-y-4">
              {videosFiltrados.map((video) => {
                const canal = canais.find((c) => c.id === video.canalId);
                const progresso = calcularProgresso(video);

                return (
                  <div key={video.id} className="rounded-lg bg-white p-5 shadow-lg">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="mb-1 text-lg font-bold text-gray-800">{video.titulo}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Youtube className="h-4 w-4 text-red-600" />
                          <span>{canal?.nome || 'Canal não encontrado'}</span>
                          {video.dataPublicacao && (
                            <>
                              <span>•</span>
                              <Calendar className="h-4 w-4" />
                              <span>{new Date(video.dataPublicacao).toLocaleDateString('pt-BR')}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => startEditVideo(video)} className="text-blue-600 hover:text-blue-800">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => deleteVideo(video.id)} className="text-red-600 hover:text-red-800">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs ${
                          video.status === 'publicado'
                            ? 'bg-green-100 text-green-800'
                            : video.status === 'pronto'
                            ? 'bg-blue-100 text-blue-800'
                            : video.status === 'em_producao'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {video.status === 'planejado'
                          ? 'Planejado'
                          : video.status === 'em_producao'
                          ? 'Em Produção'
                          : video.status === 'pronto'
                          ? 'Pronto'
                          : 'Publicado'}
                      </span>

                      <div className="h-2 flex-1 rounded-full bg-gray-200">
                        <div className="h-2 rounded-full bg-red-600 transition-all" style={{ width: `${progresso}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-gray-700">{progresso}%</span>
                    </div>

                    {video.notas && <p className="mb-3 text-sm text-gray-600">{video.notas}</p>}

                    {video.url && (
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-sm text-red-600 hover:underline"
                      >
                        Ver vídeo no YouTube →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            {videos.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-lg">
                <Calendar className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="mb-2 text-xl font-bold text-gray-800">Nenhum vídeo planejado</h3>
                <p className="text-gray-600">Comece adicionando seu primeiro vídeo</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'checklist' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-800">Checklist de Produção</h2>
            </div>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar vídeos..."
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="space-y-4">
              {videosFiltrados.map((video) => {
                const canal = canais.find((c) => c.id === video.canalId);
                const progresso = calcularProgresso(video);

                return (
                  <div key={video.id} className="rounded-lg bg-white p-6 shadow-lg">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <h3 className="mb-1 text-lg font-bold text-gray-800">{video.titulo}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Youtube className="h-4 w-4 text-red-600" />
                          <span>{canal?.nome || 'Canal não encontrado'}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-red-600">{progresso}%</div>
                        <div className="text-xs text-gray-600">Concluído</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={video.roteiro}
                          onChange={() => toggleChecklistItem(video.id, 'roteiro')}
                          className="h-5 w-5 rounded text-red-600 focus:ring-red-500"
                        />
                        <span className={`flex-1 ${video.roteiro ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                          Roteiro escrito
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={video.gravacao}
                          onChange={() => toggleChecklistItem(video.id, 'gravacao')}
                          className="h-5 w-5 rounded text-red-600 focus:ring-red-500"
                        />
                        <span className={`flex-1 ${video.gravacao ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                          Gravação finalizada
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={video.edicao}
                          onChange={() => toggleChecklistItem(video.id, 'edicao')}
                          className="h-5 w-5 rounded text-red-600 focus:ring-red-500"
                        />
                        <span className={`flex-1 ${video.edicao ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                          Edição completa
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={video.thumbnail}
                          onChange={() => toggleChecklistItem(video.id, 'thumbnail')}
                          className="h-5 w-5 rounded text-red-600 focus:ring-red-500"
                        />
                        <span className={`flex-1 ${video.thumbnail ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                          Thumbnail criada
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 rounded-lg p-3 transition hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={video.publicado}
                          onChange={() => toggleChecklistItem(video.id, 'publicado')}
                          className="h-5 w-5 rounded text-red-600 focus:ring-red-500"
                        />
                        <span
                          className={`flex-1 font-semibold ${
                            video.publicado ? 'text-gray-500 line-through' : 'text-red-600'
                          }`}
                        >
                          Vídeo publicado
                        </span>
                      </label>
                    </div>

                    {video.publicado && video.url && (
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-red-600 hover:underline"
                        >
                          <CheckSquare className="h-4 w-4" />
                          Ver vídeo publicado →
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {videos.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-lg">
                <CheckSquare className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="mb-2 text-xl font-bold text-gray-800">Nenhum vídeo para acompanhar</h3>
                <p className="text-gray-600">Adicione vídeos na aba Planejamento</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div>
            <h2 className="mb-6 text-2xl font-bold text-gray-800">Dashboard</h2>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-white p-6 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-600">Total de Canais</h3>
                  <Youtube className="h-8 w-8 text-red-600" />
                </div>
                <div className="text-3xl font-bold text-gray-800">{stats.totalCanais}</div>
              </div>

              <div className="rounded-lg bg-white p-6 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-600">Total de Vídeos</h3>
                  <Calendar className="h-8 w-8 text-blue-600" />
                </div>
                <div className="text-3xl font-bold text-gray-800">{stats.totalVideos}</div>
              </div>

              <div className="rounded-lg bg-white p-6 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-600">Publicados</h3>
                  <CheckSquare className="h-8 w-8 text-green-600" />
                </div>
                <div className="text-3xl font-bold text-gray-800">{stats.videosPublicados}</div>
              </div>

              <div className="rounded-lg bg-white p-6 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-600">Em Produção</h3>
                  <BarChart3 className="h-8 w-8 text-yellow-600" />
                </div>
                <div className="text-3xl font-bold text-gray-800">{stats.videosEmProducao}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-lg bg-white p-6 shadow-lg">
                <h3 className="mb-4 text-lg font-bold text-gray-800">Vídeos por Canal</h3>
                <div className="space-y-3">
                  {canais.map((canal) => {
                    const videosDoCanal = videos.filter((video) => video.canalId === canal.id);
                    const publicados = videosDoCanal.filter((video) => video.publicado).length;
                    const width = videosDoCanal.length
                      ? `${(publicados / videosDoCanal.length) * 100}%`
                      : '0%';

                    return (
                      <div key={canal.id} className="border-b border-gray-200 pb-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-semibold text-gray-800">{canal.nome}</span>
                          <span className="text-sm text-gray-600">
                            {publicados}/{videosDoCanal.length} publicados
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-gray-200">
                          <div className="h-2 rounded-full bg-red-600" style={{ width }} />
                        </div>
                      </div>
                    );
                  })}

                  {canais.length === 0 && <p className="py-4 text-center text-gray-500">Nenhum canal cadastrado</p>}
                </div>
              </div>

              <div className="rounded-lg bg-white p-6 shadow-lg">
                <h3 className="mb-4 text-lg font-bold text-gray-800">Próximos Vídeos</h3>
                <div className="space-y-3">
                  {videos
                    .filter((video) => video.dataPublicacao && !video.publicado)
                    .sort((a, b) => new Date(a.dataPublicacao) - new Date(b.dataPublicacao))
                    .slice(0, 5)
                    .map((video) => {
                      const canal = canais.find((c) => c.id === video.canalId);

                      return (
                        <div key={video.id} className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
                          <Calendar className="mt-1 h-5 w-5 text-red-600" />
                          <div className="flex-1">
                            <div className="font-semibold text-gray-800">{video.titulo}</div>
                            <div className="text-sm text-gray-600">{canal?.nome || 'Canal não encontrado'}</div>
                            <div className="mt-1 text-xs text-gray-500">
                              {new Date(video.dataPublicacao).toLocaleDateString('pt-BR')}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  {videos.filter((video) => video.dataPublicacao && !video.publicado).length === 0 && (
                    <p className="py-4 text-center text-gray-500">Nenhum vídeo agendado</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
