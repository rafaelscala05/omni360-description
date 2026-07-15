import type { BlogTheme } from './types';
import { composite } from './composite';

// Tema único e compositor: a variação visual agora vem de BlogAppearance
// (5 eixos independentes), não mais de temas fixos. O `template` legado só
// sobrevive como preset inicial de BlogAppearance (ver effectiveAppearance).
export const blogTheme: BlogTheme = composite;
