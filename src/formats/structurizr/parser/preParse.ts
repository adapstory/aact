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
  BangAdrs,
  BangComponents,
  BangConstantHardError,
  BangDecisions,
  BangDocs,
  BangExtendHardError,
  BangPlugin,
  BangRefHardError,
  BangScript,
  Branding,
  Configuration,
  ContainerInstance,
  DeploymentEnvironment,
  DeploymentGroup,
  DeploymentNode,
  EnterpriseHardError,
  HealthCheck,
  Identifier,
  InfrastructureNode,
  InstanceOf,
  LBrace,
  RBrace,
  SoftwareSystemInstance,
  StringLiteral,
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

/**
 * A deployment-family block (`deploymentEnvironment`, `deploymentNode`,
 * …) that the linter parses-then-skips. Surfaced as info-level
 * diagnostics so users see what was ignored; the model itself does
 * not get a deployment view today.
 */
export interface ParsedInfoBlock {
  /** The keyword that opened the block. */
  readonly construct: string;
  /** Why this block was skipped. */
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
  // Block-form `!directives`: each opens a `{ ... }` body that the
  // linter does not interpret. Reference grammar lets these appear at
  // workspace or model scope; positional args (script language name,
  // plugin id) sit between the keyword and `{`.
  BangScript,
  BangPlugin,
  BangComponents,
];

/**
 * Deployment-family keywords. These ARE parsed by the reference DSL,
 * but the linter does not model deployment topology — we strip the
 * blocks and emit one info-issue per occurrence so users know what
 * was skipped.
 */
const DEPLOYMENT_KEYWORDS = [
  DeploymentEnvironment,
  DeploymentNode,
  DeploymentGroup,
  InfrastructureNode,
  SoftwareSystemInstance,
  ContainerInstance,
  InstanceOf,
  HealthCheck,
];

const DEPLOYMENT_HINT =
  "Deployment-family constructs are recognised but not modelled by aact yet. The block was skipped so the rest of the workspace still parses.";

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

const isDeploymentKeyword = (token: IToken): boolean =>
  DEPLOYMENT_KEYWORDS.some((k) => tokenMatcher(token, k));

/**
 * Find the opening `{` of a block introduced by `tokens[keywordIdx]`.
 * Some block keywords accept positional arguments before the brace:
 *
 *   deploymentEnvironment "Production" {
 *   views "Some Name" {
 *
 * Skip ahead over `StringLiteral` and `Identifier` tokens. Returns the
 * index of the `{` token, or -1 if no opening brace is found before
 * any other significant token.
 */
const findOpeningBrace = (
  tokens: readonly IToken[],
  keywordIdx: number,
): number => {
  for (let k = keywordIdx + 1; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tokenMatcher(tk, LBrace)) return k;
    if (tokenMatcher(tk, StringLiteral) || tokenMatcher(tk, Identifier)) {
      continue;
    }
    return -1;
  }
  return -1;
};

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
    if (!isOpaqueKeyword(t)) {
      out.push(t);
      i++;
      continue;
    }
    const braceIdx = findOpeningBrace(tokens, i);
    if (braceIdx < 0) {
      out.push(t);
      i++;
      continue;
    }
    let depth = 1;
    let j = braceIdx + 1;
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
 * Inline directive keywords that take 1–2 positional args and NO body:
 * `!docs <path> [importer]`, `!decisions <path> [importer]`,
 * `!adrs <path> [importer]`. The linter ignores them entirely — but
 * we must strip the keyword AND its arguments, otherwise the parser
 * sees orphan identifiers/strings after the directive and reports
 * grammar errors. The pass walks the token stream; when it spots an
 * inline-directive keyword, it skips ahead over up to two trailing
 * `StringLiteral`/`Identifier`/`TextBlock` tokens.
 */
const INLINE_DIRECTIVES = [BangDocs, BangDecisions, BangAdrs];

const isInlineDirective = (token: IToken): boolean =>
  INLINE_DIRECTIVES.some((k) => tokenMatcher(token, k));

