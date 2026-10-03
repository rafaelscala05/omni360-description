import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, MoveRight, RefreshCw, TrendingUp, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import type { ContentCluster, CalendarArticle, SearchIntent, ArticleStatus, ClusterKeyword, KeywordOrigin } from './types';
import { moveArticle, updateClusterKeywords } from '../../services/contentService';

export const INTENT_META: Record<SearchIntent, { label: string; chip: string; dot: string }> = {
  informacional: { label: 'Informacional', chip: 'bg-(--ag-accent-soft) text-(--ag-accent) border-(--ag-accent-line)', dot: 'bg-(--ag-accent)' },
  comercial:     { label: 'Comercial',     chip: 'bg-(--ag-warn-soft) text-(--ag-warn) border-(--ag-warn-line)', dot: 'bg-(--ag-warn)' },
  transacional:  { label: 'Transacional',  chip: 'bg-(--ag-ok-soft) text-(--ag-ok) border-(--ag-ok-line)', dot: 'bg-(--ag-ok)' },
  navegacional:  { label: 'Navegacional',  chip: 'bg-(--ag-violet-soft) text-(--ag-violet) border-(--ag-violet-line)', dot: 'bg-(--ag-violet)' },
};

// Origem do dado (SE Ranking Data API) — dá contexto sobre por que a
// palavra-chave foi sugerida (já rankeada, lacuna vs. concorrente, expansão...).
const ORIGIN_META: Record<KeywordOrigin, { label: string; chip: string }> = {
  dominio:     { label: 'Já rankeado',        chip: 'bg-(--ag-ok-soft) text-(--ag-ok) border-(--ag-ok-line)' },
  lacuna:      { label: 'Lacuna vs. concorrente', chip: 'bg-(--ag-blue-soft) text-(--ag-blue) border-(--ag-blue-line)' },
  relacionada: { label: 'Relacionada',        chip: 'bg-(--ag-fill) text-(--ag-text-2) border-(--ag-hairline)' },
  similar:     { label: 'Similar',            chip: 'bg-(--ag-fill) text-(--ag-text-2) border-(--ag-hairline)' },
  longtail:    { label: 'Long-tail',          chip: 'bg-(--ag-fill) text-(--ag-text-2) border-(--ag-hairline)' },
  ia:          { label: 'Sugestão IA',        chip: 'bg-(--ag-fill) text-(--ag-text-2) border-(--ag-hairline)' },
};

function difficultyColor(d: number): string {
  if (d < 30) return 'text-(--ag-ok)';
  if (d < 60) return 'text-(--ag-warn)';
  return 'text-(--ag-danger)';
}

const STATUS_STYLE: Record<ArticleStatus, string> = {
  agendado:    'bg-(--ag-fill-2) text-(--ag-text-2)',
  em_producao: 'bg-(--ag-warn-soft) text-(--ag-warn)',
  revisao:     'bg-(--ag-accent-soft) text-(--ag-accent)',
  aprovado:    'bg-(--ag-ok-soft) text-(--ag-ok)',
  publicado:   'bg-(--ag-accent) text-white',
  erro:        'bg-(--ag-danger-soft) text-(--ag-danger)',
};

const STATUS_LABEL: Record<ArticleStatus, string> = {
  agendado:    'Agendado',
  em_producao: 'Em produção',
  revisao:     'Revisão',
  aprovado:    'Aprovado',
  publicado:   'Publicado',
  erro:        'Erro',
};

const INTENTS: SearchIntent[] = ['informacional', 'comercial', 'transacional', 'navegacional'];

const BLANK_KW: ClusterKeyword = { termo: '', intencao: 'informacional' };

interface Props {
  uid: string;
  projectId: string;
  cluster: ContentCluster;
  articles: CalendarArticle[];
  allClusters: ContentCluster[];
  onBack: () => void;
  onGoArticle: (id: string) => void;
}

