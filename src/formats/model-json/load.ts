import { readFile } from "node:fs/promises";

import type { Boundary, Element, Model, ModelIssue } from "../../model";
import { buildModel, validateModel } from "../../model";
import type { LoadResult } from "../types";

/**
 * `model-json` loader. Reads a JSON file and normalises three input
 * shapes into a single `LoadResult`:
 *
 *  1. **Canonical** — `{ schemaVersion: 1, model: Model }`. The
 *     shape `aact generate --format model-json` emits. The version
 *     header future-proofs us: if the Model shape evolves
 *     post-GA, future loaders can branch on `schemaVersion` instead
 *     of inferring intent from missing fields.
 *
 *  2. **`CliEnvelope<ModelData>`** — `{ schemaVersion, command,
 *     data: { model, issues } }`. The shape `aact model --json`
 *     emits. Lets users redirect that command's output as a
 *     diff baseline / `aact check` source without re-shaping:
 *     `aact model --json > snap.aact.json && aact check`.
 *
 *  3. **Raw `Model`** — `{ elements, boundaries, rootBoundaryNames,
 *     workspace? }`. Hand-authored compatibility shape. The most
 *     fragile (no version header, easy to drift) but easy to write.
 *
 * Detection is by structural keys (no JSON-Schema dependency): try
 * canonical first (`schemaVersion` + `model`), then envelope
 * (`data.model`), then raw (`elements` + `boundaries`). First
 * matching shape wins.
 */

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

interface RawModelInput {
  elements: unknown;
  boundaries: unknown;
  rootBoundaryNames: unknown;
  workspace?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hasRawModelKeys = (v: Record<string, unknown>): boolean =>
  "elements" in v && "boundaries" in v && "rootBoundaryNames" in v;

const extractRawModel = (parsed: unknown, source: string): RawModelInput => {
  if (!isObject(parsed)) {
    throw new SyntaxError(
      `${source}: top-level JSON must be an object, got ${typeof parsed}`,
    );
  }

  // Shape 1 — canonical { schemaVersion, model }
  if ("schemaVersion" in parsed && "model" in parsed && !("data" in parsed)) {
    const version = parsed.schemaVersion;
    if (
      typeof version !== "number" ||
      !SUPPORTED_SCHEMA_VERSIONS.has(version)
    ) {
      throw new SyntaxError(
        `${source}: unsupported schemaVersion ${String(version)} ` +
          `(supported: ${[...SUPPORTED_SCHEMA_VERSIONS].join(", ")})`,
      );
    }
    if (!isObject(parsed.model) || !hasRawModelKeys(parsed.model)) {
      throw new SyntaxError(
        `${source}: canonical model-json requires "model" with ` +
          `"elements" / "boundaries" / "rootBoundaryNames"`,
      );
    }
    return parsed.model as unknown as RawModelInput;
  }

  // Shape 2 — CliEnvelope<ModelData> from `aact model --json`
  if (
    "data" in parsed &&
    isObject(parsed.data) &&
    "model" in parsed.data &&
    isObject(parsed.data.model)
  ) {
    const inner = parsed.data.model;
    if (!hasRawModelKeys(inner)) {
      throw new SyntaxError(
        `${source}: envelope.data.model is missing structural keys`,
      );
    }
    return inner as unknown as RawModelInput;
  }

  // Shape 3 — raw Model (hand-authored compat)
  if (hasRawModelKeys(parsed)) {
    return parsed as unknown as RawModelInput;
  }

  throw new SyntaxError(
    `${source}: not a recognised model-json shape. Expected one of:\n` +
      `  - { schemaVersion, model }  (canonical, from aact generate)\n` +
      `  - CliEnvelope<ModelData>    (from aact model --json)\n` +
      `  - raw Model                 ({elements, boundaries, rootBoundaryNames})`,
  );
};

export const load = async (path: string): Promise<LoadResult> => {
  const content = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new SyntaxError(
      `${path}: invalid JSON — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const raw = extractRawModel(parsed, path);

  // Model in JSON form has `elements` / `boundaries` as objects keyed
  // by name (matches the `Readonly<Record<string, …>>` runtime shape).
  // `buildModel` expects arrays — flatten before calling. Sorting by
  // name happens inside buildModel itself, so we don't need to.
  const elementsArr: readonly Element[] = isObject(raw.elements)
    ? (Object.values(raw.elements) as Element[])
    : [];
  const boundariesArr: readonly Boundary[] = isObject(raw.boundaries)
    ? (Object.values(raw.boundaries) as Boundary[])
    : [];
  const rootNames: readonly string[] = Array.isArray(raw.rootBoundaryNames)
    ? (raw.rootBoundaryNames as readonly string[])
    : [];

  const built = buildModel({
    elements: elementsArr,
    boundaries: boundariesArr,
    rootBoundaryNames: rootNames,
    ...(raw.workspace ? { workspace: raw.workspace } : {}),
  });
  const validationIssues: readonly ModelIssue[] = validateModel(built.model);
  const allIssues: readonly ModelIssue[] = [
    ...built.issues,
    ...validationIssues,
  ];

  const result: { model: Model; issues: readonly ModelIssue[] } = {
    model: built.model,
    issues: allIssues,
  };
  return result;
};
