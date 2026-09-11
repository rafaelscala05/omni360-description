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
  const [focado, setFocado] = useState(false);
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

  const podeEnviar = !disabled && !!texto.trim();

  return (
    <div className="px-4 pb-4 pt-2 shrink-0">
      <div className="max-w-3xl mx-auto">
        <div
          className="ag-glass-strong rounded-[26px] overflow-hidden transition-all duration-200"
          style={{
            borderColor: focado ? 'var(--ag-accent)' : 'var(--ag-hairline)',
            boxShadow: focado
              ? 'inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 4px var(--ag-accent-soft), var(--ag-shadow)'
              : 'inset 0 1px 0 rgba(255,255,255,.35), var(--ag-shadow)',
          }}
        >
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onFocus={() => setFocado(true)}
            onBlur={() => setFocado(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? 'Pergunte algo ou peça uma ação…'}
            className="ag-scroll w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-[1.5] text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)] focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between pl-5 pr-2.5 pb-2.5">
            <span className="text-[11px] text-[var(--ag-text-3)] hidden sm:block">
              Enter envia · Shift+Enter quebra linha
            </span>
            <span className="text-[11px] text-[var(--ag-text-3)] sm:hidden">Nada é alterado sem aprovação</span>

            {streaming ? (
              <button
                onClick={onParar}
                title="Parar"
                className="w-9 h-9 rounded-full grid place-items-center transition-transform active:scale-95"
                style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={enviar}
                disabled={!podeEnviar}
                title="Enviar"
                className="w-9 h-9 rounded-full grid place-items-center transition-all duration-200 active:scale-95 disabled:cursor-not-allowed"
                style={{
                  background: podeEnviar ? 'var(--ag-accent)' : 'var(--ag-fill-2)',
                  color: podeEnviar ? 'var(--ag-accent-ink)' : 'var(--ag-text-3)',
                  boxShadow: podeEnviar ? '0 8px 20px -8px var(--ag-accent)' : 'none',
                }}
              >
                <ArrowUp className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Composer;
