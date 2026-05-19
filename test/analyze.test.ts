import { analyzeArchitecture } from "../src/analyze";
import { makeModel } from "./helpers/makeModel";

describe("analyzeArchitecture", () => {
  const model = makeModel({
    elements: [
      { name: "orders_db", label: "Orders DB", kind: "ContainerDb" },
      {
        name: "ext_payment",
        label: "External Payment",
        kind: "System",
        external: true,
      },
      {
        name: "svc_b",
        label: "Service B",
        relations: [{ to: "orders_db" }],
      },
      {
        name: "svc_a",
        label: "Service A",
        relations: [
          { to: "svc_b", technology: "http" },
          { to: "ext_payment", technology: "https://api.ext.com" },
          { to: "svc_b", tags: ["async"] },
        ],
      },
    ],
    boundaries: [
      {
        name: "project",
        label: "Project",
        elementNames: ["svc_a", "svc_b", "orders_db", "ext_payment"],
      },
    ],
  });

  it("counts elements", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.elementsCount).toBe(4);
  });

  it("counts sync API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svc_a→svc_b (http) and svc_a→ext_payment (external System, non-async)
    expect(report.syncApiCalls).toBe(2);
  });

  it("counts async API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svc_a→svc_b (async tag)
    expect(report.asyncApiCalls).toBe(1);
  });

  it("counts databases", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.databases.count).toBe(1);
    expect(report.databases.consumes).toBe(1);
  });

  it("computes boundary metrics", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.boundaries).toHaveLength(1);
    const b = report.boundaries[0];
    expect(b.name).toBe("project");
    expect(b.cohesion).toBeGreaterThan(0);
  });

  describe("nested boundaries", () => {
    // parent → [domainA (svc1→svc2), domainB (svc3)]
    // svc1→svc2: cohesion for domainA, cohesion for parent
    // svc1→svc3: coupling for domainA (sibling), cohesion for parent
    const nestedModel = makeModel({
      elements: [
        { name: "svc1", relations: [{ to: "svc2" }, { to: "svc3" }] },
        { name: "svc2" },
        { name: "svc3" },
      ],
      boundaries: [
        {
          name: "parent",
          label: "Parent",
          boundaryNames: ["domainA", "domainB"],
        },
        {
          name: "domainA",
          label: "Domain A",
          elementNames: ["svc1", "svc2"],
        },
        { name: "domainB", label: "Domain B", elementNames: ["svc3"] },
      ],
      rootBoundaryNames: ["parent"],
    });

    it("counts cohesion within sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      // svc1→svc2 is internal to domainA
      expect(a.cohesion).toBe(1);
    });

    it("counts coupling to sibling sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      // svc1→svc3 crosses to sibling domainB
      expect(a.coupling).toBe(1);
      expect(a.couplingRelations).toEqual([{ from: "svc1", to: "svc3" }]);
    });

    it("counts parent cohesion for cross-sibling relations", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const p = report.boundaries.find((b) => b.name === "parent")!;
      // svc1→svc3 crosses sibling boundary → parent.cohesion++
      // svc1→svc2 is internal to domainA → only domainA.cohesion, not parent's
      expect(p.cohesion).toBe(1);
      expect(p.coupling).toBe(0);
    });

    it("attributes out-of-parent relation to parent.coupling, not child", () => {
      // svc1 also connects to an external system outside any boundary
      const m = makeModel({
        elements: [
          { name: "svc1", relations: [{ to: "ext" }] },
          { name: "ext", kind: "System", external: true },
        ],
        boundaries: [
          { name: "parent", label: "Parent", boundaryNames: ["domainA"] },
          {
            name: "domainA",
            label: "Domain A",
            elementNames: ["svc1"],
          },
        ],
        rootBoundaryNames: ["parent"],
      });
      const { report } = analyzeArchitecture(m);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      const p = report.boundaries.find((b) => b.name === "parent")!;
      // svc1→ext goes outside parent scope → parent.coupling, not domainA.coupling
      expect(a.coupling).toBe(0);
      expect(p.coupling).toBe(1);
    });
  });
});
