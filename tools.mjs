// Clay Studio local MCP server: exposes recent Claude Code sessions and GitHub PRs over stdio.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, open, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";

const run = promisify(execFile);
const PROJECTS = join(homedir(), ".claude", "projects");
const DESKTOP_SESSIONS = join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions");

// the desktop app keeps one record per session: its own id, the CLI transcript id, title and archived flag
async function desktopSessions() {
  const byCli = new Map();
  for (const a of await readdir(DESKTOP_SESSIONS).catch(() => [])) for (const b of await readdir(join(DESKTOP_SESSIONS, a)).catch(() => [])) {
    const dir = join(DESKTOP_SESSIONS, a, b);
    for (const f of await readdir(dir).catch(() => [])) {
      if (!/^local_.*\.json$/.test(f)) continue;
      try { const d = JSON.parse(await readFile(join(dir, f), "utf8")); if (d.cliSessionId) byCli.set(d.cliSessionId, { id: d.sessionId, title: d.title, archived: !!d.isArchived }); } catch {}
    }
  }
  return byCli;
}
// personal and work settings live outside the repo, in ~/.config/clayday/config.json (see config.example.json)
const CONFIG_FILE = process.env.CLAYDAY_CONFIG || join(homedir(), ".config", "clayday", "config.json");
const home = (p) => (typeof p === "string" ? p.replace(/^~(?=\/|$)/, homedir()) : p);
async function config() { try { return JSON.parse(await readFile(CONFIG_FILE, "utf8")); } catch { return {}; } }
async function ghRepo() { const r = (await config()).github?.repo; if (!r) throw new Error(`Set github.repo in ${CONFIG_FILE}`); return r; }
const GH = process.env.CLAY_GH || ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find((p) => existsSync(p)) || "gh";

const TOOLS = [
  {
    name: "my_artifacts",
    description: "The Claude artifacts I published from Claude Code on this computer: title, link, version and when it last changed.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max artifacts (default 60)." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "studio_config",
    description: "The studio's personal settings: your name, a line about you, your Slack ids and the deploy dashboard link.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "claude_sessions",
    description: "Recent Claude Code sessions on this computer, newest first, with where each one stopped.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look back this many days (default 5)." },
        limit: { type: "number", description: "Max sessions (default 12)." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "open_session",
    description: "Open one of my Claude Code sessions: in the Claude desktop app (sessionId) or in its cmux tab (cmuxTitle).",
    inputSchema: { type: "object", properties: {
      sessionId: { type: "string", description: "Desktop session id, local_<uuid>." },
      cmuxTitle: { type: "string", description: "Title of the cmux tab that runs the session." },
      cmuxName: { type: "string", description: "The name the user gave that cmux tab, if any." },
    } },
  },
  {
    name: "close_session",
    description: "Close the cmux tab that runs one of my Claude Code sessions.",
    inputSchema: { type: "object", properties: { cmuxTitle: { type: "string", description: "Title of the cmux tab to close." }, cmuxName: { type: "string", description: "The name the user gave that cmux tab, if any." } } },
  },
  {
    name: "github_prs",
    description: "My open pull requests (with CI and review state), my merged pull requests still waiting for a production deploy, and pull requests waiting for my review.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "sponge_scan",
    description: "List what can be safely cleaned up to free memory and disk: running services of unused pool slots, finished worktrees, old node_modules, stale worktree records.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "sponge_status",
    description: "Progress of the running (or last) sponge cleanup.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "sponge_wipe",
    description: "Start cleaning up the given items from sponge_scan. It runs in the background; read progress with sponge_status. Each item is checked again first; anything no longer safe is skipped.",
    inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Item ids from sponge_scan." } }, required: ["ids"] },
  },
];
async function readSlice(path, size) {
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 120_000));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(size, 400_000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    return { head: head.toString("utf8"), tail: tail.toString("utf8") };
  } finally {
    await fh.close();
  }
}

const lines = (s) =>
  s.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
};

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

