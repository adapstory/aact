import { c4PumlParser } from "../../../../src/formats/plantuml/parser/parser";
import { preParse } from "../../../../src/formats/plantuml/parser/preParse";
import { C4PumlLexer } from "../../../../src/formats/plantuml/parser/tokens";
import { buildAst } from "../../../../src/formats/plantuml/parser/visitor";

const FILE = "test.puml";

const parse = (src: string) => {
  const { text } = preParse(src, FILE);
  const lex = C4PumlLexer.tokenize(text);
  c4PumlParser.input = lex.tokens;
  const cst = c4PumlParser.pumlFile();
  return {
    ast: buildAst(cst, FILE),
    lexErrors: lex.errors,
    parseErrors: c4PumlParser.errors,
  };
};

describe("PUML visitor — CST → AST", () => {
  it("builds FileNode with one diagram from a minimal sample", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    expect(ast.kind).toBe("file");
    expect(ast.diagrams).toHaveLength(1);
    const diagram = ast.diagrams[0];
    expect(diagram.statements).toHaveLength(1);
    expect(diagram.statements[0].kind).toBe("elementMacro");
  });

  it("captures @startuml quoted name", () => {
    const src = `@startuml "techtribesjs"\nContainer(api, "API")\n@enduml\n`;
    const { ast } = parse(src);
    expect(ast.diagrams[0].name?.value).toBe("techtribesjs");
    expect(ast.diagrams[0].name?.form).toBe("string");
  });

  it("element macro positionals retain order — alias, label, techn, descr", () => {
    const src = `@startuml\nContainer(api, "API", "Node.js", "REST gateway")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.macroName).toBe("Container");
    expect(stmt.positionals).toHaveLength(4);
    expect(stmt.positionals[0]).toMatchObject({
      kind: "bareToken",
      value: "api",
    });
    expect(stmt.positionals[1]).toMatchObject({ kind: "string", value: "API" });
    expect(stmt.positionals[2]).toMatchObject({
      kind: "string",
      value: "Node.js",
    });
    expect(stmt.positionals[3]).toMatchObject({
      kind: "string",
      value: "REST gateway",
    });
  });

  it("named args ($tags, $link, $sprite) land in namedArgs bucket", () => {
    const src = `@startuml\nContainer(api, "API", $tags="async,api", $link="https://x", $sprite="logo")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.positionals).toHaveLength(2); // alias + label only
    expect(stmt.namedArgs).toHaveLength(3);
    const byName = Object.fromEntries(stmt.namedArgs.map((a) => [a.name, a]));
    expect(byName.tags.value).toMatchObject({
      kind: "string",
      value: "async,api",
    });
    expect(byName.link.value).toMatchObject({
      kind: "string",
      value: "https://x",
    });
    expect(byName.sprite.value).toMatchObject({
      kind: "string",
      value: "logo",
    });
  });

  it("unknown named args land in unknownNamedArgs bucket (round-trip preservation)", () => {
    const src = `@startuml\nContainer(api, "API", $futureFlag="x")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.namedArgs).toEqual([]);
    expect(stmt.unknownNamedArgs).toHaveLength(1);
    expect(stmt.unknownNamedArgs[0].name).toBe("futureFlag");
  });

  it("inline function-call value (`$index=Index()`) becomes FunctionCallValue node", () => {
    const src = `@startuml\nRel(a, b, "calls", $index=Index())\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.namedArgs).toHaveLength(1);
    const indexArg = stmt.namedArgs[0];
    expect(indexArg.name).toBe("index");
    expect(indexArg.value.kind).toBe("functionCallValue");
    if (indexArg.value.kind === "functionCallValue") {
      expect(indexArg.value.functionName).toBe("Index");
    }
  });

  it("RelIndex first positional becomes indexPositional, rest shift down", () => {
    const src = `@startuml\nRelIndex("1", a, b, "calls")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.macroName).toBe("RelIndex");
    expect(stmt.indexPositional).toMatchObject({ kind: "string", value: "1" });
    expect(stmt.positionals).toHaveLength(3); // a, b, label
    expect(stmt.positionals[0]).toMatchObject({
      kind: "bareToken",
      value: "a",
    });
  });

  it("BiRel macro carries bidirectional=true flag", () => {
    const src = `@startuml\nBiRel(a, b, "syncs")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.bidirectional).toBe(true);
    expect(stmt.macroName).toBe("BiRel");
  });

  it("Rel_Back_Neighbor decodes back=true + neighbor=true", () => {
    const src = `@startuml\nRel_Back_Neighbor(a, b, "calls")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.back).toBe(true);
    expect(stmt.neighbor).toBe(true);
    expect(stmt.macroName).toBe("Rel_Back_Neighbor");
  });

  it("System_Boundary with nested Container produces boundaryMacro with one child", () => {
    const src = `@startuml\nSystem_Boundary(b, "Bank") {\n  Container(api, "API")\n}\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "boundaryMacro")
      throw new Error("expected boundaryMacro");
    expect(stmt.macroName).toBe("System_Boundary");
    expect(stmt.children).toHaveLength(1);
    expect(stmt.children[0].kind).toBe("elementMacro");
  });

  it("preserves SourceLocation — start offset of Container matches source", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const expectedOffset = src.indexOf("Container");
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    expect(stmt.range.file).toBe(FILE);
    expect(stmt.range.start.offset).toBe(expectedOffset);
    // Line 2, col 1 (1-based)
    expect(stmt.range.start.line).toBe(2);
    expect(stmt.range.start.col).toBe(1);
  });

  it("preserves offsets through preParse strip — Container after stripped !include", () => {
    const src = `@startuml\n!include https://example/C4_Container.puml\nLAYOUT_WITH_LEGEND()\nContainer(api, "API")\n@enduml\n`;
    const expectedOffset = src.indexOf("Container(");
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    expect(stmt.range.start.offset).toBe(expectedOffset);
  });
});
