import consola from "consola";

import type { ArchitectureModel, Boundary, Container } from "../../src/model";
import {
  buildContainerBoundaryMap,
  findPublicApiCandidate,
  resolveRedirectTarget,
} from "../../src/rules/boundaryUtils";

const makeContainer = (
  name: string,
  relations: Container["relations"] = [],
  tags?: string[],
  type = "Container",
): Container => ({
  name,
  label: name,
  type,
  description: "",
  relations,
  tags,
});

const makeDb = (name: string): Container =>
  makeContainer(name, [], undefined, "ContainerDb");

const makeBoundary = (name: string, containers: Container[]): Boundary => ({
  name,
  label: name,
  containers,
  boundaries: [],
});

const makeModel = (boundaries: Boundary[]): ArchitectureModel => ({
  boundaries,
  allContainers: boundaries.flatMap((b) => b.containers),
});

describe("buildContainerBoundaryMap", () => {
  it("maps each container to its boundary", () => {
    const svc = makeContainer("svc");
    const db = makeDb("db");
    const bc = makeBoundary("bc", [svc, db]);
    const map = buildContainerBoundaryMap(makeModel([bc]));

    expect(map.get("svc")).toBe(bc);
    expect(map.get("db")).toBe(bc);
  });

  it("returns empty map for model with no boundaries", () => {
    const map = buildContainerBoundaryMap({
      boundaries: [],
      allContainers: [],
    });
    expect(map.size).toBe(0);
  });
});

describe("findPublicApiCandidate", () => {
  it("returns undefined when no candidates", () => {
    const db = makeDb("orders_db");
    const repo = makeContainer("orders_repo", [], ["repo"]);
    const bc = makeBoundary("bc", [db, repo]);
    const model = makeModel([bc]);
    const map = buildContainerBoundaryMap(model);

    expect(
      findPublicApiCandidate(bc, "ContainerDb", ["repo"], model, map),
    ).toBeUndefined();
  });

  it("returns the single candidate", () => {
    const api = makeContainer("orders_api");
    const db = makeDb("orders_db");
    const bc = makeBoundary("bc", [api, db]);
    const model = makeModel([bc]);
    const map = buildContainerBoundaryMap(model);

    expect(
      findPublicApiCandidate(bc, "ContainerDb", ["repo"], model, map),
    ).toBe(api);
  });

  it("picks candidate with highest in-degree from outside boundary", () => {
    const api = makeContainer("orders_api");
    const gateway = makeContainer("orders_gateway");
    const db = makeDb("orders_db");
    const bcOrders = makeBoundary("orders", [api, gateway, db]);

    const externalA = makeContainer("ext_a", [{ to: gateway }]);
    const externalB = makeContainer("ext_b", [{ to: gateway }]);
    const externalC = makeContainer("ext_c", [{ to: api }]);
    const bcExt = makeBoundary("ext", [externalA, externalB, externalC]);

    const model = makeModel([bcOrders, bcExt]);
    const map = buildContainerBoundaryMap(model);

    // gateway has 2 incoming, api has 1 — gateway wins
    expect(
      findPublicApiCandidate(bcOrders, "ContainerDb", ["repo"], model, map),
    ).toBe(gateway);
  });

  it("excludes in-boundary relations from in-degree count (covers L40)", () => {
    // Stryker mutated `if (boundaryMap.get(container.name) === targetBoundary) continue`
    // to `false`. Without skipping same-boundary sources, internal traffic
    // inflates in-degree and the wrong public API gets picked.
    const apiA = makeContainer("a_api");
    const apiB = makeContainer("b_api");
    const db = makeDb("orders_db");
    const internalCaller1 = makeContainer("i1", [{ to: apiB }]);
    const internalCaller2 = makeContainer("i2", [{ to: apiB }]);
    const bcOrders = makeBoundary("orders", [
      apiA,
      apiB,
      db,
      internalCaller1,
      internalCaller2,
    ]);

    const ext = makeContainer("ext_caller", [{ to: apiA }]);
    const bcExt = makeBoundary("ext", [ext]);
    const model = makeModel([bcOrders, bcExt]);
    const map = buildContainerBoundaryMap(model);

    // External in-degree: apiA=1, apiB=0. apiA wins (internal traffic on
    // apiB is excluded).
    expect(
      findPublicApiCandidate(bcOrders, "ContainerDb", ["repo"], model, map),
    ).toBe(apiA);
  });

  it("picks highest-in-degree candidate via the sort comparator", () => {
    // Stryker mutated `inDegree.get(b.name) ?? 0` to `inDegree.get(b.name) && 0`,
    // which corrupts the comparator. Pin: a candidate with strictly more
    // external incoming edges wins.
    const winner = makeContainer("winner_api");
    const loser = makeContainer("loser_api");
    const db = makeDb("orders_db");
    const bcOrders = makeBoundary("orders", [winner, loser, db]);

    const ext1 = makeContainer("ext1", [{ to: winner }]);
    const ext2 = makeContainer("ext2", [{ to: winner }]);
    const ext3 = makeContainer("ext3", [{ to: winner }]);
    const ext4 = makeContainer("ext4", [{ to: loser }]);
    const bcExt = makeBoundary("ext", [ext1, ext2, ext3, ext4]);
    const model = makeModel([bcOrders, bcExt]);
    const map = buildContainerBoundaryMap(model);

    expect(
      findPublicApiCandidate(bcOrders, "ContainerDb", ["repo"], model, map),
    ).toBe(winner);
  });
});

