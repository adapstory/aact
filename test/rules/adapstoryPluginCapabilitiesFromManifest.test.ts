import type { ArchitectureModel, Container } from "../../src/model";
import { checkAdapstoryPluginCapabilitiesFromManifest } from "../../src/rules";

const container = (
    name: string,
    tags: string[] = [],
    description = "",
): Container => ({
    name,
    label: name,
    type: "Container",
    tags,
    description,
    relations: [],
});

const model = (containers: Container[]): ArchitectureModel => ({
    boundaries: [],
    allContainers: containers,
});

describe("checkAdapstoryPluginCapabilitiesFromManifest", () => {
    it("rejects plugin capability surfaces without manifest or reviewed overlay provenance", () => {
        const plugin = container("telegram_channel_plugin", [
            "plugin",
            "python-plugin-service",
        ]);

        expect(
            checkAdapstoryPluginCapabilitiesFromManifest(model([plugin])),
        ).toEqual([
            {
                container: "telegram_channel_plugin",
                message:
                    'plugin capability surface "telegram_channel_plugin" lacks manifest or reviewed overlay provenance',
            },
        ]);
    });

    it("allows plugin capabilities sourced from manifest", () => {
        const plugin = container("ai_grader", [
            "plugin",
            "python-plugin-service",
            "source:plugin-manifest",
        ]);

        expect(
            checkAdapstoryPluginCapabilitiesFromManifest(model([plugin])),
        ).toHaveLength(0);
    });

    it("allows reviewed overlay provenance", () => {
        const capability = container(
            "legacy_model_connector",
            ["capability"],
            "Model config reviewed-overlay provenance.",
        );

        expect(
            checkAdapstoryPluginCapabilitiesFromManifest(model([capability])),
        ).toHaveLength(0);
    });

    it("checks plugin capability components even when plugin tag is missing", () => {
        const capability = container(
            "unknown",
            ["python-service"],
            "Plugin capability component for /.",
        );

        expect(
            checkAdapstoryPluginCapabilitiesFromManifest(model([capability])),
        ).toHaveLength(1);
    });

    it("ignores ordinary model-named services", () => {
        const service = container("data_model_engine", [
            "api",
            "bc-15",
            "java-service",
        ]);

        expect(
            checkAdapstoryPluginCapabilitiesFromManifest(model([service])),
        ).toHaveLength(0);
    });
});
