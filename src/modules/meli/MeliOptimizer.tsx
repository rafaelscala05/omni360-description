import BarraProximoPasso from '../agent/BarraProximoPasso';
import { MAX_SKUS_CONTEXTO } from '../agent/produtosAgente';
import type { PedidoAlfred } from '../../types/agent';
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, Eye, Loader2, RefreshCw, Search, ShieldCheck, Sparkles, Store,
  Unplug, WandSparkles, X,
} from 'lucide-react';
import {
  connectMeli, disconnectMeli, getActiveMeliJob, getMeliJob, getMeliOperationalMetrics, listMeliListings,
  MAX_BULK_ANALYSES, meliConnection, startMeliBulkAnalysis, startMeliSync,
  type MeliChecklistId, type MeliConnection, type MeliListing, type MeliListingStatus, type MeliOperationalMetrics, type MeliSyncJob,
} from '../../services/meliService';
import ListingPanel from './ListingPanel';
import type { MeliCreditHelpers } from './MeliVideoStudio';

const STATUS_LABEL: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Encerrado' };
const terminalJobs = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const PAGE_SIZE = 25;
// Durante a sync a lista é recarregada conforme os lotes são salvos, mas no
// máximo nesta cadência — cada recarga relê a projeção de todos os anúncios.
const LISTINGS_REFRESH_DURING_SYNC_MS = 10_000;
// Enquanto algum anúncio da página estiver "Em análise", a lista é relida
// nesta cadência para o selo virar a nota quando a análise terminar.
const LISTINGS_REFRESH_DURING_ANALYSIS_MS = 5_000;
const MISSING_BADGE: Partial<Record<MeliChecklistId, string>> = {
  lifestyle_picture: 'Sem foto ambientada',
  video: 'Sem vídeo',
  main_picture: 'Capa sem fundo branco',
  attributes: 'Ficha incompleta',
  description: 'Descrição fraca',
};
const READY_STATUSES = new Set(['awaiting_review', 'partially_approved', 'approved', 'failed']);

function Score({ value, label }: { value?: number | null; label: string }) {
  const score = typeof value === 'number' ? Math.round(value) : null;
  const color = score == null ? 'text-(--ag-text-3)' : score >= 80 ? 'text-(--ag-ok)' : score >= 60 ? 'text-(--ag-warn)' : 'text-(--ag-danger)';
  return <div className="text-right shrink-0">
    <div className={`text-2xl font-black leading-none ${color}`}>{score ?? '—'}</div>
    <div className="text-[10px] text-(--ag-text-3) mt-1 whitespace-nowrap">{label}</div>
  </div>;
}

