import type { SourceSyntax } from "../../rules/fix";

export const plantumlSyntax: SourceSyntax = {
  containerPattern: (name) => `Container(${name},`,
  containerDecl: (name, label, tags) =>
    `Container(${name}, "${label}"${tags ? `, "", "", $tags="${tags}"` : ""})`,
  relationPattern: (from, to) => `Rel(${from}, ${to}`,
  relationDecl: (from, to, tech, tags) =>
    `Rel(${from}, ${to}, "${tech ?? ""}"${tags ? `, $tags="${tags}"` : ""})`,
};
