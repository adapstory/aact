import fs from "node:fs";
import path from "node:path";

import { parseSource } from "../../../../src/formats/plantuml/parser";

const FILE = "test.puml";

describe("parseSource — full pipeline", () => {
  it("returns clean model + empty errors for a minimal sample", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.preParseIssues).toEqual([]);
    expect(result.model.containers["api"]).toBeDefined();
  });

  it("strips !include + LAYOUT macros silently (no parse errors)", () => {
    const src = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
LAYOUT_WITH_LEGEND()
title Container diagram

Container(api, "API")
@enduml
`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.containers["api"]).toBeDefined();
  });

  it("surfaces preParseIssue when a Deployment_Node is encountered", () => {
    const src = `@startuml\nDeployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.preParseIssues).toHaveLength(1);
    expect(result.preParseIssues[0].kind).toBe("info");
    expect(result.preParseIssues[0].message).toMatch(/Deployment/);
    // The deployment-wrapped Container is gone; the standalone Person remains.
    expect(result.model.containers["api"]).toBeUndefined();
    expect(result.model.containers["c"]).toBeDefined();
  });

  it("trims subsequent @startuml diagrams with info-issue", () => {
    const src = `@startuml\nContainer(a, "A")\n@enduml\n@startuml\nContainer(b, "B")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.preParseIssues.map((i) => i.message)).toEqual([
      expect.stringMatching(/Multiple/),
    ]);
    expect(result.model.containers["a"]).toBeDefined();
    expect(result.model.containers["b"]).toBeUndefined();
  });

  it("preserves SourceLocation across the full pipeline", () => {
    const src = `@startuml
!include "C4_Container.puml"
LAYOUT_WITH_LEGEND()
Container(api, "API")
@enduml
`;
    const expected = src.indexOf("Container(api");
    const { model } = parseSource(src, FILE);
    expect(model.containers["api"].sourceLocation?.start.offset).toBe(expected);
    expect(model.containers["api"].sourceLocation?.file).toBe(FILE);
  });
});

describe("parseSource — canonical fixtures from .parser-refs/C4-PlantUML/samples", () => {
  const fixturesDir = path.join(
    __dirname,
    "../../../../.parser-refs/C4-PlantUML/samples",
  );

  const readFixture = (filename: string): string =>
    fs.readFileSync(path.join(fixturesDir, filename), "utf8");

  it("bigbankplc context: 4 containers, 4 relations, 0 parse errors", () => {
    const src = readFixture("C4_Context Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(Object.keys(result.model.containers).sort()).toEqual([
      "banking_system",
      "customer",
      "mail_system",
      "mainframe",
    ]);
    // Rel_Back(customer, mail_system) → mail_system → customer
    expect(result.model.containers["mail_system"].relations[0]?.to).toBe(
      "customer",
    );
  });

  it("bigbankplc container: System_Boundary with 5 children + standalone systems", () => {
    const src = readFixture("C4_Container Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.rootBoundaryNames).toEqual(["c1"]);
    expect(result.model.boundaries["c1"].containerNames.length).toBe(5);
    // External systems are siblings of the boundary, not inside it.
    expect(result.model.containers["email_system"].external).toBe(true);
    expect(result.model.containers["banking_system"].external).toBe(true);
  });

  it("techtribesjs: Lay_R does NOT produce a relation", () => {
    const src = readFixture("C4_Container Diagram Sample - techtribesjs.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    // Lay_R(rel_db, filesystem) — layout hint, no relation.
    expect(result.model.containers["rel_db"].relations).toEqual([]);
  });

  it("bigbankplc component: Container_Boundary with 4 Components + internal Rels", () => {
    const src = readFixture("C4_Component Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.boundaries["api"].kind).toBe("Container");
    expect([...result.model.boundaries["api"].containerNames].sort()).toEqual([
      "accounts",
      "mbsfacade",
      "security",
      "sign",
    ]);
    // sign → security relation declared inside the boundary block.
    const signRels = result.model.containers["sign"].relations.map((r) => r.to);
    expect(signRels).toEqual(["security"]);
  });

  // Full reference corpus pass — every in-scope fixture must produce
  // a populated Model with zero parse errors. Out-of-scope fixtures
  // (sequence diagrams, old-format Dynamic) are deliberately excluded.
  const IN_SCOPE_FIXTURES: readonly string[] = [
    "C4_Component Diagram Sample - bigbankplc.puml",
    "C4_Container Diagram Sample - bigbankplc-icons.puml",
    "C4_Container Diagram Sample - bigbankplc-styles.puml",
    "C4_Container Diagram Sample - bigbankplc-themes.puml",
    "C4_Container Diagram Sample - bigbankplc.puml",
    "C4_Container Diagram Sample - message bus.puml",
    "C4_Container Diagram Sample - techtribesjs.puml",
    "C4_Context Diagram Sample - bigbankplc-landscape.puml",
    "C4_Context Diagram Sample - bigbankplc.puml",
    "C4_Context Diagram Sample - enterprise.puml",
    "C4_Deployment Diagram Sample - bigbankplc-details.puml",
    "C4_Deployment Diagram Sample - bigbankplc.puml",
    "C4_Dynamic Diagram Sample - bigbankplc.puml",
    "C4_Dynamic Diagram Sample - message bus.puml",
  ];

  it.each(IN_SCOPE_FIXTURES)(
    "loads %s with zero parse errors and a populated Model",
    (filename) => {
      const src = readFixture(filename);
      const result = parseSource(src, FILE);
      expect(result.parseErrors).toEqual([]);
      // Every fixture has at least one Container (the deployment ones
      // surface their wrapped containers via preParse-strip — they
      // still leave standalone elements).
      expect(Object.keys(result.model.containers).length).toBeGreaterThan(0);
    },
  );

  // The two out-of-scope fixtures are pinned as "expected to fail" so
  // a regression in scope is visible (if a sequence fixture suddenly
  // starts passing, somebody added sequence grammar without a
  // grammar.md update).
  const OUT_OF_SCOPE_FIXTURES: readonly string[] = [
    "C4_Sequence Diagram Sample - bigbankplc.puml",
    "C4_Sequence Diagram Sample - complex.puml",
    "C4_Dynamic Diagram Sample - message bus - old format.puml",
  ];

  it.each(OUT_OF_SCOPE_FIXTURES)(
    "out-of-scope fixture %s produces parse errors but does not throw",
    (filename) => {
      const src = readFixture(filename);
      const result = parseSource(src, FILE);
      expect(result.parseErrors.length).toBeGreaterThan(0);
    },
  );
});
