import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onEnviar: (texto: string) => void;
  onParar: () => void;
  placeholder?: string;
}

const ContentComposer: React.FC<Props> = ({ disabled, streaming, onEnviar, onParar, placeholder }) => {
  const [texto, setTexto] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

  const enviar = () => {
    if (disabled || streaming) return;
    if (!texto.trim()) return;
    onEnviar(texto.trim());
    setTexto('');
  };

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="rounded-2xl border border-ink/15 bg-white shadow-sm focus-within:border-ink/30 transition-colors">
        <textarea
          ref={areaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
          }}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? 'Peça algo ao Agente de Conteúdo…'}
          className="w-full resize-none bg-transparent px-3.5 py-3 text-[14px] text-ink placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-2.5 pb-2.5">
          <span className="text-[11px] text-slate-400">Enter envia · Shift+Enter quebra linha</span>
          {streaming ? (
            <button
              onClick={onParar}
              title="Parar"
              className="p-2 rounded-lg bg-ink text-white hover:bg-ink/80 transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={enviar}
              disabled={disabled || !texto.trim()}
              title="Enviar"
              className="p-2 rounded-lg bg-orange text-white hover:bg-orange/90 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContentComposer;
