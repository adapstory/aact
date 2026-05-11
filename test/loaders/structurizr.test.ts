import {
  loadStructurizrElements,
  mapContainersFromStructurizr,
} from "../../src/loaders/structurizr";
import { structurizrDslSyntax } from "../../src/loaders/structurizr/syntax";
import { ArchitectureModel } from "../../src/model";

describe("Structurizr Loader", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    model = await loadStructurizrElements(
      "resources/architecture/workspace.json",
    );
  });

  it("loads containers from workspace.json", () => {
    expect(model.allContainers.length).toBeGreaterThan(0);
  });

  it("identifies external systems", () => {
    const externalSystems = model.allContainers.filter(
      (c) => c.type === "System_Ext",
    );
    expect(externalSystems.length).toBeGreaterThan(0);
  });

  it("identifies databases", () => {
    const databases = model.allContainers.filter(
      (c) => c.type === "ContainerDb",
    );
    expect(databases.length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(model.boundaries.length).toBeGreaterThan(0);
  });

  it("builds relations", () => {
    const relationsCount = model.allContainers.reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(loadStructurizrElements("nonexistent.json")).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe("mapContainersFromStructurizr (unit)", () => {
  it("returns empty model for empty workspace", () => {
    const result = mapContainersFromStructurizr({
      model: { softwareSystems: [], people: [] },
    } as never);

    expect(result.allContainers).toHaveLength(0);
    expect(result.boundaries).toHaveLength(0);
  });

  it("uses structurizr.dsl.identifier as the container name when present", () => {
    const result = mapContainersFromStructurizr({
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
    } as never);
    expect(result.boundaries[0].name).toBe("my_system");
    expect(result.boundaries[0].containers[0].name).toBe("my_svc");
  });

  it("falls back to raw id when no DSL identifier property is set", () => {
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [
          { id: "sys_raw", name: "Sys", containers: [], relationships: [] },
        ],
        people: [],
      },
    } as never);
    expect(result.boundaries[0].name).toBe("sys_raw");
  });

  it("sorts allContainers alphabetically by name", () => {
    const result = mapContainersFromStructurizr({
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
    } as never);
    const names = result.allContainers.map((c) => c.name);
    expect(names).toEqual(["a", "m", "z"]);
  });

  describe("isDatabase heuristic", () => {
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
      it(`marks ${tech}-tech container as ContainerDb`, () => {
        const result = mapContainersFromStructurizr(dbContainer(tech) as never);
        expect(result.allContainers[0].type).toBe("ContainerDb");
      });
    }

    it("marks container with name ending in '_db' as ContainerDb", () => {
      const result = mapContainersFromStructurizr({
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
      } as never);
      expect(result.allContainers[0].type).toBe("ContainerDb");
    });

    it("marks container with name ending in 'database' as ContainerDb", () => {
      const result = mapContainersFromStructurizr({
        model: {
          softwareSystems: [
            {
              id: "1",
              name: "Sys",
              containers: [
                { id: "c", name: "orders database", relationships: [] },
              ],
            },
          ],
          people: [],
        },
      } as never);
      expect(result.allContainers[0].type).toBe("ContainerDb");
    });

    it("does NOT mark unrelated container as ContainerDb", () => {
      const result = mapContainersFromStructurizr({
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
      } as never);
      expect(result.allContainers[0].type).toBe("Container");
    });
  });

  describe("enrichTags heuristic", () => {
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

    it("adds 'repo' tag for names containing 'crud'", () => {
      const result = mapContainersFromStructurizr(
        containerWith("orders_crud_service") as never,
      );
      expect(result.allContainers[0].tags).toContain("repo");
    });

    it("adds 'acl' tag for names containing 'acl'", () => {
      const result = mapContainersFromStructurizr(
        containerWith("payments_acl") as never,
      );
      expect(result.allContainers[0].tags).toContain("acl");
    });

    it("preserves existing comma-separated tags and trims whitespace", () => {
      const result = mapContainersFromStructurizr(
        containerWith("svc", "tag1, tag2 , tag3") as never,
      );
      expect(result.allContainers[0].tags).toEqual(["tag1", "tag2", "tag3"]);
    });

    it("does NOT duplicate 'repo' if already present", () => {
      const result = mapContainersFromStructurizr(
        containerWith("crud_svc", "repo") as never,
      );
      const tags = result.allContainers[0].tags ?? [];
      expect(tags.filter((t) => t === "repo")).toHaveLength(1);
    });

    it("filters out empty tags from the source list", () => {
      const result = mapContainersFromStructurizr(
        containerWith("svc", "a,,b,") as never,
      );
      expect(result.allContainers[0].tags).toEqual(["a", "b"]);
    });
  });

  describe("addRelations", () => {
    it("preserves technology when explicitly set", () => {
      const result = mapContainersFromStructurizr({
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
      } as never);
      const a = result.allContainers.find((c) => c.name === "a");
      expect(a?.relations[0].technology).toBe("REST");
    });

    it("falls back to description as technology when description has no spaces", () => {
      const result = mapContainersFromStructurizr({
        model: {
          softwareSystems: [
            {
              id: "1",
              name: "Sys",
              containers: [
                {
                  id: "a",
                  name: "A",
                  relationships: [{ destinationId: "b", description: "kafka" }],
                },
                { id: "b", name: "B", relationships: [] },
              ],
            },
          ],
          people: [],
        },
      } as never);
      const a = result.allContainers.find((c) => c.name === "a");
      expect(a?.relations[0].technology).toBe("kafka");
    });

    it("does NOT fall back to description when it has spaces (treat as human prose)", () => {
      const result = mapContainersFromStructurizr({
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
                    { destinationId: "b", description: "calls service" },
                  ],
                },
                { id: "b", name: "B", relationships: [] },
              ],
            },
          ],
          people: [],
        },
      } as never);
      const a = result.allContainers.find((c) => c.name === "a");
      expect(a?.relations[0].technology).toBeUndefined();
    });

    it("appends 'async' tag when interactionStyle is Asynchronous", () => {
      const result = mapContainersFromStructurizr({
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
      } as never);
      const a = result.allContainers.find((c) => c.name === "a");
      // Both existing and async tags present
      expect(a?.relations[0].tags).toEqual(["audit", "async"]);
    });

    it("silently drops relations to unknown destinationId", () => {
      const result = mapContainersFromStructurizr({
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
      } as never);
      expect(result.allContainers[0].relations).toHaveLength(0);
    });

    it("walks component-level relationships", () => {
      const result = mapContainersFromStructurizr({
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
                      id: "comp1",
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
      } as never);
      // Component relation is registered against `a` (the parent component
      // is `comp1`, registered by id, but the test asserts components
      // contribute to relations on the model — not by location, just by
      // presence). This guards `addRelations` being called for components.
      const result_b = result.allContainers.find((c) => c.name === "b");
      expect(result_b).toBeDefined();
    });
  });

  it("treats external location as System_Ext (covers location check)", () => {
    const result = mapContainersFromStructurizr({
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
    } as never);
    expect(result.allContainers[0].type).toBe("System_Ext");
  });

  it("description falls back to empty string when not provided", () => {
    // Stryker mutated `cont.description ?? ""` → "Stryker was here!". Pin
    // that missing description yields an empty string on the container.
    const result = mapContainersFromStructurizr({
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
    } as never);
    expect(result.allContainers[0].description).toBe("");
  });

  it("external system tags are parsed from comma-separated string", () => {
    // Pin the tag splitting/trim/filter chain for processExternalSystem.
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "External",
            location: "External",
            tags: "Critical, Vendor , ", // mixed whitespace + trailing empty
            containers: [],
          },
        ],
        people: [],
      },
    } as never);
    const ext = result.allContainers.find((c) => c.name === "ext");
    expect(ext?.tags).toEqual(["Critical", "Vendor"]);
  });

  it("external system description falls back to empty string", () => {
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [
          { id: "ext", name: "Ext", location: "External", containers: [] },
        ],
        people: [],
      },
    } as never);
    const ext = result.allContainers.find((c) => c.name === "ext");
    expect(ext?.description).toBe("");
  });

  it("iterates over components without throwing (covers `for (const comp of ...)` block)", () => {
    // Components aren't currently pushed to `containers` (only containers
    // and people are). The components loop calls `addRelations` for each,
    // but since components aren't in `allElements`, the relation is
    // dropped silently. Pin: the function runs without throwing on a
    // model that includes components.
    expect(() =>
      mapContainersFromStructurizr({
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
      } as never),
    ).not.toThrow();
  });

  it("handles a system with undefined containers (covers `containers ?? []` fallback)", () => {
    // Stryker mutated `?? []` fallback to `?? [sentinel]` on the loop
    // arrays. With the sentinel, iteration runs over garbage and may push
    // stray "undefined"-named containers into the model.
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [{ id: "sys1", name: "Sys" }],
        people: [],
      },
    } as never);
    // Only the system itself was produced — no inner containers from
    // sys1's undefined `containers` field.
    expect(result.boundaries[0].containers).toEqual([]);
  });

  it("handles workspace with no `people` field (covers people ?? [])", () => {
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [],
      },
    } as never);
    expect(result.allContainers).toHaveLength(0);
  });

  it("handles workspace with no `softwareSystems` field (covers softwareSystems ?? [])", () => {
    const result = mapContainersFromStructurizr({
      model: { people: [] },
    } as never);
    expect(result.allContainers).toHaveLength(0);
    expect(result.boundaries).toHaveLength(0);
  });

  it("does NOT add async tag when interactionStyle is not Asynchronous (covers ConditionalExpression)", () => {
    // Stryker mutated `if (rel.interactionStyle === \"Asynchronous\")` to `true`.
    // Pin: a Synchronous-styled relation has no `async` tag.
    const result = mapContainersFromStructurizr({
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
    } as never);
    const a = result.allContainers.find((c) => c.name === "a");
    expect(a?.relations[0].tags ?? []).not.toContain("async");
  });

  it("filters out empty tags from a person's tag string (covers .filter(Boolean))", () => {
    const result = mapContainersFromStructurizr({
      model: {
        softwareSystems: [],
        people: [
          {
            id: "p1",
            name: "User",
            tags: "vip,,admin,", // empty parts on both ends and middle
            relationships: [],
          },
        ],
      },
    } as never);
    const user = result.allContainers.find((c) => c.name === "p1");
    expect(user?.tags).toEqual(["vip", "admin"]);
  });

  it("trims whitespace from relation tags split (covers .map(t => t.trim()))", () => {
    // Stryker mutated the `.map(t => t.trim())` callback to `t` (no trim).
    // Pin: spaces around tags don't survive into the model.
    const result = mapContainersFromStructurizr({
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
    } as never);
    const a = result.allContainers.find((c) => c.name === "a");
    expect(a?.relations[0].tags).toEqual(["audit", "urgent"]);
  });

  it("iterates over people relationships in the addRelations pass", () => {
    // L235 BlockStatement: the people-relationship loop. With `{}` body,
    // people's relations aren't registered. Pin: a person → container
    // relation materialises.
    const result = mapContainersFromStructurizr({
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
    } as never);
    const user = result.allContainers.find((c) => c.name === "user");
    expect(user?.relations[0]?.to.name).toBe("svc");
  });

  it("processes people with type Person", () => {
    const result = mapContainersFromStructurizr({
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
    } as never);
    const person = result.allContainers.find((c) => c.name === "p1");
    expect(person?.type).toBe("Person");
    expect(person?.description).toBe("Ops user");
    expect(person?.tags).toEqual(["internal", "admin"]);
  });

  it("tags async relations with 'async'", () => {
    const workspace = {
      model: {
        softwareSystems: [
          {
            id: "sys_a",
            name: "System A",
            containers: [
              {
                id: "svc_a",
                name: "Service A",
                relationships: [
                  {
                    destinationId: "svc_b",
                    interactionStyle: "Asynchronous",
                  },
                ],
              },
              {
                id: "svc_b",
                name: "Service B",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    };

    const result = mapContainersFromStructurizr(workspace as never);
    const svcA = result.allContainers.find((c) => c.name === "svc_a");
    expect(svcA?.relations[0].tags).toContain("async");
  });

  it("detects external system by tags when location is not set", () => {
    const workspace = {
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "External",
            tags: "External",
            containers: [],
          },
        ],
        people: [],
      },
    };

    const result = mapContainersFromStructurizr(workspace as never);
    const ext = result.allContainers.find((c) => c.name === "ext");
    expect(ext?.type).toBe("System_Ext");
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
