/**
 * Structurizr DSL parser — Phase 1 skeleton (chevrotain CstParser).
 *
 * Recognises the minimum useful subset from `grammar.md` so a real-world
 * fixture's model section parses without errors:
 *
 *   - workspace [name] [description] [extends "..."] { body }
 *   - model { body }
 *   - person / softwareSystem / container / component / group element
 *     declarations (with optional `id =` prefix and `{ body }`)
 *   - <id> -> <id> [description] [technology] [tags] explicit relationships
 *
 * Out of scope for Phase 1 (added incrementally in Phase 2):
 *
 *   - Element body statements (description / technology / tags / url /
 *     properties / perspectives / metadata / !docs / !decisions)
 *   - Implicit-source `-> <id> ...` form
 *   - The `-/>` no-relationship form (deployment-scope only — handled
 *     when the deployment block lands)
 *   - Archetypes alias declarations
 *   - All !directives (!include / !const / !var / !identifiers /
 *     !impliedRelationships)
 *   - Opaque blocks (views / styles / configuration / branding /
 *     terminology / themes) — Phase 2 will balance-brace-skip these
 *   - Deployment family (parsed-then-info-issue)
 *
 * Adding a rule:
 *   1. Add `this.RULE("name", () => { ... })`.
 *   2. Reference via `this.SUBRULE(this.name)`.
 *   3. Cover with a smoke test.
 *   4. Update the grammar.md "what's parsed today" section.
 */

import type { IToken } from "chevrotain";
import { CstParser } from "chevrotain";

import {
  allTokens,
  Component,
  Container,
  Equals,
  Extends,
  Group,
  Identifier,
  LBrace,
  Model,
  Person,
  RBrace,
  Relationship,
  SoftwareSystem,
  StringLiteral,
  Workspace,
} from "./tokens";

class StructurizrParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: true,
      maxLookahead: 4,
    });
    this.performSelfAnalysis();
  }

  // ── Entry point ────────────────────────────────────────────────────

  public workspaceFile = this.RULE("workspaceFile", () => {
    this.SUBRULE(this.workspaceBlock);
  });

  // ── workspace [name] [description] [extends "..."] { body } ────────

  private workspaceBlock = this.RULE("workspaceBlock", () => {
    this.CONSUME(Workspace);
    this.OPTION1(() => this.CONSUME1(StringLiteral, { LABEL: "name" }));
    this.OPTION2(() => this.CONSUME2(StringLiteral, { LABEL: "description" }));
    this.OPTION3(() => {
      this.CONSUME(Extends);
      this.CONSUME3(StringLiteral, { LABEL: "extendsTarget" });
    });
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.modelBlock));
    this.CONSUME(RBrace);
  });

  // ── model { ... } ──────────────────────────────────────────────────

  private modelBlock = this.RULE("modelBlock", () => {
    this.CONSUME(Model);
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.modelBodyItem));
    this.CONSUME(RBrace);
  });

  private modelBodyItem = this.RULE("modelBodyItem", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.elementDeclaration) },
      { ALT: () => this.SUBRULE(this.relationship) },
    ]);
  });

  // ── elementDeclaration: optional `id =` + header + optional body ──

  private elementDeclaration = this.RULE("elementDeclaration", () => {
    this.OPTION1(() => {
      this.CONSUME(Identifier, { LABEL: "assignedIdentifier" });
      this.CONSUME(Equals);
    });
    this.SUBRULE(this.elementHeader);
    this.OPTION2(() => this.SUBRULE(this.elementBody));
  });

  private elementHeader = this.RULE("elementHeader", () => {
    this.OR([
      { ALT: () => this.CONSUME(Person, { LABEL: "kind" }) },
      { ALT: () => this.CONSUME(SoftwareSystem, { LABEL: "kind" }) },
      { ALT: () => this.CONSUME(Container, { LABEL: "kind" }) },
      { ALT: () => this.CONSUME(Component, { LABEL: "kind" }) },
      { ALT: () => this.CONSUME(Group, { LABEL: "kind" }) },
    ]);
    this.CONSUME(StringLiteral, { LABEL: "name" });
    // Up to 3 positional string args after name. Their meaning depends on
    // `kind` (per ContainerParser.GRAMMAR / SoftwareSystemParser.GRAMMAR /
    // etc. — see grammar.md §1.x Elements). toModel disambiguates.
    this.OPTION1(() => this.CONSUME1(StringLiteral, { LABEL: "positional1" }));
    this.OPTION2(() => this.CONSUME2(StringLiteral, { LABEL: "positional2" }));
    this.OPTION3(() => this.CONSUME3(StringLiteral, { LABEL: "positional3" }));
  });

  /**
   * Phase-1 placeholder element body: only nested elements and
   * relationships. Body statements (description / technology / tags /
   * url / properties / perspectives / !docs / !decisions) land in
   * Phase 2.
   */
  private elementBody = this.RULE("elementBody", () => {
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.elementDeclaration) },
        { ALT: () => this.SUBRULE(this.relationship) },
      ]);
    });
    this.CONSUME(RBrace);
  });

  // ── <id> -> <id> [description] [technology] [tags] ─────────────────

  private relationship = this.RULE("relationship", () => {
    this.OPTION1(() => {
      this.CONSUME(Identifier, { LABEL: "assignedIdentifier" });
      this.CONSUME(Equals);
    });
    this.CONSUME1(Identifier, { LABEL: "source" });
    this.CONSUME(Relationship);
    this.CONSUME2(Identifier, { LABEL: "destination" });
    this.OPTION2(() => this.CONSUME1(StringLiteral, { LABEL: "description" }));
    this.OPTION3(() => this.CONSUME2(StringLiteral, { LABEL: "technology" }));
    this.OPTION4(() => this.CONSUME3(StringLiteral, { LABEL: "tags" }));
  });
}

const parserInstance = new StructurizrParser();

/**
 * Parse a Structurizr DSL token stream. Returns the chevrotain CST plus
 * the parser error array. `toModel` (Phase 1 stub, next) walks the CST.
 */
export const parseStructurizrDsl = (
  tokens: readonly IToken[],
): {
  cst: ReturnType<typeof parserInstance.workspaceFile>;
  errors: readonly unknown[];
} => {
  parserInstance.input = tokens as IToken[];
  const cst = parserInstance.workspaceFile();
  return {
    cst,
    errors: parserInstance.errors,
  };
};

export { StructurizrParser };
