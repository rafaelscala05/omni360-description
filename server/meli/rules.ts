import type {
  MeliAnalysisFinding,
  MeliAnalysisQuestion,
  MeliListingRecord,
  MeliScoreComponents,
} from './types';

type SchemaAttribute = Record<string, any> & { id: string };

export interface MeliCategorySchemaRecord {
  categoryId: string;
  schema: { attributes?: unknown; input?: unknown; output?: unknown };
  schemaHash: string;
  fetchedAt: string;
}

export interface RuleEngineResult {
  findings: MeliAnalysisFinding[];
  questions: MeliAnalysisQuestion[];
  scoreComponents: MeliScoreComponents;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
}

const HIGH_RELEVANCE = new Set(['GTIN', 'EAN', 'UPC', 'BRAND', 'MODEL', 'MPN', 'PART_NUMBER']);
const HTML_PATTERN = /<\/?[a-z][^>]*>/i;

function asObjects(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object')) : [];
}

function attributeCandidates(value: unknown, output: SchemaAttribute[] = []): SchemaAttribute[] {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((entry) => attributeCandidates(entry, output));
    return output;
  }
  const object = value as Record<string, any>;
  if (typeof object.id === 'string' && (
    object.tags || object.value_type || object.valueType || object.values || object.allowed_units || object.name
  )) output.push(object as SchemaAttribute);
  Object.entries(object).forEach(([key, nested]) => {
    if (key !== 'attributes' || nested !== value) attributeCandidates(nested, output);
  });
  return output;
}

export function collectSchemaAttributes(schemaRecord: MeliCategorySchemaRecord | null): Map<string, SchemaAttribute> {
  const result = new Map<string, SchemaAttribute>();
  if (!schemaRecord?.schema) return result;
  const merge = (candidate: SchemaAttribute, extra: Record<string, unknown> = {}) => {
    const current = result.get(candidate.id) || {};
    result.set(candidate.id, { ...current, ...candidate, ...extra, id: candidate.id });
  };
  attributeCandidates(schemaRecord.schema.attributes).forEach((candidate) => merge(candidate));
  attributeCandidates(schemaRecord.schema.output).forEach((candidate) => merge(candidate));
  attributeCandidates(schemaRecord.schema.input).forEach((candidate) => merge(candidate, { __technicalInput: true }));
  return result;
}

function listingAttributes(listing: MeliListingRecord): Map<string, Record<string, any>> {
  return new Map(asObjects(listing.attributes)
    .filter((attribute) => typeof attribute.id === 'string')
    .map((attribute) => [attribute.id, attribute]));
}

function valueText(attribute: Record<string, any> | undefined): string {
  if (!attribute) return '';
  return String(attribute.value_name ?? attribute.valueName ?? attribute.value_id ?? '').trim();
}

function isRequired(attribute: SchemaAttribute): boolean {
  return attribute.tags?.required === true || attribute.tags?.catalog_required === true || attribute.required === true;
}

function allowedValues(attribute: SchemaAttribute): string[] {
  return asObjects(attribute.values || attribute.allowed_values)
    .flatMap((value) => [value.id, value.name].filter((entry): entry is string => typeof entry === 'string'));
}

function allowedUnits(attribute: SchemaAttribute): string[] {
  const raw = attribute.allowed_units ?? attribute.units;
  return Array.isArray(raw)
    ? raw.flatMap((unit) => typeof unit === 'string' ? [unit] : [unit?.id, unit?.name].filter((entry): entry is string => typeof entry === 'string'))
    : [];
}

