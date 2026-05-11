import { fc, test } from "@fast-check/vitest";

import { Container, CONTAINER_TYPE } from "../../src/model";
import { checkDbPerService } from "../../src/rules";

const typeArb = fc
  .string({ minLength: 3, maxLength: 12 })
  .filter((s) => /^[A-Z][a-zA-Z_]*$/.test(s));

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("checkDbPerService", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  it("returns no violations when each db accessed by one service", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        tags: ["repo"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });

  it("returns violation when db accessed by multiple services", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      {
        name: "payments_service",
        label: "Payments Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    const violations = checkDbPerService(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_db");
    expect(violations[0].message).toContain("orders_repo");
    expect(violations[0].message).toContain("payments_service");
  });

  it("violation message pins exact format", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      {
        name: "payments_service",
        label: "Payments Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];
    const violations = checkDbPerService(containers);
    expect(violations[0].message).toBe(
      "shared between orders_repo, payments_service — each database should have a single owner",
    );
  });

  it("returns no violations when no db relations", () => {
    const other: Container = {
      name: "notifications",
      label: "Notifications",
      type: "Container",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "api",
        label: "API",
        type: "Container",
        description: "",
        relations: [{ to: other }],
      },
      other,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });

  it("respects custom dbType option", () => {
    const cache: Container = {
      name: "redis",
      label: "Redis",
      type: "Cache",
      description: "",
      relations: [],
    };
    const svc1: Container = {
      name: "svc_a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: cache }],
    };
    const svc2: Container = {
      name: "svc_b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: cache }],
    };

    expect(checkDbPerService([svc1, svc2, cache])).toHaveLength(0);
    expect(
      checkDbPerService([svc1, svc2, cache], { dbType: "Cache" }),
    ).toHaveLength(1);
  });

  it("handles multiple databases correctly", () => {
    const db2: Container = {
      name: "users_db",
      label: "Users DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      {
        name: "users_repo",
        label: "Users Repo",
        type: "Container",
        description: "",
        relations: [{ to: db2 }],
      },
      db,
      db2,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });

  // Property-based: dbType branch must read the option, not the default literal.
  test.prop([typeArb])(
    "two services accessing the same custom-type DB fire one violation",
    (customDbType) => {
      const sharedDb = makeContainer({ name: "shared_db", type: customDbType });
      const a = makeContainer({ name: "a", relations: [{ to: sharedDb }] });
      const b = makeContainer({ name: "b", relations: [{ to: sharedDb }] });
      const violations = checkDbPerService([a, b, sharedDb], {
        dbType: customDbType,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("shared_db");
    },
  );

  test.prop([typeArb])(
    "containers accessing a non-DB-typed target never fire dbPerService",
    (customDbType) => {
      const fake = makeContainer({ name: "fake", type: "Container" });
      const a = makeContainer({ name: "a", relations: [{ to: fake }] });
      const b = makeContainer({ name: "b", relations: [{ to: fake }] });
      expect(
        checkDbPerService([a, b, fake], { dbType: customDbType }),
      ).toHaveLength(0);
    },
  );
});
