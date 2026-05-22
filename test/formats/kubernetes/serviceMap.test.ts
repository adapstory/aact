import { buildServiceMap } from "../../../src/formats/kubernetes/serviceMap";
import type { ParsedManifest } from "../../../src/formats/kubernetes/types";

const buildWorkloadSpec = (
  kind: string,
  labels: Record<string, string>,
): Record<string, unknown> => {
  if (kind === "Pod") return { containers: [{ image: "x" }] };
  if (kind === "CronJob") {
    return {
      jobTemplate: {
        spec: { template: { metadata: { labels }, spec: {} } },
      },
    };
  }
  return { template: { metadata: { labels }, spec: {} } };
};

const workload = (
  name: string,
  labels: Record<string, string>,
  kind = "Deployment",
): ParsedManifest => ({
  filePath: "x.yaml",
  docIndex: 0,
  apiVersion: "apps/v1",
  kind,
  metadata: { name, labels: {}, annotations: {} },
  spec: buildWorkloadSpec(kind, labels),
  raw: {},
});

const podWorkload = (
  name: string,
  labels: Record<string, string>,
): ParsedManifest => ({
  filePath: "x.yaml",
  docIndex: 0,
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name, labels, annotations: {} },
  spec: { containers: [{ image: "x" }] },
  raw: {},
});

const service = (
  name: string,
  selector: Record<string, string>,
): ParsedManifest => ({
  filePath: "x.yaml",
  docIndex: 0,
  apiVersion: "v1",
  kind: "Service",
  metadata: { name, labels: {}, annotations: {} },
  spec: { selector },
  raw: {},
});

describe("buildServiceMap — selector → workload resolution", () => {
  it("matches Service to a single Deployment by app label", () => {
    const orders = workload("orders-dep", { app: "orders" });
    const svc = service("orders-svc", { app: "orders" });
    const map = buildServiceMap([orders, svc], new Map([[orders, "orders"]]));
    expect(map.byName.get("orders-svc")).toEqual(["orders"]);
  });

  it("matches Service to multiple workloads with same labels", () => {
    const a = workload("a-dep", { app: "shared" });
    const b = workload("b-dep", { app: "shared" }, "StatefulSet");
    const svc = service("shared-svc", { app: "shared" });
    const map = buildServiceMap(
      [a, b, svc],
      new Map([
        [a, "a"],
        [b, "b"],
      ]),
    );
    expect([...(map.byName.get("shared-svc") ?? [])].toSorted()).toEqual([
      "a",
      "b",
    ]);
  });

  it("requires all selector keys to match (AND semantics)", () => {
    const a = workload("a", { app: "orders", tier: "backend" });
    const b = workload("b", { app: "orders" }); // tier missing
    const svc = service("svc", { app: "orders", tier: "backend" });
    const map = buildServiceMap(
      [a, b, svc],
      new Map([
        [a, "a"],
        [b, "b"],
      ]),
    );
    expect(map.byName.get("svc")).toEqual(["a"]);
  });

  it("empty selector matches nothing (k8s spec safety)", () => {
    const a = workload("a", { app: "orders" });
    const svc = service("svc", {});
    const map = buildServiceMap([a, svc], new Map([[a, "a"]]));
    expect(map.byName.get("svc")).toBeUndefined();
  });

  it("Pod uses metadata.labels, not template.metadata.labels", () => {
    const pod = podWorkload("pod-x", { app: "orders" });
    const svc = service("svc", { app: "orders" });
    const map = buildServiceMap([pod, svc], new Map([[pod, "pod-x"]]));
    expect(map.byName.get("svc")).toEqual(["pod-x"]);
  });

  it("CronJob looks at jobTemplate.spec.template.metadata.labels", () => {
    const cj = workload("cron", { app: "batch" }, "CronJob");
    const svc = service("svc", { app: "batch" });
    const map = buildServiceMap([cj, svc], new Map([[cj, "cron"]]));
    expect(map.byName.get("svc")).toEqual(["cron"]);
  });

  it("skips workloads not in element name map (filtered out)", () => {
    const a = workload("a", { app: "orders" });
    const svc = service("svc", { app: "orders" });
    // Empty map → no workloads to match
    const map = buildServiceMap([a, svc], new Map());
    expect(map.byName.get("svc")).toBeUndefined();
  });

  it("ignores Service without selector", () => {
    const a = workload("a", { app: "orders" });
    const svc: ParsedManifest = {
      filePath: "x.yaml",
      docIndex: 0,
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "svc", labels: {}, annotations: {} },
      spec: {},
      raw: {},
    };
    const map = buildServiceMap([a, svc], new Map([[a, "a"]]));
    expect(map.byName.size).toBe(0);
  });
});
