# Проверка соответствия инфраструктуры через Format API

## Status

Proposed. Цель — v3.x после GA. Документ проектируется как
**долгосрочный контракт** (горизонт 10 лет) — каждое решение
ниже сопровождается оценкой реверсируемости и сценарием отката.

## Границы (C4 paradigm)

aact строго следует C4 (Container и выше — System Context,
System Landscape, Container, Component). Deployment view —
Deployment Nodes с экземплярами Container'ов, привязанные к
физическим нодам / зонам / регионам — **намеренно вне scope**.
Эта ADR не меняет это.

Что эта ADR добавляет — возможность **парсить k8s манифесты как
свидетельство существования Container'а**, а не как
deployment-диаграмму. Loader извлекает:

- Identity Container'а (имя Deployment / StatefulSet → имя
  Container'а)
- Override kind'а (StatefulSet + ключевые слова в image → Db /
  Queue эвристика, либо явная аннотация)
- Technology (image string, опционально нормализованный)

Loader **не извлекает, не моделирует и не показывает**:

- Replica counts, resource limits, image digest pinning — это
  infrastructure compliance, домен kube-score / polaris /
  kyverno.
- Pod-level конфигурацию, taints / tolerations, security
  contexts — это deployment-view материал, вне scope.
- Cluster topology, node pools, регионы — deployment-view
  материал, вне scope.

## Контекст

aact позиционируется как инструмент для **Solution
Architect'ов**. Текущий канонический loop:

```
designer → пишет архитектуру в C4 (PlantUML / Structurizr DSL)
         → aact линтит / анализирует / диффает дизайн
         → aact генерирует Kubernetes манифесты как стартовый артефакт
```

Чего этот loop **не** делает — не отвечает на вопрос который
архитектор поднимает в момент когда система реально работает:

> "Мы спроектировали систему X с контейнерами A, B, C и базой D.
> Что сейчас задеплоено? Совпадает ли это с дизайном?"

В aact нет первоклассной команды, контракта или структуры данных
которая показывала бы дрифт между **дизайном** (`workspace.dsl` /
`architecture.puml`) и **реальностью** (k8s манифесты, helm
чарты, terraform state, и т.д.).

Соседние экосистемы покрывают по половине:

- **Моделирующие тулзы** (Structurizr, IcePanel) описывают
  дизайн, но не наблюдают деплой.
- **IaC drift тулзы** (terraform plan, Pulumi preview,
  Spacelift, Firefly) видят инфра-дрифт, но остаются внутри
  своего примитивного словаря — они не понимают C4 элементы /
  boundary'и.
- **AI-based тулзы автогенерации C4 из k8s** (Archyl, IcePanel
  AI) перекрывают разрыв, но недетерминированно и не
  CI-friendly.

Детерминированный, format-agnostic, linter-shaped слот пуст. Это
именно та ниша где aact уже живёт архитектурно; расширение
существующего Format API вместо отдельной subcommand сохраняет
дизайн целостным.

## Рассмотренные альтернативы (общий подход)

### A. Новая top-level subcommand `aact sync` / `aact infra check`

Параллельный pipeline для "сравни design vs infra" со своей
структурой данных (например `DriftReport`), своими парсерами,
своей rule-семантикой.

**Отклонено** потому что дублирует инфраструктуру которая в aact
уже есть: rule engine рассуждает поверх `Model`, diff engine
сравнивает два `Model`'я, view пакет визуализирует `Model`.
Второй pipeline = три вещи поддерживать вместо одной, и значит
`aact view ./k8s/` никогда не заработает бесплатно.

### B. Отдельный Format API для "infra" форматов

Два registry — `architectureFormats` и `infraFormats`, у
каждого свой контракт.

**Отклонено** потому что существующий Format API уже
capability-driven (`load?`, `generate?`, `fix?` — каждое
опционально). Разделение на два registry добавляет категорию на
уровне типов без приобретения ценности: plugin author'ы всё
равно учат один контракт. Discriminator `kind: 'infra'` на типе
Format'а похожим образом избыточен — роль Format'а определяется
тем в каком слоте конфига он сидит.

### C. Per-Format `sync.ts` возвращающий не-Model структуру

Каждая format-папка поставляет свою drift-реализацию с шейпом
`DriftReport` отличным от `Model`.

**Отклонено** потому что k8s-специфичные drift-concerns (replica
counts, resource limits, image digest pinning) — это
**infrastructure compliance**, а не **architecture
conformance**. Scope aact явно останавливается на architecture.

### D. (Выбрано) Возвести k8s и подобные источники в first-class loadable Format'ы

