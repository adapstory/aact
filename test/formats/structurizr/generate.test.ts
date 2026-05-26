import { generate } from "../../../src/formats/structurizr/generate";
import { parseSource } from "../../../src/formats/structurizr/parser";
import { buildModel } from "../../../src/model";

const emit = (model: Parameters<typeof generate>[0]) =>
  generate(model).files[0].content;

const roundTrip = (dsl: string) => {
  const first = parseSource(dsl, "in.dsl");
  expect(first.parseErrors).toEqual([]);
  const emitted = emit(first.model);
  const second = parseSource(emitted, "out.dsl");
  expect(second.parseErrors).toEqual([]);
  return { first, emitted, second };
};

describe("Structurizr generator — workspace header", () => {
  it("emits a bare workspace + model when no metadata", () => {
    const { model } = buildModel({
      elements: [],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain("workspace {");
    expect(out).toContain("model {");
  });

  it("includes name + description positionals when present", () => {
    const { model } = buildModel({
      elements: [],
      boundaries: [],
      rootBoundaryNames: [],
      workspace: { name: "Big Bank", description: "Demo" },
    });
    const out = emit(model);
    expect(out).toContain('workspace "Big Bank" "Demo" {');
  });

  it("emits `extends` after positionals", () => {
    const { model } = buildModel({
      elements: [],
      boundaries: [],
      rootBoundaryNames: [],
      workspace: {
        name: "X",
        description: "Y",
        extendsTarget: "https://example/base.dsl",
      },
    });
    const out = emit(model);
    expect(out).toMatch(
      /workspace "X" "Y" extends "https:\/\/example\/base\.dsl" \{/,
    );
  });
});

describe("Structurizr generator — elements", () => {
  it("emits leaf elements with bare assignment form", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "alice",
          label: "Alice",
          kind: "Person",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toMatch(/alice = person "Alice"/);
  });

  it("emits a body block when description / technology / tags present", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "api",
          label: "API",
          kind: "Container",
          external: false,
          description: "Customer-facing API",
          technology: "Spring Boot",
          tags: ["Application"],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain('api = container "API" {');
    expect(out).toContain('description "Customer-facing API"');
    expect(out).toContain('technology "Spring Boot"');
    expect(out).toContain('tags "Application"');
  });

  it("emits external systems with the External tag", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "stripe",
          label: "Stripe",
          kind: "System",
          external: true,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain('tags "External"');
  });

  it("emits properties { ... } and perspectives { ... } separately", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "api",
          label: "API",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
          properties: {
            "custom.key": "value",
            "perspective.Security": "encrypted in transit",
            "perspective.Security.value": "TLS",
          },
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain("properties {");
    expect(out).toContain('"custom.key" "value"');
    expect(out).toContain("perspectives {");
    expect(out).toContain('Security "encrypted in transit" "TLS"');
  });
});

describe("Structurizr generator — boundaries", () => {
  it("nests child elements inside softwareSystem boundary", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "api",
          label: "API",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
        {
          name: "db",
          label: "DB",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [
        {
          name: "bank",
          label: "Bank",
          kind: "System",
          tags: [],
          elementNames: ["api", "db"],
          boundaryNames: [],
        },
      ],
      rootBoundaryNames: ["bank"],
    });
    const out = emit(model);
    expect(out).toContain('bank = softwareSystem "Bank" {');
    expect(out).toContain('api = container "API"');
    expect(out).toContain('db = container "DB"');
    // Element decls appear AFTER boundary open line.
    expect(out.indexOf("bank =")).toBeLessThan(out.indexOf("api ="));
  });
});

describe("Structurizr generator — relationships", () => {
  it("emits explicit relations at model scope", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "api",
          label: "API",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [{ to: "db", description: "reads/writes", tags: [] }],
        },
        {
          name: "db",
          label: "DB",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain('api -> db "reads/writes"');
  });

  it("emits technology positional only when set, with description placeholder", () => {
    const { model } = buildModel({
      elements: [
        {
          name: "a",
          label: "A",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [{ to: "b", technology: "HTTPS", tags: [] }],
        },
        {
          name: "b",
          label: "B",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const out = emit(model);
    expect(out).toContain('a -> b "" "HTTPS"');
  });
});

describe("Structurizr generator — round-trip parity", () => {
  it("simple workspace + nested system survives round-trip", () => {
    const dsl = `workspace "Demo" "Round-trip test" {
      model {
        bank = softwareSystem "Bank" {
          api = container "API" "Customer-facing API" "Spring Boot"
          db = container "Database" "" "PostgreSQL"
          api -> db "reads/writes"
        }
        customer = person "Customer"
        customer -> bank "uses"
      }
    }`;
    const { first, second } = roundTrip(dsl);
    expect(second.model.workspace).toEqual(first.model.workspace);
    expect(Object.keys(second.model.elements).sort()).toEqual(
      Object.keys(first.model.elements).sort(),
    );
    expect(Object.keys(second.model.boundaries).sort()).toEqual(
      Object.keys(first.model.boundaries).sort(),
    );
    const apiFirst = first.model.elements["api"];
    const apiSecond = second.model.elements["api"];
    expect(apiSecond?.label).toBe(apiFirst?.label);
    expect(apiSecond?.description).toBe(apiFirst?.description);
    expect(apiSecond?.technology).toBe(apiFirst?.technology);
    // Tags: round-trip preserves the set (modulo default-tag set
    // which is identical on both sides).
    expect([...apiSecond.tags].sort()).toEqual([...apiFirst.tags].sort());
  });

  it("perspectives survive round-trip via reconstructed perspectives { } block", () => {
    const dsl = `workspace {
      model {
        s = softwareSystem "S" {
          api = container "API" {
            perspectives {
              Security "encrypted in transit" "TLS 1.3"
              Scalability "horizontal scaling"
            }
          }
        }
      }
    }`;
    const { first, second } = roundTrip(dsl);
    const apiFirst = first.model.elements["api"];
    const apiSecond = second.model.elements["api"];
    expect(apiSecond?.properties?.["perspective.Security"]).toBe(
      apiFirst?.properties?.["perspective.Security"],
    );
    expect(apiSecond?.properties?.["perspective.Security.value"]).toBe(
      apiFirst?.properties?.["perspective.Security.value"],
    );
    expect(apiSecond?.properties?.["perspective.Scalability"]).toBe(
      apiFirst?.properties?.["perspective.Scalability"],
    );
  });

  it("external systems survive round-trip via External tag", () => {
    const dsl = `workspace {
      model {
        stripe = softwareSystem "Stripe" {
          tags "External"
        }
      }
    }`;
    const { first, second } = roundTrip(dsl);
    expect(second.model.elements["stripe"]?.external).toBe(
      first.model.elements["stripe"]?.external,
    );
    expect(second.model.elements["stripe"]?.external).toBe(true);
  });
});
