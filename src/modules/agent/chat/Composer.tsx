import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onEnviar: (texto: string) => void;
  onParar: () => void;
  placeholder?: string;
}

const Composer: React.FC<Props> = ({ disabled, streaming, onEnviar, onParar, placeholder }) => {
  const [texto, setTexto] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Cresce com o conteúdo até um teto, como no Claude.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  const enviar = () => {
    if (disabled || streaming) return;
    if (!texto.trim()) return;
    onEnviar(texto.trim());
    setTexto('');
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm focus-within:border-slate-300 transition-colors">
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? 'Pergunte algo ou peça uma ação…'}
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="text-[11px] text-slate-400 ml-1.5">Enter envia · Shift+Enter quebra linha</span>
            {streaming ? (
              <button
                onClick={onParar}
                title="Parar"
                className="p-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={enviar}
                disabled={disabled || !texto.trim()}
                title="Enviar"
                className="p-2 rounded-lg bg-[#FF5B03] text-white hover:bg-[#e65003] disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Composer;
