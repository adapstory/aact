/**
 * Pre-lex passes for the C4-PlantUML chevrotain parser.
 *
 * The reference C4-PlantUML stdlib mixes architectural macros
 * (`Container(...)`, `Rel(...)`, `System_Boundary(...) { ... }`) with
 * a large body of host PlantUML syntax (`!include`, `LAYOUT_*`,
 * `skinparam`, `title`, `note`, `class`, …) that the linter has no
 * business interpreting. Letting that material through to the parser
 * would mean every real-world `.puml` file fails to lex.
 *
 * Approach: rewrite the **raw source** before tokenisation, replacing
 * out-of-scope content with whitespace **of the same length** (JS
 * string length = UTF-16 code units, the unit chevrotain operates on).
 * This is the only safe transform — chevrotain's `positionTracking:
 * "full"` records code-unit offsets from the start of the lexer input,
 * so if we shorten the source by even one character every downstream
 * `SourceLocation` is wrong. Whitespace-preserving strip keeps offsets
 * identical between the stripped buffer and the original file, so the
 * `range` carried by every AST node points at the same position in
 * the user's `.puml` that they typed.
 *
 * Passes (applied in order):
 *
 *   1. `stripPreprocessor` — drops every line starting with `!`
 *      (after optional whitespace). Covers `!include`, `!includeurl`,
 *      `!define`, `!if`/`!else`/`!endif`, `!procedure`/`!function`,
 *      `!global`, etc. The reference stdlib uses `!if` blocks inside
 *      `!includes` of itself, so without this pass the lexer never
 *      gets past the URL line.
 *
 *   2. `stripPlantumlNative` — drops every line whose first token is
 *      a PlantUML host keyword the linter does not interpret
 *      (`skinparam`, `title`, `caption`, `header`, `footer`,
 *      `hide`, `show`, `scale`, `legend`, `endlegend`, `note`,
 *      `endnote`, `together`, `class`, `interface`, `enum`, …).
 *      `note ... end note` multi-line blocks land in the same pass.
 *
 *   3. `stripOpaqueMacros` — drops every line that opens with a known
 *      opaque C4 macro call: `LAYOUT_*`, `HIDE_STEREOTYPE`,
 *      `SHOW_*`, `SET_SKETCH_STYLE`, `SetPropertyHeader`,
 *      `AddProperty`, `WithoutPropertyHeader`,
 *      `SetDefaultLegendEntries`, `UpdateLegendTitle`,
 *      `Add*Tag` (`AddElementTag`, `AddRelTag`, `AddBoundaryTag`,
 *      `AddNodeTag`, `Add*PersonTag`/`Add*SystemTag`/etc.),
 *      `Update*Style` (`UpdateElementStyle`, `UpdateRelStyle`,
 *      `Update*BoundaryStyle`). The implementation walks balanced
 *      parens across newlines, so multi-line opaque calls (named-arg
 *      lists wrapped onto several lines) strip cleanly.
 *
 *   4. `stripDeploymentBlocks` — `Deployment_Node`, `Node`, `Node_L`,
 *      `Node_R`, `Deployment_Node_L`, `Deployment_Node_R`. Per
 *      `grammar.md` §3 these are parsed-then-info-issue: out of C4
 *      scope, but a legal file must not crash. Whitespace out the
 *      macro call AND its balanced `{ ... }` body (if present); emit
 *      one `infoIssue` per stripped block.
 *
 *   5. `keepFirstDiagram` — `.puml` may hold multiple
 *      `@startuml`/`@enduml` blocks. aact processes the first and
 *      emits an info-issue for the rest.
 *
 * Each pass returns the rewritten text plus a list of `PreParseIssue`s
 * with full `SourceLocation` so the CLI can surface "N deployment
 * blocks ignored", "M opaque macros stripped", etc.
 */

import type { SourceLocation } from "../../../model";

/**
 * Info-level diagnostic raised by a pre-lex pass. The PUML parser's
 * `index.ts` aggregates these alongside lex/parse errors into the
 * `LoadResult` returned to the CLI. Distinct from `ModelIssue` —
 * `ModelIssue` is a closed union of post-build invariant violations;
 * preParse issues are processing notes (deployment skipped, second
 * diagram ignored) that the CLI surfaces as informational output.
 */
