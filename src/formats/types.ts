import type { Model, ModelIssue } from "../model";

/**
 * Capability-based Format API. Один Format interface, capabilities
 * (load / generate / fix) — optional. Каждый формат self-describes что
 * support'ит. CLI и users-as-library narrowing через type guards.
 *
 * Долгосрочно (десятилетия): новые capabilities добавляются как optional
 * methods в существующем interface, не как новые типы. Никаких
 * "SourceFormat vs ArtifactFormat" junk types под комбинации фич.
 */

/**
 * Regex-based primitives для in-place editing source files. Используется
 * fix-функциями правил. Future-ready: AST primitives добавятся как
 * `ast?: AstPrimitives` в FixCapability — non-breaking.
 */
export interface SourceSyntax {
  containerPattern(name: string): string;
  containerDecl(name: string, label: string, tags?: string): string;
  relationPattern(from: string, to: string): string;
  relationDecl(from: string, to: string, tech?: string, tags?: string): string;
}

export interface FixCapability {
  readonly syntax: SourceSyntax;
}

/**
 * Сериализованный output генератора. Single-file output (PlantUML/Mermaid/
 * Compose) — массив из одного `GeneratedFile`. Multi-file (k8s manifests
 * per service) — несколько. Один shape, CLI iterate'ит без discriminated
 * dispatch'а.
 */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export interface FormatOutput {
  readonly files: readonly GeneratedFile[];
}

/**
 * Результат load'а — Model + diagnostics. Loader заполняет `issues` через
 * buildModel (duplicate names, dangling refs, etc.) + post-build
 * validateModel. CLI решает severity (warn / fail), users-as-library
 * могут игнорировать или экспозить пользователю.
 */
export interface LoadResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
}

/**
 * Format — единственный contract для всех C4-as-code форматов и IaC
 * artefactов. Capabilities опциональны:
 *  - PlantUML / Mermaid / Structurizr: load + generate + fix
 *  - Kubernetes / Compose: load + generate (no fix — IaC не authored руками)
 *  - Hypothetical write-only: только generate
 *  - Hypothetical read-only: только load
 *
 * `name` — уникальный идентификатор в Format registry (config.source.type).
 * `defaultPattern` — glob для CLI `init` шаблонов и автодетекта.
 *
 * Structurizr load/write asymmetry (load workspace.json → fix workspace.dsl)
 * решается через `AactConfig.source.writePath`, не через Format type.
 */
export interface Format {
  readonly name: string;
  readonly defaultPattern?: string;
  load?(path: string): Promise<LoadResult>;
  generate?(model: Model): FormatOutput;
  fix?: FixCapability;
}

/** Format с гарантированным load — после canLoad narrow. */
export type LoadableFormat = Format & { load: NonNullable<Format["load"]> };

/** Format с гарантированным generate — после canGenerate narrow. */
export type GeneratableFormat = Format & {
  generate: NonNullable<Format["generate"]>;
};

/** Format с гарантированным fix — после canFix narrow. */
export type FixableFormat = Format & { fix: NonNullable<Format["fix"]> };

export const canLoad = (f: Format): f is LoadableFormat => f.load !== undefined;

export const canGenerate = (f: Format): f is GeneratableFormat =>
  f.generate !== undefined;

export const canFix = (f: Format): f is FixableFormat => f.fix !== undefined;
