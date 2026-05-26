import {
  checkAdapstoryEventContractEvidence,
  checkAdapstoryFrontendThroughBff,
  checkAdapstoryLlmGatewayBoundary,
  checkAdapstoryPolyglotDataBoundary,
  checkAdapstoryRuntimeObservabilityEvidence,
  checkAdapstoryStatefulWorkloadEvidence,
} from "../../src/rules";
import type { TestElement, TestRelation } from "./adapstoryTestModel";
import { testElement, testModel } from "./adapstoryTestModel";

const container = (
  name: string,
  tags: string[] = [],
  description = "",
  relations: TestRelation[] = [],
  kind = "Container",
  technology?: string,
): TestElement =>
  testElement(name, tags, relations, kind, description, technology);

const model = (containers: TestElement[]): ReturnType<typeof testModel> =>
  testModel(containers);

describe("Adapstory regulation-derived architecture rules", () => {
  it("requires frontend clients to route backend calls through BFF/web-api", () => {
    const contentApi = container("content_api", ["api", "bc-11"]);
    const webApi = container("learning_bff", ["bff", "web-api"]);
    const studentUi = container(
      "student_frontend",
      ["frontend", "react"],
      "Student SPA.",
      [
        { to: contentApi, technology: "HTTPS /api/bc-11/content" },
        { to: webApi, technology: "HTTPS /web-api/adapstory/content" },
      ],
    );

    expect(
      checkAdapstoryFrontendThroughBff(model([studentUi, webApi, contentApi])),
    ).toMatchObject([
      {
        target: "student_frontend",
        targetKind: "element",
        message:
          'frontend "student_frontend" calls "content_api" outside BFF/web-api boundary',
      },
    ]);
  });

  it("requires AI callers to reach OpenRouter/OpenAI providers through BC-10 LLM Gateway", () => {
    const openRouter = container(
      "openrouter",
      [],
      "OpenRouter model provider.",
      [],
      "System_Ext",
    );
    const llmGateway = container(
      "bc10_llm_gateway",
      ["capability-boundary", "bc-10"],
      "BC-10 LLM Gateway with reviewed overlay.",
      [{ to: openRouter, technology: "OpenRouter SDK" }],
    );
    const aiMethodist = container(
      "ai_methodist",
      ["ai-service"],
      "Course generation agent.",
      [
        { to: openRouter, technology: "OpenRouter chat completion" },
        { to: llmGateway, technology: "REST model gateway" },
      ],
    );

    expect(
      checkAdapstoryLlmGatewayBoundary(
        model([aiMethodist, llmGateway, openRouter]),
      ),
    ).toMatchObject([
      {
        target: "ai_methodist",
        targetKind: "element",
        message:
          'LLM/model call "ai_methodist" -> "openrouter" bypasses BC-10 LLM Gateway/capability boundary',
      },
    ]);
  });

  it("requires Python AI PostgreSQL access to declare own-schema/read-model/CDC evidence", () => {
    const sharedPostgres = container(
      "shared_postgres",
      ["data-plane", "postgres"],
      "Shared PostgreSQL.",
      [],
      "ContainerDb",
    );
    const aiCourseGenerator = container(
      "ai_course_generator",
      ["python", "ai-service"],
      "FastAPI course generator.",
      [
        { to: sharedPostgres, technology: "PostgreSQL SQL" },
        {
          to: sharedPostgres,
          technology: "PostgreSQL schema-owner:bc-10 own-schema",
        },
      ],
    );

    expect(
      checkAdapstoryPolyglotDataBoundary(
        model([aiCourseGenerator, sharedPostgres]),
      ),
    ).toMatchObject([
      {
        target: "ai_course_generator",
        targetKind: "element",
        message:
          'Python/AI service "ai_course_generator" accesses PostgreSQL "shared_postgres" without own-schema/read-model/CDC evidence',
      },
    ]);
  });

  it("requires Kafka/event edges to expose CloudEvents tenant initiator and version evidence", () => {
    const courseProjection = container("course_projection", [
      "consumer",
      "bc-19",
    ]);
    const aiOrchestrator = container(
      "ai_orchestration",
      ["producer", "bc-10"],
      "Publishes course generation events.",
      [
        { to: courseProjection, technology: "Kafka topic ai.course.generated" },
        {
          to: courseProjection,
          technology:
            "Kafka CloudEvents 1.0 tenant-id request-initiator eventversion .v1",
        },
      ],
    );

    expect(
      checkAdapstoryEventContractEvidence(
        model([aiOrchestrator, courseProjection]),
      ),
    ).toMatchObject([
      {
        target: "ai_orchestration",
        targetKind: "element",
        message:
          'event relation "ai_orchestration" -> "course_projection" lacks evidence: CloudEvents 1.0, tenant-id header, request-initiator header, eventversion',
      },
    ]);
  });

  it("requires runtime services to show metrics tracing and structured logs evidence", () => {
    const identityService = container("identity_service", [
      "api",
      "bc-16",
      "java-service",
    ]);
    const observableIdentity = container(
      "identity_service_v2",
      ["api", "bc-16", "java-service"],
      "Exposes /metrics ServiceMonitor, OTLP trace_id/correlation_id, JSON logs.",
    );

    expect(
      checkAdapstoryRuntimeObservabilityEvidence(
        model([identityService, observableIdentity]),
      ),
    ).toMatchObject([
      {
        target: "identity_service",
        targetKind: "element",
        message:
          'runtime surface "identity_service" lacks observability evidence: metrics/ServiceMonitor, tracing/correlation, structured JSON logs',
      },
    ]);
  });

  it("requires stateful surfaces to show PVC/storageClass and backup evidence", () => {
    const contentPostgres = container(
      "content_postgres",
      ["data-plane", "postgres"],
      "BC-11 PostgreSQL.",
      [],
      "ContainerDb",
    );
    const durablePostgres = container(
      "identity_postgres",
      ["data-plane", "postgres"],
      "BC-16 PostgreSQL with PVC storageClass zfs-medium and backup restore retention policy.",
      [],
      "ContainerDb",
    );

    expect(
      checkAdapstoryStatefulWorkloadEvidence(
        model([contentPostgres, durablePostgres]),
      ),
    ).toMatchObject([
      {
        target: "content_postgres",
        targetKind: "element",
        message:
          'stateful surface "content_postgres" lacks durability evidence: PVC/storageClass, backup/restore policy',
      },
    ]);
  });
});
