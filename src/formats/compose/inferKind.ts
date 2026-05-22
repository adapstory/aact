import type { ElementKind } from "../../model";

/**
 * Image-pattern → ElementKind matching.
 *
 * Compose не имеет первоклассного способа сказать "это база" /
 * "это очередь" — большинство пользователей просто пишут
 * `image: postgres:13`. Мы извлекаем kind из имени образа по
 * хорошо-известным data-store / messaging keyword'ам.
 *
 * Pattern syntax (per `ComposeLoadOptions.imageHeuristic`):
 *   "postgres"           exact match (vs lowercased baseName)
 *   "*postgres*"         glob — содержит подстроку
 *   "mycompany/db-*"     glob по полному repo path
 *
 * Heuristic консервативная — на любую неизвестную image
 * возвращаем `Container`. Юзер всегда override через
 * `labels.aact.kind` per service.
 */

/**
 * Built-in pattern → ElementKind map. Покрывает majority популярных
 * data-store / messaging images на Docker Hub (по pull statistics
 * 2026). Базовые имена — наш parser извлекает `baseName` через
 * last-segment lowercase, так что namespace prefixes
 * (`bitnami/postgresql`, `chainguard/postgres`, `echo/redis`,
 * `library/postgres`) автоматически совпадают с этими entry'ями.
 *
 * Если default не подходит для конкретного use case (например
 * "redis как pub/sub queue") — override через user
 * `imageHeuristic: { "redis": "ContainerQueue" }`.
 */
export const DEFAULT_IMAGE_HEURISTIC: Readonly<Record<string, ElementKind>> =
  Object.freeze({
    // --- SQL relational ---
    postgres: "ContainerDb",
    postgresql: "ContainerDb",
    postgis: "ContainerDb", // PostgreSQL + GIS extension
    pgvector: "ContainerDb", // PostgreSQL + vector embeddings
    citus: "ContainerDb", // PostgreSQL sharding
    mysql: "ContainerDb",
    mariadb: "ContainerDb",
    percona: "ContainerDb",
    vitess: "ContainerDb", // MySQL sharded
    cockroachdb: "ContainerDb",
    yugabytedb: "ContainerDb",
    mssql: "ContainerDb",
    sqlserver: "ContainerDb",
    "mssql-server": "ContainerDb",
    oracle: "ContainerDb",
    "oracle-xe": "ContainerDb",
    db2: "ContainerDb",
    firebird: "ContainerDb",
    sqlite: "ContainerDb",

    // --- NoSQL document ---
    mongo: "ContainerDb",
    mongodb: "ContainerDb",
    couchdb: "ContainerDb",
    couchbase: "ContainerDb",
    rethinkdb: "ContainerDb",

    // --- KV / cache / in-memory ---
    redis: "ContainerDb",
    valkey: "ContainerDb", // Redis fork (BSD) after license change
    garnet: "ContainerDb", // Microsoft Redis-compatible
    dragonfly: "ContainerDb",
    dragonflydb: "ContainerDb",
    memcached: "ContainerDb",
    hazelcast: "ContainerDb",
    etcd: "ContainerDb", // KV store (config / coordination)

    // --- Search / analytical / OLAP ---
    elasticsearch: "ContainerDb",
    opensearch: "ContainerDb",
    elastic: "ContainerDb",
    meilisearch: "ContainerDb",
    typesense: "ContainerDb",
    solr: "ContainerDb",
    clickhouse: "ContainerDb",
    doris: "ContainerDb",
    druid: "ContainerDb",
    pinot: "ContainerDb",

    // --- Timeseries ---
    influxdb: "ContainerDb",
    timescaledb: "ContainerDb",
    questdb: "ContainerDb",
    victoriametrics: "ContainerDb",
    prometheus: "ContainerDb", // TSDB role
    graphite: "ContainerDb",

    // --- Wide-column ---
    cassandra: "ContainerDb",
    scylladb: "ContainerDb",

    // --- Graph ---
    neo4j: "ContainerDb",
    dgraph: "ContainerDb",
    arangodb: "ContainerDb",
    janusgraph: "ContainerDb",

    // --- Vector DBs (AI-era) ---
    qdrant: "ContainerDb",
    milvus: "ContainerDb",
    weaviate: "ContainerDb",
    chroma: "ContainerDb",
    chromadb: "ContainerDb",

    // --- Object / blob ---
    minio: "ContainerDb",
    seaweedfs: "ContainerDb",

    // --- Streaming / pub-sub queues ---
    kafka: "ContainerQueue",
    redpanda: "ContainerQueue",
    warpstream: "ContainerQueue", // Kafka-compatible serverless
    pulsar: "ContainerQueue",

    // --- Classic message brokers ---
    rabbitmq: "ContainerQueue",
    activemq: "ContainerQueue",
    artemis: "ContainerQueue", // ActiveMQ Artemis
    nats: "ContainerQueue",
    jetstream: "ContainerQueue",
    nsq: "ContainerQueue",

    // --- MQTT brokers ---
    mosquitto: "ContainerQueue",
    emqx: "ContainerQueue",

    // --- Event sourcing ---
    eventstore: "ContainerDb",
    eventstoredb: "ContainerDb",
  });

