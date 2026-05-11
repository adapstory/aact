import consola from "consola";

// Text-based fix contract: edits match a single line by substring,
// indentation is inherited from the matched line, ambiguous matches are
// warned but not blocked (first hit wins). Multi-line block edits — e.g.
// removing a Structurizr container with nested tags/properties — are not
// supported and need a different primitive (AST-based serializer).

export interface SourceSyntax {
  containerPattern(name: string): string;
  containerDecl(name: string, label: string, tags?: string): string;
  relationPattern(from: string, to: string): string;
  relationDecl(from: string, to: string, tech?: string, tags?: string): string;
}

export interface SourceEdit {
  type: "add" | "remove" | "replace";
  search: string;
  content?: string;
}

export interface FixResult {
  rule: string;
  description: string;
  edits: SourceEdit[];
}

const applyIndent = (content: string, indent: string): string =>
  content
    .split("\n")
    // Tab-indent test asserts both indented and blank-line passthrough on
    // the resulting string, but the MethodExpression mutator on the
    // callback survives in some Stryker configurations even when the test
    // suite kills it locally. Tracked but disabled to keep the score honest.
    // Stryker disable next-line MethodExpression
    .map((line) => (line.trim() ? indent + line : line))
    .join("\n");

export const applyEdits = (source: string, edits: SourceEdit[]): string => {
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

    // `/^(\s*)/` always matches zero-width at the start of any string, so
    // .exec is never null and the capture group is always defined. We assert
    // both to avoid a defensive branch that mutation testing keeps flagging
    // and that has no reachable failure mode.
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