const ClusterDetailView: React.FC<Props> = ({ uid, projectId, cluster, articles, allClusters, onBack, onGoArticle }) => {
  const [movingArticleId, setMovingArticleId] = useState<string | null>(null);
  const [movingTargetClusterId, setMovingTargetClusterId] = useState('');
  const [movingBusy, setMovingBusy] = useState(false);

  // Keyword editing state
  const [editingKwIndex, setEditingKwIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ClusterKeyword>(BLANK_KW);
  const [addingKw, setAddingKw] = useState(false);
  const [newKw, setNewKw] = useState<ClusterKeyword>(BLANK_KW);
  const [kwSaving, setKwSaving] = useState(false);

  const kws = cluster.palavrasChave ?? [];
  const availableClusters = allClusters.filter((c) => c.id !== cluster.id && !c.excluido);
  const totalReach = kws.reduce((sum, k) => sum + (k.volume || 0), 0);

  const confirmMove = async () => {
    if (!movingArticleId || !movingTargetClusterId) return;
    setMovingBusy(true);
    try {
      await moveArticle(uid, projectId, movingArticleId, movingTargetClusterId);
    } finally {
      setMovingBusy(false);
      setMovingArticleId(null);
      setMovingTargetClusterId('');
    }
  };

  const saveKwEdit = async () => {
    if (!editDraft.termo.trim() || editingKwIndex === null) return;
    const updated = kws.map((k, i) =>
      i === editingKwIndex ? { ...editDraft, termo: editDraft.termo.trim() } : k,
    );
    setKwSaving(true);
    try {
      await updateClusterKeywords(uid, projectId, cluster.id, updated);
      setEditingKwIndex(null);
    } finally {
      setKwSaving(false);
    }
  };

  const deleteKw = async (index: number) => {
    const updated = kws.filter((_, i) => i !== index);
    setKwSaving(true);
    try {
      await updateClusterKeywords(uid, projectId, cluster.id, updated);
    } finally {
      setKwSaving(false);
    }
  };

  const saveNewKw = async () => {
    if (!newKw.termo.trim()) return;
    const kw: ClusterKeyword = {
      termo: newKw.termo.trim(),
      intencao: newKw.intencao,
      ...(newKw.volume != null && newKw.volume > 0 ? { volume: newKw.volume } : {}),
    };
    const updated = [...kws, kw];
    setKwSaving(true);
    try {
      await updateClusterKeywords(uid, projectId, cluster.id, updated);
      setAddingKw(false);
      setNewKw(BLANK_KW);
    } finally {
      setKwSaving(false);
    }
  };

  const startEdit = (kw: ClusterKeyword, index: number) => {
    setEditingKwIndex(index);
    setEditDraft({ ...kw });
    setAddingKw(false);
  };

  const cancelEdit = () => { setEditingKwIndex(null); setEditDraft(BLANK_KW); };

  const openAdd = () => { setAddingKw(true); setEditingKwIndex(null); setNewKw(BLANK_KW); };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-(--ag-text-2) hover:text-(--ag-text) mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar aos clusters
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">{cluster.nome}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {totalReach > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-(--ag-ok-soft) text-(--ag-ok) border border-(--ag-ok-line)"
              title="Alcance potencial (soma dos volumes de busca)"
            >
              <TrendingUp className="w-3.5 h-3.5" /> {totalReach.toLocaleString('pt-BR')} buscas/mês
            </span>
          )}
          {cluster.aprovado && <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-(--ag-ok-soft) text-(--ag-ok)">Aprovado</span>}
        </div>
      </div>
      <p className="text-sm text-(--ag-text-2) mb-6">{cluster.estrategia}</p>

      {/* Keywords by intent */}
      <div className="ag-glass rounded-[22px] p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-(--ag-text) flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-(--ag-text-3)" /> Palavras-chave por intenção
          </h2>
        </div>

        {/* Keyword rows, grouped by intent */}
        <div className="space-y-4">
          {INTENTS.map((intent) => {
            const intentKws = kws
              .map((k, i) => ({ k, i }))
              .filter(({ k }) => k.intencao === intent);
            if (!intentKws.length) return null;
            return (
              <div key={intent}>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border mb-2 ${INTENT_META[intent].chip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${INTENT_META[intent].dot}`} />
                  {INTENT_META[intent].label}
                </span>
                <div className="space-y-1.5 ml-1">
                  {intentKws.map(({ k, i }) =>
                    editingKwIndex === i ? (
                      // ── Inline edit form ──────────────────────────────────
                      <div key={i} className="flex flex-wrap items-center gap-2 p-2 bg-(--ag-fill) rounded-lg border border-(--ag-hairline)">
                        <input
                          autoFocus
                          value={editDraft.termo}
                          onChange={(e) => setEditDraft((d) => ({ ...d, termo: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveKwEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          placeholder="Palavra-chave"
                          className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent) w-44"
                        />
                        <select
                          value={editDraft.intencao}
                          onChange={(e) => setEditDraft((d) => ({ ...d, intencao: e.target.value as SearchIntent }))}
                          className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
                        >
                          {INTENTS.map((int) => (
                            <option key={int} value={int}>{INTENT_META[int].label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={editDraft.volume ?? ''}
                            onChange={(e) => setEditDraft((d) => ({
                              ...d,
                              volume: e.target.value ? Number(e.target.value) : undefined,
                            }))}
                            placeholder="Volume/mês"
                            className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent) w-32"
                          />
                          <span className="text-[11px] text-(--ag-text-3)">/mês</span>
                        </div>
                        <button
                          onClick={saveKwEdit}
                          disabled={kwSaving || !editDraft.termo.trim()}
                          className="p-1.5 text-(--ag-ok) hover:bg-(--ag-ok-soft) rounded-lg disabled:opacity-40"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 text-(--ag-text-3) hover:bg-(--ag-fill-2) rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      // ── Read mode: termo + volume, com todos os dados extras
                      // que a SE Ranking retornou nessa palavra-chave abaixo. ──
                      <div key={i} className="flex items-start gap-2 group">
                        <div className="flex-1 min-w-0 rounded-lg border border-(--ag-hairline) bg-(--ag-fill) px-2.5 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-(--ag-text)">{k.termo}</span>
                            <span className="text-[10px] text-(--ag-text-3) shrink-0">
                              {k.volume != null ? `${k.volume.toLocaleString('pt-BR')}/mês` : '—'}
                            </span>
                          </div>
                          {(k.posicao != null || k.trafego != null || k.cpc != null || k.dificuldade != null || k.competicao != null || k.origem) && (
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1">
                              {k.posicao != null && (
                                <span className="text-[10px] font-medium text-(--ag-ok)">Posição #{k.posicao}</span>
                              )}
                              {k.trafego != null && (
                                <span className="text-[10px] text-(--ag-text-3)">{k.trafego.toLocaleString('pt-BR')} tráfego/mês</span>
                              )}
                              {k.cpc != null && (
                                <span className="text-[10px] text-(--ag-text-3)">CPC {k.cpc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              )}
                              {k.dificuldade != null && (
                                <span className={`text-[10px] font-medium ${difficultyColor(k.dificuldade)}`}>Dificuldade {k.dificuldade}</span>
                              )}
                              {k.competicao != null && (
                                <span className="text-[10px] text-(--ag-text-3)">Concorrência {Math.round(k.competicao * 100)}%</span>
                              )}
                              {k.origem && (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ORIGIN_META[k.origem].chip}`}>
                                  {ORIGIN_META[k.origem].label}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-1.5">
                          <button
                            onClick={() => startEdit(k, i)}
                            title="Editar"
                            className="p-1 text-(--ag-text-3) hover:text-(--ag-text) hover:bg-(--ag-fill-2) rounded"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteKw(i)}
                            disabled={kwSaving}
                            title="Excluir"
                            className="p-1 text-(--ag-text-3) hover:text-(--ag-danger) hover:bg-(--ag-danger-soft) rounded disabled:opacity-40"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            );
          })}

          {!kws.length && !addingKw && (
            <p className="text-sm text-(--ag-text-3)">Nenhuma palavra-chave.</p>
          )}
        </div>

        {/* Add keyword form */}
        {addingKw ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 p-3 bg-(--ag-fill) rounded-xl border border-dashed border-(--ag-hairline-2)">
            <input
              autoFocus
              value={newKw.termo}
              onChange={(e) => setNewKw((d) => ({ ...d, termo: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveNewKw(); if (e.key === 'Escape') { setAddingKw(false); setNewKw(BLANK_KW); } }}
              placeholder="Palavra-chave"
              className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent) w-44"
            />
            <select
              value={newKw.intencao}
              onChange={(e) => setNewKw((d) => ({ ...d, intencao: e.target.value as SearchIntent }))}
              className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent)"
            >
              {INTENTS.map((int) => (
                <option key={int} value={int}>{INTENT_META[int].label}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={newKw.volume ?? ''}
                onChange={(e) => setNewKw((d) => ({
                  ...d,
                  volume: e.target.value ? Number(e.target.value) : undefined,
                }))}
                placeholder="Volume/mês"
                className="border border-(--ag-hairline-2) rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-(--ag-accent) w-32"
              />
              <span className="text-[11px] text-(--ag-text-3)">/mês</span>
            </div>
            <button
              onClick={saveNewKw}
              disabled={kwSaving || !newKw.termo.trim()}
              className="px-3 py-1 text-sm font-medium text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-40 rounded-full transition-colors"
            >
              Salvar
            </button>
            <button
              onClick={() => { setAddingKw(false); setNewKw(BLANK_KW); }}
              className="px-3 py-1 text-sm font-medium text-(--ag-text-2) hover:bg-(--ag-fill-2) rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={openAdd}
            className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-(--ag-accent) hover:text-(--ag-accent) hover:bg-(--ag-accent-soft) px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar palavra-chave
          </button>
        )}
      </div>

      {/* Linked articles */}
      <div className="ag-glass rounded-[22px] overflow-hidden">
        <div className="px-5 py-3 border-b border-(--ag-hairline)">
          <h2 className="text-sm font-bold text-(--ag-text) flex items-center gap-2">
            <FileText className="w-4 h-4 text-(--ag-text-3)" /> Artigos vinculados ({articles.length})
          </h2>
        </div>
        {articles.length ? (
          <div className="[&>*+*]:border-t [&>*+*]:border-(--ag-hairline)">
            {articles.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-(--ag-fill) transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-(--ag-text) truncate block">{a.titulo}</span>
                  <span className="text-[11px] text-(--ag-text-3)">KW: {a.kwPrincipal} · {a.scheduledDate}{a.scheduledTime ? ` · ${a.scheduledTime}` : ''}</span>
                </div>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onGoArticle(a.id)}
                    title="Visualizar artigo na Produção"
                    className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-(--ag-fill-2) text-(--ag-text-2) hover:bg-(--ag-fill-2) transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Ver
                  </button>
                  {availableClusters.length > 0 && (
                    <button
                      onClick={() => { setMovingArticleId(a.id); setMovingTargetClusterId(''); }}
                      title="Mover para outro cluster"
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg bg-(--ag-fill-2) text-(--ag-text-2) hover:bg-(--ag-fill-2) transition-colors"
                    >
                      <MoveRight className="w-3.5 h-3.5" /> Mover
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-(--ag-text-3) px-5 py-8 text-center">Nenhum artigo vinculado ainda. Gere o calendário para criar artigos deste tema.</p>
        )}
      </div>

      {/* Move article modal */}
      {movingArticleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-(--ag-scrim) backdrop-blur-sm" onClick={() => setMovingArticleId(null)}>
          <div className="bg-(--ag-surface-solid) rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold text-(--ag-text) mb-4">Mover artigo para outro cluster</h3>
            <select
              value={movingTargetClusterId}
              onChange={(e) => setMovingTargetClusterId(e.target.value)}
              className="w-full border border-(--ag-hairline-2) rounded-lg px-3 py-2 text-sm bg-(--ag-surface-solid) focus:outline-none focus:ring-1 focus:ring-(--ag-accent) mb-4"
            >
              <option value="">Selecionar cluster…</option>
              {availableClusters.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMovingArticleId(null)} className="px-4 py-2 text-sm font-medium text-(--ag-text-2) bg-(--ag-fill-2) hover:bg-(--ag-fill-2) rounded-lg">Cancelar</button>
              <button
                onClick={confirmMove}
                disabled={!movingTargetClusterId || movingBusy}
                className="flex items-center gap-1.5 h-11 px-4 text-[13.5px] font-semibold text-(--ag-surface-solid) bg-(--ag-text) hover:brightness-110 disabled:opacity-60 rounded-full"
              >
                {movingBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoveRight className="w-4 h-4" />} Mover
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ClusterDetailView;
