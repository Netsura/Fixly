const SENSITIVE_KEY_PATTERN = /pass|secret|token|cookie|authorization|credential|otp|pin|cvv|card|iban|ssn|api[-_]?key|signature|hash/i;

const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 512;

/**
 * Strips secrets out of values before they reach audit logs or structured logs.
 * Keys matching sensitive patterns are replaced rather than truncated so the
 * shape of the record stays useful for operators.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactSensitive(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactSensitive(entry, depth + 1);
    }
    return result;
  }

  return '[unsupported]';
}

export function redactMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;
  return redactSensitive(metadata) as Record<string, unknown>;
}
