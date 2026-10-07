// Copiar com retorno: o ícone vira check (girando no eixo X) por 1,2 s e o
// rótulo diz "Copiado". Antes, vários botões "Copiar" não davam sinal nenhum.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { avisar } from '../../services/avisos';

/** [copiado, copiar(texto)] — `copiado` volta a false sozinho. */
export function useCopiar(ms = 1200): [boolean, (texto: string | null | undefined) => void] {
  const [copiado, setCopiado] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const copiar = useCallback((texto: string | null | undefined) => {
    if (!texto) return;
    navigator.clipboard.writeText(texto).then(
      () => {
        setCopiado(true);
        clearTimeout(t.current);
        t.current = setTimeout(() => setCopiado(false), ms);
      },
      () => avisar.erro('Não foi possível copiar. Selecione o texto e copie à mão.'),
    );
  }, [ms]);
  return [copiado, copiar];
}

/** Ícone + rótulo que trocam juntos. */
export const RotuloCopiar: React.FC<{ copiado: boolean; rotulo?: string; className?: string }> = ({ copiado, rotulo = 'Copiar', className = 'w-4 h-4' }) => (
  <>
    <span key={copiado ? 'ok' : 'copiar'} className="inline-flex ag-vira">
      {copiado ? <Check className={className} style={{ color: 'var(--ag-ok, #12a150)' }} /> : <Copy className={className} />}
    </span>
    {rotulo && (copiado ? 'Copiado' : rotulo)}
  </>
);
