import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import path from "pathe";

import { load } from "../../../src/formats/structurizr/load";
import { structurizrDslSyntax } from "../../../src/formats/structurizr/syntax";
import type { Model } from "../../../src/model";
import { allContainers, getContainer } from "../../../src/model";

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "aact-struct-"));
});

let counter = 0;
const loadWorkspace = async (workspace: unknown): Promise<Model> => {
  const file = path.join(tmpDir, `workspace-${counter++}.json`);
  await writeFile(file, JSON.stringify(workspace), "utf8");
  const result = await load(file);
  return result.model;
};

describe("structurizr load — fixture", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/workspace.json");
    model = result.model;
  });

  it("loads containers from workspace.json", () => {
    expect(allContainers(model).length).toBeGreaterThan(0);
  });

  it("identifies external systems (kind=System + external=true)", () => {
    const externalSystems = allContainers(model).filter(
      (c) => c.kind === "System" && c.external,
    );
    expect(externalSystems.length).toBeGreaterThan(0);
  });

  it("identifies databases", () => {
    const databases = allContainers(model).filter(
      (c) => c.kind === "ContainerDb",
    );
    expect(databases.length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(Object.values(model.boundaries).length).toBeGreaterThan(0);
  });

  it("builds relations", () => {
    const relationsCount = allContainers(model).reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(load("nonexistent.json")).rejects.toThrow(/ENOENT/);
  });
});

describe("structurizr load — DSL identifier", () => {
  it("returns empty model for empty workspace", async () => {
    const model = await loadWorkspace({
      model: { softwareSystems: [], people: [] },
    });
    expect(allContainers(model)).toHaveLength(0);
    expect(Object.values(model.boundaries)).toHaveLength(0);
  });

  it("stores structurizr.dsl.identifier in properties for round-trip", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            properties: { "structurizr.dsl.identifier": "my_system" },
            containers: [
              {
                id: "2",
                name: "Svc",
                properties: { "structurizr.dsl.identifier": "my_svc" },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(model.boundaries.Sys).toBeDefined();
    expect(model.boundaries.Sys?.containerNames).toContain("Svc");
    expect(model.boundaries.Sys?.properties).toMatchObject({
      "structurizr.dsl.identifier": "my_system",
    });
    expect(getContainer(model, "Svc")?.properties).toMatchObject({
      "structurizr.dsl.identifier": "my_svc",
    });
  });

  it("falls back to raw id as DSL identifier when property is not set", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          { id: "sys_raw", name: "Sys", containers: [], relationships: [] },
        ],
        people: [],
      },
    });
    expect(model.boundaries.Sys).toBeDefined();
    expect(model.boundaries.Sys?.properties).toMatchObject({
      "structurizr.dsl.identifier": "sys_raw",
    });
  });

  it("model.containers Record is sorted alphabetically", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              { id: "z", name: "Z", relationships: [] },
              { id: "a", name: "A", relationships: [] },
              { id: "m", name: "M", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(Object.keys(model.containers)).toEqual(["A", "M", "Z"]);
  });
});

describe("structurizr load — kind inference from technology", () => {
  const dbContainer = (technology: string, name = "svc") => ({
    model: {
      softwareSystems: [
        {
          id: "1",
          name: "Sys",
          containers: [{ id: "c", name, technology, relationships: [] }],
        },
      ],
      people: [],
    },
  });

  for (const tech of ["PostgreSQL", "MySQL", "Redis", "MongoDB"]) {
    it(`marks ${tech}-tech container as ContainerDb`, async () => {
      const model = await loadWorkspace(dbContainer(tech));
      expect(getContainer(model, "svc")?.kind).toBe("ContainerDb");
    });
  }

  it("marks container with name ending in '_db' as ContainerDb", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [{ id: "c", name: "orders_db", relationships: [] }],
          },
        ],
        people: [],
      },
    });
    // Container.name = display name "orders_db".
    // inferKindFromTechnology checks label/name suffix.
    expect(getContainer(model, "orders_db")?.kind).toBe("ContainerDb");
  });

  it("marks container with name ending in 'database' as ContainerDb", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "c",
            name: "1",
            containers: [
              { id: "x", name: "orders database", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "orders database")?.kind).toBe("ContainerDb");
  });

  it("does NOT mark unrelated container as ContainerDb", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "orders_api",
                technology: "Spring",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "orders_api")?.kind).toBe("Container");
  });
});

