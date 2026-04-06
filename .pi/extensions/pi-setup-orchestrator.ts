import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type AgentConfig = {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
  filePath: string;
};

type PhaseName =
  | "brainstorm"
  | "review"
  | "plan"
  | "code"
  | "test"
  | "verify"
  | "improve";

type PhaseResult = {
  phase: PhaseName;
  title: string;
  agent: string;
  output: string;
  createdAt: string;
};

type WorkflowState = {
  id: string;
  kind: "feature" | "task" | "quick";
  objective: string;
  currentIndex: number;
  phases: PhaseName[];
  results: PhaseResult[];
  createdAt: string;
  updatedAt: string;
};

const SINGLE_PHASE_MAP: Record<string, PhaseName> = {
  brainstorm: "brainstorm",
  plan: "plan",
  code: "code",
  test: "test",
  improve: "improve",
};

const WORKFLOW_PHASES = {
  feature: ["brainstorm", "review", "plan", "review", "code", "review", "test", "verify", "improve", "review"] as PhaseName[],
  task: ["plan", "review", "code", "review", "test", "verify", "improve", "review"] as PhaseName[],
  quick: ["code", "review", "test", "improve"] as PhaseName[],
};

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = raw.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  const fmBlock = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const frontmatter: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body };
}

type ReviewFinding = {
  vector: string;
  raw: string;
  normalized: string;
  severity: string;
  evidence?: string;
  recommendation?: string;
  fingerprint: string;
  tokens: string[];
};

type FindingCluster = {
  id: string;
  vectors: string[];
  findings: ReviewFinding[];
  representative: ReviewFinding;
};

