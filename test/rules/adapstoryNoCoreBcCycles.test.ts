import type { ArchitectureModel, Container } from "../../src/model";
import { checkAdapstoryNoCoreBcCycles } from "../../src/rules";

const container = (
    name: string,
    tags: string[],
    relations: Container["relations"] = [],
): Container => ({
    name,
    label: name,
    type: "Container",
    tags,
    description: "",
    relations,
});

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

describe("checkAdapstoryNoCoreBcCycles", () => {
    it("detects dependency cycles between core bounded contexts", () => {
        const dataModelEngine = container("data_model_engine", ["bc-15"]);
        const multiTenantRuntime = container("multi_tenant_runtime", ["bc-19"]);
        const pluginLifecycle = container("plugin_lifecycle", ["bc-02"]);

        dataModelEngine.relations.push({ to: multiTenantRuntime });
        multiTenantRuntime.relations.push({ to: pluginLifecycle });
        pluginLifecycle.relations.push({ to: dataModelEngine });

        const violations = checkAdapstoryNoCoreBcCycles(
            model([dataModelEngine, multiTenantRuntime, pluginLifecycle]),
        );

        expect(violations).toEqual([
            {
                container: "bc-02",
                message:
                    "core bounded context cycle detected: bc-02 -> bc-15 -> bc-19 -> bc-02",
            },
        ]);
    });

    it("ignores cycles inside one bounded context", () => {
        const api = container("identity_api", ["bc-16"]);
        const adapter = container("identity_adapter", ["bc-16"]);
        api.relations.push({ to: adapter });
        adapter.relations.push({ to: api });

        expect(
            checkAdapstoryNoCoreBcCycles(model([api, adapter])),
        ).toHaveLength(0);
    });

    it("ignores non-core plugin cycles by default", () => {
        const pluginA = container("plugin_a", ["plugin"]);
        const pluginB = container("plugin_b", ["plugin"]);
        pluginA.relations.push({ to: pluginB });
        pluginB.relations.push({ to: pluginA });

        expect(
            checkAdapstoryNoCoreBcCycles(model([pluginA, pluginB])),
        ).toHaveLength(0);
    });
});