describe("structurizr load — tags parsing", () => {
  const containerWith = (name: string, tags?: string) => ({
    model: {
      softwareSystems: [
        {
          id: "1",
          name: "Sys",
          containers: [{ id: "c", name, tags, relationships: [] }],
        },
      ],
      people: [],
    },
  });

  it("preserves explicit comma-separated tags trimmed", async () => {
    const model = await loadWorkspace(
      containerWith("svc", "tag1, tag2 , tag3"),
    );
    expect(getContainer(model, "svc")?.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("filters out empty tags from the source list", async () => {
    const model = await loadWorkspace(containerWith("svc", "a,,b,"));
    expect(getContainer(model, "svc")?.tags).toEqual(["a", "b"]);
  });

  it("v3 NO LONGER enriches tags from names (crud→repo, acl→acl)", async () => {
    // v2 had enrichTagsFromNames heuristic — Solution Architects now tag
    // explicitly. Container with label "orders_crud_service" must NOT get
    // an auto-tag "repo".
    const model = await loadWorkspace(containerWith("orders_crud_service"));
    expect(getContainer(model, "orders_crud_service")?.tags).toEqual([]);
  });
});

describe("structurizr load — relations", () => {
  it("preserves technology when explicitly set", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    technology: "REST",
                    description: "calls",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].technology).toBe("REST");
  });

  it("appends 'async' tag when interactionStyle is Asynchronous", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    tags: "audit",
                    interactionStyle: "Asynchronous",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].tags).toEqual([
      "audit",
      "async",
    ]);
  });

  it("does NOT append 'async' when interactionStyle is Synchronous", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  { destinationId: "b", interactionStyle: "Synchronous" },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].tags).not.toContain("async");
  });

  it("dangling destinationId surfaces in issues (no throw)", async () => {
    const file = path.join(tmpDir, "dangling.json");
    await writeFile(
      file,
      JSON.stringify({
        model: {
          softwareSystems: [
            {
              id: "1",
              name: "Sys",
              containers: [
                {
                  id: "a",
                  name: "A",
                  relationships: [{ destinationId: "ghost" }],
                },
              ],
            },
          ],
          people: [],
        },
      }),
      "utf8",
    );
    const result = await load(file);
    expect(allContainers(result.model)).toHaveLength(1);
  });

  it("trims whitespace from relation tags", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  { destinationId: "b", tags: "  audit , urgent  " },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].tags).toEqual([
      "audit",
      "urgent",
    ]);
  });
});

describe("structurizr load — external systems", () => {
  it("treats `location: External` as kind=System + external=true", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "External",
            location: "External",
            containers: [],
          },
        ],
        people: [],
      },
    });
    const ext = getContainer(model, "External");
    expect(ext?.kind).toBe("System");
    expect(ext?.external).toBe(true);
  });

  it("detects external system by tags containing 'External'", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          { id: "ext", name: "External", tags: "External", containers: [] },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "External")?.external).toBe(true);
  });

  it("external system tags parse from comma-separated string", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "External",
            location: "External",
            tags: "Critical, Vendor , ",
            containers: [],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "External")?.tags).toEqual([
      "Critical",
      "Vendor",
    ]);
  });

  it("external system description falls back to empty string", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          { id: "ext", name: "Ext", location: "External", containers: [] },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Ext")?.description).toBe("");
  });
});

describe("structurizr load — defaults & resilience", () => {
  it("description falls back to empty string when not provided", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [{ id: "c", name: "svc", relationships: [] }],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "svc")?.description).toBe("");
  });

  it("does NOT throw on components (v3 silently drops them)", async () => {
    await expect(
      loadWorkspace({
        model: {
          softwareSystems: [
            {
              id: "1",
              name: "Sys",
              containers: [
                {
                  id: "a",
                  name: "A",
                  components: [
                    {
                      id: "comp",
                      name: "Comp",
                      relationships: [{ destinationId: "b" }],
                    },
                  ],
                  relationships: [],
                },
                { id: "b", name: "B", relationships: [] },
              ],
            },
          ],
          people: [],
        },
      }),
    ).resolves.toBeDefined();
  });

  it("handles a system with undefined containers", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [{ id: "sys1", name: "Sys" }],
        people: [],
      },
    });
    expect(model.boundaries.Sys?.containerNames).toEqual([]);
  });

  it("handles workspace with no `people` field", async () => {
    const model = await loadWorkspace({
      model: { softwareSystems: [] },
    });
    expect(allContainers(model)).toHaveLength(0);
  });

  it("handles workspace with no `softwareSystems` field", async () => {
    const model = await loadWorkspace({ model: { people: [] } });
    expect(allContainers(model)).toHaveLength(0);
    expect(Object.values(model.boundaries)).toHaveLength(0);
  });
});

