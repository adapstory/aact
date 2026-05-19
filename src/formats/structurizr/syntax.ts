import type { FormatSyntax } from "../types";

export const structurizrDslSyntax: FormatSyntax = {
  containerDecl: (name, label, tags) => {
    if (tags) {
      return `${name} = container "${label}" {\n    tags "${tags}"\n}`;
    }
    return `${name} = container "${label}"`;
  },
  relationDecl: (from, to, tech, tags) => {
    const techPart = tech ? ` "${tech}"` : "";
    if (tags) {
      return `${from} -> ${to}${techPart} {\n    tags "${tags}"\n}`;
    }
    return `${from} -> ${to}${techPart}`;
  },
};
