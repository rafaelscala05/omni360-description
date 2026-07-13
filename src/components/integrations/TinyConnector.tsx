import React, { useEffect, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import {
  tinyStatus, tinyConnect, tinyImport, tinyPush, tinyDisconnect,
  type TinyStatus, type TinyNormalizedProduct, type TinyPushProduct, type TinyPushResult,
} from '../../services/tinyService';

export type TinyPushFields = TinyPushProduct['campos'];

interface Props {
  // Persists an imported batch into the app (merge by tinyId + backup).
  onImport: (produtos: TinyNormalizedProduct[]) => Promise<void>;
  // Builds the push payload from the currently selected products and chosen fields.
  getPushPayload: (campos: TinyPushFields) => Promise<TinyPushProduct[]>;
}

const FIELD_LABELS: { key: keyof TinyPushFields; label: string }[] = [
  { key: 'descricao', label: 'Descrição complementar' },
  { key: 'seo', label: 'SEO (título/descrição/keywords)' },
  { key: 'fiscal', label: 'Fiscais (NCM, GTIN, peso, dimensões)' },
  { key: 'imagens', label: 'Imagens (anexos por URL)' },
];

const TinyConnector: React.FC<Props> = ({ onImport, getPushPayload }) => {
  const [status, setStatus] = useState<TinyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ page: number; total: number } | null>(null);

  const [pushing, setPushing] = useState(false);
  const [campos, setCampos] = useState<TinyPushFields>({ descricao: true, seo: true, fiscal: true, imagens: true });
  const [pushResults, setPushResults] = useState<TinyPushResult[] | null>(null);

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

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await tinyConnect();
      // The popup posts back on success; re-check the server-side status either way.
      const s = await refreshStatus();
      if (!s.validated) setError('Conexão não concluída. Tente novamente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar ao Tiny.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await tinyDisconnect();
    setPushResults(null);
    await refreshStatus();
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setImportProgress({ page: 0, total: 0 });
    try {
      let offset = 0;
      const limit = 50;
      let total = 0;
      let page = 0;
      // Pull pages until the API reports no more records. Each batch is persisted
      // immediately (merge + backup).
      while (true) {
        const res = await tinyImport(offset, limit);
        total += res.count;
        page += 1;
        setImportProgress({ page, total });
        if (res.produtos.length) await onImport(res.produtos);
        if (!res.hasMore || res.count === 0) break;
        offset += res.count;
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
        setError('Selecione produtos importados do Tiny (com ID Tiny) para enviar.');
        return;
      }
      const res = await tinyPush(payload);
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
            Conecte sua conta Tiny ERP. Você será levado à tela de autorização do Tiny e, ao
            aprovar, os tokens de acesso ficam guardados com segurança no servidor — nunca no navegador.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Conectar conta Tiny
          </button>
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
                  Puxa os produtos do Tiny com descrição, SEO, dados fiscais, dimensões e imagens.
                  Mescla por ID Tiny e guarda um backup antes do enriquecimento.
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
              <h4 className="text-sm font-semibold text-slate-800">Enviar para Tiny</h4>
              <p className="text-xs text-slate-500">
                Envia os dados enriquecidos dos produtos selecionados de volta para o Tiny.
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
            <button
              onClick={handlePush}
              disabled={pushing}
              className="inline-flex items-center gap-2 bg-[#FF5B03] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#003a9e] disabled:opacity-50 transition-colors"
            >
              {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Enviar selecionados para Tiny
            </button>

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
    </div>
  );
};

export default TinyConnector;
