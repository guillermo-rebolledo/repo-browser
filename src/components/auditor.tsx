"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import type { AnalysisResult, Finding, FindingCategory } from "@/lib/analysis/types";

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: AnalysisResult };

const categoryIcons: Record<FindingCategory, string> = {
  guidance: "◎",
  implementation: "◇",
  skills: "⌘",
  safety: "△",
};

function scoreTone(score: number) {
  if (score >= 75) return "strong";
  if (score >= 40) return "developing";
  return "early";
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div>
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function FindingCard({ finding, result }: { finding: Finding; result: AnalysisResult }) {
  const evidence = finding.evidence[0];
  const evidenceUrl = evidence
    ? `${result.repository.url}/blob/${encodeURIComponent(result.repository.defaultBranch)}/${evidence.path}${evidence.line ? `#L${evidence.line}` : ""}`
    : undefined;

  return (
    <article className={`finding-card ${finding.kind}`}>
      <div className="finding-topline">
        <span className={`kind-pill ${finding.kind}`}>
          {finding.kind === "opportunity" ? "Opportunity" : "Detected"}
        </span>
        <span className={`impact ${finding.impact}`}>{finding.impact} impact</span>
      </div>
      <h4>{finding.title}</h4>
      <p>{finding.description}</p>
      {finding.recommendation && <p className="recommendation">{finding.recommendation}</p>}
      {evidence && evidenceUrl && (
        <a className="evidence" href={evidenceUrl} target="_blank" rel="noreferrer">
          <span>{evidence.path}{evidence.line ? `:${evidence.line}` : ""}</span>
          <code>{evidence.excerpt}</code>
        </a>
      )}
    </article>
  );
}

function Results({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  const [filter, setFilter] = useState<"all" | "opportunity" | "strength">("all");
  const findings = useMemo(
    () => result.findings.filter((finding) => filter === "all" || finding.kind === filter),
    [filter, result.findings],
  );
  const opportunities = result.findings.filter((finding) => finding.kind === "opportunity").length;
  const detections = result.findings.filter((finding) => finding.kind === "strength").length;

  return (
    <main className="results-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgentLens home">
          <span className="brand-mark">A</span>
          <span>AgentLens</span>
        </Link>
        <button className="text-button" onClick={onReset}>Analyze another repo</button>
      </header>

      <section className="repo-heading">
        <div>
          <p className="eyebrow">Repository audit</p>
          <h1>{result.repository.owner}<span>/</span>{result.repository.name}</h1>
          <p>{result.repository.description || "No repository description provided."}</p>
          <div className="repo-meta">
            <span>{result.projectType} project</span>
            {result.repository.language && <span>{result.repository.language}</span>}
            <span>★ {result.repository.stars.toLocaleString()}</span>
            <span>{result.limitations.filesScanned} files scanned</span>
          </div>
        </div>
        <ScoreRing score={result.overallScore} />
      </section>

      <section className="score-grid" aria-label="Category scores">
        {result.categories.map((category) => (
          <article key={category.category} className="score-card">
            <div className="score-card-heading">
              <span className="category-icon">{categoryIcons[category.category]}</span>
              <span className={`score-value ${scoreTone(category.score)}`}>{category.score}</span>
            </div>
            <h3>{category.label}</h3>
            <p>{category.summary}</p>
            <div className="score-track"><span style={{ width: `${category.score}%` }} /></div>
          </article>
        ))}
      </section>

      <section className="findings-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit details</p>
            <h2>Signals and next steps</h2>
          </div>
          <div className="filters" role="group" aria-label="Filter findings">
            {([
              ["all", `All ${result.findings.length}`],
              ["opportunity", `Opportunities ${opportunities}`],
              ["strength", `Detected ${detections}`],
            ] as const).map(([value, label]) => (
              <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="findings-grid">
          {findings.map((finding) => <FindingCard key={finding.id} finding={finding} result={result} />)}
        </div>
      </section>

      <section className="method-card">
        <div>
          <h3>How to read this audit</h3>
          <p>{result.methodology}</p>
        </div>
        <div className="scan-stats">
          <span><strong>{(result.limitations.bytesScanned / 1000).toFixed(0)} KB</strong> inspected</span>
          <span><strong>{result.limitations.filesInTree.toLocaleString()}</strong> tree entries</span>
        </div>
        <ul>{result.limitations.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </section>
    </main>
  );
}

export function Auditor() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [state, setState] = useState<ViewState>({ status: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!repositoryUrl.trim()) return;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl }),
      });
      const payload = await response.json() as {
        data?: AnalysisResult;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Analysis failed. Please try again.");
      }
      setState({ status: "success", result: payload.data });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Analysis failed." });
    }
  }

  if (state.status === "success") {
    return <Results result={state.result} onReset={() => setState({ status: "idle" })} />;
  }

  return (
    <main className="landing">
      <header className="topbar landing-bar">
        <Link className="brand" href="/" aria-label="AgentLens home">
          <span className="brand-mark">A</span>
          <span>AgentLens</span>
        </Link>
        <span className="privacy-badge"><i /> Local rules · No LLM</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Repository agent auditor</p>
          <h1>See how ready your codebase is for <em>agentic development.</em></h1>
          <p className="hero-subtitle">
            Paste a public GitHub repository. AgentLens inspects agent instructions,
            AI architecture, skills, and safety practices—without executing or sharing your code.
          </p>
          <form onSubmit={submit} className="audit-form">
            <label htmlFor="repository">Public GitHub repository URL</label>
            <div className="input-row">
              <span className="github-icon">⌁</span>
              <input
                id="repository"
                type="url"
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                required
                disabled={state.status === "loading"}
              />
              <button type="submit" disabled={state.status === "loading"}>
                {state.status === "loading" ? <><i className="spinner" /> Scanning</> : <>Run audit <span>→</span></>}
              </button>
            </div>
            {state.status === "error" && <p className="form-error" role="alert">{state.message}</p>}
            <p className="form-note">Public repositories only · Up to 80 prioritized text files · No code execution</p>
          </form>
        </div>

        <div className="preview-card" aria-hidden="true">
          <div className="preview-header">
            <span className="mini-mark">A</span>
            <div><strong>acme/launchpad</strong><span>Audit complete</span></div>
            <b>68</b>
          </div>
          <div className="preview-bars">
            {[
              ["Agent guidance", 84],
              ["AI implementation", 72],
              ["Skills & automation", 61],
              ["Quality & safety", 55],
            ].map(([label, score]) => (
              <div key={label}>
                <p><span>{label}</span><strong>{score}</strong></p>
                <i><b style={{ width: `${score}%` }} /></i>
              </div>
            ))}
          </div>
          <div className="preview-finding">
            <span>Priority opportunity</span>
            <strong>Add repeatable agent evaluations</strong>
            <p>No versioned evaluation dataset or regression harness was detected.</p>
          </div>
        </div>
      </section>

      <section className="principles">
        <article><span>01</span><div><h3>Instruction quality</h3><p>Review AGENTS.md, CLAUDE.md, and related guidance for actionable context.</p></div></article>
        <article><span>02</span><div><h3>Agent architecture</h3><p>Detect tools, MCP, structured output, memory, orchestration, and provider SDKs.</p></div></article>
        <article><span>03</span><div><h3>Safe autonomy</h3><p>Look for evaluations, observability, resilience, permissions, and secret controls.</p></div></article>
      </section>
    </main>
  );
}
