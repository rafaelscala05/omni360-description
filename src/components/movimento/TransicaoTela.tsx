// Contêiner da tela atual: ao trocar de `chave`, o conteúdo novo entra pelo
// lado de onde o usuário "foi" (direita ao avançar nas portas, esquerda ao
// voltar). Ver .ag-tela-entra no index.css para o porquê de ser só entrada.

import React, { useRef } from 'react';
import { direcaoEntre } from '../../modules/agent/movimento';

const TransicaoTela: React.FC<{ chave: string; children: React.ReactNode }> = ({ chave, children }) => {
  const anterior = useRef(chave);
  const dir = useRef<1 | -1>(1);
  if (anterior.current !== chave) {
    dir.current = direcaoEntre(anterior.current, chave);
    anterior.current = chave;
  }
  return (
    <div key={chave} className="ag-tela-entra" style={{ ['--ag-dir' as string]: dir.current }}>
      {children}
    </div>
  );
};

export default TransicaoTela;
