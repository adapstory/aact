import type { Diagnostic, ExitCode } from "./types";

/**
 * What a command returns before the CLI wrapper assembles the shared envelope.
 * Keeping this contract outside `run` lets command data shapes stay independent
 * from wrapper/reporter wiring.
 */
export interface ExecuteResult<TData> {
  readonly data: TData;
  readonly exitCode: ExitCode;
  readonly diagnostics?: readonly Diagnostic[];
  /** Text-mode hint when the command itself wrote to stdout. */
  readonly stdoutClaimed?: boolean;
}
