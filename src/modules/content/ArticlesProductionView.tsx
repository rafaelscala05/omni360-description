import React, { useEffect, useMemo, useRef, useState } from 'react';
import { confirmar } from '../../services/confirmar';
import { Reorder } from 'motion/react';
import {
  CalendarDays, Sparkles, RefreshCw, Play, FileText, Pencil, Check, X, Clock, Plus, GripVertical, Trash2,
} from 'lucide-react';
import type { CalendarArticle, ArticleStatus, ArticleSize, ContentCluster } from './types';
import {
  listenCalendar, generateCalendar, produceArticle, updateArticle, deleteArticle,
  createArticleManual, listProductsForLinking, type LinkableProduct,
  updateArticlesPriority,
} from '../../services/contentService';
import ArticleView from './ArticleView';
import BarraProximoPasso from '../agent/BarraProximoPasso';
import type { PedidoAlfred } from '../../types/agent';
import ArticleSizePicker from './ArticleSizePicker';
import ProductLinkPicker from './ProductLinkPicker';

interface Props {
  uid: string;
  projectId: string;
  clusters: ContentCluster[];
  initialOpenId?: string;
  onGoCluster: (clusterId: string) => void;
  blogEnabled?: boolean;
  /** Com agente: "Pedir ao Alfred" na barra de seleção, levando os artigos marcados. */
  onPedirAlfred?: (pedido: PedidoAlfred) => void;
}

const STATUS_LABEL: Record<ArticleStatus, string> = {
  agendado: 'Agendado',
  em_producao: 'Em produção',
  revisao: 'Revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  erro: 'Erro',
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado: 'bg-(--ag-fill-2) text-(--ag-text-2)',
  em_producao: 'bg-(--ag-warn-soft) text-(--ag-warn)',
  revisao: 'bg-(--ag-accent-soft) text-(--ag-accent)',
  aprovado: 'bg-(--ag-ok-soft) text-(--ag-ok)',
  publicado: 'bg-(--ag-accent) text-white',
  erro: 'bg-(--ag-danger-soft) text-(--ag-danger)',
};

function formatDateTime(date: string, time?: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return time ? `${day} · ${time}` : day;
}

