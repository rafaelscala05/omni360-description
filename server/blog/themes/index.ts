import type { BlogTemplateId } from '../../../src/modules/content/blog/types';
import type { BlogTheme } from './types';
import { revista } from './revista';
import { minimal } from './minimal';

export const THEMES: Record<BlogTemplateId, BlogTheme> = {
  editorial: revista,
  minimal,
  grid: revista,
};
