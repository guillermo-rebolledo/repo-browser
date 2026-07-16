# AgentLens

AgentLens is a deterministic repository auditor for AI and agent engineering practices. Paste a public GitHub repository URL to review agent instructions, AI architecture, reusable skills, and operational safeguards.

## What it detects

- `AGENTS.md`, `CLAUDE.md`, and related instruction quality
- AI provider and agent SDKs, tool calling, structured output, MCP, retrieval, and memory
- Reusable skills, prompts, commands, hooks, and agent workflows
- Evaluations, observability, retries, timeouts, permissions, and secret-handling signals
- Project context for web, CLI, library, agent, and mixed repositories

Findings are heuristics based on observable text. Scores are directional indicators, not proof of code quality, security, AI authorship, or production readiness.

## Privacy and security

The MVP:

- supports public GitHub repositories only;
- uses GitHub's API instead of cloning repositories;
- never installs dependencies or executes repository code;
- scans at most 80 prioritized text files and 1.5 MB;
- excludes binaries, generated/vendor directories, lockfiles, and oversized files;
- does not send source code to an LLM or persist it.

An optional GitHub token is used only server-side and should have read-only public repository access.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | No | Raises GitHub API limits. Use a fine-grained, read-only token. |

Without a token, GitHub generally permits 60 API requests per hour per originating IP. A scan uses metadata and tree requests plus one request per selected file, so rate limits can be reached quickly.

## Architecture

- `src/app` — Next.js UI and analysis API route
- `src/lib/github.ts` — strict URL parsing and bounded GitHub ingestion
- `src/lib/analysis` — typed deterministic rules, evidence, scoring, and recommendations
- `src/components/auditor.tsx` — submission, loading/error states, and audit report

The server resolves repository metadata and the default branch, selects a bounded set of high-value text files, fetches blobs, and passes an in-memory snapshot into the local rule engine. The structured result is returned to the browser and is not stored.

## Current limitations

- Public GitHub repositories only; GitHub Enterprise and private repositories are unsupported.
- GitHub may truncate very large recursive trees.
- String heuristics can produce false positives and miss dynamic or unusual implementations.
- The scanner does not parse language ASTs or evaluate runtime behavior.
- No saved audit history, user accounts, background jobs, or external model review.
