/**
 * Post-lex / pre-parse passes for the Structurizr DSL chevrotain
 * parser. Two responsibilities:
 *
 *   1. **Opaque-block stripping.** Workspace-scope blocks the linter
 *      does not interpret (`views`, `styles`, `configuration`,
 *      `branding`, `terminology`, `themes`) are removed from the
 *      token stream by balance-brace counting. The parser only sees
 *      the parts of the workspace it can model; the stripped chunks
 *      are surfaced as `OpaqueBlock[]` so a future writer can put
 *      them back verbatim on round-trip.
 *
 *   2. **Hard-removed reference errors.** The official reference
 *      parser throws on `!ref`, `!extend`, `!constant`, and
 *      `enterprise`. The lexer emits dedicated tokens for them; this
 *      pass converts every occurrence into a `HardRemovedError` with
 *      a hint at the modern replacement and removes the offending
 *      tokens so the rest of the file still parses.
 *
 * Both passes operate on the already-lexed token array — they don't
 * re-read the source. Source location for opaque blocks is rebuilt
 * from the spanning `{`…`}` token range so callers can highlight the
 * block in the original file.
 */

import type { IToken } from "chevrotain";
import { tokenMatcher } from "chevrotain";

import type { SourceLocation } from "../../../model";
import {
  BangConstantHardError,
  BangExtendHardError,
  BangRefHardError,
  Branding,
  Configuration,
  EnterpriseHardError,
  LBrace,
  RBrace,
  Styles,
  Terminology,
  Theme,
  Themes,
  Views,
} from "./tokens";

export interface OpaqueBlock {
  /** The keyword that opened the block — `views`, `styles`, etc. */
  readonly name: string;
  /** SourceLocation from the keyword to the matching `}` (inclusive
   *  half-open: end points one past the closing brace). */
  readonly range: SourceLocation;
}

export interface HardRemovedError {
  /** Identifier of the construct (`!ref`, `enterprise`, …). */
  readonly construct: string;
  /** Human hint at the modern replacement. */
  readonly hint: string;
  readonly range: SourceLocation;
}

const OPAQUE_KEYWORDS = [
  Views,
  Styles,
  Configuration,
  Branding,
  Terminology,
  Themes,
  Theme,
];

const HARD_REMOVED = new Map<unknown, { construct: string; hint: string }>([
  [
    BangRefHardError,
    {
      construct: "!ref",
      hint: "Removed in Structurizr DSL 1.0 — use `!extend` or a direct identifier reference instead.",
    },
  ],
  [
    BangExtendHardError,
    {
      construct: "!extend",
      hint: 'Removed in Structurizr DSL 1.0 — workspace extension is now via `workspace extends "..."`.',
    },
  ],
  [
    BangConstantHardError,
    {
      construct: "!constant",
      hint: "Renamed to `!const` in Structurizr DSL 1.0.",
    },
  ],
  [
    EnterpriseHardError,
    {
      construct: "enterprise",
      hint: "Removed in Structurizr DSL 1.0 — use a `group` element or model-level `properties` instead.",
    },
  ],
]);

const isOpaqueKeyword = (token: IToken): boolean =>
  OPAQUE_KEYWORDS.some((k) => tokenMatcher(token, k));

const rangeOfTokens = (
  first: IToken,
  last: IToken,
  file: string,
): SourceLocation => ({
  file,
  start: {
    line: first.startLine!,
    col: first.startColumn!,
    offset: first.startOffset,
  },
  end: {
    line: last.endLine!,
    col: last.endColumn! + 1,
    offset: last.endOffset! + 1,
  },
});

/**
 * Walk the token array. When an opaque keyword is followed by `{`,
 * balance braces to find the closing `}` and drop every token in
 * between. Nested `{`…`}` pairs inside the opaque block are matched
 * by depth so a `views { container "X" { … } }` block strips cleanly.
 *
 * If the opening `{` is missing (e.g. `views { ... }` mis-lexed) or
 * the closing `}` is never found, the pass leaves the tokens alone
 * so chevrotain's own error recovery can surface a useful diagnostic.
 */
export const stripOpaqueBlocks = (
  tokens: readonly IToken[],
  file: string,
): { tokens: IToken[]; blocks: OpaqueBlock[] } => {
  const out: IToken[] = [];
  const blocks: OpaqueBlock[] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (
      !isOpaqueKeyword(t) ||
      !tokens[i + 1] ||
      !tokenMatcher(tokens[i + 1], LBrace)
    ) {
      out.push(t);
      i++;
      continue;
    }

    // We have `<opaqueKeyword> {` — balance braces to find the close.
    let depth = 1;
    let j = i + 2;
    while (j < tokens.length && depth > 0) {
      if (tokenMatcher(tokens[j], LBrace)) depth++;
      else if (tokenMatcher(tokens[j], RBrace)) depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) {
      // Unbalanced — fall back to passing tokens through so the parser
      // surfaces a real error rather than us silently swallowing the
      // tail of the file.
      out.push(t);
      i++;
      continue;
    }

    blocks.push({
      name: t.image,
      range: rangeOfTokens(t, tokens[j], file),
    });
    i = j + 1;
  }

  return { tokens: out, blocks };
};

/**
 * Walk the token array. Every match of a hard-removed token becomes
 * a `HardRemovedError` with file/line context; the token itself is
 * dropped from the stream so the rest of the file still parses.
 *
 * The token always points at a single lexeme (`!ref`, `enterprise`,
 * etc.), so the source range is just that token's start/end.
 */
export const findHardRemovedTokens = (
  tokens: readonly IToken[],
  file: string,
): { tokens: IToken[]; errors: HardRemovedError[] } => {
  const out: IToken[] = [];
  const errors: HardRemovedError[] = [];

  for (const t of tokens) {
    const meta = [...HARD_REMOVED.entries()].find(([tok]) =>
      tokenMatcher(t, tok as Parameters<typeof tokenMatcher>[1]),
    )?.[1];
    if (meta) {
      errors.push({
        construct: meta.construct,
        hint: meta.hint,
        range: rangeOfTokens(t, t, file),
      });
      continue;
    }
    out.push(t);
  }

  return { tokens: out, errors };
};
