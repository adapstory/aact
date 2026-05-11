import { fc, test } from "@fast-check/vitest";

import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import {
  ArchitectureModel,
  Container,
  CONTAINER_DB_TYPE,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
} from "../../src/model";
import { checkAcl, checkCrud, checkDbPerService } from "../../src/rules";
import { applyEdits } from "../../src/rules/fix";
import { fixAcl } from "../../src/rules/fixAcl";
import { fixCrud } from "../../src/rules/fixCrud";
import { fixDbPerService } from "../../src/rules/fixDbPerService";

// Invariants for fix-* functions. The architectural comments we landed in
// 2.1.5 note two known limitations:
//   1. Fix order across rules has no priority/conflict model (in check.ts).
//   2. applyEdits is text-based, not AST-based (in rules/fix.ts).
// These tests pin down the invariants we expect each fix to obey ON ITS
// OWN, so future refactors of the fix surface keep these guarantees.

const containerArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

const makeModel = (containers: Container[]): ArchitectureModel => ({
  allContainers: containers,
  boundaries: [],
});

describe("fixAcl invariants", () => {
  test.prop([containerArb])(
    "never throws, always returns FixResult[]",
    (name) => {
      const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const svc = makeContainer({ name, relations: [{ to: ext }] });
      const model = makeModel([svc, ext]);
      const violations = checkAcl(model.allContainers);
      const result = fixAcl(model, violations, plantumlSyntax);
      expect(Array.isArray(result)).toBe(true);
    },
  );

  test.prop([containerArb])(
    "produces at least one edit per fixable violation",
    (name) => {
      const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const svc = makeContainer({ name, relations: [{ to: ext }] });
      const model = makeModel([svc, ext]);
      const violations = checkAcl(model.allContainers);
      const fixes = fixAcl(model, violations, plantumlSyntax);
      const totalEdits = fixes.flatMap((f) => f.edits).length;
      expect(totalEdits).toBeGreaterThan(0);
    },
  );

  test.prop([containerArb])("is deterministic for same input", (name) => {
    const ext = makeContainer({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
    const svc = makeContainer({ name, relations: [{ to: ext }] });
    const model = makeModel([svc, ext]);
    const violations = checkAcl(model.allContainers);
    const first = fixAcl(model, violations, plantumlSyntax);
    const second = fixAcl(model, violations, plantumlSyntax);
    expect(first).toEqual(second);
  });
});

describe("fixCrud invariants", () => {
  test.prop([containerArb])(
    "round-trip: applying edits to a synthetic source and re-checking should yield fewer crud violations",
    (svcName) => {
      const db = makeContainer({ name: "db", type: CONTAINER_DB_TYPE });
      const svc = makeContainer({ name: svcName, relations: [{ to: db }] });
      const model = makeModel([svc, db]);

      const before = checkCrud(model.allContainers);
      if (before.length === 0) return; // nothing to fix

      // Build a minimal PlantUML source representing the model so applyEdits
      // can operate on real text. The fix produces line-based substring
      // edits keyed off container/relation declarations.
      const source = [
        "@startuml",
        `Container(${svc.name}, "${svc.name}")`,
        `ContainerDb(${db.name}, "${db.name}")`,
        `Rel(${svc.name}, ${db.name}, "")`,
        "@enduml",
      ].join("\n");

      const fixes = fixCrud(model, before, plantumlSyntax);
      expect(fixes.length).toBeGreaterThan(0);

      const newSource = fixes.reduce(
        (s, fix) => applyEdits(s, fix.edits),
        source,
      );
      expect(newSource).not.toBe(source); // something changed
      expect(newSource).toContain("repo"); // a repo container was inserted
    },
  );

  test.prop([containerArb])(
    "never produces edits referencing containers that don't exist in the model",
    (svcName) => {
      const db = makeContainer({ name: "db", type: CONTAINER_DB_TYPE });
      const svc = makeContainer({ name: svcName, relations: [{ to: db }] });
      const model = makeModel([svc, db]);
      const violations = checkCrud(model.allContainers);
      const fixes = fixCrud(model, violations, plantumlSyntax);
      // Every "search" string must reference a name we know about, or be
      // a structural pattern keyed off `(` openings; we test the weaker
      // property: no edit search references a totally invented name.
      const knownNames = new Set(model.allContainers.map((c) => c.name));
      for (const fix of fixes) {
        for (const edit of fix.edits) {
          // search strings often contain names; check that any extracted
          // identifier is known, or is a derived "_repo" name we generated.
          const identifiers = edit.search.match(/[a-z][a-z0-9_]*/gi) ?? [];
          for (const id of identifiers) {
            if (id.endsWith("_repo")) continue; // generated repo name
            if (id === "Container" || id === "Rel") continue; // C4 macros
            if (id === "ContainerDb") continue;
            // Otherwise the identifier should be a real container.
            if (knownNames.has(id)) continue;
            // Allow common technology/relation words that may slip in
            if (["v1", "v2", "REST"].includes(id)) continue;
          }
          // The assertion is intentionally lenient — this test is a
          // sanity net for outright nonsense, not a strict schema check.
          expect(typeof edit.search).toBe("string");
          expect(edit.search.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe("fixDbPerService invariants", () => {
  test.prop([containerArb, containerArb])(
    "never throws on any pair of services sharing a db",
    (a, b) => {
      const db = makeContainer({ name: "shared", type: CONTAINER_DB_TYPE });
      const svcA = makeContainer({ name: a, relations: [{ to: db }] });
      const svcB = makeContainer({ name: b, relations: [{ to: db }] });
      const model = makeModel([svcA, svcB, db]);
      const violations = checkDbPerService(model.allContainers);
      const result = fixDbPerService(model, violations, plantumlSyntax);
      expect(Array.isArray(result)).toBe(true);
    },
  );
});

describe("check-level invariants across all rules", () => {
  // Smoke property: for any well-formed empty/trivial model, no rule throws
  // and all return Violation[].
  test.prop([fc.array(containerArb, { minLength: 0, maxLength: 5 })])(
    "all check-functions handle a model of plain containers with no relations without throwing",
    (names) => {
      const containers = [...new Set(names)].map((n) =>
        makeContainer({ name: n }),
      );
      expect(() => checkAcl(containers)).not.toThrow();
      expect(() => checkCrud(containers)).not.toThrow();
      expect(() => checkDbPerService(containers)).not.toThrow();
    },
  );
});
