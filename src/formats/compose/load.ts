import type { LoadResult } from "../types";
import { resolveIncludes } from "./include";
import { DEFAULT_DB_IMAGES, DEFAULT_QUEUE_IMAGES } from "./inferKind";
import { toModel } from "./toModel";
import type { ComposeLoadOptions } from "./types";

/**
 * Public entry point Compose Format'а. Принимает путь к compose-файлу
 * (entry), резолвит `include:` цепочку, мерджит, проектирует в Model.
 *
 * Options передаются от `AactConfig.source.options` через CLI runner
 * → `Format.load(path, options)`. Если caller не передаёт options —
 * loader использует defaults (см. `DEFAULTS` в toModel.ts).
 */
export const load = async (
  path: string,
  options?: unknown,
): Promise<LoadResult> => {
  const composeOptions = (options ?? {}) as ComposeLoadOptions;

  if (composeOptions.overrides && composeOptions.overrides.length > 0) {
    // Phase 1: overrides поле принимаем, но не применяем — phase 1.5
    // accepted-but-ignored с info-issue чтобы пользователь не думал
    // что merged.
  }

  const resolved = await resolveIncludes(path);

  const { model, issues } = toModel({
    entryFile: path,
    files: resolved.files,
    options: composeOptions,
    defaultDbImages: DEFAULT_DB_IMAGES,
    defaultQueueImages: DEFAULT_QUEUE_IMAGES,
  });

  return {
    model,
    issues: [...resolved.issues, ...issues],
  };
};
