/**
 * Minimal types matching the aact Model JSON shape — only the
 * fields the UI actually reads. We could import the full `Model`
 * type from `aact`, but the SPA build is browser-only and we want
 * to keep `aact` out of the client bundle. Re-declaring the slice
 * we touch keeps the boundary explicit.
 */

export type ElementKind =
  | "Person"
  | "System"
  | "SystemDb"
  | "SystemQueue"
  | "Container"
  | "ContainerDb"
  | "ContainerQueue"
  | "Component"
  | "ComponentDb"
  | "ComponentQueue";

export type BoundaryKind = "System" | "Container" | "Component" | "Enterprise";

export interface SourceLocation {
  readonly file: string;
  readonly start: { readonly line: number; readonly col: number };
  readonly end: { readonly line: number; readonly col: number };
}

export interface Relation {
  readonly to: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags: readonly string[];
  readonly link?: string;
  readonly sourceLocation?: SourceLocation;
}

export interface Element {
  readonly name: string;
  readonly label: string;
  readonly kind: ElementKind;
  readonly external: boolean;
  readonly description?: string;
  readonly technology?: string;
  readonly tags: readonly string[];
  readonly link?: string;
  readonly relations: readonly Relation[];
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

export interface Boundary {
  readonly name: string;
  readonly label: string;
  readonly kind: BoundaryKind;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly elementNames: readonly string[];
  readonly boundaryNames: readonly string[];
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

export interface Model {
  readonly elements: Readonly<Record<string, Element>>;
  readonly boundaries: Readonly<Record<string, Boundary>>;
  readonly rootBoundaryNames: readonly string[];
  readonly workspace?: {
    readonly name?: string;
    readonly description?: string;
  };
}

export interface ModelIssue {
  readonly kind: string;
  readonly message?: string;
  readonly element?: string;
  readonly boundary?: string;
}

export interface ModelEnvelope {
  readonly schemaVersion: 1;
  readonly command: "view";
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly data: {
    readonly model: Model;
    readonly issues: readonly ModelIssue[];
  };
  readonly meta: {
    readonly aactVersion: string;
    readonly durationMs: number;
    readonly configPath: string | null;
    readonly source: string | null;
  };
}

/**
 * One step on the drill-down stack. `landscape` is the implicit
 * root that's always at the bottom; entries above it identify a
 * boundary the user descended into. Element focus is rendered as
 * a side-panel selection on the current stack level, not as a
 * dedicated stack entry — the graph still shows the same level,
 * the right pane just zeroes in on the picked node.
 */
export type BreadcrumbEntry =
  | { readonly kind: "landscape" }
  | {
      readonly kind: "boundary";
      readonly name: string;
      readonly label: string;
    };
