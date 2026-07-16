import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepositorySnapshot, GitHubError, parseGitHubUrl } from "./github";

describe("parseGitHubUrl", () => {
  it("accepts a canonical public repository URL", () => {
    expect(parseGitHubUrl("https://github.com/acme/launchpad")).toEqual({
      owner: "acme",
      repo: "launchpad",
    });
  });

  it("normalizes a .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/acme/launchpad.git")).toEqual({
      owner: "acme",
      repo: "launchpad",
    });
  });

  it.each([
    "http://github.com/acme/launchpad",
    "https://gitlab.com/acme/launchpad",
    "https://github.com/acme/launchpad/issues",
    "https://github.com/acme",
    "https://github.com/acme/%E0%A4%A",
    "not a url",
  ])("rejects unsupported input: %s", (value) => {
    expect(() => parseGitHubUrl(value)).toThrow(GitHubError);
  });
});

describe("fetchRepositorySnapshot", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches metadata, a tree, and prioritized text blobs", async () => {
    const responses = [
      {
        name: "launchpad",
        full_name: "acme/launchpad",
        html_url: "https://github.com/acme/launchpad",
        description: "Test repo",
        private: false,
        default_branch: "main",
        stargazers_count: 12,
        language: "TypeScript",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        tree: [
          { path: "AGENTS.md", type: "blob", sha: "agents", size: 20 },
          { path: "image.png", type: "blob", sha: "image", size: 500 },
        ],
        truncated: false,
      },
      {
        content: Buffer.from("# Agent guide\nnpm test").toString("base64"),
        encoding: "base64",
        size: 22,
      },
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchRepositorySnapshot("https://github.com/acme/launchpad");

    expect(snapshot.repository.name).toBe("launchpad");
    expect(snapshot.files).toEqual([
      { path: "AGENTS.md", content: "# Agent guide\nnpm test", size: 22 },
    ]);
    expect(snapshot.limitations.filesScanned).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps a GitHub rate-limit response to a safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    })));

    await expect(fetchRepositorySnapshot("https://github.com/acme/launchpad"))
      .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});
