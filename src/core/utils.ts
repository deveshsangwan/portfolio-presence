import { PresenceError } from "./errors";

export type WithoutUndefined<TValue extends Record<string, unknown>> = {
  [TKey in keyof TValue as undefined extends TValue[TKey] ? TKey : never]?: Exclude<
    TValue[TKey],
    undefined
  >;
} & {
  [TKey in keyof TValue as undefined extends TValue[TKey] ? never : TKey]: TValue[TKey];
};

export function assertFetch(fetchImpl: typeof globalThis.fetch | undefined) {
  if (!fetchImpl) {
    throw new PresenceError("No fetch implementation is available.", {
      code: "missing_fetch"
    });
  }

  return fetchImpl.bind(globalThis);
}

export function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

export function dateToIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function isHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseTimestamp(value: Date | string | undefined, fallback: Date) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new PresenceError("Invalid timestamp.", {
      code: "invalid_timestamp",
      status: 400
    });
  }

  return parsed;
}

export function titleFromSlug(slug: string) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function withoutUndefined<TValue extends Record<string, unknown>>(
  value: TValue
): WithoutUndefined<TValue> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as WithoutUndefined<TValue>;
}