function addFinding(
  findings: MeliAnalysisFinding[],
  finding: Omit<MeliAnalysisFinding, 'source' | 'confidence'> & Partial<Pick<MeliAnalysisFinding, 'source' | 'confidence'>>,
): void {
  findings.push({ source: 'listing', confidence: 1, ...finding });
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function maxPictures(listing: MeliListingRecord, schemaRecord: MeliCategorySchemaRecord | null): number | null {
  const raw = listing.rawItem as Record<string, any> | null;
  const candidates = [
    raw?.settings?.max_pictures_per_item,
    raw?.category_settings?.max_pictures_per_item,
    (schemaRecord?.schema as any)?.max_pictures_per_item,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return candidates[0] || null;
}

function maxTitleLength(listing: MeliListingRecord): number | null {
  const raw = listing.rawItem as Record<string, any> | null;
  const value = Number(raw?.settings?.max_title_length ?? raw?.category_settings?.max_title_length);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function calculateScore(findings: MeliAnalysisFinding[]): MeliScoreComponents {
  const components: MeliScoreComponents = {
    technicalCompleteness: 100,
    consistency: 100,
    title: 100,
    description: 100,
    images: 100,
  };
  const severityPenalty = { info: 3, low: 7, medium: 15, high: 28, blocked: 45 } as const;
  for (const finding of findings) {
    const penalty = severityPenalty[finding.severity];
    const bucket = finding.fieldPath.startsWith('title') ? 'title'
      : finding.fieldPath.startsWith('description') ? 'description'
        : finding.fieldPath.startsWith('pictures') || finding.fieldPath.startsWith('variations') ? 'images'
          : finding.code.includes('INCONSISTENT') || finding.code.includes('DIVERGENCE') ? 'consistency'
            : 'technicalCompleteness';
    components[bucket] = Math.max(0, components[bucket] - penalty);
  }
  return components;
}

export function weightedMeliScore(components: MeliScoreComponents): number {
  return Math.round(
    components.technicalCompleteness * 0.35
    + components.consistency * 0.20
    + components.title * 0.15
    + components.description * 0.15
    + components.images * 0.15,
  );
}

export function runListingRules(
  listing: MeliListingRecord,
  schemaRecord: MeliCategorySchemaRecord | null,
): RuleEngineResult {
  const findings: MeliAnalysisFinding[] = [];
  const questions: MeliAnalysisQuestion[] = [];
  const schema = collectSchemaAttributes(schemaRecord);
  const current = listingAttributes(listing);

  for (const [id, definition] of schema) {
    const value = valueText(current.get(id));
    const required = isRequired(definition);
    const recommended = definition.tags?.recommended === true || definition.recommended === true || definition.__technicalInput === true;
    if (!value && (required || recommended)) {
      const severity = required ? (HIGH_RELEVANCE.has(id) ? 'high' : 'medium') : 'low';
      addFinding(findings, {
        code: required ? 'REQUIRED_ATTRIBUTE_MISSING' : 'RECOMMENDED_ATTRIBUTE_MISSING',
        fieldPath: `attributes.${id}`,
        severity,
        message: `${definition.name || id} está ausente na ficha técnica.`,
        evidence: [`Schema vigente da categoria ${listing.categoryId}: ${required ? 'obrigatório' : 'recomendado'}.`],
        source: 'category_schema',
        requiresConfirmation: HIGH_RELEVANCE.has(id),
      });
      if (required || HIGH_RELEVANCE.has(id)) questions.push({
        fieldPath: `attributes.${id}`,
        question: `Qual é o valor correto de ${definition.name || id}, conforme o produto ou a embalagem?`,
        reason: 'O dado factual não consta nas fontes disponíveis e não pode ser inventado.',
      });
      continue;
    }
    if (!value) continue;

    const maxLength = Number(definition.value_max_length ?? definition.valueMaxLength);
    if (Number.isFinite(maxLength) && maxLength > 0 && value.length > maxLength) addFinding(findings, {
      code: 'ATTRIBUTE_MAX_LENGTH_EXCEEDED', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} ultrapassa o limite de ${maxLength} caracteres.`,
      evidence: [`Valor atual tem ${value.length} caracteres.`], source: 'category_schema', requiresConfirmation: false,
    });

    const valueType = String(definition.value_type ?? definition.valueType ?? '').toLowerCase();
    if ((valueType === 'number' || valueType === 'number_unit') && !/[+-]?\d+(?:[.,]\d+)?/.test(value)) addFinding(findings, {
      code: 'ATTRIBUTE_TYPE_INVALID', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} deveria conter um valor numérico${valueType === 'number_unit' ? ' e unidade válida' : ''}.`,
      evidence: [`Valor atual: ${value}`], source: 'category_schema', requiresConfirmation: true,
    });

    const values = allowedValues(definition);
    const currentAttribute = current.get(id);
    if (values.length && !values.some((allowed) => normalize(allowed) === normalize(value)
      || allowed === String(currentAttribute?.value_id ?? ''))) addFinding(findings, {
      code: 'ATTRIBUTE_VALUE_NOT_ALLOWED', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} não corresponde a uma opção permitida pela categoria.`,
      evidence: [`Valor atual: ${value}`], source: 'category_schema', requiresConfirmation: true,
    });

    const units = allowedUnits(definition);
    const unitMatch = value.match(/\d[\d.,]*\s*([^\d\s].*)$/);
    if (units.length && valueType === 'number_unit' && !unitMatch) addFinding(findings, {
      code: 'ATTRIBUTE_UNIT_MISSING', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} precisa de uma unidade permitida pela categoria.`,
      evidence: [`Valor atual: ${value}. Permitidas: ${units.join(', ')}.`],
      source: 'category_schema', requiresConfirmation: true,
    });
    if (units.length && valueType === 'number_unit' && unitMatch
      && !units.some((unit) => normalize(unit) === normalize(unitMatch[1].trim()))) addFinding(findings, {
      code: 'ATTRIBUTE_UNIT_INVALID', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} usa uma unidade não permitida pela categoria.`,
      evidence: [`Unidade atual: ${unitMatch[1].trim()}. Permitidas: ${units.join(', ')}.`],
      source: 'category_schema', requiresConfirmation: true,
    });
  }

  const duplicateValues = new Map<string, Set<string>>();
  asObjects(listing.attributes).forEach((attribute) => {
    if (!attribute.id || !valueText(attribute)) return;
    const values = duplicateValues.get(String(attribute.id)) || new Set<string>();
    values.add(normalize(valueText(attribute)));
    duplicateValues.set(String(attribute.id), values);
  });
  duplicateValues.forEach((values, id) => {
    if (values.size > 1) addFinding(findings, {
      code: 'DUPLICATE_ATTRIBUTE_CONFLICT', fieldPath: `attributes.${id}`, severity: 'high',
      message: 'O mesmo atributo aparece com valores conflitantes.',
      evidence: [`Valores distintos encontrados: ${[...values].join(', ')}.`], requiresConfirmation: true,
    });
  });

  for (const id of HIGH_RELEVANCE) {
    if (!schema.has(id) || valueText(current.get(id))) continue;
    if (findings.some((finding) => finding.fieldPath === `attributes.${id}`)) continue;
    addFinding(findings, {
      code: 'HIGH_RELEVANCE_ATTRIBUTE_MISSING', fieldPath: `attributes.${id}`, severity: 'medium',
      message: `${schema.get(id)?.name || id} é relevante para identificar o produto e está ausente.`,
      evidence: ['O atributo está disponível no schema da categoria.'], source: 'category_schema', requiresConfirmation: true,
    });
  }

  const titleAndDescription = `${listing.title}\n${listing.descriptionPlainText}`;
  for (const id of ['BRAND', 'MODEL']) {
    const definition = schema.get(id);
    const currentValue = valueText(current.get(id));
    if (!definition || !currentValue) continue;
    const labels = id === 'BRAND' ? ['marca', String(definition.name || '')] : ['modelo', String(definition.name || '')];
    const explicitValues = labels.filter(Boolean).flatMap((label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = titleAndDescription.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:\\-]\\s*([^\\n,;]+)`, 'i'));
      return match?.[1]?.trim() ? [match[1].trim()] : [];
    });
    const conflicting = explicitValues.find((value) => !normalize(value).includes(normalize(currentValue))
      && !normalize(currentValue).includes(normalize(value)));
    if (conflicting) addFinding(findings, {
      code: 'ATTRIBUTE_LITERAL_DIVERGENCE', fieldPath: `attributes.${id}`, severity: 'high',
      message: `${definition.name || id} diverge entre a ficha técnica e o texto do anúncio.`,
      evidence: [`Ficha técnica: ${currentValue}. Texto: ${conflicting}.`], requiresConfirmation: true,
    });
  }

  const description = listing.descriptionPlainText.trim();
  if (!description) addFinding(findings, {
    code: 'DESCRIPTION_EMPTY', fieldPath: 'description.plain_text', severity: 'high',
    message: 'O anúncio não possui descrição.', evidence: ['Descrição vazia na última sincronização.'], requiresConfirmation: false,
  });
  else if (description.length < 120) addFinding(findings, {
    code: 'DESCRIPTION_TOO_SHORT', fieldPath: 'description.plain_text', severity: 'medium',
    message: 'A descrição é curta e pode não responder às dúvidas principais do comprador.',
    evidence: [`A descrição possui ${description.length} caracteres.`], requiresConfirmation: false,
  });
  if (HTML_PATTERN.test(description)) addFinding(findings, {
    code: 'DESCRIPTION_CONTAINS_HTML', fieldPath: 'description.plain_text', severity: 'high',
    message: 'A descrição contém HTML, mas o Mercado Livre espera texto simples.',
    evidence: ['Foi encontrada uma tag HTML na descrição atual.'], requiresConfirmation: false,
  });
  if (/https?:\/\/|www\.|\b(?:whats(?:app)?|telefone|e-mail|email)\b/i.test(description)) addFinding(findings, {
    code: 'DESCRIPTION_FORBIDDEN_CONTACT', fieldPath: 'description.plain_text', severity: 'high',
    message: 'A descrição contém URL ou referência de contato que deve ser revisada.',
    evidence: ['Foi localizado um padrão de URL ou contato na descrição.'], requiresConfirmation: false,
  });

  if (!listing.title.trim()) addFinding(findings, {
    code: 'TITLE_EMPTY', fieldPath: 'title', severity: 'blocked', message: 'O título está vazio.',
    evidence: ['Título vazio na última sincronização.'], requiresConfirmation: false,
  });
  if (listing.soldQuantity > 0) addFinding(findings, {
    code: 'TITLE_MAY_BE_LOCKED_AFTER_SALES', fieldPath: 'title', severity: 'info',
    message: 'O título pode não ser editável porque o anúncio já possui vendas.',
    evidence: [`Quantidade vendida informada: ${listing.soldQuantity}.`], requiresConfirmation: false,
  });
  const titleLimit = maxTitleLength(listing);
  if (titleLimit && listing.title.length > titleLimit) addFinding(findings, {
    code: 'TITLE_MAX_LENGTH_EXCEEDED', fieldPath: 'title', severity: 'high',
    message: `O título ultrapassa o limite conhecido de ${titleLimit} caracteres.`,
    evidence: [`O título atual possui ${listing.title.length} caracteres.`], requiresConfirmation: false,
  });
  if (/\b(?:promo[cç][aã]o|oferta|frete\s+gr[aá]tis|desconto|parcelamento)\b/i.test(listing.title)) addFinding(findings, {
    code: 'TITLE_PROMOTIONAL_LANGUAGE', fieldPath: 'title', severity: 'medium',
    message: 'O título contém linguagem promocional em vez de identificação objetiva do produto.',
    evidence: [`Título atual: ${listing.title}.`], requiresConfirmation: false,
  });
  if (/[!]{2,}|[★⭐🔥🚀💥✅]/u.test(listing.title)) addFinding(findings, {
    code: 'TITLE_ORNAMENTAL_PUNCTUATION', fieldPath: 'title', severity: 'low',
    message: 'O título contém pontuação ou símbolos ornamentais.',
    evidence: [`Título atual: ${listing.title}.`], requiresConfirmation: false,
  });

  const pictures = asObjects(listing.pictures);
  if (!pictures.length) addFinding(findings, {
    code: 'PICTURES_MISSING', fieldPath: 'pictures', severity: 'blocked', message: 'O anúncio não possui imagens.',
    evidence: ['Nenhuma imagem retornada pela API.'], requiresConfirmation: false,
  });
  const limit = maxPictures(listing, schemaRecord);
  if (limit && pictures.length > limit) addFinding(findings, {
    code: 'PICTURE_LIMIT_EXCEEDED', fieldPath: 'pictures', severity: 'high',
    message: `O anúncio possui mais imagens do que o limite conhecido da categoria (${limit}).`,
    evidence: [`Total atual: ${pictures.length}.`], source: 'category_schema', requiresConfirmation: false,
  });

  const pictureIds = new Set(pictures.map((picture) => String(picture.id || '')).filter(Boolean));
  asObjects(listing.variations).forEach((variation, variationIndex) => {
    const missing = (Array.isArray(variation.picture_ids) ? variation.picture_ids : [])
      .map(String).filter((id: string) => !pictureIds.has(id));
    if (missing.length) addFinding(findings, {
      code: 'VARIATION_REFERENCES_MISSING_PICTURE', fieldPath: `variations.${variationIndex}.picture_ids`, severity: 'high',
      message: 'Uma variação referencia imagem que não está no conjunto atual do anúncio.',
      evidence: [`IDs ausentes: ${missing.join(', ')}.`], requiresConfirmation: false,
    });
  });

  if (listing.catalogProductId) addFinding(findings, {
    code: 'CATALOG_CONTROLLED_LISTING', fieldPath: 'catalog_product_id', severity: 'info',
    message: 'O anúncio está associado ao catálogo; alguns campos podem ser controlados pelo Mercado Livre.',
    evidence: [`Catalog product: ${listing.catalogProductId}.`], source: 'meli_performance', requiresConfirmation: false,
  });
  if (listing.userProductId) addFinding(findings, {
    code: 'USER_PRODUCT_PROPAGATION_SCOPE', fieldPath: 'user_product_id', severity: 'medium',
    message: 'Mudanças em campos compartilhados podem se propagar a anúncios do mesmo User Product.',
    evidence: [`User Product: ${listing.userProductId}.`], source: 'listing', requiresConfirmation: false,
  });

  const warnings = asObjects((listing.rawItem as any)?.warnings);
  warnings.forEach((warning, index) => addFinding(findings, {
    code: 'MELI_API_WARNING', fieldPath: `warnings.${index}`, severity: 'medium',
    message: String(warning.message || warning.code || 'O Mercado Livre retornou um warning para o anúncio.'),
    evidence: [String(warning.code || 'warning')], source: 'meli_performance', requiresConfirmation: false,
  }));

  const components = calculateScore(findings);
  let score = weightedMeliScore(components);
  const hasBlocker = findings.some((finding) => finding.severity === 'blocked');
  const hasFactualBlocker = findings.some((finding) => finding.severity === 'high' && finding.requiresConfirmation);
  if (hasBlocker || hasFactualBlocker) score = Math.min(score, hasBlocker ? 45 : 59);
  const riskLevel = hasBlocker ? 'blocked'
    : findings.some((finding) => finding.severity === 'high') ? 'high'
      : findings.some((finding) => finding.severity === 'medium') ? 'medium' : 'low';
  return { findings, questions, scoreComponents: components, score, riskLevel };
}

