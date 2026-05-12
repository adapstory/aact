import type { Format } from "./types";

/**
 * Format registry. Каждый формат регистрируется как entry в этом array'е.
 * Добавление нового формата (Mermaid в v3.1, Compose в v3.x, LikeC4 в v3.x) =
 * одна строчка `import` + одна в массиве — zero core changes.
 *
 * Lazy import через dynamic () => Promise — не утяжеляет CLI cold start
 * импортами формата, который пользователю не нужен.
 */
type FormatLoader = () => Promise<Format>;

const formatLoaders: Readonly<Record<string, FormatLoader>> = Object.freeze({
  plantuml: () => import("./plantuml").then((m) => m.plantumlFormat),
  structurizr: () => import("./structurizr").then((m) => m.structurizrFormat),
  kubernetes: () => import("./kubernetes").then((m) => m.kubernetesFormat),
});

/**
 * Async lookup формата по name. Throws если name unknown — let caller
 * surface user-facing error с config context.
 */
export const loadFormat = async (name: string): Promise<Format> => {
  const loader = formatLoaders[name];
  if (!loader) {
    throw new Error(
      `Unknown format "${name}". Known formats: ${Object.keys(formatLoaders).join(", ")}.`,
    );
  }
  return loader();
};

/** Все зарегистрированные имена форматов. CLI `init` использует для prompt'а. */
export const knownFormatNames = (): readonly string[] =>
  Object.keys(formatLoaders);
