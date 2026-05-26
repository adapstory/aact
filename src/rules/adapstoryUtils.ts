import type { Element, Relation } from "../model";
import type { Violation } from "./types";

export const matchesPattern = (pattern: RegExp, value: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

export const matchesAnyPattern = (
  patterns: readonly RegExp[],
  value: string,
): boolean => patterns.some((pattern) => matchesPattern(pattern, value));

export const matchesConfiguredPattern = (
  configuredPattern: RegExp | undefined,
  defaultPatterns: readonly RegExp[],
  value: string,
): boolean =>
  configuredPattern
    ? matchesPattern(configuredPattern, value)
    : matchesAnyPattern(defaultPatterns, value);

export const hasPatternTag = (element: Element, pattern: RegExp): boolean =>
  element.tags.some((tag) => matchesPattern(pattern, tag));

export const hasExactTag = (
  element: Element,
  tags: readonly string[],
): boolean => {
  const expected = new Set(tags.map((tag) => tag.toLowerCase()));
  return element.tags.some((tag) => expected.has(tag.toLowerCase()));
};

export const relationText = (relation: Relation): string =>
  [relation.technology ?? "", ...relation.tags].join(" ");

const propertiesText = (
  properties?: Readonly<Record<string, string>>,
): string =>
  properties
    ? Object.entries(properties)
        .flatMap(([key, value]) => [key, value])
        .join(" ")
    : "";

export const relationEvidenceText = (relation: Relation): string =>
  [
    relation.description ?? "",
    relation.technology ?? "",
    ...relation.tags,
    propertiesText(relation.properties),
  ].join(" ");

export const elementOwnText = (element: Element): string =>
  [
    element.name,
    element.label,
    element.description,
    element.technology ?? "",
    ...element.tags,
    propertiesText(element.properties),
  ].join(" ");

export const elementText = (element: Element): string =>
  [elementOwnText(element), ...element.relations.map(relationText)].join(" ");

export const elementEvidenceText = (element: Element): string =>
  [
    elementOwnText(element),
    ...element.relations.map(relationEvidenceText),
  ].join(" ");

export const elementViolation = (
  target: Element,
  message: string,
  source?: Relation,
): Violation => ({
  target: target.name,
  targetKind: "element",
  message,
  sourceLocation: source?.sourceLocation ?? target.sourceLocation,
});

export {
  allElements,
  type Element,
  isDatabaseElement,
  type Model,
  type Relation,
  targetOf,
} from "../model";
