import type { ArchitectureModel, Container } from "../model";
import type { Violation } from "./types";

const DEFAULT_CORE_BC_TAGS = [
    "bc-01",
    "bc-02",
    "bc-10",
    "bc-11",
    "bc-15",
    "bc-16",
    "bc-19",
];

export interface AdapstoryNoCoreBcCyclesOptions {
    coreBcTags?: string[];
}

const bcTagFor = (
    container: Container,
    coreBcTags: readonly string[],
): string | undefined => {
    const tags = container.tags ?? [];
    return coreBcTags.find((tag) => tags.includes(tag));
};

const canonicalCycle = (cycle: readonly string[]): string[] => {
    const body = cycle.slice(0, -1);
    let best = body;

    for (let index = 1; index < body.length; index += 1) {
        const rotated = [...body.slice(index), ...body.slice(0, index)];
        if (rotated.join("\0") < best.join("\0")) {
            best = rotated;
        }
    }

    return [...best, best[0]];
};

const cycleKey = (cycle: readonly string[]): string => cycle.join(" -> ");

const findCycles = (graph: Map<string, Set<string>>): string[][] => {
    const cycles = new Map<string, string[]>();

    const visit = (start: string, current: string, path: string[]): void => {
        for (const next of graph.get(current) ?? []) {
            if (next === start) {
                const canonical = canonicalCycle([...path, start]);
                cycles.set(cycleKey(canonical), canonical);
                continue;
            }
            if (path.includes(next)) continue;
            visit(start, next, [...path, next]);
        }
    };

    for (const node of graph.keys()) {
        visit(node, node, [node]);
    }

    return [...cycles.values()].toSorted((a, b) =>
        cycleKey(a).localeCompare(cycleKey(b)),
    );
};

export const checkAdapstoryNoCoreBcCycles = (
    model: ArchitectureModel,
    options?: AdapstoryNoCoreBcCyclesOptions,
): Violation[] => {
    const coreBcTags = options?.coreBcTags ?? DEFAULT_CORE_BC_TAGS;
    const containerBc = new Map<Container, string>();

    for (const container of model.allContainers) {
        const bcTag = bcTagFor(container, coreBcTags);
        if (bcTag) {
            containerBc.set(container, bcTag);
        }
    }

    const graph = new Map<string, Set<string>>();
    for (const bcTag of coreBcTags) {
        graph.set(bcTag, new Set());
    }

    for (const container of model.allContainers) {
        const sourceBc = containerBc.get(container);
        if (!sourceBc) continue;

        for (const relation of container.relations) {
            const targetBc = containerBc.get(relation.to);
            if (!targetBc || targetBc === sourceBc) continue;
            graph.get(sourceBc)?.add(targetBc);
        }
    }

    return findCycles(graph).map((cycle) => ({
        container: cycle[0],
        message: `core bounded context cycle detected: ${cycleKey(cycle)}`,
    }));
};
