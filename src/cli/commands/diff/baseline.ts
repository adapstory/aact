import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DiffSide } from "../../../diff";
import { knownFormatNames, loadFormat } from "../../../formats/registry";
import { canLoad } from "../../../formats/types";
import type { Model, ModelIssue } from "../../../model";
import { ToolError } from "../../output";

/**
 * Resolve `<arg>` to a normalized Model + provenance label, for
 * `aact diff <baseline> [<current>]`. Three input forms:
 *
 *  - **File path** — `./architecture.puml`, `./snapshot.aact.json`.
 *    Format is inferred from the extension via the registry.
 *  - **Git ref** — `<ref>:<path>`, e.g. `main:architecture.puml`,
 *    `HEAD~3:docs/c4.dsl`. We shell out to `git show <ref>:<path>`,
 *    write the bytes to memory, and feed them through the loader
 *    keyed on the path's extension. Pass through `--baseline-format`
 *    / `--current-format` to override detection.
 *  - **`-` (stdin)** — read once, feed to the loader. The format
 *    is required via the corresponding `--*-format` flag.
 *
 * The `.aact.json` format is special: we accept *both* a raw
 * `Model` object and a `CliEnvelope<ModelData>` (the output of
 * `aact model --json`), so `aact model --json > snap.json`
 * followed by `aact diff snap.json …` works without
 * post-processing. Detection is by shape: a `data.model` key
 * wins, then bare `elements` / `boundaries` keys, else error.
 *
 * `.json` autodetect policy: any file ending in `.json` is treated
 * as `model-json` by default, *except* the conventional
 * `workspace.json` (Structurizr's canonical workspace dump). If
 * you have a Structurizr workspace stored under a non-canonical
 * name (e.g. `my-arch.json`), pass `--baseline-format structurizr`
 * (or `--current-format structurizr`) to override. We don't try
 * to sniff the JSON shape here because Structurizr workspace JSON
 * and Model JSON have non-overlapping top-level keys but the cost
 * of a wrong guess (loader crash on shape mismatch) is higher
 * than asking the user to be explicit one time.
 */

const isGitRef = (arg: string): boolean =>
  arg.includes(":") && !arg.startsWith("./");

const splitGitRef = (arg: string): { ref: string; path: string } => {
  const idx = arg.indexOf(":");
  return { ref: arg.slice(0, idx), path: arg.slice(idx + 1) };
};

const readGitRefBytes = (ref: string, path: string): string => {
  try {
    return execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is universally PATH-installed; aact is itself a CLI users invoke from a shell.
      "git",
      ["show", `${ref}:${path}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new ToolError(
      "model.sourceNotFound",
      `git ref "${ref}:${path}" not found (git show failed: ${
        error instanceof Error ? error.message : String(error)
      })`,
      { ref, path },
    );
  }
};

const readStdin = (): string => readFileSync(0, "utf8");

const detectFormatFromPath = (filePath: string): string | undefined => {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  if (ext === ".puml" || ext === ".plantuml" || ext === ".iuml") {
    return "plantuml";
  }
  if (ext === ".dsl") return "structurizr";
  if (ext === ".json") {
    // Structurizr's canonical workspace dump is `workspace.json` —
    // the structurizr format's load() understands it. `.aact.json`
    // is our format-neutral Model dump. Other .json files default
    // to the latter (raw Model / CliEnvelope<ModelData> heuristic).
    if (base === "workspace.json") return "structurizr";
    return "model-json";
  }
  return undefined;
};

/**
 * Load a Model from a `.aact.json` content. Accepts both raw `Model`
 * and `CliEnvelope<ModelData>` shapes so `aact model --json` output
 * works as a diff input without re-shaping.
 */
const loadModelJsonContent = (
  content: string,
  source: string,
): { model: Model; issues: readonly ModelIssue[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ToolError(
      "model.parseError",
      `${source} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { path: source },
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ToolError(
      "model.parseError",
      `${source} JSON top-level is not an object`,
      { path: source },
    );
  }
  const obj = parsed as Record<string, unknown>;

  // Shape 1: CliEnvelope<ModelData> — `aact model --json` output.
  if (
    obj.data &&
    typeof obj.data === "object" &&
    "model" in (obj.data as Record<string, unknown>)
  ) {
    const data = obj.data as { model: unknown; issues?: unknown };
    if (!data.model || typeof data.model !== "object") {
      throw new ToolError(
        "model.parseError",
        `${source} envelope.data.model is missing or invalid`,
        { path: source },
      );
    }
    return {
      model: data.model as Model,
      issues: Array.isArray(data.issues) ? (data.issues as ModelIssue[]) : [],
    };
  }

  // Shape 2: raw Model — must carry the structural keys.
  if ("elements" in obj && "boundaries" in obj && "rootBoundaryNames" in obj) {
    return { model: obj as unknown as Model, issues: [] };
  }

  throw new ToolError(
    "model.parseError",
    `${source} does not look like a Model or CliEnvelope<ModelData> — expected keys "elements"/"boundaries"/"rootBoundaryNames" at top level, or "data.model"`,
    { path: source },
  );
};

export interface LoadBaselineInput {
  /** Raw argument string from the CLI (file path, git ref, or "-"). */
  readonly arg: string;
  /** Explicit format override — `--baseline-format` / `--current-format`. */
  readonly formatOverride?: string;
  /** Label for diagnostics. "baseline" or "current". */
  readonly sideLabel: string;
}

export interface LoadBaselineResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
  readonly side: DiffSide;
}

