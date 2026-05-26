import type { NamingPreset, NamingTransform } from "./types";

/**
 * Naming-convention transforms для compose service-key → Model
 * element-name. Главное для drift detection match-rate когда DSL
 * и compose следуют разным конвенциям (camelCase vs kebab-case).
 *
 * Реализации pure — никакого state, никаких side-effects. Каждый
 * preset идемпотентен на уже-преобразованном input'е.
 */

/** Split string на "words" уважая kebab/snake/camel/pascal границы. */
const splitWords = (input: string): readonly string[] => {
  if (input.length === 0) return [];
  // Сначала режем по non-alnum (`-`, `_`, пробелы) → list of segments
  const bySeparator = input.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  // Каждый segment может быть camelCase / PascalCase — режем дополнительно
  // на word boundaries: вставляем space перед каждой uppercase которая
  // следует за lowercase ИЛИ digit, плюс на границе lowercase→uppercase
  // последовательностей подряд.
  const words: string[] = [];
  for (const segment of bySeparator) {
    const parts = segment
      .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
      .split(" ")
      .filter(Boolean);
    words.push(...parts);
  }
  return words;
};

const toLowerWords = (input: string): readonly string[] =>
  splitWords(input).map((w) => w.toLowerCase());

const capitalize = (word: string): string =>
  word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);

const camelCase = (input: string): string => {
  const words = toLowerWords(input);
  if (words.length === 0) return "";
  return words[0] + words.slice(1).map(capitalize).join("");
};

const pascalCase = (input: string): string =>
  toLowerWords(input).map(capitalize).join("");

const kebabCase = (input: string): string => toLowerWords(input).join("-");

const snakeCase = (input: string): string => toLowerWords(input).join("_");

const PRESETS: Readonly<Record<NamingPreset, NamingTransform>> = Object.freeze({
  "as-is": (raw) => raw,
  "kebab-to-camel": camelCase,
  "kebab-to-pascal": pascalCase,
  "snake-to-camel": camelCase,
  "snake-to-pascal": pascalCase,
  "to-kebab": kebabCase,
  "to-snake": snakeCase,
});

/**
 * Resolve user-facing option to transform function. Принимает string
 * preset, или `{ transform }` объект (runtime escape hatch), или
 * undefined (default = as-is).
 */
export const resolveNamingTransform = (
  raw: ComposeLoadOptionsNamingField,
): NamingTransform => {
  if (raw === undefined) return PRESETS["as-is"];
  if (typeof raw === "string") return PRESETS[raw] ?? PRESETS["as-is"];
  return raw.transform;
};

type ComposeLoadOptionsNamingField =
  | NamingPreset
  | { readonly transform: NamingTransform }
  | undefined;
