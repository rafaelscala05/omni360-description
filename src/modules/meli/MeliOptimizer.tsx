import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, ShieldCheck, Store, Unplug, X } from 'lucide-react';
import {
  connectMeli,
  disconnectMeli,
  getMeliJob,
  listMeliListings,
  meliConnection,
  startMeliSync,
  type MeliConnection,
  type MeliListing,
  type MeliListingStatus,
  type MeliSyncJob,
} from '../../services/meliService';

const STATUS_LABEL: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Encerrado' };
const terminal = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

function qualityMissing(listing: MeliListing): string[] {
  const adoption = listing.catalogQuality?.adoption_status;
  const groups = adoption && typeof adoption === 'object' ? Object.values(adoption) as any[] : [];
  return [...new Set(groups.flatMap((group) => Array.isArray(group?.missing_attributes) ? group.missing_attributes : []))];
}

function Score({ value, label }: { value?: number; label?: string }) {
  const score = typeof value === 'number' ? Math.round(value) : null;
  const color = score == null ? 'text-slate-400' : score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="text-right shrink-0">
      <div className={`text-2xl font-black leading-none ${color}`}>{score ?? '—'}</div>
      <div className="text-[10px] text-slate-400 mt-1">{label || 'Score oficial'}</div>
    </div>
  );
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
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const nextConnection = await meliConnection();
    setConnection(nextConnection);
    if (nextConnection.connected) {
      const result = await listMeliListings();
      setListings(result.listings);
    } else {
      setListings([]);
    }
  };

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao abrir o módulo.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!job || terminal.has(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await getMeliJob(job.id).catch(() => null);
      if (!next) return;
      setJob(next);
      if (terminal.has(next.status)) await load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const visible = useMemo(() => listings.filter((listing) => {
    if (filter && listing.status !== filter) return false;
    const query = search.trim().toLowerCase();
    return !query || listing.title.toLowerCase().includes(query) || listing.itemId.toLowerCase().includes(query);
  }), [filter, listings, search]);

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const result = await connectMeli();
      if (!result.ok) throw new Error(result.message || 'A autorização não foi concluída.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao conectar.');
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError(null);
    try { await disconnectMeli(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao desconectar.'); }
    finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true); setError(null);
    try { setJob(await startMeliSync(filter ? [filter] : ['active', 'paused', 'closed'])); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao iniciar sincronização.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Abrindo Agente MELI…</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-in fade-in">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FFE600] flex items-center justify-center shadow-sm shrink-0">
            <Store className="w-5 h-5 text-slate-900" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black text-slate-900">Agente MELI</h1>
              <span className="text-[10px] uppercase tracking-wide font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">Modo auditoria</span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Otimizador assistido de anúncios do Mercado Livre.</p>
          </div>
        </div>
        {connection?.connected && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-2">
              <Check className="w-3.5 h-3.5" /> Seller {connection.sellerId} · {connection.siteId}
            </span>
            <button onClick={disconnect} disabled={busy} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 px-2 py-2 disabled:opacity-50">
              <Unplug className="w-3.5 h-3.5" /> Desconectar
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {!connection?.configured ? (
        <section className="bg-white border border-amber-200 rounded-2xl p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">Configuração do servidor pendente</h2>
          <p className="text-sm text-slate-600 mt-2 max-w-3xl">Antes de conectar, configure o App ID, Secret Key, redirect URI e a chave de criptografia nos secrets do ambiente. Nenhuma credencial deve ser colocada no navegador ou enviada ao modelo de IA.</p>
        </section>
      ) : !connection.connected ? (
        <section className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm">
          <div className="max-w-2xl">
            <ShieldCheck className="w-8 h-8 text-blue-600 mb-3" />
            <h2 className="text-lg font-bold text-slate-900">Conecte a conta principal do vendedor</h2>
            <p className="text-sm text-slate-600 mt-2">A autorização acontece diretamente no Mercado Livre. Os tokens ficam cifrados no backend e nunca são devolvidos para este navegador.</p>
            {connection.status === 'reauthorization_required' && <p className="text-sm text-amber-700 mt-2">A autorização anterior expirou ou foi revogada. Conecte novamente.</p>}
            <button onClick={connect} disabled={busy} className="mt-5 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Conectar Mercado Livre
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="relative flex-1 max-w-lg">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título ou MLB…" className="w-full border border-slate-200 bg-slate-50 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <button onClick={sync} disabled={busy || (job != null && !terminal.has(job.status))} className="inline-flex justify-center items-center gap-2 bg-[#FFE600] hover:bg-[#f1d900] text-slate-900 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50">
                {job && !terminal.has(job.status) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar anúncios
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              {(['', 'active', 'paused', 'closed'] as const).map((value) => (
                <button key={value || 'all'} onClick={() => setFilter(value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap ${filter === value ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>
                  {value ? STATUS_LABEL[value] : 'Todos'} {value ? `(${listings.filter((item) => item.status === value).length})` : `(${listings.length})`}
                </button>
              ))}
              {connection.lastSyncedAt && <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">Última sync: {new Date(connection.lastSyncedAt).toLocaleString('pt-BR')}</span>}
            </div>
            {job && (
              <div className={`rounded-xl border p-3 ${job.status === 'failed' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-100'}`}>
                <div className="flex justify-between text-xs font-semibold text-slate-700"><span>{job.lastStep}</span><span>{job.progress}%</span></div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden mt-2"><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${job.progress}%` }} /></div>
                {job.error && <p className="text-xs text-red-700 mt-2">{job.error}</p>}
              </div>
            )}
          </section>

          <section className="space-y-2">
            {visible.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-14 text-center text-sm text-slate-500">Nenhum anúncio sincronizado neste filtro.</div>
            ) : visible.map((listing) => {
              const missing = qualityMissing(listing);
              return (
                <button key={listing.itemId} onClick={() => setSelected(listing)} className="w-full text-left bg-white border border-slate-200 hover:border-blue-300 rounded-2xl p-4 shadow-sm transition-colors flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0">{listing.thumbnail && <img src={listing.thumbnail} alt="" className="w-full h-full object-contain" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 items-center"><span className="text-[10px] font-bold uppercase text-slate-400">{listing.itemId}</span><span className="text-[10px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{STATUS_LABEL[listing.status] || listing.status}</span></div>
                    <h3 className="text-sm font-bold text-slate-900 truncate mt-1">{listing.title}</h3>
                    <p className={`text-xs mt-1 ${missing.length ? 'text-amber-700' : 'text-slate-400'}`}>{missing.length ? `${missing.length} atributo(s) apontado(s) como ausente(s)` : `${listing.pictures?.length || 0} imagens · ${listing.attributes?.length || 0} atributos`}</p>
                  </div>
                  <Score value={listing.performance?.score} label={listing.performance?.level_wording || 'Score oficial'} />
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              );
            })}
          </section>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={() => setSelected(null)}>
          <aside className="w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 p-4 flex items-center justify-between z-10"><div><p className="text-[10px] font-bold text-slate-400">{selected.itemId}</p><h2 className="font-bold text-slate-900 line-clamp-1">{selected.title}</h2></div><button onClick={() => setSelected(null)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-3"><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Score oficial</p><p className="text-xl font-black text-slate-900">{selected.performance?.score ?? '—'}</p></div><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Imagens</p><p className="text-xl font-black text-slate-900">{selected.pictures?.length || 0}</p></div><div className="border rounded-xl p-3"><p className="text-[10px] text-slate-400">Atributos</p><p className="text-xl font-black text-slate-900">{selected.attributes?.length || 0}</p></div></div>
              {(selected.userProductId || selected.catalogProductId) && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs"><strong>Atenção ao alcance:</strong> este anúncio está associado a {selected.userProductId ? `User Product ${selected.userProductId}` : `catálogo ${selected.catalogProductId}`}. Futuras alterações poderão afetar recursos compartilhados.</div>}
              {qualityMissing(selected).length > 0 && <div><h3 className="text-sm font-bold text-slate-900 mb-2">Ausências apontadas pelo Mercado Livre</h3><div className="flex flex-wrap gap-1.5">{qualityMissing(selected).map((id) => <span key={id} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-1">{id}</span>)}</div></div>}
              <div><h3 className="text-sm font-bold text-slate-900 mb-2">Descrição atual</h3><div className="whitespace-pre-wrap text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 max-h-64 overflow-y-auto">{selected.descriptionPlainText || 'Sem descrição.'}</div></div>
              <div><h3 className="text-sm font-bold text-slate-900 mb-2">Ficha técnica atual</h3><div className="border border-slate-200 rounded-xl divide-y max-h-72 overflow-y-auto">{selected.attributes?.map((attribute) => <div key={attribute.id} className="flex justify-between gap-4 p-3 text-xs"><span className="text-slate-500">{attribute.name || attribute.id}</span><span className="font-semibold text-slate-800 text-right">{attribute.value_name || '—'}</span></div>)}</div></div>
              {selected.permalink && <a href={selected.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800"><ExternalLink className="w-4 h-4" /> Abrir anúncio no Mercado Livre</a>}
              <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-3 text-xs"><strong>Proteção ativa:</strong> esta primeira versão opera somente em leitura. Análise Alfreds, propostas e aplicação assistida serão habilitadas sobre snapshots e aprovação por campo.</div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
