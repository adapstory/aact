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
  let lines = source.split("\n");

  for (const edit of edits) {
    const idx = lines.findIndex((line) => line.includes(edit.search));
    if (idx === -1) continue;

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
        lines = [
          ...lines.slice(0, idx + 1),
          edit.content ?? "",
          ...lines.slice(idx + 1),
        ];
        break;
      }
    }
  }

  return lines.join("\n");
};
