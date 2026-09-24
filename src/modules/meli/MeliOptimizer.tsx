import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, ChevronRight, ExternalLink, Image as ImageIcon, Loader2,
  MessageCircleQuestion, RefreshCw, Search, ShieldCheck, Sparkles, Store,
  TriangleAlert, Unplug, WandSparkles, X,
} from 'lucide-react';
import {
  connectMeli, createMeliProposal, decideMeliProposalChange, disconnectMeli,
  getLatestMeliAnalysis, getLatestMeliProposal, getMeliJob, getMeliOperationalMetrics, listMeliListings,
  meliConnection, startMeliAnalysis, startMeliSync, type MeliAnalysis,
  type MeliAnalysisFinding, type MeliConnection, type MeliListing,
  type MeliListingStatus, type MeliOperationalMetrics, type MeliProposalChange, type MeliProposalResult,
  type MeliRiskLevel, type MeliSyncJob,
} from '../../services/meliService';
import ProposalReview from './ProposalReview';

const STATUS_LABEL: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Encerrado' };
const terminalJobs = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const terminalAnalyses = new Set(['completed', 'failed', 'stale']);
const SEVERITY_ORDER = { blocked: 5, high: 4, medium: 3, low: 2, info: 1 } as const;
const SEVERITY_LABEL = { blocked: 'Bloqueador', high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Informação' } as const;
const ACTION_LABEL: Record<string, string> = { keep: 'Manter', reorder: 'Reordenar', remove: 'Remover', replace: 'Substituir', create: 'Criar', needs_review: 'Revisar' };

function qualityMissing(listing: MeliListing): string[] {
  const adoption = listing.catalogQuality?.adoption_status;
  const groups = adoption && typeof adoption === 'object' ? Object.values(adoption) as any[] : [];
  return [...new Set(groups.flatMap((group) => Array.isArray(group?.missing_attributes) ? group.missing_attributes : []))];
}

function Score({ value, label, compact = false }: { value?: number | null; label: string; compact?: boolean }) {
  const score = typeof value === 'number' ? Math.round(value) : null;
  const color = score == null ? 'text-slate-400' : score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return <div className={compact ? 'text-center shrink-0 p-2' : 'text-right shrink-0'}>
    <div className={`${compact ? 'text-lg' : 'text-2xl'} font-black leading-none ${color}`}>{score ?? '—'}</div>
    <div className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">{label}</div>
  </div>;
}

function RiskBadge({ risk }: { risk: MeliRiskLevel }) {
  const style = risk === 'blocked' || risk === 'high' ? 'bg-red-50 text-red-700 border-red-200'
    : risk === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  const label = { low: 'Risco baixo', medium: 'Risco médio', high: 'Risco alto', blocked: 'Bloqueado' }[risk];
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${style}`}>{label}</span>;
}

function Finding({ finding }: { finding: MeliAnalysisFinding }) {
  const style = finding.severity === 'blocked' || finding.severity === 'high' ? 'border-red-200 bg-red-50/60'
    : finding.severity === 'medium' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50';
  return <div className={`border rounded-xl p-3 ${style}`}>
    <div className="flex items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{SEVERITY_LABEL[finding.severity]}</span>
        <span className="text-[10px] text-slate-400 font-mono">{finding.fieldPath}</span>
        {finding.requiresConfirmation && <span className="text-[10px] font-bold text-red-700">Confirmação factual</span>}
      </div><p className="text-sm font-semibold text-slate-800 mt-1">{finding.message}</p>
      {finding.evidence.length > 0 && <p className="text-xs text-slate-500 mt-1.5">Evidência: {finding.evidence.join(' · ')}</p>}</div>
      <span className="text-[10px] text-slate-400 shrink-0">{Math.round(finding.confidence * 100)}%</span>
    </div>
  </div>;
}

function AnalysisResult({ analysis }: { analysis: MeliAnalysis }) {
  const findings = [...analysis.findings].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  const hasSuggestions = Boolean(analysis.suggestions.title || analysis.suggestions.descriptionPlainText
    || analysis.suggestions.attributes.length || analysis.suggestions.saleTerms.length || analysis.suggestions.picturePlan.length);
  return <div className="space-y-5">
    <div className="border border-blue-200 bg-blue-50/60 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3"><p className="text-sm text-slate-700">{analysis.summary}</p><RiskBadge risk={analysis.riskLevel} /></div>
      {analysis.aiStatus === 'failed' && <p className="text-xs text-amber-700 mt-2">A camada de IA não respondeu; os achados determinísticos continuam válidos. {analysis.aiError}</p>}
    </div>
    {analysis.scoreComponents && <div><h3 className="text-sm font-bold text-slate-900 mb-2">Composição do score Alfreds</h3>
      <div className="grid grid-cols-5 border border-slate-200 rounded-xl divide-x overflow-hidden">
        <Score compact value={analysis.scoreComponents.technicalCompleteness} label="Técnica · 35%" />
        <Score compact value={analysis.scoreComponents.consistency} label="Consist. · 20%" />
        <Score compact value={analysis.scoreComponents.title} label="Título · 15%" />
        <Score compact value={analysis.scoreComponents.description} label="Descrição · 15%" />
        <Score compact value={analysis.scoreComponents.images} label="Imagens · 15%" />
      </div></div>}
    <div><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold text-slate-900">Achados da auditoria</h3><span className="text-xs text-slate-400">{findings.length}</span></div>
      <div className="space-y-2">{findings.length ? findings.map((finding, index) => <Finding key={`${finding.code}-${finding.fieldPath}-${index}`} finding={finding} />) : <p className="text-sm text-slate-500">Nenhum problema foi detectado.</p>}</div></div>
    {analysis.questions.length > 0 && <div><h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2"><MessageCircleQuestion className="w-4 h-4 text-violet-600" /> Informações que precisam de você</h3>
      <div className="space-y-2">{analysis.questions.map((question, index) => <div key={`${question.fieldPath}-${index}`} className="border border-violet-200 bg-violet-50/60 rounded-xl p-3"><p className="text-sm font-semibold text-slate-800">{question.question}</p><p className="text-xs text-slate-500 mt-1">{question.reason}</p></div>)}</div></div>}
    {hasSuggestions && <div><div className="flex items-center gap-2 mb-2"><WandSparkles className="w-4 h-4 text-blue-600" /><h3 className="text-sm font-bold text-slate-900">Sugestões candidatas</h3><span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">somente auditoria</span></div>
      <p className="text-xs text-slate-500 mb-3">Ainda não são propostas aprováveis e nunca são publicadas por esta tela.</p><div className="space-y-3">
        {analysis.suggestions.title && <div className="border rounded-xl p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Título sugerido</p><p className="text-sm text-slate-800 mt-1">{analysis.suggestions.title}</p></div>}
        {analysis.suggestions.descriptionPlainText && <div className="border rounded-xl p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Descrição sugerida</p><p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap max-h-64 overflow-y-auto">{analysis.suggestions.descriptionPlainText}</p></div>}
        {(analysis.suggestions.attributes.length > 0 || analysis.suggestions.saleTerms.length > 0) && <div className="border rounded-xl divide-y">{[...analysis.suggestions.attributes, ...analysis.suggestions.saleTerms].map((item) => <div key={`${item.id}-${item.valueName}`} className="p-3"><div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">{item.id}</span><span className="text-slate-900 text-right">{item.valueName}</span></div><p className="text-xs text-slate-500 mt-1">{item.reason}</p></div>)}</div>}
      </div></div>}
    {analysis.imageDiagnostics.length > 0 && <div><h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-blue-600" /> Diagnóstico visual</h3>
      <div className="grid grid-cols-2 gap-3">{analysis.imageDiagnostics.map((image) => <div key={`${image.pictureId}-${image.order}`} className="border border-slate-200 rounded-xl overflow-hidden"><div className="aspect-square bg-slate-100">{image.url && <img src={image.url} alt="" className="w-full h-full object-contain" />}</div><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-700">#{image.order + 1} · {ACTION_LABEL[image.action] || image.action}</span><span className="text-[10px] text-slate-400">{image.width && image.height ? `${image.width}×${image.height}` : 'sem dimensões'}</span></div>{image.issues.map((issue) => <p key={issue} className="text-[11px] text-red-700 mt-1">• {issue}</p>)}{image.strengths.map((strength) => <p key={strength} className="text-[11px] text-emerald-700 mt-1">• {strength}</p>)}</div></div>)}</div></div>}
  </div>;
}

export default function MeliOptimizer() {
  const [connection, setConnection] = useState<MeliConnection | null>(null);
  const [listings, setListings] = useState<MeliListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<MeliSyncJob | null>(null);
  const [filter, setFilter] = useState<'' | MeliListingStatus>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MeliListing | null>(null);
  const [analysis, setAnalysis] = useState<MeliAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [proposalResult, setProposalResult] = useState<MeliProposalResult | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [metrics, setMetrics] = useState<MeliOperationalMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const next = await meliConnection();
    setConnection(next);
    if (next.connected) {
      const [listingResult, metricResult] = await Promise.all([
        listMeliListings(), getMeliOperationalMetrics().catch(() => null),
      ]);
      setListings(listingResult.listings);
      if (metricResult) setMetrics(metricResult);
    } else { setListings([]); setMetrics(null); }
  };

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao abrir o módulo.')).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!job || terminalJobs.has(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await getMeliJob(job.id).catch(() => null);
      if (!next) return;
      setJob(next);
      if (terminalJobs.has(next.status)) await load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  useEffect(() => {
    setAnalysis(null);
    setProposalResult(null);
    if (!selected) return;
    let cancelled = false;
    setAnalysisLoading(true);
    getLatestMeliAnalysis(selected.itemId).then((result) => { if (!cancelled) setAnalysis(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao carregar análise.'); })
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    getLatestMeliProposal(selected.itemId).then((result) => { if (!cancelled) setProposalResult(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao carregar proposta.'); });
    return () => { cancelled = true; };
  }, [selected?.itemId]);
  useEffect(() => {
    if (!selected || !analysis || terminalAnalyses.has(analysis.status)) return;
    const timer = window.setInterval(async () => {
      const next = await getLatestMeliAnalysis(selected.itemId).catch(() => null);
      if (!next || next.id !== analysis.id) return;
      setAnalysis(next);
      if (terminalAnalyses.has(next.status)) await load().catch(() => undefined);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [selected?.itemId, analysis?.id, analysis?.status]);

  const visible = useMemo(() => listings.filter((listing) => {
    if (filter && listing.status !== filter) return false;
    const query = search.trim().toLowerCase();
    return !query || listing.title.toLowerCase().includes(query) || listing.itemId.toLowerCase().includes(query);
  }), [filter, listings, search]);

  const connect = async () => { setBusy(true); setError(null); try { const result = await connectMeli(); if (!result.ok) throw new Error(result.message || 'A autorização não foi concluída.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao conectar.'); } finally { setBusy(false); } };
  const disconnect = async () => { setBusy(true); setError(null); try { await disconnectMeli(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao desconectar.'); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); setError(null); try { setJob(await startMeliSync(filter ? [filter] : ['active', 'paused', 'closed'])); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao iniciar sincronização.'); } finally { setBusy(false); } };
  const analyze = async () => { if (!selected) return; setAnalysisLoading(true); setError(null); setProposalResult(null); try { setAnalysis(await startMeliAnalysis(selected.itemId)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao iniciar auditoria.'); } finally { setAnalysisLoading(false); } };
  const createProposal = async () => {
    if (!selected || !analysis) return;
    setProposalBusy(true); setError(null);
    try { setProposalResult(await createMeliProposal(selected.itemId, analysis.id)); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao criar proposta.'); }
    finally { setProposalBusy(false); }
  };
  const decideChange = async (change: MeliProposalChange, approvalStatus: 'approved' | 'rejected') => {
    if (!proposalResult) return;
    let confirmed = false;
    if (approvalStatus === 'approved' && change.requiresConfirmation) {
      confirmed = window.confirm(`Confirme explicitamente o valor proposto para ${change.fieldPath}. Você verificou este dado em uma fonte confiável?`);
      if (!confirmed) return;
    }
    setProposalBusy(true); setError(null);
    try { setProposalResult(await decideMeliProposalChange(proposalResult.proposal.id, change.id, approvalStatus, confirmed)); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao registrar decisão.'); }
    finally { setProposalBusy(false); }
  };
  const approveLowRisk = async () => {
    if (!proposalResult) return;
    setProposalBusy(true); setError(null);
    try {
      let next = proposalResult;
      for (const change of proposalResult.changes.filter((item) => item.riskLevel === 'low' && item.approvalStatus === 'pending')) {
        next = await decideMeliProposalChange(next.proposal.id, change.id, 'approved', false);
      }
      setProposalResult(next); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha na aprovação em lote.'); }
    finally { setProposalBusy(false); }
  };

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Abrindo Agente MELI…</div>;
  return <div className="max-w-6xl mx-auto space-y-5 animate-in fade-in">
    <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl bg-[#FFE600] flex items-center justify-center shadow-sm shrink-0"><Store className="w-5 h-5 text-slate-900" /></div><div><div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-black text-slate-900">Agente MELI</h1><span className="text-[10px] uppercase tracking-wide font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">Auditoria e revisão</span></div><p className="text-sm text-slate-500 mt-0.5">Diagnóstico, propostas versionadas e aprovação por campo.</p></div></div>
      {connection?.connected && <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-2"><Check className="w-3.5 h-3.5" /> Seller {connection.sellerId} · {connection.siteId}</span><button onClick={disconnect} disabled={busy} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 px-2 py-2 disabled:opacity-50"><Unplug className="w-3.5 h-3.5" /> Desconectar</button></div>}
    </header>
    {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
    {!connection?.configured ? <section className="bg-white border border-amber-200 rounded-2xl p-6 shadow-sm"><h2 className="font-bold text-slate-900">Configuração do servidor pendente</h2><p className="text-sm text-slate-600 mt-2 max-w-3xl">Configure o App ID, Secret Key, redirect URI e a chave de criptografia nos secrets do ambiente.</p></section>
      : !connection.connected ? <section className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm"><ShieldCheck className="w-8 h-8 text-blue-600 mb-3" /><h2 className="text-lg font-bold text-slate-900">Conecte a conta principal do vendedor</h2><p className="text-sm text-slate-600 mt-2">Os tokens ficam cifrados no backend e nunca são devolvidos para o navegador.</p><button onClick={connect} disabled={busy} className="mt-5 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Conectar Mercado Livre</button></section>
        : <>{metrics && <section className="grid grid-cols-2 md:grid-cols-5 gap-2"><div className="bg-white border rounded-xl p-3"><p className="text-[10px] text-slate-400">Anúncios</p><p className="text-lg font-black">{metrics.listings.total}</p></div><div className="bg-white border rounded-xl p-3"><p className="text-[10px] text-slate-400">Análises concluídas</p><p className="text-lg font-black">{metrics.analyses.byStatus.completed || 0}</p></div><div className="bg-white border rounded-xl p-3"><p className="text-[10px] text-slate-400">Propostas</p><p className="text-lg font-black">{metrics.proposals.total}</p></div><div className="bg-white border rounded-xl p-3"><p className="text-[10px] text-slate-400">Webhooks</p><p className="text-lg font-black">{metrics.webhooks.total}</p></div><div className="bg-white border rounded-xl p-3"><p className="text-[10px] text-slate-400">API hoje · 429</p><p className="text-lg font-black">{metrics.apiToday.calls} · <span className={metrics.apiToday.rateLimited ? 'text-red-600' : 'text-emerald-600'}>{metrics.apiToday.rateLimited}</span></p></div></section>}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4"><div className="flex flex-col md:flex-row md:items-center gap-3 justify-between"><div className="relative flex-1 max-w-lg"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título ou MLB…" className="w-full border border-slate-200 bg-slate-50 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-400" /></div><button onClick={sync} disabled={busy || Boolean(job && !terminalJobs.has(job.status))} className="inline-flex justify-center items-center gap-2 bg-[#FFE600] hover:bg-[#f1d900] text-slate-900 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50">{job && !terminalJobs.has(job.status) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar anúncios</button></div><div className="flex items-center gap-2 overflow-x-auto">{(['', 'active', 'paused', 'closed'] as const).map((value) => <button key={value || 'all'} onClick={() => setFilter(value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap ${filter === value ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{value ? STATUS_LABEL[value] : 'Todos'} ({value ? listings.filter((item) => item.status === value).length : listings.length})</button>)}{connection.lastSyncedAt && <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">Última sync: {new Date(connection.lastSyncedAt).toLocaleString('pt-BR')}</span>}</div>{job && <div className={`rounded-xl border p-3 ${job.status === 'failed' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-100'}`}><div className="flex justify-between text-xs font-semibold text-slate-700"><span>{job.lastStep}</span><span>{job.progress}%</span></div><div className="h-1.5 bg-white rounded-full overflow-hidden mt-2"><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${job.progress}%` }} /></div></div>}</section>
          <section className="space-y-2">{visible.length === 0 ? <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-14 text-center text-sm text-slate-500">Nenhum anúncio sincronizado neste filtro.</div> : visible.map((listing) => <button key={listing.itemId} onClick={() => setSelected(listing)} className="w-full text-left bg-white border border-slate-200 hover:border-blue-300 rounded-2xl p-4 shadow-sm transition-colors flex items-center gap-4"><div className="w-16 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0">{listing.thumbnail && <img src={listing.thumbnail} alt="" className="w-full h-full object-contain" />}</div><div className="min-w-0 flex-1"><div className="flex gap-2 items-center"><span className="text-[10px] font-bold uppercase text-slate-400">{listing.itemId}</span><span className="text-[10px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{STATUS_LABEL[listing.status] || listing.status}</span>{listing.analysisSummary && <RiskBadge risk={listing.analysisSummary.riskLevel} />}</div><h3 className="text-sm font-bold text-slate-900 truncate mt-1">{listing.title}</h3><p className="text-xs mt-1 text-slate-400">{listing.analysisSummary ? `${listing.analysisSummary.findingCount} achado(s) na auditoria Alfreds` : `${listing.pictures?.length || 0} imagens · ${listing.attributes?.length || 0} atributos`}</p></div><div className="flex items-center gap-5"><Score value={listing.performance?.score} label="Oficial" /><Score value={listing.analysisSummary?.alfredsScore} label="Alfreds" /></div><ChevronRight className="w-4 h-4 text-slate-300 shrink-0" /></button>)}</section></>}
    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={() => setSelected(null)}><aside className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto" onMouseDown={(event) => event.stopPropagation()}><div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 p-4 flex items-center justify-between z-10"><div><p className="text-[10px] font-bold text-slate-400">{selected.itemId}</p><h2 className="font-bold text-slate-900 line-clamp-1">{selected.title}</h2></div><button onClick={() => setSelected(null)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-4 h-4" /></button></div><div className="p-5 space-y-5">
      <div className="grid grid-cols-4 gap-3"><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Score oficial</p><p className="text-xl font-black">{selected.performance?.score ?? '—'}</p></div><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Score Alfreds</p><p className="text-xl font-black">{analysis?.alfredsScore ?? selected.analysisSummary?.alfredsScore ?? '—'}</p></div><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Imagens</p><p className="text-xl font-black">{selected.pictures?.length || 0}</p></div><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Atributos</p><p className="text-xl font-black">{selected.attributes?.length || 0}</p></div></div>
      {(selected.userProductId || selected.catalogProductId) && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs flex gap-2"><TriangleAlert className="w-4 h-4 shrink-0" /><span><strong>Atenção ao alcance:</strong> associado a {selected.userProductId ? `User Product ${selected.userProductId}` : `catálogo ${selected.catalogProductId}`}.</span></div>}
      <div className="flex items-center justify-between gap-3 border-y border-slate-100 py-4"><div><h3 className="text-sm font-bold">Auditoria Alfreds</h3><p className="text-xs text-slate-500 mt-0.5">Regras, texto, imagens e fatos ausentes.</p></div><button onClick={analyze} disabled={analysisLoading || Boolean(analysis && !terminalAnalyses.has(analysis.status))} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">{analysisLoading || (analysis && !terminalAnalyses.has(analysis.status)) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{analysis ? 'Analisar novamente' : 'Analisar anúncio'}</button></div>
      {analysisLoading && !analysis && <div className="py-8 flex justify-center text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando auditoria…</div>}
      {analysis && !terminalAnalyses.has(analysis.status) && <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3"><Loader2 className="w-5 h-5 text-blue-600 animate-spin" /><div><p className="text-sm font-semibold text-blue-900">Analisando anúncio</p><p className="text-xs text-blue-700">Executando regras e inspecionando texto e imagens.</p></div></div>}
      {analysis?.status === 'stale' && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">O anúncio mudou. Execute uma nova auditoria.</div>}
      {analysis?.status === 'failed' && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">A auditoria falhou. {analysis.aiError}</div>}
      {analysis?.status === 'completed' && <AnalysisResult analysis={analysis} />}
      {analysis?.status === 'completed' && !proposalResult && <div className="flex items-center justify-between gap-3 border border-blue-200 bg-blue-50/50 rounded-xl p-4"><div><p className="text-sm font-bold text-slate-900">Transformar sugestões em proposta</p><p className="text-xs text-slate-500 mt-0.5">Cria um diff versionado com risco, alcance e decisão por campo.</p></div><button onClick={createProposal} disabled={proposalBusy} className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">{proposalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Criar proposta</button></div>}
      {proposalResult && <ProposalReview result={proposalResult} busy={proposalBusy} onDecide={decideChange} onApproveLowRisk={approveLowRisk} />}
      {!analysis && !analysisLoading && <><div><h3 className="text-sm font-bold mb-2">Descrição atual</h3><div className="whitespace-pre-wrap text-sm text-slate-600 bg-slate-50 border rounded-xl p-4 max-h-64 overflow-y-auto">{selected.descriptionPlainText || 'Sem descrição.'}</div></div>{qualityMissing(selected).length > 0 && <div><h3 className="text-sm font-bold mb-2">Ausências apontadas pelo Mercado Livre</h3><div className="flex flex-wrap gap-1.5">{qualityMissing(selected).map((id) => <span key={id} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-1">{id}</span>)}</div></div>}</>}
      {selected.permalink && <a href={selected.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600"><ExternalLink className="w-4 h-4" /> Abrir anúncio no Mercado Livre</a>}
      <div className="bg-slate-50 border text-slate-600 rounded-xl p-3 text-xs"><strong>Modo seguro:</strong> aprovações são auditadas, mas ainda não existe endpoint de publicação. Aplicação, verificação e rollback pertencem à Fase D.</div>
    </div></aside></div>}
  </div>;
}