async function claudeSessions({ days = 5, limit = 12 } = {}) {
  const since = Date.now() - days * 86_400_000;
  const files = [];
  for (const dir of await readdir(PROJECTS).catch(() => [])) {
    const full = join(PROJECTS, dir);
    for (const f of await readdir(full).catch(() => [])) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(full, f);
      const s = await stat(p).catch(() => null);
      if (s && s.mtimeMs >= since) files.push({ p, s, id: f.slice(0, -6) });
    }
  }
  files.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  const [desk, cmux] = await Promise.all([desktopSessions(), cmuxTabs()]);

  const out = [];
  for (const { p, s, id } of files.slice(0, limit * 2)) {
    const { head, tail } = await readSlice(p, s.size);
    const all = [...lines(head), ...lines(tail)];
    let title = "", aiTitle = "", cwd = "", branch = "", lastUser = "", lastAssistant = "", recap = "";
    let prs = new Set(), waiting = false, lastType = "";
    for (const e of all) {
      if (e.type === "custom-title") title = e.customTitle;
      if (e.type === "ai-title") aiTitle = e.aiTitle;
      if (e.type === "pr-link" && e.prNumber) prs.add(e.prNumber);
      if (e.cwd) cwd = e.cwd;
      if (e.gitBranch) branch = e.gitBranch;
      if (e.isSidechain) continue;
      if (e.type === "user") {
        const t = textOf(e.message?.content).trim();
        if (t && !t.startsWith("<")) {
          lastUser = t;
          lastType = "user";
        }
      }
      if (e.type === "assistant") {
        for (const c of e.message?.content || []) {
          if (c.type === "text" && c.text.trim()) lastAssistant = c.text;
          if (c.type === "tool_use" && /wrap_up$/.test(c.name) && c.input?.recap) recap = c.input.recap;
        }
        lastType = "assistant";
        waiting = e.message?.stop_reason === "end_turn";
      }
    }
    if (!lastUser && !lastAssistant) continue;
    const d = desk.get(id);
    if (d?.archived) continue;
    const firstUser = lines(head).find((e) => e.type === "user" && textOf(e.message?.content).trim() && !textOf(e.message?.content).startsWith("<"));
    const shown = clip(d?.title || title || aiTitle || textOf(firstUser?.message?.content), 90);
    const tab = cmux.get(normTitle(title)) || cmux.get(normTitle(aiTitle)) || cmux.get(normTitle(shown)) || null;
    out.push({
      id,
      title: tab?.name || shown,
      cmux: tab ? { title: tab.title, name: tab.name, status: tab.status } : null,
      project: cwd.replace(homedir(), "~"),
      branch,
      updatedAt: new Date(s.mtimeMs).toISOString(),
      lastAsk: clip(lastUser, 280),
      whereItStopped: clip(recap || lastAssistant, 600),
      yourTurn: tab?.status ? tab.status === "Needs input" : lastType === "assistant" && waiting,
      prs: [...prs],
      desktopId: d?.id || null,
      openLink: d?.id ? `claude://claude.ai/epitaxy/${d.id}` : null,
    });
    if (out.length >= limit) break;
  }
  return { sessions: out };
}

function ciSummary(rollup = []) {
  let pass = 0, fail = 0, pending = 0;
  const failing = [];
  for (const c of rollup) {
    const state = (c.conclusion || c.state || c.status || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) pass++;
    else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(state)) {
      fail++;
      failing.push(c.name || c.context);
    } else pending++;
  }
  const state = fail ? "failing" : pending ? "running" : pass ? "green" : "none";
  return { state, pass, fail, pending, failing: failing.slice(0, 5) };
}

