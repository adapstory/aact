# Structurizr DSL — target grammar for the aact chevrotain parser

This document defines the grammar fragments our parser will accept. Each
in-scope construct is quoted verbatim from the **reference parser
implementation** (`.parser-refs/java/structurizr-dsl/`) so the contract
is anchored to authoritative behaviour rather than memory or
documentation drift.

The reference parser is line-based with a context stack; ours is a
block-grammar chevrotain parser. The **accepted surface is identical**
— the same sources produce the same Model — but the recognition
strategy differs. This document defines the surface, not the strategy.

References used while authoring:

- `StructurizrDslParser.java` (top-level dispatch)
- `*Parser.java` (per-construct grammar via `GRAMMAR` constants)
- `StructurizrDslTokens.java` (lexical tokens)
- `src/test/resources/dsl/big-bank-plc/internet-banking-system.dsl`
  (real-world fixture confirming usage)

## Scope policy

Six categories — three primary (in-scope / opaque / parsed-then-info-issue)
plus three boundary cases (hard parse error / tokenize-ignore / in-scope
minimal). See `docs/v3-parser-phase-0-inventory.md` for the reasoning
behind the primary three.

| Category                                         | Goes to                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Examples                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In scope**                                     | `Model` via the AST → toModel mapping                                                                                                                                                                                                                                                                                                                                                                                                                                            | workspace, model, elements, relationships, properties, perspectives, !include, !const, !identifiers                                                                                                                                                                        |
| **Opaque**                                       | `LoadResult.raw` verbatim (round-trip without interpretation)                                                                                                                                                                                                                                                                                                                                                                                                                    | views, styles, configuration, themes, branding, terminology, !docs, !adrs, !plugin, !script                                                                                                                                                                                |
| **Parsed-then-info-issue**                       | parsed only for syntactic correctness (so a legal DSL file does not crash); emits `ModelIssue` severity=info; never reaches Model or raw                                                                                                                                                                                                                                                                                                                                         | deploymentEnvironment, deploymentNode, infrastructureNode, softwareSystemInstance, containerInstance, deploymentGroup, instanceOf, healthCheck                                                                                                                             |
| **Hard parse error**                             | reference parser throws `RuntimeException`; aact must match to stay aligned                                                                                                                                                                                                                                                                                                                                                                                                      | `!ref`, `!extend`, `!constant`, `enterprise { ... }` — all four were deprecated and **then removed**; the reference now errors on them with a message pointing to the replacement. Silent-skip would diverge from the reference (we'd accept files the reference rejects). |
| **Tokenize-ignore at lex**                       | lexer recognises the token, parser skips the block as untyped opaque content (no info-issue, no warning)                                                                                                                                                                                                                                                                                                                                                                         | `!components` (component finder + family — note the actual token is `!components`, not `componentFinder`), `findElement(s)`, `findRelationship(s)`, `customElement` (`element` keyword in model).                                                                          |
| **In-scope but minimal — alias extraction only** | `archetypes { ... }` — load-bearing because once an archetype is declared, its name becomes an alias for the base keyword (e.g. `archetypes { db = container { ... } }` then `db myDb "..."` uses `db` as an alias for `container`). The parser must extract the keyword→base-type mapping; the archetype body's defaults (description, technology, tags) MAY be applied during toModel or dropped — TBD. NOT tokenize-ignore (silent-skip breaks all DSLs that use archetypes). |

The chevrotain grammar is the **union** of categories 1–3. Category 4 is
handled at lex time.

## Implementation status (parser cutover readiness)

After two rounds of agent-driven comparison against the reference
Java parser (`StructurizrDslParser.java` + JUnit assertions in
`*ParserTests.java`), the following list captures what's in place and
what's deferred. **Every BLOCKING item is closed**; the remaining
NOTABLE items don't prevent the parser from accepting realistic
fixtures (Big Bank, getting-started, multi-line, etc.).

### Closed

- workspace / model / element / relationship base grammar
- element body statements (description / technology / tags / tag / url
  / properties / perspectives)
- directives (`!include`, `!const`, `!var`, `!identifiers`,
  `!impliedRelationships`) at top, workspace, and model scope
- workspace-scope `properties { ... }`
- bare paths in `!include` and `extends` (e.g. `path/to/parent.dsl`)
- triple-quoted text blocks (`"""..."""`) as `!const` / `!var` values
- multi-line `\` continuations (pre-lex pass)
- opaque block stripping (views / styles / configuration / branding /
  terminology / themes) with source range surfaced via
  `ChevrotainParseResult.opaqueBlocks`
- deployment-family blocks (deploymentEnvironment, deploymentNode,
  deploymentGroup, infrastructureNode, softwareSystemInstance,
  containerInstance, instanceOf, healthCheck) → `infoBlocks`
- hard-removed constructs (`!ref`, `!extend`, `!constant`,
  `enterprise`) become `parseErrors` with replacement-hint messages,
  with whole-block strip when `{ ... }` follows
- auxiliary directives (`!docs`, `!decisions`, `!adrs` — inline;
  `!script`, `!plugin`, `!components` — block)
- explicit `[id =] source -> destination [desc] [tech] [tags]`
- implicit-source `-> destination ...` form inside element body
- `this` as source AND destination, resolved to enclosing element
- `-/>` no-relationship form (parsed, no Model edge)
- hierarchical refs `bank.api -> bank.db` (Identifier accepts `.`)
- bare slash in property values (`structurizr.groupSeparator /`)
- case-insensitive identifier resolution
- element-kind keyword used as identifier (`softwareSystem = softwareSystem "X"`)
- reopen form `existing { body }` merges into prior Container/Boundary
- group children → `Container.properties["group"]`
- boundary-form body aggregation (promoted softwareSystem carries
  description/tags/url/properties)
- default tags per element kind (`Element` + `Person`/`Software System`/etc.)
- default `Relationship` tag on every relation
- `!impliedRelationships true` ancestor-edge propagation
- multi-string `tags "a" "b" "c"` form
- perspective without explicit value records `""`
- CustomElement (`element <name>` keyword) → Container with `["Element"]` tag

### Closed (NOTABLE — landed since the original inventory)

- **`${...}` substitution** — pre-lex pass collects `!const`/`!var`
  declarations and rewrites every `${NAME}` occurrence to a fixed
  point (16 iterations).
- **Nested-group `structurizr.groupSeparator` join** — toModel reads
  the model property and joins nested group names.
- **Group as element-body property statement** — `component "X" {
group "Layer" }` sets `Component.properties.group = "Layer"`.
- **Reopen with new nested elements** — `bank { newCont = container
"X" }` adds the new element under the target Boundary.
- **Identifier re-registration error** — emits a
  `duplicate-identifier` ModelIssue (case-insensitive).
- **Workspace name/description/extends** — surfaced in
  `Model.workspace` as `{ name?, description?, extendsTarget? }`.
- **Archetypes block** — declaration is stripped opaque so
  archetype-bearing fixtures parse cleanly.
- **Selectors `!element`/`!elements`/`!relationship`/
  `!relationships`** — declaration blocks are stripped opaque so
  selector-bearing fixtures parse cleanly.

### Remaining gaps (deliberate)

- **Archetype usage form** (`<alias> <id> "name"` in element
  declaration position) — this is the inverse of the regular
  `<id> = <kind> "name"` and requires grammar surgery. Today
  alias usages in model bodies don't parse. The reference
  `ArchetypesParser` builds an alias→base mapping that the
  line-by-line parser uses to dispatch — bringing that to a
  block-grammar chevrotain parser is a bigger refactor than the
  current beta needs.
- **Selector body propagation** — `!element <ref> { tag "x" }` should
  attach the body to the selected element. The block is stripped
  today (selector parsing without applying body), so users get a
  clean parse but the linter doesn't see those tags. Reference:
  `FindElement(s)Parser`, `ElementsParser` body statements.
- **Empty `""` vs `undefined`** — reference returns `""` for missing
  description/technology/relation.description. Our Model carries
  `undefined`. Deliberate divergence: TS idioms favour `undefined`
  for absent values and rules already handle both via truthy checks;
  changing the Model contract is more disruptive than the fidelity
  gain warrants.

## 1. In-scope productions

### Lexical primitives

| Construct           | Form                          | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UTF-8 BOM           | leading `﻿`                   | The reference (`StructurizrDslParser.java:249, 302`) strips BOM at the start of any line, in both main source and included files; in practice this fires only on the first line of each file.                                                                                                                                                          |
| String literal      | `"..."` (double-quoted)       | Standard escape sequences. Property/perspective values may also appear unquoted as bare tokens.                                                                                                                                                                                                                                                        |
| Text block          | `"""\n...\n"""`               | Reference: `TEXT_BLOCK_MARKER = "\"\"\""`                                                                                                                                                                                                                                                                                                              |
| String substitution | `${name}`                     | `STRING_SUBSTITUTION_PATTERN = (\$\{[a-zA-Z0-9-_.]+?\})`. Expanded _before_ lexing — handled by a pre-lex pass.                                                                                                                                                                                                                                        |
| Line continuation   | trailing `\`                  | `MULTI_LINE_SEPARATOR`. Two physical lines join into one logical line.                                                                                                                                                                                                                                                                                 |
| Identifier          | `\w[a-zA-Z0-9_-]*` (anchored) | Reference: `IdentifiersRegister.IDENTIFIER_PATTERN`. Allows hyphen `-` after the first char; **forbids** the period `.` inside an identifier. Hierarchical references compose identifiers with `.` as a separator at lookup time, but a single declared identifier never contains `.`. Leading `-` is explicitly rejected by `validateIdentifierName`. |
| `this` keyword      | `THIS_TOKEN = "this"`         | Inside an element body, refers to the enclosing element — used as a relationship endpoint (`this -> other "uses"`).                                                                                                                                                                                                                                    |
| Single-line comment | `// ...`, `# ...`             | `COMMENT_PATTERN = ^\s*?(//\|#).*$`.                                                                                                                                                                                                                                                                                                                   |
| Block comment       | `/* ... */`                   | **Line-scoped in the reference**: `/*` must start a line, `*/` must end a line; not inline within a line of tokens. Reference: `MULTI_LINE_COMMENT_START_TOKEN = "/*"` / `MULTI_LINE_COMMENT_END_TOKEN = "*/"`, dispatched at `StructurizrDslParser.java:281-290`.                                                                                     |
| Assignment          | `<identifier> = <construct…>` | The reference recognises an assignment when `tokens.get(1) == "="` and `tokens.size() >= 3` (identifier + `=` + at least one construct token; the remaining tokens after `=` form the actual element/construct production). Identifier name validated via `IdentifiersRegister.validateIdentifierName`.                                                |
| Block start         | `{` at end of line            | Opens a new context.                                                                                                                                                                                                                                                                                                                                   |
| Block end           | `}` on its own line           | `DslContext.CONTEXT_END_TOKEN = "}"`.                                                                                                                                                                                                                                                                                                                  |

### Workspace and model

| GRAMMAR                                     | Quoted from                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace [name] [description]`            | `WorkspaceParser.GRAMMAR_STANDALONE`                       | Optional `extends <file\|url>` immediately after the `workspace` keyword. The reference parser then **loads and merges** the referenced workspace (JSON or DSL). aact diverges: we parse the syntax, do NOT fetch / merge, and emit `ModelIssue` severity=info ("`workspace extends` is not supported in aact; loaded only the local definitions"). This is an explicit scope-discipline deviation — merge complexity (HTTP fetching, JSON loader, recursive resolution) sits outside what a linter needs. The trailing `{` is dispatched separately by the line-based block-start mechanism, not part of `GRAMMAR_STANDALONE`. |
| `model {`                                   | StructurizrDslParser dispatch — no `GRAMMAR` constant      | The `model` keyword switches context; the `{` opens a block via the generic block-start mechanism. Container for all elements and top-level relationships.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `!const <name> <value>`                     | `NameValueParser.GRAMMAR = "%s <name> <value>"` (template) | Defines a substitution variable usable as `${name}` afterwards. `<name>` must match `NAME_REGEX = [a-zA-Z0-9-_.]+`. Valid only in workspace / model scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `!var <name> <value>`                       | same `NameValueParser` template                            | As `!const` but reassignable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `!constant <name> <value>`                  | `CONSTANT_TOKEN`                                           | **Hard parse error in the reference** — reference throws "`!constant` was previously deprecated, and has now been removed - please use !const or !var instead." Our parser MUST match: emit a parse error pointing the user to `!const` / `!var`.                                                                                                                                                                                                                                                                                                                                                                               |
| `!identifiers <flat\|hierarchical>`         | `IdentifierScopeParser.GRAMMAR`                            | Switches identifier resolution mode. Valid at workspace / model scope only — must appear before any element is declared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `!impliedRelationships <true\|false\|fqcn>` | `ImpliedRelationshipsParser.GRAMMAR`                       | Also accepted as bare `impliedRelationships` (no `!`); the reference dispatch is `IMPLIED_RELATIONSHIPS_TOKEN.equalsIgnoreCase(t) \|\| IMPLIED_RELATIONSHIPS_TOKEN.substring(1).equalsIgnoreCase(t)`. The reference applies the strategy at parse time (calls `model.setImpliedRelationshipsStrategy(...)` immediately); aact captures the directive on the AST and applies it during toModel. Semantic effect on the resulting Model is identical.                                                                                                                                                                             |
| `!include <file\|directory\|url>`           | `IncludeParser.GRAMMAR`                                    | Inlines another file at the include point. For a directory: every **visible** file is included (hidden files / dotfiles are skipped; the reference does NOT filter by `.dsl` extension). Leading UTF-8 BOM is stripped from each included file.                                                                                                                                                                                                                                                                                                                                                                                 |

### Elements

Every element production accepts an optional `<identifier> =` prefix.
When present, the identifier becomes the element's
`structurizr.dsl.identifier` property and is registered for downstream
relationship references.

Each element header can be followed by a `{ ... }` block carrying
**body statements** (see §1.4) and, depending on the element, nested
child elements.

| GRAMMAR                                              | Quoted from                        | Notes                                                                 |
| ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `person <name> [description] [tags]`                 | `PersonParser.GRAMMAR`             | No technology slot.                                                   |
| `softwareSystem <name> [description] [tags]`         | `SoftwareSystemParser.GRAMMAR`     | No technology slot. Body may contain `container` declarations.        |
| `container <name> [description] [technology] [tags]` | `ContainerParser.GRAMMAR`          | Body may contain `component` declarations.                            |
| `component <name> [description] [technology] [tags]` | `ComponentParser.GRAMMAR`          |                                                                       |
| `group <name> {`                                     | dispatched in StructurizrDslParser | Visual grouping; permitted inside model / softwareSystem / container. |

`tags` is a single string of comma-separated tag names — split by `,`
in the reference. Empty string acceptable (no tags).

### Archetypes (in-scope — alias declarations)

```
archetypes {
  <aliasIdentifier> = <baseKeyword> {
    [description "<text>"]
    [technology "<text>"]   // only if baseKeyword is container/component
    [tags "<csv>"]
    [tag "<single>"]
    [url "<url>"]
    [properties { ... }]
    [perspectives { ... }]
  }
}
```

Valid `baseKeyword` values: `group`, `element` (customElement), `person`,
`softwareSystem`, `container`, `component`, `deploymentNode`,
`infrastructureNode`, `relationship`.

After an archetype is declared, the `aliasIdentifier` becomes a valid
keyword wherever its base would be — `archetypes { db = container { ... } }`
then `db myDb "Orders DB"` is parsed identically to
`container "Orders DB"` (tagged with `db`, plus any defaults set in the
archetype body). The reference dispatches this via
`isElementKeywordOrArchetype(firstToken, BASE_TOKEN)` at
`StructurizrDslParser.java:1480-1486`.

The aact parser MUST extract the keyword→base-type mapping from any
`archetypes { ... }` block before parsing the model body. Archetype
defaults (description/technology/tags etc.) may be applied during
toModel as initial values for elements declared via the alias — TBD
when archetype support lands.

### Relationships

| GRAMMAR                                                          | Quoted from                          | Notes                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<identifier> -> <identifier> [description] [technology] [tags]` | `ExplicitRelationshipParser.GRAMMAR` | The explicit form. May appear at model level (top of `model { ... }`) or inside an element body where it implicitly takes the surrounding element as the source. The `this` keyword (`THIS_TOKEN`) refers to the enclosing element inside its own body — e.g. `softwareSystem "X" { this -> other "uses" }`.                                                              |
| `-> <identifier> [description] [technology] [tags]`              | `ImplicitRelationshipParser.GRAMMAR` | Implicit-source form; the source is the enclosing element.                                                                                                                                                                                                                                                                                                                |
| `<identifier> -/> <identifier> [description]`                    | `NoRelationshipParser.GRAMMAR`       | The "explicitly no relationship" form, used to suppress implied relationships. **Valid only inside a `deploymentEnvironment` block** (reference: `StructurizrDslParser.java:350` requires `inContext(DeploymentEnvironmentDslContext.class)`). Since the entire `deploymentEnvironment` block is parsed-then-info-issue for aact, this construct effectively lives there. |

A relationship may carry a `{ ... }` body. The valid body statements
(per `RelationshipDslContext.java`) are: `tags`, `url`, `properties`,
`perspectives`. There is **no** `interactionStyle` keyword in the
reference — `grep` across the Java sources returns zero hits. There is
also no relationship-body `description` / `technology` override (those
appear only as positional args on the relationship header).

### Element body statements

These statements are valid inside element bodies. They are recognised
at the line level by the reference parser via the context-stack
dispatch.

| Statement                       | Where valid                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description "<text>"`          | Inside `person` / `softwareSystem` / `container` / `component` body. Overwrites the description set by the element header.                                                                                                     |
| `technology "<text>"`           | Inside `container` / `component` body only (and inside `deploymentNode` / `infrastructureNode`, but those are out-of-scope). NOT valid inside `person` / `softwareSystem`.                                                     |
| `tags "<csv>"`                  | All element bodies. Comma-separated list, appended to header-declared tags.                                                                                                                                                    |
| `tag "<single>"`                | All element bodies. Appends a single tag.                                                                                                                                                                                      |
| `url "<url>"`                   | All element bodies.                                                                                                                                                                                                            |
| `properties { ... }`            | All element bodies. Block of `<key> <value>` lines — value can be unquoted bare token OR quoted string (only quote when the value contains whitespace).                                                                        |
| `perspectives { ... }`          | All element bodies. Block of `<name> <description> [value]` lines — exactly 2 or 3 tokens per line.                                                                                                                            |
| `!docs <path> [fqn]`            | Valid inside `softwareSystem` / `container` / `component` bodies (per their `getPermittedTokens()`), in addition to the workspace-scope form covered in §2. Element-scoped docs route to `raw.docs[elementId]` for round-trip. |
| `!decisions <path> <type\|fqn>` | Same as `!docs` — element-scoped variant alongside the workspace-scope form.                                                                                                                                                   |

Element bodies may also contain nested elements (per the hierarchy):

- `softwareSystem` body may contain `container` and `group`
- `container` body may contain `component` and `group`
- `component` body may contain `group` (no element children)
- `person` body has no nested elements

Workspace body (inside `workspace "..." { ... }`) also accepts
`name "<text>"` and `description "<text>"` overrides — see
`WorkspaceParser.parseName` / `parseDescription`.

`metadata` does **NOT** belong to element bodies in the reference
(verified against the permitted-token sets in
`PersonDslContext` / `SoftwareSystemDslContext` /
`ContainerDslContext` / `ComponentDslContext`). The `METADATA_TOKEN` is
valid only inside archetype definitions and element-style blocks
(neither of which is in scope for aact's Model).

## 2. Opaque productions (round-trip via `LoadResult.raw`)

The parser must accept these as syntactically valid blocks and preserve
their **raw source text** without interpretation. The `toModel` step
routes them to slots in `LoadResult.raw` so a future Structurizr
generator can re-emit them verbatim. No rule, analyzer, or generator
inside aact reads from these.

| Construct     | Form                                                                                                                                                                       | Raw destination                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------- |
| Views         | `views { ... }`                                                                                                                                                            | `raw.views`                       |
| Styles        | `styles { ... }` (inside `views { ... }` in current DSL)                                                                                                                   | `raw.styles`                      |
| Configuration | `configuration { ... }`                                                                                                                                                    | `raw.configuration`               |
| Branding      | `branding { ... }`                                                                                                                                                         | `raw.branding`                    |
| Terminology   | `terminology { ... }`                                                                                                                                                      | `raw.terminology`                 |
| Themes        | `themes ...`                                                                                                                                                               | `raw.themes`                      |
| Docs          | `!docs <path> <fqn>` (`DocsParser.GRAMMAR`; `<fqn>` is verbatim-mandatory in GRAMMAR but semantically optional at parse time — defaults to `DefaultDocumentationImporter`) | `raw.docs`                        |
| Decisions     | `!decisions <path> <type                                                                                                                                                   | fqn>` (`DecisionsParser.GRAMMAR`) | `raw.decisions` |
| Plugin        | `!plugin <fqn>`                                                                                                                                                            | `raw.plugins[]`                   |
| Script        | `!script <filename>` / `!script <language> { ... }`                                                                                                                        | `raw.scripts[]`                   |

The parser preserves enough byte-range info that re-emit is faithful
character-for-character.

## 3. Parsed-then-info-issue

Recognised so a legal DSL file does not crash the parser. Emits
`ModelIssue` severity=info ("deployment view is outside aact's C4
scope; ignored") at toModel time. Not surfaced in Model, not surfaced
in raw.

| Construct                | Form                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment environment   | `deploymentEnvironment <name> {` (`DeploymentEnvironmentParser.GRAMMAR`)                                                                                                                                              |
| Deployment node          | `deploymentNode <name> [description] [technology] [tags] [instances] {` (`DeploymentNodeParser.GRAMMAR`)                                                                                                              |
| Deployment group         | `deploymentGroup <name>` (`DeploymentGroupParser.GRAMMAR`)                                                                                                                                                            |
| Infrastructure node      | `infrastructureNode <name> [description] [technology] [tags]` (`InfrastructureNodeParser.GRAMMAR`)                                                                                                                    |
| Software system instance | `softwareSystemInstance <identifier> [deploymentGroups] [tags]` (`SoftwareSystemInstanceParser.GRAMMAR`)                                                                                                              |
| Container instance       | `containerInstance <identifier> [deploymentGroups] [tags]` (`ContainerInstanceParser.GRAMMAR`)                                                                                                                        |
| Instance-of (generic)    | `instanceOf <identifier> [deploymentGroups] [tags]` (`InstanceOfParser.GRAMMAR`)                                                                                                                                      |
| Health check             | `healthCheck <name> <url> [interval] [timeout]` (`HealthCheckParser.GRAMMAR`) — valid ONLY inside `softwareSystemInstance` / `containerInstance` body; free-standing `healthCheck` is a parse error in the reference. |

## 4. Tokenize-ignore (no info issue)

Block recognised at the lexical level; its content is consumed up to
the matching `}` and discarded. No warning, no info issue. These are
features outside aact's vision (per `project_long_term_vision`).

| Construct          | Form                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom element     | `element <name> [metadata] [description] [tags]` (`CustomElementParser.GRAMMAR`) — the `element` keyword is overloaded: (a) custom element in `model`, (b) element style in `styles`, (c) archetype declaration in `archetypes`. Each is dispatched by context-stack state. |
| Component finder   | `!components { ... }` (and sub-keywords: `classes`, `source`, `filter`, `strategy`, etc.) — note the actual token is `!components` (a `!`-directive), not bare `componentFinder`.                                                                                           |
| Find element       | `!element <identifier\|canonical name>` (`FindElementParser.GRAMMAR`)                                                                                                                                                                                                       |
| Find elements      | `!elements <expression>` (`FindElementsParser.GRAMMAR`)                                                                                                                                                                                                                     |
| Find relationship  | `!relationship <identifier\|canonical name>` (`FindRelationshipParser.GRAMMAR`)                                                                                                                                                                                             |
| Find relationships | `!relationships <expression>` (`FindRelationshipsParser.GRAMMAR`)                                                                                                                                                                                                           |

## 4a. Hard-removed constructs — parse error to match reference

These tokens were deprecated and then **removed** from the reference
parser. The reference now throws `RuntimeException` with a specific
upgrade message. Silent tokenize-ignore would diverge from the
reference (we'd accept files the reference rejects). aact's policy:
emit a parse error with the same upgrade hint.

| Construct                  | Form                                     | Reference error message                                                                                    |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `enterprise { ... }`       | inside `model` (deprecated, now removed) | "The enterprise keyword was previously deprecated, and has now been removed - please use group instead..." |
| `!ref <identifier>`        | element-reopen                           | "!ref was previously deprecated, and has now been removed - please use !element or !relationship instead." |
| `!extend <identifier>`     | element-reopen                           | same as `!ref`                                                                                             |
| `!constant <name> <value>` | substitution variable (legacy spelling)  | "!constant was previously deprecated, and has now been removed - please use !const or !var instead."       |

`extends` after `workspace` is **NOT** in this list. The reference still
supports it (loads and merges the referenced workspace). aact's
deviation — info-issue rather than merge — is documented in §1.2,
driven by scope discipline (linter does not implement HTTP fetching /
JSON loading / recursive merge).

## 5. Error recovery

The chevrotain parser is configured with synchronisation tokens at
block boundaries (`}` and top-level keywords). On a parse error inside
a block, the parser:

1. Records the error with full `SourceLocation` (start/end range).
2. Skips ahead to the next block boundary.
3. Continues parsing.

The resulting AST has a `recovered: true` flag on nodes whose body
contained errors; `toModel` skips recovered nodes when building Model
but still emits the error as a `ModelIssue`. Rules run on the partial
Model — the user sees both parse errors and rule violations in one pass.

## 6. Non-goals

- LSP server, CST output mode, incremental parsing (memo §8 Q#1).
- Re-parsing inside view / style / deployment block content. These
  remain opaque; if a user ever needs structured access we add it then.
- Source maps across `!include` boundaries are nice-to-have; we will
  populate `SourceLocation.file` with the actual included path but a
  visualised include chain is out of scope.

## 7. Secondary oracle — structurizr-cli

In addition to the in-tree reference under `.parser-refs/java/`, the
official `structurizr-cli` is available for runtime cross-checking.

- Install: `brew install structurizr-cli` (last upstream release
  `v2025.11.09`; upstream repo `structurizr/cli` is archived but the
  binary is functional and shares its source with the Java parser we
  already reference).
- Validate: `structurizr-cli validate -workspace path.dsl` — returns
  non-zero on a parser error.
- Export: `structurizr-cli export -workspace path.dsl -format json` —
  emits the Workspace JSON for in-scope elements; useful for
  cross-checking our `Model` against an external authority on the
  C4-canonical fragment.

Use as a diff oracle on the **in-scope** portion of the grammar. Do
not expect agreement on opaque content — we keep raw text and CLI
produces structured output for views/styles/deployment, so a textual
diff is meaningless.

When CLI rejects a file we accept (or vice versa) on in-scope content,
file the disagreement as a parser bug.

## 8. Authority precedence

When this document disagrees with the reference parser:

1. Reference parser (`.parser-refs/java/structurizr-dsl/`) wins.
2. This document is updated to match.
3. AST + tests are updated to match.

In the opposite direction, this document is the authority for our own
parser. Anything not listed here is either category 4 (tokenize-ignore)
or a parse error.