export const loadBaseline = async (
  input: LoadBaselineInput,
): Promise<LoadBaselineResult> => {
  const { arg, formatOverride, sideLabel } = input;

  // Resolve format hint FIRST — stdin without an explicit
  // `--<side>-format` would otherwise hang waiting for fd 0 to
  // close, only to throw the wrong error afterward. For file paths
  // we extract format hint from the extension; the actual read
  // happens once we know we have something to do.
  let formatHint: string | undefined = formatOverride;
  let sourceLabel: string;
  let pathForContent:
    | { kind: "file"; arg: string }
    | { kind: "git"; ref: string; path: string }
    | { kind: "stdin" };

  if (arg === "-") {
    pathForContent = { kind: "stdin" };
    sourceLabel = `<stdin:${sideLabel}>`;
    if (!formatHint) {
      throw new ToolError(
        "format.unknown",
        `${sideLabel} reads from stdin — pass --${sideLabel}-format <fmt> to specify (${knownFormatNames().join(", ")})`,
      );
    }
  } else if (isGitRef(arg)) {
    const { ref, path: gitPath } = splitGitRef(arg);
    pathForContent = { kind: "git", ref, path: gitPath };
    sourceLabel = arg;
    formatHint = formatHint ?? detectFormatFromPath(gitPath);
  } else {
    if (!existsSync(arg)) {
      throw new ToolError(
        "model.sourceNotFound",
        `${sideLabel} file not found: ${arg}`,
        { path: arg },
      );
    }
    pathForContent = { kind: "file", arg };
    sourceLabel = arg;
    formatHint = formatHint ?? detectFormatFromPath(arg);
  }

  if (!formatHint) {
    throw new ToolError(
      "format.unknown",
      `Could not infer format for ${sideLabel} "${arg}". Pass --${sideLabel}-format <fmt> (${knownFormatNames().join(", ")})`,
      { arg },
    );
  }

  // Only now read content — format is known, we won't block on fd 0
  // unless we actually intend to consume it.
  let rawContent: string;
  switch (pathForContent.kind) {
    case "stdin": {
      rawContent = readStdin();
      break;
    }
    case "git": {
      rawContent = readGitRefBytes(pathForContent.ref, pathForContent.path);
      break;
    }
    case "file": {
      rawContent = readFileSync(pathForContent.arg, "utf8");
      break;
    }
  }

  if (formatHint === "model-json") {
    const { model, issues } = loadModelJsonContent(rawContent, sourceLabel);
    return {
      model,
      issues,
      side: { source: sourceLabel, format: "model-json" },
    };
  }

  const format = await loadFormat(formatHint);
  if (!canLoad(format)) {
    throw new ToolError(
      "format.unsupportedFix",
      `Format "${formatHint}" does not support load`,
      { format: formatHint },
    );
  }

  // Loaders work on file paths; for git-ref / stdin content we
  // write a scratch file in os.tmpdir() and feed that. The path
  // suffix is preserved so loaders that key off extension behave
  // consistently. Always cleaned up; failure to delete is benign
  // (OS reclaims tmpdir on reboot).
  const needsScratch = arg === "-" || isGitRef(arg);
  let pathForLoad = arg;
  let scratchDir: string | undefined;
  if (needsScratch) {
    scratchDir = mkdtempSync(path.join(tmpdir(), "aact-diff-"));
    const ext =
      path.extname(
        arg === "-" ? `stdin.${formatHint}` : splitGitRef(arg).path,
      ) || `.${formatHint}`;
    pathForLoad = path.join(scratchDir, `baseline${ext}`);
    writeFileSync(pathForLoad, rawContent, "utf8");
  }

  try {
    const result = await format.load(pathForLoad);
    return {
      model: result.model,
      issues: result.issues,
      side: { source: sourceLabel, format: formatHint },
    };
  } finally {
    if (scratchDir) {
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {
        // Benign — temp dir gets reclaimed by the OS eventually.
      }
    }
  }
};
