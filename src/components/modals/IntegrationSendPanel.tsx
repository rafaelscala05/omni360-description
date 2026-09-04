import React, { useState } from 'react';
import { X, RefreshCw, Check, AlertCircle, Clock, ChevronDown } from 'lucide-react';
import { INTEGRATION_META, type PushLogEntry, type SendPanelState } from '../../types/integrations';

interface IntegrationSendPanelProps {
  panel: SendPanelState;
  onClose: () => void;
}

// "2,1 KB" / "840 B" — shown next to long values so the user knows the real size
// behind a truncated preview.
function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1).replace('.', ',')} KB` : `${bytes} B`;
}

// One written field: the label plus the content that reached the ERP.
function LogCampo({ entry }: { entry: PushLogEntry }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
        {entry.campo}
        {entry.valor !== undefined && entry.bytes !== undefined && entry.bytes >= 1024 && (
          <span className="font-normal text-slate-400">({formatBytes(entry.bytes)})</span>
        )}
      </p>
      {entry.itens ? (
        <ul className="ml-4.5 space-y-0.5">
          {entry.itens.map((u) => (
            <li key={u} className="text-[11px] font-mono text-slate-500 break-all">{u}</li>
          ))}
          {entry.truncado && entry.bytes !== undefined && (
            <li className="text-[11px] text-slate-400">… e mais {entry.bytes - entry.itens.length}</li>
          )}
        </ul>
      ) : (
        <p className="ml-4.5 text-[11px] text-slate-600 font-mono whitespace-pre-wrap break-words line-clamp-6">
          {entry.valor}
          {entry.truncado && <span className="text-slate-400"> (conteúdo cortado na exibição)</span>}
        </p>
      )}
    </div>
  );
}

export default function IntegrationSendPanel({ panel, onClose }: IntegrationSendPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const meta = INTEGRATION_META[panel.integration];
  const total = panel.items.length;
  const done = panel.items.filter((it) => it.status === 'ok' || it.status === 'error').length;
  const errorCount = panel.items.filter((it) => it.status === 'error').length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${panel.open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ${panel.open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border ${meta.className}`}>
              <meta.Icon className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-display font-bold text-sm text-slate-900">
                {panel.sending ? `Enviando para ${meta.label}` : `Envio para ${meta.label}`}
              </h3>
              <p className="text-xs text-slate-500">{done} de {total} produtos processados</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${errorCount > 0 && !panel.sending ? 'bg-red-500' : 'bg-[#FF5B03]'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!panel.sending && errorCount > 0 && (
            <p className="text-xs text-red-600 font-medium mt-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {errorCount} produto{errorCount > 1 ? 's' : ''} com erro — clique para ver o motivo.
            </p>
          )}
          {!panel.sending && errorCount === 0 && total > 0 && (
            <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Envio concluído. Clique num produto para ver o que foi enviado.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {panel.items.map((item) => {
            const isExpanded = expandedId === item.id;
            const enviado = item.enviado ?? [];
            const concluido = item.status === 'ok' || item.status === 'error';
            // Every finished product opens: on success to show what was written,
            // on failure to show why. Closed by default either way.
            const expansivel = concluido;
            return (
              <div key={item.id} className="px-5 py-3">
                <div
                  className={`flex items-center gap-3 ${expansivel ? 'cursor-pointer' : ''}`}
                  onClick={() => { if (expansivel) setExpandedId(isExpanded ? null : item.id); }}
                >
                  <div className="shrink-0">
                    {item.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                    {item.status === 'sending' && <RefreshCw className="w-4 h-4 text-[#FF5B03] animate-spin" />}
                    {item.status === 'ok' && <Check className="w-4 h-4 text-emerald-600" />}
                    {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.nome}</p>
                    <p className="text-[11px] font-mono text-slate-400">
                      {item.sku}
                      {item.status === 'ok' && (
                        <span className="ml-2 font-sans text-slate-400">
                          {enviado.length > 0
                            ? `${enviado.length} campo${enviado.length > 1 ? 's' : ''} enviado${enviado.length > 1 ? 's' : ''}`
                            : 'nada alterado'}
                        </span>
                      )}
                    </p>
                  </div>
                  {expansivel && (
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  )}
                </div>

                {isExpanded && item.status === 'error' && (
                  <div className="mt-2 ml-7 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700 font-mono whitespace-pre-wrap break-words">
                    {item.log || 'Erro desconhecido ao enviar este produto.'}
                  </div>
                )}

                {isExpanded && item.status === 'ok' && (
                  <div className="mt-2 ml-7 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                    {enviado.length > 0 ? (
                      enviado.map((entry, i) => <LogCampo key={`${entry.campo}-${i}`} entry={entry} />)
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        Nada foi gravado neste produto — os dados locais já eram iguais aos do {meta.label}.
                      </p>
                    )}
                    {item.log && (
                      <p className="text-[11px] text-slate-400 pt-1.5 border-t border-slate-200 break-words">
                        Não enviado — {item.log}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
