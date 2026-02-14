vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from "node:fs/promises";

import consola from "consola";

const mockAccess = vi.mocked(fs.access);
const mockWriteFile = vi.mocked(fs.writeFile);

const runInit = async (): Promise<void> => {
  const mod = await import("../../src/cli/commands/init");
  const command = mod.init;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args: {} });
};

describe("init command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates aact.config.ts when it does not exist", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content as string).toContain("defineConfig");
    expect(content as string).toContain("source:");
    expect(content as string).toContain("rules:");
    expect(consola.success).toHaveBeenCalled();
  });

  it("skips when aact.config.ts already exists", async () => {
    mockAccess.mockResolvedValue();

    await runInit();

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
  });

  it("template contains all rule sections", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    const content = mockWriteFile.mock.calls[0][1] as string;
    expect(content).toContain("acl:");
    expect(content).toContain("acyclic:");
    expect(content).toContain("crud:");
    expect(content).toContain("dbPerService:");
    expect(content).toContain("cohesion:");
  });

  it("template contains generate section", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    const content = mockWriteFile.mock.calls[0][1] as string;
    expect(content).toContain("generate:");
    expect(content).toContain("kubernetes:");
    expect(content).toContain("boundaryLabel:");
  });
});
