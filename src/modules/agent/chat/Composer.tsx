import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Square } from 'lucide-react';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onEnviar: (texto: string) => void;
  onParar: () => void;
  placeholder?: string;
  /** Foco/desfoco do campo — a tela usa isso para entrar no modo foco no telefone. */
  onFoco?: (focado: boolean) => void;
  /** Quanto o teclado virtual está cobrindo, em px (ver useAlturaTeclado). */
  recuoTeclado?: number;
  /** true no telefone com o campo focado: o composer assume a tela. */
  emFoco?: boolean;
}

const Composer: React.FC<Props> = ({
  disabled, streaming, onEnviar, onParar, placeholder, onFoco, recuoTeclado = 0, emFoco = false,
}) => {
  const [texto, setTexto] = useState('');
  const [focado, setFocado] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Cresce com o conteúdo até um teto, como no Claude. No modo foco o teto
  // sobe: com o teclado aberto a tela é só o campo, então não há o que
  // empurrar para fora.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, emFoco ? 320 : 220)}px`;
  }, [texto, emFoco]);

  const enviar = () => {
    if (disabled || streaming) return;
    if (!texto.trim()) return;
    onEnviar(texto.trim());
    setTexto('');
  };

  const trocarFoco = (v: boolean) => {
    setFocado(v);
    onFoco?.(v);
  };

  const podeEnviar = !disabled && !!texto.trim();

  return (
    <div
      className="px-3 sm:px-4 pt-2 shrink-0 transition-[padding] duration-200"
      style={{
        // O teclado cobre a viewport em vez de encolhê-la (iOS), então o recuo
        // tem que ser aplicado aqui ou o campo fica atrás dele.
        paddingBottom: recuoTeclado
          ? recuoTeclado + 12
          : 'calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="max-w-3xl mx-auto">
        {emFoco && (
          <div className="flex justify-center pb-2">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => areaRef.current?.blur()}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-medium text-[var(--ag-text-3)]"
              style={{ background: 'var(--ag-fill)' }}
            >
              <ChevronDown className="w-3.5 h-3.5" /> fechar
            </button>
          </div>
        )}

        <div
          className="ag-glass-strong rounded-[26px] overflow-hidden transition-all duration-200"
          style={{
            borderColor: focado ? 'var(--ag-accent)' : 'var(--ag-hairline)',
            boxShadow: focado
              ? 'inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 4px var(--ag-accent-soft), var(--ag-shadow-lg)'
              : 'inset 0 1px 0 rgba(255,255,255,.35), var(--ag-shadow)',
          }}
        >
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onFocus={() => trocarFoco(true)}
            onBlur={() => trocarFoco(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? 'Pergunte algo ou peça uma ação…'}
            // 16px não é escolha estética: abaixo disso o Safari do iOS dá zoom
            // no campo ao focar e a tela inteira sai do lugar.
            className="ag-scroll w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[16px] leading-[1.5] text-[var(--ag-text)] placeholder:text-[var(--ag-text-3)] focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between pl-5 pr-2.5 pb-2.5">
            <span className="text-[11px] text-[var(--ag-text-3)] hidden sm:block">
              Enter envia · Shift+Enter quebra linha
            </span>
            <span className="text-[11px] text-[var(--ag-text-3)] sm:hidden">
              Nada é alterado sem aprovação
            </span>

            {streaming ? (
              <button
                onClick={onParar}
                title="Parar"
                className="w-10 h-10 rounded-full grid place-items-center transition-transform active:scale-95"
                style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={enviar}
                disabled={!podeEnviar}
                title="Enviar"
                className="w-10 h-10 rounded-full grid place-items-center transition-all duration-200 active:scale-95 disabled:cursor-not-allowed"
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
