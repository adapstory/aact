import { fc, test } from "@fast-check/vitest";

import {
  Container,
  CONTAINER_DB_TYPE,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
} from "../../src/model";
import {
  checkAcl,
  checkApiGateway,
  checkCrud,
  checkDbPerService,
  checkStableDependencies,
} from "../../src/rules";

// Property-based tests for every option-bearing rule.
//
// The recurring class of bugs we keep fixing — "literal hardcoded where
// the option should be read" — only fires when a non-default option value
// is configured. Example-based tests with the default `repoTags: ["repo",
// "relay"]` never exercise that branch, which is exactly why these bugs
// survive code review and reach release. fast-check generates random
// option values on every run; if any branch ignores the option, the
// invariant fails.

const tagArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const tagArrayArb = fc.array(tagArb, { minLength: 1, maxLength: 3 });

const typeArb = fc
  .string({ minLength: 3, maxLength: 12 })
  .filter((s) => /^[A-Z][a-zA-Z_]*$/.test(s));

const container = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("acl rule respects custom options", () => {
  test.prop([tagArb, typeArb])(
    "container without the configured `tag` calling an external of the configured `externalType` always fires",
    (customTag, customExternalType) => {
      const ext = container({ name: "ext", type: customExternalType });
      const svc = container({
        name: "svc",
        relations: [{ to: ext }],
      });
      const violations = checkAcl([svc, ext], {
        tag: customTag,
        externalType: customExternalType,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("svc");
    },
  );

  test.prop([tagArb, typeArb])(
    "container WITH the configured `tag` calling an external of the configured `externalType` never fires",
    (customTag, customExternalType) => {
      const ext = container({ name: "ext", type: customExternalType });
      const svc = container({
        name: "svc",
        tags: [customTag],
        relations: [{ to: ext }],
      });
      expect(
        checkAcl([svc, ext], {
          tag: customTag,
          externalType: customExternalType,
        }),
      ).toHaveLength(0);
    },
  );
});

describe("crud rule respects custom repoTags", () => {
  test.prop([tagArrayArb])(
    "non-repo container accessing DB always fires (first branch reads repoTags)",
    (customRepoTags) => {
      const db = container({ name: "db", type: CONTAINER_DB_TYPE });
      const svc = container({ name: "svc", relations: [{ to: db }] });
      const violations = checkCrud([svc, db], { repoTags: customRepoTags });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("directly accesses database");
    },
  );

  test.prop([tagArrayArb])(
    "container tagged with first of repoTags is treated as repo (first branch reads repoTags)",
    (customRepoTags) => {
      const db = container({ name: "db", type: CONTAINER_DB_TYPE });
      const repo = container({
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
      const other = container({ name: "other" });
      const repo = container({
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

describe("dbPerService rule respects custom dbType", () => {
  test.prop([typeArb])(
    "two services accessing the same custom-type DB fire one violation",
    (customDbType) => {
      const db = container({ name: "shared_db", type: customDbType });
      const a = container({ name: "a", relations: [{ to: db }] });
      const b = container({ name: "b", relations: [{ to: db }] });
      const violations = checkDbPerService([a, b, db], {
        dbType: customDbType,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("shared_db");
    },
  );

  test.prop([typeArb])(
    "containers accessing a non-DB-typed target never fire dbPerService",
    (customDbType) => {
      const fake = container({ name: "fake", type: "Container" });
      const a = container({ name: "a", relations: [{ to: fake }] });
      const b = container({ name: "b", relations: [{ to: fake }] });
      expect(
        checkDbPerService([a, b, fake], { dbType: customDbType }),
      ).toHaveLength(0);
    },
  );
});

describe("stableDependencies rule respects custom externalType", () => {
  test.prop([typeArb])(
    "containers of the configured externalType are excluded from coupling calculation",
    (customExternalType) => {
      // Two internals with mutual instability calculation — should be the
      // only data points; external containers should not affect ca/ce.
      const ext = container({ name: "ext", type: customExternalType });
      const stable = container({ name: "stable" });
      const unstable = container({
        name: "unstable",
        relations: [{ to: stable }, { to: ext }],
      });
      // The relation to ext must not change instability of `unstable`,
      // so the rule should fire (unstable depends on stable, both internal)
      // OR not fire — but it must be deterministic and ignore the external
      // edge entirely.
      const withExternal = checkStableDependencies([stable, unstable, ext], {
        externalType: customExternalType,
      });
      const withoutExternal = checkStableDependencies([stable, unstable], {
        externalType: customExternalType,
      });
      expect(withExternal).toEqual(withoutExternal);
    },
  );
});

describe("apiGateway rule respects custom aclTag and gatewayPattern", () => {
  test.prop([tagArb])(
    "ACL container calling external without gateway in technology fires",
    (customAclTag) => {
      const ext = container({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = container({
        name: "acl",
        tags: [customAclTag],
        relations: [{ to: ext, technology: "REST" }],
      });
      const violations = checkApiGateway([acl, ext], { aclTag: customAclTag });
      expect(violations).toHaveLength(1);
      expect(violations[0].container).toBe("acl");
    },
  );

  test.prop([tagArb])(
    "ACL container calling external WITH gateway in technology never fires",
    (customAclTag) => {
      const ext = container({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = container({
        name: "acl",
        tags: [customAclTag],
        relations: [{ to: ext, technology: "https://gateway.example.com" }],
      });
      expect(
        checkApiGateway([acl, ext], { aclTag: customAclTag }),
      ).toHaveLength(0);
    },
  );

  test.prop([fc.constantFrom("api", "router", "broker")])(
    "custom gatewayPattern is honored for the gateway-detection check",
    (gatewayWord) => {
      const ext = container({ name: "ext", type: EXTERNAL_SYSTEM_TYPE });
      const acl = container({
        name: "acl",
        tags: ["acl"],
        relations: [
          { to: ext, technology: `https://${gatewayWord}.example.com` },
        ],
      });
      const pattern = new RegExp(gatewayWord, "i");
      expect(
        checkApiGateway([acl, ext], { gatewayPattern: pattern }),
      ).toHaveLength(0);
    },
  );
});