describe("structurizr load — people", () => {
  it("filters out empty tags from a person's tag string", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [],
        people: [
          {
            id: "p1",
            name: "User",
            tags: "vip,,admin,",
            relationships: [],
          },
        ],
      },
    });
    expect(getContainer(model, "User")?.tags).toEqual(["vip", "admin"]);
  });

  it("processes people as kind=Person", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [],
        people: [
          {
            id: "p1",
            name: "Operator",
            description: "Ops user",
            tags: "internal,admin",
            relationships: [],
          },
        ],
      },
    });
    const person = getContainer(model, "Operator");
    expect(person?.kind).toBe("Person");
    expect(person?.description).toBe("Ops user");
    expect(person?.tags).toEqual(["internal", "admin"]);
  });

  it("registers person → container relationship", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [{ id: "svc", name: "Svc", relationships: [] }],
          },
        ],
        people: [
          {
            id: "user",
            name: "User",
            relationships: [{ destinationId: "svc" }],
          },
        ],
      },
    });
    // Relation target = display name of destinationId = "Svc".
    expect(getContainer(model, "User")?.relations[0].to).toBe("Svc");
  });
});

describe("structurizr load — properties forwarding", () => {
  it("preserves arbitrary string properties on container", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                properties: { archetype: "Microservice", owner: "team-a" },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toEqual({
      archetype: "Microservice",
      owner: "team-a",
      "structurizr.dsl.identifier": "c",
    });
  });

  it("filters out non-string property values (toProperties typeof check)", async () => {
    // Pin the `typeof entry[1] === "string"` filter — non-string values
    // (numbers, nested objects from LikeC4) must NOT leak through.
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                properties: {
                  good: "value",
                  numeric: 42, // runtime filter drops non-strings
                  nested: { key: "val" }, // same
                },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toEqual({
      good: "value",
      "structurizr.dsl.identifier": "c",
    });
  });

  it("always carries structurizr.dsl.identifier even with no user properties", async () => {
    // v3 contract: properties bag is never undefined for elements — at minimum
    // it holds `structurizr.dsl.identifier` so the fix layer can round-trip.
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [{ id: "c", name: "Svc", relationships: [] }],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toEqual({
      "structurizr.dsl.identifier": "c",
    });
  });

  it("falls back to dsl.identifier only when all user props filter out", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                properties: {
                  bad: 42, // non-string, gets filtered → entries empty
                },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toEqual({
      "structurizr.dsl.identifier": "c",
    });
  });
});

describe("structurizr load — relation field preservation", () => {
  it("preserves rel.description as relation.description", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    description: "calls",
                    technology: "REST",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].description).toBe("calls");
  });

  it("description=undefined when not provided in rel", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [{ destinationId: "b" }],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].description).toBeUndefined();
  });
});

describe("structurizr load — boundary metadata", () => {
  it("preserves boundary tags from system tags", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            tags: "domain, public",
            containers: [],
          },
        ],
        people: [],
      },
    });
    expect(model.boundaries.Sys?.tags).toEqual(["domain", "public"]);
  });

  it("internal SoftwareSystem relationships are silently dropped (documented limitation)", async () => {
    // Pin documented behavior: relations on internal SoftwareSystem are NOT
    // pushed into the resulting Boundary (it has no relations). Otherwise
    // we'd silently produce data not in v3 Model contract.
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "sys_a",
            name: "Sys A",
            relationships: [{ destinationId: "sys_b" }],
            containers: [],
          },
          {
            id: "sys_b",
            name: "Sys B",
            containers: [],
          },
        ],
        people: [],
      },
    });
    expect(allContainers(model)).toHaveLength(0);
    expect(model.boundaries["Sys A"]?.containerNames).toEqual([]);
  });

  it("multiple internal SoftwareSystems each become a root boundary", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "alpha",
            name: "Alpha",
            containers: [{ id: "a1", name: "A1", relationships: [] }],
          },
          {
            id: "beta",
            name: "Beta",
            containers: [{ id: "b1", name: "B1", relationships: [] }],
          },
        ],
        people: [],
      },
    });
    expect(model.rootBoundaryNames).toContain("Alpha");
    expect(model.rootBoundaryNames).toContain("Beta");
  });
});

