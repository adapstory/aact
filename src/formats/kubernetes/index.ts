import type { Format } from "../types";
import { generate } from "./generate";

/**
 * Kubernetes формат — generate only в v3.0. K8s manifests это deployment
 * artifact, не authoring source — Solution Architect не пишет k8s yamls
 * чтобы описать архитектуру. Reverse-engineering (k8s → Model) — niche use
 * case, может быть добавлен additive в v3.x как load capability.
 *
 * Utility functions loadMicroserviceDeployConfigs / mapFromConfigs остаются
 * экспортированными для users-as-library, которые делают custom k8s analysis,
 * но через aact CLI как source не доступны.
 */
export const kubernetesFormat: Format = {
  name: "kubernetes",
  generate,
};


export type { DeployConfig, EnvValue, Section } from "./deployConfig";
export {generate} from "./generate";
export { loadMicroserviceDeployConfigs } from "./loadMicroserviceDeployConfigs";
export {
  type KubernetesMapOptions,
  mapFromConfigs,
} from "./mapContainersFromDeployConfigs";