describe("resolveRedirectTarget", () => {
  it("returns owner for same-boundary access", () => {
    const db = makeDb("orders_db");
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const api = makeContainer("orders_api", [{ to: db }]);
    const bc = makeBoundary("bc", [api, repo, db]);
    const model = makeModel([bc]);
    const map = buildContainerBoundaryMap(model);

    expect(
      resolveRedirectTarget(
        api,
        db,
        repo,
        "ContainerDb",
        ["repo"],
        model,
        map,
        "test",
      ),
    ).toBe(repo);
  });

  it("returns public API for cross-boundary access", () => {
    const db = makeDb("orders_db");
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const publicApi = makeContainer("orders_api");
    const bcOrders = makeBoundary("orders", [publicApi, repo, db]);

    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);

    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);

    expect(
      resolveRedirectTarget(
        accessor,
        db,
        repo,
        "ContainerDb",
        ["repo"],
        model,
        map,
        "test",
      ),
    ).toBe(publicApi);
  });

  it("warns by name+rule when cross-boundary has no public API", () => {
    const db = makeDb("orders_db");
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const bcOrders = makeBoundary("orders", [repo, db]);
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);
    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    resolveRedirectTarget(
      accessor,
      db,
      repo,
      "ContainerDb",
      ["repo"],
      model,
      map,
      "dbPerService",
    );

    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix dbPerService");
    expect(msg).toContain("orders");
    expect(msg).toContain("no public API");
    expect(msg).toContain("fulfillment_api");
    expect(msg).toContain("orders_db");
  });

  it("warns when only candidate IS the owner — distinct from no-API case", () => {
    const db = makeDb("orders_db");
    const owner = makeContainer("orders_only_svc", [{ to: db }]);
    const bcOrders = makeBoundary("orders", [owner, db]);
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);
    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    resolveRedirectTarget(
      accessor,
      db,
      owner,
      "ContainerDb",
      ["repo"],
      model,
      map,
      "crud",
    );

    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud");
    expect(msg).toContain("only public API candidate");
    expect(msg).toContain("repo owner");
    expect(msg).toContain("fulfillment_api");
  });

  it("ties are broken by toSorted order when in-degrees are equal", () => {
    // Both candidates have the same in-degree (0). Stryker mutated the
    // sort `(inDegree(b) ?? 0) - (inDegree(a) ?? 0)` — if the comparator
    // breaks, an arbitrary candidate is picked. Assert that we still
    // return SOMETHING in that case (no throw) and it's one of the two
    // candidates — guarding the function from regressions where the
    // comparator returns NaN.
    const apiA = makeContainer("a_api");
    const apiB = makeContainer("b_api");
    const db = makeDb("orders_db");
    const bc = makeBoundary("bc", [apiA, apiB, db]);
    const model = makeModel([bc]);
    const map = buildContainerBoundaryMap(model);

    const result = findPublicApiCandidate(
      bc,
      "ContainerDb",
      ["repo"],
      model,
      map,
    );
    expect([apiA, apiB]).toContain(result);
  });

  it("returns undefined when cross-boundary has no public API", () => {
    const db = makeDb("orders_db");
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const bcOrders = makeBoundary("orders", [repo, db]);

    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);

    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);

    expect(
      resolveRedirectTarget(
        accessor,
        db,
        repo,
        "ContainerDb",
        ["repo"],
        model,
        map,
        "test",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when public API candidate is the owner itself", () => {
    const db = makeDb("orders_db");
    // repo is both the owner and the only non-db container in the boundary
    const repo = makeContainer("orders_relay", [{ to: db }], ["relay"]);
    const bcOrders = makeBoundary("orders", [repo, db]);

    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);

    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);

    expect(
      resolveRedirectTarget(
        accessor,
        db,
        repo,
        "ContainerDb",
        ["repo", "relay"],
        model,
        map,
        "test",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the only non-db candidate IS the owner (fallback owner path)", () => {
    // fixDbPerService can fall back to a non-tagged first accessor as owner.
    // If that accessor is also the sole non-db container in the boundary,
    // findPublicApiCandidate returns it (it isn't filtered out by ownerTags),
    // and resolveRedirectTarget must catch the `publicApi === owner` branch
    // and bail with a warning instead of redirecting to itself.
    const db = makeDb("orders_db");
    const owner = makeContainer("orders_only_svc", [{ to: db }]); // NO repo/relay tag
    const bcOrders = makeBoundary("orders", [owner, db]);

    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const bcFulfillment = makeBoundary("fulfillment", [accessor]);

    const model = makeModel([bcOrders, bcFulfillment]);
    const map = buildContainerBoundaryMap(model);

    expect(
      resolveRedirectTarget(
        accessor,
        db,
        owner,
        "ContainerDb",
        ["repo"],
        model,
        map,
        "test",
      ),
    ).toBeUndefined();
  });
});
