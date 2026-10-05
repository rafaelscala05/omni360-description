import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Upload, CloudUpload, X, Loader2, AlertCircle, ShieldCheck, KeyRound, Square, Play } from 'lucide-react';
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

export interface ProgressoImportacao {
  estado: 'rodando' | 'parando' | 'concluida' | 'parada' | 'erro';
  inicio: number;
  fim: number | null;
  lotes: number;
  produtos: number;
  chamadas: number;
  ultimo: string | null;
  /** Pausa total pedida pela Wake (429). */
  esperaLimiteMs: number;
  chamadasPorMinuto: number | null;
  /** De onde continuar se parar ou falhar. */
  cursor: string | null;
}

const duracao = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60}s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const WakeConnector: React.FC<Props> = ({ onImport, getPushPayload }) => {
  const [status, setStatus] = useState<WakeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ProgressoImportacao | null>(null);
  // Parar é pedido aqui e atendido entre um lote e outro (um lote leva até ~1 min).
  const pararRef = useRef(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!importing) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [importing]);

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

  // `continuar`: retoma do cursor onde a importação parou ou falhou, somando ao progresso.
  const handleImport = async (continuar = false) => {
    const anterior = continuar ? importProgress : null;
    setImporting(true);
    setError(null);
    pararRef.current = false;
    let p: ProgressoImportacao = anterior
      ? { ...anterior, estado: 'rodando', fim: null }
      : { estado: 'rodando', inicio: Date.now(), fim: null, lotes: 0, produtos: 0, chamadas: 0, ultimo: null, esperaLimiteMs: 0, chamadasPorMinuto: null, cursor: null };
    setImportProgress(p);
    try {
      // Lotes de 10 pelo cursor (a Wake descontinuou `pagina`), no ritmo que o
      // servidor segura. Cada lote é gravado na hora (merge + backup).
      while (true) {
        const res = await wakeImport(p.cursor, 10);
        if (res.produtos.length) await onImport(res.produtos);
        const fim = !res.hasMore || !res.proximoCursor || res.proximoCursor === p.cursor;
        p = {
          ...p,
          lotes: p.lotes + 1,
          produtos: p.produtos + res.count,
          chamadas: p.chamadas + (res.ritmo?.chamadas ?? 0),
          esperaLimiteMs: p.esperaLimiteMs + (res.ritmo?.esperaLimiteMs ?? 0),
          chamadasPorMinuto: res.ritmo?.chamadasPorMinuto ?? p.chamadasPorMinuto,
          ultimo: res.produtos[res.produtos.length - 1]?.nome || p.ultimo,
          cursor: fim ? null : res.proximoCursor,
        };
        if (fim) { p = { ...p, estado: 'concluida', fim: Date.now() }; break; }
        if (pararRef.current) { p = { ...p, estado: 'parada', fim: Date.now() }; break; }
        setImportProgress(p);
      }
    } catch (e) {
      p = { ...p, estado: 'erro', fim: Date.now() };
      setError(e instanceof Error ? e.message : 'Falha na importação.');
    } finally {
      setImportProgress(p);
      setImporting(false);
    }
  };

  const pararImportacao = () => {
    pararRef.current = true;
    setImportProgress((p) => (p ? { ...p, estado: 'parando' } : p));
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
                onClick={() => handleImport(false)}
                disabled={importing}
                className="inline-flex items-center gap-2 bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shrink-0"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Importar produtos
              </button>
            </div>
            {importProgress && <ProgressoImportacaoPainel p={importProgress} onParar={pararImportacao} onContinuar={() => handleImport(true)} />}
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

/**
 * Progresso da importação: a Wake não informa o total de produtos, então o
 * painel mostra o que já chegou, o ritmo e o porquê de ser devagar — o limite
 * de chamadas é da loja inteira, dividido com o integrador do ERP.
 */
export const ProgressoImportacaoPainel: React.FC<{ p: ProgressoImportacao; onParar: () => void; onContinuar: () => void }> = ({ p, onParar, onContinuar }) => {
  const decorrido = (p.fim ?? Date.now()) - p.inicio;
  const porMinuto = decorrido > 30_000 ? Math.round(p.produtos / (decorrido / 60_000)) : null;
  const ativo = p.estado === 'rodando' || p.estado === 'parando';
  const titulo = {
    rodando: 'Importando…',
    parando: 'Parando ao fim deste lote…',
    concluida: 'Importação concluída',
    parada: 'Importação parada',
    erro: 'Importação interrompida por um erro',
  }[p.estado];
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        {ativo
          ? <RefreshCw className="w-4 h-4 text-slate-500 animate-spin shrink-0" />
          : p.estado === 'concluida'
            ? <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            : <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />}
        <span className="text-sm font-semibold text-slate-800 flex-1">{titulo}</span>
        {p.estado === 'rodando' && (
          <button onClick={onParar} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-200">
            <Square className="w-3 h-3" /> Parar
          </button>
        )}
        {(p.estado === 'parada' || p.estado === 'erro') && p.cursor && (
          <button onClick={onContinuar} className="inline-flex items-center gap-1 text-xs font-medium text-white bg-slate-800 hover:bg-slate-900 px-2.5 py-1 rounded-md">
            <Play className="w-3 h-3" /> Continuar de onde parou
          </button>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-slate-500">Produtos</dt><dd className="text-base font-semibold text-slate-800 tabular-nums">{p.produtos.toLocaleString('pt-BR')}</dd></div>
        <div><dt className="text-slate-500">Tempo</dt><dd className="text-base font-semibold text-slate-800 tabular-nums">{duracao(decorrido)}</dd></div>
        <div><dt className="text-slate-500">Ritmo</dt><dd className="text-base font-semibold text-slate-800 tabular-nums">{porMinuto !== null ? `${porMinuto}/min` : '—'}</dd></div>
      </dl>
      {p.ultimo && <p className="text-xs text-slate-500 truncate">Último: {p.ultimo}</p>}
      {p.esperaLimiteMs > 0 && (
        <p className="text-xs text-amber-700">A Wake pediu uma pausa de {duracao(p.esperaLimiteMs)} no total — a importação esperou e seguiu.</p>
      )}
      {ativo && (
        <p className="text-xs text-slate-500">
          Ritmo limitado a {p.chamadasPorMinuto ?? 36} chamadas por minuto (30% do limite da Wake), para não travar a integração
          do ERP — estourar o limite bloqueia o token por 1 hora. Mantenha esta tela aberta; cada lote de 10 já fica salvo.
        </p>
      )}
      {p.estado === 'parada' && <p className="text-xs text-slate-500">Os {p.produtos.toLocaleString('pt-BR')} produtos já importados estão salvos.</p>}
    </div>
  );
};

export default WakeConnector;
