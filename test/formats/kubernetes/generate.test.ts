import YAML from "yaml";

import { generate } from "../../../src/formats/kubernetes/generate";
import type { ElementSpec } from "../../helpers/makeModel";
import { makeModel } from "../../helpers/makeModel";

const build = (containers: ElementSpec[]) =>
  generate(makeModel({ elements: containers }));

describe("kubernetes generate", () => {
  it("returns empty files for empty model", () => {
    expect(generate(makeModel({})).files).toEqual([]);
  });

  it("generates minimal YAML for container without relations", () => {
    const output = build([{ name: "orders" }]);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("orders.yml");
    const parsed = YAML.parse(output.files[0].content);
    expect(parsed.name).toBe("orders");
    expect(parsed.environment).toBeUndefined();
  });

  it("skips ContainerDb in generated files", () => {
    const output = build([
      { name: "orders_db", kind: "ContainerDb" },
      { name: "orders" },
    ]);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("orders.yml");
  });

  it("skips System (external systems and others)", () => {
    const output = build([
      {
        name: "ext_gateway",
        kind: "System",
        external: true,
      },
      { name: "orders" },
    ]);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("orders.yml");
  });

  it("generates sync internal BASE_URL with default port", () => {
    const output = build([
      { name: "orders", relations: [{ to: "payments" }] },
      { name: "payments" },
    ]);
    const ordersOut = output.files.find((f) => f.path === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);
    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      "http://payments:8080",
    );
  });

  it("uses technology as value for sync internal when provided", () => {
    const output = build([
      {
        name: "orders",
        relations: [{ to: "payments", technology: "http://payments:3000/api" }],
      },
      { name: "payments" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      "http://payments:3000/api",
    );
  });

  it("generates sync external BASE_URL with https default", () => {
    const output = build([
      { name: "orders", relations: [{ to: "ext_gateway" }] },
      {
        name: "ext_gateway",
        kind: "System",
        external: true,
      },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.EXT_GATEWAY_BASE_URL.default).toBe(
      "https://ext-gateway",
    );
  });

  it("uses technology as value for sync external when provided", () => {
    const output = build([
      {
        name: "orders",
        relations: [
          { to: "ext_gateway", technology: "https://api.external.com" },
        ],
      },
      {
        name: "ext_gateway",
        kind: "System",
        external: true,
      },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.EXT_GATEWAY_BASE_URL.default).toBe(
      "https://api.external.com",
    );
  });

  it("generates KAFKA topic for async relation", () => {
    const output = build([
      {
        name: "orders",
        relations: [{ to: "notifications", tags: ["async"] }],
      },
      { name: "notifications" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.KAFKA_NOTIFICATIONS_TOPIC.default).toBe(
      "notifications",
    );
  });

  it("uses technology as topic for async relation when provided", () => {
    const output = build([
      {
        name: "orders",
        relations: [
          {
            to: "notifications",
            tags: ["async"],
            technology: "order-events-v2",
          },
        ],
      },
      { name: "notifications" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.KAFKA_NOTIFICATIONS_TOPIC.default).toBe(
      "order-events-v2",
    );
  });

  it("generates PG_CONNECTION_STRING for database relation", () => {
    const output = build([
      { name: "orders", relations: [{ to: "orders_db" }] },
      { name: "orders_db", kind: "ContainerDb" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.PG_CONNECTION_STRING.default).toBe(
      "postgresql://orders:pass-orders@postgresql:5432/orders",
    );
  });

  it("converts underscores to hyphens in path", () => {
    const output = build([{ name: "invoice_repository" }]);
    expect(output.files[0].path).toBe("invoice-repository.yml");
  });

  it("converts underscores to hyphens in YAML name", () => {
    const output = build([{ name: "invoice_repository" }]);
    const parsed = YAML.parse(output.files[0].content);
    expect(parsed.name).toBe("invoice-repository");
  });

  it("uses custom defaultPort", () => {
    const model = makeModel({
      elements: [
        { name: "orders", relations: [{ to: "payments" }] },
        { name: "payments" },
      ],
    });
    const output = generate(model, { defaultPort: 3000 });
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      "http://payments:3000",
    );
  });

  it("generates all env vars for multiple relations", () => {
    const output = build([
      {
        name: "orders",
        relations: [
          { to: "orders_db" },
          { to: "payments" },
          { to: "notifications", tags: ["async"] },
          { to: "ext_api" },
        ],
      },
      { name: "orders_db", kind: "ContainerDb" },
      { name: "payments" },
      { name: "notifications" },
      { name: "ext_api", kind: "System", external: true },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment).toHaveProperty("PG_CONNECTION_STRING");
    expect(parsed.environment).toHaveProperty("PAYMENTS_BASE_URL");
    expect(parsed.environment).toHaveProperty("KAFKA_NOTIFICATIONS_TOPIC");
    expect(parsed.environment).toHaveProperty("EXT_API_BASE_URL");
  });

  it("sorts env vars by key name", () => {
    const output = build([
      {
        name: "orders",
        relations: [{ to: "payments" }, { to: "billing" }, { to: "orders_db" }],
      },
      { name: "payments" },
      { name: "billing" },
      { name: "orders_db", kind: "ContainerDb" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    const keys = Object.keys(parsed.environment);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("uses custom dbConnectionTemplate", () => {
    const model = makeModel({
      elements: [
        { name: "orders", relations: [{ to: "orders_db" }] },
        { name: "orders_db", kind: "ContainerDb" },
      ],
    });
    const output = generate(model, {
      dbConnectionTemplate: "mysql://{name}@db:3306/{name}",
    });
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment.PG_CONNECTION_STRING.default).toBe(
      "mysql://orders@db:3306/orders",
    );
  });

  it("ignores relation to Person (not deployable)", () => {
    const output = build([
      { name: "orders", relations: [{ to: "admin" }] },
      { name: "admin", kind: "Person" },
    ]);
    const parsed = YAML.parse(
      output.files.find((f) => f.path === "orders.yml")!.content,
    );
    expect(parsed.environment).toBeUndefined();
  });

  it("excludes Person elements from generated YAML", () => {
    const output = build([
      { name: "customer", kind: "Person" },
      { name: "orders" },
    ]);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("orders.yml");
  });

  it("excludes System and Component elements (whitelist for Container only)", () => {
    const output = build([
      { name: "billing_system", kind: "System" },
      { name: "auth_module", kind: "Component" },
      { name: "orders" },
    ]);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("orders.yml");
  });

  it("renders the full env block end-to-end (regression snapshot)", () => {
    const output = build([
      {
        name: "orders",
        relations: [
          { to: "orders_db" },
          { to: "payments" },
          {
            to: "notifications",
            tags: ["async"],
            technology: "order-events",
          },
          { to: "ext_api" },
        ],
      },
      { name: "orders_db", kind: "ContainerDb" },
      { name: "payments" },
      { name: "notifications" },
      { name: "ext_api", kind: "System", external: true },
    ]);
    const ordersFile = output.files.find((f) => f.path === "orders.yml")!;
    expect(ordersFile.content).toMatchInlineSnapshot(`
      "name: orders
      environment:
        EXT_API_BASE_URL:
          default: https://ext-api
        KAFKA_NOTIFICATIONS_TOPIC:
          default: order-events
        PAYMENTS_BASE_URL:
          default: http://payments:8080
        PG_CONNECTION_STRING:
          default: postgresql://orders:pass-orders@postgresql:5432/orders
      "
    `);
  });

  it("round-trip: generated YAML can be parsed back", () => {
    const output = build([
      {
        name: "orders",
        relations: [
          { to: "orders_db" },
          { to: "payments" },
          {
            to: "notifications",
            tags: ["async"],
            technology: "order-events",
          },
        ],
      },
      { name: "orders_db", kind: "ContainerDb" },
      { name: "payments" },
      { name: "notifications" },
    ]);
    for (const f of output.files) {
      const parsed = YAML.parse(f.content);
      expect(parsed.name).toBeDefined();
      expect(typeof parsed.name).toBe("string");
      if (parsed.environment) {
        for (const [key, value] of Object.entries(parsed.environment)) {
          expect(typeof key).toBe("string");
          expect(value).toHaveProperty("default");
        }
      }
    }
  });
});
