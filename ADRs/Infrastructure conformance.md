# Проверка соответствия инфраструктуры через Format API

## Status

Proposed. Цель — v3.x после GA. Поверхность затрагивает публичный
Format API и форму `AactConfig`; оба под контрактом "только
additive изменения" внутри окна `schemaVersion: 1`, поэтому
стоимость неудачного решения растёт быстро.

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

Удержание loader'а в этих рамках — то что делает фичу защитимой
внутри парадигмы C4: мы читаем k8s источники чтобы ответить на
вопрос Container уровня ("задеплоен ли спроектированный
container?") и отбрасываем всё остальное.

## Контекст

aact позиционируется как инструмент для **Solution Architect'ов**.
Текущий канонический loop:

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

## Рассмотренные альтернативы

### A. Новая top-level subcommand `aact sync` / `aact infra check`

Первоначальный фрейминг. Добавляет параллельный pipeline для
"сравни design vs infra" со своей структурой данных (например
`DriftReport`), своими парсерами, своей rule-семантикой.

**Отклонено** потому что дублирует инфраструктуру которая в
aact уже есть: rule engine рассуждает поверх `Model`, diff
engine сравнивает два `Model`'я, view пакет визуализирует
`Model`. Второй pipeline — это три вещи которые надо
поддерживать вместо одной, и значит `aact view ./k8s/`
никогда не заработает бесплатно.

### B. Отдельный Format API для "infra" форматов

Два registry — `architectureFormats` (structurizr, c4-puml,
model-json) и `infraFormats` (kubernetes, terraform). У каждого
свой контракт.

**Отклонено** потому что существующий Format API уже
capability-driven (`load?`, `generate?`, `fix?` — каждое
опционально). Разделение на два registry добавляет категорию на
уровне типов без приобретения какой-либо ценности: plugin
author'ы всё равно учат один контракт. Discriminator `kind:
'infra'` на типе Format'а похожим образом избыточен — роль
Format'а определяется тем в каком слоте конфига он сидит, а не
внутренним лейблом.

### C. Per-Format `sync.ts` возвращающий не-Model структуру

Каждая format-папка могла бы поставлять свою drift-реализацию
(`src/formats/kubernetes/sync.ts`) с шейпом `DriftReport`
отличным от `Model`.

**Отклонено** потому что k8s-специфичные drift-конcerns
(replica counts, resource limits, image-digest pinning) — это
**infrastructure compliance**, а не **architecture
conformance**. Scope aact явно останавливается на architecture.
Тулзы вроде kube-score, polaris, kyverno уже обслуживают
compliance-нишу. Попытка покрыть и то и другое размывает
identity линтера.

### D. (Выбрано) Возвести k8s и подобные источники в first-class loadable Format'ы

Format `kubernetes` получает capability `load`. Loader парсит
манифесты в ту же нормализованную `Model` что и
structurizr / c4-puml / model-json. Drift detection становится
вырожденным случаем существующего `aact diff` — сравнение двух
`Model`'ей.

## Краткое описание решения и его обоснование

### Решение

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
Один Format покрывает оба направления; consumers берут
capability per slot.

**3. Новый опциональный слот `infra` в `AactConfig`:**

```typescript
interface AactConfig {
  source: { type: SourceFormatName; path: string }; // существующее
  infra?: { type: SourceFormatName; path: string }; // новое
  // ...rules / customRules / generate без изменений
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
гарантированными false positives (например "relation X missing
in infra" когда `infra.partial.relations === true`).

**5. Drift = `aact diff`.** Никакого нового diff engine. Когда
оба `source` и `infra` сконфигурированы, `aact diff` без
аргументов по умолчанию сравнивает их:

```bash
aact diff                 # source vs infra (когда infra сконфигурирован)
aact diff old.dsl new.dsl # явная пара, два архитектурных источника
aact diff --against infra # явно когда оба слота заняты
```

**6. Annotation conventions** для высоконадёжного matching:

```yaml
metadata:
  annotations:
    aact.io/element: platform.projects.projectsService # явный путь в модели
    aact.io/kind: ContainerDb # override эвристики
    aact.io/technology: "PostgreSQL 16" # human-friendly имя tech
    aact.io/description: "Master data for project entities"
    aact.io/tags: "repo,critical"
```

Когда аннотации отсутствуют, loader откатывается к
name-based эвристике (kebab-case k8s имя → camelCase имя
элемента) и image-based выводу kind (`postgres` / `mysql` /
`mongo` → `ContainerDb`; `kafka` / `rabbitmq` → `ContainerQueue`).
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

| Фаза | Содержание                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | k8s Format с `load` для Deployments / StatefulSets / DaemonSets / Jobs / CronJobs. Annotation + эвристический matching. Diff работает. |
| 2    | Services / Ingresses → external relation hints. NetworkPolicy → internal relation hints.                                               |
| 3    | helm template resolver (вызов `helm template`).                                                                                        |
| 4    | Crossplane / ArgoCD composite chasing.                                                                                                 |
| 5    | terraform / pulumi Format'ы — плагуются в тот же слот через тот же Format API.                                                         |

### Обоснование

Три принципа драйвят решение:

1. **Solution Architects, не SRE.** Пользователь которому мы
   служим заботится "соответствует ли система своему дизайну?",
   а не "правильное ли число реплик?". Первый вопрос идеально
   ложится на абстракцию Model; второй принадлежит нише
   kube-score.
2. **Один pipeline, много источников.** Нормализованная Model
   aact — это рычаг который заставляет view / check / analyze /
   diff работать на всех форматах. Добавление второго pipeline
   (format-локального `sync.ts` возвращающего не-Model шейп)
   ломает этот рычаг ради одной фичи.
3. **Linter, не graph DB.** aact выдаёт drift как
   детерминированную диагностику поверх нормализованной Model.
   Не пытается поддерживать live infrastructure inventory,
   рендерить дашборды, или auto-remediate.

Флаг `Model.partial` — это минимально возможное смягчение того
факта что инфра-источники никогда не несут полный design intent
(нет описаний, нет человеческих labels у relation'ов).
Подавление гарантированных false-positive drift-entries на
partial полях делает signal-to-noise ratio `aact diff` юзабельным
в CI с первого дня.

## Как покрыть тестами

### Loader

- Unit: `src/formats/kubernetes/load.test.ts` — для каждого
  k8s kind из mapping table фикстура манифеста + ожидаемый
  output `Model`. Включает annotation-override кейсы,
  missing-annotation эвристические кейсы, malformed-YAML error
  кейсы.
- Snapshot: `examples/kubernetes/` становится реальной фикстура-
  директорией для `test:integration`. Snapshot загруженной
  `Model` так чтобы случайные изменения mapping'а краснели.

### Drift / diff

- Property-based: `@fast-check/vitest` генераторы которые
  производят два `Model`'я отличающиеся по конкретным осям
  (`addedElements`, `removedRelations`, `kindMismatch`) — assert
  что `aact diff` находит ровно ожидаемые drift entries.
- Respect `Model.partial`: синтезировать Model с
  `partial.relations = true`, убедиться что `aact diff` против
  full Model **не** флагает missing relations.

### CLI integration

- `test:e2e` добавляет fixture pair (`fixtures/conformance/design.dsl`
  - `fixtures/conformance/k8s/*.yaml`) и проверяет:
  * `aact diff --json` возвращает документированный шейп
    `DiffData`
  * `aact diff --sarif` возвращает валидный SARIF v2.1.0
  * Exit code 0 когда нет drift, 1 когда drift есть, 2 на tool
    error

### Примеры тестов

To be written. References:

- `test/formats/structurizr/parser/pipeline.smoke.test.ts` —
  паттерн loader-теста.
- `test/diff/computeDiff.test.ts` — существующая diff test
  поверхность для расширения.

## Открытые вопросы дизайна

Следующие решения предложены односторонне и нуждаются в явном
ратификации до старта implementation:

1. **Имя слота `infra` в конфиге.** Альтернативы: `deployed`,
   `runtime`, `reality`. `infra` читается коротко и совпадает с
   общеиндустриальным термином.
2. **Префикс аннотаций `aact.io/*`.** Резервирует публичный
   namespace на каждом пользовательском k8s манифесте. Мы
   commit'имся к стабильности этого префикса навсегда (rename
   ломает пользовательские манифесты молча).
3. **Флаг `Model.partial`.** Additive внутри `schemaVersion: 1`
   согласно freeze policy, но меняет то как downstream consumers
   (rule engine, view, diff) должны рассуждать о missing data.
   Альтернатива — асимметрия живёт на diff слое (явный helper
   `diff(designSource, infraSource)` с зашитой partial-логикой).
4. **Scope: kubernetes сначала, terraform / pulumi позже.**
   Фазирование rollout'а на k8s+helm даёт юзабельный MVP быстро
   но оставляет cloud-native юзеров с terraform-only стеком без
   покрытия на пару релизов.
