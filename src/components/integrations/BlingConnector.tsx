import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import {
  blingStatus, blingConnect, blingDisconnect, blingPush,
  blingImportStart, blingImportStatus, blingImportCancel, blingImportSetAutosync, blingWebhookConfig,
  type BlingStatus, type BlingImportJob, type BlingPushProduct, type BlingPushResult,
} from '../../services/blingService';

export type BlingPushFields = BlingPushProduct['campos'];
export type BlingPushCandidate = {
  id: string;
  sku: string;
  nome: string;
  changed: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
};

interface Props {
  onImported: () => void;
  getPushPayload: (campos: BlingPushFields) => Promise<BlingPushProduct[]>;
  getPushCandidates: (campos: BlingPushFields) => BlingPushCandidate[];
  onPushed: (results: BlingPushResult[]) => void;
}

const FIELD_LABELS: { key: keyof BlingPushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição complementar' },
  { key: 'seo', label: 'SEO (não enviado ao Bling v3)' },
  { key: 'fiscal', label: 'Fiscais (NCM, CEST, GTIN, peso, dimensões)' },
  { key: 'imagens', label: 'Imagens (mídia externa por URL)' },
];

const CHANGED_TAGS: { key: keyof BlingPushFields; label: string }[] = [
  { key: 'descricao', label: 'Desc' },
  { key: 'seo', label: 'SEO' },
  { key: 'fiscal', label: 'Fiscal' },
  { key: 'imagens', label: 'Img' },
];

const JOB_ACTIVE = (s?: string) => s === 'running' || s === 'queued';

