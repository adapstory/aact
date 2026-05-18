# Structurizr DSL parser (in progress)

A hand-written [chevrotain](https://chevrotain.io) parser for the
Structurizr DSL — replacement for the current regex-based loader
(`../load.ts`). Tracking strategy: `memory/project_v3_parser_strategy.md`.

## Status

Pre-implementation. This directory currently holds **the target grammar
and reference notes**. No parser code, no chevrotain dependency yet.

The current `load.ts` keeps running until the new parser passes the full
test corpus (`test/formats/structurizr/parser/`).

## Why a hand-written parser

Regex loaders lose source positions — diagnostics cannot point to
`file:line:col`, and `--fix` is `search/replace` (fragile). chevrotain
gives a CST/AST with locations and error recovery → partial parse plus
parse errors emitted as `ModelIssue` rather than a hard failure.

A maintained JS/TS Structurizr DSL parser with usable source locations
does not exist as of May 2026. Alternatives evaluated and rejected in
`project_v3_parser_strategy.md` §10.

## License posture

**aact is GPL-3.0.** The references listed below are studied for
grammar and behaviour — never copied verbatim into this repository.
Grammar and syntax are not copyrightable; the chevrotain grammar in this
directory is original work.

Test inputs in `test/formats/structurizr/parser/corpus/` are
authored from scratch in our fixture style, _informed by_ but not copied
from upstream test suites.

## References

Fetched on demand by `scripts/fetch-parser-refs.sh` into the
gitignored `.parser-refs/` directory.

| Reference                                                                                           | Use                                                                                                                                              | License       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| [structurizr/dsl](https://github.com/structurizr/dsl) — official Java parser and language reference | Authoritative grammar and behaviour. Read `src/test/java/com/structurizr/dsl/` for expected `input → behaviour` pairs to inform our test corpus. | Apache-2.0    |
| [Structurizr DSL Language Reference](https://docs.structurizr.com/dsl/language)                     | Token-level documentation.                                                                                                                       | Documentation |

## Scope

In line with `project_v3_parser_strategy.md` §2 — full Structurizr DSL
within the C4 paradigm. Concrete scope lives in `grammar.md`.

## Files (to come)

- `grammar.md` — the target grammar (rule by rule, scope decisions)
- `lexer.ts` — chevrotain token definitions
- `parser.ts` — chevrotain `CstParser` subclass
- `ast.ts` — typed AST node types
- `toModel.ts` — AST → `Model` mapping, populates `sourceLocation`
- `index.ts` — public entry point: `parse(source, filePath): LoadResult`
