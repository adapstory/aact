# Diff

`computeDiff(baseline, current, options?)` — pure-function structural
diff between two `Model` snapshots. Used by `aact diff` for PR
review and exposed in the public API for library consumers who want
to drive their own change reports (commit hooks, dashboards,
agent loops).

The output is **domain-grouped**: a Terraform-style change log
listing every entity that moved (added / removed / modified /
renamed / moved) plus the specific fields that changed. An
opt-in RFC 6902 `patch[]` rides along when consumers need raw JSON
ops.

## What it produces

```ts
function computeDiff(
  baseline: Model,
  current: Model,
  options?: DiffOptions,
): DiffData;

interface DiffData {
  readonly summary: DiffSummary;
  readonly changes: readonly Change[];
  readonly patch?: readonly JsonPatchOp[];
  readonly baseline: DiffSide;
  readonly current: DiffSide;
}
```

```ts
type Change = ElementChange | BoundaryChange | RelationChange | WorkspaceChange;
type ChangeAction = "added" | "removed" | "modified" | "renamed" | "moved";
type ChangeSeverity = "structural" | "semantic" | "cosmetic";
```

Each `Change` carries:

- **`address`** — stable cross-reference ID (`element:api`,
  `relation:web→api`, `boundary:platform`). Mirrors Terraform's
  `address` convention; lets logs and PR comments link to a
  specific change without ambiguity.
- **`severity`** — `structural` / `semantic` / `cosmetic`.
  Drives default rendering and CI gate behaviour.
- **`fields`** — `FieldChange[]` with `before` / `after` / set
  delta for array fields (`added` + `removed` lists computed
  once so consumers don't re-derive).
- **`confidence`** (on rename actions only) — similarity score
  from the rename detector. Agents gate on it to filter
  low-confidence guesses.

## Severity taxonomy

| Severity     | Examples                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `structural` | Added / removed elements, boundaries, relations. Moves between boundaries. Kind transitions (`Container` → `ContainerDb`). |
| `semantic`   | Technology / external / tags / order / properties changes. Same-`(from,to)` technology swap on a relation.                 |
| `cosmetic`   | Label, description, sprite, link, workspace metadata.                                                                      |

The heuristic is **not configurable** — kept neutral on purpose so
"this change is structural" means the same thing on every aact
install. Consumers that want a different cut filter on
`change.severity` themselves.

## How the diff is computed

```mermaid
flowchart TD
  Inputs[baseline + current<br/>Models] --> Index["index elements,<br/>boundaries, relations<br/>by name / triple key"]
  Index --> Match["match by name<br/>(same name → modified)"]
  Match --> Unmatched["unmatched:<br/>added on one side,<br/>removed on the other"]
  Unmatched --> Rename["renameDetector<br/>(within same kind)"]
  Rename --> Threshold{"similarity<br/>≥ renameThreshold<br/>(default 0.7)?"}
  Threshold -- "yes" --> Renamed["pair as 'renamed'<br/>with confidence"]
  Threshold -- "no" --> Keep["keep as add+remove"]
  Renamed --> Collapse["pair-collapse pass:<br/>same (from,to) removed+added<br/>relation → 'modified' (tech swap)"]
  Keep --> Collapse
  Collapse --> Field["per-entity field diff<br/>label / desc / tech / tags / props / boundary"]
  Field --> Sort["sort:<br/>severity desc → action precedence →<br/>address asc"]
  Sort --> Patch["optional RFC 6902 patch[]<br/>(withPatch: true)"]
  Patch --> Output["DiffData"]
```

Three notable design choices:

1. **Rename detection by similarity, within same kind only.** A
   `Container` won't rename into a `Person` — kinds are anchors.
   Score combines name (Levenshtein-normalised), label, technology,
   tags, and outgoing-relation overlap. Default threshold `0.7`;
   `disableRenameDetection: true` skips the heuristic entirely and
   surfaces pure add/remove pairs.

2. **Multiset relation matching.** Relations match on the triple
   `(from, to, technology)` — supports modeling the same pair with
   different transports (`web → api [HTTP]` AND `web → api [gRPC]`
   coexist). A subsequent **pair-collapse pass** rewrites a
   removed+added pair with the same `(from, to)` but different
   `technology` into a single `modified` change carrying
   `field: "technology"` — much easier to read on PR review than
   two paired entries.

3. **Deterministic sort.** Changes come back in a stable order:
   severity desc → action precedence (`removed > added > modified >
renamed > moved`) → address asc. Top-N truncation in agent /
   CI consumers never misses a structural change.

## Summary shape

`DiffSummary.headline` is the first thing agents read — a one-liner
seed for reasoning:

```
+2 elements, -1 relation, 1 technology change [structural]
```

Plus three breakdown maps (`bySeverity`, `byAction`, `byEntity`) for
quick gates without iterating `changes[]`.

## Options

```ts
interface DiffOptions {
  readonly renameThreshold?: number;
  readonly disableRenameDetection?: boolean;
  readonly withPatch?: boolean;
}
```

| Option                   | Default | Notes                                                                                                       |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| `renameThreshold`        | `0.7`   | Similarity 0..1 below which the differ won't pair an add+remove as `renamed`. Stricter = more pairs split.  |
| `disableRenameDetection` | `false` | Skip the heuristic. Output has only `added` / `removed` for what would otherwise have been renames.         |
| `withPatch`              | `false` | Include RFC 6902 `patch[]` against the normalised Model JSON. Opt-in to keep envelope size lean for agents. |

## CLI integration

`aact diff <baseline> [<current>]` accepts:

- **File path** — `arch.puml` / `workspace.dsl`
- **Git ref + path** — `main:architecture.puml`, `HEAD~3:workspace.dsl`
- **Stdin** — `<stdin>` or `-`, content piped in

Both inputs go through the standard format registry, so any format
with `load` capability is a valid diff side — including
cross-format diffs (`aact diff arch.puml workspace.dsl` works if both
parse to the same logical Model).

## Stability guarantees

- **Adding new `Change` entity types** is breaking — consumers
  switching on `entity` may have an exhaustive switch. Bumps
  `schemaVersion`.
- **Adding new `ChangeAction` / `ChangeSeverity` literals** is
  breaking for the same reason.
- **Adding new `FieldKind` literals** is non-breaking — consumers
  filtering on `field` are expected to ignore unknown ones (the
  field set evolves with the Model).
- **Adding new optional fields** to `Change` / `DiffData` /
  `DiffSummary` is non-breaking.
- **Changing the rename-detection scoring algorithm** is allowed
  within `confidence` semantics — consumers must gate on
  `confidence`, not on the absence of a rename.
- **Sorting order** of `changes[]` is part of the contract. Top-N
  truncation depends on it.

The diff API is exposed in [`src/index.ts`](../index.ts) so
library consumers (commit hooks, PR bots, dashboards) can call
`computeDiff` directly without spawning the CLI.
