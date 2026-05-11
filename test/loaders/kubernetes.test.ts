import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadMicroserviceDeployConfigs,
  mapFromConfigs,
} from "../../src/loaders/kubernetes";

describe("Kubernetes Loader", () => {
  it("loads deploy configs from YAML files", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    expect(configs.length).toBeGreaterThan(0);
  });

  it("assigns fileName from file path", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    expect(configs.every((c) => c.fileName)).toBe(true);
  });

  it("parses environment variables", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    const invoiceRepo = configs.find((c) => c.name === "invoice-repository");
    expect(invoiceRepo?.environment).toHaveProperty("PG_CONNECTION_STRING");
  });

  it("maps and sorts configs", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);

    expect(mapped.length).toBe(raw.length);

    const names = mapped.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("normalizes names (replaces dashes with underscores)", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);

    for (const config of mapped) {
      expect(config.name).not.toContain("-");
    }
  });

  it("extracts sections from environment", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);
    const bff = mapped.find((c) => c.name === "bff");

    expect(bff).toBeDefined();
    expect(bff!.sections.length).toBeGreaterThan(0);
  });
});

describe("loadMicroserviceDeployConfigs (unit, fixture)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aact-k8s-"));
  });

  const write = async (name: string, body: string): Promise<void> => {
    await writeFile(path.join(dir, name), body, "utf8");
  };

  it("picks up only .yml and .yaml files (extension filter)", async () => {
    await write("svc1.yml", "name: svc1\n");
    await write("svc2.yaml", "name: svc2\n");
    await write("readme.md", "# not yaml\n");
    await write("script.sh", "#!/bin/sh\n");

    const configs = await loadMicroserviceDeployConfigs({ path: dir });
    const names = configs.map((c) => c.fileName).sort();
    expect(names).toEqual(["svc1", "svc2"]);
  });

  it("excludes filenames containing any exclude pattern (default migrator/platform/citest/tests)", async () => {
    const dir2 = await mkdtemp(path.join(tmpdir(), "aact-k8s-excl-"));
    await writeFile(path.join(dir2, "orders.yml"), "name: orders\n");
    await writeFile(path.join(dir2, "orders-migrator.yml"), "name: m\n");
    await writeFile(path.join(dir2, "platform-shared.yml"), "name: p\n");
    await writeFile(path.join(dir2, "citest-runner.yml"), "name: c\n");
    await writeFile(path.join(dir2, "orders-tests.yml"), "name: t\n");

    const configs = await loadMicroserviceDeployConfigs({ path: dir2 });
    expect(configs.map((c) => c.fileName)).toEqual(["orders"]);
  });

  it("respects custom exclude option", async () => {
    const dir3 = await mkdtemp(path.join(tmpdir(), "aact-k8s-customexcl-"));
    await writeFile(path.join(dir3, "orders.yml"), "name: orders\n");
    await writeFile(path.join(dir3, "skip-me.yml"), "name: skip\n");

    const configs = await loadMicroserviceDeployConfigs({
      path: dir3,
      exclude: ["skip-me"],
    });
    expect(configs.map((c) => c.fileName)).toEqual(["orders"]);
  });

  it("unwraps `microservice:` nested envelope", async () => {
    const dir4 = await mkdtemp(path.join(tmpdir(), "aact-k8s-nested-"));
    await writeFile(
      path.join(dir4, "wrapped.yml"),
      "microservice:\n  name: orders\n  env:\n    FOO:\n      prod: bar\n",
    );

    const configs = await loadMicroserviceDeployConfigs({ path: dir4 });
    expect(configs[0].name).toBe("orders");
    expect(configs[0].environment).toHaveProperty("FOO");
  });

  it("translates `env:` key to `environment:` during parse", async () => {
    const dir5 = await mkdtemp(path.join(tmpdir(), "aact-k8s-env-"));
    await writeFile(
      path.join(dir5, "svc.yml"),
      "name: orders\nenv:\n  PG_CONNECTION_STRING:\n    prod: pg://x\n",
    );

    const configs = await loadMicroserviceDeployConfigs({ path: dir5 });
    expect(configs[0].environment).toHaveProperty("PG_CONNECTION_STRING");
  });
});