export default function MeliOptimizer({ credits, abrirItemId, onItemAberto, onPedirAlfred }: {
  credits: MeliCreditHelpers;
  /** "Abrir o anúncio" vindo do Alfred: busca pelo código e abre o painel dele. */
  abrirItemId?: string | null;
  onItemAberto?: () => void;
  /** Com agente: "Pedir ao Alfred" na barra de seleção, levando os anúncios marcados. */
  onPedirAlfred?: (pedido: PedidoAlfred) => void;
}) {
  const [connection, setConnection] = useState<MeliConnection | null>(null);
  const [listings, setListings] = useState<MeliListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<MeliSyncJob | null>(null);
  const [filter, setFilter] = useState<'' | MeliListingStatus | 'ready'>('');
  const [sort, setSort] = useState<'recent' | 'opportunity'>('opportunity');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{ total: number; totalPages: number; counts: Record<string, number> }>({ total: 0, totalPages: 1, counts: {} });
  const [selected, setSelected] = useState<MeliListing | null>(null);
  const abrirRef = useRef<string | null>(null);
  const [metrics, setMetrics] = useState<MeliOperationalMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Seleção para otimização em massa; sobrevive à troca de página e de filtro.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  // Os intervalos de polling guardam o `load` da renderização em que nasceram;
  // o ref garante que toda recarga use o filtro/busca/página atuais.
  const queryRef = useRef({ filter, sort, search: debouncedSearch, page });
  queryRef.current = { filter, sort, search: debouncedSearch, page };
  const lastListingsRefreshRef = useRef(0);

  const listingsRequestRef = useRef(0);
  const loadListings = async () => {
    const query = queryRef.current;
    const requestId = ++listingsRequestRef.current;
    const result = await listMeliListings({
      status: query.filter && query.filter !== 'ready' ? query.filter : undefined,
      ready: query.filter === 'ready',
      sort: query.sort,
      search: query.search || undefined, page: query.page, pageSize: PAGE_SIZE,
    });
    // Trocar filtro e página em sequência dispara duas cargas; só a última vale.
    if (requestId !== listingsRequestRef.current) return;
    lastListingsRefreshRef.current = Date.now();
    setListings(result.listings);
    setPageInfo({ total: result.total, totalPages: result.totalPages, counts: result.counts });
    if (result.page !== query.page) setPage(result.page);
    // O painel aberto mostra a versão mais nova do anúncio (visitas, vídeo, fotos).
    setSelected((current) => current ? result.listings.find((listing) => listing.itemId === current.itemId) || current : current);
    // Pedido do Alfred: a busca pelo código já trouxe o anúncio — abre o painel dele.
    if (abrirRef.current) {
      const alvo = result.listings.find((listing) => listing.itemId === abrirRef.current);
      if (alvo) { setSelected(alvo); abrirRef.current = null; onItemAberto?.(); }
    }
  };

  const load = async () => {
    const next = await meliConnection();
    setConnection(next);
    if (next.connected) {
      const [, metricResult] = await Promise.all([
        loadListings(), getMeliOperationalMetrics().catch(() => null),
      ]);
      if (metricResult) setMetrics(metricResult);
    } else { setListings([]); setMetrics(null); }
    return next;
  };

  useEffect(() => {
    load()
      .then(async (next) => {
        // A sync roda no servidor mesmo com a aba fechada; ao voltar, retoma o acompanhamento.
        if (next.connected) {
          const active = await getActiveMeliJob().catch(() => null);
          if (active) setJob(active);
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao abrir o módulo.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(1); }, [filter, sort, debouncedSearch]);

  // A busca por MLB acha o anúncio em qualquer página e com qualquer filtro.
  useEffect(() => {
    if (!abrirItemId) return;
    abrirRef.current = abrirItemId;
    setFilter('');
    setSearch(abrirItemId);
  }, [abrirItemId]);
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    if (!connection?.connected) return;
    loadListings().catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar anúncios.'));
  }, [filter, sort, debouncedSearch, page]);
  useEffect(() => {
    if (!job || terminalJobs.has(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await getMeliJob(job.id).catch(() => null);
      if (!next) return;
      setJob(next);
      if (terminalJobs.has(next.status)) { await load().catch(() => undefined); return; }
      if (next.processed > 0 && Date.now() - lastListingsRefreshRef.current >= LISTINGS_REFRESH_DURING_SYNC_MS) {
        await loadListings().catch(() => undefined);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  const hasPendingAnalyses = listings.some((listing) => Boolean(listing.analysisInProgress));
  useEffect(() => {
    if (!hasPendingAnalyses) return;
    const timer = window.setInterval(() => { loadListings().catch(() => undefined); }, LISTINGS_REFRESH_DURING_ANALYSIS_MS);
    return () => window.clearInterval(timer);
  }, [hasPendingAnalyses]);

  const pageIds = listings.map((listing) => listing.itemId);
  const allPageChecked = pageIds.length > 0 && pageIds.every((id) => checkedIds.has(id));
  const toggleChecked = (itemId: string) => setCheckedIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });
  const togglePage = () => setCheckedIds((current) => {
    const next = new Set(current);
    if (allPageChecked) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
    return next;
  });
  const bulkAnalyze = async () => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    if (ids.length > MAX_BULK_ANALYSES) { setError(`Selecione no máximo ${MAX_BULK_ANALYSES} anúncios por vez.`); return; }
    setBulkBusy(true); setError(null); setBulkNotice(null);
    try {
      const result = await startMeliBulkAnalysis(ids);
      const inProgress = result.skipped.filter((item) => item.reason === 'in_progress').length;
      const notFound = result.skipped.filter((item) => item.reason === 'not_found').length;
      setBulkNotice([
        `${result.queued.length} anúncio(s) enviados para otimização.`,
        inProgress ? `${inProgress} já estavam em andamento.` : '',
        notFound ? `${notFound} não encontrados — sincronize de novo.` : '',
      ].filter(Boolean).join(' '));
      setCheckedIds(new Set());
      await loadListings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao enviar para otimização.');
    } finally {
      setBulkBusy(false);
    }
  };

  const connect = async () => { setBusy(true); setError(null); try { const result = await connectMeli(); if (!result.ok) throw new Error(result.message || 'A autorização não foi concluída.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao conectar.'); } finally { setBusy(false); } };
  const disconnect = async () => { setBusy(true); setError(null); try { await disconnectMeli(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao desconectar.'); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); setError(null); try { setJob(await startMeliSync(filter && filter !== 'ready' ? [filter] : ['active', 'paused', 'closed'])); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao iniciar sincronização.'); } finally { setBusy(false); } };

  if (loading) return <div className="h-full flex items-center justify-center text-(--ag-text-2)"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Abrindo Agente MELI…</div>;
  const filters: Array<{ value: '' | MeliListingStatus | 'ready'; label: string; count: number }> = [
    { value: '', label: 'Todos', count: pageInfo.counts.all || 0 },
    { value: 'ready', label: 'Prontas para revisar', count: pageInfo.counts.ready || 0 },
    { value: 'active', label: STATUS_LABEL.active, count: pageInfo.counts.active || 0 },
    { value: 'paused', label: STATUS_LABEL.paused, count: pageInfo.counts.paused || 0 },
    { value: 'closed', label: STATUS_LABEL.closed, count: pageInfo.counts.closed || 0 },
  ];
  return <div className="max-w-6xl mx-auto space-y-5 animate-in fade-in">
    <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl bg-[#FFE600] flex items-center justify-center shadow-sm shrink-0"><Store className="w-5 h-5 text-slate-900" /></div><div><h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight text-[var(--ag-text)]">Agente MELI</h1><p className="text-sm text-(--ag-text-2) mt-0.5">A IA melhora seus anúncios — ficha técnica, textos, fotos — e você só aprova.</p></div></div>
      {connection?.connected && <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1.5 text-xs text-(--ag-ok) bg-(--ag-ok-soft) border border-(--ag-ok-line) rounded-full px-3 py-2"><Check className="w-3.5 h-3.5" /> Seller {connection.sellerId} · {connection.siteId}</span><button onClick={disconnect} disabled={busy} className="inline-flex items-center gap-1.5 text-xs text-(--ag-text-2) hover:text-(--ag-danger) px-2 py-2 disabled:opacity-50"><Unplug className="w-3.5 h-3.5" /> Desconectar</button></div>}
    </header>
    {error && <div className="flex items-start gap-2 text-sm text-(--ag-danger) bg-(--ag-danger-soft) border border-(--ag-danger-line) rounded-xl px-4 py-3"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
    {!connection?.configured ? <section className="bg-(--ag-surface-solid) border border-(--ag-warn-line) rounded-[24px] p-6 shadow-sm"><h2 className="font-bold text-(--ag-text)">Configuração do servidor pendente</h2><p className="text-sm text-(--ag-text-2) mt-2 max-w-3xl">Configure o App ID, Secret Key, redirect URI e a chave de criptografia nos secrets do ambiente.</p></section>
      : !connection.connected ? <section className="bg-(--ag-surface-solid) border border-(--ag-hairline) rounded-[24px] p-7 shadow-sm"><ShieldCheck className="w-8 h-8 text-(--ag-blue) mb-3" /><h2 className="text-lg font-bold text-(--ag-text)">Conecte a conta principal do vendedor</h2><p className="text-sm text-(--ag-text-2) mt-2">Os tokens ficam cifrados no backend e nunca são devolvidos para o navegador.</p><button onClick={connect} disabled={busy} className="mt-5 inline-flex items-center gap-2 bg-(--ag-blue) hover:brightness-95 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Conectar Mercado Livre</button></section>
        : <>
          <section className="bg-(--ag-surface-solid) border border-(--ag-hairline) rounded-[24px] p-4 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="relative flex-1 max-w-lg"><Search className="w-4 h-4 text-(--ag-text-3) absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título ou MLB…" className="w-full border border-(--ag-hairline) bg-(--ag-fill) rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-(--ag-blue)" /></div>
              <div className="flex items-center gap-2">
                <select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'opportunity')} className="border border-(--ag-hairline) bg-(--ag-surface-solid) rounded-xl px-3 py-2 text-sm text-(--ag-text)" aria-label="Ordenar">
                  <option value="opportunity">Maior oportunidade</option>
                  <option value="recent">Atualizados recentemente</option>
                </select>
                <button onClick={sync} disabled={busy || Boolean(job && !terminalJobs.has(job.status))} className="inline-flex justify-center items-center gap-2 bg-[#FFE600] hover:brightness-95 text-slate-900 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50">{job && !terminalJobs.has(job.status) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar</button>
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">{filters.map((entry) => <button key={entry.value || 'all'} onClick={() => setFilter(entry.value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap ${filter === entry.value ? 'bg-(--ag-text) border-(--ag-text) text-(--ag-surface-solid)' : entry.value === 'ready' && entry.count ? 'bg-(--ag-ok-soft) border-(--ag-ok-line) text-(--ag-ok)' : 'bg-(--ag-surface-solid) border-(--ag-hairline) text-(--ag-text-2)'}`}>{entry.label} ({entry.count})</button>)}{connection.lastSyncedAt && <span className="ml-auto text-[11px] text-(--ag-text-3) whitespace-nowrap">Última sync: {new Date(connection.lastSyncedAt).toLocaleString('pt-BR')}</span>}</div>
            {sort === 'opportunity' && <p className="text-[11px] text-(--ag-text-3)">Primeiro os anúncios com mais visitas e mais espaço para melhorar — onde uma melhoria rende mais vendas.</p>}
            {job && <div className={`rounded-xl border p-3 ${job.status === 'failed' ? 'bg-(--ag-danger-soft) border-(--ag-danger-line)' : 'bg-(--ag-blue-soft) border-(--ag-blue-line)'}`}><div className="flex justify-between text-xs font-semibold text-(--ag-text)"><span>{job.lastStep}</span><span>{job.progress}%</span></div><div className="h-1.5 bg-(--ag-surface-solid) rounded-full overflow-hidden mt-2"><div className="h-full bg-(--ag-blue) rounded-full transition-all" style={{ width: `${job.progress}%` }} /></div>{!terminalJobs.has(job.status) && <p className="text-[11px] text-(--ag-text-2) mt-2">Os anúncios são salvos em lotes e já aparecem na lista. A importação continua no servidor mesmo se você fechar esta página.</p>}{job.status === 'partial' && Boolean(job.failedItemIds?.length) && <p className="text-[11px] text-(--ag-warn) mt-2">Sem sucesso: {job.failedItemIds!.slice(0, 10).join(', ')}{job.failedItemIds!.length > 10 ? '…' : ''}</p>}{job.error && !terminalJobs.has(job.status) && <p className="text-[11px] text-(--ag-warn) mt-2">{job.error}</p>}</div>}
          </section>
          {listings.length > 0 && <div className="flex flex-wrap items-center gap-3 bg-(--ag-surface-solid) border border-(--ag-hairline) rounded-2xl px-4 py-2.5 shadow-sm"><label className="inline-flex items-center gap-2 text-xs font-semibold text-(--ag-text) cursor-pointer"><input type="checkbox" checked={allPageChecked} onChange={togglePage} className="w-4 h-4 accent-(--ag-blue)" /> Selecionar página</label>{checkedIds.size > 0 && <span className="text-xs text-(--ag-text-2)">{checkedIds.size} selecionado(s){checkedIds.size > MAX_BULK_ANALYSES ? ` · máximo ${MAX_BULK_ANALYSES} por vez` : ''}</span>}{checkedIds.size > 0 && <button onClick={() => setCheckedIds(new Set())} className="text-xs font-semibold text-(--ag-text-2) hover:text-(--ag-text)">Limpar seleção</button>}<button onClick={bulkAnalyze} disabled={bulkBusy || checkedIds.size === 0 || checkedIds.size > MAX_BULK_ANALYSES} className="ml-auto inline-flex items-center gap-2 bg-(--ag-text) hover:opacity-90 text-(--ag-surface-solid) text-xs font-bold px-3 py-2 rounded-xl disabled:opacity-40">{bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Otimizar selecionados{checkedIds.size ? ` (${checkedIds.size})` : ''}</button></div>}
          {bulkNotice && <div className="flex items-start gap-2 text-xs text-(--ag-blue) bg-(--ag-blue-soft) border border-(--ag-blue-line) rounded-xl px-4 py-2.5"><Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span className="flex-1">{bulkNotice} Cada anúncio fica com as melhorias prontas em “Prontas para revisar” ao terminar.</span><button onClick={() => setBulkNotice(null)} aria-label="Fechar aviso"><X className="w-3.5 h-3.5" /></button></div>}
          <section className="space-y-2">{listings.length === 0 ? <div className="bg-(--ag-surface-solid) border border-dashed border-(--ag-hairline-2) rounded-2xl py-14 text-center text-sm text-(--ag-text-2)">{filter === 'ready' ? 'Nenhum anúncio com melhorias esperando revisão. Otimize alguns anúncios para vê-los aqui.' : 'Nenhum anúncio sincronizado neste filtro.'}</div> : listings.map((listing) => {
            const ready = listing.proposalSummary && READY_STATUSES.has(listing.proposalSummary.status);
            const missing = (listing.analysisSummary?.missingChecklist || []).map((id) => MISSING_BADGE[id]).filter(Boolean) as string[];
            if (!listing.analysisSummary && listing.videoId === null) missing.push('Sem vídeo');
            return <div key={listing.itemId} className="flex items-center gap-3"><input type="checkbox" checked={checkedIds.has(listing.itemId)} onChange={() => toggleChecked(listing.itemId)} aria-label={`Selecionar ${listing.itemId}`} className="w-4 h-4 accent-(--ag-blue) shrink-0 cursor-pointer" /><button onClick={() => setSelected(listing)} className="flex-1 min-w-0 text-left bg-(--ag-surface-solid) border border-(--ag-hairline) hover:border-(--ag-blue-line) rounded-2xl p-4 shadow-sm transition-colors flex items-center gap-4"><div className="w-16 h-16 rounded-xl bg-(--ag-fill-2) overflow-hidden shrink-0">{listing.thumbnail && <img src={listing.thumbnail} alt="" className="w-full h-full object-contain" />}</div><div className="min-w-0 flex-1"><div className="flex gap-2 items-center flex-wrap"><span className="text-[10px] font-bold uppercase text-(--ag-text-3)">{listing.itemId}</span><span className="text-[10px] font-semibold text-(--ag-text-2) bg-(--ag-fill-2) rounded px-1.5 py-0.5">{STATUS_LABEL[listing.status] || listing.status}</span>{listing.analysisInProgress ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-(--ag-blue) bg-(--ag-blue-soft) border border-(--ag-blue-line) rounded px-1.5 py-0.5"><Loader2 className="w-3 h-3 animate-spin" /> Otimizando</span> : ready && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-(--ag-ok) bg-(--ag-ok-soft) border border-(--ag-ok-line) rounded px-1.5 py-0.5"><WandSparkles className="w-3 h-3" /> {listing.proposalSummary!.changeCount} melhoria(s) pronta(s)</span>}</div><h3 className="text-sm font-bold text-(--ag-text) truncate mt-1">{listing.title}</h3><div className="flex items-center gap-1.5 mt-1.5 flex-wrap">{listing.visits30d != null && <span className="inline-flex items-center gap-1 text-[11px] text-(--ag-text-2)"><Eye className="w-3 h-3" /> {listing.visits30d.toLocaleString('pt-BR')} visitas/30d</span>}{missing.slice(0, 3).map((label) => <span key={label} className="text-[10px] text-(--ag-warn) bg-(--ag-warn-soft) border border-(--ag-warn-line) rounded-full px-2 py-0.5">{label}</span>)}</div></div><div className="flex items-center gap-5"><Score value={listing.performance?.score} label="Mercado Livre" /><Score value={listing.analysisSummary?.alfredsScore} label="Alfreds" /></div><ChevronRight className="w-4 h-4 text-(--ag-text-3) shrink-0" /></button></div>;
          })}</section>
          {pageInfo.total > 0 && <nav className="flex items-center justify-between gap-3 text-xs text-(--ag-text-2)"><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, pageInfo.total)} de {pageInfo.total} anúncios</span><div className="flex items-center gap-2"><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} className="inline-flex items-center gap-1 border border-(--ag-hairline) bg-(--ag-surface-solid) rounded-lg px-3 py-1.5 font-semibold text-(--ag-text) disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /> Anterior</button><span className="font-semibold text-(--ag-text) whitespace-nowrap">Página {page} de {pageInfo.totalPages}</span><button onClick={() => setPage((current) => Math.min(pageInfo.totalPages, current + 1))} disabled={page >= pageInfo.totalPages} className="inline-flex items-center gap-1 border border-(--ag-hairline) bg-(--ag-surface-solid) rounded-lg px-3 py-1.5 font-semibold text-(--ag-text) disabled:opacity-40">Próxima <ChevronRight className="w-3.5 h-3.5" /></button></div></nav>}
          {metrics && <details className="bg-(--ag-surface-solid) border border-(--ag-hairline) rounded-2xl"><summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-(--ag-text-2)">Painel operacional</summary><div className="grid grid-cols-2 md:grid-cols-6 gap-2 px-4 pb-4">{([['Anúncios', metrics.listings.total], ['Análises concluídas', metrics.analyses.byStatus.completed || 0], ['Propostas', metrics.proposals.total], ['Publicações', metrics.mutations.total], ['Webhooks', metrics.webhooks.total], ['API hoje · 429', `${metrics.apiToday.calls} · ${metrics.apiToday.rateLimited}`]] as const).map(([label, value]) => <div key={label} className="border rounded-xl p-3"><p className="text-[10px] text-(--ag-text-3)">{label}</p><p className="text-lg font-black">{value}</p></div>)}</div></details>}
        </>}
    {/* F2: a mesma barra "Próximo passo · N selecionados" das telas de agente. */}
    {checkedIds.size > 0 && (
      <BarraProximoPasso
        escopo
        className="sticky bottom-0 mt-4 z-10 rounded-[22px] overflow-hidden"
        n={checkedIds.size}
        acao={{
          rotulo: `Otimizar ${checkedIds.size === 1 ? '1 anúncio' : `${checkedIds.size} anúncios`}`,
          detalhe: checkedIds.size > MAX_BULK_ANALYSES ? `máximo ${MAX_BULK_ANALYSES} por vez` : undefined,
          onClick: bulkAnalyze,
          desabilitada: bulkBusy || checkedIds.size > MAX_BULK_ANALYSES,
          ocupada: bulkBusy,
        }}
        onPedirAlfred={onPedirAlfred ? () => onPedirAlfred(pedidoDosAnuncios([...checkedIds])) : undefined}
      />
    )}
    {selected && <ListingPanel listing={selected} connection={connection} credits={credits} onClose={() => setSelected(null)} onChanged={() => { loadListings().catch(() => undefined); }} />}
  </div>;
}

/** "Pedir ao Alfred" com os anúncios marcados — o grafo os recebe no contexto da tela. */
export function pedidoDosAnuncios(ids: string[]): PedidoAlfred {
  const anuncios = ids.slice(0, MAX_SKUS_CONTEXTO);
  return {
    texto: ids.length === 1
      ? `Sobre o anúncio ${ids[0]}: tem proposta de melhoria pronta? O que ela muda?`
      : `Destes ${ids.length} anúncios selecionados, quais têm proposta de melhoria pronta e o que cada uma muda?`,
    contexto: { tela: 'meli', anuncios, totalSelecionados: ids.length },
  };
}
