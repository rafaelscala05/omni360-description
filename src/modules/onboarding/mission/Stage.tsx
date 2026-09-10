// O palco: mostra o que o agente está lendo e o artefato se materializando.
//
// Um componente só, usado pelas duas missões e pelos dois renderizadores.
// No desktop ocupa a coluna direita; no mobile é um cartão dentro da conversa.
// Cada linha do log corresponde a uma leitura que o agente de fato fez — não
// é enfeite, é o que faz a espera valer a pena.

import React from 'react';

export interface StageLogLine {
  /** 'feito' já aconteceu; 'agora' é a linha em andamento. */
  estado: 'feito' | 'agora';
  texto: string;
  /** Trecho em destaque dentro da linha (o número, o nome do arquivo). */
  destaque?: string;
}

export interface StageProps {
  titulo: string;
  linhas: StageLogLine[];
  /** Conteúdo materializando — a descrição sendo escrita, o preview do blog. */
  children?: React.ReactNode;
}

const Stage: React.FC<StageProps> = ({ titulo, linhas, children }) => (
  <div className="flex flex-col gap-3">
    <div className="bg-[#141311] text-[#E8E0D5] rounded-2xl p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#E8E0D5]/50">
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5B03] animate-pulse motion-reduce:animate-none" />
        {titulo}
      </div>
      <div className="font-mono text-[11px] leading-relaxed flex flex-col" aria-live="polite">
        {linhas.map((l, i) => (
          <span key={i} className={l.estado === 'agora' ? 'text-[#E8E0D5]' : 'text-[#E8E0D5]/60'}>
            {l.estado === 'feito' ? <span className="text-[#FF5B03]">✓ </span> : '→ '}
            {l.destaque ? (
              <>
                <span className="text-[#E8E0D5] font-medium">{l.destaque}</span> {l.texto}
              </>
            ) : (
              l.texto
            )}
          </span>
        ))}
      </div>
    </div>
    {children}
  </div>
);

export default Stage;
