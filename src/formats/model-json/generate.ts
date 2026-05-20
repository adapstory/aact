import type { Model } from "../../model";
import type { FormatOutput } from "../types";

/**
 * `model-json` generator. Emits the canonical format-level shape
 * `{ schemaVersion: 1, model: Model }` — distinct from
 * `aact model --json` which wraps the same Model in `CliEnvelope`
 * with CLI-level meta (durationMs, command, configPath).
 *
 * The Format-API `generate(model)` is a pure function: no access to
 * runtime context, no envelope semantics. So this output is the
 * lean, format-neutral snapshot — suitable for git-committing as
 * a baseline, sharing between tools, or replaying through
 * `aact diff`. Symmetric to `JSON.parse(generate(model)) → load(...)`
 * — the canonical round-trip.
 *
 * `sourceLocation` is preserved on emit when present on the input
 * Model. Consumers that need a "logical only" dump can strip it
 * themselves; we never invent or fabricate the field. When the
 * source was originally PUML/DSL, sourceLocation points at lines
 * in that source — accurate as long as the user keeps the source
 * file around at the same path.
 *
 * **Determinism.** Element / Boundary records are written with keys
 * sorted alphabetically so two generates from the same Model
 * produce byte-identical output. Without this, the `Object.values`
 * insertion order leaks parser quirks into the diff, and
 * `aact diff base.aact.json base.aact.json` would show phantom
 * moves whenever the parser reordered loaders internally.
 */

const sortRecord = <T>(
  record: Readonly<Record<string, T>>,
): Record<string, T> => {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted((a, b) =>
    a.localeCompare(b),
  )) {
    sorted[key] = record[key];
  }
  return sorted;
};

const normaliseModel = (model: Model): Model => ({
  elements: sortRecord(model.elements),
  boundaries: sortRecord(model.boundaries),
  rootBoundaryNames: model.rootBoundaryNames,
  ...(model.workspace ? { workspace: model.workspace } : {}),
});

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_PATH = "architecture.aact.json";

export const generate = (model: Model): FormatOutput => {
  const payload = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    model: normaliseModel(model),
  };
  return {
    files: [
      {
        path: DEFAULT_OUTPUT_PATH,
        content: JSON.stringify(payload, undefined, 2) + "\n",
      },
    ],
  };
};
