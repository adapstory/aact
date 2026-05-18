import { colors } from "consola/utils";

import type {
  CliEnvelope,
  CommandResult,
  Diagnostic,
  Renderer,
  Reporter,
} from "./types";

/**
 * Text-mode reporter. Routes the envelope through the command-supplied
 * `Renderer` for human-friendly output. When the command has claimed stdout
 * for an artefact (`stdoutClaimed`), envelope rendering moves to stderr so
 * the artefact stream stays pipe-safe.
 */
export class HumanReporter<TData = unknown> implements Reporter<TData> {
  constructor(private readonly renderer: Renderer<TData>) {}

  emit(result: CommandResult<TData>): void {
    const sink: NodeJS.WritableStream = result.stdoutClaimed
      ? process.stderr
      : process.stdout;

    // Tool-level failures (exit 2) carry a null data payload that the
    // command-specific renderer wouldn't know how to handle. Use the
    // shared error renderer instead.
    if (result.envelope.exitCode === 2) {
      renderErrorEnvelope(result.envelope, sink);
    } else {
      this.renderer(result.envelope, sink);
    }

    if (result.envelope.diagnostics.length > 0) {
      renderDiagnostics(result.envelope.diagnostics, process.stderr);
    }
  }
}

const severityIcon = (severity: Diagnostic["severity"]): string =>
  severity === "warning" ? colors.yellow("⚠") : colors.cyan("ℹ");

const renderDiagnostics = (
  diagnostics: readonly Diagnostic[],
  sink: NodeJS.WritableStream,
): void => {
  for (const d of diagnostics) {
    sink.write(
      `${severityIcon(d.severity)} ${colors.dim(d.kind)}  ${d.message}\n`,
    );
  }
};

/**
 * Shared formatter for error envelopes. Used both by the wrapper's catch
 * branch (when execute throws) and as a default for commands that produce
 * exitCode !== 0 without a custom renderer.
 */
export const renderErrorEnvelope: Renderer<unknown> = (envelope, sink) => {
  const [primary] = envelope.diagnostics;
  if (primary) {
    sink.write(
      `${colors.red("✗")} ${colors.bold(envelope.command)}: ${primary.message}\n`,
    );
  } else {
    sink.write(`${colors.red("✗")} ${colors.bold(envelope.command)} failed\n`);
  }
};

export const isErrorEnvelope = (envelope: CliEnvelope): boolean =>
  envelope.exitCode === 2;
