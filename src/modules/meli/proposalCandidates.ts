interface ListingForProposal {
  title: string;
  soldQuantity: number;
  descriptionPlainText: string;
  attributes?: unknown[];
  saleTerms?: unknown[];
}

interface ValueSuggestion {
  id: string;
  valueName: string;
  valueId: string | null;
  reason: string;
  evidence: string[];
}

interface PictureSuggestion {
  pictureId: string | null;
  action: string;
  targetOrder?: number | null;
  reason: string;
}

interface AnalysisForProposal {
  findings: Array<{ code: string }>;
  suggestions: {
    title: string | null;
    descriptionPlainText: string | null;
    attributes: ValueSuggestion[];
    saleTerms: ValueSuggestion[];
    picturePlan: PictureSuggestion[];
  };
}

export interface ProposalCandidates {
  title: { value: string; source: 'ai' | 'rule' } | null;
  description: { value: string; source: 'ai' | 'rule' } | null;
  attributes: ValueSuggestion[];
  saleTerms: ValueSuggestion[];
  picturePlan: PictureSuggestion[];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function differsFromCurrent(entries: unknown, suggestion: ValueSuggestion): boolean {
  const current = records(entries).find((entry) => String(entry.id) === suggestion.id);
  if (!current) return true;
  const currentId = normalized(current.value_id);
  const proposedId = normalized(suggestion.valueId);
  if (currentId && proposedId) return currentId !== proposedId;
  return normalized(current.value_name) !== normalized(suggestion.valueName);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const radix = entity[1]?.toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function plainTextDescriptionCandidate(value: string): string | null {
  if (!/<\/?[a-z][^>]*>/i.test(value)) return null;
  const result = decodeEntities(value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(?:p|div|li|h[1-6]|ul|ol|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!result || result === value.trim()) return null;
  if (/https?:\/\/|www\.|\b(?:whats(?:app)?|telefone|e-mail|email)\b/i.test(result)) return null;
  return result;
}

export function cleanTitleCandidate(value: string): string | null {
  const result = value
    .replace(/\b(?:promo[cç][aã]o|oferta|frete\s+gr[aá]tis|desconto|parcelamento)\b/gi, ' ')
    .replace(/[★⭐🔥🚀💥✅]/gu, ' ')
    .replace(/!+/g, ' ')
    .replace(/\s*[-|·]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return result && normalized(result) !== normalized(value) ? result : null;
}

export function collectProposalCandidates(listing: ListingForProposal, analysis: AnalysisForProposal): ProposalCandidates {
  const codes = new Set(analysis.findings.map((finding) => finding.code));
  const aiTitle = analysis.suggestions.title?.trim();
  const ruleTitle = listing.soldQuantity === 0
    && (codes.has('TITLE_PROMOTIONAL_LANGUAGE') || codes.has('TITLE_ORNAMENTAL_PUNCTUATION'))
    ? cleanTitleCandidate(listing.title)
    : null;
  const aiDescription = analysis.suggestions.descriptionPlainText?.trim();
  const ruleDescription = codes.has('DESCRIPTION_CONTAINS_HTML')
    ? plainTextDescriptionCandidate(listing.descriptionPlainText)
    : null;

  return {
    title: aiTitle && normalized(aiTitle) !== normalized(listing.title)
      ? { value: aiTitle, source: 'ai' }
      : ruleTitle ? { value: ruleTitle, source: 'rule' } : null,
    description: aiDescription && aiDescription !== listing.descriptionPlainText.trim()
      ? { value: aiDescription, source: 'ai' }
      : ruleDescription ? { value: ruleDescription, source: 'rule' } : null,
    attributes: analysis.suggestions.attributes.filter((item) => differsFromCurrent(listing.attributes, item)),
    saleTerms: analysis.suggestions.saleTerms.filter((item) => differsFromCurrent(listing.saleTerms, item)),
    picturePlan: analysis.suggestions.picturePlan.filter((item) => ['reorder', 'remove', 'replace', 'create'].includes(item.action)),
  };
}

export function countProposalCandidates(listing: ListingForProposal, analysis: AnalysisForProposal): number {
  const candidates = collectProposalCandidates(listing, analysis);
  return Number(Boolean(candidates.title))
    + Number(Boolean(candidates.description))
    + candidates.attributes.length
    + candidates.saleTerms.length
    + candidates.picturePlan.length;
}
