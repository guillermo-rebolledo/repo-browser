import { describe, expect, it, vi } from "vitest";
import { analyzeRepository } from "./analyze";
import type { RepositorySnapshot } from "./types";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    repository: {
      owner: "acme",
      name: "launchpad",
      url: "https://github.com/acme/launchpad",
      description: null,
      defaultBranch: "main",
      stars: 0,
      language: "TypeScript",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    files,
    limitations: {
      filesInTree: files.length,
      filesScanned: files.length,
      bytesScanned: files.reduce((sum, file) => sum + file.size, 0),
      skippedFiles: 0,
      truncatedTree: false,
      notes: [],
    },
  };
}

describe("analyzeRepository", () => {
  it("detects actionable agent guidance and records line evidence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const result = analyzeRepository(snapshot([
      {
        path: "AGENTS.md",
        content: "# Architecture\nUse `npm test` before submitting.\nNever edit generated files.",
        size: 72,
      },
    ]));
    vi.useRealTimers();

    expect(result.projectType).toBe("agent");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "guidance-file", kind: "strength" }),
      expect.objectContaining({
        id: "guidance-commands",
        evidence: [expect.objectContaining({ path: "AGENTS.md", line: 2 })],
      }),
    ]));
    expect(result.analyzedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("detects AI architecture and recommends missing safeguards", () => {
    const result = analyzeRepository(snapshot([
      {
        path: "src/agent.ts",
        content: 'import OpenAI from "openai";\nconst tools = [{ type: "function" }];',
        size: 70,
      },
      {
        path: "package.json",
        content: '{"dependencies":{"next":"latest","openai":"latest"}}',
        size: 52,
      },
    ]));

    expect(result.projectType).toBe("mixed");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider-sdk", kind: "strength" }),
      expect.objectContaining({ id: "add-evaluations", kind: "opportunity" }),
      expect.objectContaining({ id: "add-permissions", kind: "opportunity" }),
    ]));
  });

  it("does not claim AI safeguards are missing when no AI usage is detected", () => {
    const result = analyzeRepository(snapshot([
      { path: "README.md", content: "# Small utility", size: 15 },
    ]));

    expect(result.findings.some((finding) => finding.id === "add-evaluations")).toBe(false);
    expect(result.findings.some((finding) => finding.id === "add-agent-guidance")).toBe(true);
  });
});
