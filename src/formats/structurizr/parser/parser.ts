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
  BangConst,
  BangIdentifiers,
  BangImpliedRelationships,
  BangInclude,
  BangIncludeUrl,
  BangVar,
  Component,
  Container,
  Description,
  Equals,
  Extends,
  Group,
  Identifier,
  LBrace,
  Model,
  Person,
  Perspectives,
  Properties,
  RBrace,
  Relationship,
  SoftwareSystem,
  StringLiteral,
  Tag,
  Tags,
  Technology,
  Url,
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
      { ALT: () => this.SUBRULE(this.directive) },
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
   * Element body — Phase 2: full body statements (description /
   * technology / tags / tag / url / properties / perspectives) plus
   * nested elements + relationships.
   *
   * Order matters: `bodyStatement` is tried first so an unprefixed
   * `description "..."` line is recognised as a body statement, not as
   * the start of a relationship.
   */
  private elementBody = this.RULE("elementBody", () => {
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.bodyStatement) },
        { ALT: () => this.SUBRULE(this.elementDeclaration) },
        { ALT: () => this.SUBRULE(this.relationship) },
      ]);
    });
    this.CONSUME(RBrace);
  });

  // ── Body statements (Phase 2) ─────────────────────────────────────

  private bodyStatement = this.RULE("bodyStatement", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.descriptionStmt) },
      { ALT: () => this.SUBRULE(this.technologyStmt) },
      { ALT: () => this.SUBRULE(this.tagsStmt) },
      { ALT: () => this.SUBRULE(this.tagStmt) },
      { ALT: () => this.SUBRULE(this.urlStmt) },
      { ALT: () => this.SUBRULE(this.propertiesBlock) },
      { ALT: () => this.SUBRULE(this.perspectivesBlock) },
    ]);
  });

  private descriptionStmt = this.RULE("descriptionStmt", () => {
    this.CONSUME(Description);
    this.CONSUME(StringLiteral);
  });

  private technologyStmt = this.RULE("technologyStmt", () => {
    this.CONSUME(Technology);
    this.CONSUME(StringLiteral);
  });

  private tagsStmt = this.RULE("tagsStmt", () => {
    this.CONSUME(Tags);
    this.CONSUME(StringLiteral);
  });

  private tagStmt = this.RULE("tagStmt", () => {
    this.CONSUME(Tag);
    this.CONSUME(StringLiteral);
  });

  private urlStmt = this.RULE("urlStmt", () => {
    this.CONSUME(Url);
    this.CONSUME(StringLiteral);
  });

  /**
   * `properties { <key> <value> ... }`. Per grammar.md §1.4 values may
   * be unquoted bare tokens or quoted strings. We accept either form
   * for each value slot.
   */
  private propertiesBlock = this.RULE("propertiesBlock", () => {
    this.CONSUME(Properties);
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.propertyEntry));
    this.CONSUME(RBrace);
  });

  private propertyEntry = this.RULE("propertyEntry", () => {
    // Key is either a quoted string or a bare identifier.
    this.OR1([
      { ALT: () => this.CONSUME1(StringLiteral, { LABEL: "key" }) },
      { ALT: () => this.CONSUME1(Identifier, { LABEL: "key" }) },
    ]);
    this.OR2([
      { ALT: () => this.CONSUME2(StringLiteral, { LABEL: "value" }) },
      { ALT: () => this.CONSUME2(Identifier, { LABEL: "value" }) },
    ]);
  });

  /**
   * `perspectives { <name> <description> [value] ... }` — exactly 2
   * or 3 tokens per line per `PerspectiveParser.java`. Name is an
   * identifier; description and optional value are strings.
   */
  private perspectivesBlock = this.RULE("perspectivesBlock", () => {
    this.CONSUME(Perspectives);
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.perspectiveEntry));
    this.CONSUME(RBrace);
  });

  private perspectiveEntry = this.RULE("perspectiveEntry", () => {
    this.CONSUME(Identifier, { LABEL: "name" });
    this.CONSUME1(StringLiteral, { LABEL: "description" });
    this.OPTION(() => this.CONSUME2(StringLiteral, { LABEL: "value" }));
  });

  // ── Directives (Phase 2) ──────────────────────────────────────────

  private directive = this.RULE("directive", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.includeDirective) },
      { ALT: () => this.SUBRULE(this.constDirective) },
      { ALT: () => this.SUBRULE(this.varDirective) },
      { ALT: () => this.SUBRULE(this.identifiersDirective) },
      { ALT: () => this.SUBRULE(this.impliedRelationshipsDirective) },
    ]);
  });

  private includeDirective = this.RULE("includeDirective", () => {
    this.OR([
      { ALT: () => this.CONSUME(BangInclude) },
      { ALT: () => this.CONSUME(BangIncludeUrl) },
    ]);
    this.OR1([
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(Identifier) },
    ]);
  });

  private constDirective = this.RULE("constDirective", () => {
    this.CONSUME(BangConst);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral, { LABEL: "value" }) },
      { ALT: () => this.CONSUME1(Identifier, { LABEL: "value" }) },
    ]);
  });

  private varDirective = this.RULE("varDirective", () => {
    this.CONSUME(BangVar);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral, { LABEL: "value" }) },
      { ALT: () => this.CONSUME1(Identifier, { LABEL: "value" }) },
    ]);
  });

  private identifiersDirective = this.RULE("identifiersDirective", () => {
    this.CONSUME(BangIdentifiers);
    this.CONSUME(Identifier, { LABEL: "scope" });
  });

  private impliedRelationshipsDirective = this.RULE(
    "impliedRelationshipsDirective",
    () => {
      this.CONSUME(BangImpliedRelationships);
      this.OR([
        { ALT: () => this.CONSUME(StringLiteral, { LABEL: "value" }) },
        { ALT: () => this.CONSUME1(Identifier, { LABEL: "value" }) },
      ]);
    },
  );

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

export const parserInstance = new StructurizrParser();

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
