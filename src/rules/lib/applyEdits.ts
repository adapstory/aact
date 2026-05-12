import consola from "consola";

import type { SourceEdit } from "../types";

/**
 * Text-based fix engine. Edits match single line by substring,
 * indentation наследуется от matched line, ambiguous matches warn'аются
 * (first hit wins). Multi-line block edits — not supported, нужен
 * AST-based primitive (future).
 */

const applyIndent = (content: string, indent: string): string =>
  content
    .split("\n")
    // Stryker disable next-line MethodExpression
    .map((line) => (line.trim() ? indent + line : line))
    .join("\n");

export const applyEdits = (
  source: string,
  edits: readonly SourceEdit[],
): string => {
  const lines = source.split("\n");

  for (const edit of edits) {
    const idx = lines.findIndex((line) => line.includes(edit.search));

    if (idx === -1) {
      consola.warn(`fix: pattern not found in source — "${edit.search}"`);
      continue;
    }

    const matchCount = lines.filter((line) =>
      line.includes(edit.search),
    ).length;
    if (matchCount > 1) {
      consola.warn(
        `fix: ambiguous pattern "${edit.search}" matches ${matchCount} lines, using first`,
      );
    }

    // `/^(\s*)/` always matches zero-width at the start of any string.
    // Stryker disable next-line Regex
    const indent = /^(\s*)/.exec(lines[idx])![1];

    switch (edit.type) {
      case "remove": {
        lines.splice(idx, 1);
        break;
      }
      case "replace": {
        lines[idx] = applyIndent(edit.content ?? "", indent);
        break;
      }
      case "add": {
        lines.splice(idx + 1, 0, applyIndent(edit.content ?? "", indent));
        break;
      }
    }
  }

  return lines.join("\n");
};