describe("mapFromConfigs (unit)", () => {
  it("filters environment by default whitelist (BASE_URL, _TOPIC, etc.)", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          PAYMENTS_BASE_URL: { prod: "http://pay" },
          KAFKA_ORDERS_TOPIC: { prod: "orders-v1" },
          IGNORED_VAR: { prod: "ignored" },
        },
      },
    ]);
    const names = mapped[0].sections.map((s) => s.name);
    expect(names.some((n) => n.includes("payments"))).toBe(true);
    expect(names.some((n) => n.includes("orders"))).toBe(true);
    expect(names.some((n) => n.includes("ignored"))).toBe(false);
  });

  it("strips _BASE_URL from env names (default cleanup)", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          PAYMENTS_BASE_URL: { prod: "http://pay" },
          BILLING_BASE_URL: { prod: "http://bill" },
        },
      },
    ]);
    const names = mapped[0].sections.map((s) => s.name);
    expect(names).toContain("payments");
    expect(names).toContain("billing");
  });

  it("strips _API/_CLIENT/_PROTOCOL when present in an otherwise-whitelisted name", () => {
    // The default whitelist is matched first (BASE_URL, _TOPIC, etc.) —
    // cleanup is applied to surviving keys. Compose a name that hits both:
    // it contains BASE_URL (whitelist) AND _API_CLIENT_PROTOCOL fragments.
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          ORDERS_API_CLIENT_PROTOCOL_BASE_URL: { prod: "http://ord" },
        },
      },
    ]);
    const name = mapped[0].sections[0].name;
    // All cleanup parts removed; left with "orders" (lowercased).
    expect(name).toBe("orders");
  });

  it("strips _KAFKA_*_TOPIC via regex", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          ORDERS_KAFKA_EVENTS_TOPIC: { prod: "events-v1" },
        },
      },
    ]);
    expect(mapped[0].sections.map((s) => s.name)).toContain("orders");
  });

  it("uses prod value first, falls back to default", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          PAYMENTS_BASE_URL: { prod: "http://prod", default: "http://dev" },
          BILLING_BASE_URL: { default: "http://bill-default" },
        },
      },
    ]);
    const sections = mapped[0].sections;
    const payments = sections.find((s) => s.name === "payments");
    const billing = sections.find((s) => s.name === "billing");
    expect(payments?.prod_value).toBe("http://prod");
    expect(billing?.prod_value).toBe("http://bill-default");
  });

  it("falls back to empty string when neither prod nor default is set", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          PAYMENTS_BASE_URL: {},
        },
      },
    ]);
    expect(mapped[0].sections[0].prod_value).toBe("");
  });

  it("lowercases section names", () => {
    const mapped = mapFromConfigs([
      {
        fileName: "svc",
        environment: {
          UPPER_BASE_URL: { prod: "x" },
        },
      },
    ]);
    expect(mapped[0].sections[0].name).toBe("upper");
  });

  it("uses .name when present and falls back to fileName otherwise", () => {
    const mapped = mapFromConfigs([
      { name: "explicit", fileName: "implicit", environment: {} },
      { fileName: "only-file", environment: {} },
    ]);
    const names = mapped.map((c) => c.name);
    expect(names).toContain("explicit");
    expect(names).toContain("only_file"); // dash → underscore
  });

  it("replaces spaces, dashes and parens in name with underscores", () => {
    const mapped = mapFromConfigs([
      { name: "my service (v2)", fileName: "svc", environment: {} },
    ]);
    expect(mapped[0].name).toBe("my_service__v2_");
  });

  it("sorts output by name", () => {
    const mapped = mapFromConfigs([
      { fileName: "z", environment: {} },
      { fileName: "a", environment: {} },
      { fileName: "m", environment: {} },
    ]);
    expect(mapped.map((c) => c.name)).toEqual(["a", "m", "z"]);
  });

  it("accepts custom envWhitelist option", () => {
    const mapped = mapFromConfigs(
      [
        {
          fileName: "svc",
          environment: {
            CUSTOM_FLAG: { prod: "v" },
            PAYMENTS_BASE_URL: { prod: "p" },
          },
        },
      ],
      { envWhitelist: ["CUSTOM_FLAG"] },
    );
    const names = mapped[0].sections.map((s) => s.name);
    expect(names).toContain("custom_flag");
    expect(names).not.toContain("payments");
  });

  it("accepts custom envNamePartsToCleanup option", () => {
    const mapped = mapFromConfigs(
      [
        {
          fileName: "svc",
          environment: {
            PAYMENTS_BASE_URL: { prod: "p" },
          },
        },
      ],
      { envWhitelist: ["BASE_URL"], envNamePartsToCleanup: ["_BASE_URL"] },
    );
    expect(mapped[0].sections.map((s) => s.name)).toContain("payments");
  });
});
