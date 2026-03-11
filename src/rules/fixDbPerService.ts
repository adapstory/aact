import consola from "consola";

import type { Container } from "../model";
import type { ArchitectureModel } from "../model";
import type { DbPerServiceOptions } from "./dbPerService";
import type { FixResult, SourceSyntax } from "./fix";
import type { Violation } from "./types";

const resolveOwner = (
  dbName: string,
  accessors: Container[],
  ownerTags: string[],
): Container => {
  const tagged = accessors.filter((c) =>
    c.tags?.some((t) => ownerTags.includes(t)),
  );

  if (tagged.length === 0) {
    consola.warn(
      `Cannot determine owner of ${dbName}: no ${ownerTags.join("/")} tagged accessor found, using ${accessors[0].name}`,
    );
    return accessors[0];
  }

  if (tagged.length > 1) {
    consola.warn(
      `Cannot determine owner of ${dbName}: multiple tagged accessors (${tagged.map((c) => c.name).join(", ")}), using ${tagged[0].name}`,
    );
  }

  return tagged[0];
};

export const fixDbPerService = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: DbPerServiceOptions,
): FixResult[] => {
  const dbType = options?.dbType ?? "ContainerDb";
  const ownerTags = options?.ownerTags ?? ["repo", "relay"];
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

    const owner = resolveOwner(db.name, accessors, ownerTags);
    const fix: FixResult = {
      rule: "dbPerService",
      description: `Redirect access to ${db.name} through ${owner.name}`,
      edits: accessors
        .filter((c) => c !== owner)
        .flatMap((accessor) => {
          const rel = accessor.relations.find((r) => r.to.name === db.name);
          if (!rel) {
            consola.warn(
              `fix dbPerService: relation from ${accessor.name} to ${db.name} not found, skipping`,
            );
            return [];
          }
          const tags =
            rel.tags && rel.tags.length > 0 ? rel.tags.join("+") : undefined;
          return [
            {
              type: "replace" as const,
              search: syntax.relationPattern(accessor.name, db.name),
              content: syntax.relationDecl(
                accessor.name,
                owner.name,
                rel.technology ?? "",
                tags,
              ),
            },
          ];
        }),
    };

    results.push(fix);
  }

  return results;
};