Format `kubernetes` получает capability `load`. Loader парсит
манифесты в ту же нормализованную `Model` что и
structurizr / c4-puml / model-json. Drift detection становится
вырожденным случаем существующего `aact diff` — сравнение двух
`Model`'ей.

## Решение

**1. Format API остаётся как есть.** Никакого поля `kind`,
никакого второго registry. Capabilities (`load?`, `generate?`,
`fix?`) уже описывают что Format поддерживает. Роль которую
Format играет — implicit через слот конфига где он сидит:

| Слот конфига                    | Требуемая capability |
| ------------------------------- | -------------------- |
| `source`                        | `load`               |
| `infra` (новое)                 | `load`               |
| `generate.kubernetes` (текущее) | `generate`           |

**2. Format `kubernetes` становится round-trip.** Сегодня он
поставляет только `generate` (model → манифесты). Добавляем
`load` чтобы манифесты могли парситься в каноническую `Model`.

**3. Новый опциональный слот `infra` в `AactConfig`:**

```typescript
interface AactConfig {
  source: { type: SourceFormatName; path: string }; // существующее
  infra?: InfraSourceConfig; // новое
  // ...rules / customRules / generate без изменений
}

interface InfraSourceConfig {
  readonly type: SourceFormatName;
  readonly path: string;
  /** Annotation conventions. Все поля опциональные. Без
   *  переопределения loader использует defaults (`aact.io/...`). */
  readonly annotations?: AnnotationKeys;
}

interface AnnotationKeys {
  readonly prefix?: string; // "aact.io"
  readonly element?: string; // "{prefix}/element"
  readonly kind?: string; // "{prefix}/kind"
  readonly technology?: string; // "{prefix}/technology"
  readonly description?: string; // "{prefix}/description"
  readonly tags?: string; // "{prefix}/tags"
}
```

**4. Флаг `Model.partial`** для loader'ов которые объективно не
могут извлечь каждое поле Model:

```typescript
interface Model {
  // existing fields...
  readonly partial?: {
    readonly relations?: boolean; // loader не может вывести rel'ы
    readonly descriptions?: boolean; // loader не имеет description'ов
  };
}
```

Additive — **не** бампит `schemaVersion: 1` согласно freeze
policy. Downstream consumers (rule engine, `aact diff`) читают
флаг чтобы подавить drift-entries которые иначе были бы
гарантированными false positives.

**5. Drift = `aact diff`.** Никакого нового diff engine. Когда
оба `source` и `infra` сконфигурированы, `aact diff` без
аргументов по умолчанию сравнивает их:

```bash
aact diff                 # source vs infra (когда infra сконфигурирован)
aact diff old.dsl new.dsl # явная пара, два архитектурных источника
aact diff --against infra # явно когда оба слота заняты
```

**6. Annotation conventions, конфигурируемые с разумными
дефолтами:**

```yaml
metadata:
  annotations:
    aact.io/element: platform.projects.projectsService # путь в модели
    aact.io/kind: ContainerDb # override эвристики
    aact.io/technology: "PostgreSQL 16" # human-friendly tech
    aact.io/description: "Master data for project entities"
    aact.io/tags: "repo,critical"
```

Пользователь может переопределить prefix или конкретные ключи
через `infra.annotations` в конфиге.

Когда аннотации отсутствуют, loader откатывается к name-based
эвристике (kebab-case k8s имя → camelCase имя элемента) и
image-based выводу kind (`postgres` / `mysql` / `mongo` →
`ContainerDb`; `kafka` / `rabbitmq` → `ContainerQueue`).
Эвристические matches получают `severity: "info"` в diff-entries
с suggestion'ом добавить явную аннотацию.

### Mapping table (k8s → C4)

| k8s ресурс                | C4 элемент                    | Примечания                                |
| ------------------------- | ----------------------------- | ----------------------------------------- |
| Deployment                | Container                     | image-keyword эвристика для kind override |
| StatefulSet               | ContainerDb (по умолчанию)    | аннотация может переопределить            |
| DaemonSet / Job / CronJob | Container с релевантным тегом |                                           |
| Service / Ingress         | (skip в phase 1)              | будущее: relation hint к outside world    |
| NetworkPolicy             | (skip в phase 1)              | будущее: internal relation hints          |
| ConfigMap / Secret        | skip                          | не C4 элементы                            |
| CustomResource            | skip с `ModelIssue` info      | crossplane / argo composites — phase 4    |

### Фазированная поставка

