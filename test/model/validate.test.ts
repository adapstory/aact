import {
  buildModel,
  isDuplicateContainer,
  validateModel,
} from "../../src/model";

describe("validateModel", () => {
  it("returns no issues for valid model", () => {
    const { model } = buildModel({
      containers: [
        {
          name: "a",
          label: "a",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [{ to: "b", tags: [] }],
        },
        {
          name: "b",
          label: "b",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(validateModel(model)).toEqual([]);
  });

  it("flags unknown kind on a container", () => {
    const { model, issues } = buildModel({
      containers: [
        {
          name: "x",
          label: "x",
          kind: "Mystery" as never,
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    const allIssues = [...issues, ...validateModel(model)];
    expect(allIssues).toContainEqual({
      kind: "unknown-kind",
      container: "x",
      raw: "Mystery",
    });
  });

  it("flags self-relation", () => {
    const { model } = buildModel({
      containers: [
        {
          name: "loop",
          label: "loop",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [{ to: "loop", tags: [] }],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(validateModel(model)).toContainEqual({
      kind: "self-relation",
      container: "loop",
    });
  });

  it("flags dangling-relation", () => {
    const { model } = buildModel({
      containers: [
        {
          name: "a",
          label: "a",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [{ to: "ghost", tags: [] }],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(validateModel(model)).toContainEqual({
      kind: "dangling-relation",
      from: "a",
      to: "ghost",
    });
  });

  it("flags container-in-boundary-not-in-model", () => {
    const { model } = buildModel({
      containers: [],
      boundaries: [
        {
          name: "b1",
          label: "b1",
          kind: "System",
          tags: [],
          containerNames: ["ghost"],
          boundaryNames: [],
        },
      ],
      rootBoundaryNames: ["b1"],
    });
    expect(validateModel(model)).toContainEqual({
      kind: "container-in-boundary-not-in-model",
      container: "ghost",
      boundary: "b1",
    });
  });

  it("flags boundary-not-in-model for unknown child boundary", () => {
    const { model } = buildModel({
      containers: [],
      boundaries: [
        {
          name: "parent",
          label: "parent",
          kind: "System",
          tags: [],
          containerNames: [],
          boundaryNames: ["ghost_child"],
        },
      ],
      rootBoundaryNames: ["parent"],
    });
    expect(validateModel(model)).toContainEqual({
      kind: "boundary-not-in-model",
      parent: "parent",
      child: "ghost_child",
    });
  });

  it("detects boundary cycle and emits dedup'd boundary-cycle issue", () => {
    const { model } = buildModel({
      containers: [],
      boundaries: [
        {
          name: "a",
          label: "a",
          kind: "System",
          tags: [],
          containerNames: [],
          boundaryNames: ["b"],
        },
        {
          name: "b",
          label: "b",
          kind: "System",
          tags: [],
          containerNames: [],
          boundaryNames: ["a"],
        },
      ],
      rootBoundaryNames: ["a"],
    });
    const cycles = validateModel(model).filter(
      (i) => i.kind === "boundary-cycle",
    );
    expect(cycles).toHaveLength(1);
  });

  it("isDuplicateContainer returns true for existing name", () => {
    const containers = {
      a: {} as never,
      b: {} as never,
    };
    expect(isDuplicateContainer(containers, "a")).toBe(true);
    expect(isDuplicateContainer(containers, "c")).toBe(false);
  });

  it("buildModel emits duplicate-container-name issue", () => {
    const { issues } = buildModel({
      containers: [
        {
          name: "dup",
          label: "dup",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
        {
          name: "dup",
          label: "dup2",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(issues).toContainEqual({
      kind: "duplicate-container-name",
      name: "dup",
    });
  });

  it("buildModel emits duplicate-boundary-name issue", () => {
    const { issues } = buildModel({
      containers: [],
      boundaries: [
        {
          name: "dup",
          label: "a",
          kind: "System",
          tags: [],
          containerNames: [],
          boundaryNames: [],
        },
        {
          name: "dup",
          label: "b",
          kind: "System",
          tags: [],
          containerNames: [],
          boundaryNames: [],
        },
      ],
      rootBoundaryNames: ["dup"],
    });
    expect(issues).toContainEqual({
      kind: "duplicate-boundary-name",
      name: "dup",
    });
  });

  it("forwards preIssues from loader through buildModel result", () => {
    const { issues } = buildModel({
      containers: [],
      boundaries: [],
      rootBoundaryNames: [],
      preIssues: [{ kind: "unknown-kind", container: "x", raw: "Mystery" }],
    });
    expect(issues).toContainEqual({
      kind: "unknown-kind",
      container: "x",
      raw: "Mystery",
    });
  });
});
