import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info, KeyRound } from 'lucide-react';
import {
  tinyStatus, tinyConnect, tinyV2Validate, tinyDisconnect, tinyPush,
  tinyImportStart, tinyImportStatus, tinyImportCancel, tinyImportSetAutosync,
  type TinyStatus, type TinyImportJob, type TinyPushProduct, type TinyPushResult,
} from '../../services/tinyService';

export type TinyPushFields = TinyPushProduct['campos'];
export type TinyPushCandidate = {
  id: string;
  sku: string;
  nome: string;
  changed: Record<'descricao' | 'seo' | 'fiscal' | 'imagens', boolean>;
};

interface Props {
  // Called when a background import finishes, so the app can reload products.
  onImported: () => void;
  // Builds the push payload from the currently selected products and chosen fields.
  getPushPayload: (campos: TinyPushFields) => Promise<TinyPushProduct[]>;
  // Products that will be sent for a field selection (only the modified ones).
  getPushCandidates: (campos: TinyPushFields) => TinyPushCandidate[];
  // Called after a send so the app can record what was sent (avoid resending).
  onPushed: (results: TinyPushResult[]) => void;
}

const FIELD_LABELS: { key: keyof TinyPushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição complementar' },
  { key: 'seo', label: 'SEO (título/descrição/keywords)' },
  { key: 'fiscal', label: 'Fiscais (NCM, GTIN, peso, dimensões)' },
  { key: 'imagens', label: 'Imagens (anexos por URL)' },
];

const CHANGED_TAGS: { key: keyof TinyPushFields; label: string }[] = [
  { key: 'descricao', label: 'Desc' },
  { key: 'seo', label: 'SEO' },
  { key: 'fiscal', label: 'Fiscal' },
  { key: 'imagens', label: 'Img' },
];

const JOB_ACTIVE = (s?: string) => s === 'running' || s === 'queued';