async function gh(args) {
  const { stdout } = await run(GH, args, { maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
  return JSON.parse(stdout || "[]");
}

async function latestProductionTag() {
  const REPO = await ghRepo();
  const d = new Date();
  for (let back = 0; back < 2; back++) {
    const m = new Date(d.getFullYear(), d.getMonth() - back, 1);
    const prefix = `production-${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, "0")}`;
    const refs = await gh(["api", `repos/${REPO}/git/matching-refs/tags/${prefix}`, "--jq", "[.[].ref]"]).catch(() => []);
    if (refs.length) return refs.sort().at(-1).replace("refs/tags/", "");
  }
  return null;
}

// a merged PR is live once its merge commit is an ancestor of the newest production-* tag
async function mergedAwaitingDeploy() {
  const REPO = await ghRepo();
  const since = Date.now() - 7 * 86_400_000;
  const [merged, tag] = await Promise.all([
    gh(["pr", "list", "-R", REPO, "--author", "@me", "--state", "merged", "--base", (await config()).github?.reviewBase || "main", "--limit", "15", "--json", "number,title,url,mergedAt,mergeCommit"]),
    latestProductionTag(),
  ]);
  const recent = merged.filter((p) => p.mergedAt && new Date(p.mergedAt).getTime() >= since && p.mergeCommit?.oid);
  const out = await Promise.all(recent.map(async (p) => {
    let deployed = null;
    if (tag) {
      const status = await gh(["api", `repos/${REPO}/compare/${p.mergeCommit.oid}...${tag}`, "--jq", "{status: .status}"]).then((r) => r.status).catch(() => null);
      deployed = status === "ahead" || status === "identical" ? true : status === "behind" || status === "diverged" ? false : null;
    }
    return { number: p.number, title: p.title, url: p.url, mergedAt: p.mergedAt, deployed };
  }));
  return { tag, awaiting: out.filter((p) => p.deployed === false), unknown: out.filter((p) => p.deployed === null) };
}

async function githubPrs() {
  const REPO = await ghRepo(); const REVIEW_TEAM = (await config()).github?.reviewTeam;
  const REVIEW_BASE = (await config()).github?.reviewBase || "main";   // skip stacked PRs that target another branch
  const [mine, toReview, merged] = await Promise.all([
    gh(["pr", "list", "-R", REPO, "--author", "@me", "--state", "open", "--limit", "20",
      "--json", "number,title,url,isDraft,reviewDecision,statusCheckRollup,updatedAt,mergeable,comments"]),
    // only my team's review queue plus reviews asked of me by name, not every team I belong to
    Promise.all([REVIEW_TEAM && `team-review-requested:${REVIEW_TEAM}`, "user-review-requested:@me"].filter(Boolean).map((q) =>
      gh(["search", "prs", q, "--state=open", "--base", REVIEW_BASE, "--limit", "15", "--json", "number,title,url,repository,author,updatedAt"]).catch(() => [])))
      .then((lists) => { const seen = new Set(); return lists.flat().filter((p) => !seen.has(p.url) && seen.add(p.url)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); }),
    mergedAwaitingDeploy().catch(() => ({ tag: null, awaiting: [], unknown: [] })),
  ]);
  return {
    mine: mine.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      draft: p.isDraft,
      review: p.reviewDecision || "NONE",
      mergeable: p.mergeable,
      comments: p.comments?.length || 0,
      ci: ciSummary(p.statusCheckRollup),
      updatedAt: p.updatedAt,
    })),
    toReview: toReview.filter((p) => !mine.some((m) => m.url === p.url)).map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      repo: p.repository?.nameWithOwner,
      author: p.author?.login,
      updatedAt: p.updatedAt,
    })),
    awaitingDeploy: merged.awaiting,
    lastProductionDeploy: merged.tag,
  };
}

