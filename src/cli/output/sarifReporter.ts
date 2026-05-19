import type { CliEnvelope, CommandResult, Reporter } from "./types";

/**
 * SARIF v2.1.0 — Static Analysis Results Interchange Format, an
 * OASIS standard JSON shape that every static-analysis consumer
 * (GitHub Advanced Security / Code Scanning, SonarQube, VSCode
 * SARIF viewer, Snyk Code, Semgrep, …) understands without a custom
 * adapter. Emitting SARIF lets aact's `check` output drop straight
 * into `github/codeql-action/upload-sarif@v3` and surface as PR
 * code-scanning alerts.
 *
 * Only the subset aact populates is typed here — the full schema
 * (https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.6.json)
 * has dozens of optional fields irrelevant for our use case. Future
 * fields land additively; consumers ignore unknown keys.
 */
export interface SarifLog {
  readonly $schema?: string;
  readonly version: "2.1.0";
  readonly runs: readonly SarifRun[];
}

export interface SarifRun {
  readonly tool: SarifTool;
  readonly results: readonly SarifResult[];
  /** Original source URI base — lets consumers resolve relative paths
   *  against a known root (CI workspace, repo root). Optional. */
  readonly originalUriBaseIds?: Readonly<Record<string, SarifArtifactLocation>>;
}

export interface SarifTool {
  readonly driver: SarifToolDriver;
}

export interface SarifToolDriver {
  readonly name: string;
  readonly version?: string;
  readonly informationUri?: string;
  readonly rules?: readonly SarifReportingDescriptor[];
}

export interface SarifReportingDescriptor {
  readonly id: string;
  readonly name?: string;
  readonly shortDescription?: SarifMessage;
  readonly fullDescription?: SarifMessage;
  readonly helpUri?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SarifResult {
  readonly ruleId: string;
  /** Index into `tool.driver.rules[]` — lets consumers look up rule
   *  metadata in O(1) instead of scanning by id. Optional. */
  readonly ruleIndex?: number;
  readonly level: SarifLevel;
  readonly message: SarifMessage;
  readonly locations: readonly SarifLocation[];
  /** Stable hashes for idempotent alert correlation. GitHub uses
   *  `partialFingerprints` to dedupe alerts across runs — same
   *  fingerprint + same alert = same code-scanning alert, kept
   *  through fixes and re-emerges. */
  readonly partialFingerprints?: Readonly<Record<string, string>>;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export type SarifLevel = "none" | "note" | "warning" | "error";

export interface SarifMessage {
  readonly text: string;
}

export interface SarifLocation {
  readonly physicalLocation: SarifPhysicalLocation;
}

export interface SarifPhysicalLocation {
  readonly artifactLocation: SarifArtifactLocation;
  readonly region?: SarifRegion;
}

export interface SarifArtifactLocation {
  readonly uri: string;
  /** Reference into `run.originalUriBaseIds` — e.g. `"%SRCROOT%"`. */
  readonly uriBaseId?: string;
}

export interface SarifRegion {
  readonly startLine: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

/**
 * Per-command SARIF adapter. Mirrors `Renderer<TData>` for
 * `HumanReporter`: each command supplies one to translate its
 * envelope.data into SARIF, the reporter handles serialisation +
 * stdout. Commands that don't supply an adapter still produce a
 * valid (but empty) SARIF log — keeping `aact <anything> --sarif`
 * a safe operation rather than a runtime crash.
 */
export type SarifAdapter<TData> = (envelope: CliEnvelope<TData>) => SarifLog;

const SARIF_SCHEMA_URI =
  "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.6.json";

const emptySarifLog = (toolName = "aact", version?: string): SarifLog => ({
  $schema: SARIF_SCHEMA_URI,
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: toolName,
          ...(version ? { version } : {}),
          informationUri: "https://github.com/Byndyusoft/aact",
        },
      },
      results: [],
    },
  ],
});

/**
 * Streams a SARIF v2.1.0 log on stdout. The adapter (if any)
 * decides how to map the command's envelope into the SARIF shape;
 * without one, the reporter emits an empty-but-valid log so the
 * "wrong command + --sarif" path doesn't surprise CI.
 */
export class SarifReporter<TData = unknown> implements Reporter<TData> {
  constructor(private readonly adapter?: SarifAdapter<TData>) {}

  emit(result: CommandResult<TData>): void {
    const log = this.adapter
      ? this.adapter(result.envelope)
      : emptySarifLog("aact", result.envelope.meta.aactVersion);
    process.stdout.write(JSON.stringify(log, undefined, 2) + "\n");
  }
}