export interface PreParseIssue {
  readonly kind: "info";
  readonly message: string;
  readonly range: SourceLocation;
}

export interface PreParseResult {
  /** Source text after all strip passes — same length as input (UTF-16 code units). */
  readonly text: string;
  /** Info-level notes raised by the passes. */
  readonly issues: readonly PreParseIssue[];
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Replace every char of `s` with a space, preserving `\n` and `\r`. */
const blank = (s: string): string => s.replaceAll(/[^\r\n]/g, " ");

/**
 * Compute 1-based `{line, col, offset}` for a 0-based offset inside
 * the source. Used to build `SourceLocation` ranges for `PreParseIssue`s.
 *
 * The implementation is O(offset) per call — fine for the small number
 * of issues we emit (one per stripped block, not per stripped char).
 */
const positionAt = (
  source: string,
  offset: number,
): { line: number; col: number; offset: number } => {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col, offset };
};

const rangeOf = (
  source: string,
  start: number,
  end: number,
  file: string,
): SourceLocation => ({
  file,
  start: positionAt(source, start),
  end: positionAt(source, end),
});

// ── Pass 1: preprocessor directives ─────────────────────────────────

/**
 * Every line whose first non-whitespace character is `!` is replaced
 * with whitespace. PlantUML preprocessor directives can be multi-line
 * via `\` continuation (rare in C4 files) — we accept that current
 * implementation only handles the single-line form and note this as a
 * known limitation in `grammar.md`.
 */
export const stripPreprocessor = (text: string): string =>
  text.replaceAll(/^[ \t]*!.*$/gm, (line) => blank(line));

// ── Pass 2: PlantUML native ─────────────────────────────────────────

/**
 * Tokens we treat as line-leading PlantUML host syntax. The list is
 * conservative — anything we miss surfaces as a parse error rather
 * than silent loss, which is recoverable. Keep this list narrow and
 * authoritative; extending it loosens the safety net.
 */
const PLANTUML_NATIVE_LEADERS = [
  "skinparam",
  "title",
  "caption",
  "header",
  "footer",
  "hide",
  "show",
  "scale",
  "legend",
  "endlegend",
  "note",
  String.raw`end\s+note`,
  "endnote",
  "together",
  // UML element keywords that may appear as block openers
  "class",
  "interface",
  "abstract",
  "enum",
  "namespace",
  "package",
  "actor",
  "participant",
  "usecase",
  "state",
  "object",
  "database",
];

const PLANTUML_NATIVE_RE = new RegExp(
  String.raw`^[ \t]*(?:${PLANTUML_NATIVE_LEADERS.join("|")})\b.*$`,
  "gim",
);

export const stripPlantumlNative = (text: string): string => {
  // First pass — single-line statements.
  let out = text.replaceAll(PLANTUML_NATIVE_RE, (line) => blank(line));
  // Second pass — `note ... end note` / `note ... endnote` blocks.
  out = out.replaceAll(/note\b[\s\S]*?\bend\s*note\b/gi, (block) =>
    blank(block),
  );
  return out;
};

// ── Pass 3: opaque C4 macros ────────────────────────────────────────

const OPAQUE_MACRO_NAMES = [
  // Layout / view directives
  "LAYOUT_TOP_DOWN",
  "LAYOUT_LEFT_RIGHT",
  "LAYOUT_LANDSCAPE",
  "LAYOUT_WITH_LEGEND",
  "LAYOUT_AS_SKETCH",
  // Legend / element visibility
  "SHOW_LEGEND",
  "SHOW_FLOATING_LEGEND",
  "SHOW_DYNAMIC_LEGEND",
  "SHOW_ELEMENT_TYPE",
  "SHOW_PERSON_SPRITE",
  "SHOW_PERSON_PORTRAIT",
  "SHOW_PERSON_OUTLINE",
  "HIDE_STEREOTYPE",
  "HIDE_PERSON_SPRITE",
  "SET_SKETCH_STYLE",
  "SetDefaultLegendEntries",
  "UpdateLegendTitle",
  // Property table
  "SetPropertyHeader",
  "AddProperty",
  "WithoutPropertyHeader",
  // Tag declarations
  "AddElementTag",
  "AddRelTag",
  "AddBoundaryTag",
  "AddNodeTag",
  "AddPersonTag",
  "AddSystemTag",
  "AddContainerTag",
  "AddComponentTag",
  "AddExternalContainerTag",
  "AddExternalComponentTag",
  "AddExternalPersonTag",
  "AddExternalSystemTag",
  // Style overrides
  "UpdateElementStyle",
  "UpdateRelStyle",
  "UpdateBoundaryStyle",
  "UpdateContainerBoundaryStyle",
  "UpdateEnterpriseBoundaryStyle",
  "UpdateSystemBoundaryStyle",
];

