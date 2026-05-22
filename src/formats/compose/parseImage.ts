/**
 * Image string normalization для kind heuristic + technology label.
 *
 * Compose `image:` принимает любой ref Docker Image Spec'а:
 *   postgres                                     # repo
 *   postgres:13                                  # repo:tag
 *   docker.io/library/postgres:13                # registry/library/repo:tag
 *   ghcr.io/org/repo:v1@sha256:abcdef...         # registry/repo:tag@digest
 *   ${POSTGRES_IMAGE:-postgres:13}               # env-var interpolation
 *
 * Для kind heuristic нам нужен только `repo` (`postgres`,
 * `rabbitmq`, ...). Для technology label — короткая форма
 * без digest, чтобы не показывать `postgres:13@sha256:abc...`
 * пользователю.
 */

export interface ParsedImage {
  /** Полный original string как в compose. */
  readonly raw: string;
  /** Registry часть (`docker.io` / `ghcr.io` / ...) — пустая если
   *  не указана. Не путать с library namespace (`library/`). */
  readonly registry: string;
  /** Repo path без registry и без tag/digest: `library/postgres`
   *  → `library/postgres`; `postgres` → `postgres`. */
  readonly repo: string;
  /** Базовое имя репо (last segment): `library/postgres` →
   *  `postgres`. Это то по чему делается kind heuristic. */
  readonly baseName: string;
  /** Tag без digest: `13`, `latest`, `v1`. Пустой если не указан. */
  readonly tag: string;
  /** Digest part (после `@`). Пустой если не указан. */
  readonly digest: string;
}

const ENV_VAR_RE = /^\$\{([A-Z0-9_]+)(?::-([^}]*))?\}$/i;

/**
 * Развёрнутая обработка env-var interpolation:
 *   `${POSTGRES_IMAGE:-postgres:13}` → `postgres:13`
 *   `${POSTGRES_IMAGE}`              → `POSTGRES_IMAGE` (lowercased
 *                                       сам var name fallback)
 *
 * Так избегаем "unknown technology" когда юзер использует interp без
 * default — хотя бы var name даёт людям читаемое description.
 */
const expandEnvVar = (input: string): string => {
  const m = ENV_VAR_RE.exec(input.trim());
  if (!m) return input;
  const [, varName, defaultValue] = m;
  if (defaultValue && defaultValue.length > 0) return defaultValue;
  return (varName ?? "").toLowerCase();
};

const KNOWN_REGISTRY_HOSTS: readonly string[] = Object.freeze([
  "docker.io",
  "ghcr.io",
  "gcr.io",
  "quay.io",
  "registry.k8s.io",
  "mcr.microsoft.com",
  "public.ecr.aws",
]);

const hasRegistryPrefix = (firstSegment: string): boolean => {
  // Registry host эвристика: содержит точку ИЛИ номер порта (`localhost:5000`)
  // ИЛИ матчит известный registry. Это согласуется с Docker
  // distribution-spec — `library/postgres` НЕ registry, `docker.io`
  // ИСЛЕ.
  if (KNOWN_REGISTRY_HOSTS.includes(firstSegment)) return true;
  if (firstSegment.includes(".") || firstSegment.includes(":")) return true;
  return false;
};

/**
 * Парсит compose `image:` строку в структурированную форму.
 * Безопасна на любом input'е (env-var interp, malformed strings) —
 * никогда не бросает.
 */
export const parseImage = (input: string): ParsedImage => {
  const expanded = expandEnvVar(input);
  const raw = input;

  // Split digest (`@sha256:...`) сначала — `@` гарантированно
  // делит ref на (repo:tag, digest).
  const [refOnly, digestPart] = expanded.split("@", 2);
  const digest = digestPart ?? "";

  // Split tag (`:13`). Но `:` в registry-host ('localhost:5000') —
  // ложный split. Считаем что после ПОСЛЕДНЕГО `/` всё что после
  // `:` — tag.
  const lastSlash = (refOnly ?? "").lastIndexOf("/");
  const head = lastSlash === -1 ? "" : refOnly.slice(0, lastSlash);
  const tail =
    lastSlash === -1 ? (refOnly ?? "") : refOnly.slice(lastSlash + 1);
  const tagSplit = tail.indexOf(":");
  const repoLast = tagSplit === -1 ? tail : tail.slice(0, tagSplit);
  const tag = tagSplit === -1 ? "" : tail.slice(tagSplit + 1);

  // Registry: head может содержать registry-host как первый segment.
  let registry = "";
  let repoPath = head;
  if (head.length > 0) {
    const firstSlash = head.indexOf("/");
    const firstSeg = firstSlash === -1 ? head : head.slice(0, firstSlash);
    if (hasRegistryPrefix(firstSeg)) {
      registry = firstSeg;
      repoPath = firstSlash === -1 ? "" : head.slice(firstSlash + 1);
    }
  }

  const repo = repoPath.length > 0 ? `${repoPath}/${repoLast}` : repoLast;
  const baseName = repoLast.toLowerCase();

  return Object.freeze({
    raw,
    registry,
    repo,
    baseName,
    tag,
    digest,
  });
};

/**
 * Returns human-friendly technology string без digest:
 *   `postgres:13` → `postgres:13`
 *   `docker.io/library/postgres:13@sha256:abc...` → `postgres:13`
 *   `ghcr.io/org/repo:v1` → `ghcr.io/org/repo:v1`
 *   image with build only → undefined
 */
export const technologyLabel = (parsed: ParsedImage): string => {
  if (parsed.repo.length === 0) return "";
  const base =
    parsed.registry.length > 0
      ? `${parsed.registry}/${parsed.repo}`
      : // Strip `library/` prefix — это Docker Hub соглашение для
        // официальных образов; не информативно для пользователя.
        parsed.repo.replace(/^library\//, "");
  return parsed.tag.length > 0 ? `${base}:${parsed.tag}` : base;
};