const TinyConnector: React.FC<Props> = ({ onImported, getPushPayload, getPushCandidates, onPushed }) => {
  const [status, setStatus] = useState<TinyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which API version the user is setting up while disconnected.
  const [version, setVersion] = useState<'v2' | 'v3'>('v3');
  const [v2Token, setV2Token] = useState('');
  const [validating, setValidating] = useState(false);

  const [job, setJob] = useState<TinyImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const prevJobStatus = useRef<string | undefined>(undefined);
  // Keep the latest onImported so the polling effect never calls a stale closure.
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<TinyPushFields>({ descricao: true, seo: true, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<TinyPushResult[] | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  const refreshStatus = async (): Promise<TinyStatus> => {
    let next: TinyStatus;
    try {
      next = await tinyStatus();
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

  // Poll the background job while connected. Polls on a steady cadence (not only
  // when active) so a server-initiated auto-sync is reflected too; reloads
  // products when a run transitions to done.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const poll = async () => {
      const j = await tinyImportStatus().then((r) => r.job).catch(() => null);
      if (cancelled || !j) return;
      const prev = prevJobStatus.current;
      prevJobStatus.current = j.status;
      setJob(j);
      if ((prev === 'running' || prev === 'queued') && j.status === 'done') onImportedRef.current();
    };
    poll();
    // Faster while a job is active, slower when idle, so an open tab stays cheap.
    let sinceIdlePoll = 0;
    const id = setInterval(() => {
      if (JOB_ACTIVE(prevJobStatus.current)) { poll(); sinceIdlePoll = 0; }
      else if (++sinceIdlePoll >= 4) { poll(); sinceIdlePoll = 0; } // ~every 20s when idle
    }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await tinyConnect();
      const s = await refreshStatus();
      if (!s.validated) setError('Conexão não concluída. Tente novamente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar ao Tiny.');
    } finally {
      setConnecting(false);
    }
  };

  const handleV2Connect = async () => {
    if (!v2Token.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const res = await tinyV2Validate(v2Token.trim());
      if (!res.valid) throw new Error(res.message);
      setV2Token('');
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao validar o token.');
    } finally {
      setValidating(false);
    }
  };

  const handleDisconnect = async () => {
    await tinyDisconnect();
    setPushResults(null);
    await refreshStatus();
  };

  const handleStart = async (mode: 'full' | 'update') => {
    setStarting(true);
    setError(null);
    try {
      const { job: j } = await tinyImportStart(mode);
      prevJobStatus.current = j.status;
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar importação.');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    await tinyImportCancel();
    const { job: j } = await tinyImportStatus();
    prevJobStatus.current = j.status;
    setJob(j);
  };

  const handleToggleAutosync = async (enabled: boolean, everyHours: number) => {
    await tinyImportSetAutosync(enabled, everyHours);
    setJob((prev) => (prev ? { ...prev, autoSync: { enabled, everyHours } } : prev));
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados do Tiny (com ID Tiny) para enviar.');
        return;
      }
      const res = await tinyPush(payload);
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
  // Only modified products (for the chosen field groups) are sent — this is that set.
  const pushCandidates: TinyPushCandidate[] = connected ? getPushCandidates(campos) : [];

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
          {/* Version selector */}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-sm">
            {(['v3', 'v2'] as const).map((v) => (
              <button
                key={v}
                onClick={() => { setVersion(v); setError(null); }}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  version === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'v3' ? 'v3 — OAuth' : 'v2 — Token'}
              </button>
            ))}
          </div>

          {version === 'v3' ? (
            <>
              <p className="text-sm text-slate-500">
                API v3 (OAuth): você será levado à tela de autorização do Tiny e, ao aprovar, os tokens
                ficam guardados com segurança no servidor — nunca no navegador.
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Conectar conta Tiny
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">
                API v2 (token de integração): gere o token em Tiny → Configurações → Tokens da API e cole
                abaixo. Validamos e guardamos o token com segurança no servidor — nunca no navegador.
              </p>
              <label className="block text-xs font-semibold text-slate-600">Token de integração (v2)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={v2Token}
                    onChange={(e) => setV2Token(e.target.value)}
                    placeholder="Cole seu token aqui"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleV2Connect(); }}
                  />
                </div>
                <button
                  onClick={handleV2Connect}
                  disabled={validating || !v2Token.trim()}
                  className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
                >
                  {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Conectar e validar
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
              {status?.version && (
                <span className="text-emerald-800 font-semibold uppercase text-[10px] bg-emerald-100 rounded px-1.5 py-0.5">
                  {status.version}
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

          {/* Import (background) */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Importar produtos (em background)</h4>
              <p className="text-xs text-slate-500">
                A importação roda no servidor — você pode <strong>fechar a aba</strong> que ela continua.
                Mescla por ID Tiny; campos já enriquecidos (descrição/SEO) são preservados.
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
                  <div className="h-full bg-[#FF5B03] transition-all" style={{ width: `${pct}%` }} />
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
                className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03]"
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
              (puxa só o que mudou no Tiny)
            </label>
          </div>

          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Tiny</h4>
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
                    className="rounded border-slate-300 text-[#FF5B03] focus:ring-[#FF5B03]"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Imagens são enviadas como anexos por URL (mescladas com as já existentes no produto).
              As URLs precisam ser públicas para o Tiny conseguir baixá-las.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePush}
                disabled={pushing || pushCandidates.length === 0}
                className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Enviar selecionados para Tiny
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
                  <div key={r.tinyId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.tinyId}</span>
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

      {/* Preview of the products that will be sent to Tiny */}
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
                        <span key={key} className="text-[10px] uppercase font-semibold text-[#FF5B03] bg-[#FF5B03]/10 rounded px-1.5 py-0.5">
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
              Sem seleção na lista de produtos, considera todos os vindos do Tiny.
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default TinyConnector;