const OPAQUE_MACRO_RE = new RegExp(
  String.raw`^[ \t]*(?:${OPAQUE_MACRO_NAMES.join("|")})\s*\(`,
);

/**
 * Strip lines opening with a known opaque macro call. The macro may
 * span multiple lines (multi-line `$arg=` list), so we balance the
 * parentheses character-by-character starting at the opening `(`.
 *
 * `text` is rewritten in place; the same string length is preserved
 * (paren-counter walks the buffer character by character).
 */
export const stripOpaqueMacros = (text: string): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!OPAQUE_MACRO_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    // Find the opening paren on this line and balance through the rest
    // of the buffer.
    const openIdx = line.indexOf("(");
    if (openIdx === -1) {
      out.push(line);
      i++;
      continue;
    }
    let depth = 0;
    let j = i;
    let closed = false;
    const blankedLines: string[] = [];
    while (j < lines.length) {
      const current = j === i ? line : lines[j];
      let blanked = "";
      for (let k = 0; k < current.length; k++) {
        const ch = current[k];
        const inPrefix = j === i && k < openIdx;
        if (!inPrefix && ch === "(") depth++;
        else if (!inPrefix && ch === ")") {
          depth--;
          if (depth === 0) {
            // Blank the closing `)`, then copy the original trailing
            // characters on the same line — anything after `)` may be
            // a separate macro call we shouldn't touch.
            blanked += ` ${current.slice(k + 1)}`;
            closed = true;
            break;
          }
        }
        blanked += " ";
      }
      blankedLines.push(blanked);
      j++;
      if (closed) break;
    }
    if (!closed) {
      // Unbalanced — fall back to per-line strip of just the opening
      // line so we don't accidentally eat the rest of the file.
      out.push(blank(line));
      i++;
      continue;
    }
    out.push(...blankedLines);
    i = j;
  }
  return out.join("\n");
};

// ── Pass 3.5: arithmetic after function-call values ─────────────────

/**
 * PUML preprocessor lets `$index=Index()-1` evaluate as
 * `Index() - 1` at render time. The C4 macro grammar has no notion
 * of arithmetic expressions — `)` must be followed by `,` or `)`,
 * so the bare `-1` after `Index()` would crash the parser.
 *
 * The architectural meaning of `Index()-1` is "this step's index
 * minus one" — a presentation-time auto-numbering offset that
 * does not survive into the Model anyway (the Index() sentinel
 * itself already collapses to `Relation.order = undefined`).
 *
 * Strategy: strip the `[op N]` tail after a function-call's `)` so
 * the parser sees a clean `Index()` and grammar accepts it. Byte
 * length preserved as usual.
 *
 * Pattern: literal `)` followed by optional whitespace, an operator
 * (`+ - * /`), more whitespace, and digits. The operator/digits are
 * blanked; the `)` survives. Repeats across the source.
 */
export const stripArithmeticAfterFunctionCalls = (text: string): string =>
  text.replaceAll(
    /(\))(\s*[+\-*/]\s*\d+)/g,
    (_match, paren: string, tail: string) => paren + blank(tail),
  );

// ── Pass 4: deployment blocks (info-issue) ──────────────────────────

const DEPLOYMENT_MACRO_NAMES = [
  "Deployment_Node_L",
  "Deployment_Node_R",
  "Deployment_Node",
  "Node_L",
  "Node_R",
  "Node",
];

