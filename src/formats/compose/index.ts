import type { Format } from "../types";
import { load } from "./load";

/**
 * Docker Compose Format (Compose Spec 2026 edition).
 *
 * `load` only — Compose файлы редко авторятся под Model'е архитектора;
 * наоборот, инфра-команда пишет compose.yml, а архитектор хочет
 * сверять его с DSL-моделью.
 *
 * Coverage:
 *  - services (`image` + `build` + `depends_on` + `labels` + `profiles`)
 *  - provider services (Compose Spec 2026 extension) → external System
 *  - top-level `models:` (AI models 2026) → external System + relations
 *  - `include:` рекурсивная композиция с cycle detection
 *  - Aact labels conventions (default prefix `aact`):
 *      aact.element / aact.kind / aact.label / aact.description /
 *      aact.technology / aact.tags / aact.external / aact.link
 *
 * Limits (Phase 1 → расширим если будет реальный запрос):
 *  - `extends:` — info ModelIssue, base service skipped
 *  - `overrides` option — accepted but ignored (phase 1.5)
 *  - `profiles` option — accepted but ignored (phase 1.5)
 *  - networks / volumes / configs / secrets / develop — silently ignored
 *  - `version` top-level — info ModelIssue (obsolete in current spec)
 */
export const composeFormat: Format = {
  name: "compose",
  defaultPattern: "compose.{yml,yaml,json}",
  load,
};
