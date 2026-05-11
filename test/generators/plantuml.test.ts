import { generatePlantuml } from "../../src/generators/plantuml";
import type { DeployConfig } from "../../src/loaders/kubernetes";

describe("generatePlantuml", () => {
  it("generates header and boundary", () => {
    const result = generatePlantuml([]);
    expect(result).toContain('@startuml "Demo Generated"');
    expect(result).toContain('Boundary(project, "Our system")');
    expect(result).toContain("@enduml");
  });

  it("uses custom boundaryLabel", () => {
    const result = generatePlantuml([], { boundaryLabel: "My Platform" });
    expect(result).toContain('Boundary(project, "My Platform")');
  });

  it("creates Container for each config", () => {
    const configs: DeployConfig[] = [
      { name: "orders", sections: [] },
      { name: "payments", sections: [] },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Container(orders, "orders")');
    expect(result).toContain('Container(payments, "payments")');
  });

  it("replaces underscores with spaces in container label", () => {
    const configs: DeployConfig[] = [{ name: "order_service", sections: [] }];
    const result = generatePlantuml(configs);
    expect(result).toContain('Container(order_service, "order service")');
  });

  it("adds acl tag to containers ending with acl", () => {
    const configs: DeployConfig[] = [{ name: "payments_acl", sections: [] }];
    const result = generatePlantuml(configs);
    expect(result).toContain(
      'Container(payments_acl, "payments acl", "", "", $tags="acl")',
    );
  });

  it("creates ContainerDb when PG_CONNECTION_STRING exists", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        environment: { PG_CONNECTION_STRING: { prod: "pg://..." } },
        sections: [],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('ContainerDb(orders_db, "DB")');
    expect(result).toContain("Rel(orders, orders_db,");
  });

  it("creates sync relation for non-kafka section", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "payments", prod_value: "http://payments" }],
      },
      { name: "payments", sections: [] },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, payments, ""');
    expect(result).not.toContain("System_Ext(payments");
  });

  it("creates System_Ext for unknown sync target", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "ext_gateway", prod_value: "https://ext.com/api" }],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('System_Ext(ext_gateway, "ext_gateway", " ")');
    expect(result).toContain(
      'Rel(orders, ext_gateway, "", "https://ext.com/api")',
    );
  });

  it("creates async relation for kafka sections", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [
          { name: "kafka_events_topic", prod_value: "events-topic-v1" },
        ],
      },
      {
        name: "notifications",
        sections: [
          { name: "kafka_events_topic", prod_value: "events-topic-v1" },
        ],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, notifications, "", $tags="async")');
  });

  it("creates external async target when no matching consumer", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "kafka_billing_topic", prod_value: "billing-v1" }],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('System_Ext(billing, "billing", " ")');
    expect(result).toContain('Rel(orders, billing, ""');
    expect(result).toContain('$tags="async"');
  });

  it("renders a full multi-config scenario end-to-end (regression snapshot)", () => {
    // Snapshot pins indent, ordering, dedup, $tags="async", boundary close
    // brace. Stryker mutated the internal `rels`/`extSystems`/`intContainers`
    // initial values, the closing `}`, the transport flag, the async
    // flag, and the some-vs-every kafka match. Pinning the full string
    // catches all of them in one assertion.
    const configs: DeployConfig[] = [
      {
        name: "orders",
        environment: { PG_CONNECTION_STRING: { prod: "pg://..." } },
        sections: [
          { name: "kafka_events_topic", prod_value: "events-v1" },
          // eslint-disable-next-line sonarjs/no-clear-text-protocols
          { name: "payments", prod_value: "http://payments" },
        ],
      },
      {
        name: "notifications",
        sections: [{ name: "kafka_events_topic", prod_value: "events-v1" }],
      },
      { name: "payments", sections: [] },
    ];
    expect(generatePlantuml(configs)).toMatchInlineSnapshot(`
      "@startuml "Demo Generated"
      !include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
      LAYOUT_WITH_LEGEND()
      AddRelTag("async",  $lineStyle = DottedLine())
      AddElementTag("acl",  $bgColor = "#6F9355")
      Boundary(project, "Our system"){
      Container(orders, "orders")
      ContainerDb(orders_db, "DB")
      Rel(orders, orders_db, "")
      Container(notifications, "notifications")
      Container(payments, "payments")
      }
      Rel(orders, notifications, "", $tags="async")
      Rel(orders, payments, "")
      @enduml"
    `);
  });

  it('pins addRel transport="" and async=false for db relation', () => {
    // L43 mutations: `addRel(config.name, dbName, "", false)` — the empty
    // transport string and the false-async flag. Mutation to non-empty
    // string would render `, "Stryker..."` after dbName; mutation to true
    // would append `$tags="async"`. Pin both.
    const configs: DeployConfig[] = [
      {
        name: "orders",
        environment: { PG_CONNECTION_STRING: { prod: "pg://..." } },
        sections: [],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, orders_db, "")');
    expect(result).not.toContain('Rel(orders, orders_db, "", "');
    expect(result).not.toMatch(/Rel\(orders, orders_db,[^\n]*\$tags="async"/u);
    // ^ regex flag silences `no-useless-escape` for `\$` (dollar is meta in
    // unicode mode; explicit escape is preferred over relying on context).
  });

  it('pins addRel kafka-fanout transport="" and async=true', () => {
    // L57: `addRel(config.name, rel.name, "", true)`. Mutation `""` →
    // junk string would put nonsense transport after rel.name. Pin: the
    // emitted Rel has empty transport and async tag.
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "kafka_events_topic", prod_value: "events-v1" }],
      },
      {
        name: "notifications",
        sections: [{ name: "kafka_events_topic", prod_value: "events-v1" }],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, notifications, "", $tags="async")');
  });

  it("emits closing brace after the project boundary", () => {
    // L46 StringLiteral `data += `}\n`` mutated to empty string. Without
    // the closing brace, the project boundary is left open — downstream
    // PlantUML parsers fail.
    const result = generatePlantuml([{ name: "orders", sections: [] }]);
    // Expect `}` on its own line between the Container declarations and
    // the relations section.
    expect(result).toMatch(/Container\(orders.*\)\n\}\n/);
  });

  it("recognises kafka-topic match by .some — multiple producers, all see consumer", () => {
    // L54 MethodExpression `.some` → `.every`. With every, the match
    // requires ALL sections of the other container to have the same
    // value — overly strict. Pin a model where the other has multiple
    // sections and only one matches.
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "kafka_events_topic", prod_value: "events-v1" }],
      },
      {
        name: "notifications",
        sections: [
          { name: "kafka_events_topic", prod_value: "events-v1" },
          { name: "kafka_other_topic", prod_value: "other-v1" },
        ],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, notifications, "", $tags="async")');
  });

  it("registers each external system once even when referenced multiple times", () => {
    // ArrayDeclaration mutation on `extSystems` initial value. With a
    // sentinel pre-populated, dedup wouldn't fire correctly for the real
    // first reference. Pin: each ext appears exactly once in System_Ext.
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "billing", prod_value: "https://ext.com/api" }],
      },
      {
        name: "payments",
        sections: [{ name: "billing", prod_value: "https://ext.com/api" }],
      },
    ];
    const result = generatePlantuml(configs);
    const extOccurrences = (result.match(/System_Ext\(billing,/g) ?? []).length;
    expect(extOccurrences).toBe(1);
  });

  it("deduplicates bidirectional relations", () => {
    const configs: DeployConfig[] = [
      {
        name: "a",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "b", prod_value: "http://b" }],
      },
      {
        name: "b",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "a", prod_value: "http://a" }],
      },
    ];
    const result = generatePlantuml(configs);
    const relCount = (result.match(/Rel\(a, b,|Rel\(b, a,/g) ?? []).length;
    expect(relCount).toBe(1);
  });
});
