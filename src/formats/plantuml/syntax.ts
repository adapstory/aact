import type { FormatSyntax } from "../types";

export const plantumlSyntax: FormatSyntax = {
  containerDecl: (name, label, tags) => {
    const tagsPart = tags ? `, "", "", $tags="${tags}"` : "";
    return `Container(${name}, "${label}"${tagsPart})`;
  },
  relationDecl: (from, to, tech, tags) => {
    const tagsPart = tags ? `, $tags="${tags}"` : "";
    return `Rel(${from}, ${to}, "${tech ?? ""}"${tagsPart})`;
  },
};
