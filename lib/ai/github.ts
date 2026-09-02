// ============================================================
// The bridge to Claude Code.
//
// Vista AI does not run Claude Code and does not pretend to. It opens an issue
// on this repository mentioning @claude; the claude-code-action workflow picks
// it up, works on a BRANCH, and opens a pull request. Vercel builds a preview
// from that branch by itself. The ERP then reads status back through this
// file.
//
// What this deliberately cannot do:
//   * merge a pull request
//   * dispatch a workflow (the token carries no `workflow` scope)
//   * deploy anything, to preview or production
//
// Production is reached only by a human merging to main, or by a human running
// the manual deploy-prod workflow. There is no code path from Vista AI to
// either, which is the point of requirement §27.
//
// Everything here runs server-side. The token is never sent to the browser.
// ============================================================

const API = "https://api.github.com";

export interface GhConfig { token: string; owner: string; repo: string }

export function githubConfig(): GhConfig | null {
  const token = process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPO; // "owner/repo"
  if (!token || !slug || !slug.includes("/")) return null;
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) return null;
  return { token, owner, repo };
}

export function githubConfigured(): boolean {
  return githubConfig() !== null;
}

async function gh<T>(cfg: GhConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${cfg.token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // The message is shown to the user, so it says what to do about it.
    const hint =
      res.status === 401 || res.status === 403
        ? "GitHub rejected the token. An administrator needs to check GITHUB_TOKEN and its repository access."
        : res.status === 404
        ? "GitHub couldn't find that repository or issue. Check GITHUB_REPO."
        : `GitHub returned ${res.status}.`;
    throw new Error(`${hint}${body ? ` (${body.slice(0, 200)})` : ""}`);
  }
  return (await res.json()) as T;
}

export interface DispatchResult { issue_number: number; issue_url: string }

/**
 * Hand a prepared task to Claude Code by opening an issue that mentions it.
 * The prompt goes in verbatim — this does not summarise or re-word it.
 */
export async function dispatchTask(title: string, prompt: string): Promise<DispatchResult> {
  const cfg = githubConfig();
  if (!cfg) throw new Error("The Claude Code connection isn't configured on this server.");

  const body = [
    "@claude",
    "",
    prompt,
    "",
    "---",
    "_Raised from Vista AI. Work on a branch and open a pull request — do not merge, and do not deploy._",
  ].join("\n");

  const issue = await gh<{ number: number; html_url: string }>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/issues`,
    { method: "POST", body: JSON.stringify({ title, body }) }
  );

  return { issue_number: issue.number, issue_url: issue.html_url };
}

export interface TaskStatus {
  issue_state: "open" | "closed" | null;
  issue_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | null;
  pr_merged: boolean;
  branch: string | null;
  checks: "pending" | "passing" | "failing" | null;
  preview_url: string | null;
}

/**
 * Read back what has happened. Best-effort by design: a field we cannot
 * establish comes back null rather than guessed at, because a made-up "passing"
 * is worse than an honest "not known yet".
 */
export async function taskStatus(issueNumber: number): Promise<TaskStatus> {
  const cfg = githubConfig();
  if (!cfg) throw new Error("The Claude Code connection isn't configured on this server.");

  const out: TaskStatus = {
    issue_state: null, issue_url: null, pr_number: null, pr_url: null,
    pr_state: null, pr_merged: false, branch: null, checks: null, preview_url: null,
  };

  const issue = await gh<{ state: "open" | "closed"; html_url: string }>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/issues/${issueNumber}`
  );
  out.issue_state = issue.state;
  out.issue_url = issue.html_url;

  // Find the PR that mentions this issue. Search is the only way to link them
  // when the action names the issue in the PR body.
  const q = encodeURIComponent(`repo:${cfg.owner}/${cfg.repo} is:pr ${issueNumber} in:body`);
  const found = await gh<{ items: { number: number }[] }>(cfg, `/search/issues?q=${q}&per_page=5`)
    .catch(() => ({ items: [] as { number: number }[] }));

  if (!found.items.length) return out;

  const pr = await gh<{
    number: number; html_url: string; state: "open" | "closed"; merged: boolean;
    head: { sha: string; ref: string };
  }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls/${found.items[0].number}`);

  out.pr_number = pr.number;
  out.pr_url = pr.html_url;
  out.pr_state = pr.state;
  out.pr_merged = pr.merged;
  out.branch = pr.head.ref;

  // CI on the PR's current head.
  const checks = await gh<{ check_runs: { status: string; conclusion: string | null }[] }>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/commits/${pr.head.sha}/check-runs`
  ).catch(() => null);

  if (checks?.check_runs?.length) {
    const runs = checks.check_runs;
    if (runs.some((r) => r.status !== "completed")) out.checks = "pending";
    else if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) out.checks = "failing";
    else out.checks = "passing";
  }

  // Vercel posts the preview URL as a comment on the PR. Read it rather than
  // constructing one — a guessed URL that 404s is worse than no URL.
  const comments = await gh<{ body: string }[]>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/issues/${pr.number}/comments?per_page=30`
  ).catch(() => [] as { body: string }[]);

  for (const c of [...comments].reverse()) {
    const m = /https:\/\/[a-z0-9-]+(?:-[a-z0-9]+)*\.vercel\.app[^\s)\]]*/i.exec(c.body ?? "");
    if (m) { out.preview_url = m[0]; break; }
  }

  return out;
}
