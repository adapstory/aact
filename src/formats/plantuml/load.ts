import fs from "node:fs/promises";

import path from "pathe";

import type { LoadResult } from "../types";
import { parseSource } from "./parser";

/**
 * Load a `.puml` file via the chevrotain C4-PlantUML parser. The
 * parser does the heavy lifting (preParse → tokenise → CST → AST →
 * Model) so this function is a thin file-I/O wrapper.
 *
 * The full `parseSource` result also exposes `parseErrors` and
 * `preParseIssues`, but `LoadResult` is intentionally narrow (model +
 * issues) so users-as-library code can consume any format
 * uniformly. Lex / parse errors degrade the Model — for example, a
 * relation with an unresolvable source surfaces as a
 * `dangling-relation` issue via `validateModel`.
 */
export const load = async (filePath: string): Promise<LoadResult> => {
  const filepath = path.resolve(filePath);
  const raw = await fs.readFile(filepath, "utf8");
  const result = parseSource(raw, filepath);
  return {
    model: result.model,
    issues: result.issues,
  };
};
