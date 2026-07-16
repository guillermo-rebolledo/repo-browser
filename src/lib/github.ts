import type {
  RepositoryFile,
  RepositoryMetadata,
  RepositorySnapshot,
} from "@/lib/analysis/types";

const API_ROOT = "https://api.github.com";
const MAX_FILES = 80;
const MAX_FILE_BYTES = 150_000;
const MAX_TOTAL_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 12_000;

const TEXT_EXTENSIONS = new Set([
  "md", "mdx", "txt", "json", "jsonc", "yaml", "yml", "toml",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "go", "rs",
  "java", "kt", "rb", "php", "cs", "sh", "bash", "zsh",
]);

const IMPORTANT_FILES = new Set([
  "agents.md", "claude.md", "cursor.md", "gemini.md", "copilot-instructions.md",
  "package.json", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod",
  "dockerfile", "makefile", "skill.md", "mcp.json",
]);

const EXCLUDED_SEGMENTS = new Set([
  "node_modules", "vendor", "dist", "build", "coverage", ".next", ".git",
  "fixtures", "snapshots", "__snapshots__", "generated",
]);

const EXCLUDED_FILES = /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock|bun\.lockb?|poetry\.lock|cargo\.lock)$/i;

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "NOT_FOUND"
      | "PRIVATE"
      | "RATE_LIMITED"
      | "TOO_LARGE"
      | "GITHUB_ERROR",
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export function parseGitHubUrl(value: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new GitHubError("Enter a complete GitHub repository URL.", "INVALID_URL", 400);
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new GitHubError("Only public https://github.com repository URLs are supported.", "INVALID_URL", 400);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new GitHubError("Use a repository URL such as https://github.com/owner/repository.", "INVALID_URL", 400);
  }

  const owner = decodeURIComponent(segments[0]);
  const repo = decodeURIComponent(segments[1]).replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !validPart.test(owner) || !validPart.test(repo)) {
    throw new GitHubError("The GitHub owner or repository name is invalid.", "INVALID_URL", 400);
  }

  return { owner, repo };
}

function headers(): HeadersInit {
  const result: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repository-agent-auditor",
  };
  if (process.env.GITHUB_TOKEN) {
    result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return result;
}

async function githubFetch<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("GitHub did not respond in time. Try again.", "GITHUB_ERROR", 502);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubError("Repository not found. It may be private or unavailable.", "NOT_FOUND", 404);
    }
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new GitHubError("GitHub API rate limit reached. Try later or configure GITHUB_TOKEN.", "RATE_LIMITED", 429);
    }
    throw new GitHubError(`GitHub request failed (${response.status}).`, "GITHUB_ERROR", 502);
  }

  return response.json() as Promise<T>;
}

interface GitHubRepository {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitHubTree {
  tree: TreeEntry[];
  truncated: boolean;
}

interface GitHubBlob {
  content: string;
  encoding: "base64";
  size: number;
}

function shouldScan(entry: TreeEntry): boolean {
  if (entry.type !== "blob" || !entry.path || (entry.size ?? 0) > MAX_FILE_BYTES) return false;
  const lower = entry.path.toLowerCase();
  if (lower.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (EXCLUDED_FILES.test(lower)) return false;
  const filename = lower.split("/").at(-1) ?? "";
  const extension = filename.includes(".") ? filename.split(".").at(-1) ?? "" : "";
  return IMPORTANT_FILES.has(filename) || TEXT_EXTENSIONS.has(extension) || lower.startsWith(".github/");
}

function priority(path: string): number {
  const lower = path.toLowerCase();
  const filename = lower.split("/").at(-1) ?? "";
  if (["agents.md", "claude.md", "skill.md"].includes(filename)) return 0;
  if (lower.startsWith(".github/") || lower.includes("/skills/") || lower.includes("/prompts/")) return 1;
  if (IMPORTANT_FILES.has(filename)) return 2;
  return 3;
}

export async function fetchRepositorySnapshot(value: string): Promise<RepositorySnapshot> {
  const { owner, repo } = parseGitHubUrl(value);
  const repository = await githubFetch<GitHubRepository>(`/repos/${owner}/${repo}`);
  if (repository.private) {
    throw new GitHubError("Private repositories are not supported in this MVP.", "PRIVATE", 403);
  }

  const tree = await githubFetch<GitHubTree>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
  );
  if (tree.tree.length > 100_000) {
    throw new GitHubError("This repository is too large for the bounded MVP scanner.", "TOO_LARGE", 413);
  }

  const candidates = tree.tree
    .filter(shouldScan)
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);

  const files: RepositoryFile[] = [];
  let bytesScanned = 0;
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8);
    const blobs = await Promise.all(
      batch.map(async (entry) => ({ entry, blob: await githubFetch<GitHubBlob>(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`) })),
    );
    for (const { entry, blob } of blobs) {
      if (blob.encoding !== "base64" || blob.size > MAX_FILE_BYTES) continue;
      if (bytesScanned + blob.size > MAX_TOTAL_BYTES) break;
      const content = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
      if (content.includes("\u0000")) continue;
      files.push({ path: entry.path, content, size: blob.size });
      bytesScanned += blob.size;
    }
    if (bytesScanned >= MAX_TOTAL_BYTES) break;
  }

  const metadata: RepositoryMetadata = {
    owner,
    name: repository.name,
    url: repository.html_url,
    description: repository.description,
    defaultBranch: repository.default_branch,
    stars: repository.stargazers_count,
    language: repository.language,
    updatedAt: repository.updated_at,
  };

  return {
    repository: metadata,
    files,
    limitations: {
      filesInTree: tree.tree.length,
      filesScanned: files.length,
      bytesScanned,
      skippedFiles: Math.max(0, tree.tree.length - files.length),
      truncatedTree: tree.truncated,
      notes: [
        `Scans at most ${MAX_FILES} prioritized text files and ${(MAX_TOTAL_BYTES / 1_000_000).toFixed(1)} MB.`,
        "Generated, vendored, binary, lock, and oversized files are excluded.",
        ...(tree.truncated ? ["GitHub returned a truncated repository tree; some paths were unavailable."] : []),
      ],
    },
  };
}
