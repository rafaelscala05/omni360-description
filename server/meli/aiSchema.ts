// Gemini turns JSON Schema constraints into a serving grammar. Bounds nested
// across several arrays/objects can make that grammar grow combinatorially and
// be rejected with "too many states" before the model is invoked. Keep the
// complete Zod schema for validation after generation, but remove constraints
// that are unnecessary for shaping the provider response.

const STATE_EXPANDING_KEYWORDS = new Set([
  '$schema',
  'default',
  'description',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'title',
]);

export function simplifyServingJsonSchema<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => simplifyServingJsonSchema(entry)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !STATE_EXPANDING_KEYWORDS.has(key))
      .map(([key, nested]) => [key, simplifyServingJsonSchema(nested)]),
  ) as T;
}

export function isServingSchemaComplexityError(error: unknown): boolean {
  const message = error instanceof Error
    ? messageWithCause(error)
    : safeStringify(error);
  return /too many states|specified schema produces a constraint|schema.*complex/i.test(message);
}

function messageWithCause(error: Error): string {
  const cause = 'cause' in error ? safeStringify(error.cause) : '';
  return `${error.message} ${cause}`;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
