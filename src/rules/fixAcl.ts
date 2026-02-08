import type { ArchitectureModel } from "../model";
import type { AclOptions, Violation } from "./acl";
import type { FixResult, SourceSyntax } from "./fix";

export const fixAcl = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: AclOptions,
): FixResult[] => {
  const tag = options?.tag ?? "acl";
  const externalType = options?.externalType ?? "System_Ext";
  const results: FixResult[] = [];

  for (const violation of violations) {
    const container = model.allContainers.find(
      (c) => c.name === violation.container,
    );
    if (!container) continue;

    const externalRels = container.relations.filter(
      (r) => r.to.type === externalType,
    );
    if (externalRels.length === 0) continue;

    const aclName = `${container.name}_acl`;
    const fix: FixResult = {
      rule: "acl",
      description: `Add ACL layer for ${container.name}`,
      edits: [],
    };

    fix.edits.push({
      type: "add",
      search: syntax.containerPattern(container.name),
      content: syntax.containerDecl(aclName, `${container.label} ACL`, tag),
    });

    for (const rel of externalRels) {
      const tech = rel.technology ?? "";
      fix.edits.push({
        type: "replace",
        search: syntax.relationPattern(container.name, rel.to.name),
        content: syntax.relationDecl(container.name, aclName, tech),
      });
      fix.edits.push({
        type: "add",
        search: syntax.relationPattern(container.name, aclName),
        content: syntax.relationDecl(aclName, rel.to.name, tech),
      });
    }

    results.push(fix);
  }

  return results;
};
