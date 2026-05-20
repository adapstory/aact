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
 * Resolve `<arg>` to a normalized Model + provenance label for
 * `aact diff <baseline> [<current>]`. The whole heavy-lift —
 * format detection, parsing, shape validation — lives in the
 * Format registry. This module only resolves the three CLI input
 * forms (file path, git ref, stdin) into a file-on-disk that the
 * registry's `format.load(path)` can consume:
 *
 *  - **File path** — passed straight to the loader.
 *  - **Git ref** — `<ref>:<path>` — we shell out to `git show` and
 *    write the bytes to a scratch tmp file so the loader sees a
 *    real path.
 *  - **`-` (stdin)** — read once, write to scratch, hand the path
 *    to the loader. Stdin requires an explicit `--*-format`
 *    because we have nothing else to infer from.
 *
 * Format autodetect by extension is uniform across the registry —
 * see `formats/registry.ts` and `cli/loadConfig.ts:inferSourceType`.
 * model-json's canonical extension is `*.aact.json`; non-canonical
 * `.json` files (e.g. `my-arch.json` Structurizr export) require
 * `--baseline-format <name>` explicitly.
 */

const isGitRef = (arg: string): boolean =>
  arg.includes(":") && !arg.startsWith("./");

const splitGitRef = (arg: string): { ref: string; path: string } => {
  const idx = arg.indexOf(":");
  return { ref: arg.slice(0, idx), path: arg.slice(idx + 1) };
};

const readGitRefBytes = (ref: string, path: string, cwd?: string): string => {
  try {
    return execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is universally PATH-installed; aact is itself a CLI users invoke from a shell.
      "git",
      ["show", `${ref}:${path}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...(cwd ? { cwd } : {}),
      },
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

/**
 * Pick a sensible suffix for the scratch tmp file so loaders that
 * key off extension still behave correctly: `model-json` wants
 * `.aact.json`, `plantuml` wants `.puml`, etc.
 */
const scratchExt = (arg: string, formatHint: string): string => {
  if (arg === "-") {
    return formatHint === "model-json" ? ".aact.json" : `.${formatHint}`;
  }
  return path.extname(splitGitRef(arg).path) || `.${formatHint}`;
};

/**
 * Format detection by file extension — uniform with the registry's
 * `defaultPattern` for each format. Restricted to the canonical
 * extensions to keep "auto-detect" predictable; non-canonical
 * names (`my-arch.json`, `topology.txt`) require an explicit
 * `--baseline-format` flag.
 */
const detectFormatFromPath = (filePath: string): string | undefined => {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  if (ext === ".puml" || ext === ".plantuml" || ext === ".iuml") {
    return "plantuml";
  }
  if (ext === ".dsl") return "structurizr";
  if (base === "workspace.json") return "structurizr";
  if (base.endsWith(".aact.json")) return "model-json";
  return undefined;
};

export interface LoadBaselineInput {
  /** Raw argument string from the CLI (file path, git ref, or "-"). */
  readonly arg: string;
  /** Explicit format override — `--baseline-format` / `--current-format`. */
  readonly formatOverride?: string;
  /** Label for diagnostics. "baseline" or "current". */
  readonly sideLabel: string;
  /**
   * Working directory for git-ref resolution. Falls back to the calling
   * process's cwd when omitted — that's what CLI invocations want. Tests
   * pass an explicit value so they don't have to `process.chdir()` (which
   * is forbidden inside vitest's worker_threads pool, blocking mutation
   * runs).
   */
  readonly cwd?: string;
}

export interface LoadBaselineResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
  readonly side: DiffSide;
}

export const loadBaseline = async (
  input: LoadBaselineInput,
): Promise<LoadBaselineResult> => {
  const { arg, formatOverride, sideLabel, cwd } = input;

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
      rawContent = readGitRefBytes(
        pathForContent.ref,
        pathForContent.path,
        cwd,
      );
      break;
    }
    case "file": {
      rawContent = readFileSync(pathForContent.arg, "utf8");
      break;
    }
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
    pathForLoad = path.join(
      scratchDir,
      `baseline${scratchExt(arg, formatHint)}`,
    );
    writeFileSync(pathForLoad, rawContent, "utf8");
  }

  try {
    const result = await format.load(pathForLoad);
    return {
      model: result.model,
      issues: result.issues,
      side: { source: sourceLabel, format: formatHint },
    };
  } catch (error) {
    // Format loader threw — surface as model.parseError so the
    // envelope downstream sees a consistent `kind`.
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      "model.parseError",
      `${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`,
      { path: sourceLabel },
    );
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
