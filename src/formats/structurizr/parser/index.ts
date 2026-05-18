/**
 * Public entry point for the Structurizr DSL chevrotain parser.
 *
 *   parseSource(text, filePath)
 *     → tokenise → parse → CST → AST → Model
 *     → LoadResult
 *
 * Today's grammar coverage matches `parser.ts` (workspace + model +
 * elements + body statements + directives + explicit relationships).
 * Remaining grammar.md surface area lands incrementally.
 */

import type { LoadResult } from "../../types";
import { parseStructurizrDsl } from "./parser";
import type {
  HardRemovedError,
  OpaqueBlock,
  ParsedInfoBlock,
} from "./preParse";
import {
  findHardRemovedTokens,
  stripDeploymentBlocks,
  stripInlineDirectives,
  stripOpaqueBlocks,
} from "./preParse";
import { StructurizrLexer } from "./tokens";
import { toModel } from "./toModel";
import { buildAst } from "./visitor";

export interface ChevrotainParseError {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ChevrotainParseResult extends LoadResult {
  /** Lexer + parser errors plus hard-removed-construct rejections.
   *  Empty on a clean parse. */
  readonly parseErrors: readonly ChevrotainParseError[];
  /** Opaque workspace blocks (views/styles/configuration/branding/
   *  terminology/themes) that were skipped during parsing. They are
   *  preserved here so a future writer can reinsert them verbatim. */
  readonly opaqueBlocks: readonly OpaqueBlock[];
  /** Deployment-family blocks (deploymentEnvironment/deploymentNode/
   *  …) skipped because aact does not model deployment topology yet.
   *  Each one carries the construct name and a hint so the CLI can
   *  show an info-level "N deployment blocks ignored" summary. */
  readonly infoBlocks: readonly ParsedInfoBlock[];
}

/**
 * Parse a Structurizr DSL source string. `filePath` is recorded on
 * every `SourceLocation` for downstream diagnostics; it does NOT need
 * to exist on disk.
 *
 * Returns the produced `Model` and an aggregated error list. Lexer
 * and parser errors do not throw; they are returned so the caller can
 * surface diagnostics in one pass.
 */
export const parseSource = (
  text: string,
  filePath: string,
): ChevrotainParseResult => {
  // Pre-lexer pass: collapse backslash-newline continuations into a
  // single logical line, mirroring the reference parser's line
  // preprocessing (`StructurizrDslParser.preProcessLines`). Without
  // this, fixtures like multi-line.dsl that wrap a long
  // `softwareSystem` declaration across several lines fail to parse.
  const joined = joinContinuationLines(text);
  const lex = StructurizrLexer.tokenize(joined);

  // Pre-parse passes in order:
  //   1. Strip opaque workspace blocks (views/styles/…) so their inner
  //      tokens never reach the parser or surface lex noise (`*` etc.).
  //   2. Strip deployment-family blocks — recognised but not modelled.
  //   3. Convert hard-removed tokens (`!ref`/`enterprise`/…) into
  //      explicit errors with replacement hints.
  const stripped = stripOpaqueBlocks(lex.tokens, filePath);
  const deployment = stripDeploymentBlocks(stripped.tokens, filePath);
  // Strip inline `!docs` / `!decisions` / `!adrs` directives — they
  // take 1–2 positional path/importer args and no body. Run AFTER
  // hard-removed pre-parse so a stray `!constant` near them still
  // surfaces with its full diagnostic.
  const inlineStripped = stripInlineDirectives(deployment.tokens);
  const hardRemoved = findHardRemovedTokens(inlineStripped, filePath);

  const { cst, errors: parserErrors } = parseStructurizrDsl(hardRemoved.tokens);

  const parseErrors: ChevrotainParseError[] = [];
  for (const err of lex.errors) {
    // Lex errors inside an opaque block (e.g. `*` in `include *` inside
    // `views { ... }`) are noise — the block is dropped before parsing,
    // so we drop the diagnostic too.
    if (isInsideOpaqueBlock(err, stripped.blocks)) continue;
    parseErrors.push({
      message: err.message,
      line: err.line ?? undefined,
      column: err.column ?? undefined,
    });
  }
  for (const e of hardRemoved.errors) {
    parseErrors.push(hardRemovedToParseError(e));
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
    opaqueBlocks: stripped.blocks,
    infoBlocks: deployment.blocks,
  };
};

/**
 * Replace every `\\\n[whitespace]*` with a single space so the
 * remaining text is one logical line per source line. The reference
 * parser (`StructurizrDslParser:1311-1383`) strips the leading
 * whitespace after the join; we use a single space to keep token
 * separation (`softwareSystem\` joined with `name "X"` becomes
 * `softwareSystem name "X"` rather than `softwareSystemname "X"`).
 *
 * Source positions in the joined string no longer match the original
 * file — line numbers from the lexer point at the joined-line index.
 * For downstream diagnostics this is acceptable: continuation lines
 * are by convention logically one line, and reference parser
 * diagnostics behave the same way.
 */
const joinContinuationLines = (text: string): string =>
  text.replaceAll(/\\\r?\n[ \t]*/g, " ");

const hardRemovedToParseError = (
  e: HardRemovedError,
): ChevrotainParseError => ({
  message: `\`${e.construct}\` is no longer supported. ${e.hint}`,
  line: e.range.start.line,
  column: e.range.start.col,
});

const isInsideOpaqueBlock = (
  err: { offset?: number; line?: number | null },
  blocks: readonly OpaqueBlock[],
): boolean => {
  if (typeof err.offset === "number") {
    return blocks.some(
      (b) =>
        err.offset! >= b.range.start.offset && err.offset! < b.range.end.offset,
    );
  }
  if (typeof err.line === "number") {
    return blocks.some(
      (b) => err.line! >= b.range.start.line && err.line! <= b.range.end.line,
    );
  }
  return false;
};

// Re-exports for callers that want the lower-level pieces.
export { parseStructurizrDsl, StructurizrParser } from "./parser";
export { StructurizrLexer } from "./tokens";
export { toModel } from "./toModel";
export { buildAst } from "./visitor";
