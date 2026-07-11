import type { BlogTemplateId } from '../../../src/modules/content/blog/types';
import type { BlogTheme } from './types';
import { revista } from './revista';

// minimal e vitrine são adicionados nas Tasks 3 e 4. Até lá, apontam para
// revista para manter o módulo compilável.
export const THEMES: Record<BlogTemplateId, BlogTheme> = {
  editorial: revista,
  minimal: revista,
  grid: revista,
};
