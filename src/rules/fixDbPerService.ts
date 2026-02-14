import type { ArchitectureModel } from "../model";
import type { DbPerServiceOptions } from "./dbPerService";
import type { FixResult, SourceSyntax } from "./fix";
import type { Violation } from "./types";

export const fixDbPerService = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: DbPerServiceOptions,
): FixResult[] => {
  const dbType = options?.dbType ?? "ContainerDb";
  const results: FixResult[] = [];

  for (const violation of violations) {
    const db = model.allContainers.find(
      (c) => c.name === violation.container && c.type === dbType,
    );
    if (!db) continue;

    const accessors = model.allContainers.filter((c) =>
      c.relations.some((r) => r.to.name === db.name),
    );
    if (accessors.length <= 1) continue;

    const owner = accessors[0];
    const fix: FixResult = {
      rule: "dbPerService",
      description: `Redirect access to ${db.name} through ${owner.name}`,
      edits: [],
    };

    for (const accessor of accessors.slice(1)) {
      const rel = accessor.relations.find((r) => r.to.name === db.name);
      if (!rel) continue;

      const tags =
        rel.tags && rel.tags.length > 0 ? rel.tags.join("+") : undefined;
      const oldRel = syntax.relationPattern(accessor.name, db.name);
      const newRel = syntax.relationDecl(
        accessor.name,
        owner.name,
        rel.technology ?? "",
        tags,
      );

      fix.edits.push({ type: "replace", search: oldRel, content: newRel });
    }

    results.push(fix);
  }

  return results;
};