const ArticlesProductionView: React.FC<Props> = ({ uid, projectId, clusters, initialOpenId, onGoCluster, blogEnabled, onPedirAlfred }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [producing, setProducing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(initialOpenId ?? null);
  // Seleção para a barra "Próximo passo · N selecionados" (F2).
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const [produzindoLote, setProduzindoLote] = useState(false);
  const alternarMarcado = (id: string) => setMarcados((m) => {
    const prox = new Set(m);
    if (prox.has(id)) prox.delete(id); else prox.add(id);
    return prox;
  });

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedTime, setReschedTime] = useState('');

  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  const [creatingArticle, setCreatingArticle] = useState(false);
  const [newTitulo, setNewTitulo] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newTamanho, setNewTamanho] = useState<ArticleSize>('medio');
  const [newScheduledDate, setNewScheduledDate] = useState('');
  const [newClusterId, setNewClusterId] = useState('');
  const [newProdutoIds, setNewProdutoIds] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState<LinkableProduct[]>([]);
  const [creatingSaving, setCreatingSaving] = useState(false);
  const [creatingError, setCreatingError] = useState<string | null>(null);

  const didOpenInitial = useRef(false);

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  useEffect(() => {
    if (creatingArticle) {
      listProductsForLinking(uid).then(setAllProducts).catch(() => setAllProducts([]));
    }
  }, [creatingArticle, uid]);

  useEffect(() => {
    if (initialOpenId && !didOpenInitial.current && articles.length) {
      didOpenInitial.current = true;
      setSelected(initialOpenId);
    }
  }, [initialOpenId, articles]);

  // Migração automática (uma vez por projeto): artigos anteriores a esta
  // feature não têm `priority`. Como `articles` já chega ordenado por
  // scheduledDate (query de listenCalendar), atribuímos sequencialmente
  // após o maior priority já existente, preservando a ordem relativa atual.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || !articles.length) return;
    const missing = articles.filter((a) => a.priority === undefined);
    if (missing.length === 0) {
      migratedRef.current = true;
      return;
    }
    migratedRef.current = true;
    const existingPriorities = articles
      .map((a) => a.priority)
      .filter((p): p is number => p !== undefined);
    let next = existingPriorities.length ? Math.max(...existingPriorities) + 1 : 0;
    const updates = missing.map((a) => ({ id: a.id, priority: next++ }));
    updateArticlesPriority(uid, projectId, updates).catch((e) =>
      console.error('Falha ao migrar prioridade dos artigos:', e),
    );
  }, [articles, uid, projectId]);

  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [articles],
  );

  const handleReorder = (newOrder: CalendarArticle[]) => {
    const reindexed = newOrder.map((a, idx) => ({ ...a, priority: idx }));
    setArticles(reindexed);
    const updates = reindexed.map((a) => ({ id: a.id, priority: a.priority as number }));
    updateArticlesPriority(uid, projectId, updates).catch((e) =>
      console.error('Falha ao salvar nova ordem:', e),
    );
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      await generateCalendar(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar calendário');
    } finally {
      setLoading(false);
    }
  };

  const handleProduce = async (articleId: string) => {
    setProducing((p) => ({ ...p, [articleId]: true }));
    setError(null);
    try {
      await produceArticle(projectId, articleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao produzir artigo');
    } finally {
      setProducing((p) => ({ ...p, [articleId]: false }));
    }
  };

  // Só produz o que pode ser produzido (agendado ou com erro), um de cada vez:
  // cada produção roda o pipeline de 5 etapas e debita no servidor.
  const marcadosProduziveis = articles.filter((a) => marcados.has(a.id) && (a.status === 'agendado' || a.status === 'erro'));
  const produzirMarcados = async () => {
    const lista = marcadosProduziveis;
    if (!lista.length) return;
    if (!await confirmar(`Produzir ${lista.length === 1 ? '1 artigo' : `${lista.length} artigos`}? Cada produção debita os créditos dela.`)) return;
    setProduzindoLote(true);
    try {
      for (const a of lista) await handleProduce(a.id);
      setMarcados(new Set());
    } finally {
      setProduzindoLote(false);
    }
  };

  const openReschedule = (a: CalendarArticle) => {
    setReschedulingId(a.id);
    setReschedDate(a.scheduledDate);
    setReschedTime(a.scheduledTime ?? '');
  };

  const confirmReschedule = async () => {
    if (!reschedulingId || !reschedDate) return;
    await updateArticle(uid, projectId, reschedulingId, {
      scheduledDate: reschedDate,
      scheduledTime: reschedTime || undefined,
    });
    setReschedulingId(null);
  };

  const startTitleEdit = (a: CalendarArticle) => {
    setEditingTitleId(a.id);
    setTitleDraft(a.titulo);
  };

  const saveTitleEdit = async () => {
    if (!editingTitleId || !titleDraft.trim()) return;
    await updateArticle(uid, projectId, editingTitleId, { titulo: titleDraft.trim() });
    setEditingTitleId(null);
  };

  const changeSize = (articleId: string, tamanho: ArticleSize) => {
    updateArticle(uid, projectId, articleId, { tamanho });
  };

  const handleDelete = async (a: CalendarArticle) => {
    if (!await confirmar(`Excluir o artigo "${a.titulo}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await deleteArticle(uid, projectId, a.id);
      if (selected === a.id) setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir artigo');
    }
  };

  const approvedClusters = useMemo(() => clusters.filter((c) => c.aprovado && !c.excluido), [clusters]);

  const openCreateArticle = () => {
    setNewTitulo('');
    setNewKw('');
    setNewTamanho('medio');
    setNewScheduledDate(new Date().toISOString().slice(0, 10));
    setNewClusterId('');
    setNewProdutoIds([]);
    setCreatingError(null);
    setCreatingArticle(true);
  };

  const confirmCreateArticle = async () => {
    if (!newTitulo.trim() || !newKw.trim() || !newScheduledDate) {
      setCreatingError('Preencha título, palavra-chave e data.');
      return;
    }
    setCreatingSaving(true);
    setCreatingError(null);
    try {
      const priorities = articles.map((a) => a.priority ?? 0);
      const minPriority = priorities.length ? Math.min(...priorities) : 0;
      await createArticleManual(uid, projectId, {
        titulo: newTitulo.trim(),
        kwPrincipal: newKw.trim(),
        tamanho: newTamanho,
        scheduledDate: newScheduledDate,
        clusterId: newClusterId,
        produtosVinculados: newProdutoIds,
        priority: minPriority - 1,
      });
      setCreatingArticle(false);
    } catch (e) {
      setCreatingError(e instanceof Error ? e.message : 'Erro ao criar artigo');
    } finally {
      setCreatingSaving(false);
    }
  };

  const selectedArticle = articles.find((a) => a.id === selected) ?? null;
  const clusterName = (clusterId: string) => clusters.find((c) => c.id === clusterId)?.nome ?? null;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">Produção de Artigos</h1>
          <p className="text-[13.5px] text-(--ag-text-2)">Artigos agendados. Produza manualmente ou aguarde a automação na data.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreateArticle}
            className="flex items-center gap-2 h-11 px-4 text-[13.5px] font-semibold text-(--ag-text) bg-(--ag-surface-solid) border border-(--ag-hairline) hover:bg-(--ag-fill-2) rounded-full transition-colors"
          >
            <Plus className="w-4 h-4" /> Criar artigo
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 h-11 px-4 text-[13.5px] font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-60 rounded-full transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {articles.length ? 'Regerar calendário' : 'Gerar calendário'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-(--ag-danger) bg-(--ag-danger-soft) border border-(--ag-danger-line) rounded-lg px-3 py-2">{error}</div>}

      {!articles.length && !loading && (
        <div className="text-center py-16 text-(--ag-text-3)">
          <CalendarDays className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">Nenhum artigo agendado. Aprove clusters e gere o calendário.</p>
        </div>
      )}

      <Reorder.Group
        as="div"
        axis="y"
        values={sortedArticles}
        onReorder={handleReorder}
        className="ag-glass rounded-[22px] [&>*+*]:border-t [&>*+*]:border-(--ag-hairline) overflow-hidden"
      >
        {sortedArticles.map((a) => {
          const cName = clusterName(a.clusterId);
          return (
            <Reorder.Item
              key={a.id}
              value={a}
              as="div"
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-(--ag-fill) transition-colors bg-(--ag-surface-solid)"
            >
              <GripVertical className="w-4 h-4 text-(--ag-text-3) cursor-grab active:cursor-grabbing shrink-0" />
              <input
                type="checkbox"
                checked={marcados.has(a.id)}
                onChange={() => alternarMarcado(a.id)}
                aria-label={`Selecionar ${a.titulo}`}
                className="w-4 h-4 accent-(--ag-accent) shrink-0 cursor-pointer"
              />
              <div className="text-xs font-medium text-(--ag-text-2) w-24 shrink-0">
                {formatDateTime(a.scheduledDate, a.scheduledTime)}
              </div>

              <div className="flex-1 min-w-0">
                {editingTitleId === a.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitleId(null); }}
                      className="flex-1 border border-(--ag-hairline-2) rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                    />
                    <button onClick={saveTitleEdit} className="p-0.5 text-(--ag-ok) hover:bg-(--ag-ok-soft) rounded"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingTitleId(null)} className="p-0.5 text-(--ag-text-3) hover:bg-(--ag-fill-2) rounded"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => setSelected(a.id)} className="text-sm font-medium text-(--ag-text) hover:text-(--ag-accent) truncate text-left">
                      {a.titulo}
                    </button>
                    <button
                      onClick={() => startTitleEdit(a)}
                      title="Editar título"
                      className="p-1 text-(--ag-text-3) hover:text-(--ag-accent) hover:bg-(--ag-accent-soft) rounded shrink-0 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-(--ag-text-3)">KW: {a.kwPrincipal}{a.status === 'em_producao' ? ` · etapa ${a.stage}/5` : ''}</span>
                  <ArticleSizePicker value={a.tamanho} onChange={(size) => changeSize(a.id, size)} />
                  {cName && (
                    <button
                      onClick={() => onGoCluster(a.clusterId)}
                      className="text-[11px] font-medium text-(--ag-accent) bg-(--ag-accent-soft) px-1.5 py-0.5 rounded hover:bg-(--ag-accent-line) transition-colors"
                    >
                      {cName}
                    </button>
                  )}
                </div>
              </div>

              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>
                {STATUS_LABEL[a.status]}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openReschedule(a)}
                  title="Reagendar"
                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-(--ag-fill-2) text-(--ag-text-2) hover:bg-(--ag-fill-2) transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                </button>
                {(a.status === 'agendado' || a.status === 'erro') && (
                  <button
                    onClick={() => handleProduce(a.id)}
                    disabled={producing[a.id]}
                    title="Produzir agora"
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-(--ag-fill-2) text-(--ag-text) hover:bg-(--ag-fill-2) disabled:opacity-60 transition-colors"
                  >
                    {producing[a.id] ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Produzir
                  </button>
                )}
                {(a.status === 'revisao' || a.status === 'aprovado' || a.status === 'publicado') && (
                  <button
                    onClick={() => setSelected(a.id)}
                    title="Ver artigo"
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-(--ag-fill-2) text-(--ag-text) hover:bg-(--ag-fill-2) transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" /> Ver
                  </button>
                )}
                <button
                  onClick={() => handleDelete(a)}
                  title="Excluir artigo"
                  className="flex items-center gap-1 text-xs font-medium p-1.5 rounded-lg text-(--ag-text-3) hover:text-(--ag-danger) hover:bg-(--ag-danger-soft) transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      {reschedulingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-(--ag-scrim) backdrop-blur-sm" onClick={() => setReschedulingId(null)}>
          <div className="bg-(--ag-surface-solid) rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-(--ag-text) mb-4">Reagendar artigo</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Data</label>
                <input
                  type="date"
                  value={reschedDate}
                  onChange={(e) => setReschedDate(e.target.value)}
                  className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Horário</label>
                <input
                  type="time"
                  value={reschedTime}
                  onChange={(e) => setReschedTime(e.target.value)}
                  className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setReschedulingId(null)} className="px-4 py-2 text-sm font-medium text-(--ag-text-2) bg-(--ag-fill-2) hover:bg-(--ag-fill-2) rounded-lg">Cancelar</button>
              <button onClick={confirmReschedule} className="px-4 py-2 text-sm font-medium text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 rounded-full">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {creatingArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-(--ag-scrim) backdrop-blur-sm" onClick={() => setCreatingArticle(false)}>
          <div className="bg-(--ag-surface-solid) rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-(--ag-text) mb-4">Criar artigo</h3>
            {creatingError && (
              <div className="mb-3 text-sm text-(--ag-danger) bg-(--ag-danger-soft) border border-(--ag-danger-line) rounded-lg px-3 py-2">{creatingError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Título</label>
                <input
                  autoFocus
                  value={newTitulo}
                  onChange={(e) => setNewTitulo(e.target.value)}
                  className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Palavra-chave principal</label>
                <input
                  value={newKw}
                  onChange={(e) => setNewKw(e.target.value)}
                  className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                />
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-sm font-medium text-(--ag-text) mb-1">Tamanho</label>
                  <ArticleSizePicker value={newTamanho} onChange={setNewTamanho} />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-(--ag-text) mb-1">Data agendada</label>
                  <input
                    type="date"
                    value={newScheduledDate}
                    onChange={(e) => setNewScheduledDate(e.target.value)}
                    className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Cluster</label>
                <select
                  value={newClusterId}
                  onChange={(e) => setNewClusterId(e.target.value)}
                  className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                >
                  <option value="">Nenhum</option>
                  {approvedClusters.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ag-text) mb-1">Produtos vinculados</label>
                <ProductLinkPicker products={allProducts} selectedIds={newProdutoIds} onChange={setNewProdutoIds} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCreatingArticle(false)} className="px-4 py-2 text-sm font-medium text-(--ag-text-2) bg-(--ag-fill-2) hover:bg-(--ag-fill-2) rounded-lg">
                Cancelar
              </button>
              <button
                onClick={confirmCreateArticle}
                disabled={creatingSaving}
                className="flex items-center gap-2 h-11 px-4 text-[13.5px] font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-60 rounded-full"
              >
                {creatingSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} Criar artigo
              </button>
            </div>
          </div>
        </div>
      )}

      {marcados.size > 0 && (
        <BarraProximoPasso
          escopo
          className="sticky bottom-0 mt-4 z-10 rounded-[22px] overflow-hidden"
          n={marcados.size}
          acao={{
            rotulo: marcadosProduziveis.length ? `Produzir ${marcadosProduziveis.length === 1 ? '1 artigo' : `${marcadosProduziveis.length} artigos`}` : 'Nada para produzir',
            detalhe: marcadosProduziveis.length < marcados.size ? `${marcados.size - marcadosProduziveis.length} já produzido(s)` : undefined,
            onClick: produzirMarcados,
            desabilitada: produzindoLote || !marcadosProduziveis.length,
            ocupada: produzindoLote,
          }}
          onPedirAlfred={onPedirAlfred ? () => {
            const lista = articles.filter((a) => marcados.has(a.id));
            onPedirAlfred({
              texto: lista.length === 1
                ? `Sobre o artigo "${lista[0].titulo}": em que pé está e o que falta para publicar?`
                : `Destes ${lista.length} artigos selecionados, em que pé está cada um e o que falta para publicar?`,
              contexto: { tela: 'conteudo', projetoId: projectId, artigos: lista.slice(0, 50).map((a) => ({ id: a.id, titulo: a.titulo })), totalSelecionados: lista.length },
            });
          } : undefined}
        />
      )}

      {selectedArticle && (
        <ArticleView uid={uid} projectId={projectId} article={selectedArticle} onClose={() => setSelected(null)} blogEnabled={blogEnabled} />
      )}
    </div>
  );
};

export default ArticlesProductionView;
