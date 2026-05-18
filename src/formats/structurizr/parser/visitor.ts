/**
 * Structurizr DSL CST → AST visitor.
 *
 * Walks the chevrotain CST produced by `parser.ts` and converts each
 * recognised node into a typed AST node from `ast.ts`. Source positions
 * captured by chevrotain's `positionTracking: "full"` lexer are
 * promoted to `SourceLocation` on every AST node.
 *
 * Phase 1 scope (matches parser.ts skeleton):
 *
 *   - Workspace + Model
 *   - Person / SoftwareSystem / Container / Component / Group elements
 *   - Explicit relationships
 */

import type { CstNode, IToken } from "chevrotain";

import type { SourceLocation, SourcePosition } from "../../../model";
import type {
  ElementBodyNode,
  ElementNode,
  GroupNode,
  Identifier as AstIdentifier,
  IdentifierRef,
  ModelChildNode,
  ModelNode,
  RelationshipNode,
  StringLiteral as AstStringLiteral,
  WorkspaceNode,
} from "./ast";
import { parserInstance } from "./parser";

const sourcePosFromTokenStart = (token: IToken): SourcePosition => ({
  line: token.startLine!,
  col: token.startColumn!,
  offset: token.startOffset,
});

const sourcePosFromTokenEnd = (token: IToken): SourcePosition => ({
  line: token.endLine!,
  col: token.endColumn! + 1,
  offset: token.endOffset! + 1,
});

const rangeFromToken = (token: IToken, file: string): SourceLocation => ({
  file,
  start: sourcePosFromTokenStart(token),
  end: sourcePosFromTokenEnd(token),
});

const rangeFromTokens = (
  first: IToken,
  last: IToken,
  file: string,
): SourceLocation => ({
  file,
  start: sourcePosFromTokenStart(first),
  end: sourcePosFromTokenEnd(last),
});

const unwrapStringLiteral = (image: string): string => {
  const inner = image.slice(1, -1);
  return inner.replaceAll(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case "n": {
        return "\n";
      }
      case "t": {
        return "\t";
      }
      case "r": {
        return "\r";
      }
      case '"': {
        return '"';
      }
      case "\\": {
        return "\\";
      }
      default: {
        return char;
      }
    }
  });
};

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface ElementHeaderAst {
  readonly kind:
    | "person"
    | "softwareSystem"
    | "container"
    | "component"
    | "group";
  readonly kindToken: IToken;
  readonly lastToken: IToken;
  readonly name: AstStringLiteral;
  readonly description?: AstStringLiteral;
  readonly technology?: AstStringLiteral;
  readonly tags?: AstStringLiteral;
}

const findClosingBrace = (cst: CstNode): IToken | undefined => {
  const rbrace = (cst.children as { RBrace?: IToken[] }).RBrace;
  return rbrace?.[0];
};

class StructurizrCstToAst extends BaseVisitor {
  private file = "";

  constructor() {
    super();
    this.validateVisitor();
  }

  public buildAst(cst: CstNode, file: string): WorkspaceNode {
    this.file = file;
    return this.visit(cst) as WorkspaceNode;
  }

  workspaceFile(ctx: WorkspaceFileCtx): WorkspaceNode {
    return this.visit(ctx.workspaceBlock[0]) as WorkspaceNode;
  }

  workspaceBlock(ctx: WorkspaceBlockCtx): WorkspaceNode {
    const workspaceToken = ctx.Workspace[0];
    // After a parse error, chevrotain may produce a partial CST where
    // the closing brace is missing. Fall back to the workspace token's
    // own range — `recovered: true` signals the partial parse.
    const closeToken = ctx.RBrace?.[0] ?? workspaceToken;
    const recovered = !ctx.RBrace?.[0];
    const name = ctx.name ? this.stringFromToken(ctx.name[0]) : undefined;
    const description = ctx.description
      ? this.stringFromToken(ctx.description[0])
      : undefined;
    const extendsTarget = ctx.extendsTarget
      ? this.stringFromToken(ctx.extendsTarget[0])
      : undefined;
    const modelBlocks = (ctx.modelBlock ?? []).map(
      (m) => this.visit(m) as ModelNode,
    );
    return {
      kind: "workspace",
      name,
      description,
      extendsTarget,
      body: modelBlocks,
      range: rangeFromTokens(workspaceToken, closeToken, this.file),
      ...(recovered ? { recovered: true as const } : {}),
    };
  }

