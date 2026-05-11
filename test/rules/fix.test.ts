import consola from "consola";

import { applyEdits } from "../../src/rules/fix";

describe("applyEdits", () => {
  const source = [
    'Container(svc_a, "Service A")',
    'Container(svc_b, "Service B")',
    'Rel(svc_a, svc_b, "")',
  ].join("\n");

  it("returns source unchanged for empty edits", () => {
    expect(applyEdits(source, [])).toBe(source);
  });

  it("removes a line matching search", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "Rel(svc_a, svc_b" },
    ]);
    expect(result).toBe(
      ['Container(svc_a, "Service A")', 'Container(svc_b, "Service B")'].join(
        "\n",
      ),
    );
  });

  it("replaces a line matching search", () => {
    const result = applyEdits(source, [
      {
        type: "replace",
        search: "Rel(svc_a, svc_b",
        content: 'Rel(svc_a, svc_c, "")',
      },
    ]);
    expect(result).toContain('Rel(svc_a, svc_c, "")');
    expect(result).not.toContain("Rel(svc_a, svc_b");
  });

  it("adds a line after the anchor", () => {
    const result = applyEdits(source, [
      {
        type: "add",
        search: 'Container(svc_a, "Service A")',
        content: 'Container(svc_a_acl, "Service A ACL")',
      },
    ]);
    const lines = result.split("\n");
    expect(lines[0]).toBe('Container(svc_a, "Service A")');
    expect(lines[1]).toBe('Container(svc_a_acl, "Service A ACL")');
    expect(lines[2]).toBe('Container(svc_b, "Service B")');
  });

  it("applies multiple edits sequentially", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "Rel(svc_a, svc_b" },
      {
        type: "add",
        search: 'Container(svc_b, "Service B")',
        content: 'Rel(svc_a, svc_c, "")',
      },
    ]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Rel(svc_a, svc_c, "")');
  });

  it("preserves empty lines verbatim when adding multi-line content", () => {
    // applyIndent must NOT prepend indent to blank lines — keeps formatting
    // sane when added blocks contain blank-line separators.
    const indented = ['  Container(svc_a, "Service A")'].join("\n");
    const result = applyEdits(indented, [
      {
        type: "add",
        search: "Container(svc_a",
        content: 'Container(svc_b, "Service B")\n\nRel(svc_a, svc_b, "")',
      },
    ]);
    const lines = result.split("\n");
    expect(lines[0]).toBe('  Container(svc_a, "Service A")');
    expect(lines[1]).toBe('  Container(svc_b, "Service B")');
    expect(lines[2]).toBe(""); // blank line preserved without indent
    expect(lines[3]).toBe('  Rel(svc_a, svc_b, "")');
  });

  it("warns when search matches multiple lines but still applies to first", () => {
    const ambiguous = ["Container(svc)", "Container(svc)", "End"].join("\n");
    const result = applyEdits(ambiguous, [
      { type: "remove", search: "Container(svc)" },
    ]);
    // first line removed, second remains
    expect(result.split("\n")).toEqual(["Container(svc)", "End"]);
  });

  it("returns source unchanged when search not found", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "NonExistentLine" },
    ]);
    expect(result).toBe(source);
  });

  it("warns with the pattern when search is not found", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    applyEdits(source, [{ type: "remove", search: "NonExistentLine" }]);
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix: pattern not found in source");
    expect(msg).toContain("NonExistentLine");
  });

  it("warns with match count when pattern is ambiguous", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    const ambiguous = ["Container(svc)", "Container(svc)", "End"].join("\n");
    applyEdits(ambiguous, [{ type: "remove", search: "Container(svc)" }]);
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("ambiguous pattern");
    expect(msg).toContain("Container(svc)");
    expect(msg).toContain("matches 2 lines");
    expect(msg).toContain("using first");
  });

  it("does NOT warn about ambiguity when pattern matches exactly one line (boundary)", () => {
    // Stryker mutated `matchCount > 1` to `>= 1` — that mutation would warn on
    // every successful edit. The pin keeps the threshold honest.
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    applyEdits(source, [{ type: "remove", search: "Rel(svc_a, svc_b" }]);
    expect(warn).not.toHaveBeenCalled();
  });
});
