/**
 * Public + internal types для Compose Format loader.
 *
 * `ComposeLoadOptions` — публичный shape user-override'ов которые
 * пользователь передаёт через `AactConfig.source.options`. Все поля
 * опциональны; defaults задаются в самом loader'е (см. DEFAULTS ниже).
 *
 * Internal shapes (`ParsedComposeFile`, `ParsedService`, ...) — то
 * что мы получаем из `yaml` пакета после parse. Деривативные от
 * Compose Spec (2026 edition), достаточные для построения C4 Model.
 * Поля которые нам не нужны (resources / restart / healthcheck /
 * env_file / etc.) намеренно не типизированы — нужно будет — добавим.
 */

/** Защищающие label-key конвенции. Каждое поле — полное имя label
 *  ключа (включая prefix). Defaults собираются из {@link composeLabelKeys}
 *  на основе `prefix` если конкретные ключи не переопределены. */
export interface ComposeLabelKeys {
  readonly prefix?: string;
  readonly element?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: string;
  readonly external?: string;
  readonly link?: string;
}

export interface ComposeImageHeuristic {
  readonly db?: readonly string[];
  readonly queue?: readonly string[];
}

export interface ComposeProvidersOptions {
  /** Tags выставляемые на external Element созданном из provider service. */
  readonly defaultTags?: readonly string[];
}

export interface ComposeModelsOptions {
  /** Tags выставляемые на AI-model Element. */
  readonly defaultTags?: readonly string[];
  /** Description для relation `service → ai-model`. */
  readonly relationDescription?: string;
}

export interface ComposeLoadOptions {
  readonly labels?: ComposeLabelKeys;
  /** Дополнительные compose-файлы для merge (как `-f a.yml -f b.yml`).
   *  Реализуется в phase 1.5; в phase 1 — опция accepted but ignored
   *  с info-ModelIssue. */
  readonly overrides?: readonly string[];
  /** Фильтр сервисов по `profiles:`. Phase 1.5; в phase 1 опция
   *  accepted but ignored. */
  readonly profiles?: readonly string[];
  readonly imageHeuristic?: ComposeImageHeuristic;
  readonly providers?: ComposeProvidersOptions;
  readonly models?: ComposeModelsOptions;
}

/* ------------------------------------------------------------------ */
/*  Resolved-defaults shape — то с чем работает loader после          */
/*  подмешивания DEFAULTS поверх user options.                        */
/* ------------------------------------------------------------------ */

export interface ResolvedLabelKeys {
  readonly element: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly technology: string;
  readonly tags: string;
  readonly external: string;
  readonly link: string;
}

export interface ResolvedOptions {
  readonly labels: ResolvedLabelKeys;
  readonly overrides: readonly string[];
  readonly profiles: readonly string[];
  readonly imageHeuristic: {
    readonly db: readonly string[];
    readonly queue: readonly string[];
  };
  readonly providers: {
    readonly defaultTags: readonly string[];
  };
  readonly models: {
    readonly defaultTags: readonly string[];
    readonly relationDescription: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Internal — то что мы получаем из YAML parser'а (yaml@2.x).        */
/*  Минимальная shape: только то что нам нужно для C4 mapping.        */
/* ------------------------------------------------------------------ */

/** Mapping form `{ KEY: VALUE }` ИЛИ list form `[ "KEY=VALUE", ... ]`. */
export type ComposeLabelsRaw =
  | Readonly<Record<string, string>>
  | readonly string[];

/** Short form `[name]` ИЛИ long form `{ name: { condition, ... } }`. */
export type ComposeDependsOnRaw =
  | readonly string[]
  | Readonly<Record<string, ComposeDependsOnEntry>>;

export interface ComposeDependsOnEntry {
  readonly condition?: string;
  readonly restart?: boolean;
  readonly required?: boolean;
}

/** Provider services (Compose Spec 2026) — native extension point
 *  для external resources (cloud DB / AI runtime / tunnels / etc). */
export interface ComposeProvider {
  readonly type: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface ParsedService {
  readonly image?: string;
  readonly build?: string | Readonly<Record<string, unknown>>;
  readonly labels?: ComposeLabelsRaw;
  readonly depends_on?: ComposeDependsOnRaw;
  readonly profiles?: readonly string[];
  readonly provider?: ComposeProvider;
  readonly models?: readonly string[];
  /** `extends:` — Phase 1 emits info-ModelIssue and skips base merge. */
  readonly extends?: Readonly<{ file?: string; service: string }>;
  /** Прочие поля игнорируем; типизируем как unknown для forward-compat. */
  readonly [other: string]: unknown;
}

/** Top-level `models:` — AI models declaration (Compose Spec 2026). */
export interface ParsedAiModel {
  readonly model: string;
  readonly [other: string]: unknown;
}

/** `include:` — short form (string) или long form (object). */
export type ParsedIncludeEntry =
  | string
  | Readonly<{
      path: string | readonly string[];
      project_directory?: string;
      env_file?: string | readonly string[];
    }>;

export interface ParsedComposeFile {
  readonly name?: string;
  readonly version?: string; // obsolete — info ModelIssue if present
  readonly services?: Readonly<Record<string, ParsedService>>;
  readonly models?: Readonly<Record<string, ParsedAiModel>>;
  readonly include?: readonly ParsedIncludeEntry[];
  /** Прочие top-level разделы (networks/volumes/configs/secrets/develop)
   *  игнорируем в phase 1. */
  readonly [other: string]: unknown;
}
