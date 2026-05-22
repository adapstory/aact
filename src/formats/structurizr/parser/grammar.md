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

| Category                   | Goes to                                                                                                                                                                                                                                                                                                                                                                                 | Examples                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In scope**               | `Model` via the AST → toModel mapping                                                                                                                                                                                                                                                                                                                                                   | workspace, model, elements, relationships, properties, perspectives, !include, !const, !identifiers                                                                                                                                                                        |
| **Opaque**                 | stripped from the token stream pre-parse (`preParse.ts`); keyword + source range surfaced on `ChevrotainParseResult.opaqueBlocks` so a future writer can re-emit them. Inner text not captured today — no rule, analyzer, or generator reads from these.                                                                                                                                | views, styles, configuration, themes, branding, terminology, archetypes, !docs, !adrs, !plugin, !script                                                                                                                                                                    |
| **Parsed-then-info-issue** | parsed only for syntactic correctness (so a legal DSL file does not crash); emits `ModelIssue` severity=info; never reaches Model or raw                                                                                                                                                                                                                                                | deploymentEnvironment, deploymentNode, infrastructureNode, softwareSystemInstance, containerInstance, deploymentGroup, instanceOf, healthCheck                                                                                                                             |
| **Hard parse error**       | reference parser throws `RuntimeException`; aact must match to stay aligned                                                                                                                                                                                                                                                                                                             | `!ref`, `!extend`, `!constant`, `enterprise { ... }` — all four were deprecated and **then removed**; the reference now errors on them with a message pointing to the replacement. Silent-skip would diverge from the reference (we'd accept files the reference rejects). |
| **Tokenize-ignore at lex** | lexer recognises the token, parser skips the block as untyped opaque content (no info-issue, no warning)                                                                                                                                                                                                                                                                                | `!components` (component finder + family — note the actual token is `!components`, not `componentFinder`), `findElement(s)`, `findRelationship(s)`, `customElement` (`element` keyword in model).                                                                          |
| **Archetypes (in scope)**  | alias declarations (`<alias> = <baseKeyword> [{ defaults? }]`) extracted pre-parse; alias-as-kind usages (`<id> = <alias> "Name"`) rewritten to the resolved base keyword with defaults (description / technology / tags) merged onto the element. Chained aliases resolve recursively. Kind-default form, property/perspective propagation, relationship archetypes — documented gaps. | `archetypes { application = container { tag "Application" } }` → `api = application "X"` lands as Container with tag "Application"                                                                                                                                         |

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
  Workspace-body `name "..."` / `description "..."` overrides win
  over the header positionals (last-wins).
- **Archetypes block** — declaration is stripped opaque so
  archetype-bearing fixtures parse cleanly.
- **Selectors `!element`/`!elements`/`!relationship`/
  `!relationships`** — declaration blocks are stripped opaque so
  selector-bearing fixtures parse cleanly.
- **Bare `impliedRelationships`** — accepted alongside
  `!impliedRelationships` (reference uses case-insensitive
  bang-stripping). Both feed the same toModel strategy.
- **`Element` keyword as identifier** — `element` is accepted in
  `assignedIdentifier` / `source` / `destination` slots so symmetric
  forms like `element = element "X"` parse identically to
  `softwareSystem = softwareSystem "Y"`.
- **Archetype alias usage** — pre-parse pass extracts
  `<alias> = <baseKeyword> [{ defaults? }]` from `archetypes { … }`,
  resolves chained aliases (`springBoot = application { … }` where
  `application = container { … }`), and rewrites every alias-as-kind
  usage (`<id> = <alias> "Name"`) to the base keyword token with
  defaults attached. Description / technology are fallbacks (source
  positionals win); tags are additive (archetype tags + header tags).
  Verified against `DslTests.test_archetypes` — Customer API in the
  reference fixture carries tags `["Application", "Spring Boot"]`
  and technology `Spring Boot`, identical to our output.

### Remaining gaps (deliberate)

- **Archetype kind-default form** — `archetypes { softwareSystem {
description "…" } }` (no alias name on LHS) applies the body to
  every declaration of the named kind, not via an alias. Reference
  fixture: `archetypes-for-defaults.dsl`. Implementation note: would
  reuse the existing extract pass but with a different lookup key
  (kind instead of alias name). Not part of the reference's
  primary archetype use-case; deferred until a user requests.
- **Archetype property / perspective propagation** — reference
  copies `properties` / `perspectives` from the archetype body onto
  every declared element. aact applies description / technology /
  tags only. Reference fixture: `archetypes-for-defaults.dsl`.
- **Relationship archetypes** — `https = -> { technology "HTTPS" }`
  and usage `a --https-> b`. Requires a new `--<aliasName>->` lexer
  token and changes to the relationship rule. Rare in practice;
  declaration form parses cleanly (stripped opaque), usage form
  surfaces as a parse error.
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

| Construct           | Form                          | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UTF-8 BOM           | leading `﻿`                   | The reference (`StructurizrDslParser.java:249, 302`) strips BOM at the start of any line, in both main source and included files; in practice this fires only on the first line of each file.                                                                                                                                                                                                    |
| String literal      | `"..."` (double-quoted)       | Reference (`Tokenizer.java:32-46`) recognises **only** `\"` (escape an inner double quote). The backslash itself is kept in the resulting token — no `\n` / `\t` / `\\` decoding. Multi-line / multi-character content uses triple-quoted text blocks. Property / perspective values may also appear unquoted as bare tokens.                                                                    |
| Text block          | `"""\n...\n"""`               | Reference: `TEXT_BLOCK_MARKER = "\"\"\""`                                                                                                                                                                                                                                                                                                                                                        |
| String substitution | `${name}`                     | `STRING_SUBSTITUTION_PATTERN = (\$\{[a-zA-Z0-9-_.]+?\})`. Expanded _before_ lexing — handled by a pre-lex pass.                                                                                                                                                                                                                                                                                  |
| Line continuation   | trailing `\`                  | `MULTI_LINE_SEPARATOR`. Two physical lines join into one logical line.                                                                                                                                                                                                                                                                                                                           |
| Identifier          | `\w[a-zA-Z0-9_-]*` (anchored) | Reference: `IdentifiersRegister.IDENTIFIER_PATTERN`. Allows hyphen `-` after the first char; **forbids** the period `.` inside an identifier. Hierarchical references compose identifiers with `.` as a separator at lookup time, but a single declared identifier never contains `.`. Leading `-` is explicitly rejected by `validateIdentifierName`.                                           |
| `this` keyword      | `THIS_TOKEN = "this"`         | Inside an element body, refers to the enclosing element — used as a relationship endpoint (`this -> other "uses"`).                                                                                                                                                                                                                                                                              |
| Single-line comment | `// ...`, `# ...`             | `COMMENT_PATTERN = ^\s*?(//\|#).*$`.                                                                                                                                                                                                                                                                                                                                                             |
| Block comment       | `/* ... */`                   | **Line-scoped in the reference**: dispatch is `firstToken.startsWith("/*")` and exit `lastToken.endsWith("*/")`. Inline use `foo /* ... */ bar` on one line technically enters and exits CommentDslContext on the same line — net effect a no-op. Reference: `MULTI_LINE_COMMENT_START_TOKEN = "/*"` / `MULTI_LINE_COMMENT_END_TOKEN = "*/"`, dispatched at `StructurizrDslParser.java:281-289`. |
| Assignment          | `<identifier> = <construct…>` | The reference recognises an assignment when `tokens.get(1) == "="` and `tokens.size() >= 3` (identifier + `=` + at least one construct token; the remaining tokens after `=` form the actual element/construct production). Identifier name validated via `IdentifiersRegister.validateIdentifierName`.                                                                                          |
| Block start         | `{` at end of line            | Opens a new context.                                                                                                                                                                                                                                                                                                                                                                             |
| Block end           | `}` on its own line           | `DslContext.CONTEXT_END_TOKEN = "}"`.                                                                                                                                                                                                                                                                                                                                                            |

### Workspace and model

| GRAMMAR                                     | Quoted from                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace [name] [description]`            | `WorkspaceParser.GRAMMAR_STANDALONE`                       | Optional `extends <file\|url>` immediately after the `workspace` keyword. The reference parser then **loads and merges** the referenced workspace (JSON or DSL). aact diverges: we parse the syntax, do NOT fetch / merge, and emit `ModelIssue` severity=info ("`workspace extends` is not supported in aact; loaded only the local definitions"). This is an explicit scope-discipline deviation — merge complexity (HTTP fetching, JSON loader, recursive resolution) sits outside what a linter needs. The trailing `{` is dispatched separately by the line-based block-start mechanism, not part of `GRAMMAR_STANDALONE`. |
| `model {`                                   | StructurizrDslParser dispatch — no `GRAMMAR` constant      | The `model` keyword switches context; the `{` opens a block via the generic block-start mechanism. Container for all elements and top-level relationships.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `!const <name> <value>`                     | `NameValueParser.GRAMMAR = "%s <name> <value>"` (template) | Defines a substitution variable usable as `${name}` afterwards. `<name>` must match `NAME_REGEX = [a-zA-Z0-9-_.]+`. Valid **at any scope** — `StructurizrDslParser.java:1255-1265` applies no context guard, so `!const`/`!var` work top-level, inside workspace, inside `model {}`, inside an element body, even inside views.                                                                                                                                                                                                                                                                                                 |
| `!var <name> <value>`                       | same `NameValueParser` template                            | As `!const` but reassignable. Same any-scope rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `!constant <name> <value>`                  | `CONSTANT_TOKEN`                                           | **Hard parse error in the reference** — reference throws "`!constant` was previously deprecated, and has now been removed - please use !const or !var instead." Our parser MUST match: emit a parse error pointing the user to `!const` / `!var`.                                                                                                                                                                                                                                                                                                                                                                               |
| `!identifiers <flat\|hierarchical>`         | `IdentifierScopeParser.GRAMMAR`                            | Switches identifier resolution mode. The reference dispatch gates on workspace / model context. Ordering against element declarations is convention (the canonical place is right after `model {`); the reference parser does **not** enforce that ordering — late placement retroactively switches lookup mode for subsequent registrations.                                                                                                                                                                                                                                                                                   |
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
    [metadata "<text>"]     // only if baseKeyword is element (customElement)
    [properties { ... }]
    [perspectives { ... }]
  }
}
```

The reference rejects `url` inside an archetype body. `URL_TOKEN` is
only dispatched when `inContext(ModelItemDslContext.class)` (see
`StructurizrDslParser.java:642`), and `ArchetypeDslContext` does not
extend `ModelItemDslContext` — `ArchetypeParser` exposes only
`parseTag`, `parseTags`, `parseMetadata`, `parseDescription`,
`parseTechnology`. So body statements limited to the list above.

Valid `baseKeyword` values: `group`, `element` (customElement),
`person`, `softwareSystem`, `container`, `component`,
`deploymentNode`, `infrastructureNode`, and `->` (the
**relationship-archetype** form, declared as
`https = -> { ... }` per `archetypes.dsl:28`). There is no
`relationship` literal — `StructurizrDslParser.java:798` dispatches
relationships via `isRelationshipKeywordOrArchetype(firstToken)`
which matches `->` or `--<name>->`.

After an archetype is declared, the `aliasIdentifier` becomes a valid
keyword wherever its base would be — `archetypes { db = container { ... } }`
then `db myDb "Orders DB"` is parsed identically to
`container "Orders DB"` (tagged with `db`, plus any defaults set in
the archetype body). Relationship archetypes use the inline arrow
form: `archetypes { https = -> { tags "secure" } }` then
`a --https-> b "label"`. The reference dispatches via
`isElementKeywordOrArchetype(firstToken, BASE_TOKEN)` at
`StructurizrDslParser.java:1480-1486`.

The aact parser MUST extract the keyword→base-type mapping from any
`archetypes { ... }` block before parsing the model body. Archetype
defaults (description/technology/tags etc.) may be applied during
toModel as initial values for elements declared via the alias — TBD
when full archetype support lands. Today aact strips the archetypes
block opaque-style; usage forms (`<alias> <id> "name"` and
`a --<alias>-> b`) are documented gaps.

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

| Statement                       | Where valid                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description "<text>"`          | Inside `person` / `softwareSystem` / `container` / `component` body. Overwrites the description set by the element header.                                                                                                                                                                                                                 |
| `technology "<text>"`           | Inside `container` / `component` body only (and inside `deploymentNode` / `infrastructureNode`, but those are out-of-scope). NOT valid inside `person` / `softwareSystem`.                                                                                                                                                                 |
| `tags <arg> [arg ...]`          | All element bodies. **Both `tag` and `tags` are aliases** in the reference — `StructurizrDslParser.java:612` dispatches both to `ModelItemParser.parseTags`, which accepts one or more comma-separated lists. So `tag "a,b"` appends both `a` and `b`; `tags "x" "y" "z"` appends all three. Each arg may be a CSV inside a single string. |
| `tag <arg> [arg ...]`           | Syntactic alias for `tags`. Same dispatch, same comma-split semantics.                                                                                                                                                                                                                                                                     |
| `url "<url>"`                   | All element bodies.                                                                                                                                                                                                                                                                                                                        |
| `properties { ... }`            | All element bodies. Block of `<key> <value>` lines — value can be unquoted bare token OR quoted string (only quote when the value contains whitespace).                                                                                                                                                                                    |
| `perspectives { ... }`          | All element bodies. Block of `<name> <description> [value]` lines — exactly 2 or 3 tokens per line.                                                                                                                                                                                                                                        |
| `!docs <path> [fqn]`            | Valid inside `softwareSystem` / `container` / `component` bodies (per their `getPermittedTokens()`), in addition to the workspace-scope form covered in §2. **aact strips the directive at pre-parse** (`stripInlineDirectives`) — there is no Model field for documentation paths today and no round-trip writer that would re-emit them. |
| `!decisions <path> <type\|fqn>` | Same as `!docs` — element-scoped variant alongside the workspace-scope form. Pre-parse strip; no Model surface.                                                                                                                                                                                                                            |

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

## 2. Opaque productions (stripped pre-parse)

These constructs are recognised at the lexical level and stripped from
the token stream by `preParse.ts` before the grammar runs. Their
keyword + source range are surfaced on `ChevrotainParseResult.opaqueBlocks`
(views/styles/configuration/branding/terminology/themes) or
consumed silently by `stripInlineDirectives` (`!docs`/`!decisions`/
`!adrs`) / `stripDeploymentBlocks` (deployment family — see §3). No
rule, analyzer, or generator inside aact reads from these.

| Construct        | Form                                                                 | Stripped by             |
| ---------------- | -------------------------------------------------------------------- | ----------------------- |
| Views            | `views { ... }`                                                      | `stripOpaqueBlocks`     |
| Styles           | `styles { ... }` (inside `views { ... }` in current DSL)             | `stripOpaqueBlocks`     |
| Configuration    | `configuration { ... }`                                              | `stripOpaqueBlocks`     |
| Branding         | `branding { ... }`                                                   | `stripOpaqueBlocks`     |
| Terminology      | `terminology { ... }`                                                | `stripOpaqueBlocks`     |
| Themes / Theme   | `themes ...` / `theme ...`                                           | `stripOpaqueBlocks`     |
| Archetypes       | `archetypes { ... }`                                                 | `stripOpaqueBlocks`     |
| Docs             | `!docs <path> [fqn]`                                                 | `stripInlineDirectives` |
| Decisions        | `!decisions <path> <type\|fqn>`                                      | `stripInlineDirectives` |
| ADRs             | `!adrs <path>`                                                       | `stripInlineDirectives` |
| Plugin           | `!plugin <fqn>` / `!plugin <fqn> { ... }`                            | `stripOpaqueBlocks`     |
| Script           | `!script <filename>` / `!script <language> { ... }`                  | `stripOpaqueBlocks`     |
| Component finder | `!components { ... }`                                                | `stripOpaqueBlocks`     |
| Selectors        | `!element` / `!elements` / `!relationship` / `!relationships` blocks | `stripOpaqueBlocks`     |

The intent is a future round-trip writer that re-emits stripped blocks
verbatim. Until that writer exists, only the block range is preserved
— the inner text is not captured on the AST and `LoadResult` has no
`raw` slot.

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
