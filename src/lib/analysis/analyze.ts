import type {
  AnalysisResult,
  CategoryScore,
  Confidence,
  Finding,
  FindingCategory,
  ProjectType,
  RepositoryFile,
  RepositorySnapshot,
} from "./types";

interface Rule {
  id: string;
  category: FindingCategory;
  title: string;
  description: string;
  pattern: RegExp;
  pathPattern?: RegExp;
  points: number;
  confidence?: Confidence;
}

const STRENGTH_RULES: Rule[] = [
  {
    id: "guidance-file",
    category: "guidance",
    title: "Dedicated agent guidance",
    description: "The repository provides instructions specifically for coding agents.",
    pattern: /\S/,
    pathPattern: /(?:^|\/)(?:agents|claude|cursor|gemini)\.md$/i,
    points: 24,
  },
  {
    id: "guidance-commands",
    category: "guidance",
    title: "Runnable development commands",
    description: "Agent guidance documents setup, test, build, or lint commands.",
    pattern: /(?:npm|pnpm|yarn|bun|pytest|cargo|go|make)\s+(?:install|run|test|build|lint|check|dev)|```(?:bash|sh|shell)/i,
    pathPattern: /(?:agents|claude|cursor|gemini)\.md$/i,
    points: 20,
  },
  {
    id: "guidance-architecture",
    category: "guidance",
    title: "Architecture context",
    description: "Agent guidance explains project structure or architectural boundaries.",
    pattern: /\b(?:architecture|project structure|directory structure|data flow|boundar(?:y|ies)|entry point)\b/i,
    pathPattern: /(?:agents|claude|cursor|gemini)\.md$/i,
    points: 18,
  },
  {
    id: "guidance-verification",
    category: "guidance",
    title: "Verification expectations",
    description: "Instructions tell agents how to validate changes.",
    pattern: /\b(?:test|lint|typecheck|type check|verification|acceptance criteria|before (?:committing|submitting))\b/i,
    pathPattern: /(?:agents|claude|cursor|gemini)\.md$/i,
    points: 18,
  },
  {
    id: "provider-sdk",
    category: "implementation",
    title: "AI provider or agent SDK",
    description: "Source or manifests reference an AI provider or agent framework.",
    pattern: /\b(?:openai|anthropic|@ai-sdk|langchain|langgraph|crewai|autogen|semantic-kernel|google-generativeai|bedrockruntime|agents-sdk)\b/i,
    points: 18,
  },
  {
    id: "tool-calling",
    category: "implementation",
    title: "Tool calling",
    description: "The implementation exposes tools or functions to an agent.",
    pattern: /\b(?:tool_calls?|function_calling|bind_tools|defineTool|tool\s*\(\s*\{|tools\s*[:=]\s*\[)\b/i,
    points: 16,
  },
  {
    id: "structured-output",
    category: "implementation",
    title: "Structured model output",
    description: "The implementation validates or constrains model responses.",
    pattern: /\b(?:response_format|json_schema|structuredOutput|with_structured_output|outputSchema|zodResponseFormat)\b/i,
    points: 14,
  },
  {
    id: "mcp",
    category: "implementation",
    title: "Model Context Protocol",
    description: "The repository implements or configures MCP integration.",
    pattern: /\b(?:model context protocol|@modelcontextprotocol|mcpServers|FastMCP|McpServer)\b/i,
    points: 16,
  },
  {
    id: "retrieval-memory",
    category: "implementation",
    title: "Retrieval or memory",
    description: "The implementation includes retrieval, embeddings, vector search, or agent memory.",
    pattern: /\b(?:embedding|vector(?:store| database| search)|retrieval|retriever|rag\b|agent memory|conversation memory)\b/i,
    points: 12,
  },
  {
    id: "skill-definition",
    category: "skills",
    title: "Reusable agent skills",
    description: "The repository contains dedicated skill instructions or definitions.",
    pattern: /\S/,
    pathPattern: /(?:^|\/)(?:skills?\/.*|skill\.md$|\.claude\/commands\/.*)/i,
    points: 35,
  },
  {
    id: "agent-workflow",
    category: "skills",
    title: "Agent automation workflow",
    description: "Prompts, agent workflows, hooks, or reusable commands are checked into the repository.",
    pattern: /\b(?:agent|prompt|skill|claude|copilot|cursor)\b/i,
    pathPattern: /(?:^|\/)(?:\.github\/workflows|prompts?|agents?|\.claude|\.cursor)\//i,
    points: 25,
  },
  {
    id: "evaluation",
    category: "safety",
    title: "AI evaluation coverage",
    description: "The repository references evaluations, model tests, or quality benchmarks.",
    pattern: /\b(?:evals?|evaluation|benchmark|golden dataset|promptfoo|deepeval|langsmith)\b/i,
    points: 22,
  },
  {
    id: "observability",
    category: "safety",
    title: "AI observability",
    description: "Tracing, telemetry, token accounting, or model monitoring is present.",
    pattern: /\b(?:opentelemetry|langfuse|langsmith|arize|helicone|token usage|trace_id|tracing)\b/i,
    points: 18,
  },
  {
    id: "resilience",
    category: "safety",
    title: "Resilience controls",
    description: "AI-facing code references retries, timeouts, rate limiting, or fallbacks.",
    pattern: /\b(?:retry|backoff|timeout|rate.?limit|fallback|circuit.?breaker)\b/i,
    points: 16,
  },
  {
    id: "secret-safety",
    category: "safety",
    title: "Secret handling guidance",
    description: "The repository documents environment-based secret handling.",
    pattern: /\b(?:process\.env|os\.environ|dotenv|secret manager|api key|API_KEY)\b/i,
    points: 14,
  },
  {
    id: "permission-boundary",
    category: "safety",
    title: "Tool permission boundaries",
    description: "Agent instructions or code address approvals, sandboxing, or tool permissions.",
    pattern: /\b(?:sandbox|allowlist|permission|human.in.the.loop|approval|required confirmation|read.only)\b/i,
    points: 18,
  },
];

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  guidance: "Agent guidance",
  implementation: "AI implementation",
  skills: "Skills & automation",
  safety: "Quality & safety",
};

function matchRule(rule: Rule, files: RepositoryFile[]) {
  for (const file of files) {
    if (rule.pathPattern && !rule.pathPattern.test(file.path)) continue;
    const match = rule.pattern.exec(file.content);
    rule.pattern.lastIndex = 0;
    if (!match || match.index === undefined) continue;
    const line = file.content.slice(0, match.index).split("\n").length;
    const sourceLine = file.content.split("\n")[line - 1]?.trim() ?? "";
    return {
      path: file.path,
      line,
      excerpt: sourceLine.slice(0, 180) || file.path,
    };
  }
  return undefined;
}

function classifyProject(files: RepositoryFile[]): ProjectType {
  const paths = files.map((file) => file.path.toLowerCase());
  const combined = files.map((file) => file.content.slice(0, 20_000)).join("\n");
  const web = /(?:next|react|vue|svelte|angular|express|fastapi|django)/i.test(combined)
    || paths.some((path) => /(?:pages|app|routes?)\//.test(path));
  const cli = /\b(?:commander|yargs|click|typer|argparse|cobra)\b/i.test(combined)
    || paths.some((path) => /(?:^|\/)(?:cli|cmd)\//.test(path));
  const agent = /\b(?:agent|openai|anthropic|langchain|langgraph|crewai|model context protocol)\b/i.test(combined);
  const count = [web, cli, agent].filter(Boolean).length;
  if (count > 1) return "mixed";
  if (agent) return "agent";
  if (web) return "web";
  if (cli) return "cli";
  if (paths.some((path) => /(?:^|\/)(?:src|lib)\//.test(path))) return "library";
  return "unknown";
}

function opportunity(
  id: string,
  category: FindingCategory,
  title: string,
  description: string,
  recommendation: string,
  impact: Finding["impact"],
): Finding {
  return {
    id,
    category,
    kind: "opportunity",
    title,
    description,
    recommendation,
    confidence: "medium",
    impact,
    evidence: [],
    points: 0,
  };
}

function buildOpportunities(strengthIds: Set<string>, hasAi: boolean): Finding[] {
  const results: Finding[] = [];
  if (!strengthIds.has("guidance-file")) {
    results.push(opportunity(
      "add-agent-guidance", "guidance", "Add repository-level agent guidance",
      "No AGENTS.md, CLAUDE.md, Cursor, or Gemini guidance file was found.",
      "Add an AGENTS.md with architecture, setup, test commands, conventions, boundaries, and safe operating rules.",
      "high",
    ));
  } else {
    if (!strengthIds.has("guidance-commands")) results.push(opportunity(
      "document-commands", "guidance", "Make commands copy-pasteable",
      "Agent guidance does not clearly expose runnable setup and verification commands.",
      "Document exact install, development, lint, typecheck, and test commands in fenced shell blocks.",
      "high",
    ));
    if (!strengthIds.has("guidance-architecture")) results.push(opportunity(
      "document-architecture", "guidance", "Explain architecture and boundaries",
      "The guidance lacks enough project structure context for reliable autonomous changes.",
      "Describe entry points, data flow, important directories, generated files, and modules agents should not modify.",
      "medium",
    ));
  }
  if (hasAi && !strengthIds.has("structured-output")) results.push(opportunity(
    "add-structured-output", "implementation", "Validate model output",
    "AI usage was detected without a clear structured-output contract.",
    "Use schema-constrained output and validate every model response before it reaches application logic.",
    "high",
  ));
  if (hasAi && !strengthIds.has("evaluation")) results.push(opportunity(
    "add-evaluations", "safety", "Create repeatable AI evaluations",
    "No evaluation harness or representative quality dataset was detected.",
    "Add deterministic unit tests plus a small versioned evaluation set for important agent tasks and regressions.",
    "high",
  ));
  if (hasAi && !strengthIds.has("observability")) results.push(opportunity(
    "add-observability", "safety", "Trace model and tool behavior",
    "No model-specific tracing, token accounting, or monitoring signal was detected.",
    "Record model, latency, token usage, tool calls, failures, and correlation IDs without logging sensitive content.",
    "medium",
  ));
  if (hasAi && !strengthIds.has("resilience")) results.push(opportunity(
    "add-resilience", "safety", "Bound failures and model latency",
    "The scan found no clear timeout, retry, rate-limit, or fallback controls around AI calls.",
    "Add explicit timeouts, bounded exponential retry for transient failures, rate-limit handling, and graceful fallback behavior.",
    "high",
  ));
  if (hasAi && !strengthIds.has("permission-boundary")) results.push(opportunity(
    "add-permissions", "safety", "Constrain agent tools",
    "No explicit permission or approval boundary was detected for agent actions.",
    "Use allowlisted tools, least-privilege credentials, sandboxing, and human approval for destructive or external side effects.",
    "high",
  ));
  if (!strengthIds.has("skill-definition")) results.push(opportunity(
    "add-skills", "skills", "Package repeatable work as skills",
    "No dedicated reusable agent skill or command definition was detected.",
    "Turn recurring repository workflows into focused skills with purpose, inputs, steps, constraints, and verification.",
    "medium",
  ));
  return results;
}

export function analyzeRepository(snapshot: RepositorySnapshot): AnalysisResult {
  const strengths: Finding[] = STRENGTH_RULES.flatMap((rule) => {
    const evidence = matchRule(rule, snapshot.files);
    if (!evidence) return [];
    return [{
      id: rule.id,
      category: rule.category,
      kind: "strength" as const,
      title: rule.title,
      description: rule.description,
      confidence: rule.confidence ?? "high",
      impact: rule.points >= 20 ? "high" as const : "medium" as const,
      evidence: [evidence],
      points: rule.points,
    }];
  });
  const strengthIds = new Set(strengths.map((finding) => finding.id));
  const hasAi = ["provider-sdk", "tool-calling", "mcp", "retrieval-memory"].some((id) => strengthIds.has(id));
  const opportunities = buildOpportunities(strengthIds, hasAi);

  const categories: CategoryScore[] = (Object.keys(CATEGORY_LABELS) as FindingCategory[]).map((category) => {
    const raw = strengths.filter((finding) => finding.category === category).reduce((sum, finding) => sum + finding.points, 0);
    const score = Math.min(100, raw);
    return {
      category,
      label: CATEGORY_LABELS[category],
      score,
      summary: score >= 75 ? "Strong, observable practices" : score >= 40 ? "Some foundations are present" : "Meaningful opportunities remain",
    };
  });
  const overallScore = Math.round(categories.reduce((sum, category) => sum + category.score, 0) / categories.length);

  return {
    repository: snapshot.repository,
    projectType: classifyProject(snapshot.files),
    overallScore,
    categories,
    findings: [...opportunities, ...strengths],
    limitations: snapshot.limitations,
    analyzedAt: new Date().toISOString(),
    methodology: "Deterministic heuristic scan of prioritized repository text files. Scores reflect observable signals, not code quality or AI authorship.",
  };
}
