import { compileImageHeuristic } from "../../../src/formats/_shared/imageHeuristic";
import {
  inferElementKindFromManifest,
  technologyFromManifest,
} from "../../../src/formats/kubernetes/inferKind";
import type { ParsedManifest } from "../../../src/formats/kubernetes/types";

const buildSpec = (
  kind: string,
  image: string | undefined,
): Record<string, unknown> | undefined => {
  if (image === undefined) return undefined;
  if (kind === "Pod") return { containers: [{ image }] };
  return { template: { spec: { containers: [{ image }] } } };
};

const make = (kind: string, image?: string): ParsedManifest => ({
  filePath: "x.yaml",
  docIndex: 0,
  apiVersion: "apps/v1",
  kind,
  metadata: { name: "x", labels: {}, annotations: {} },
  spec: buildSpec(kind, image),
  raw: {},
});

const compiled = compileImageHeuristic();

describe("inferElementKindFromManifest", () => {
  it("postgres image → ContainerDb", () => {
    expect(
      inferElementKindFromManifest(make("Deployment", "postgres:16"), compiled),
    ).toBe("ContainerDb");
  });

  it("kafka image → ContainerQueue", () => {
    expect(
      inferElementKindFromManifest(make("StatefulSet", "kafka:3"), compiled),
    ).toBe("ContainerQueue");
  });

  it("unknown image → Container", () => {
    expect(
      inferElementKindFromManifest(
        make("Deployment", "ghcr.io/myorg/api:v1"),
        compiled,
      ),
    ).toBe("Container");
  });

  it("missing spec → Container", () => {
    expect(inferElementKindFromManifest(make("Deployment"), compiled)).toBe(
      "Container",
    );
  });

  it("Pod kind sees containers[0] directly under spec", () => {
    expect(inferElementKindFromManifest(make("Pod", "redis:7"), compiled)).toBe(
      "ContainerDb",
    );
  });

  it("user heuristic overrides default", () => {
    const userCompiled = compileImageHeuristic({
      redis: "ContainerQueue", // override default redis=Db
    });
    expect(
      inferElementKindFromManifest(make("Deployment", "redis:7"), userCompiled),
    ).toBe("ContainerQueue");
  });

  it("namespace-prefixed image (bitnami/postgresql) → ContainerDb via baseName", () => {
    expect(
      inferElementKindFromManifest(
        make("Deployment", "bitnami/postgresql:16"),
        compiled,
      ),
    ).toBe("ContainerDb");
  });
});

describe("technologyFromManifest", () => {
  it("returns image without digest", () => {
    expect(
      technologyFromManifest(
        make("Deployment", "ghcr.io/org/api:v1@sha256:abc"),
      ),
    ).toBe("ghcr.io/org/api:v1");
  });

  it("strips library/ namespace prefix", () => {
    expect(
      technologyFromManifest(make("Deployment", "library/postgres:13")),
    ).toBe("postgres:13");
  });

  it("returns undefined when image absent", () => {
    expect(technologyFromManifest(make("Deployment"))).toBeUndefined();
  });
});