const CMUX_DIR = join(homedir(), "Library", "Application Support", "cmux");
const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const normTitle = (t) => String(t || "").replace(/^[^\p{L}\p{N}#]+/u, "").trim().toLowerCase();

// cmux saves every tab's title and Claude status; a tab title is the Claude session title behind a status glyph
async function cmuxTabs() {
  const byTitle = new Map();
  try {
    const d = JSON.parse(await readFile(join(CMUX_DIR, "session-com.cmuxterm.app.json"), "utf8"));
    for (const w of d.windows || []) (w.tabManager?.workspaces || []).forEach((ws, index) => {
      const status = (ws.statusEntries || []).find((e) => e.key === "claude_code")?.value || null;
      const name = ws.customTitle ? String(ws.customTitle).trim() : null;   // the name you gave the tab in cmux
      const proc = normTitle(ws.processTitle);
      for (const t of [ws.processTitle, ...(ws.panels || []).map((p) => p.title), ws.customTitle]) {
        const k = normTitle(t);
        if (k && !k.startsWith("…") && !byTitle.has(k)) byTitle.set(k, { title: proc || k, name, workspace: index, status });
      }
    });
  } catch {}
  return byTitle;
}

async function cmuxWorkspaceRef(...wants) {
  const ws = wants.map(normTitle).filter(Boolean);
  const { stdout } = await run(CMUX_BIN, ["list-workspaces"], { timeout: 5_000 });
  const hits = stdout.split("\n").filter((l) => /workspace:\d+/.test(l) && ws.some((w) => l.toLowerCase().includes(w)));
  return hits.length === 1 ? hits[0].match(/workspace:\d+/)[0] : null;   // never guess between two tabs
}
const cmuxWhy = (e) => (/Access denied/i.test(String(e.stderr || e.message)) ? "access_denied" : /password/i.test(String(e.stderr || e.message)) ? "password_needed" : "cmux did not answer");

async function closeSession({ cmuxTitle, cmuxName } = {}) {
  const want = normTitle(cmuxTitle) || normTitle(cmuxName);
  if (!want || want.length > 200) throw new Error("Not a cmux tab title");
  try {
    const ref = await cmuxWorkspaceRef(cmuxName, cmuxTitle);
    if (!ref) return { closed: false, reason: "tab not found" };
    await run(CMUX_BIN, ["close-workspace", "--workspace", ref], { timeout: 5_000 });
    return { closed: true };
  } catch (e) { return { closed: false, reason: cmuxWhy(e) }; }
}

async function openInCmux(cmuxTitle, cmuxName) {
  const want = normTitle(cmuxTitle) || normTitle(cmuxName);
  if (!want || want.length > 200) throw new Error("Not a cmux tab title");
  let focused = false, reason = "";
  try {
    const ref = await cmuxWorkspaceRef(cmuxName, cmuxTitle);
    if (ref) { await run(CMUX_BIN, ["select-workspace", "--workspace", ref], { timeout: 5_000 }); focused = true; }
    else reason = "tab not found";
  } catch (e) { reason = cmuxWhy(e); }
  await run("/usr/bin/open", ["-a", "cmux"], { timeout: 10_000 });
  return { opened: "cmux", focused, reason };
}

async function openSession({ sessionId, cmuxTitle, cmuxName } = {}) {
  if (cmuxTitle || cmuxName) return openInCmux(cmuxTitle, cmuxName);
  if (!/^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(sessionId))) throw new Error("Not a desktop session id");
  await run("/usr/bin/open", [`claude://claude.ai/epitaxy/${sessionId}`], { timeout: 10_000 });
  return { opened: sessionId };
}


// ---------- sponge: free memory and disk without touching anything in use ----------
const CODE = join(homedir(), "code");
// sponge settings: which repos to scan, and an optional pool of dev slots driven by its own scripts
async function spongeConfig() {
  const c = (await config()).sponge || {};
  const pool = c.pool && c.pool.scripts ? { scripts: home(c.pool.scripts), cwd: home(c.pool.cwd || CODE), slotDir: home(c.pool.slotDir || ""), slotPattern: new RegExp(c.pool.slotPattern || "$^") } : null;
  const rebuildable = (c.rebuildable || ["node_modules", ".pnpm-store", "tmp", "log"]).filter((n) => /^[\w.-]+$/.test(n));
  return { repos: (c.repos || []).map(home).filter((r) => existsSync(join(r, ".git"))), pool, rebuildable };
}
const DAY = 86_400_000;
const BASH = existsSync("/opt/homebrew/bin/bash") ? "/opt/homebrew/bin/bash" : "bash";
const INFRA_ENV = { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}` } };
const sh = async (cmd, args, opts = {}) => { try { return (await run(cmd, args, { timeout: 60_000, maxBuffer: 32 << 20, ...opts })).stdout; } catch { return null; } };
const inside = (child, parent) => child === parent || child.startsWith(parent + "/");

// people: folders open in cmux or used by a recent Claude session; procs: working folders of running processes
async function inUsePaths() {
  const paths = new Set(), procs = [];
  const cwds = await sh("/usr/sbin/lsof", ["-d", "cwd", "-Fn"]);
  for (const l of (cwds || "").split("\n")) if (l.startsWith("n/")) procs.push(l.slice(1));
  try {
    const d = JSON.parse(await readFile(join(CMUX_DIR, "session-com.cmuxterm.app.json"), "utf8"));
    for (const w of d.windows || []) for (const ws of w.tabManager?.workspaces || []) {
      if (ws.currentDirectory) paths.add(ws.currentDirectory);
      for (const pn of ws.panels || []) if (pn.directory) paths.add(pn.directory);
    }
  } catch {}
  for (const a of await readdir(DESKTOP_SESSIONS).catch(() => [])) for (const b of await readdir(join(DESKTOP_SESSIONS, a)).catch(() => [])) for (const f of await readdir(join(DESKTOP_SESSIONS, a, b)).catch(() => [])) {
    if (!/^local_.*\.json$/.test(f)) continue;
    try { const d = JSON.parse(await readFile(join(DESKTOP_SESSIONS, a, b, f), "utf8")); if (!d.isArchived && d.cwd && Date.now() - (d.lastActivityAt || 0) < 3 * DAY) paths.add(d.cwd); } catch {}
  }
  for (const dir of await readdir(PROJECTS).catch(() => [])) for (const f of await readdir(join(PROJECTS, dir)).catch(() => [])) {
    if (!f.endsWith(".jsonl")) continue; const fp = join(PROJECTS, dir, f); const st = await stat(fp).catch(() => null);
    if (!st || Date.now() - st.mtimeMs > 2 * DAY) continue;
    const { head } = await readSlice(fp, st.size); const m = head.match(/"cwd":"([^"]+)"/); if (m) paths.add(m[1]);
  }
  return { people: [...paths], all: [...paths, ...procs] };
}
const usedBy = (list, dir) => list.some((u) => inside(u, dir));

async function sizeOf(path) {
  const out = await sh("/usr/bin/du", ["-sk", path], { timeout: 45_000 });
  const kb = out && parseInt(out, 10); return Number.isFinite(kb) ? kb * 1024 : null;
}

async function worktrees(repo) {
  const out = await sh("git", ["-C", repo, "worktree", "list", "--porcelain"]); if (!out) return [];
  return out.trim().split("\n\n").map((b) => ({
    path: (b.match(/^worktree (.+)$/m) || [])[1], branch: ((b.match(/^branch (.+)$/m) || [])[1] || "").replace("refs/heads/", ""),
    locked: /^locked/m.test(b), prunable: /^prunable/m.test(b), repo,
  })).filter((w) => w.path && w.path !== repo);
}

async function worktreeSafety(w, used, pool) {
  if (w.locked) return "locked";
  if (pool?.slotPattern.test(w.path)) return "pool slot";
  if (!existsSync(w.path)) return "missing";
  if (usedBy(used.all, w.path)) return "in use";
  const dirty = await sh("git", ["-C", w.path, "status", "--porcelain"], { timeout: 90_000 });
  if (dirty === null) return "could not read";
  if (dirty.trim()) return "has changes";
  const remote = await sh("git", ["-C", w.path, "branch", "-r", "--contains", "HEAD"]);
  if (!remote || !remote.trim()) return "not pushed";
  return null;
}

async function nodeModules(dir) {
  const out = await sh("/usr/bin/find", [dir, "-maxdepth", "3", "-type", "d", "-name", "node_modules", "-prune"], { timeout: 30_000 });
  return (out || "").split("\n").filter(Boolean);
}

const GB = 1024 ** 3;
const PNPM_BINS = [join(homedir(), ".local/share/mise/shims/pnpm"), "/opt/homebrew/bin/pnpm", "/usr/local/bin/pnpm"].filter((p) => existsSync(p));   // the mise shim first: it picks the pnpm your projects pin
const PNPM = PNPM_BINS[0];
const parseSize = (t) => { const m = String(t || "").match(/([\d.]+)\s*([kKMGT]?B)/); if (!m) return 0; return parseFloat(m[1]) * { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2]]; };
const unionBytes = async (paths) => { if (!paths.length) return 0; const out = await sh("/usr/bin/du", ["-sk", ...paths], { timeout: 120_000 }); return (out || "").split("\n").reduce((a, l) => a + (parseInt(l, 10) || 0) * 1024, 0); };

// folders in an idle pool slot that git ignores and a package install brings back
async function rebuildableDirs(dir, names) {
  const found = [];
  for (const n of names) for (const f of ((await sh("/usr/bin/find", [dir, "-maxdepth", "3", "-type", "d", "-name", n, "-prune"], { timeout: 60_000 })) || "").split("\n").filter(Boolean)) {
    if (f.split("/").includes(".git")) continue;
    try { await run("git", ["-C", dir, "check-ignore", "-q", f], { timeout: 10_000 }); found.push(f); } catch {}   // exit 0 only when git ignores it
  }
  return found.filter((f) => !found.some((o) => o !== f && f.startsWith(o + "/")));
}

async function dockerItems() {
  if (!(await sh("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 8_000, ...INFRA_ENV }))) {
    const colima = existsSync(join(homedir(), ".colima")) ? (await sizeOf(join(homedir(), ".colima"))) : null;
    return colima > 2 * GB ? [{ id: "skip:docker", kind: "kept", label: "Docker", detail: `not running · start it (for example colima start) and squeeze again to clean up to ${(colima / GB).toFixed(0)} GB`, safe: false, kept: true }] : [];
  }
  const rows = ((await sh("docker", ["system", "df", "--format", "{{json .}}"], { timeout: 30_000, ...INFRA_ENV })) || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const bytes = rows.filter((r) => r.Type !== "Local Volumes").reduce((a, r) => a + parseSize(r.Reclaimable), 0);
  return bytes > .2 * GB ? [{ id: "docker", kind: "docker", label: "Docker: remove unused images and build cache", detail: "stopped containers, images no container uses and build cache · never touches volumes, so databases stay", bytes, safe: true }] : [];
}

async function simulatorItems() {
  const raw = await sh("/usr/bin/xcrun", ["simctl", "list", "devices", "-j"], { timeout: 30_000 }); if (!raw) return [];
  let devices; try { devices = JSON.parse(raw).devices; } catch { return []; }
  const dir = join(homedir(), "Library", "Developer", "CoreSimulator", "Devices"); const drop = []; const seen = new Map();
  for (const [runtime, list] of Object.entries(devices)) {
    const sized = await Promise.all(list.map(async (d) => ({ ...d, mtime: (await stat(join(dir, d.udid)).catch(() => null))?.mtimeMs || 0 })));
    for (const d of sized.sort((a, b) => b.mtime - a.mtime)) {
      if (d.isAvailable === false) { drop.push(d); continue; }
      const key = `${runtime}:${d.name}`; if (!seen.has(key)) { seen.set(key, d); continue; }   // keep the newest of each name
      if (d.state === "Shutdown") drop.push(d);
    }
  }
  if (!drop.length) return [];
  const bytes = await unionBytes(drop.map((d) => join(dir, d.udid)).filter((p) => existsSync(p)));
  return [{ id: `sims:${drop.map((d) => d.udid).join(",")}`, kind: "sims", label: `Simulators: delete ${drop.length} duplicate or unavailable`, detail: "keeps the newest simulator of each name · only ones that are shut down · Xcode makes them again when needed", bytes, safe: true }];
}

async function pnpmStores() {
  const { repos, pool } = await spongeConfig(); const cwd = repos[0] || pool?.cwd || homedir(); const out = [];
  for (const dir of [cwd, homedir()]) for (const bin of PNPM_BINS) { const p = ((await sh(bin, ["store", "path"], { timeout: 20_000, cwd: dir, ...INFRA_ENV })) || "").trim(); if (p && existsSync(p) && !out.some((o) => o.path === p)) out.push({ bin, path: p }); }
  return out;
}
async function pnpmItem() {
  const stores = await pnpmStores(); if (!stores.length) return [];
  const main = stores[0], parent = dirname(main.path), cur = basename(main.path); const inUse = new Set(stores.filter((x) => dirname(x.path) === parent).map((x) => basename(x.path)));
  const size = await sizeOf(main.path); const out = [];
  const old = []; for (const v of await readdir(parent).catch(() => [])) { if (!/^v\d+$/.test(v) || inUse.has(v)) continue; const st = await stat(join(parent, v)).catch(() => null); if (st && Date.now() - st.mtimeMs > 30 * DAY) old.push(v); }
  if (old.length) out.push({ id: `pnpmold:${old.join(",")}`, kind: "pnpmold", label: `pnpm: delete old store versions (${old.join(", ")})`, detail: `no pnpm on this Mac uses them (they use ${[...inUse].join(", ")}) · a project that still needs one downloads its packages again`, bytes: await unionBytes(old.map((v) => join(parent, v))), safe: true });
  if (size && size > GB) out.push({ id: "pnpm", kind: "pnpm", label: "pnpm: drop packages no project uses", detail: `your projects' store (${cur}) is ${(size / GB).toFixed(0)} GB · the saving depends on what is unused · it runs after the slot cleanup, so it can free more`, bytes: null, sizeText: "?", safe: true });
  return out;
}

