import consola from "consola";

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

    switch (edit.type) {
      case "remove": {
        lines.splice(idx, 1);
        break;
      }
      case "replace": {
        lines[idx] = edit.content ?? "";
        break;
      }
      case "add": {
        lines.splice(idx + 1, 0, edit.content ?? "");
        break;
      }
    }
  }

  return lines.join("\n");
};