const BlingConnector: React.FC<Props> = ({ onImported, getPushPayload, getPushCandidates, onPushed }) => {
  const [status, setStatus] = useState<BlingStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<BlingImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const prevJobStatus = useRef<string | undefined>(undefined);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const [companyIdInput, setCompanyIdInput] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<BlingPushFields>({ descricao: true, seo: false, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<BlingPushResult[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  const refreshStatus = async (): Promise<BlingStatus> => {
    let next: BlingStatus;
    try {
      next = await blingStatus();
    } catch {
      next = { connected: false, validated: false, lastValidatedAt: null };
    } finally {
      setLoadingStatus(false);
    }
    setStatus(next);
    return next;
  };

  useEffect(() => { refreshStatus(); }, []);

  const connected = status?.validated;

  useEffect(() => { setCompanyIdInput(status?.companyId ?? ''); }, [status?.companyId]);

  // Bling's webhook is app-level; enabling "webhook" mode is what makes this
  // account start reacting to events. Ensure the flag exists once connected.
  useEffect(() => {
    if (connected && status?.syncMode !== 'webhook') {
      blingWebhookConfig({ syncMode: 'webhook' }).then(() => refreshStatus()).catch(() => {});
    }
  }, [connected, status?.syncMode]);

  const handleSaveCompanyId = async () => {
    if (companyIdInput === (status?.companyId ?? '')) return;
    setSavingWebhook(true);
    setError(null);
    try {
      await blingWebhookConfig({ companyId: companyIdInput.trim() });
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o companyId.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    if (status?.webhookUrl) navigator.clipboard.writeText(status.webhookUrl).catch(() => {});
  };

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const poll = async () => {
      const j = await blingImportStatus().then((r) => r.job).catch(() => null);
      if (cancelled || !j) return;
      const prev = prevJobStatus.current;
      prevJobStatus.current = j.status;
      setJob(j);
      if ((prev === 'running' || prev === 'queued') && j.status === 'done') onImportedRef.current();
    };
    poll();
    let sinceIdlePoll = 0;
    const id = setInterval(() => {
      if (JOB_ACTIVE(prevJobStatus.current)) { poll(); sinceIdlePoll = 0; }
      else if (++sinceIdlePoll >= 4) { poll(); sinceIdlePoll = 0; }
    }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await blingConnect();
      const s = await refreshStatus();
      if (!s.validated) setError('Conexão não concluída. Tente novamente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar ao Bling.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await blingDisconnect();
    setPushResults(null);
    await refreshStatus();
  };

  const handleStart = async (mode: 'full' | 'update') => {
    setStarting(true);
    setError(null);
    try {
      const { job: j } = await blingImportStart(mode);
      prevJobStatus.current = j.status;
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar importação.');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    await blingImportCancel();
    const { job: j } = await blingImportStatus();
    prevJobStatus.current = j.status;
    setJob(j);
  };

  const handleToggleAutosync = async (enabled: boolean, everyHours: number) => {
    await blingImportSetAutosync(enabled, everyHours);
    setJob((prev) => (prev ? { ...prev, autoSync: { enabled, everyHours } } : prev));
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados do Bling (com ID Bling) para enviar.');
        return;
      }
      const res = await blingPush(payload);
      setPushResults(res.resultados);
      onPushed(res.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setPushing(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando integração…
      </div>
    );
  }

  const active = JOB_ACTIVE(job?.status);
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.imported / job.total) * 100)) : 0;
  const autoSync = job?.autoSync ?? { enabled: false, everyHours: 24 };
  const pushCandidates: BlingPushCandidate[] = connected ? getPushCandidates(campos) : [];

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            API v3 (OAuth): você será levado à tela de autorização do Bling e, ao aprovar, os tokens
            ficam guardados com segurança no servidor — nunca no navegador.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 bg-[#1668E3] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0f4fac] disabled:opacity-50 transition-colors"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Conectar conta Bling
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">v3</span>
              {status?.lastValidatedAt && (
                <span className="text-emerald-600/70 text-xs">
                  · {new Date(status.lastValidatedAt).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>

          {/* Webhook (app-level, single callback URL) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Recebimento via Webhook</h4>
              <p className="text-xs text-slate-500">
                Cadastre esta URL de callback no painel do Bling (Aplicativos → seu app → Webhooks) e
                habilite os eventos de produto. Produtos criados/atualizados/excluídos no Bling são
                refletidos aqui automaticamente.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">URL de callback (fixa)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={status?.webhookUrl ?? ''}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600"
                />
                <button
                  onClick={handleCopyWebhookUrl}
                  disabled={!status?.webhookUrl}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Copiar
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">companyId da conta Bling</label>
              <input
                type="text"
                value={companyIdInput}
                onChange={(e) => setCompanyIdInput(e.target.value)}
                onBlur={handleSaveCompanyId}
                placeholder="Detectado no connect; ajuste se necessário"
                disabled={savingWebhook}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1668E3] focus:border-[#1668E3]"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Identifica a sua conta nos webhooks (que são compartilhados por todos os lojistas do app).
              </p>
            </div>

            <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {status?.webhookStats && status.webhookStats.totalReceived > 0
                ? `Último recebido: ${status.webhookStats.lastReceivedAt ? new Date(status.webhookStats.lastReceivedAt).toLocaleString('pt-BR') : '—'} · Total recebido: ${status.webhookStats.totalReceived}`
                : 'Nenhum evento recebido ainda.'}
            </p>
          </div>

          {/* Import (background) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Importar produtos (em background)</h4>
              <p className="text-xs text-slate-500">
                A importação roda no servidor — você pode <strong>fechar a aba</strong> que ela continua.
                Mescla por ID Bling; campos já enriquecidos (descrição/SEO) são preservados.
              </p>
            </div>

            {active ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {job?.status === 'queued' ? 'Na fila…' : job?.mode === 'update' ? 'Sincronizando atualizações…' : 'Importando…'}
                    {' '}{job?.imported ?? 0}{job && job.total > 0 ? `/${job.total}` : ''} produtos
                  </span>
                  <button onClick={handleCancel} className="text-slate-500 hover:text-red-600 inline-flex items-center gap-1">
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#1668E3] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleStart('full')}
                    disabled={starting}
                    className="inline-flex items-center gap-2 bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
                  >
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Importar tudo
                  </button>
                  <button
                    onClick={() => handleStart('update')}
                    disabled={starting}
                    className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Sincronizar atualizações
                  </button>
                </div>
                {job && job.status === 'done' && (
                  <p className="text-xs text-emerald-600 inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Última importação: {job.imported} produtos
                    {job.lastSyncAt && ` · ${new Date(job.lastSyncAt).toLocaleString('pt-BR')}`}
                  </p>
                )}
                {job && job.status === 'error' && (
                  <p className="text-xs text-red-600 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {job.error ?? 'Falha na importação.'}
                  </p>
                )}
                {job && job.status === 'canceled' && (
                  <p className="text-xs text-slate-500">Importação cancelada em {job.imported} produtos.</p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-600 pt-1 border-t border-slate-100 mt-1">
              <input
                type="checkbox"
                checked={autoSync.enabled}
                onChange={(e) => handleToggleAutosync(e.target.checked, autoSync.everyHours)}
                className="rounded border-slate-300 text-[#1668E3] focus:ring-[#1668E3]"
              />
              Sincronizar automaticamente a cada
              <select
                value={autoSync.everyHours}
                onChange={(e) => handleToggleAutosync(autoSync.enabled, Number(e.target.value))}
                className="border border-slate-200 rounded px-1.5 py-0.5 text-xs"
              >
                <option value={6}>6h</option>
                <option value={12}>12h</option>
                <option value={24}>24h</option>
                <option value={48}>48h</option>
              </select>
              (puxa o catálogo do Bling)
            </label>
          </div>

          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Bling</h4>
              <p className="text-xs text-slate-500">
                Envia de volta apenas os produtos cujos campos <strong>selecionados abaixo mudaram</strong>
                {' '}desde o último envio — nada é reenviado sem necessidade.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {FIELD_LABELS.map(({ key, label }) => (
                <label key={key} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={campos[key]}
                    onChange={(e) => setCampos((c) => ({ ...c, [key]: e.target.checked }))}
                    className="rounded border-slate-300 text-[#1668E3] focus:ring-[#1668E3]"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Imagens são enviadas como mídia externa por URL (mescladas com as já existentes). As URLs
              precisam ser públicas para o Bling conseguir baixá-las. O Bling v3 não tem bloco de SEO no
              produto, então o grupo SEO não é enviado.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePush}
                disabled={pushing || pushCandidates.length === 0}
                className="inline-flex items-center gap-2 bg-[#1668E3] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0f4fac] disabled:opacity-50 transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Enviar selecionados para Bling
              </button>
              <button
                type="button"
                onClick={() => setShowCandidates(true)}
                disabled={pushCandidates.length === 0}
                title="Ver os produtos que serão enviados"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {pushCandidates.length} {pushCandidates.length === 1 ? 'produto' : 'produtos'}
              </button>
            </div>

            {pushResults && (
              <div className="mt-2 border-t border-slate-100 pt-3 space-y-1.5 max-h-64 overflow-auto">
                {pushResults.map((r) => (
                  <div key={r.blingId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.blingId}</span>
                    <span className="text-slate-500">
                      {(['descricao', 'seo', 'fiscal', 'imagens'] as const)
                        .filter((k) => r.steps[k] !== 'skip')
                        .map((k) => `${k}: ${r.steps[k]}`)
                        .join(' · ') || 'nada a enviar'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview of the products that will be sent to Bling */}
      {showCandidates && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCandidates(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">
                Produtos modificados a enviar ({pushCandidates.length})
              </h3>
              <button onClick={() => setShowCandidates(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="overflow-auto divide-y divide-slate-100">
              {pushCandidates.length === 0 ? (
                <p className="text-sm text-slate-500 px-5 py-6 text-center">
                  Nenhum produto modificado para os campos selecionados.
                </p>
              ) : (
                pushCandidates.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-500 shrink-0">{p.sku || p.id}</span>
                    <span className="text-slate-700 truncate flex-1">{p.nome || <span className="text-slate-400 italic">sem nome</span>}</span>
                    <span className="flex gap-1 shrink-0">
                      {CHANGED_TAGS.filter(({ key }) => p.changed[key]).map(({ key, label }) => (
                        <span key={key} className="text-[10px] uppercase font-semibold text-[#1668E3] bg-[#1668E3]/10 rounded px-1.5 py-0.5">
                          {label}
                        </span>
                      ))}
                    </span>
                  </div>
                ))
              )}
            </div>
            <footer className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
              Só entram produtos cujos campos <strong>selecionados</strong> mudaram desde o último envio.
              Sem seleção na lista de produtos, considera todos os vindos do Bling.
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlingConnector;
