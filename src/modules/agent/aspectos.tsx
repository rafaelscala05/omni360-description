// Aspectos de um produto — descrição, atributos, fotos, vídeo — com um ícone e
// uma cor cada, os mesmos na aba Produtos, na tabela completa e no modal do
// produto. A cor responde "qual aspecto"; o fundo responde "feito ou não"
// (tingido quando feito, neutro quando falta). Âmbar continua sendo só "falta
// e é obrigatório" (descrição, foto) — ver `COR_PILULA` em ProdutosAgenteScreen.
//
// Tokens `--ag-asp-*` (index.css): quem monta precisa estar num escopo `.alfreds`.

import type React from 'react';
import { Camera, Clapperboard, FileText, Images, Tag, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type Aspecto = 'descricao' | 'atributos' | 'foto' | 'ambientada' | 'imagens' | 'video';

export const ASPECTO: Record<Aspecto, { rotulo: string; Icone: LucideIcon; cor: string }> = {
  descricao: { rotulo: 'Descrição', Icone: FileText, cor: 'var(--ag-asp-descricao)' },
  atributos: { rotulo: 'Atributos', Icone: Tag, cor: 'var(--ag-asp-atributos)' },
  foto: { rotulo: 'Foto', Icone: Camera, cor: 'var(--ag-asp-imagem)' },
  ambientada: { rotulo: 'Ambientada', Icone: Wand2, cor: 'var(--ag-asp-imagem)' },
  imagens: { rotulo: 'Imagens', Icone: Images, cor: 'var(--ag-asp-imagem)' },
  video: { rotulo: 'Vídeo', Icone: Clapperboard, cor: 'var(--ag-asp-video)' },
};

/** Rótulos das pílulas de `pilulasDe` (produtosAgente.ts) → aspecto. */
export const ASPECTO_DO_ROTULO: Record<string, Aspecto> = {
  'descrição': 'descricao',
  atributos: 'atributos',
  foto: 'foto',
  ambientada: 'ambientada',
  'vídeo': 'video',
};

/** Fundo/cor/borda de um selo de aspecto: tingido quando feito, neutro quando não. */
export function estiloAspecto(aspecto: Aspecto, feito: boolean): React.CSSProperties {
  const cor = ASPECTO[aspecto].cor;
  return feito
    ? {
      background: `color-mix(in srgb, ${cor} 12%, transparent)`,
      color: cor,
      borderColor: `color-mix(in srgb, ${cor} 28%, transparent)`,
    }
    : { background: 'var(--ag-fill)', color: 'var(--ag-text-3)', borderColor: 'var(--ag-hairline)' };
}
