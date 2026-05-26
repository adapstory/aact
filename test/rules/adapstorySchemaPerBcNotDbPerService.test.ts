import { checkAdapstorySchemaPerBcNotDbPerService } from "../../src/rules";
import type { TestElement, TestRelation } from "./adapstoryTestModel";
import { testElement, testModel } from "./adapstoryTestModel";

const container = (
  name: string,
  tags: string[] = [],
  relations: TestRelation[] = [],
  type = "Container",
  technology?: string,
): TestElement => testElement(name, tags, relations, type, "", technology);

const postgres = (): TestElement =>
  container("postgres", [], [], "ContainerDb", "PostgreSQL");

const model = (containers: TestElement[]): ReturnType<typeof testModel> =>
  testModel(containers);

describe("checkAdapstorySchemaPerBcNotDbPerService", () => {
  it("allows shared PostgreSQL when each BC declares its logical schema", () => {
    const db = postgres();
    const content = container(
      "content_repository",
      ["bc-11"],
      [{ to: db, tags: ["schema-per-bc", "schema:bc-11"] }],
    );
    const dataModel = container(
      "data_model_engine",
      ["bc-15"],
      [{ to: db, technology: "JDBC schema-per-bc schema=bc-15" }],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([content, dataModel, db])),
    ).toHaveLength(0);
  });

  it("rejects PostgreSQL access without schema-per-BC ownership", () => {
    const db = postgres();
    const service = container(
      "data_model_engine",
      ["bc-15"],
      [{ to: db, technology: "JDBC" }],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([service, db])),
    ).toMatchObject([
      {
        target: "data_model_engine",
        targetKind: "element",
        message:
          'uses shared database "postgres" without schema-per-BC ownership for bc-15',
      },
    ]);
  });

  it("allows reviewed logical schema owners for non-core platform or plugin services", () => {
    const db = postgres();
    const keycloak = container(
      "keycloak_service",
      [],
      [
        {
          to: db,
          tags: [
            "reviewed-overlay",
            "schema-per-bc",
            "schema-owner:identity-platform",
          ],
        },
      ],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([keycloak, db])),
    ).toHaveLength(0);
  });

  it("rejects schema declarations that do not match the source BC", () => {
    const db = postgres();
    const service = container(
      "plugin_lifecycle",
      ["bc-02"],
      [{ to: db, tags: ["schema-per-bc", "schema:bc-15"] }],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([service, db])),
    ).toMatchObject([
      {
        target: "plugin_lifecycle",
        targetKind: "element",
        message:
          'uses shared database "postgres" without schema-per-BC ownership for bc-02',
      },
    ]);
  });

  it("ignores non-shared database technologies by default", () => {
    const redis = container("redis", [], [], "ContainerDb", "Redis");
    const service = container(
      "identity_service",
      ["bc-16"],
      [{ to: redis, technology: "Redis" }],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([service, redis])),
    ).toHaveLength(0);
  });

  it("supports custom database and BC patterns", () => {
    const db = container("shared_oracle", [], [], "Database", "Oracle");
    const service = container(
      "billing_service",
      ["domain-billing"],
      [
        {
          to: db,
          tags: ["schema-per-bc", "schema:domain-billing"],
        },
      ],
    );

    expect(
      checkAdapstorySchemaPerBcNotDbPerService(model([service, db]), {
        sharedDatabasePattern: /oracle/i,
        bcTagPattern: /^domain-/,
      }),
    ).toHaveLength(0);
  });
});