export function descriptionRejectionReason(description: string | null, listing: MeliListingRecord): string | null {
  if (!description) return null;
  if (HTML_PATTERN.test(description) || /https?:\/\/|www\.|\b(?:whats|telefone|e-mail|email)\b/i.test(description)) return 'Contém HTML, link ou contato.';
  const source = [
    listing.title,
    listing.descriptionPlainText,
    ...asObjects(listing.attributes).flatMap((attribute) => [attribute.name, attribute.value_name]),
    ...asObjects(listing.saleTerms).flatMap((term) => [term.name, term.value_name]),
  ].filter(Boolean).join(' ');
  const knownNumbers = new Set(source.match(/\b\d+(?:[.,]\d+)?\b/g) || []);
  const inventedNumber = (description.match(/\b\d+(?:[.,]\d+)?\b/g) || []).some((number) => !knownNumbers.has(number));
  if (inventedNumber) return 'Cita números que não constam no anúncio.';
  const sensitiveClaims = ['garantia', 'compativ', 'certific', 'anatel', 'material', 'potencia', 'voltagem', 'peso', 'dimens', 'acompanha', 'embalagem', 'impermeavel'];
  const normalizedSource = normalize(source);
  const normalizedDescription = normalize(description);
  const claim = sensitiveClaims.find((stem) => normalizedDescription.includes(stem) && !normalizedSource.includes(stem));
  return claim ? `Afirma algo sobre "${claim}" que não consta no anúncio.` : null;
}

