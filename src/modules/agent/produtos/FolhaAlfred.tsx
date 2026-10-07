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
  // `origem` é onde o dedo encostou (distância); `janela` e `ultimo` medem a
  // velocidade dos últimos ~80 ms.
  const origem = useRef<number | null>(null);
  const inicio = useRef<{ y: number; t: number } | null>(null);
  const ultimo = useRef<{ y: number; t: number } | null>(null);
  const [arrasto, setArrasto] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const soltar = () => {
    // Velocidade dos últimos ~80 ms (px/ms): um peteleco curto conta como
    // gesto, mesmo sem chegar ao limite de distância.
    const v = inicio.current && ultimo.current
      ? (ultimo.current.y - inicio.current.y) / Math.max(1, ultimo.current.t - inicio.current.t)
      : 0;
    if (arrasto > 80 || v > 0.6) onAltura(altura === 'cheia' ? 'meia' : 'fechada');
    else if (arrasto < -60 || v < -0.6) onAltura('cheia');
    origem.current = null;
    inicio.current = null;
    ultimo.current = null;
    setArrastando(false);
    setArrasto(0);
  };
  const puxador = (
    <button
      data-sem-toque
      className="w-full pt-2 pb-1.5 flex flex-col items-center gap-1 touch-none"
      onClick={() => onAltura(altura === 'fechada' ? 'meia' : altura === 'meia' ? 'cheia' : 'meia')}
      onPointerDown={(e) => {
        origem.current = e.clientY;
        inicio.current = { y: e.clientY, t: e.timeStamp };
        ultimo.current = inicio.current;
        setArrastando(true);
      }}
      onPointerMove={(e) => {
        if (origem.current === null) return;
        if (inicio.current && ultimo.current && e.timeStamp - inicio.current.t > 80) inicio.current = ultimo.current;
        ultimo.current = { y: e.clientY, t: e.timeStamp };
        setArrasto(e.clientY - origem.current);
      }}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      aria-label={altura === 'fechada' ? 'Abrir o Alfred' : 'Redimensionar o painel do Alfred'}
    >
      <span
        className="w-10 h-1 rounded-full transition-[width,background-color] duration-150"
        style={{ background: arrastando ? 'var(--ag-text-3)' : 'var(--ag-hairline-2)', width: arrastando ? 48 : undefined }}
      />
      {altura === 'fechada' && <span className="text-[12.5px] font-semibold text-[var(--ag-text-2)]">Alfred</span>}
    </button>
  );
  // Relativo à coluna da tela (não à viewport): a coluna já desconta a barra do
  // topo e a margem da tab bar, e 88dvh cortava o composer em telefone pequeno.
  const h = altura === 'cheia' ? 'calc(100% - 8px)' : altura === 'meia' ? '55%' : 'auto';
  // Para baixo a folha acompanha o dedo; para cima ela resiste (elástico), já
  // que não há para onde ir além da altura cheia.
  const deslocamento = arrasto > 0 ? arrasto : -Math.sqrt(-arrasto) * 3;
  return (
    <div
      className="ag-glass-strong rounded-t-[24px] flex flex-col min-h-0 shrink-0"
      style={{
        height: h,
        transform: arrasto ? `translate3d(0, ${deslocamento}px, 0)` : undefined,
        borderTop: '1px solid var(--ag-hairline)',
        transition: arrastando
          ? undefined
          : 'height 340ms cubic-bezier(0.32, 0.72, 0, 1), transform 380ms cubic-bezier(0.34, 1.36, 0.64, 1)',
      }}
    >
      {puxador}
      {altura !== 'fechada' && <div className="flex-1 min-h-0 ag-rise">{children}</div>}
    </div>
  );
};

export default FolhaAlfred;