  modelBlock(ctx: ModelBlockCtx): ModelNode {
    const modelToken = ctx.Model[0];
    const closeToken = ctx.RBrace?.[0] ?? modelToken;
    const recovered = !ctx.RBrace?.[0];
    const items = (ctx.modelBodyItem ?? [])
      .map((i) => this.visit(i) as ModelChildNode | undefined)
      .filter((i): i is ModelChildNode => i !== undefined);
    return {
      kind: "model",
      children: items,
      range: rangeFromTokens(modelToken, closeToken, this.file),
      ...(recovered ? { recovered: true as const } : {}),
    };
  }

  modelBodyItem(ctx: ModelBodyItemCtx): ModelChildNode | undefined {
    if (ctx.elementDeclaration?.[0]) {
      return this.visit(ctx.elementDeclaration[0]) as ElementNode;
    }
    if (ctx.relationship?.[0]) {
      return this.visit(ctx.relationship[0]) as RelationshipNode;
    }
    return undefined; // recovered / incomplete — caller filters
  }

  elementDeclaration(ctx: ElementDeclarationCtx): ElementNode {
    const header = this.visit(ctx.elementHeader[0]) as ElementHeaderAst;
    const body: ElementBodyNode[] = ctx.elementBody
      ? (this.visit(ctx.elementBody[0]) as ElementBodyNode[])
      : [];
    const assigned = ctx.assignedIdentifier?.[0];
    const assignedAst: AstIdentifier | undefined = assigned
      ? {
          kind: "identifier",
          name: assigned.image,
          range: rangeFromToken(assigned, this.file),
        }
      : undefined;

    const startToken = assigned ?? header.kindToken;
    const closingToken = ctx.elementBody?.[0]
      ? findClosingBrace(ctx.elementBody[0])
      : header.lastToken;
    const baseRange = rangeFromTokens(
      startToken,
      closingToken ?? header.lastToken,
      this.file,
    );

    switch (header.kind) {
      case "person": {
        return {
          kind: "person",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription: header.description,
          body,
          range: baseRange,
        };
      }
      case "softwareSystem": {
        return {
          kind: "softwareSystem",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription: header.description,
          body,
          range: baseRange,
        };
      }
      case "container": {
        return {
          kind: "container",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription: header.description,
          headerTechnology: header.technology,
          body,
          range: baseRange,
        };
      }
      case "component": {
        return {
          kind: "component",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription: header.description,
          headerTechnology: header.technology,
          body,
          range: baseRange,
        };
      }
      case "group": {
        const groupNode: GroupNode = {
          kind: "group",
          assignedIdentifier: assignedAst,
          name: header.name,
          members: body.filter(
            (b): b is ElementNode | RelationshipNode =>
              b.kind === "person" ||
              b.kind === "softwareSystem" ||
              b.kind === "container" ||
              b.kind === "component" ||
              b.kind === "group" ||
              b.kind === "relationship",
          ),
          range: baseRange,
        };
        return groupNode;
      }
    }
  }

  elementHeader(ctx: ElementHeaderCtx): ElementHeaderAst {
    const kindToken =
      ctx.kind?.[0] ??
      ctx.Person?.[0] ??
      ctx.SoftwareSystem?.[0] ??
      ctx.Container?.[0] ??
      ctx.Component?.[0] ??
      ctx.Group?.[0];
    if (!kindToken) {
      throw new Error("elementHeader: missing kind token in CST");
    }
    const kindName = (kindToken.tokenType.name.charAt(0).toLowerCase() +
      kindToken.tokenType.name.slice(1)) as ElementHeaderAst["kind"];
    const nameToken = ctx.name[0];
    const positional1 = ctx.positional1?.[0];
    const positional2 = ctx.positional2?.[0];
    const positional3 = ctx.positional3?.[0];

    const hasTechnology = kindName === "container" || kindName === "component";

    let description: AstStringLiteral | undefined;
    let technology: AstStringLiteral | undefined;
    let tags: AstStringLiteral | undefined;

    if (positional1) description = this.stringFromToken(positional1);
    if (positional2) {
      if (hasTechnology) technology = this.stringFromToken(positional2);
      else tags = this.stringFromToken(positional2);
    }
    if (positional3) {
      tags = this.stringFromToken(positional3);
    }

    const lastToken = positional3 ?? positional2 ?? positional1 ?? nameToken;
    return {
      kind: kindName,
      kindToken,
      lastToken,
      name: this.stringFromToken(nameToken),
      description,
      technology,
      tags,
    };
  }