/** Compiled pattern entry: exact или glob regex. */
export interface CompiledPattern {
  readonly pattern: string;
  readonly kind: ElementKind;
  /** undefined для exact-match; иначе regex обёрнутый из glob. */
  readonly regex?: RegExp;
}

const escapeRegex = (input: string): string =>
  input.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);

const compilePattern = (
  pattern: string,
  kind: ElementKind,
): CompiledPattern => {
  if (!pattern.includes("*")) {
    return Object.freeze({ pattern, kind });
  }
  const regexSrc = `^${pattern
    .split("*")
    .map((segment) => escapeRegex(segment))
    .join(".*")}$`;
  return Object.freeze({
    pattern,
    kind,
    regex: new RegExp(regexSrc),
  });
};

/**
 * Объединяет user patterns с defaults. User patterns идут ПЕРВЫМИ —
 * first-match-wins даёт пользователю явный override без необходимости
 * явно отключать default. Defaults в фиксированном порядке (insertion).
 */
export const compileImageHeuristic = (
  userPatterns: Readonly<Record<string, ElementKind>> | undefined,
): readonly CompiledPattern[] => {
  const userEntries = Object.entries(userPatterns ?? {});
  const userPatternSet = new Set(userEntries.map(([p]) => p));
  // Default entries которые не переопределены — добавляются после
  // user-entries. Если pattern есть и в user, и в defaults — берётся
  // user-версия.
  const defaultEntries = Object.entries(DEFAULT_IMAGE_HEURISTIC).filter(
    ([pattern]) => !userPatternSet.has(pattern),
  );
  const all: CompiledPattern[] = [
    ...userEntries.map(([pattern, kind]) => compilePattern(pattern, kind)),
    ...defaultEntries.map(([pattern, kind]) => compilePattern(pattern, kind)),
  ];
  return Object.freeze(all);
};

const matchesPattern = (
  baseName: string,
  repoPath: string,
  entry: CompiledPattern,
): boolean => {
  // Pattern с `/` матчится против полного repo path; без `/` — против
  // lowercased baseName.
  const target = entry.pattern.includes("/") ? repoPath : baseName;
  if (entry.regex) return entry.regex.test(target);
  return target === entry.pattern;
};

/**
 * Resolve ElementKind по compiled patterns. Возвращает первый match
 * (user override приоритетнее defaults). Fallback — `Container`.
 */
export const inferKindFromImage = (
  baseName: string,
  repoPath: string,
  compiled: readonly CompiledPattern[],
): ElementKind => {
  if (baseName.length === 0) return "Container";
  for (const entry of compiled) {
    if (matchesPattern(baseName, repoPath, entry)) return entry.kind;
  }
  return "Container";
};

/**
 * Glob pattern matcher для skip / других name-based filter'ов.
 * Шарит ту же `*` семантику что и imageHeuristic.
 */
export const matchesGlob = (input: string, pattern: string): boolean => {
  if (!pattern.includes("*")) return input === pattern;
  const regex = new RegExp(
    `^${pattern
      .split("*")
      .map((segment) => escapeRegex(segment))
      .join(".*")}$`,
  );
  return regex.test(input);
};
