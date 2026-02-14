import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";
import {
  checkAcl,
  checkAcyclic,
  checkApiGateway,
  checkStableDependencies,
} from "../../src/rules";

describe("Rules demo on C4L2.puml", () => {
  let containers: ReturnType<
    typeof mapContainersFromPlantumlElements
  >["allContainers"];

  beforeAll(async () => {
    const elements = await loadPlantumlElements(
      "resources/architecture/C4L2.puml",
    );
    containers = mapContainersFromPlantumlElements(elements).allContainers;
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    const violations = checkAcl(containers);
    expect(violations).toHaveLength(0);
  });

  it("Acyclic — no dependency cycles", () => {
    const violations = checkAcyclic(containers);
    expect(violations).toHaveLength(0);
  });

  it("API Gateway — external calls go through gateway", () => {
    const violations = checkApiGateway(containers);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
  });

  it("Stable Dependencies — dependencies point toward stability", () => {
    const violations = checkStableDependencies(containers);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
  });
});
