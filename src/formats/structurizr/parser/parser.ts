/**
 * Structurizr DSL parser (chevrotain CstParser).
 *
 * Recognises the subset of `grammar.md` needed to take a real-world
 * fixture's model section through to a populated Model:
 *
 *   - workspace [name] [description] [extends "..."] { body }
 *   - model { body }
 *   - person / softwareSystem / container / component / group element
 *     declarations (optional `id =` prefix, optional `{ body }`)
 *   - element body statements (description / technology / tags / tag /
 *     url / properties / perspectives)
 *   - <id> -> <id> [description] [technology] [tags] explicit relationships
 *   - `!include` / `!const` / `!var` / `!identifiers` /
 *     `!impliedRelationships` directives at workspace/model scope
 *
 * Not yet recognised (tracked in grammar.md):
 *
 *   - Implicit-source `-> <id> ...` form inside element bodies
 *   - The `-/>` no-relationship form (deployment-scope only)
 *   - Archetypes alias declarations
 *   - Opaque blocks (views / styles / configuration / branding /
 *     terminology / themes) — balance-brace skip lands next
 *   - Deployment family (parsed-then-info-issue)
 *   - Hard-removed reference errors (!ref / !extend / !constant / enterprise)
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
  NoRelationship,
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
  This,
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
      this.OR([
        { ALT: () => this.CONSUME3(StringLiteral, { LABEL: "extendsTarget" }) },
        { ALT: () => this.CONSUME(Identifier, { LABEL: "extendsTargetPath" }) },
      ]);
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
      { ALT: () => this.SUBRULE(this.reopenDeclaration) },
      { ALT: () => this.SUBRULE(this.relationship) },
      { ALT: () => this.SUBRULE(this.directive) },
    ]);
  });

  // Re-open form: `existing { body }` — attach more body statements,
  // nested elements, or relationships to a previously declared
  // element. Disambiguated from `id = element` and `id -> id` by the
  // `{` following the identifier.
  private reopenDeclaration = this.RULE("reopenDeclaration", () => {
    this.SUBRULE(this.identifierName, { LABEL: "target" });
    this.SUBRULE(this.elementBody);
  });

  // ── elementDeclaration: optional `id =` + header + optional body ──

  private elementDeclaration = this.RULE("elementDeclaration", () => {
    this.OPTION1(() => {
      this.SUBRULE(this.identifierName, { LABEL: "assignedIdentifier" });
      this.CONSUME(Equals);
    });
    this.SUBRULE(this.elementHeader);
    this.OPTION2(() => this.SUBRULE(this.elementBody));
  });

  /**
   * Any token that can appear in identifier position: a plain
   * `Identifier`, or an element-kind keyword (`person`, `softwareSystem`,
   * `container`, `component`, `group`) used as an identifier. The
   * reference parser's tokeniser is whitespace-only so `softwareSystem`
   * is a perfectly valid identifier name in fixtures like
   * `softwareSystem = softwareSystem "X"`. Visitor extracts the image
   * regardless of which token alt matched.
   */
  private identifierName = this.RULE("identifierName", () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(Person) },
      { ALT: () => this.CONSUME(SoftwareSystem) },
      { ALT: () => this.CONSUME(Container) },
      { ALT: () => this.CONSUME(Component) },
      { ALT: () => this.CONSUME(Group) },
    ]);
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
   * Element body — full body statements (description / technology /
   * tags / tag / url / properties / perspectives) plus nested elements
   * and relationships.
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

  // ── Body statements ───────────────────────────────────────────────

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

  // ── Directives ────────────────────────────────────────────────────

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

  // ── Relationships ──────────────────────────────────────────────────
  //
  // Three forms accepted:
  //   1. Explicit:        [id =] source -> destination [desc] [tech] [tags]
  //   2. Implicit-source:           -> destination [desc] [tech] [tags]
  //   3. No-relationship: source -/> destination (deployment-only marker)
  //
  // Form #2 only makes sense inside an element body where the enclosing
  // element supplies the source; the grammar permits it at model scope
  // too, toModel surfaces an error there. Form #3 is parsed for grammar
  // completeness; the deployment subsystem will surface info-issues.

  private relationship = this.RULE("relationship", () => {
    this.OR([
      {
        ALT: () => {
          this.OPTION1(() => {
            this.SUBRULE(this.identifierName, { LABEL: "assignedIdentifier" });
            this.CONSUME(Equals);
          });
          this.OR2([
            {
              ALT: () =>
                this.SUBRULE1(this.identifierName, { LABEL: "source" }),
            },
            { ALT: () => this.CONSUME(This, { LABEL: "sourceThis" }) },
          ]);
          this.OR1([
            { ALT: () => this.CONSUME(Relationship, { LABEL: "arrow" }) },
            { ALT: () => this.CONSUME(NoRelationship, { LABEL: "arrow" }) },
          ]);
          this.OR4([
            {
              ALT: () =>
                this.SUBRULE2(this.identifierName, { LABEL: "destination" }),
            },
            { ALT: () => this.CONSUME1(This, { LABEL: "destinationThis" }) },
          ]);
          this.OPTION2(() =>
            this.CONSUME1(StringLiteral, { LABEL: "description" }),
          );
          this.OPTION3(() =>
            this.CONSUME2(StringLiteral, { LABEL: "technology" }),
          );
          this.OPTION4(() => this.CONSUME3(StringLiteral, { LABEL: "tags" }));
        },
      },
      {
        ALT: () => {
          this.OR3([
            { ALT: () => this.CONSUME1(Relationship, { LABEL: "arrow" }) },
            { ALT: () => this.CONSUME1(NoRelationship, { LABEL: "arrow" }) },
          ]);
          this.OR5([
            {
              ALT: () =>
                this.SUBRULE3(this.identifierName, { LABEL: "destination" }),
            },
            { ALT: () => this.CONSUME2(This, { LABEL: "destinationThis" }) },
          ]);
          this.OPTION5(() =>
            this.CONSUME4(StringLiteral, { LABEL: "description" }),
          );
          this.OPTION6(() =>
            this.CONSUME5(StringLiteral, { LABEL: "technology" }),
          );
          this.OPTION7(() => this.CONSUME6(StringLiteral, { LABEL: "tags" }));
        },
      },
    ]);
  });
}

export const parserInstance = new StructurizrParser();

/**
 * Parse a Structurizr DSL token stream. Returns the chevrotain CST plus
 * the parser error array. The visitor + `toModel` walk the CST.
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
