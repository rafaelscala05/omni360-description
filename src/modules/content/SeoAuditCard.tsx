import React, { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, RefreshCw, AlertTriangle, Search, Globe, TrendingUp, Swords, XCircle, Ban,
  ChevronDown, ChevronUp, DollarSign, BarChart3,
} from 'lucide-react';
import type { ContentProject, SeoAudit, SeoAuditIssue, ClusterKeyword } from './types';
import { triggerSeoAudit, refreshSeoAudit, cancelSeoAudit } from '../../services/contentService';
import { INTENT_META } from './ClusterDetailView';

interface Props {
  project: ContentProject;
  audit: SeoAudit | null | undefined; // owned by the parent (also used to gate "Avançar para Clusters")
  // Auto-fires the audit as soon as we know there isn't one yet (used by the
  // onboarding wizard step — "já chame para fazer o audit" instead of requiring a click).
  autoTrigger?: boolean;
}

// Auditoria técnica (crawl) desativada por ora — "não vai fazer sentido eu
// utilizar agora". Espelha CRAWL_ENABLED em server/seoAgent.ts: enquanto
// ambas ficarem false, nenhum crawl é disparado e esta seção fica oculta.
// Reative as duas para trazer a auditoria técnica de volta.
const SHOW_CRAWL_SECTION = false;

