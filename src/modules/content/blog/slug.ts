// Slugs amigáveis no padrão WordPress: minúsculas, sem acentos, hífens.
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (combining marks pós-NFD)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

// Em colisão dentro do mesmo blog, sufixa -2, -3, ...
export function uniqueSlug(base: string, existing: Set<string>): string {
  const root = slugify(base) || 'post';
  if (!existing.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}
