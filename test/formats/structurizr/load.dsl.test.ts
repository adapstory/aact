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

    // Three internal systems (Orders/Inventory/Fulfillment) each
    // gain a Boundary because they contain nested containers;
    // Payment Provider and Notification Provider are leaf systems
    // → Containers with kind System.
    expect(Object.keys(result.model.boundaries).sort()).toEqual([
      "Fulfillment",
      "Inventory",
      "Orders",
    ]);
    expect(result.model.containers["Payment Provider"]?.kind).toBe("System");
    expect(result.model.containers["Notification Provider"]?.kind).toBe(
      "System",
    );

    // Container kinds resolved by name (CRUD → repo tag, DB → kind
    // ContainerDb when technology heuristic kicks in)
    expect(result.model.containers["Orders API"]?.kind).toBe("Container");
    expect(result.model.containers["Orders DB"]?.technology).toBe("PostgreSQL");

    // Explicit relationships preserved with description, technology,
    // and default `Relationship` tag
    const ordersApi = result.model.containers["Orders API"];
    expect(ordersApi?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "Orders CRUD",
          description: "HTTP",
        }),
        expect.objectContaining({
          to: "Inventory API",
          description: "HTTP",
        }),
        expect.objectContaining({
          to: "Fulfillment API",
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