// `want`: when cleaning, only the parts that hold the chosen items are looked at again (a full scan takes about a minute)
async function spongeItems(want) {
  const needs = (...prefixes) => !want || [...want].some((id) => prefixes.some((p) => id.startsWith(p)));
  const used = await inUsePaths(); const items = []; const { repos, pool: poolCfg } = await spongeConfig();
  // running services of pool slots nobody is working in: frees RAM, keeps everything else
  const pool = poolCfg && needs("slot") ? JSON.parse((await sh(BASH, [join(poolCfg.scripts, "pool-status.sh")], { timeout: 90_000, cwd: poolCfg.cwd, ...INFRA_ENV })) || "{}") : {};
  const { rebuildable } = await spongeConfig();
  for (const sl of pool.pool_slots || []) {
    const dir = poolCfg.slotDir.replace("{n}", sl.slot);
    if (sl.status === "idle" && !sl.services_running && existsSync(dir) && !usedBy(used.all, dir) && !usedBy(used.all, dir + "-agent")) {
      const dirs = await rebuildableDirs(dir, rebuildable);
      const bytes = await unionBytes(dirs);
      if (bytes > .2 * GB) items.push({ id: `slotclean:${sl.slot}`, kind: "slotclean", label: `Slot ${sl.slot}: clear rebuildable folders`, detail: `${sl.branch || "pool branch"} · ${dirs.length} folders git ignores (${[...new Set(dirs.map((d) => d.split("/").pop()))].join(", ")}) · your code and branch stay · an install brings them back`, bytes, safe: true, dirs });
    }
    if (!sl.services_running) continue;
    const busy = usedBy(used.people, dir) || usedBy(used.people, dir + "-agent");
    items.push({ id: `slot:${sl.slot}`, kind: "memory", label: `Stop slot ${sl.slot} services`, detail: `${sl.branch || "pool branch"} · frees about 3–4 GB of RAM · keeps the worktree, database and branch`, bytes: null, ram: true, safe: !busy, why: busy ? "a session seems to work in it" : "" });
  }
  // worktrees whose work is all pushed and that nothing has open
  for (const repo of needs("wt:", "nm:", "prune:", "skip:") ? repos : []) for (const w of await worktrees(repo)) {
    if (w.prunable || !existsSync(w.path)) { items.push({ id: `prune:${repo}`, kind: "records", label: `Forget missing worktrees (${repo.split("/").pop()})`, detail: "git worktree prune · folder already gone", bytes: 0, safe: true }); continue; }
    const why = await worktreeSafety(w, used, poolCfg);
    if (why === "pool slot" || why === "locked") continue;
    const age = Math.round((Date.now() - ((await stat(w.path).catch(() => null))?.mtimeMs || Date.now())) / DAY);
    if (!why) items.push({ id: `wt:${w.path}`, kind: "worktree", label: `Remove worktree ${w.path.split("/").pop()}`, detail: `${w.branch || "detached"} · all pushed · ${age}d old · branch stays`, path: w.path, repo: w.repo, safe: true });
    else if (why !== "in use" && age >= 7 && (await nodeModules(w.path)).length) for (const nm of await nodeModules(w.path)) items.push({ id: `nm:${nm}`, kind: "modules", label: `Delete node_modules in ${w.path.split("/").pop()}`, detail: `${nm.replace(w.path, "") || "/node_modules"} · untouched ${age}d · pnpm install brings it back`, path: nm, safe: false });
    else items.push({ id: `skip:${w.path}`, kind: "kept", label: `Keep ${w.path.split("/").pop()}`, detail: why, bytes: null, safe: false, kept: true });
  }
  items.push(...(needs("docker", "skip:docker") ? await dockerItems() : []), ...(needs("sims:") ? await simulatorItems() : []), ...(needs("pnpm") ? await pnpmItem() : []));
  const uniq = [...new Map(items.map((x) => [x.id, x])).values()];
  await Promise.all(uniq.map(async (x) => { if (x.path && x.bytes === undefined) x.bytes = await sizeOf(x.path); }));
  return uniq;
}