| Фаза | Содержание                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | k8s Format с `load` для Deployments / StatefulSets / DaemonSets / Jobs / CronJobs. Annotation + эвристический matching. Diff работает |
| 2    | Services / Ingresses → external relation hints. NetworkPolicy → internal relation hints                                               |
| 3    | helm template resolver (вызов `helm template`)                                                                                        |
| 4    | Crossplane / ArgoCD composite chasing                                                                                                 |
| 5    | terraform / pulumi Format'ы — плагуются в тот же слот через тот же Format API                                                         |

## Анализ реверсируемости

Каждое решение классифицировано по тому насколько дорого
откатить после публикации в стабильной версии. Решения с низкой
реверсируемостью требуют тщательного выбора **сейчас**, потому
что после первого релиза вне беты любое изменение либо ломает
пользователей молча, либо требует длительной deprecation
дорожки.

| #   | Решение                                                           | Реверсируемость | Цена ошибки                                                                                                               | Recovery story                                                                                  |
| --- | ----------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Format API без поля `kind`                                        | **Высокая**     | Низкая — additive поле в TS, ловится compile-time                                                                         | Добавить опц. `kind?: 'architecture' \| 'infra'`; legacy Format'ы без `kind` остаются валидными |
| 2   | Format `kubernetes` round-trip (`load + generate`)                | **Высокая**     | Низкая — capability set расширяется аддитивно                                                                             | Откатить add of `load`; existing `generate` остаётся                                            |
| 3   | `AactConfig.infra` slot                                           | **Средняя**     | Средняя — user configs ссылаются на поле; rename = поломка с TS-ошибкой (а не silent)                                     | deprecated 2 беты + alias до v4                                                                 |
| 4   | Имя `infra` (vs `deployed`, `runtime`, `reality`)                 | **Низкая**      | Средняя — slot name forever в user configs                                                                                | Алиас в config loader'е: `deployed` accepted but emits warning                                  |
| 5   | `Model.partial` shape                                             | **Средняя**     | Средняя — consumers (rules / diff / view) читают флаг; неверный shape = массовая правка downstream                        | Migrate logic в diff-слой; deprecated `Model.partial` no-op 1 бету                              |
| 6   | `aact diff` без аргументов = source vs infra (когда оба есть)     | **Низкая**      | Низкая/Средняя — user habit / CI scripts; behaviour breaking, но обнаруживается громко (новые exit-codes / новые entries) | Откатить default; CI scripts должны вызывать `aact diff --against infra` явно                   |
| 7   | Drift entry shape в `DiffData` (новые kinds: `missing-in-iac`, …) | **Низкая**      | Высокая — CI consumers + агенты + SARIF mapping завязаны на структуру                                                     | Bump `schemaVersion: 2` post-GA; держать v1 envelope как deprecated 6 месяцев                   |
| 8   | Annotation prefix default (`aact.io`)                             | **Низкая**      | Высокая — все user manifests в их репах содержат префикс; rename = silent breakage                                        | Loader временно поддерживает оба префикса с warning; CHANGELOG-driven миграция                  |
| 9   | Annotation keys внутри prefix (`element`, `kind`, …)              | **Средняя**     | Средняя — переименование тоже silent breakage у пользователей не переопределивших                                         | То же что #8: dual-key support с warning                                                        |
| 10  | Mapping k8s → C4 (heuristic table)                                | **Высокая**     | Низкая — эвристика, не контракт; пользователи могут override через annotation                                             | Изменения mapping table = patch-level, не breaking                                              |

**Принцип**: чем ниже реверсируемость в таблице, тем больше
обоснования требует решение **до** публикации в стабильном
канале. По-факту максимально irreversible: #4 (slot name),
#6 (diff default), #7 (drift shape), #8 (annotation prefix
default). Им нужен явный owner sign-off; #1-3, #5, #9-10 —
можно итеративно дотачивать.

## Открытые вопросы дизайна

Каждый вопрос ниже включает альтернативы и явную recovery
story — что делаем если ответ окажется неверным.

### Вопрос 1. Имя config slot — `infra`?

Альтернативы:

- `infra` — короткое, индустриально-общепринятое
- `deployed` — точнее семантически (это **развернутое**, не
  абстрактная "infra")
- `runtime` — фокус на текущее состояние, не на источник
- `reality` — самое явное по смыслу, но непривычно

**Recovery**: config loader принимает несколько имён через
alias-карту; одно — canonical, остальные — deprecated с warning.
Стоимость = warn-shower в CI лог + 1 цикл миграции.

### Вопрос 2. Annotation prefix default — `aact.io`?

