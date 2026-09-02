import React, { useState } from 'react';
import { X, RefreshCw, Check, AlertCircle, Clock, ChevronDown } from 'lucide-react';
import { INTEGRATION_META, type SendPanelState } from '../../types/integrations';

interface IntegrationSendPanelProps {
  panel: SendPanelState;
  onClose: () => void;
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
              <h3 className="font-display font-bold text-sm text-slate-900">Enviando para {meta.label}</h3>
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
              <AlertCircle className="w-3.5 h-3.5" /> {errorCount} produto{errorCount > 1 ? 's' : ''} com erro — veja o log abaixo.
            </p>
          )}
          {!panel.sending && errorCount === 0 && total > 0 && (
            <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Envio concluído com sucesso.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {panel.items.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="px-5 py-3">
                <div
                  className={`flex items-center gap-3 ${item.status === 'error' ? 'cursor-pointer' : ''}`}
                  onClick={() => { if (item.status === 'error') setExpandedId(isExpanded ? null : item.id); }}
                >
                  <div className="shrink-0">
                    {item.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                    {item.status === 'sending' && <RefreshCw className="w-4 h-4 text-[#FF5B03] animate-spin" />}
                    {item.status === 'ok' && <Check className="w-4 h-4 text-emerald-600" />}
                    {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.nome}</p>
                    <p className="text-[11px] font-mono text-slate-400">{item.sku}</p>
                  </div>
                  {item.status === 'error' && (
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  )}
                </div>
                {item.status === 'error' && isExpanded && (
                  <div className="mt-2 ml-7 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700 font-mono whitespace-pre-wrap break-words">
                    {item.log || 'Erro desconhecido ao enviar este produto.'}
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