async function spongeScan() {
  const items = await spongeItems();
  return { items: items.map(({ path, repo, dirs, ...x }) => x), scannedAt: new Date().toISOString() };
}

const JOB_FILE = join(tmpdir(), "clayday-sponge-job.json");
async function readJob() {
  try { const job = JSON.parse(await readFile(JOB_FILE, "utf8"));
    if (job.running) { try { process.kill(job.pid, 0); } catch { job.running = false; job.interrupted = true; } }   // the process that ran it is gone
    return job; } catch { return { running: false }; }
}
const saveJob = (job) => writeFile(JOB_FILE, JSON.stringify(job)).catch(() => {});

// starts the cleanup in the background and answers at once: big deletions take minutes, longer than a tool call may wait
async function spongeWipe({ ids = [] } = {}) {
  const now = await readJob(); if (now.running) return now;
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  const job = { running: true, pid: process.pid, startedAt: Date.now(), total: want.size, current: "checking what is still safe", results: [] }; await saveJob(job);
  (async () => {
    try {
      const fresh = await spongeItems(want);
      for (const x of fresh) {
        if (!want.has(x.id) || x.kept) continue;
        job.current = x.label; await saveJob(job);
        if (x.why) { job.results.push({ id: x.id, ok: false, reason: x.why }); continue; }
        try { await runWipeItem(x); job.results.push({ id: x.id, ok: true, bytes: x.bytes ?? null }); }
        catch (e) { job.results.push({ id: x.id, ok: false, reason: String(e.stderr || e.message || e).split("\n")[0].slice(0, 200) }); }
        await saveJob(job);
      }
      for (const id of want) if (!job.results.some((r) => r.id === id)) job.results.push({ id, ok: false, reason: "no longer safe or already gone" });
    } catch (e) { job.error = String(e.message || e).slice(0, 200); }
    job.running = false; job.current = null; job.finishedAt = Date.now(); await saveJob(job);
  })();
  return job;
}
async function spongeStatus() { return readJob(); }

