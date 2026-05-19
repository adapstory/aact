import {
  keepFirstDiagram,
  preParse,
  stripDeploymentBlocks,
  stripOpaqueMacros,
  stripPlantumlNative,
  stripPreprocessor,
} from "../../../../src/formats/plantuml/parser/preParse";

const FILE = "test.puml";

describe("PUML preParse — byte-length preservation", () => {
  // Critical invariant: every pass must replace stripped content with
  // whitespace of identical byte length so chevrotain offsets stay
  // anchored to the original file. SourceLocation correctness depends
  // on this for every downstream Model node.
  it("stripPreprocessor preserves length", () => {
    const src = `!include foo\n!define X 1\nContainer(api, "API")\n`;
    const out = stripPreprocessor(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripPlantumlNative preserves length", () => {
    const src = `title Big diagram\nskinparam roundCorner 5\nContainer(api, "API")\n`;
    const out = stripPlantumlNative(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripOpaqueMacros preserves length on single-line call", () => {
    const src = `LAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const out = stripOpaqueMacros(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripDeploymentBlocks preserves length on macro + body", () => {
    const src = `Deployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n`;
    const { text } = stripDeploymentBlocks(src, FILE);
    expect(text.length).toBe(src.length);
    expect(text).toContain('Person(c, "C")');
  });

  it("keepFirstDiagram preserves length", () => {
    const src = `@startuml\nContainer(a)\n@enduml\n@startuml\nContainer(b)\n@enduml\n`;
    const { text } = keepFirstDiagram(src, FILE);
    expect(text.length).toBe(src.length);
    expect(text).toContain("Container(a)");
    expect(text).not.toContain("Container(b)");
  });

  it("composite preParse preserves length across all passes", () => {
    const src = `@startuml\n!include https://example/C4_Container.puml\nLAYOUT_WITH_LEGEND()\ntitle Big diagram\nContainer(api, "API")\n@enduml\n`;
    const { text } = preParse(src, FILE);
    expect(text.length).toBe(src.length);
  });
});

describe("PUML preParse — offsets stay anchored to original source", () => {
  it("Container offset in stripped buffer matches offset in original", () => {
    const src = `!include "lib"\nLAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text.indexOf("Container")).toBe(src.indexOf("Container"));
    // Newlines must still be `\n` in same positions.
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "\n") expect(text[i]).toBe("\n");
    }
  });
});

describe("PUML preParse — content stripping", () => {
  it("strips !include URL", () => {
    const src = `!include https://example/C4_Container.puml\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/!include/);
    expect(text).toContain("Container(api,");
  });

  it("strips LAYOUT_WITH_LEGEND() opaque call", () => {
    const src = `LAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/LAYOUT_WITH_LEGEND/);
    expect(text).toContain("Container(api,");
  });

  it("strips AddElementTag with $shape arg", () => {
    const src = `AddElementTag("async", $shape=RoundedBoxShape())\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/AddElementTag/);
    expect(text).toContain("Container(api,");
  });

  it("strips title and skinparam", () => {
    const src = `title Big diagram\nskinparam roundCorner 5\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/title|skinparam/);
    expect(text).toContain("Container(api,");
  });

  it("strips Deployment_Node block AND emits info issue", () => {
    const src = `Deployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n`;
    const { text, issues } = preParse(src, FILE);
    expect(text).not.toMatch(/Deployment_Node/);
    expect(text).not.toContain('Container(api, "API")');
    expect(text).toContain('Person(c, "C")');
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("info");
    expect(issues[0].message).toMatch(/Deployment/);
    expect(issues[0].range.file).toBe(FILE);
  });

  it("keeps only the first @startuml diagram and emits info issue", () => {
    const src = `@startuml\nContainer(a, "A")\n@enduml\n@startuml\nContainer(b, "B")\n@enduml\n`;
    const { text, issues } = preParse(src, FILE);
    expect(text).toContain('Container(a, "A")');
    expect(text).not.toContain('Container(b, "B")');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Multiple/);
  });
});
