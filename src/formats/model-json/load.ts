import { readFile } from "node:fs/promises";

import type { Boundary, Element, ModelIssue } from "../../model";
import { buildModel } from "../../model";
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
 *     Envelope's `data.issues` is preserved verbatim as `preIssues`
 *     so loader-specific diagnostics from the original PUML/DSL
 *     parse survive the JSON snapshot round-trip.
 *
 *  3. **Raw `Model`** — `{ elements, boundaries, rootBoundaryNames,
 *     workspace? }`. Hand-authored compatibility shape. The most
 *     fragile (no version header, easy to drift) but easy to write.
 *
 * Detection is by structural keys (no JSON-Schema dependency): try
 * canonical first (`schemaVersion` + `model`), then envelope
 * (`data.model`), then raw (`elements` + `boundaries`). First
 * matching shape wins.
 *
 * **Validation pipeline.** `buildModel` already runs `validateModel`
 * internally (`src/model/build.ts:76`) — calling it again here would
 * double-emit dangling-relation / boundary-cycle issues. So we hand
 * `data.issues` (envelope only) through `preIssues` and let
 * `buildModel` do its thing; the result is exactly the same issue
 * set you would have gotten if the original PUML/DSL load had
 * happened in this process.
 */

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

interface RawModelInput {
  elements: unknown;
  boundaries: unknown;
  rootBoundaryNames: unknown;
  workspace?: unknown;
}

interface ExtractedShape {
  readonly raw: RawModelInput;
  /** Loader-side issues carried over from the source format. Only
   *  envelope shapes set this — canonical & raw have nowhere to
   *  put pre-issues. */
  readonly preIssues: readonly ModelIssue[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hasRawModelKeys = (v: Record<string, unknown>): boolean =>
  "elements" in v && "boundaries" in v && "rootBoundaryNames" in v;

const extractShape = (parsed: unknown, source: string): ExtractedShape => {
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
    return {
      raw: parsed.model as unknown as RawModelInput,
      preIssues: [],
    };
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
    const rawIssues = (parsed.data).issues;
    const preIssues: readonly ModelIssue[] = Array.isArray(rawIssues)
      ? (rawIssues as ModelIssue[])
      : [];
    return {
      raw: inner as unknown as RawModelInput,
      preIssues,
    };
  }

  // Shape 3 — raw Model (hand-authored compat)
  if (hasRawModelKeys(parsed)) {
    return {
      raw: parsed as unknown as RawModelInput,
      preIssues: [],
    };
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

  const { raw, preIssues } = extractShape(parsed, path);

  // Model in JSON form has `elements` / `boundaries` as objects keyed
  // by name (matches the `Readonly<Record<string, …>>` runtime shape).
  // `buildModel` expects arrays — flatten before calling. Sorting by
  // name happens inside buildModel itself.
  const elementsArr: readonly Element[] = isObject(raw.elements)
    ? (Object.values(raw.elements) as Element[])
    : [];
  const boundariesArr: readonly Boundary[] = isObject(raw.boundaries)
    ? (Object.values(raw.boundaries) as Boundary[])
    : [];
  const rootNames: readonly string[] = Array.isArray(raw.rootBoundaryNames)
    ? (raw.rootBoundaryNames as readonly string[])
    : [];

  // buildModel runs validateModel internally — calling it again would
  // duplicate dangling-relation / boundary-cycle issues. preIssues
  // carries the envelope's data.issues through unchanged.
  return buildModel({
    elements: elementsArr,
    boundaries: boundariesArr,
    rootBoundaryNames: rootNames,
    ...(raw.workspace ? { workspace: raw.workspace } : {}),
    preIssues,
  });
};
