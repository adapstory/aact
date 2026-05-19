import type {
  CheckData,
  CheckViolation,
} from "../../../src/cli/commands/check";
import { checkSarifAdapter } from "../../../src/cli/commands/checkSarif";
import type { CliEnvelope } from "../../../src/cli/output";
import { ruleRegistry } from "../../../src/rules/registry";

const envelopeWith = (
  violations: readonly CheckViolation[],
): CliEnvelope<CheckData> => ({
  schemaVersion: 1,
  command: "check",
  ok: violations.length === 0,
  exitCode: violations.length === 0 ? 0 : 1,
  data: {
    mode: "check",
    violations,
    suggestedFixes: [],
    summary: { failed: 0, passed: 0, total: 0 },
  },
  diagnostics: [],
  meta: {
    aactVersion: "3.0.0-test",
    durationMs: 1,
    configPath: null,
    source: "arch.puml",
  },
});

const baseViolation: CheckViolation = {
  rule: "crud",
  target: "orders",
  targetKind: "element",
  message: "directly accesses database orders_db",
  severity: "error",
  sourceLocation: {
    file: "/abs/arch.puml",
    start: { line: 13, col: 1, offset: 200 },
    end: { line: 13, col: 37, offset: 236 },
  },
};

describe("checkSarifAdapter — top-level shape", () => {
  it("emits SARIF v2.1.0 with informationUri and aactVersion from envelope meta", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    const driver = log.runs[0].tool.driver;
    expect(driver.name).toBe("aact");
    expect(driver.version).toBe("3.0.0-test");
    expect(driver.informationUri).toContain("github.com/Byndyusoft/aact");
  });

  it("lists every built-in rule in tool.driver.rules with description + helpUri", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    const rules = log.runs[0].tool.driver.rules ?? [];
    expect(rules).toHaveLength(ruleRegistry.length);
    const acl = rules.find((r) => r.id === "acl");
    expect(acl?.name).toBe("acl");
    expect(acl?.shortDescription?.text).toMatch(/ACL/);
    expect(acl?.helpUri).toContain("#acl");
  });
});

describe("checkSarifAdapter — results mapping", () => {
  it("maps a violation to a SARIF result with level=error and ruleIndex resolved", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const [result] = log.runs[0].results;
    expect(result.ruleId).toBe("crud");
    expect(result.level).toBe("error");
    expect(result.ruleIndex).toBe(
      ruleRegistry.findIndex((r) => r.name === "crud"),
    );
    expect(result.message.text).toContain("orders");
    expect(result.message.text).toContain("orders_db");
  });

  it("encodes sourceLocation as a full physicalLocation.region", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region).toEqual({
      startLine: 13,
      startColumn: 1,
      endLine: 13,
      endColumn: 37,
    });
  });

  it("uses artifactLocation.uri from the violation's sourceLocation.file", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    expect(
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("/abs/arch.puml");
  });

  it("falls back to startLine=1 / uri='unknown' when violation has no sourceLocation", () => {
    const withoutLoc: CheckViolation = {
      rule: "acl",
      target: "svc",
      targetKind: "element",
      message: "no location",
      severity: "error",
    };
    const log = checkSarifAdapter(envelopeWith([withoutLoc]));
    const [result] = log.runs[0].results;
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "unknown",
    );
    expect(result.locations[0].physicalLocation.region).toEqual({
      startLine: 1,
    });
  });

  it("carries targetKind into properties for boundary-level violations", () => {
    const boundaryViolation: CheckViolation = {
      ...baseViolation,
      rule: "cohesion",
      target: "checkout",
      targetKind: "boundary",
      message: "boundary coupling > cohesion",
    };
    const log = checkSarifAdapter(envelopeWith([boundaryViolation]));
    expect(log.runs[0].results[0].properties).toEqual({
      targetKind: "boundary",
    });
  });

  it("omits ruleIndex for unknown (custom-rule) ids but keeps ruleId", () => {
    const customViolation: CheckViolation = {
      ...baseViolation,
      rule: "acmeBcIsolation",
    };
    const log = checkSarifAdapter(envelopeWith([customViolation]));
    const [result] = log.runs[0].results;
    expect(result.ruleId).toBe("acmeBcIsolation");
    expect(result.ruleIndex).toBeUndefined();
  });

  it("emits a stable partialFingerprint (rule+target+message hashed, location-agnostic)", () => {
    // Pin: shifting the source location must NOT change the fingerprint.
    // GitHub Code Scanning uses fingerprints to keep alerts continuous
    // across edits.
    const moved: CheckViolation = {
      ...baseViolation,
      sourceLocation: {
        file: "/abs/arch.puml",
        start: { line: 99, col: 1, offset: 9000 },
        end: { line: 99, col: 37, offset: 9036 },
      },
    };
    const a = checkSarifAdapter(envelopeWith([baseViolation]));
    const b = checkSarifAdapter(envelopeWith([moved]));
    expect(a.runs[0].results[0].partialFingerprints).toEqual(
      b.runs[0].results[0].partialFingerprints,
    );
  });

  it("returns an empty results[] when there are no violations", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    expect(log.runs[0].results).toEqual([]);
  });
});
