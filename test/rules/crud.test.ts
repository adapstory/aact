import { fc, test } from "@fast-check/vitest";

import { Container, CONTAINER_DB_TYPE, CONTAINER_TYPE } from "../../src/model";
import { checkCrud } from "../../src/rules";

const tagArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const tagArrayArb = fc.array(tagArb, { minLength: 1, maxLength: 3 });

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("checkCrud", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  const otherService: Container = {
    name: "notifications",
    label: "Notifications",
    type: "Container",
    description: "",
    relations: [],
  };

  it("returns no violations when repo accesses only database", () => {
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

    expect(checkCrud(containers)).toHaveLength(0);
  });

  it("returns violation when non-repo accesses database", () => {
    const containers: Container[] = [
      {
        name: "orders_service",
        label: "Orders Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    const violations = checkCrud(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_service");
  });

  it("returns violation when repo has non-database dependencies", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        tags: ["repo"],
        description: "",
        relations: [{ to: db }, { to: otherService }],
      },
      db,
      otherService,
    ];

    const violations = checkCrud(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("non-database dependencies");
  });

  it("allows relay-tagged containers to access database", () => {
    const containers: Container[] = [
      {
        name: "orders_relay",
        label: "Orders Relay",
        type: "Container",
        tags: ["relay"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkCrud(containers)).toHaveLength(0);
  });

  it("respects custom repoTags when checking repo outbound dependencies", () => {
    const containers: Container[] = [
      {
        name: "orders_relay",
        label: "Orders Relay",
        type: "Container",
        tags: ["relay"],
        description: "",
        relations: [{ to: db }, { to: otherService }],
      },
      db,
      otherService,
    ];

    const violations = checkCrud(containers, { repoTags: ["relay"] });
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_relay");
    expect(violations[0].message).toContain("non-database dependencies");
  });

  it("violation message names the database and the remediation", () => {
    const containers: Container[] = [
      {
        name: "orders_service",
        label: "Orders Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];
    const violations = checkCrud(containers);
    expect(violations[0].message).toBe(
      "directly accesses database orders_db — add a repo or relay",
    );
  });

  it("repo-with-non-db message lists offending targets verbatim", () => {
    const other2: Container = {
      name: "audit_svc",
      label: "Audit",
      type: "Container",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        tags: ["repo"],
        description: "",
        relations: [{ to: db }, { to: otherService }, { to: other2 }],
      },
      db,
      otherService,
      other2,
    ];

    const violations = checkCrud(containers);
    expect(violations[0].message).toBe(
      "repo has non-database dependencies: notifications, audit_svc — repos should only access databases",
    );
  });

  it("returns no violations when container has no db relations", () => {
    const containers: Container[] = [
      {
        name: "api_gateway",
        label: "API Gateway",
        type: "Container",
        description: "",
        relations: [{ to: otherService }],
      },
      otherService,
    ];

    expect(checkCrud(containers)).toHaveLength(0);
  });

  // Property-based: both branches of the rule must read repoTags from options,
  // not a literal. v2.1.5 had a regression where the "repo with non-DB outbound"
  // branch ignored repoTags and only the "non-repo accesses DB" branch read it.
  test.prop([tagArrayArb])(
    "non-repo container accessing DB always fires (first branch reads repoTags)",
    (customRepoTags) => {
      const db = makeContainer({ name: "db", type: CONTAINER_DB_TYPE });
      const svc = makeContainer({ name: "svc", relations: [{ to: db }] });
      const violations = checkCrud([svc, db], { repoTags: customRepoTags });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("directly accesses database");
    },
  );

  test.prop([tagArrayArb])(
    "container tagged with first of repoTags is treated as repo (first branch reads repoTags)",
    (customRepoTags) => {
      const db = makeContainer({ name: "db", type: CONTAINER_DB_TYPE });
      const repo = makeContainer({
        name: "repo",
        tags: [customRepoTags[0]],
        relations: [{ to: db }],
      });
      expect(checkCrud([repo, db], { repoTags: customRepoTags })).toHaveLength(
        0,
      );
    },
  );

  test.prop([tagArrayArb])(
    "repo-tagged container with non-DB outbound fires (second branch reads repoTags) — regression for v2.1.5 bug",
    (customRepoTags) => {
      const other = makeContainer({ name: "other" });
      const repo = makeContainer({
        name: "repo",
        tags: [customRepoTags[0]],
        relations: [{ to: other }],
      });
      const violations = checkCrud([repo, other], {
        repoTags: customRepoTags,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("non-database dependencies");
    },
  );
});