export function validateSuggestedDescription(description: string | null, listing: MeliListingRecord): string | null {
  if (!description || descriptionRejectionReason(description, listing)) return null;
  return description.trim();
}

export function validateSuggestedTitle(title: string | null, listing: MeliListingRecord): string | null {
  const basic = validateSuggestedDescription(title, listing);
  if (!basic) return null;
  const source = normalize([
    listing.title,
    listing.descriptionPlainText,
    ...asObjects(listing.attributes).flatMap((attribute) => [attribute.name, attribute.value_name]),
  ].filter(Boolean).join(' '));
  const safeConnectors = new Set(['com', 'para', 'por', 'sem', 'de', 'da', 'das', 'do', 'dos', 'em', 'e']);
  const candidateTokens: string[] = Array.from(normalize(basic).matchAll(/[a-z0-9]+/g), (match) => match[0]);
  const introducedToken = candidateTokens.some((token) => token.length > 2 && !safeConnectors.has(token) && !source.includes(token));
  return introducedToken ? null : basic;
}

export function evidenceSupportsValue(value: string, evidence: string[], listing: MeliListingRecord): boolean {
  const normalizedValue = normalize(value.trim());
  if (!normalizedValue) return false;
  const source = [listing.title, listing.descriptionPlainText,
    ...asObjects(listing.attributes).flatMap((attribute) => [attribute.value_name, attribute.value_id]),
    ...asObjects(listing.saleTerms).flatMap((term) => [term.value_name, term.value_id]),
  ].filter(Boolean).map(String).map(normalize).join(' ');
  return source.includes(normalizedValue) && evidence.some((entry) => normalize(entry).includes(normalizedValue));
}
