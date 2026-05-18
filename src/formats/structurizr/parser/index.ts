/**
 * Public entry point for the Structurizr DSL chevrotain parser.
 *
 *   parseSource(text, filePath)
 *     → tokenise → parse → CST → AST → Model
 *     → LoadResult
 *
 * Phase 1: minimal subset (workspace + model + elements + explicit
 * relationships) per `parser.ts` skeleton. Phase 2 expands toward full
 * grammar.md coverage.
 */

import type { LoadResult } from "../../types";
import { parseStructurizrDsl } from "./parser";
import { StructurizrLexer } from "./tokens";
import { toModel } from "./toModel";
import { buildAst } from "./visitor";

export interface ChevrotainParseError {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ChevrotainParseResult extends LoadResult {
  /** Lexer + parser errors. Empty on a clean parse. */
  readonly parseErrors: readonly ChevrotainParseError[];
}

/**
 * Parse a Structurizr DSL source string. `filePath` is recorded on
 * every `SourceLocation` for downstream diagnostics; it does NOT need
 * to exist on disk.
 *
 * Returns the produced `Model` (Phase-1 stub — workspace + elements +
 * relations only) and an aggregated error list. Lexer and parser
 * errors do not throw; they are returned so the caller can surface
 * diagnostics in one pass.
 */
export const parseSource = (
  text: string,
  filePath: string,
): ChevrotainParseResult => {
  const lex = StructurizrLexer.tokenize(text);
  const { cst, errors: parserErrors } = parseStructurizrDsl(lex.tokens);

  const parseErrors: ChevrotainParseError[] = [];
  for (const err of lex.errors) {
    parseErrors.push({
      message: err.message,
      line: err.line ?? undefined,
      column: err.column ?? undefined,
    });
  }
  for (const err of parserErrors as readonly {
    message?: string;
    token?: { startLine?: number; startColumn?: number };
  }[]) {
    parseErrors.push({
      message: err.message ?? "Parser error",
      line: err.token?.startLine,
      column: err.token?.startColumn,
    });
  }

  const workspace = buildAst(cst, filePath);
  const loadResult = toModel(workspace);

  return {
    model: loadResult.model,
    issues: loadResult.issues,
    parseErrors,
  };
};

// Re-exports for callers that want the lower-level pieces.
export { parseStructurizrDsl, StructurizrParser } from "./parser";
export { StructurizrLexer } from "./tokens";
export { toModel } from "./toModel";
export { buildAst } from "./visitor";
