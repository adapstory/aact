# Format coverage matrix (v3.0)

Какие поля Model заполняются при load и emit'ятся при generate для каждого
формата. `✓` = full support, `⚠` = partial / known limitation, `—` = field
not applicable to this format, `gap` = silent drop (документировано).

## Container

| Field            | PUML load                                                    | PUML generate  | Structurizr load                                    |
| ---------------- | ------------------------------------------------------------ | -------------- | --------------------------------------------------- |
| `name`           | ✓ alias                                                      | ✓              | ✓ via `structurizr.dsl.identifier` или raw id       |
| `label`          | ✓                                                            | ✓              | ✓ `name` field                                      |
| `kind`           | ✓ macro lookup                                               | ✓ reverse map  | ✓ inferKindFromTechnology                           |
| `external`       | ✓ `_Ext` suffix                                              | ✓              | ✓ `location: External` или tag                      |
| `description`    | ✓ positional 4                                               | ✓ positional 4 | ✓ `description`                                     |
| `technology`     | ✓ positional 3                                               | ✓ positional 3 | ✓ `technology`                                      |
| `tags`           | ✓ `$tags=` или positional 6                                  | ✓ `$tags=`     | ✓ CSV `tags`                                        |
| `sprite`         | ✓ `$sprite=` или positional 5                                | ✓ `$sprite=`   | —                                                   |
| `link`           | ✓ `$link=` или positional 7                                  | ✓ `$link=`     | ✓ `url`                                             |
| `relations`      | ✓ Rel + BiRel expansion                                      | ✓ Rel each     | ✓ Pass 3 mapping                                    |
| `properties`     | ⚠ `gap` — `SetPropertyHeader`/`AddProperty` parser не expose | ⚠ gap          | ✓ user properties + `group` + `perspectives.<name>` |
| `sourceLocation` | ⚠ planned v3.x                                               | —              | ⚠ planned v3.x                                      |

## Boundary

| Field            | PUML load                                                                       | PUML generate | Structurizr load                                                        |
| ---------------- | ------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `name`           | ✓ alias                                                                         | ✓             | ✓ dslId                                                                 |
| `label`          | ✓                                                                               | ✓             | ✓ `name` field                                                          |
| `kind`           | ✓ `Boundary` / `System_Boundary` / `Container_Boundary` / `Enterprise_Boundary` | ✓ reverse map | hardcoded `"System"` (internal system → Boundary)                       |
| `description`    | ⚠ `gap` — parser принимает только 4 positional, descr (6-й) недоступен          | ⚠ gap         | ✓ `description`                                                         |
| `tags`           | ✓                                                                               | ✓             | ✓ CSV                                                                   |
| `elementNames`   | ✓ via elements scan                                                             | ✓             | ✓ s.containers                                                          |
| `boundaryNames`  | ✓ nested boundaries                                                             | ✓             | always `[]` — Structurizr не nests softwareSystem inside softwareSystem |
| `link`           | ✓                                                                               | ✓ `$link=`    | ✓ `url`                                                                 |
| `properties`     | ⚠ `gap`                                                                         | ⚠ gap         | ✓ user + group + perspectives                                           |
| `sourceLocation` | ⚠ planned v3.x                                                                  | —             | ⚠ planned v3.x                                                          |

## Relation

| Field            | PUML load                            | PUML generate  | Structurizr load                                                           |
| ---------------- | ------------------------------------ | -------------- | -------------------------------------------------------------------------- |
| `to`             | ✓                                    | ✓              | ✓ targetName via idToName                                                  |
| `description`    | ✓ `label`                            | ✓ positional 3 | ✓ `description`                                                            |
| `technology`     | ✓ `techn`                            | ✓ positional 4 | ✓ `technology`                                                             |
| `tags`           | ✓ `$tags=` или positional 7          | ✓ `$tags=`     | ✓ CSV + `async` для async interactionStyle                                 |
| `sprite`         | ✓ `$sprite=` или positional 6        | ✓ `$sprite=`   | —                                                                          |
| `order`          | ⚠ `gap` — `$index=` parser не expose | ⚠ gap          | ⚠ `gap` — Structurizr step order живёт в `views[].dynamic`, не на relation |
| `link`           | ✓ `$link=` или positional 8          | ✓ `$link=`     | ✓ `url`                                                                    |
| `properties`     | ⚠ `gap`                              | ⚠ gap          | ✓ user + perspectives prefix                                               |
| `sourceLocation` | ⚠ planned v3.x                       | —              | ⚠ planned v3.x                                                             |

## Resolution path для known gaps

5 PUML-side `gap`'ов вытекают из одной точки — **plantuml-parser 0.4 ограничен в expressivity**.

| Gap                  | Workaround в v3.0           | Resolution                                             |
| -------------------- | --------------------------- | ------------------------------------------------------ |
| properties           | none — drop'аем             | v3.x: chevrotain-based PUML grammar replacement        |
| Boundary description | none                        | same — own grammar разрешит                            |
| Relation.order       | none                        | same                                                   |
| Component_Boundary   | filterElements в dead-list  | same                                                   |
| sourceLocation       | infrastructure stub в типах | v3.x: regex-scan layer OR new parser выставит location |

См. `feedback project_v3_parser_strategy.md` (private notes) — long-term plan
заменить plantuml-parser своим chevrotain parser, общий для PUML + Structurizr DSL.

## Capability matrix (capability-based Format API)

| Format        | load | generate | fix                                                   |
| ------------- | ---- | -------- | ----------------------------------------------------- |
| `plantuml`    | ✓    | ✓        | ✓ `plantumlSyntax` for in-place edits                 |
| `structurizr` | ✓    | —        | ✓ `structurizrDslSyntax` (пишет в `source.writePath`) |
| `kubernetes`  | —    | ✓        | —                                                     |

Adding new format = `src/formats/<name>/` папка + строка в `src/formats/registry.ts`.
См. `test/formats/registry.test.ts` для contract.