async function runWipeItem(x) {
    if (x.kind === "memory") { const { pool: pc } = await spongeConfig(); await run(BASH, [join(pc.scripts, "slot-stop.sh"), x.id.slice(5)], { timeout: 120_000, cwd: pc.cwd, ...INFRA_ENV }); }
    else if (x.kind === "worktree") await run("git", ["-C", x.repo, "worktree", "remove", x.path], { timeout: 180_000 });
    else if (x.kind === "modules") { if (!x.path.endsWith("/node_modules") || !(inside(x.path, CODE) || x.path.startsWith("/private/tmp/"))) throw new Error("unexpected path"); await rm(x.path, { recursive: true, force: true }); }
    else if (x.kind === "records") await run("git", ["-C", x.id.slice(6), "worktree", "prune"], { timeout: 60_000 });
    else if (x.kind === "slotclean") {
      const { pool: pc, rebuildable } = await spongeConfig(); const slotDir = pc.slotDir.replace("{n}", x.id.slice(10));
      for (const d of x.dirs) { if (!inside(d, slotDir) || !rebuildable.includes(d.split("/").pop()) || d === slotDir) throw new Error("unexpected path"); await run("/bin/rm", ["-rf", d], { timeout: 1_200_000 }); }
    }
    else if (x.kind === "docker") { await run("docker", ["system", "prune", "-af"], { timeout: 1_200_000, ...INFRA_ENV }); }
    else if (x.kind === "sims") { for (const id of x.id.slice(5).split(",")) if (/^[0-9A-F-]{36}$/.test(id)) await run("/usr/bin/xcrun", ["simctl", "delete", id], { timeout: 120_000 }); }
    else if (x.kind === "pnpmold") {
      const stores = await pnpmStores(); const parent = dirname(stores[0].path); const inUse = new Set(stores.filter((o) => dirname(o.path) === parent).map((o) => basename(o.path)));
      for (const v of x.id.slice(8).split(",")) if (/^v\d+$/.test(v) && !inUse.has(v)) { await run("/bin/rm", ["-rf", join(parent, v)], { timeout: 1_200_000 }); if (existsSync(join(parent, v))) throw new Error(`${v} is still there`); }
    }
    else if (x.kind === "pnpm") { const st = (await pnpmStores())[0]; const { repos, pool } = await spongeConfig(); await run(st.bin, ["store", "prune"], { timeout: 1_200_000, cwd: repos[0] || pool?.cwd || homedir(), ...INFRA_ENV }); }
}

