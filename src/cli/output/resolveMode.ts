import type { AactConfig } from "../../config";
import type { OutputMode } from "./types";

export interface ResolveModeArgs {
  /** CLI flag value, undefined means unset. */
  readonly cliJson?: boolean;
  /** Loaded config, null if no config (or load failed before mode resolution). */
  readonly config?: AactConfig | null;
}

/**
 * Resolution order: CLI flag > config.output.mode > "text". CLI flag wins
 * because it's the most explicit user intent (per-invocation override).
 * Config provides project-wide default for teams who want JSON always.
 */
export const resolveOutputMode = (args: ResolveModeArgs): OutputMode => {
  if (args.cliJson === true) return "json";
  if (args.config?.output?.mode === "json") return "json";
  return "text";
};
