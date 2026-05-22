import type { ElementKind } from "../../model";

/**
 * Image-keyword heuristic для kind detection.
 *
 * Compose не имеет первоклассного способа сказать "это база" /
 * "это очередь" — большинство пользователей просто пишут
 * `image: postgres:13`. Мы извлекаем kind из имени образа по
 * хорошо-известным data-store и messaging keyword'ам.
 *
 * Списки покрывают мейнстрим — добавления через
 * `ComposeLoadOptions.imageHeuristic.{db,queue}` для редких случаев.
 *
 * Heuristic консервативная — на любую неизвестную image возвращаем
 * `Container` (никаких false-positives на DB). Юзер всегда может
 * override через `labels.aact.kind`.
 */

export const DEFAULT_DB_IMAGES: readonly string[] = Object.freeze([
  // SQL
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "percona",
  "cockroachdb",
  "yugabytedb",
  // NoSQL document / key-value
  "mongo",
  "mongodb",
  "couchdb",
  "couchbase",
  "redis",
  "memcached",
  "dragonfly",
  "etcd",
  "consul",
  // Analytical / search / timeseries
  "elasticsearch",
  "opensearch",
  "elastic",
  "clickhouse",
  "cassandra",
  "scylladb",
  "influxdb",
  "timescaledb",
  "questdb",
  // Graph
  "neo4j",
  "dgraph",
  "arangodb",
  // Object / blob
  "minio",
]);

export const DEFAULT_QUEUE_IMAGES: readonly string[] = Object.freeze([
  "kafka",
  "redpanda",
  "pulsar",
  "rabbitmq",
  "activemq",
  "nats",
  "jetstream",
  "nsq",
]);

export interface KindHeuristicLists {
  readonly db: readonly string[];
  readonly queue: readonly string[];
}

/**
 * `baseName` приходит из `parseImage(...).baseName` — lowercased
 * последний segment repo path'а. Поэтому здесь `includes` —
 * exact-match check, не substring.
 */
export const inferKindFromImage = (
  baseName: string,
  lists: KindHeuristicLists,
): ElementKind => {
  if (baseName.length === 0) return "Container";
  if (lists.db.includes(baseName)) return "ContainerDb";
  if (lists.queue.includes(baseName)) return "ContainerQueue";
  return "Container";
};
