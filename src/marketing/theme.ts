import logoProduto from '../assets/brand/logo-alfreds-produtos.png';
import logoConteudo from '../assets/brand/logo-alfreds-conteudo.png';

export type AgentTheme = 'product' | 'content' | 'brand';

export interface ThemeTokens {
  /** Nome de exibição do contexto */
  name: string;
  /** Hex do acento */
  accent: string;
  /** Classe de fundo do acento (botões cheios) */
  accentBgClass: string;
  /** Classe de texto do acento */
  accentTextClass: string;
  /** Classe de texto legível sobre o acento */
  onAccentClass: string;
  /** Logo apropriado para o contexto */
  logo: string;
}

export const THEMES: Record<AgentTheme, ThemeTokens> = {
  brand: {
    name: 'Alfreds',
    accent: '#FF5B03',
    accentBgClass: 'bg-orange',
    accentTextClass: 'text-orange',
    onAccentClass: 'text-white',
    logo: logoProduto,
  },
  product: {
    name: 'Agente de Produto',
    accent: '#FF5B03',
    accentBgClass: 'bg-orange',
    accentTextClass: 'text-orange',
    onAccentClass: 'text-white',
    logo: logoProduto,
  },
  content: {
    name: 'Agente de Conteúdo',
    accent: '#141311',
    accentBgClass: 'bg-ink',
    accentTextClass: 'text-ink',
    onAccentClass: 'text-white',
    logo: logoConteudo,
  },
};

export function getTheme(t: AgentTheme): ThemeTokens {
  return THEMES[t];
}
