import React, { useRef, useState } from 'react';

type Altura = 'fechada' | 'meia' | 'cheia';

interface Props {
  altura: Altura;
  onAltura: (a: Altura) => void;
  children: React.ReactNode;
}

/**
 * O painel do Alfred no telefone: folha que sobe da base. Meia altura ao abrir
 * por uma ação; o puxador alterna meia/cheia; arrastar para baixo fecha.
 * Fechada, vira só o puxador "Alfred" acima da barra.
 */
const FolhaAlfred: React.FC<Props> = ({ altura, onAltura, children }) => {
  const inicio = useRef<number | null>(null);
  const [arrasto, setArrasto] = useState(0);
  const soltar = () => {
    if (arrasto > 80) onAltura(altura === 'cheia' ? 'meia' : 'fechada');
    else if (arrasto < -60) onAltura('cheia');
    inicio.current = null;
    setArrasto(0);
  };
  const puxador = (
    <button
      className="w-full pt-2 pb-1.5 flex flex-col items-center gap-1 touch-none"
      onClick={() => onAltura(altura === 'fechada' ? 'meia' : altura === 'meia' ? 'cheia' : 'meia')}
      onPointerDown={(e) => { inicio.current = e.clientY; }}
      onPointerMove={(e) => { if (inicio.current !== null) setArrasto(e.clientY - inicio.current); }}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      aria-label={altura === 'fechada' ? 'Abrir o Alfred' : 'Redimensionar o painel do Alfred'}
    >
      <span className="w-10 h-1 rounded-full" style={{ background: 'var(--ag-hairline-2)' }} />
      {altura === 'fechada' && <span className="text-[12.5px] font-semibold text-[var(--ag-text-2)]">Alfred</span>}
    </button>
  );
  const h = altura === 'cheia' ? '88dvh' : altura === 'meia' ? '52dvh' : 'auto';
  return (
    <div
      className="ag-glass-strong rounded-t-[24px] flex flex-col min-h-0 shrink-0"
      style={{ height: h, transform: arrasto > 0 ? `translateY(${arrasto}px)` : undefined, borderTop: '1px solid var(--ag-hairline)', transition: inicio.current === null ? 'height 220ms ease' : undefined }}
    >
      {puxador}
      {altura !== 'fechada' && <div className="flex-1 min-h-0">{children}</div>}
    </div>
  );
};

export default FolhaAlfred;