const DEPLOYMENT_HEAD_RE = new RegExp(
  String.raw`\b(?:${DEPLOYMENT_MACRO_NAMES.join("|")})\s*\(`,
);

/**
 * Walk `text` looking for deployment-macro names. When found, balance
 * the `( ... )` argument list AND the optional trailing `{ ... }`
 * body, then whitespace the entire span.
 */
export const stripDeploymentBlocks = (
  text: string,
  file: string,
): { text: string; issues: PreParseIssue[] } => {
  const issues: PreParseIssue[] = [];
  // Iterative scan: walk through `text`, replacing each matched
  // deployment span with whitespace of equal length.
  const chars = [...text];
  let scanFrom = 0;
  while (scanFrom < text.length) {
    DEPLOYMENT_HEAD_RE.lastIndex = scanFrom;
    const tail = text.slice(scanFrom);
    const m = DEPLOYMENT_HEAD_RE.exec(tail);
    if (!m) break;
    const matchStart = scanFrom + m.index;
    const parenStart = matchStart + m[0].length - 1; // index of `(`
    // Balance parens.
    let depth = 0;
    let p = parenStart;
    while (p < text.length) {
      const ch = text[p];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      p++;
    }
    if (depth !== 0) break; // unbalanced — leave the rest alone
    let end = p + 1;
    // Optional `{ ... }` body — skip whitespace, then balance braces if
    // we see `{`.
    let q = end;
    while (q < text.length && /\s/.test(text[q])) q++;
    if (text[q] === "{") {
      let bDepth = 1;
      q++;
      while (q < text.length && bDepth > 0) {
        if (text[q] === "{") bDepth++;
        else if (text[q] === "}") bDepth--;
        q++;
      }
      if (bDepth === 0) end = q;
    }
    // Whitespace out [matchStart, end).
    for (let k = matchStart; k < end; k++) {
      if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
    }
    issues.push({
      kind: "info",
      message:
        "Deployment view macro recognised but ignored — aact's C4 scope is Static + Dynamic views only.",
      range: rangeOf(text, matchStart, end, file),
    });
    scanFrom = end;
  }
  return { text: chars.join(""), issues };
};

// ── Pass 5: keep only the first diagram ─────────────────────────────

/**
 * Whitespace out everything after the first `@enduml` (inclusive of
 * subsequent `@startuml ... @enduml` blocks). Emits one info-issue
 * pointing at the start of the second `@startuml`.
 */
export const keepFirstDiagram = (
  text: string,
  file: string,
): { text: string; issues: PreParseIssue[] } => {
  const firstEndUml = text.search(/@enduml\b/);
  if (firstEndUml < 0) return { text, issues: [] };
  const afterFirst = firstEndUml + "@enduml".length;
  const remainder = text.slice(afterFirst);
  const nextStart = remainder.search(/@startuml\b/);
  if (nextStart < 0) return { text, issues: [] };
  const absNextStart = afterFirst + nextStart;
  // Whitespace out [absNextStart .. end of text).
  const chars = [...text];
  for (let k = absNextStart; k < chars.length; k++) {
    if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
  }
  return {
    text: chars.join(""),
    issues: [
      {
        kind: "info",
        message:
          "Multiple `@startuml ... @enduml` diagrams in file — only the first is processed.",
        range: rangeOf(text, absNextStart, chars.length, file),
      },
    ],
  };
};

// ── Composite ───────────────────────────────────────────────────────

/**
 * Apply all pre-lex passes in order. Each pass preserves string length,
 * so the resulting `text` has identical offsets for surviving content.
 */
export const preParse = (text: string, file: string): PreParseResult => {
  let cur = stripPreprocessor(text);
  cur = stripPlantumlNative(cur);
  cur = stripOpaqueMacros(cur);
  cur = stripArithmeticAfterFunctionCalls(cur);
  const dep = stripDeploymentBlocks(cur, file);
  cur = dep.text;
  const diag = keepFirstDiagram(cur, file);
  cur = diag.text;
  return { text: cur, issues: [...dep.issues, ...diag.issues] };
};
