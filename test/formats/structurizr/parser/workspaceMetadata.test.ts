import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — workspace metadata", () => {
  it('captures `workspace "Name" "Description"` header into Model.workspace', () => {
    const src = `workspace "Big Bank plc" "Internet Banking Demo" {
      model {}
    }`;
    const { model } = parse(src);
    expect(model.workspace).toEqual({
      name: "Big Bank plc",
      description: "Internet Banking Demo",
    });
  });

  it('captures `workspace extends "..."` into Model.workspace.extendsTarget', () => {
    const src = `workspace extends "https://example/base.dsl" {
      model {}
    }`;
    const { model } = parse(src);
    expect(model.workspace?.extendsTarget).toBe("https://example/base.dsl");
  });

  it("Model.workspace is omitted when the workspace header has no fields", () => {
    const src = `workspace {
      model {}
    }`;
    const { model } = parse(src);
    expect(model.workspace).toBeUndefined();
  });
});
