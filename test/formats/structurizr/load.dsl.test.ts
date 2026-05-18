/**
 * `structurizrFormat.load(path/to/workspace.dsl)` reads Structurizr
 * DSL sources directly through the chevrotain parser. This file
 * covers the DSL dispatch path — the JSON path is exercised
 * exhaustively by `load.test.ts`.
 */
import path from "node:path";

import { load } from "../../../src/formats/structurizr/load";

const ECOMMERCE_DSL = path.resolve(
  __dirname,
  "../../../examples/ecommerce-structurizr/workspace.dsl",
);

describe("structurizrFormat.load — .dsl dispatch", () => {
  it("loads ecommerce workspace.dsl into a populated Model", async () => {
    const result = await load(ECOMMERCE_DSL);

    // Three internal systems (orders/inventory/fulfillment) each
    // gain a Boundary because they contain nested containers;
    // payment and notifications are leaf systems → Containers.
    // Model.containers keyed by DSL identifier (assignedIdentifier).
    expect(Object.keys(result.model.boundaries).sort()).toEqual([
      "fulfillment",
      "inventory",
      "orders",
    ]);
    expect(result.model.containers["payment"]?.kind).toBe("System");
    expect(result.model.containers["notifications"]?.kind).toBe("System");

    // Container kinds resolved by name (CRUD → repo tag, DB → kind
    // ContainerDb when technology heuristic kicks in)
    expect(result.model.containers["orders_api"]?.kind).toBe("Container");
    expect(result.model.containers["orders_db"]?.technology).toBe("PostgreSQL");

    // Explicit relationships preserved with description, technology,
    // and default `Relationship` tag. relation.to references DSL ids.
    const ordersApi = result.model.containers["orders_api"];
    expect(ordersApi?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: "orders_crud", description: "HTTP" }),
        expect.objectContaining({ to: "inventory_api", description: "HTTP" }),
        expect.objectContaining({
          to: "fulfillment_api",
          description: "HTTP",
        }),
      ]),
    );
  });

  it("throws with a readable message on DSL parse errors", async () => {
    // A `.dsl` file that doesn't exist — fs.readFile rejects, the
    // loader propagates. (Bad-syntax case is covered by parser-level
    // tests.)
    await expect(load("/nonexistent/path/workspace.dsl")).rejects.toThrow();
  });
});
