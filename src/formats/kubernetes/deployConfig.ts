/**
 * Kubernetes-internal types для парсинга microservice deploy yamls.
 * Section представляет one env var → service dependency mapping
 * (heuristic: `*_BASE_URL`, `KAFKA_*_TOPIC`, `PG_CONNECTION_STRING` etc.).
 *
 * Не модель архитектуры — это intermediate представление при load'е.
 * Live в k8s format namespace, не в core Model (k8s — IaC artifact, не
 * proper C4 source).
 */
export interface Section {
  readonly name: string;
  readonly prod_value: string;
}

export interface EnvValue {
  prod?: string;
  default?: string;
}

export interface DeployConfig {
  name: string;
  fileName?: string;
  readonly environment?: Record<string, EnvValue>;
  sections: Section[];
}
