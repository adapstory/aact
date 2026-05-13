import type { ArchitectureModel, Container } from "../../src/model";
import { checkAdapstorySchemaPerBcNotDbPerService } from "../../src/rules";

const container = (
    name: string,
    tags: string[] = [],
    relations: Container["relations"] = [],
    type = "Container",
    technology?: string,
): Container => ({
    name,
    label: name,
    type,
    tags,
    description: "",
    relations,
    ...(technology ? { technology } : {}),
});

const postgres = (): Container =>
    container("postgres", [], [], "ContainerDb", "PostgreSQL");

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

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
            checkAdapstorySchemaPerBcNotDbPerService(
                model([content, dataModel, db]),
            ),
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
        ).toEqual([
            {
                container: "data_model_engine",
                message:
                    'uses shared database "postgres" without schema-per-BC ownership for bc-15',
            },
        ]);
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
        ).toEqual([
            {
                container: "plugin_lifecycle",
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
                dbType: "Database",
                sharedDatabasePattern: /oracle/i,
                bcTagPattern: /^domain-/,
            }),
        ).toHaveLength(0);
    });
});
