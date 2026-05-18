import path from "pathe";

import type { AactConfig } from "../config";
import { loadFormat } from "../formats/registry";
import type { LoadResult } from "../formats/types";
import { canLoad } from "../formats/types";
import type { ModelIssue } from "../model";
import type { Diagnostic, DiagnosticKind } from "./output";
import { ToolError } from "./output";

const issueKindMap: Record<ModelIssue["kind"], DiagnosticKind> = {
  "dangling-relation": "model.danglingRelation",
  "container-in-boundary-not-in-model": "model.containerInBoundaryNotInModel",
  "boundary-not-in-model": "model.boundaryNotInModel",
  "boundary-cycle": "model.boundaryCycle",
  "duplicate-container-name": "model.duplicateContainerName",
  "duplicate-boundary-name": "model.duplicateBoundaryName",
  "self-relation": "model.selfRelation",
  "unknown-kind": "model.unknownKind",
};

const issueContext = (issue: ModelIssue): Record<string, string> => {
  switch (issue.kind) {
    case "dangling-relation": {
      return { from: issue.from, to: issue.to };
    }
    case "container-in-boundary-not-in-model": {
      return { container: issue.container, boundary: issue.boundary };
    }
    case "boundary-not-in-model": {
      return { parent: issue.parent, child: issue.child };
    }
    case "boundary-cycle": {
      return { path: issue.path.join(" → ") };
    }
    case "duplicate-container-name":
    case "duplicate-boundary-name": {
      return { name: issue.name };
    }
    case "self-relation": {
      return { container: issue.container };
    }
    case "unknown-kind": {
      return { container: issue.container, raw: issue.raw };
    }
  }
};

const issueMessage = (issue: ModelIssue): string => {
  switch (issue.kind) {
    case "dangling-relation": {
      return `Relation "${issue.from} → ${issue.to}" references unknown target`;
    }
    case "container-in-boundary-not-in-model": {
      return `Boundary "${issue.boundary}" references container "${issue.container}" not in model`;
    }
    case "boundary-not-in-model": {
      return `Boundary "${issue.parent}" references child boundary "${issue.child}" not in model`;
    }
    case "boundary-cycle": {
      return `Boundary cycle detected: ${issue.path.join(" → ")}`;
    }
    case "duplicate-container-name": {
      return `Duplicate container name "${issue.name}"`;
    }
    case "duplicate-boundary-name": {
      return `Duplicate boundary name "${issue.name}"`;
    }
    case "self-relation": {
      return `Container "${issue.container}" has a relation to itself`;
    }
    case "unknown-kind": {
      return `Container "${issue.container}" has unknown kind "${issue.raw}"`;
    }
  }
};

export const issueToDiagnostic = (issue: ModelIssue): Diagnostic => ({
  kind: issueKindMap[issue.kind],
  message: issueMessage(issue),
  severity: "warning",
  context: issueContext(issue),
});

const isFileNotFound = (
  err: unknown,
): err is NodeJS.ErrnoException & { code: "ENOENT" } =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  err.code === "ENOENT";

/**
 * Loads architecture model через format registry. Возвращает LoadResult с
 * Model + diagnostic issues (dangling refs, duplicate names etc.) от
 * validateModel + buildModel. CLI решает severity: fatal issues → exit,
 * warnings → diagnostics envelope.
 *
 * Adding new source format = добавить formats/<name>/ + строчку в
 * formats/registry.ts. Никаких case'ов здесь.
 *
 * On failure throws `ToolError` which the runner converts into an exit-2
 * envelope with the matching diagnostic kind. No `process.exit` calls here.
 */
export const loadModel = async (config: AactConfig): Promise<LoadResult> => {
  const resolvedPath = path.resolve(config.source.path);

  try {
    const format = await loadFormat(config.source.type);
    if (!canLoad(format)) {
      throw new ToolError(
        "model.unsupportedLoad",
        `Format "${format.name}" doesn't support load. Specify a source-capable format (plantuml, structurizr).`,
        { format: format.name },
      );
    }
    return await format.load(resolvedPath);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (isFileNotFound(error)) {
      throw new ToolError(
        "model.sourceNotFound",
        `Architecture file not found: ${config.source.path}. Update source.path in aact.config.ts or run \`aact init\` to scaffold a starter.`,
        { path: config.source.path },
      );
    }
    if (error instanceof SyntaxError && config.source.type === "structurizr") {
      throw new ToolError(
        "model.parseError",
        `Cannot parse Structurizr workspace: ${config.source.path}. ${error.message}. Check that the file is valid JSON.`,
        { path: config.source.path, format: "structurizr" },
      );
    }
    if (
      error instanceof TypeError &&
      config.source.type === "structurizr" &&
      /softwareSystems|model|people/.test(error.message)
    ) {
      throw new ToolError(
        "model.parseError",
        `Invalid Structurizr workspace: ${config.source.path}. Expected a top-level "model" object with "softwareSystems".`,
        { path: config.source.path, format: "structurizr" },
      );
    }
    throw error;
  }
};