Альтернативы:

- `aact.io` — короткий, требует владения доменом
- `aact.dev` — альтернативный домен
- `c4.aact.io` — semantic sub-namespace
- `byndyusoft.aact.io` — team namespace

K8s соглашение: префикс должен быть DNS-subdomain которым ты
реально владеешь.

**Recovery**: loader поддерживает старый префикс параллельно с
новым на 2 беты + 6 месяцев после GA смены, выдаёт warning при
обнаружении старого. После grace period — drop. Стоимость =
двойной парсинг + явная коммуникация в CHANGELOG.

### Вопрос 3. Версионирование annotation keys

Альтернативы:

- Flat: `aact.io/element` (нет версии — как у Argo CD)
- Versioned: `aact.io/v1/element` (явная версия — как k8s API
  groups)
- Hybrid: `aact.io/element` сейчас, при breaking change добавим
  `aact.io/v2/element`

**Recovery** если выбрали flat: при breaking change добавляем
v2 параллельно; loader читает оба; v1 deprecated.

Если выбрали versioned: лишний шум в манифестах от первого дня
ради сценария который может никогда не случиться.

**Рекомендация**: flat (`aact.io/element`) сейчас, versioned —
только если потребуется. Это honest YAGNI.

### Вопрос 4. `Model.partial` — на Model или на Diff?

Альтернативы:

- На `Model` (предлагаемое): loader выставляет флаг, любой
  downstream consumer уважает
- На `Diff`: явный helper `diff(designModel, infraModel, {
asymmetric: true })` инкапсулирует логику; Model остаётся
  pristine

**Recovery от первого**: переносим логику в diff-слой; флаг
`Model.partial` остаётся, но deprecated и игнорируется. 1 цикл
deprecation.

**Recovery от второго**: добавляем флаг на Model post-hoc; old
diff API остаётся как convenience wrapper.

Первый вариант более общий — поддерживает не только diff, но и
view (показывать партиально-загруженную модель с warning'ами) и
rules (не флагать rule violations о relations которых не было).
Второй проще локально, но менее переиспользуем.

### Вопрос 5. Что делать с CRD / Operator-managed ресурсами

K8s ландшафт всё больше операторно-управляемый — Crossplane
composites, ArgoCD Applications, Helm releases как CRD. Phase 1
их skip'ает с `ModelIssue` info. Долгосрочно:

- Хук-механизм: пользователь регистрирует custom CRD reader в
  своём `aact.config.ts`
- Pre-built readers для популярных CRD (Crossplane, ArgoCD,
  Knative)
- Ничего не делать — пусть пользователи сами шлют PR'ы за
  поддержкой

**Recovery**: какой бы вариант ни выбрали в Phase 4 — все
расширяются аддитивно через `infra.crdReaders` поле в конфиге.

## Как покрыть тестами

### Loader

- Unit: `src/formats/kubernetes/load.test.ts` — для каждого k8s
  kind из mapping table фикстура манифеста + ожидаемый output
  `Model`. Включает annotation-override кейсы,
  missing-annotation эвристические кейсы, malformed-YAML error
  кейсы.
- Snapshot: `examples/kubernetes/` становится реальной
  фикстура-директорией для `test:integration`. Snapshot
  загруженной `Model` так чтобы случайные изменения mapping'а
  краснели.

### Drift / diff

- Property-based: `@fast-check/vitest` генераторы которые
  производят два `Model`'я отличающиеся по конкретным осям
  (`addedElements`, `removedRelations`, `kindMismatch`) — assert
  что `aact diff` находит ровно ожидаемые drift entries.
- Respect `Model.partial`: синтезировать Model с
  `partial.relations = true`, убедиться что `aact diff` против
  full Model **не** флагает missing relations.

### CLI integration

- `test:e2e` добавляет fixture pair
  (`fixtures/conformance/design.dsl` +
  `fixtures/conformance/k8s/*.yaml`) и проверяет:
  - `aact diff --json` возвращает документированный шейп
    `DiffData`
  - `aact diff --sarif` возвращает валидный SARIF v2.1.0
  - Exit code 0 когда нет drift, 1 когда drift есть, 2 на tool
    error

### Annotation conventions

- Тесты на default-prefix loader
- Тесты на per-key override
- Тесты на dual-prefix transition (когда мы захотим менять
  default в будущем)

### Примеры тестов

To be written. References:

- `test/formats/structurizr/parser/pipeline.smoke.test.ts` —
  паттерн loader-теста.
- `test/diff/computeDiff.test.ts` — существующая diff test
  поверхность для расширения.
