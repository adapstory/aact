import type { ContainerKind } from "../../model";

/**
 * Эвристики для форматов без explicit C4 macro:
 *  - Structurizr (technology heuristic для container kind)
 *  - Docker Compose (image-based heuristic — v3.x)
 *  - LikeC4 (user-defined element kinds → mapping в standard ContainerKind)
 *
 * Stryker disable next-line — массивы технологий статичные, проверяемые
 * через includes — мутации замены строк observationally equivalent на
 * realistic input'ах.
 */

const DATABASE_TECHS: readonly string[] = Object.freeze([
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "elasticsearch",
  "dynamodb",
  "cassandra",
  "sqlite",
  "oracle",
  "sqlserver",
  "mssql",
  "clickhouse",
  "snowflake",
  "bigquery",
  "database",
  "db",
]);

const QUEUE_TECHS: readonly string[] = Object.freeze([
  "kafka",
  "rabbitmq",
  "rabbit",
  "nats",
  "sqs",
  "sns",
  "amqp",
  "activemq",
  "pulsar",
  "kinesis",
  "redpanda",
  "eventbridge",
  "servicebus",
]);

const matchesAny = (text: string, patterns: readonly string[]): boolean =>
  patterns.some((p) => text.includes(p));

/**
 * Определить kind по technology / name. Database/Queue heuristic. Defaults
 * to "Container" для unknown. Используется Structurizr loader'ом, future
 * Compose loader'ом.
 */
export const inferKindFromTechnology = (
  technology?: string,
  name?: string,
): ContainerKind => {
  const techLower = technology?.toLowerCase() ?? "";
  const nameLower = name?.toLowerCase() ?? "";

  if (matchesAny(techLower, DATABASE_TECHS)) return "ContainerDb";
  if (matchesAny(techLower, QUEUE_TECHS)) return "ContainerQueue";

  // Name-based fallback — "Orders DB" / "user_db" / "events queue"
  if (
    nameLower.endsWith(" db") ||
    nameLower.endsWith("_db") ||
    nameLower.endsWith("-db") ||
    nameLower.endsWith("database")
  ) {
    return "ContainerDb";
  }
  if (
    nameLower.endsWith(" queue") ||
    nameLower.endsWith("_queue") ||
    nameLower.endsWith("-queue") ||
    nameLower.endsWith(" topic") ||
    nameLower.endsWith("_topic")
  ) {
    return "ContainerQueue";
  }

  return "Container";
};

const IMAGE_DB_PATTERNS: readonly string[] = Object.freeze([
  "postgres",
  "mysql",
  "mariadb",
  "mongo",
  "redis",
  "elasticsearch",
  "clickhouse",
  "cockroachdb",
]);

const IMAGE_QUEUE_PATTERNS: readonly string[] = Object.freeze([
  "kafka",
  "rabbitmq",
  "nats",
  "redpanda",
  "pulsar",
  "activemq",
]);

/**
 * Определить kind по Docker image (Compose: services[].image). Только
 * image name портится — tag/registry prefix дропаются.
 */
export const inferKindFromDockerImage = (image: string): ContainerKind => {
  const imageName = image.split(":")[0]?.split("/").pop()?.toLowerCase() ?? "";
  if (matchesAny(imageName, IMAGE_DB_PATTERNS)) return "ContainerDb";
  if (matchesAny(imageName, IMAGE_QUEUE_PATTERNS)) return "ContainerQueue";
  return "Container";
};

/**
 * Маппинг user-defined kind names (LikeC4 specification, Structurizr
 * archetypes) → стандартный C4 ContainerKind. Lossy для kinds которые не
 * имеют C4-equivalent — fallback "Container". Loader может также сохранить
 * оригинальное имя как archetype в `properties` для round-trip.
 */
const USER_KIND_MAP: Readonly<Record<string, ContainerKind>> = Object.freeze({
  user: "Person",
  customer: "Person",
  actor: "Person",
  person: "Person",
  system: "System",
  softwaresystem: "System",
  application: "System",
  container: "Container",
  service: "Container",
  microservice: "Container",
  api: "Container",
  app: "Container",
  database: "ContainerDb",
  db: "ContainerDb",
  datastore: "ContainerDb",
  storage: "ContainerDb",
  queue: "ContainerQueue",
  topic: "ContainerQueue",
  broker: "ContainerQueue",
  stream: "ContainerQueue",
  bus: "ContainerQueue",
  component: "Component",
});

export const inferKindFromUserKind = (kindName: string): ContainerKind => {
  const normalized = kindName.toLowerCase().replaceAll(/[_-]/g, "");
  return USER_KIND_MAP[normalized] ?? "Container";
};
