import React, { useEffect, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, KeyRound } from 'lucide-react';
import {
  wakeValidate, wakeStatus, wakeImport, wakePush, wakeDisconnect,
  type WakeStatus, type WakeNormalizedProduct, type WakePushProduct, type WakePushResult,
} from '../../services/wakeService';

export type WakePushFields = WakePushProduct['campos'];

interface Props {
  // Persists an imported batch into the app (merge by produtoId + backup).
  onImport: (produtos: WakeNormalizedProduct[]) => Promise<void>;
  // Builds the push payload from the currently selected products and chosen fields.
  getPushPayload: (campos: WakePushFields) => Promise<WakePushProduct[]>;
}

const FIELD_LABELS: { key: keyof WakePushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição' },
  { key: 'seo', label: 'SEO e metatags' },
  { key: 'atributos', label: 'Atributos' },
  { key: 'imagens', label: 'Imagens ambientadas' },
];

const WakeConnector: React.FC<Props> = ({ onImport, getPushPayload }) => {
  const [status, setStatus] = useState<WakeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ page: number; total: number } | null>(null);

  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<WakePushFields>({ descricao: true, seo: true, atributos: true, imagens: true });
  const [pushResults, setPushResults] = useState<WakePushResult[] | null>(null);

  const refreshStatus = async () => {
    try {
      setStatus(await wakeStatus());
    } catch {
      setStatus({ connected: false, validated: false, lastValidatedAt: null });
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => { refreshStatus(); }, []);

  const handleValidate = async () => {
    if (!token.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const res = await wakeValidate(token.trim());
      if (!res.valid) throw new Error(res.message);
      setToken('');
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao validar o token.');
    } finally {
      setValidating(false);
    }
  };

  const handleDisconnect = async () => {
    await wakeDisconnect();
    setPushResults(null);
    await refreshStatus();
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setImportProgress({ page: 0, total: 0 });
    try {
      let pagina = 1;
      let total = 0;
      // Pull pages until the API reports no more records.
      // Each batch is persisted immediately (merge + backup).
      while (true) {
        const res = await wakeImport(pagina, 50);
        total += res.count;
        setImportProgress({ page: pagina, total });
        if (res.produtos.length) await onImport(res.produtos);
        if (!res.hasMore) break;
        pagina += 1;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na importação.');
    } finally {
      setImporting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPushResults(null);
    try {
      const payload = await getPushPayload(campos);
      if (!payload.length) {
        setError('Selecione produtos importados da Wake (com ProductID) para enviar.');
        return;
      }
      const res = await wakePush(payload);
      setPushResults(res.resultados);
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

  const connected = status?.validated;

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
            Informe o token de API da sua loja Wake. Validamos as credenciais e guardamos o token de
            forma segura — ele nunca fica exposto no navegador.
          </p>
          <label className="block text-xs font-semibold text-slate-600">Token de API Wake</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole seu token aqui"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#FF5B03] focus:border-[#FF5B03]"
                onKeyDown={(e) => { if (e.key === 'Enter') handleValidate(); }}
              />
            </div>
            <button
              onClick={handleValidate}
              disabled={validating || !token.trim()}
              className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
            >
              {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Conectar e validar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <Check className="w-4 h-4" /> Conectada e validada
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

          {/* Import */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Importar produtos</h4>
                <p className="text-xs text-slate-500">
                  Puxa os produtos da loja com descrição, categorias, imagens, SEO e metatags. Mescla por
                  ProductID e guarda um backup antes do enriquecimento.
                </p>
              </div>
              <button
                onClick={handleImport}
                disabled={importing}
                className="inline-flex items-center gap-2 bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shrink-0"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Importar produtos
              </button>
            </div>
            {importProgress && (
              <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${importing ? 'animate-spin' : ''}`} />
                {importing
                  ? `Importando página ${importProgress.page}… ${importProgress.total} produtos`
                  : `Importação concluída: ${importProgress.total} produtos`}
              </p>
            )}
          </div>

          {/* Push */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Wake</h4>
              <p className="text-xs text-slate-500">
                Envia os dados enriquecidos dos produtos selecionados de volta para a Wake.
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
            <button
              onClick={handlePush}
              disabled={pushing}
              className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
            >
              {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Enviar selecionados para Wake
            </button>

            {pushResults && (
              <div className="mt-2 border-t border-slate-100 pt-3 space-y-1.5 max-h-64 overflow-auto">
                {pushResults.map((r) => (
                  <div key={r.produtoId} className="flex items-start gap-2 text-xs">
                    {r.ok
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className="font-medium text-slate-700">{r.sku || r.produtoId}</span>
                    <span className="text-slate-500">
                      {(['descricao', 'seo', 'atributos', 'imagens'] as const)
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
    </div>
  );
};

export default WakeConnector;