describe("structurizr load — F2 fidelity (url, group, perspectives)", () => {
  it("Container.url → Container.link", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                url: "https://wiki.example.com/svc",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.link).toBe(
      "https://wiki.example.com/svc",
    );
  });

  it("Person.url → Person.link", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [],
        people: [
          {
            id: "u",
            name: "User",
            url: "https://hr.example.com/u",
            relationships: [],
          },
        ],
      },
    });
    expect(getContainer(model, "User")?.link).toBe("https://hr.example.com/u");
  });

  it("Internal SoftwareSystem.url → Boundary.link", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            url: "https://wiki.example.com/sys",
            containers: [],
          },
        ],
        people: [],
      },
    });
    expect(model.boundaries.Sys?.link).toBe("https://wiki.example.com/sys");
  });

  it("External SoftwareSystem.url → Container.link", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "Ext",
            location: "External",
            url: "https://api.external.com",
            containers: [],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Ext")?.link).toBe("https://api.external.com");
  });

  it("Relation.url → Relation.link", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    url: "https://api.example.com/v1",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].link).toBe(
      "https://api.example.com/v1",
    );
  });

  it("Container.group → Container.properties.group", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                group: "platform-team",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toMatchObject({
      group: "platform-team",
    });
  });

  it("Container.perspectives → properties.perspective.<name>", async () => {
    // Solution Architect use case — security/scalability views на одной модели.
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "c",
                name: "Svc",
                perspectives: {
                  Security: {
                    description: "Sensitive PII data",
                    value: "high",
                  },
                  Performance: { description: "Read-heavy workload" },
                },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "Svc")?.properties).toMatchObject({
      "perspective.Security": "Sensitive PII data",
      "perspective.Security.value": "high",
      "perspective.Performance": "Read-heavy workload",
    });
  });

  it("Relation.properties → Relation.properties (full pass-through)", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    properties: {
                      sla: "99.9",
                      protocol: "https",
                    },
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].properties).toMatchObject({
      sla: "99.9",
      protocol: "https",
    });
  });

  it("Relation.perspectives → Relation.properties.perspective.<name>", async () => {
    const model = await loadWorkspace({
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    perspectives: {
                      Security: { description: "Uses TLS 1.3" },
                    },
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });
    expect(getContainer(model, "A")?.relations[0].properties).toMatchObject({
      "perspective.Security": "Uses TLS 1.3",
    });
  });
});

describe("structurizrDslSyntax helpers", () => {
  it("containerPattern returns DSL assignment prefix", () => {
    expect(structurizrDslSyntax.containerPattern("orders")).toBe(
      "orders = container",
    );
  });

  it("containerDecl without tags emits a single-line declaration", () => {
    expect(structurizrDslSyntax.containerDecl("orders", "Orders Service")).toBe(
      'orders = container "Orders Service"',
    );
  });

  it("containerDecl with tags emits a block with tags clause", () => {
    expect(
      structurizrDslSyntax.containerDecl("orders_acl", "Orders ACL", "acl"),
    ).toBe('orders_acl = container "Orders ACL" {\n    tags "acl"\n}');
  });

  it("relationPattern matches a `from -> to` arrow", () => {
    expect(structurizrDslSyntax.relationPattern("a", "b")).toBe("a -> b");
  });

  it("relationDecl emits technology in quotes when present", () => {
    expect(structurizrDslSyntax.relationDecl("a", "b", "REST")).toBe(
      'a -> b "REST"',
    );
  });

  it("relationDecl with tags appends a tags block", () => {
    expect(structurizrDslSyntax.relationDecl("a", "b", "REST", "async")).toBe(
      'a -> b "REST" {\n    tags "async"\n}',
    );
  });

  it("relationDecl tolerates missing technology", () => {
    expect(structurizrDslSyntax.relationDecl("a", "b")).toBe("a -> b");
  });
});
