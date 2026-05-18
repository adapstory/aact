import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import path from "pathe";

import { generate } from "../../../src/formats/plantuml/generate";
import { load } from "../../../src/formats/plantuml/load";
import type { Container, Model, Relation } from "../../../src/model";
import { allContainers } from "../../../src/model";
import { makeModel } from "../../helpers/makeModel";

/**
 * F3 — load → generate → load = identity (для PUML format).
 *
 * Это THE confidence test для format API: если round-trip ломается —
 * generator теряет данные или loader восстанавливает не идентично.
 * v2 имел такие баги (descr в techn slot, sprite-as-tags fallback на real
 * sprites) — round-trip их сразу подсветил бы.
 *
 * В v3 `Container.name` / `Boundary.name` — это display name (то же, что
 * label). PUML alias slot стампится loader'ом в `properties["plantuml.alias"]`
 * (а не как имя). Fixture здесь строится «вручную» без properties — поэтому
 * `normalize` намеренно исключает properties: иначе rebuilt (с alias-stamp)
 * никогда не сравняется с original (без).
 */

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "aact-rt-"));
});

/**
 * Normalize Container в plain object с deterministic relations order.
 * Поля которые мы заведомо НЕ переносим через round-trip (см. known gaps
 * в load.test.ts) — исключаем: properties, sourceLocation, order на relation.
 */
const normalizeContainer = (c: Container) => ({
  name: c.name,
  label: c.label,
  kind: c.kind,
  external: c.external,
  description: c.description,
  technology: c.technology,
  tags: [...c.tags].toSorted(),
  sprite: c.sprite,
  link: c.link,
  relations: c.relations
    .map(normalizeRelation)
    .toSorted((a, b) =>
      `${a.to}|${a.description}`.localeCompare(`${b.to}|${b.description}`),
    ),
});

const normalizeRelation = (r: Relation) => ({
  to: r.to,
  description: r.description,
  technology: r.technology,
  tags: [...r.tags].toSorted(),
  sprite: r.sprite,
  link: r.link,
});

const normalize = (model: Model) => ({
  containers: allContainers(model)
    .map(normalizeContainer)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  boundaries: Object.values(model.boundaries)
    .map((b) => ({
      name: b.name,
      label: b.label,
      kind: b.kind,
      tags: [...b.tags].toSorted(),
      containerNames: [...b.containerNames].toSorted(),
      boundaryNames: [...b.boundaryNames].toSorted(),
      link: b.link,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  rootBoundaryNames: [...model.rootBoundaryNames].toSorted(),
});

let rtCounter = 0;
const roundTrip = async (model: Model): Promise<Model> => {
  const generated = generate(model);
  const file = path.join(tmpDir, `rt-${++rtCounter}.puml`);
  await writeFile(file, generated.files[0].content, "utf8");
  const { model: reloaded } = await load(file);
  return reloaded;
};

describe("PlantUML round-trip integrity (F3)", () => {
  it("preserves a flat container model", async () => {
    const original = makeModel({
      containers: [
        { name: "Orders API", label: "Orders API", technology: "Java" },
        { name: "Orders DB", label: "Orders DB", kind: "ContainerDb" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves a container with all fields populated", async () => {
    const original = makeModel({
      containers: [
        {
          name: "Service",
          label: "Service",
          kind: "Container",
          technology: "Node 22",
          description: "Backend API",
          tags: ["public", "production"],
          sprite: "node-logo",
          link: "https://wiki.example.com/svc",
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves Person and System contexts (no techn slot)", async () => {
    const original = makeModel({
      containers: [
        { name: "End User", label: "End User", kind: "Person" },
        { name: "Core System", label: "Core System", kind: "System" },
        {
          name: "External API",
          label: "External API",
          kind: "System",
          external: true,
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves all ContainerKind variants (Db, Queue, Component)", async () => {
    const original = makeModel({
      containers: [
        { name: "API", label: "API", kind: "Container" },
        { name: "DB", label: "DB", kind: "ContainerDb" },
        { name: "Queue", label: "Queue", kind: "ContainerQueue" },
        { name: "Comp", label: "Comp", kind: "Component" },
        { name: "Comp DB", label: "Comp DB", kind: "ComponentDb" },
        { name: "Comp Queue", label: "Comp Queue", kind: "ComponentQueue" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves external flag across all kinds", async () => {
    const original = makeModel({
      containers: [
        {
          name: "Ext Person",
          label: "Ext Person",
          kind: "Person",
          external: true,
        },
        { name: "Ext Sys", label: "Ext Sys", kind: "System", external: true },
        {
          name: "Ext Container",
          label: "Ext Container",
          kind: "Container",
          external: true,
        },
        {
          name: "Ext ContainerDb",
          label: "Ext ContainerDb",
          kind: "ContainerDb",
          external: true,
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves relations with all field variants", async () => {
    const original = makeModel({
      containers: [
        {
          name: "A",
          label: "A",
          relations: [
            { to: "B", description: "calls" },
            {
              to: "C",
              description: "publishes",
              technology: "Kafka",
              tags: ["async", "critical"],
            },
            { to: "D", link: "https://docs.example.com/d" },
          ],
        },
        { name: "B", label: "B" },
        { name: "C", label: "C" },
        { name: "D", label: "D" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves boundary nesting", async () => {
    const original = makeModel({
      containers: [
        { name: "API", label: "API" },
        { name: "Worker", label: "Worker" },
        { name: "Inner Svc", label: "Inner Svc" },
      ],
      boundaries: [
        {
          name: "Outer",
          label: "Outer",
          boundaryNames: ["Inner"],
          containerNames: ["API", "Worker"],
        },
        {
          name: "Inner",
          label: "Inner",
          containerNames: ["Inner Svc"],
          tags: ["domain"],
        },
      ],
      rootBoundaryNames: ["Outer"],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves cross-boundary relations", async () => {
    const original = makeModel({
      containers: [
        {
          name: "API",
          label: "API",
          relations: [{ to: "External", description: "uses" }],
        },
        {
          name: "External",
          label: "External",
          kind: "System",
          external: true,
        },
      ],
      boundaries: [
        { name: "Platform", label: "Platform", containerNames: ["API"] },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves boundary tags and link", async () => {
    const original = makeModel({
      containers: [{ name: "Svc", label: "Svc" }],
      boundaries: [
        {
          name: "Context",
          label: "Context",
          containerNames: ["Svc"],
          tags: ["domain", "core"],
          link: "https://wiki.example.com/ctx",
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    const before = normalize(original);
    const after = normalize(rebuilt);
    expect(after.boundaries).toEqual(before.boundaries);
  });

  it("preserves real fixture (banking C4L2.puml) through round-trip", async () => {
    // Сильный e2e — берём настоящий fixture, который v2 users могли иметь.
    const { model: fixtureModel } = await load(
      "fixtures/architecture/C4L2.puml",
    );
    const rebuilt = await roundTrip(fixtureModel);

    // Container count + name set must match exactly.
    expect(Object.keys(rebuilt.containers).toSorted()).toEqual(
      Object.keys(fixtureModel.containers).toSorted(),
    );

    // Per container: kind/external/tags/relations должны быть identical
    // (description/technology могут отсутствовать в fixture).
    for (const name of Object.keys(fixtureModel.containers)) {
      const before = fixtureModel.containers[name];
      const after = rebuilt.containers[name];
      expect(after.kind).toBe(before.kind);
      expect(after.external).toBe(before.external);
      expect([...after.tags].toSorted()).toEqual([...before.tags].toSorted());
      expect(after.relations.length).toBe(before.relations.length);
    }
  });
});
