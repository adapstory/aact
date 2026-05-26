import type { Element, Relation } from "../model";
import type { Violation } from "./types";

export const matchesPattern = (pattern: RegExp, value: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

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

export const elementOwnText = (element: Element): string =>
  [
    element.name,
    element.label,
    element.description,
    element.technology ?? "",
    ...element.tags,
  ].join(" ");

export const elementText = (element: Element): string =>
  [elementOwnText(element), ...element.relations.map(relationText)].join(" ");

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