const REVIEW_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it", "of", "on", "or", "that", "the", "to", "with",
  "severity", "evidence", "recommendation", "review", "finding", "issue", "risk", "bug", "blind", "spot",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFindingText(value: string): string {
  return normalizeWhitespace(value.toLowerCase().replace(/^[\-•*\d.)\s]+/, "").replace(/[`'"]/g, ""));
}

function tokenizeFinding(value: string): string[] {
  return Array.from(new Set(
    normalizeFindingText(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !REVIEW_STOPWORDS.has(token))
  )).sort();
}

function fingerprintFinding(value: string): string {
  return tokenizeFinding(value).join("|");
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function parseSeverity(value: string): string {
  const match = value.match(/severity\s*[:=-]\s*([^;|]+?)(?=(?:\s+evidence\s*[:=-])|(?:\s+recommendation\s*[:=-])|$)/i);
  return normalizeWhitespace(match?.[1] || "unknown");
}

function parseEvidence(value: string): string | undefined {
  const match = value.match(/evidence\s*[:=-]\s*([^;|]+?)(?=(?:\s+recommendation\s*[:=-])|$)/i);
  const parsed = normalizeWhitespace(match?.[1] || "");
  return parsed || undefined;
}

function parseRecommendation(value: string): string | undefined {
  const match = value.match(/recommendation\s*[:=-]\s*(.+)$/i);
  const parsed = normalizeWhitespace(match?.[1] || "");
  return parsed || undefined;
}

function parseReviewFindings(vector: string, output: string): ReviewFinding[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[\-*•]/.test(line) || /^\d+[.)]\s+/.test(line) || /severity\s*[:=-]/i.test(line))
    .map((raw) => ({
      vector,
      raw,
      normalized: normalizeFindingText(raw),
      severity: parseSeverity(raw),
      evidence: parseEvidence(raw),
      recommendation: parseRecommendation(raw),
      fingerprint: fingerprintFinding(raw),
      tokens: tokenizeFinding(raw),
    }))
    .filter((finding) => finding.normalized.length > 0);
}

function clusterReviewFindings(findings: ReviewFinding[]): FindingCluster[] {
  const clusters: FindingCluster[] = [];
  for (const finding of findings) {
    const existing = clusters.find((cluster) => {
      const sameFingerprint = cluster.findings.some((candidate) => candidate.fingerprint && candidate.fingerprint === finding.fingerprint);
      if (sameFingerprint) return true;
      return cluster.findings.some((candidate) => jaccardSimilarity(candidate.tokens, finding.tokens) >= 0.55);
    });
    if (existing) {
      existing.findings.push(finding);
      if (!existing.vectors.includes(finding.vector)) existing.vectors.push(finding.vector);
      continue;
    }
    clusters.push({
      id: finding.fingerprint || `${finding.vector}:${clusters.length}`,
      vectors: [finding.vector],
      findings: [finding],
      representative: finding,
    });
  }
  return clusters.sort((left, right) => right.findings.length - left.findings.length || left.representative.normalized.localeCompare(right.representative.normalized));
}

function formatFindingCluster(cluster: FindingCluster, index: number): string {
  const representative = cluster.representative;
  const alternateCount = Math.max(cluster.findings.length - 1, 0);
  const evidence = representative.evidence ? `\n  Evidence: ${representative.evidence}` : "";
  const recommendation = representative.recommendation ? `\n  Recommendation: ${representative.recommendation}` : "";
  return `- Cluster ${index + 1} [${cluster.vectors.join(", ")}] (${cluster.findings.length} related finding${cluster.findings.length === 1 ? "" : "s"})\n  Severity: ${representative.severity}\n  Finding: ${representative.raw.replace(/^[\-•*\d.)\s]+/, "")}${evidence}${recommendation}${alternateCount ? `\n  Similar variants: ${alternateCount}` : ""}`;
}

async function listFilesSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export default function (pi: ExtensionAPI) {
  const repoRoot = process.cwd();
  const agentsDir = path.join(repoRoot, ".pi", "agents");
  const knowledgeDir = path.join(repoRoot, ".pi", "knowledge");
  const stateDir = path.join(repoRoot, ".pi", "state");
  const workflowStateFile = path.join(stateDir, "pending-workflow.json");
  const historyFile = path.join(stateDir, "workflow-history.jsonl");

  let pendingWorkflow: WorkflowState | null = null;

  async function ensureStateDir(): Promise<void> {
    await fs.mkdir(stateDir, { recursive: true });
  }

  async function loadAgents(): Promise<Record<string, AgentConfig>> {
    const files = (await listFilesSafe(agentsDir)).filter((name) => name.endsWith(".md"));
    const agents: Record<string, AgentConfig> = {};
    for (const file of files) {
      const filePath = path.join(agentsDir, file);
      const raw = await fs.readFile(filePath, "utf8");
      const { frontmatter, body } = parseFrontmatter(raw);
      if (!frontmatter.name || !frontmatter.description) continue;
      agents[frontmatter.name] = {
        name: frontmatter.name,
        description: frontmatter.description,
        model: frontmatter.model,
        tools: frontmatter.tools?.split(",").map((v) => v.trim()).filter(Boolean),
        systemPrompt: body.trim(),
        filePath,
      };
    }
    return agents;
  }

  function normalizeWorkflowObjective(value: string): string {
    return value.toLowerCase().replace(/[`'".]+/g, "").replace(/\s+/g, " ").trim();
  }

  async function isWorkflowCompletedInBacklog(workflow: WorkflowState): Promise<boolean> {
    const backlog = await readFileIfExists(path.join(knowledgeDir, "backlog.md"));
    if (!backlog.trim()) return false;
    const objective = normalizeWorkflowObjective(workflow.objective);
    return backlog
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*-\s*\[(x|X)\]\s+(.+)$/)?.[2] ?? "")
      .filter(Boolean)
      .some((item) => normalizeWorkflowObjective(item) === objective);
  }

  async function loadPendingWorkflow(): Promise<"active" | "cleared-completed" | "none"> {
    try {
      pendingWorkflow = JSON.parse(await fs.readFile(workflowStateFile, "utf8"));
    } catch {
      pendingWorkflow = null;
      return "none";
    }

    if (!pendingWorkflow) return "none";

    if (pendingWorkflow.currentIndex >= pendingWorkflow.phases.length) {
      const cleared = pendingWorkflow;
      pendingWorkflow = null;
      await savePendingWorkflow();
      await appendHistory({
        type: "workflow-auto-cleared",
        workflowId: cleared.id,
        workflow: cleared.kind,
        objective: cleared.objective,
        reason: "phase-index-complete",
      });
      return "none";
    }

    if (await isWorkflowCompletedInBacklog(pendingWorkflow)) {
      const cleared = pendingWorkflow;
      pendingWorkflow = null;
      await savePendingWorkflow();
      await appendHistory({
        type: "workflow-auto-cleared",
        workflowId: cleared.id,
        workflow: cleared.kind,
        objective: cleared.objective,
        reason: "completed-in-backlog",
      });
      return "cleared-completed";
    }

    return "active";
  }

  async function savePendingWorkflow(): Promise<void> {
    await ensureStateDir();
    if (!pendingWorkflow) {
      try {
        await fs.rm(workflowStateFile, { force: true });
      } catch {}
      return;
    }
    pendingWorkflow.updatedAt = new Date().toISOString();
    await fs.writeFile(workflowStateFile, JSON.stringify(pendingWorkflow, null, 2) + "\n", "utf8");
  }

  async function appendHistory(entry: Record<string, unknown>): Promise<void> {
    await ensureStateDir();
    await fs.appendFile(historyFile, JSON.stringify(entry) + "\n", "utf8");
  }

  async function readFileIfExists(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  async function buildContextBundle(): Promise<string> {
    const decisions = await readFileIfExists(path.join(knowledgeDir, "decisions.md"));
    const rules = await readFileIfExists(path.join(knowledgeDir, "rules.md"));
    const backlog = await readFileIfExists(path.join(knowledgeDir, "backlog.md"));
    const workflowHistory = (await readFileIfExists(historyFile)).trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
    const learningsDir = path.join(knowledgeDir, "learnings");
    const learningFiles = (await listFilesSafe(learningsDir)).filter((f) => f.endsWith(".md") && f !== "README.md").sort().slice(-8);
    const learnings = [] as string[];
    for (const file of learningFiles) {
      const text = await readFileIfExists(path.join(learningsDir, file));
      if (text.trim()) learnings.push(`## ${file}\n${text.trim()}`);
    }
    return [
      "# Compounding Context",
      decisions.trim() ? `## Decisions\n${decisions.trim()}` : "",
      rules.trim() ? `## Rules\n${rules.trim()}` : "",
      workflowHistory ? `## Recent Workflow History\n${workflowHistory}` : "",
      learnings.length ? `## Recent Learnings\n${learnings.join("\n\n")}` : "",
      backlog.trim() ? `## Backlog\n${backlog.trim()}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function summarizeResults(results: PhaseResult[]): string {
    if (!results.length) return "No prior workflow outputs.";
    return results.map((result, index) => {
      const preview = result.output.trim().slice(0, 2000);
      return `### ${index + 1}. ${result.title}\nAgent: ${result.agent}\n${preview}`;
    }).join("\n\n");
  }

  async function spawnPi(agent: AgentConfig, prompt: string, cwd: string = repoRoot): Promise<string> {
    const args: string[] = [];
    if (agent.model) args.push("--model", agent.model);
    if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
    args.push("-p", "--no-session", "--system-prompt", agent.systemPrompt, prompt);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn("pi", args, {
        cwd,
        env: {
          ...process.env,
          PI_SKIP_VERSION_CHECK: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `pi exited with code ${code}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async function runNamedAgent(agentName: string, prompt: string): Promise<string> {
    const agents = await loadAgents();
    const agent = agents[agentName];
    if (!agent) throw new Error(`Unknown agent: ${agentName}`);
    return await spawnPi(agent, prompt);
  }

  function reviewVectorsPrompt(topic: string, artifact: string, initialRequest: string, priorResults: PhaseResult[], vector: string): string {
    return [
      `Review vector: ${vector}`,
      `Initial request:\n${initialRequest}`,
      `Topic:\n${topic}`,
      `Artifact to review:\n${artifact}`,
      `Previous workflow outputs:\n${summarizeResults(priorResults)}`,
      "Return findings as bullets with Severity, Evidence, and Recommendation.",
      "Do not modify files.",
    ].join("\n\n");
  }

  function phaseSpec(kind: "feature" | "task" | "quick", phase: PhaseName, objective: string, prior: PhaseResult[]): { agent: string; title: string; prompt: string } {
    const priorSummary = summarizeResults(prior);
    const latest = prior.at(-1)?.output ?? "";
    switch (phase) {
      case "brainstorm":
        return {
          agent: "creator",
          title: "Brainstorm",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Generate candidate approaches, trade-offs, and a recommended path.",
            "Stay within the explicit user request only.",
          ].join("\n\n"),
        };
      case "plan":
        return {
          agent: "creator",
          title: "Implementation Plan",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Produce a concrete implementation plan with ordered steps, affected files, and validation strategy.",
            "Do not code yet.",
          ].join("\n\n"),
        };
      case "code":
        return {
          agent: "creator",
          title: "Code Changes",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Implement the task now.",
            "Keep edits minimal and scoped to the request.",
            "Summarize changed files and validation performed.",
          ].join("\n\n"),
        };
      case "test":
        return {
          agent: "tester",
          title: "Adversarial Testing",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Run adversarial tests now.",
            "If a local web app exists, attempt browser E2E using Playwright or repo scripts and take screenshots.",
            "Remember: Your job is not to confirm it works — it's to try to break it.",
          ].join("\n\n"),
        };
      case "verify":
        return {
          agent: "test-verifier",
          title: "Test Coverage Verification",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Tester output:\n${latest}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Verify that the performed tests covered the original requirements.",
            "Start the final section with STATUS: PASS or STATUS: FAIL.",
          ].join("\n\n"),
        };
      case "improve":
        return {
          agent: "improver",
          title: "Process Improvement",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Task A: Reflection & Documentation. Record learnings in separate files under `.pi/knowledge/learnings/` with exact fields Summary, Detail, Action, Tag.",
            "Task B: Creative Scan & Backlog. Review existing skills, prompts, and rules. Apply minimal process-only changes automatically. Add complex changes to `.pi/knowledge/backlog.md`.",
            "Do not touch application code.",
          ].join("\n\n"),
        };
      case "review":
      default:
        return {
          agent: "cross-reviewer",
          title: "Cross Review",
          prompt: [
            `Workflow kind: ${kind}`,
            `Objective:\n${objective}`,
            `Artifact to review:\n${latest || priorSummary}`,
            `Previous workflow outputs:\n${priorSummary}`,
            "Review for bugs, requirement drift, and blind spots.",
            "Read-only mode only.",
          ].join("\n\n"),
        };
    }
  }

  async function emitPhaseResult(result: PhaseResult, note?: string): Promise<void> {
    pi.sendMessage({
      customType: "workflow-phase",
      display: true,
      content: `## ${result.title}\n- Phase: ${result.phase}\n- Agent: ${result.agent}\n- Time: ${result.createdAt}${note ? `\n- Note: ${note}` : ""}\n\n${result.output}`,
    }, { triggerTurn: false });
  }

  async function runWorkflowPhase(workflow: WorkflowState): Promise<void> {
    const phase = workflow.phases[workflow.currentIndex];
    if (!phase) return;
    const spec = phaseSpec(workflow.kind, phase, workflow.objective, workflow.results);
    const output = await runNamedAgent(spec.agent, spec.prompt);
    const result: PhaseResult = {
      phase,
      title: spec.title,
      agent: spec.agent,
      output,
      createdAt: new Date().toISOString(),
    };
    workflow.results.push(result);
    workflow.currentIndex += 1;
    pendingWorkflow = workflow.currentIndex >= workflow.phases.length ? null : workflow;
    await savePendingWorkflow();
    await appendHistory({ type: "workflow-phase", workflowId: workflow.id, workflow: workflow.kind, objective: workflow.objective, result });
    await emitPhaseResult(result, pendingWorkflow ? "Reply with /continue to run the next phase." : "Workflow complete.");
    if (!pendingWorkflow) {
      pi.sendMessage({
        customType: "workflow-complete",
        display: true,
        content: `Workflow complete: ${workflow.kind}\nObjective: ${workflow.objective}`,
      }, { triggerTurn: false });
    }
  }

  async function startWorkflow(kind: "feature" | "task" | "quick", objective: string): Promise<void> {
    await loadPendingWorkflow();
    if (pendingWorkflow) throw new Error(`A workflow is already pending: ${pendingWorkflow.kind} -> ${pendingWorkflow.objective}`);
    const workflow: WorkflowState = {
      id: `${kind}-${Date.now()}`,
      kind,
      objective,
      currentIndex: 0,
      phases: [...WORKFLOW_PHASES[kind]],
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    pendingWorkflow = workflow;
    await savePendingWorkflow();
    await appendHistory({ type: "workflow-start", workflowId: workflow.id, workflow: workflow.kind, objective });
    pi.sendMessage({
      customType: "workflow-start",
      display: true,
      content: `Started ${kind} workflow for: ${objective}\n\nPhases: ${workflow.phases.join(" -> ")}`,
    }, { triggerTurn: false });
    await runWorkflowPhase(workflow);
  }

  async function runParallelReview(objective: string): Promise<void> {
    const artifact = pendingWorkflow?.results.at(-1)?.output ?? objective;
    const priorResults = pendingWorkflow?.results ?? [];
    const vectors = ["correctness", "architecture", "security"];
    const outputs = await Promise.all(vectors.map(async (vector) => ({
      vector,
      output: await runNamedAgent("cross-reviewer", reviewVectorsPrompt(objective, artifact, objective, priorResults, vector)),
    })));

    const findings = outputs.flatMap((item) => parseReviewFindings(item.vector, item.output));
    const clusters = clusterReviewFindings(findings);
    const exactUniqueLines = Array.from(new Set(outputs.flatMap((item) => item.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))));
    const merged = outputs.map((item) => `### ${item.vector}\n${item.output}`).join("\n\n");
    const clusterSection = clusters.length
      ? clusters.map((cluster, index) => formatFindingCluster(cluster, index)).join("\n")
      : "- No structured findings extracted for clustering.";
    const exactSection = exactUniqueLines.length
      ? exactUniqueLines.map((line) => `- ${line}`).join("\n")
      : "- No findings.";

    pi.sendMessage({
      customType: "parallel-review",
      display: true,
      content: `## Parallel Review\n\n${merged}\n\n## Semantic Clusters\n${clusterSection}\n\n## Exact Unique Lines\n${exactSection}`,
    }, { triggerTurn: false });
  }

  async function runSinglePhase(phase: PhaseName, objective: string): Promise<void> {
    const spec = phaseSpec("task", phase, objective, pendingWorkflow?.results ?? []);
    const output = phase === "review"
      ? await runNamedAgent("cross-reviewer", reviewVectorsPrompt(objective, objective, objective, pendingWorkflow?.results ?? [], "correctness"))
      : await runNamedAgent(spec.agent, spec.prompt);
    await emitPhaseResult({ phase, title: spec.title, agent: spec.agent, output, createdAt: new Date().toISOString() });
  }

  async function runRecurse(goal: string, maxIterations = 5): Promise<void> {
    const failures: string[] = [];
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const workPrompt = [
        `Recursive goal:\n${goal}`,
        failures.length ? `Previous failed fixes and error logs:\n${failures.join("\n\n---\n\n")}` : "No prior failed fixes yet.",
        `Iteration: ${iteration}`,
        "Do the work now.",
        "Strict instruction: do not repeat fixes that have already failed, try a different approach.",
      ].join("\n\n");
      const workOutput = await runNamedAgent("creator", workPrompt);
      await emitPhaseResult({ phase: "code", title: `Recurse Work ${iteration}`, agent: "creator", output: workOutput, createdAt: new Date().toISOString() });

      const testOutput = await runNamedAgent("tester", [
        `Recursive goal:\n${goal}`,
        `Work output:\n${workOutput}`,
        failures.length ? `Previous failed fixes and error logs:\n${failures.join("\n\n---\n\n")}` : "",
        `Iteration: ${iteration}`,
        "Your job is not to confirm it works — it's to try to break it.",
      ].join("\n\n"));
      await emitPhaseResult({ phase: "test", title: `Recurse Test ${iteration}`, agent: "tester", output: testOutput, createdAt: new Date().toISOString() });

      const evaluation = await runNamedAgent("test-verifier", [
        `Recursive goal:\n${goal}`,
        `Creator output:\n${workOutput}`,
        `Tester output:\n${testOutput}`,
        failures.length ? `Previous failed fixes and error logs:\n${failures.join("\n\n---\n\n")}` : "",
        `Iteration: ${iteration}`,
        "Return STATUS: PASS or STATUS: FAIL.",
      ].join("\n\n"));
      await emitPhaseResult({ phase: "verify", title: `Recurse Evaluate ${iteration}`, agent: "test-verifier", output: evaluation, createdAt: new Date().toISOString() });

      if (/STATUS:\s*PASS/i.test(evaluation)) {
        pi.sendMessage({
          customType: "recurse-finished",
          display: true,
          content: `Recursive workflow achieved goal in ${iteration} iteration(s).`,
        }, { triggerTurn: false });
        return;
      }

      failures.push(`Iteration ${iteration}\nCreator:\n${workOutput}\n\nTester:\n${testOutput}\n\nVerifier:\n${evaluation}`);
    }

    pi.sendMessage({
      customType: "recurse-failed",
      display: true,
      content: `Recursive workflow stopped after ${maxIterations} iterations without STATUS: PASS.`,
    }, { triggerTurn: false });
  }

  async function runIdeaPipeline(idea: string): Promise<void> {
    const context = await buildContextBundle();
    const creatorOutput = await runNamedAgent("creator", [
      "Analyze the external idea and convert it into an integration plan for the current pi-setup.",
      `Idea:\n${idea}`,
      context,
      "Return: fit assessment, affected assets, implementation outline, and rollout order.",
    ].join("\n\n"));
    const reviewerOutput = await runNamedAgent("cross-reviewer", [
      `Idea:\n${idea}`,
      `Proposed integration plan:\n${creatorOutput}`,
      context,
      "Review for blind spots, conflicts with current rules, and missing safeguards.",
    ].join("\n\n"));
    pi.sendMessage({
      customType: "idea-pipeline",
      display: true,
      content: `## External Idea Analysis\n\n### Integration Plan\n${creatorOutput}\n\n### Cross-review\n${reviewerOutput}`,
    }, { triggerTurn: false });
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureStateDir();
    const status = await loadPendingWorkflow();
    if (status === "cleared-completed") {
      ctx.ui.notify("Cleared stale pending workflow because the objective is already marked complete in the backlog.", "info");
    }
  });

  pi.on("before_agent_start", async () => {
    const context = await buildContextBundle();
    return {
      message: {
        customType: "pi-setup-context",
        content: context,
        display: false,
      },
    };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run a project agent in isolated context, either singly or in parallel.",
    promptSnippet: "Delegate work to project-local agents with isolated context.",
    parameters: Type.Object({
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
    }),
    async execute(_toolCallId, params) {
      if (params.agent && params.task) {
        const output = await runNamedAgent(params.agent, params.task);
        return { content: [{ type: "text", text: output }], details: { mode: "single" } };
      }
      if (params.tasks?.length) {
        const outputs = await Promise.all(params.tasks.map(async (task) => ({ agent: task.agent, output: await runNamedAgent(task.agent, task.task) })));
        return {
          content: [{ type: "text", text: outputs.map((item) => `## ${item.agent}\n${item.output}`).join("\n\n") }],
          details: { mode: "parallel", outputs },
        };
      }
      return { content: [{ type: "text", text: "Provide either {agent, task} or tasks[]." }], isError: true };
    },
  });

  pi.registerCommand("continue", {
    description: "Continue the next phase of the pending workflow",
    handler: async (_args, ctx) => {
      const status = await loadPendingWorkflow();
      if (status === "cleared-completed") {
        ctx.ui.notify("Cleared stale pending workflow because the objective is already marked complete in the backlog.", "info");
      }
      if (!pendingWorkflow) {
        ctx.ui.notify("No pending workflow.", "warning");
        return;
      }
      await runWorkflowPhase(pendingWorkflow);
    },
  });

  for (const [name, phase] of Object.entries(SINGLE_PHASE_MAP)) {
    pi.registerCommand(name, {
      description: `Run the ${name} phase as an isolated agent task`,
      handler: async (args, ctx) => {
        if (!args.trim()) {
          ctx.ui.notify(`Usage: /${name} <objective>`, "warning");
          return;
        }
        await runSinglePhase(phase, args.trim());
      },
    });
  }

  pi.registerCommand("review", {
    description: "Run parallel correctness, architecture, and security reviews",
    handler: async (args, ctx) => {
      const objective = args.trim() || pendingWorkflow?.objective;
      if (!objective) {
        ctx.ui.notify("Usage: /review <objective>", "warning");
        return;
      }
      await runParallelReview(objective);
    },
  });

  for (const kind of Object.keys(WORKFLOW_PHASES) as Array<keyof typeof WORKFLOW_PHASES>) {
    pi.registerCommand(kind, {
      description: `Start the ${kind} workflow`,
      handler: async (args, ctx) => {
        if (!args.trim()) {
          ctx.ui.notify(`Usage: /${kind} <objective>`, "warning");
          return;
        }
        await startWorkflow(kind, args.trim());
      },
    });
  }

  pi.registerCommand("recurse", {
    description: "Loop work → test → evaluate until pass or iteration limit",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /recurse <goal>", "warning");
        return;
      }
      await runRecurse(args.trim());
    },
  });

  pi.registerCommand("idea", {
    description: "Analyze an external idea and generate an integration plan",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /idea <concept or prompt>", "warning");
        return;
      }
      await runIdeaPipeline(args.trim());
    },
  });

  pi.registerCommand("workflow-status", {
    description: "Show the pending workflow status",
    handler: async (_args, ctx) => {
      await loadPendingWorkflow();
      if (!pendingWorkflow) {
        ctx.ui.notify("No pending workflow.", "info");
        return;
      }
      ctx.ui.notify(`${pendingWorkflow.kind}: ${pendingWorkflow.currentIndex}/${pendingWorkflow.phases.length} complete — ${pendingWorkflow.objective}`, "info");
    },
  });

  pi.registerCommand("workflow-clear", {
    description: "Clear a stale pending workflow",
    handler: async (_args, ctx) => {
      await loadPendingWorkflow();
      if (!pendingWorkflow) {
        ctx.ui.notify("No pending workflow.", "info");
        return;
      }
      const cleared = pendingWorkflow;
      pendingWorkflow = null;
      await savePendingWorkflow();
      await appendHistory({
        type: "workflow-cleared",
        workflowId: cleared.id,
        workflow: cleared.kind,
        objective: cleared.objective,
      });
      ctx.ui.notify(`Cleared pending workflow: ${cleared.kind} -> ${cleared.objective}`, "info");
    },
  });
}