const SEVERITY_STYLE: Record<SeoAuditIssue['severity'], string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  notice: 'bg-slate-50 text-slate-600 border-slate-200',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'));
const dec = (v: number | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Full data table for a list of ranked/gap keywords — scrollable so a domain
// with 100+ keywords doesn't blow up the page. Every column here is a real
// field returned by the SE Ranking API.
const KeywordTable: React.FC<{ items: ClusterKeyword[] }> = ({ items }) => (
  <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
    <table className="w-full text-[11px]">
      <thead className="bg-slate-100 sticky top-0 z-10">
        <tr className="text-left text-slate-500">
          <th className="px-2 py-1.5 font-semibold">Palavra-chave</th>
          <th className="px-2 py-1.5 font-semibold text-right">Posição</th>
          <th className="px-2 py-1.5 font-semibold text-right">Volume</th>
          <th className="px-2 py-1.5 font-semibold text-right">Tráfego</th>
          <th className="px-2 py-1.5 font-semibold text-right">CPC</th>
          <th className="px-2 py-1.5 font-semibold text-right">Dificuldade</th>
          <th className="px-2 py-1.5 font-semibold text-right">Competição</th>
          <th className="px-2 py-1.5 font-semibold">Intenção</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {items.map((k, i) => (
          <tr key={`${k.termo}-${i}`} className="hover:bg-slate-50">
            <td className="px-2 py-1.5 text-slate-700">{k.termo}</td>
            <td className="px-2 py-1.5 text-right text-slate-500">{k.posicao ?? '—'}</td>
            <td className="px-2 py-1.5 text-right font-medium text-slate-700">{n(k.volume)}</td>
            <td className="px-2 py-1.5 text-right text-slate-500">{n(k.trafego)}</td>
            <td className="px-2 py-1.5 text-right text-slate-500">{dec(k.cpc)}</td>
            <td className="px-2 py-1.5 text-right text-slate-500">{k.dificuldade ?? '—'}</td>
            <td className="px-2 py-1.5 text-right text-slate-500">{k.competicao != null ? k.competicao.toFixed(2) : '—'}</td>
            <td className="px-2 py-1.5">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${INTENT_META[k.intencao].chip}`}>
                {INTENT_META[k.intencao].label}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Toggle: React.FC<{ open: boolean; label: string; onClick: () => void }> = ({ open, label, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 text-[11px] font-medium text-[#FF5B03] hover:text-[#E14E00] transition-colors mt-2"
  >
    {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} {label}
  </button>
);

// Último passo do "Setup do Cliente" — dispara e acompanha, de forma
// INDEPENDENTE, a auditoria técnica de SEO (crawl, lento/assíncrono, cancelável)
// e a Análise de Domínio (SE Ranking, resolvida junto do disparo). A Análise de
// Domínio é a base real usada na geração de Clusters; a auditoria técnica é
// contexto complementar e nunca bloqueia o restante do fluxo.
const SeoAuditCard: React.FC<Props> = ({ project, audit, autoTrigger }) => {
  const [triggering, setTriggering] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showDomainKeywords, setShowDomainKeywords] = useState(false);
  const [showGapKeywords, setShowGapKeywords] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoFiredRef = useRef(false);

  const siteUrl = project.config.siteUrl?.trim();

  const handleTrigger = async () => {
    setTriggering(true);
    setError(null);
    try {
      await triggerSeoAudit(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar a auditoria');
    } finally {
      setTriggering(false);
    }
  };

  // Auto-dispara uma única vez quando o listener confirma que ainda não existe
  // auditoria para este projeto (audit === null, não undefined/loading).
  useEffect(() => {
    if (autoTrigger && audit === null && siteUrl && !autoFiredRef.current) {
      autoFiredRef.current = true;
      handleTrigger();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger, audit, siteUrl]);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (audit?.crawlStatus === 'processing') {
      pollRef.current = setInterval(() => {
        refreshSeoAudit(project.id, audit.id).catch(() => {});
      }, 10000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [audit?.crawlStatus, audit?.id, project.id]);

  const handleCancel = async () => {
    if (!audit) return;
    setCanceling(true);
    try {
      await cancelSeoAudit(project.id, audit.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar a auditoria');
    } finally {
      setCanceling(false);
    }
  };

  const overview = audit?.domainOverview;
  const history = audit?.domainHistory ?? [];
  const domainKeywords = audit?.domainKeywords ?? [];
  const gapKeywords = audit?.domainGapKeywords ?? [];
  const issues = audit?.topIssues ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400" /> {SHOW_CRAWL_SECTION ? 'Auditoria de SEO & Análise de Domínio' : 'Análise de Domínio'}
        </h2>
        {audit?.crawlStatus !== 'processing' && (
          <button
            onClick={handleTrigger}
            disabled={triggering || !siteUrl}
            title={!siteUrl ? 'Informe a URL do site na etapa Identidade para habilitar' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#FF5B03] hover:bg-[#E14E00] disabled:opacity-50 rounded-lg shadow-sm transition-colors"
          >
            {triggering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {audit ? 'Rodar novamente' : 'Rodar auditoria'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {SHOW_CRAWL_SECTION
          ? 'As duas etapas rodam de forma independente: a Análise de Domínio (palavras-chave que o site já rankeia + lacunas vs. um concorrente + expansão do catálogo) alimenta os Clusters; o crawl técnico é só contexto complementar e pode ser cancelado sem afetar a outra etapa.'
          : 'Palavras-chave que o site já rankeia + lacunas vs. um concorrente + expansão do catálogo — essa é a base real usada na geração dos Clusters.'}
      </p>

      {!siteUrl && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Globe className="w-3.5 h-3.5 shrink-0" /> Informe a URL do site na etapa "Identidade" para habilitar a auditoria.
        </p>
      )}

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 mt-3">{error}</div>}

      {audit === undefined ? null : audit === null ? (
        siteUrl && <p className="text-xs text-slate-400 mt-2">Nenhuma auditoria rodada ainda para {siteUrl}.</p>
      ) : (
        <div className="space-y-4 mt-2">
          {/* Análise de Domínio — base dos Clusters */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Análise de Domínio
            </h3>
            {audit.domainStatus === 'processing' ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> Analisando palavras-chave do domínio…
              </div>
            ) : audit.domainStatus === 'failed' ? (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {audit.domainErrorMessage || 'A análise de domínio falhou.'}
              </div>
            ) : (
              <div>
                {/* Overview stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 mb-1.5">
                  {overview?.keywordsCount != null && (
                    <span><span className="font-semibold text-slate-800">{n(overview.keywordsCount)}</span> palavras-chave já rankeadas</span>
                  )}
                  {overview?.trafficEstimate != null && (
                    <span><span className="font-semibold text-slate-800">{n(overview.trafficEstimate)}</span> tráfego orgânico estimado/mês</span>
                  )}
                  {overview?.priceEstimate != null && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-slate-800">{n(overview.priceEstimate)}</span> valor equivalente em anúncios
                    </span>
                  )}
                  {!!audit.keywordPool?.length && (
                    <span className="text-emerald-600 font-medium">{audit.keywordPool.length} disponíveis para os Clusters</span>
                  )}
                </div>

                {/* Position buckets */}
                {overview?.positions && (
                  <div className="flex flex-wrap gap-2 mb-1.5">
                    {([['top1_5', 'Top 1-5'], ['top6_10', 'Top 6-10'], ['top11_20', 'Top 11-20'], ['top21_50', 'Top 21-50'], ['top51_100', 'Top 51-100']] as const).map(([key, label]) =>
                      overview.positions?.[key] != null ? (
                        <span key={key} className="text-[10px] text-slate-500 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                          {label}: <span className="font-semibold text-slate-700">{n(overview.positions[key])}</span>
                        </span>
                      ) : null,
                    )}
                  </div>
                )}

                {audit.domainTrend && <p className="text-xs text-slate-500">{audit.domainTrend}</p>}
                {audit.competitorDomain && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <Swords className="w-3.5 h-3.5 shrink-0" /> Lacunas comparadas com <span className="font-medium text-slate-700">{audit.competitorDomain}</span>
                  </p>
                )}

                {/* Histórico mensal */}
                {history.length > 0 && (
                  <>
                    <Toggle open={showHistory} label={`Histórico mensal (${history.length} meses)`} onClick={() => setShowHistory((v) => !v)} />
                    {showHistory && (
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 mt-1.5">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-100 sticky top-0">
                            <tr className="text-left text-slate-500">
                              <th className="px-2 py-1 font-semibold">Mês</th>
                              <th className="px-2 py-1 font-semibold text-right">Palavras-chave</th>
                              <th className="px-2 py-1 font-semibold text-right">Tráfego estimado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {history.map((h, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1 text-slate-600">{h.month ?? '—'}/{h.year ?? '—'}</td>
                                <td className="px-2 py-1 text-right text-slate-700">{n(h.keywordsCount)}</td>
                                <td className="px-2 py-1 text-right text-slate-700">{n(h.trafficEstimate)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Palavras-chave rankeadas (completo) */}
                {domainKeywords.length > 0 && (
                  <>
                    <Toggle open={showDomainKeywords} label={`Ver todas as ${domainKeywords.length} palavras-chave rankeadas`} onClick={() => setShowDomainKeywords((v) => !v)} />
                    {showDomainKeywords && <div className="mt-1.5"><KeywordTable items={domainKeywords} /></div>}
                  </>
                )}

                {/* Lacuna vs. concorrente (completo) */}
                {gapKeywords.length > 0 && (
                  <>
                    <Toggle open={showGapKeywords} label={`Ver ${gapKeywords.length} palavras-chave de lacuna vs. ${audit.competitorDomain}`} onClick={() => setShowGapKeywords((v) => !v)} />
                    {showGapKeywords && <div className="mt-1.5"><KeywordTable items={gapKeywords} /></div>}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Crawl técnico — complementar, cancelável. Desativado por ora (SHOW_CRAWL_SECTION). */}
          {SHOW_CRAWL_SECTION && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" /> Auditoria técnica do site
            </h3>
            {audit.crawlStatus === 'processing' ? (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> Rastreando {audit.domain}… pode levar alguns minutos.
                </span>
                <button
                  onClick={handleCancel}
                  disabled={canceling}
                  className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-600 disabled:opacity-50 transition-colors shrink-0"
                >
                  <Ban className="w-3.5 h-3.5" /> Cancelar
                </button>
              </div>
            ) : audit.crawlStatus === 'canceled' ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <XCircle className="w-3.5 h-3.5 shrink-0" /> Cancelada — não bloqueia a geração de Clusters.
              </p>
            ) : audit.crawlStatus === 'failed' ? (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {audit.crawlErrorMessage || 'A auditoria técnica falhou.'}
              </p>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-4 mb-2">
                  <div className="text-center">
                    <div className={`text-xl font-display font-bold ${scoreColor(audit.healthScore ?? 0)}`}>{audit.healthScore ?? '—'}</div>
                    <div className="text-[9px] text-slate-400 font-medium">Health score</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{audit.pagesCrawled ?? '—'}</span> páginas rastreadas
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-red-600 font-medium">{n(audit.totalErrors)} erros</span>
                    <span className="text-amber-600 font-medium">{n(audit.totalWarnings)} avisos</span>
                    <span className="text-slate-500 font-medium">{n(audit.totalNotices)} notas</span>
                    <span className="text-emerald-600 font-medium">{n(audit.totalPassed)} ok</span>
                  </div>
                </div>
                {issues.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {(showAllIssues ? issues : issues.slice(0, 8)).map((issue) => (
                        <span
                          key={issue.code}
                          title={`${issue.count} páginas`}
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border ${SEVERITY_STYLE[issue.severity]}`}
                        >
                          {issue.title} <span className="opacity-60">({issue.count})</span>
                        </span>
                      ))}
                    </div>
                    {issues.length > 8 && (
                      <Toggle
                        open={showAllIssues}
                        label={showAllIssues ? 'Ver menos' : `Ver todos os ${issues.length} problemas`}
                        onClick={() => setShowAllIssues((v) => !v)}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SeoAuditCard;