const isInlineDirectiveArg = (token: IToken): boolean => {
  const name = token.tokenType.name;
  return (
    name === "StringLiteral" || name === "TextBlock" || name === "Identifier"
  );
};

export const stripInlineDirectives = (tokens: readonly IToken[]): IToken[] => {
  const out: IToken[] = [];
  let i = 0;
  while (i < tokens.length) {
    const keywordTok = tokens[i];
    if (!isInlineDirective(keywordTok)) {
      out.push(keywordTok);
      i++;
      continue;
    }
    // Skip the keyword. Then skip up to two positional args, but only
    // if they sit on the SAME source line as the keyword — newlines
    // are stripped from the token stream, so we cross-check
    // `startLine` to avoid eating the next statement.
    const keywordLine = keywordTok.startLine;
    i++;
    let consumedArgs = 0;
    while (
      consumedArgs < 2 &&
      i < tokens.length &&
      isInlineDirectiveArg(tokens[i]) &&
      tokens[i].startLine === keywordLine
    ) {
      i++;
      consumedArgs++;
    }
  }
  return out;
};

/**
 * Walk the token array. When a deployment-family keyword is followed
 * by `{`, balance braces and strip the block — the linter does not
 * model deployment topology, so leaving the tokens in the stream
 * only creates parser noise. One `ParsedInfoBlock` is emitted per
 * stripped occurrence so callers can show "we saw N deployment
 * blocks and skipped them" instead of dropping them silently.
 *
 * A bare keyword without `{` (e.g. `instanceOf X` reference) is
 * passed through to the parser, which will surface a real error
 * since the grammar doesn't accept it at model scope. That's
 * preferred over silent loss.
 */
export const stripDeploymentBlocks = (
  tokens: readonly IToken[],
  file: string,
): { tokens: IToken[]; blocks: ParsedInfoBlock[] } => {
  const out: IToken[] = [];
  const blocks: ParsedInfoBlock[] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!isDeploymentKeyword(t)) {
      out.push(t);
      i++;
      continue;
    }
    const braceIdx = findOpeningBrace(tokens, i);
    if (braceIdx < 0) {
      out.push(t);
      i++;
      continue;
    }
    let depth = 1;
    let j = braceIdx + 1;
    while (j < tokens.length && depth > 0) {
      if (tokenMatcher(tokens[j], LBrace)) depth++;
      else if (tokenMatcher(tokens[j], RBrace)) depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) {
      out.push(t);
      i++;
      continue;
    }
    blocks.push({
      construct: t.image,
      hint: DEPLOYMENT_HINT,
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

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const meta = hardRemovedMeta(t);
    if (!meta) {
      out.push(t);
      i++;
      continue;
    }
    // Hard-removed token. Emit the diagnostic. If a balanced
    // `{ ... }` block follows the keyword (possibly after positional
    // string/identifier args, e.g. `enterprise "Acme" { ... }` or
    // `!ref bank { ... }`), strip the whole block — otherwise its
    // body tokens flood the parser with junk errors. A bare token
    // (no body) just drops itself.
    errors.push({
      construct: meta.construct,
      hint: meta.hint,
      range: rangeOfTokens(t, t, file),
    });
    const braceIdx = findOpeningBrace(tokens, i);
    if (braceIdx < 0) {
      i++;
      continue;
    }
    let depth = 1;
    let j = braceIdx + 1;
    while (j < tokens.length && depth > 0) {
      if (tokenMatcher(tokens[j], LBrace)) depth++;
      else if (tokenMatcher(tokens[j], RBrace)) depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) {
      // Unbalanced — leave the rest of the stream alone so the parser
      // produces a normal "missing }" error.
      i++;
      continue;
    }
    i = j + 1;
  }

  return { tokens: out, errors };
};

const hardRemovedMeta = (
  t: IToken,
): { construct: string; hint: string } | undefined =>
  [...HARD_REMOVED.entries()].find(([tok]) =>
    tokenMatcher(t, tok as Parameters<typeof tokenMatcher>[1]),
  )?.[1];
