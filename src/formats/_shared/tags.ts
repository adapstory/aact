/**
 * Парсинг тегов из разных источников. Все возвращают `readonly string[]`
 * (пустой массив если нет тегов) — никаких optional'ов в Container.tags.
 */

/**
 * Comma-separated tags из Structurizr / k8s / Compose. Trim'ит whitespace,
 * фильтрует пустые segments.
 */
export const parseCsvTags = (raw: string | undefined): readonly string[] =>
  raw
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean) ?? [];

/**
 * LikeC4 inline `#tag` syntax — извлекает имена тегов из текста, strip'ит `#`.
 * Поддерживает alphanumeric + `-` + `_` в имени тега.
 */
export const parseHashtagTags = (raw: string): readonly string[] =>
  [...raw.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
