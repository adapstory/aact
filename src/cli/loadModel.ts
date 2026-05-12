import consola from "consola";
import path from "pathe";

import type { AactConfig } from "../config";
import { loadFormat } from "../formats/registry";
import type {LoadResult} from "../formats/types";
import { canLoad  } from "../formats/types";

const isFileNotFound = (
  err: unknown,
): err is NodeJS.ErrnoException & { code: "ENOENT" } =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  err.code === "ENOENT";

const exitWithError = (message: string, hint?: string): never => {
  consola.error(message);
  if (hint) consola.info(hint);
  // eslint-disable-next-line n/no-process-exit
  return process.exit(1);
};

/**
 * Loads architecture model через format registry. Возвращает LoadResult с
 * Model + diagnostic issues (dangling refs, duplicate names etc.) от
 * validateModel + buildModel. CLI решает severity: fatal issues → exit,
 * warnings → consola.warn.
 *
 * Adding new source format = добавить formats/<name>/ + строчку в
 * formats/registry.ts. Никаких case'ов здесь.
 */
export const loadModel = async (config: AactConfig): Promise<LoadResult> => {
  const resolvedPath = path.resolve(config.source.path);

  try {
    const format = await loadFormat(config.source.type);
    if (!canLoad(format)) {
      return exitWithError(
        `Format "${format.name}" doesn't support load`,
        "Specify a source-capable format (plantuml, structurizr).",
      );
    }
    return await format.load(resolvedPath);
  } catch (error) {
    if (isFileNotFound(error)) {
      return exitWithError(
        `Architecture file not found: ${config.source.path}`,
        "Update source.path in aact.config.ts or create the file (`aact init` scaffolds a starter).",
      );
    }
    if (error instanceof SyntaxError && config.source.type === "structurizr") {
      return exitWithError(
        `Cannot parse Structurizr workspace: ${config.source.path}`,
        `${error.message}. Check that the file is valid JSON.`,
      );
    }
    if (
      error instanceof TypeError &&
      config.source.type === "structurizr" &&
      /softwareSystems|model|people/.test(error.message)
    ) {
      return exitWithError(
        `Invalid Structurizr workspace: ${config.source.path}`,
        'Expected a top-level "model" object with "softwareSystems". See examples/ecommerce-structurizr/ for a working sample.',
      );
    }
    throw error;
  }
};