  elementBody(ctx: ElementBodyCtx): ElementBodyNode[] {
    const items: ElementBodyNode[] = [];
    if (ctx.elementDeclaration) {
      for (const decl of ctx.elementDeclaration) {
        items.push(this.visit(decl) as ElementNode);
      }
    }
    if (ctx.relationship) {
      for (const rel of ctx.relationship) {
        items.push(this.visit(rel) as RelationshipNode);
      }
    }
    return items;
  }

  relationship(ctx: RelationshipCtx): RelationshipNode {
    const sourceToken = ctx.source[0];
    const destinationToken = ctx.destination[0];
    const arrowToken = ctx.Relationship[0];
    const lastToken =
      ctx.tags?.[0] ??
      ctx.technology?.[0] ??
      ctx.description?.[0] ??
      destinationToken;

    const source: IdentifierRef = {
      kind: "identifierRef",
      name: sourceToken.image,
      range: rangeFromToken(sourceToken, this.file),
      ...(sourceToken.image === "this" ? { isThis: true as const } : {}),
    };
    const destination: IdentifierRef = {
      kind: "identifierRef",
      name: destinationToken.image,
      range: rangeFromToken(destinationToken, this.file),
      ...(destinationToken.image === "this" ? { isThis: true as const } : {}),
    };
    const assigned = ctx.assignedIdentifier?.[0];
    const assignedAst: AstIdentifier | undefined = assigned
      ? {
          kind: "identifier",
          name: assigned.image,
          range: rangeFromToken(assigned, this.file),
        }
      : undefined;
    return {
      kind: "relationship",
      assignedIdentifier: assignedAst,
      arrow: arrowToken.image as "->" | "-/>",
      source,
      destination,
      headerDescription: ctx.description
        ? this.stringFromToken(ctx.description[0])
        : undefined,
      headerTechnology: ctx.technology
        ? this.stringFromToken(ctx.technology[0])
        : undefined,
      headerTags: ctx.tags ? this.stringFromToken(ctx.tags[0]) : undefined,
      body: [],
      range: rangeFromTokens(assigned ?? sourceToken, lastToken, this.file),
    };
  }

  private stringFromToken(token: IToken): AstStringLiteral {
    return {
      kind: "string",
      value: unwrapStringLiteral(token.image),
      range: rangeFromToken(token, this.file),
    };
  }
}

interface WorkspaceFileCtx {
  readonly workspaceBlock: readonly [CstNode];
}

interface WorkspaceBlockCtx {
  readonly Workspace: readonly [IToken];
  readonly name?: readonly [IToken];
  readonly description?: readonly [IToken];
  readonly extendsTarget?: readonly [IToken];
  readonly modelBlock?: readonly CstNode[];
  readonly LBrace?: readonly [IToken];
  readonly RBrace?: readonly [IToken];
}

interface ModelBlockCtx {
  readonly Model: readonly [IToken];
  readonly LBrace?: readonly [IToken];
  readonly RBrace?: readonly [IToken];
  readonly modelBodyItem?: readonly CstNode[];
}

interface ModelBodyItemCtx {
  readonly elementDeclaration?: readonly [CstNode];
  readonly relationship?: readonly [CstNode];
}

interface ElementDeclarationCtx {
  readonly assignedIdentifier?: readonly [IToken];
  readonly Equals?: readonly [IToken];
  readonly elementHeader: readonly [CstNode];
  readonly elementBody?: readonly [CstNode];
}

interface ElementHeaderCtx {
  readonly kind?: readonly [IToken];
  readonly Person?: readonly [IToken];
  readonly SoftwareSystem?: readonly [IToken];
  readonly Container?: readonly [IToken];
  readonly Component?: readonly [IToken];
  readonly Group?: readonly [IToken];
  readonly name: readonly [IToken];
  readonly positional1?: readonly [IToken];
  readonly positional2?: readonly [IToken];
  readonly positional3?: readonly [IToken];
}

interface ElementBodyCtx {
  readonly LBrace: readonly [IToken];
  readonly RBrace: readonly [IToken];
  readonly elementDeclaration?: readonly CstNode[];
  readonly relationship?: readonly CstNode[];
}

interface RelationshipCtx {
  readonly assignedIdentifier?: readonly [IToken];
  readonly source: readonly [IToken];
  readonly destination: readonly [IToken];
  readonly Relationship: readonly [IToken];
  readonly description?: readonly [IToken];
  readonly technology?: readonly [IToken];
  readonly tags?: readonly [IToken];
}

export const buildAst = (cst: CstNode, file: string): WorkspaceNode => {
  const visitor = new StructurizrCstToAst();
  return visitor.buildAst(cst, file);
};
