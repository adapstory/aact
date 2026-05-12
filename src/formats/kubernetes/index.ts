import type { Format } from "../types";
import { generate } from "./generate";

/**
 * Kubernetes — generate only в v3.0. K8s manifests это deployment artifact,
 * не authoring source. Reverse-engineering (k8s → Model) — niche use case,
 * может быть добавлен в v3.x как `load` capability.
 *
 * V2 utilities `loadDeployConfigs` / `mapFromConfigs` / `DeployConfig`
 * helpers удалены — они моделировали env-var → relation heuristic, который
 * не fit'ит generic C4 reverse engineering. Когда понадобится k8s load —
 * будет proper Service/Deployment/NetworkPolicy → Model mapping.
 */
export const kubernetesFormat: Format = {
  name: "kubernetes",
  generate,
};
