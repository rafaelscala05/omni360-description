import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import {
  idworksStatus, idworksConnect, idworksDisconnect, idworksPush,
  idworksImportStart, idworksImportStatus, idworksImportCancel, idworksImportSetAutosync, idworksWebhookConfig,
  type IdworksStatus, type IdworksImportJob, type IdworksPushProduct, type IdworksPushResult, type IdworksWebhookConfig,
} from '../../services/idworksService';

export type IdworksPushFields = IdworksPushProduct['campos'];
export type IdworksPushCandidate = {
  id: string;
  sku: string;
  nome: string;
  changed: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
};

interface Props {
  onImported: () => void;
  getPushPayload: (campos: IdworksPushFields) => Promise<IdworksPushProduct[]>;
  getPushCandidates: (campos: IdworksPushFields) => IdworksPushCandidate[];
  onPushed: (results: IdworksPushResult[]) => void;
}

// Unlike Bling (whose v3 product API has no SEO block), IdWorks DOES expose a rich
// e-commerce SEO block (EcommerceTitle/Description/KeyWords...) — so the SEO group is
// enabled and labeled normally here.
const FIELD_LABELS: { key: keyof IdworksPushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição complementar' },
  { key: 'seo', label: 'SEO (título, descrição, palavras-chave)' },
  { key: 'fiscal', label: 'Fiscais (NCM, CEST, GTIN, peso, dimensões)' },
  { key: 'imagens', label: 'Imagens (por URL)' },
];

const CHANGED_TAGS: { key: keyof IdworksPushFields; label: string }[] = [
  { key: 'descricao', label: 'Desc' },
  { key: 'seo', label: 'SEO' },
  { key: 'fiscal', label: 'Fiscal' },
  { key: 'imagens', label: 'Img' },
];

const JOB_ACTIVE = (s?: string) => s === 'running' || s === 'queued';

const IdworksConnector: React.FC<Props> = ({ onImported, getPushPayload, getPushCandidates, onPushed }) => {
  const [status, setStatus] = useState<IdworksStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<IdworksImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const prevJobStatus = useRef<string | undefined>(undefined);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const [accountName, setAccountName] = useState('');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [webhookConfig, setWebhookConfig] = useState<IdworksWebhookConfig | null>(null);
  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<IdworksPushFields>({ descricao: true, seo: true, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<IdworksPushResult[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  const refreshStatus = async (): Promise<IdworksStatus> => {
    let next: IdworksStatus;
    try {
      next = await idworksStatus();
    } catch {
      next = { connected: false, validated: false, accountName: null, lastValidatedAt: null };
    } finally {
      setLoadingStatus(false);
    }
    setStatus(next);
    return next;
  };

  useEffect(() => { refreshStatus(); }, []);

  const connected = status?.validated;

  // IdWorks webhooks are configured manually in the IdWorks panel against a per-user
  // secret URL. Enabling "webhook" mode generates/holds that secret and returns the URL
  // + suggested auth header for the user to paste there. Once connected, ensure the
  // secret exists so the connector can display the URL (and the header) to the user.
  useEffect(() => {
    if (connected && status?.syncMode !== 'webhook') {
      idworksWebhookConfig({ syncMode: 'webhook' })
        .then((cfg) => setWebhookConfig(cfg))
        .catch(() => {});
    }
  }, [connected, status?.syncMode]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      // Credential field names below (login/senha) are a best-effort default — the
      // exact POST /auth/token body isn't publicly documented (spec Pendências #1).
      // Keep these form fields in sync with whatever server/idworksAgent.ts's
      // obtainToken ends up sending once confirmed against a real IdWorks account.
      const res = await idworksConnect(accountName.trim(), { login: login.trim(), senha });
      if (!res.valid) setError(res.message);
      else await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar à IdWorks.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await idworksDisconnect();
    setPushResults(null);
    setWebhookConfig(null);
    await refreshStatus();
  };

  const handleCopyWebhookUrl = () => {
    if (webhookConfig?.webhookUrl) navigator.clipboard.writeText(webhookConfig.webhookUrl).catch(() => {});
  };

  const handleCopyHeader = () => {
    if (webhookConfig?.headerValue) navigator.clipboard.writeText(webhookConfig.headerValue).catch(() => {});
  };

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const poll = async () => {
      const j = await idworksImportStatus().then((r) => r.job).catch(() => null);
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

  const handleStart = async (mode: 'full' | 'update') => {
    setStarting(true);
    setError(null);
    try {
      const { job: j } = await idworksImportStart(mode);
      prevJobStatus.current = j.status;
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar importação.');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    await idworksImportCancel();
    const { job: j } = await idworksImportStatus();
    prevJobStatus.current = j.status;
    setJob(j);
  };

  const handleToggleAutosync = async (enabled: boolean, everyHours: number) => {
    await idworksImportSetAutosync(enabled, everyHours);
    setJob((prev) => (prev ? { ...prev, autoSync: { enabled, everyHours } } : prev));
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados da IdWorks (com ID IdWorks) para enviar.');
        return;
      }
      const res = await idworksPush(payload);
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
  const pushCandidates: IdworksPushCandidate[] = connected ? getPushCandidates(campos) : [];

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!connected ? (
        <form className="space-y-3" onSubmit={handleConnect}>
          <p className="text-sm text-slate-500">
            Informe a conta e as credenciais de API da IdWorks (obtidas com o suporte da IdWorks).
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Conta (subdomínio)</label>
            <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="minhaempresa" required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Login</label>
            <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Senha / chave de API</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
          </div>
          <button type="submit" disabled={connecting}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Conectar à IdWorks
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              {status?.accountName && (
                <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">
                  {status.accountName}
                </span>
              )}
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

          {/* Webhook (per-user secret URL, configured manually in the IdWorks panel) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Recebimento via Webhook</h4>
              <p className="text-xs text-slate-500">
                Cole esta URL e o header abaixo em Configurações → Parametrizações → Webhook, no painel da IdWorks,
                e habilite os tópicos de produto (SKU criado/editado/excluído).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">URL de callback</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookConfig?.webhookUrl ?? ''}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600"
                />
                <button
                  onClick={handleCopyWebhookUrl}
                  disabled={!webhookConfig?.webhookUrl}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Copiar
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Header de autenticação</label>
              <p className="text-xs text-slate-500 mb-1">
                Nome: <code className="font-mono">{webhookConfig?.headerName ?? 'Authorization'}</code>
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookConfig?.headerValue ?? ''}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600"
                />
                <button
                  onClick={handleCopyHeader}
                  disabled={!webhookConfig?.headerValue}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Copiar
                </button>
              </div>
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
                Mescla por ID IdWorks; campos já enriquecidos (descrição/SEO) são preservados.
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
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
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
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
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
              (puxa o catálogo da IdWorks)
            </label>
          </div>

          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para IdWorks</h4>
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
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Imagens são enviadas como mídia externa por URL (mescladas com as já existentes). As URLs
              precisam ser públicas para a IdWorks conseguir baixá-las.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePush}
                disabled={pushing || pushCandidates.length === 0}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Enviar selecionados para IdWorks
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
                  <div key={r.idworksId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.idworksId}</span>
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

      {/* Preview of the products that will be sent to IdWorks */}
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
                        <span key={key} className="text-[10px] uppercase font-semibold text-emerald-600 bg-emerald-600/10 rounded px-1.5 py-0.5">
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
              Sem seleção na lista de produtos, considera todos os vindos da IdWorks.
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default IdworksConnector;
