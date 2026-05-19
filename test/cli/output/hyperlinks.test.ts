import { linkSourceLocation } from "../../../src/cli/output/hyperlinks";
import type { SourceLocation } from "../../../src/model";
import { formatLocation } from "../../../src/model";

const loc: SourceLocation = {
  file: "/abs/path/arch.puml",
  start: { line: 12, col: 5, offset: 200 },
  end: { line: 12, col: 25, offset: 220 },
};

const ESC = String.fromCodePoint(0x1B);

describe("formatLocation", () => {
  it("renders <file>:<line>:<col> inline", () => {
    expect(formatLocation(loc)).toBe("/abs/path/arch.puml:12:5");
  });

  it("is library-safe — no escape sequences", () => {
    // OSC8 / SGR escapes start with ESC (0x1B). Ensure none leak.
    expect(formatLocation(loc).includes(ESC)).toBe(false);
  });
});

describe("linkSourceLocation", () => {
  // `terminal-link.isSupported` returns false under vitest (no TTY),
  // so the helper consistently falls back to plain text in this
  // environment — exactly the contract we want for library users
  // piping output through.

  it("returns plain text when sourceLocation is undefined", () => {
    expect(linkSourceLocation("text")).toBe("text");
  });

  it("returns plain text when explicitly disabled", () => {
    expect(linkSourceLocation("text", loc, { disabled: true })).toBe("text");
  });

  it("returns plain text when terminal does not support OSC8 (e.g. piped stdout)", () => {
    // Vitest runs without a TTY → no OSC8 wrapping. Library-safety
    // invariant: the helper never emits escapes outside a real
    // hyperlink-capable terminal.
    expect(linkSourceLocation("text", loc)).toBe("text");
  });

  it("preserves the underlying text even if it contains spaces or symbols", () => {
    expect(linkSourceLocation("api  ", loc, { disabled: true })).toBe("api  ");
    expect(linkSourceLocation("→ b", loc, { disabled: true })).toBe("→ b");
  });
});
