import type { AnalysisReport } from "../../analyze";
import { analyzeArchitecture } from "../../analyze";
import type { AactConfig } from "../../config";
import { issueToDiagnostic, loadModel } from "../loadModel";
import type { Renderer } from "../output";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg } from "../sharedArgs";

export type AnalyzeData = AnalysisReport;

/**
 * Exported for unit-testing without going through citty/process.exit.
 * The runner wires this into `cliCommandWithConfig.execute`.
 */
export const executeAnalyze = async (
  config: AactConfig,
): Promise<ExecuteResult<AnalyzeData>> => {
  const { model, issues } = await loadModel(config);
  const { report } = analyzeArchitecture(model);
  return {
    data: report,
    exitCode: 0,
    diagnostics: issues.map(issueToDiagnostic),
  };
};

export const renderAnalyzeText: Renderer<AnalyzeData> = (envelope, sink) => {
  const { data } = envelope;
  sink.write(`Elements: ${data.elementsCount}\n`);
  sink.write(`Sync API calls: ${data.syncApiCalls}\n`);
  sink.write(`Async API calls: ${data.asyncApiCalls}\n`);
  sink.write(
    `Databases: ${data.databases.count} (consumed by ${data.databases.consumes} relation(s))\n`,
  );

  for (const b of data.boundaries) {
    sink.write(
      `Boundary "${b.label}": cohesion=${b.cohesion}, coupling=${b.coupling}\n`,
    );
    for (const r of b.couplingRelations) {
      sink.write(`  ${r.from} → ${r.to}\n`);
    }
  }
};

export const analyze = cliCommandWithConfig({
  name: "analyze",
  meta: { name: "analyze", description: "Analyze architecture metrics" },
  args: { ...configArg, ...jsonArg },
  renderText: renderAnalyzeText,
  execute: (_ctx, config) => executeAnalyze(config),
});
