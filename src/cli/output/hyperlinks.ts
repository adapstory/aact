import terminalLink from "terminal-link";

import type { SourceLocation } from "../../model";

/**
 * Terminal hyperlink helpers for source-location anchoring.
 *
 * Architectural seam: `SourceLocation` is structured data carried by
 * `Violation` / `Container` / `Boundary` / `Relation`. JSON envelope
 * passes it through as-is — agentic consumers (Claude Code, Codex
 * CLI, dashboards) inspect `range.start.line` etc. directly. Text
 * mode wraps the same data in OSC8 hyperlinks via these helpers.
 *
 * Detection (`terminal-link.isSupported`) honours `NO_COLOR` / `CI`
 * env, VSCode integrated terminal quirks, Windows Terminal, and
 * older tmux without OSC8 forward. Falls back to plain text
 * automatically — no opt-out flag is needed today.
 */

export interface HyperlinkOptions {
  /** Explicit override (e.g. from a future `--no-hyperlinks` flag). */
  readonly disabled?: boolean;
}

/**
 * Build a `file://<abs>:<line>:<col>` URI that VSCode's integrated
 * terminal parses to jump to the exact byte; iTerm2, Ghostty, and
 * Windows Terminal open the file in the OS default editor (line:col
 * is ignored harmlessly). The line and column are 1-based.
 */
const buildFileUri = (loc: SourceLocation): string =>
  `file://${loc.file}:${loc.start.line}:${loc.start.col}`;

/**
 * Wrap `text` in an OSC8 clickable hyperlink pointing at `loc`. Falls
 * back to plain `text` when:
 *   - `loc` is undefined (rule didn't anchor the violation);
 *   - `opts.disabled` is true (explicit user override);
 *   - the host terminal doesn't support OSC8 (CI, piped output,
 *     older terminals — detected by `terminal-link`).
 *
 * Library safety: never emits escape sequences when stdout isn't a
 * TTY, so a CLI consumer piping to `jq` or writing to a file sees
 * clean text.
 */
export const linkSourceLocation = (
  text: string,
  loc?: SourceLocation,
  opts?: HyperlinkOptions,
): string => {
  if (!loc) return text;
  if (opts?.disabled) return text;
  if (!terminalLink.isSupported) return text;
  return terminalLink(text, buildFileUri(loc), { fallback: () => text });
};

/**
 * Re-export of the pure-data location formatter from `model/lib.ts`.
 * Kept here so callers that only need the CLI hyperlink helpers can
 * import both from one module; library consumers should prefer
 * `import { formatLocation } from "aact"` (it lives in the library
 * layer where it belongs).
 */
export { formatLocation } from "../../model";
