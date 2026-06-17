import type { Diagnostic, DiagnosticKind } from "../contracts";

/**
 * Distinguishes tool-failure (config rot, missing source file, bad format)
 * from domain-failure (architecture violations). Tool-failure → exit 2;
 * domain-failure → exit 1. Agents branch on this distinction.
 */
export class ToolError extends Error {
  readonly kind: DiagnosticKind;
  readonly context?: Readonly<Record<string, string>>;

  constructor(
    kind: DiagnosticKind,
    message: string,
    context?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
    this.context = context;
  }

  toDiagnostic(): Diagnostic {
    return {
      kind: this.kind,
      message: this.message,
      severity: "warning",
      ...(this.context ? { context: this.context } : {}),
    };
  }
}
