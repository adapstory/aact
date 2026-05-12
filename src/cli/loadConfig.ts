import { loadConfig } from "c12";
import { basename } from "pathe";
import * as v from "valibot";

import type { AactConfig } from "../config";
import { AactConfigSchema } from "../config";
import { knownFormatNames, loadFormat } from "../formats/registry";
import { canLoad } from "../formats/types";

/**
 * Simple two-shape matcher для format.defaultPattern:
 *   - "*.puml" → extension match (ends with ".puml")
 *   - "workspace.json" → basename exact match
 *
 * Полноценный glob-engine не нужен — patterns в registry короткие и
 * предсказуемые. Когда appearance Mermaid / Compose потребуют что-то
 * сложнее — заменим на picomatch.
 */
const matchesPattern = (filePath: string, pattern: string): boolean => {
  if (pattern.startsWith("*")) {
    return filePath.endsWith(pattern.slice(1));
  }
  return basename(filePath) === pattern;
};

const inferSourceType = async (filePath: string): Promise<string> => {
  for (const name of knownFormatNames()) {
    const fmt = await loadFormat(name);
    if (!canLoad(fmt) || !fmt.defaultPattern) continue;
    if (matchesPattern(filePath, fmt.defaultPattern)) return name;
  }
  const known = knownFormatNames().join(", ");
  throw new Error(
    `Cannot infer source format from "${filePath}". Add explicit \`source.type\` to aact.config.ts (known: ${known}).`,
  );
};

export const loadAndValidateConfig = async (
  configPath?: string,
): Promise<AactConfig> => {
  const { config } = await loadConfig({
    name: "aact",
    ...(configPath ? { configFile: configPath } : {}),
  });
  if (!config) {
    throw new Error("No source configured. Create an aact.config.ts file.");
  }
  const parsed = v.parse(AactConfigSchema, config);

  // Normalize source: string shorthand → object form, infer type if missing.
  const rawSource =
    typeof parsed.source === "string" ? { path: parsed.source } : parsed.source;
  const type = rawSource.type ?? (await inferSourceType(rawSource.path));

  // Validate explicit type against registry — fail fast вместо deferred
  // "Unknown format" из loadModel. Inferred type гарантированно валиден.
  if (rawSource.type && !knownFormatNames().includes(type)) {
    throw new Error(
      `Unknown source.type "${type}" in aact.config.ts (known: ${knownFormatNames().join(", ")}).`,
    );
  }

  return {
    ...parsed,
    source: {
      path: rawSource.path,
      type,
      ...("writePath" in rawSource && rawSource.writePath !== undefined
        ? { writePath: rawSource.writePath }
        : {}),
    },
  };
};
