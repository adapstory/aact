import type { ArchitectureModel, Boundary } from "../model";
import type { Violation } from "./types";

export const checkCommonReuse = (model: ArchitectureModel): Violation[] => {
  // Container → boundary lookup
  const boundaryOf = new Map<string, Boundary>();
  for (const boundary of model.boundaries) {
    for (const c of boundary.containers) {
      boundaryOf.set(c.name, boundary);
    }
  }

  // Single pass: collect public containers and per-pair usage
  const publicOf = new Map<Boundary, Set<string>>();
  const used = new Map<string, Set<string>>();

  for (const source of model.allContainers) {
    const srcBoundary = boundaryOf.get(source.name);
    if (!srcBoundary) continue;

    for (const rel of source.relations) {
      const tgtBoundary = boundaryOf.get(rel.to.name);
      if (!tgtBoundary || tgtBoundary === srcBoundary) continue;

      let pub = publicOf.get(tgtBoundary);
      if (!pub) {
        pub = new Set();
        publicOf.set(tgtBoundary, pub);
      }
      pub.add(rel.to.name);

      const key = `${srcBoundary.name}\0${tgtBoundary.name}`;
      let u = used.get(key);
      if (!u) {
        u = new Set();
        used.set(key, u);
      }
      u.add(rel.to.name);
    }
  }

  // Report: consumer uses some but not all public containers of provider
  const violations: Violation[] = [];

  for (const [provider, pubNames] of publicOf) {
    if (pubNames.size < 2) continue;

    for (const consumer of model.boundaries) {
      if (consumer === provider) continue;

      const key = `${consumer.name}\0${provider.name}`;
      const usedNames = used.get(key);
      if (!usedNames || usedNames.size >= pubNames.size) continue;

      const missing = [...pubNames].filter((n) => !usedNames.has(n));
      violations.push({
        container: consumer.name,
        message: `uses ${[...usedNames].join(", ")} of "${provider.name}" but not ${missing.join(", ")} — all public services of a context should be used together`,
      });
    }
  }

  return violations;
};