// artifacts published from Claude Code on this Mac, read from the publish lines in local transcripts
const artScan = new Map();   // transcript path -> { key, hits }: only changed transcripts are read again
const ART_MARK = Buffer.from(" at https://claude.ai/artifact/");
function artHits(buf) {
  const hits = []; let at = 0;
  while ((at = buf.indexOf(ART_MARK, at)) !== -1) {
    const before = buf.toString("utf8", Math.max(0, at - 700), at), after = buf.toString("utf8", at + 4, at + 120);
    const f = before.match(/Published (\S+)$/), u = after.match(/^(https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+) \(Version (\d+)/);
    if (f && u) hits.push({ file: f[1], url: u[1], version: +u[2] });
    at += ART_MARK.length;
  }
  return hits;
}
async function myArtifacts({ limit = 60 } = {}) {
  const byUrl = new Map(); const files = [];
  for (const dir of await readdir(PROJECTS).catch(() => [])) for (const f of await readdir(join(PROJECTS, dir)).catch(() => [])) if (f.endsWith(".jsonl")) files.push(join(PROJECTS, dir, f));
  for (const fp of files) {
    const st = await stat(fp).catch(() => null); if (!st) continue;
    const key = `${st.mtimeMs}:${st.size}`; let c = artScan.get(fp);
    if (!c || c.key !== key) { c = { key, hits: artHits(await readFile(fp).catch(() => Buffer.alloc(0))) }; artScan.set(fp, c); }
    for (const h of c.hits) { const cur = byUrl.get(h.url); if (!cur || h.version > cur.version) byUrl.set(h.url, { ...h, transcript: fp }); }
  }
  const deleted = new Set((await config()).deletedArtifacts || []);   // ids of artifacts deleted from claude.ai
  for (const u of [...byUrl.keys()]) if (deleted.has(u.split("/").pop())) byUrl.delete(u);
  const list = await Promise.all([...byUrl.values()].map(async (a) => {
    const st = await stat(a.transcript).catch(() => null);
    let title = "";
    try { title = ((await readFile(a.file, "utf8")).match(/<title>([^<]{1,120})<\/title>/i) || [])[1] || ""; } catch {}
    if (!title) title = a.file.split("/").pop().replace(/\.(html|md)$/i, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    return { url: a.url, title: title.trim(), version: a.version, updatedAt: st ? new Date(st.mtimeMs).toISOString() : null };
  }));
  list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { artifacts: list.slice(0, limit) };
}

async function studioConfig() {
  const c = await config();
  return { name: c.name || "", about: c.about || "", slack: { userId: c.slack?.userId || "", teamId: c.slack?.teamId || "", teamHandle: c.slack?.teamHandle || "" }, deployDashboardUrl: c.deployDashboardUrl || "" };
}

const HANDLERS = { my_artifacts: myArtifacts, studio_config: studioConfig, claude_sessions: claudeSessions, github_prs: githubPrs, open_session: openSession, close_session: closeSession, sponge_scan: spongeScan, sponge_wipe: spongeWipe, sponge_status: spongeStatus };

export { TOOLS, HANDLERS };
