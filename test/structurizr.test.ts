import { ArchitectureModel, Container, Relation } from "../src/entities";
import { loadStructurizrElements } from "../src/structurizr";

const SystemExternalType = "System_Ext";
const ContainerDbType = "ContainerDb";
const ContainerType = "Container";

describe("Structurizr Architecture Rules", () => {
  let result: ArchitectureModel;
  let containers: Container[];

  beforeAll(async () => {
    result = await loadStructurizrElements("workspace.json");
    containers = result.allContainers;
  });

  describe("Model Loading", () => {
    it("loads containers from workspace.json", () => {
      expect(containers.length).toBeGreaterThan(0);
      console.log(`Loaded ${containers.length} containers`);
    });

    it("identifies external systems", () => {
      const externalSystems = containers.filter(
        (c) => c.type === SystemExternalType,
      );
      expect(externalSystems.length).toBeGreaterThan(0);
      console.log(
        `External systems: ${externalSystems.map((s) => s.name).join(", ")}`,
      );
    });

    it("identifies databases", () => {
      const databases = containers.filter((c) => c.type === ContainerDbType);
      expect(databases.length).toBeGreaterThan(0);
      console.log(`Databases: ${databases.map((d) => d.name).join(", ")}`);
    });
  });

  describe("Anti-corruption Layer (ACL)", () => {
    it("only acl can depend on external systems", () => {
      const violations: string[] = [];

      for (const container of containers) {
        // Skip Person, external systems
        if (
          container.type === "Person" ||
          container.type === SystemExternalType
        ) {
          continue;
        }

        const externalRelations = container.relations.filter(
          (r) => r.to.type === SystemExternalType,
        );

        if (!container.tags?.includes("acl") && externalRelations.length > 0) {
          violations.push(
            `${container.name} -> ${externalRelations.map((r) => r.to.name).join(", ")}`,
          );
        }
      }

      if (violations.length > 0) {
        console.log("ACL violations:", violations);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe("Passive CRUD Services", () => {
    it("only repo can access database", () => {
      const violations: string[] = [];

      for (const container of containers) {
        const dbRelations = container.relations.filter(
          (r) => r.to.type === ContainerDbType,
        );

        if (dbRelations.length > 0 && !container.tags?.includes("repo")) {
          violations.push(
            `${container.name} -> ${dbRelations.map((r) => r.to.name).join(", ")}`,
          );
        }
      }

      if (violations.length > 0) {
        console.log("CRUD violations (non-repo accessing DB):", violations);
      }
      expect(violations).toHaveLength(0);
    });

    it("repo has no dependencies except its database", () => {
      const violations: string[] = [];

      for (const container of containers) {
        if (!container.tags?.includes("repo")) continue;

        const nonDbRelations = container.relations.filter(
          (r) => r.to.type !== ContainerDbType,
        );

        if (nonDbRelations.length > 0) {
          violations.push(
            `${container.name} -> ${nonDbRelations.map((r) => r.to.name).join(", ")}`,
          );
        }
      }

      if (violations.length > 0) {
        console.log("CRUD violations (repo has extra deps):", violations);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe("Database per Service", () => {
    it("each database is accessed by only one service", () => {
      const dbAccessMap = new Map<string, string[]>();

      for (const container of containers) {
        for (const rel of container.relations) {
          if (rel.to.type === ContainerDbType) {
            const accessors = dbAccessMap.get(rel.to.name) ?? [];
            accessors.push(container.name);
            dbAccessMap.set(rel.to.name, accessors);
          }
        }
      }

      const violations: string[] = [];
      for (const [db, accessors] of dbAccessMap) {
        if (accessors.length > 1) {
          violations.push(`${db} accessed by: ${accessors.join(", ")}`);
        }
      }

      if (violations.length > 0) {
        console.log("Database per Service violations:", violations);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe("API Gateway", () => {
    it("external REST calls go through gateway", () => {
      const violations: string[] = [];
      const gatewayPattern = /gateway/i;

      for (const container of containers) {
        if (!container.tags?.includes("acl")) continue;

        for (const rel of container.relations) {
          if (rel.to.type !== SystemExternalType) continue;

          // Check if technology contains gateway URL
          const tech = rel.technology ?? "";
          if (tech.startsWith("http") && !gatewayPattern.test(tech)) {
            violations.push(
              `${container.name} -> ${rel.to.name} via ${tech} (not through gateway)`,
            );
          }
        }
      }

      if (violations.length > 0) {
        console.log("API Gateway violations:", violations);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe("Acyclic Dependencies Principle", () => {
    it("no cycles in dependency graph", () => {
      const violations: string[] = [];

      const findCycle = (
        relations: Relation[],
        sourceContainerName: string,
        visited: Set<string> = new Set(),
      ): boolean => {
        for (const rel of relations) {
          if (rel.to.name === sourceContainerName) {
            return true;
          }
          if (visited.has(rel.to.name)) continue;
          visited.add(rel.to.name);

          if (findCycle(rel.to.relations, sourceContainerName, visited)) {
            return true;
          }
        }
        return false;
      };

      for (const container of containers) {
        if (findCycle(container.relations, container.name)) {
          violations.push(container.name);
        }
      }

      if (violations.length > 0) {
        console.log("Cyclic dependency violations:", violations);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe("Async Communication", () => {
    it("identifies async relations", () => {
      const asyncRelations = containers.flatMap((c) =>
        c.relations
          .filter((r) => r.tags?.includes("async"))
          .map((r) => `${c.name} -> ${r.to.name}`),
      );

      console.log(`Async relations: ${asyncRelations.join(", ")}`);
      // This is informational, not a strict requirement
      expect(asyncRelations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Summary", () => {
    it("prints architecture summary", () => {
      const internal = containers.filter((c) => c.type === ContainerType);
      const external = containers.filter((c) => c.type === SystemExternalType);
      const databases = containers.filter((c) => c.type === ContainerDbType);
      const acls = containers.filter((c) => c.tags?.includes("acl"));
      const repos = containers.filter((c) => c.tags?.includes("repo"));

      console.log("\n=== Architecture Summary ===");
      console.log(`Internal containers: ${internal.length}`);
      console.log(`External systems: ${external.length}`);
      console.log(`Databases: ${databases.length}`);
      console.log(`ACL services: ${acls.length}`);
      console.log(`Repository services: ${repos.length}`);
      console.log(
        `Total relations: ${containers.reduce((sum, c) => sum + c.relations.length, 0)}`,
      );
    });
  });
});
