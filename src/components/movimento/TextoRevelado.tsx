// Texto gerado pela IA surgindo palavra a palavra, mesmo quando a resposta
// chega inteira. Só anima o texto que *mudou* com o componente montado; o
// texto que já estava lá ao abrir aparece pronto. Teto de duração: textos
// longos aceleram, para nenhuma descrição levar mais de ~1,6 s para assentar.

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  texto: string;
  className?: string;
  /** Força animar mesmo na primeira renderização. */
  animarAoMontar?: boolean;
}

const TETO_MS = 1600;

const TextoRevelado: React.FC<Props> = ({ texto, className, animarAoMontar }) => {
  const anterior = useRef<string | null>(animarAoMontar ? null : texto);
  const [versao, setVersao] = useState(animarAoMontar ? 1 : 0);

  useEffect(() => {
    if (anterior.current !== null && anterior.current !== texto && texto) setVersao((v) => v + 1);
    anterior.current = texto;
  }, [texto]);

  if (versao === 0) return <span className={className}>{texto}</span>;

  const partes = texto.split(/(\s+)/);
  const palavras = partes.filter((p) => p.trim()).length || 1;
  const passo = Math.min(28, TETO_MS / palavras);
  let i = 0;

  return (
    <span className={className} key={versao}>
      {partes.map((p, idx) =>
        p.trim() ? (
          <span key={idx} className="ag-palavra" style={{ animationDelay: `${Math.round(i++ * passo)}ms` }}>
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
};

export default TextoRevelado;
