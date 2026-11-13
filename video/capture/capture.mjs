// Renders the real Clay Studio page with made-up sample data and saves 4K stills for the video.
// puppeteer-core comes with `npx hyperframes`; point PUPPETEER_CORE at its entry file, or install puppeteer-core
const pp = await import(process.env.PUPPETEER_CORE || "puppeteer-core");
import { mkdir } from "node:fs/promises";

const puppeteer = pp.default || pp;
const OUT = new URL("../assets/shots/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  const Real = Date; let offset = 0;
  window.__setClock = (h) => { const d = new Real(); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); offset = d.getTime() - Real.now(); };
  class Fake extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  window.Date = Fake;
});
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto("http://localhost:8766/index.html", { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__cap);

const today = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const data = {
  meetings: [[9, 30, 10, 0, "Standup · Studio team", "accepted"], [12, 30, 13, 15, "Lunch & learn: CSS tricks", "accepted"], [15, 0, 15, 30, "1:1 with Marta", "accepted"], [17, 0, 17, 45, "Sprint retro", "needsAction"]]
    .map(([h1, m1, h2, m2, title, rsvp], i) => ({ id: `m${i}`, title, start: today(h1, m1), end: today(h2, m2), rsvp, join: "https://meet.google.com/abc-defg-hij", link: "https://calendar.google.com", reminder: false, location: "", people: 4 })),
  slack: [
    { who: "Marta", where: "#team-studio", summary: "Could you look at the retake PR before standup?", ask: "Review the retake PR", urgency: "now", permalink: "https://example.slack.com/archives/C1/p1794470000000100", time: "" },
    { who: "Leo", where: "DM", summary: "Is the quiz fix out yet?", ask: "Tell Leo when it ships", urgency: "today", permalink: "https://example.slack.com/archives/D1/p1794470000000200", time: "" },
    { who: "Iris", where: "#studio-dev · team", summary: "Who can pair on file uploads this week?", ask: "Offer to pair on uploads", urgency: "whenever", permalink: "https://example.slack.com/archives/C2/p1794470000000300", time: "" },
  ],
  sessions: [
    { id: "s1", title: "Retake certificates", cmux: { title: "retake certificates", name: "certificates", workspace: 1, status: "Needs input" }, project: "~/code/my-app", branch: "feat/retake-certificates", updatedAt: today(8, 40), lastAsk: "add the certificate per attempt", whereItStopped: "Certificates are issued per attempt. Two specs fail on the old fixture.", yourTurn: true, prs: [] },
    { id: "s2", title: "Quiz scoring fix", cmux: { title: "quiz scoring fix", name: null, workspace: 2, status: "Running" }, project: "~/code/my-app", branch: "fix/quiz-scoring", updatedAt: today(8, 50), lastAsk: "run the quiz specs", whereItStopped: "Running the quiz specs.", yourTurn: false, prs: [] },
    { id: "s3", title: "Course recap emails", cmux: { title: "course recap emails", name: null, workspace: 3, status: "Idle" }, project: "~/code/my-app", branch: "feat/recap-emails", updatedAt: today(7, 55), lastAsk: "draft the email copy", whereItStopped: "Draft copy is ready for review.", yourTurn: true, prs: [] },
  ],
  prs: {
    mine: [
      { number: 4211, title: "feat(app): certificate per attempt", url: "https://github.com/x/y/pull/4211", draft: false, review: "APPROVED", mergeable: "MERGEABLE", comments: 3, ci: { state: "passing", pass: 80, fail: 0, pending: 0, failing: [] }, updatedAt: today(8, 30) },
      { number: 4219, title: "fix(app): quiz scoring rounds down", url: "https://github.com/x/y/pull/4219", draft: true, review: "", mergeable: "MERGEABLE", comments: 0, ci: { state: "running", pass: 61, fail: 0, pending: 9, failing: [] }, updatedAt: today(8, 55) },
    ],
    toReview: [{ number: 4198, title: "feat(app): learning path badges", url: "https://github.com/x/y/pull/4198", repo: "x/y", author: "marta", updatedAt: today(8, 10) }],
    awaitingDeploy: [
      { number: 4170, title: "fix(app): keep completion date", url: "https://github.com/x/y/pull/4170", mergedAt: today(11, 0), deployed: false },
      { number: 4182, title: "feat(app): group reminders", url: "https://github.com/x/y/pull/4182", mergedAt: today(11, 30), deployed: false },
    ],
    lastProductionDeploy: (() => { const d = new Date(); return `production-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}T0902Z`; })(),
  },
  sketch: [{ id: "k1", title: "Studio for the whole team", doneAt: "" }, { id: "k2", title: "Recap email ideas", doneAt: "" }],
  notes: [{ id: "n1", text: "water the pothos", color: "mint", doneAt: "", createdAt: today(8) }],
};

async function load(withData, done = [], points = 0) {
  await page.evaluate((d, withData, done, points) => {
    const { S } = window.__cap; const dk = (() => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; })();
    S.data.meetings = withData ? d.meetings.map((m) => ({ ...m, start: new Date(m.start), end: new Date(m.end) })) : [];
    S.data.slack = withData ? d.slack : []; S.data.sessions = withData ? d.sessions : []; S.data.prs = withData ? d.prs : { mine: [], toReview: [], awaitingDeploy: [] };
    S.sketch = withData ? d.sketch : []; S.myNotes = withData ? d.notes : [];
    S.progress = { points, days: { [dk]: done }, titles: Object.fromEntries(done.map((k) => [k, { title: k, kind: k.split(":")[0], at: Date.now() }])), discarded: {} };
    window.__cap.render();
  }, data, withData, done, points);
}
async function hideUi(hide) {
  await page.evaluate((hide) => { document.querySelectorAll(".ui").forEach((e) => { e.style.opacity = hide ? "0" : ""; }); }, hide);
}
async function shot(name, hour, opts = {}) {
  await page.evaluate((h) => { window.__setClock(h); window.__cap.setHour(h); window.__cap.render(); }, hour);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.__cap.frame());
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `${OUT}${name}.png`, ...opts });
  console.log("saved", name);
}
async function element(name, selector) {
  await new Promise((r) => setTimeout(r, 300));
  const el = await page.$(selector); await el.screenshot({ path: `${OUT}${name}.png`, omitBackground: true }); console.log("saved", name);
}

await hideUi(true);
await load(false); await shot("01-dawn-empty", 6.6);
await load(true); await shot("02-dawn-full", 7.2);
await shot("03-morning-full", 9.2);
await load(true, ["slack:example.slack.com/archives/C1/p1794470000000100".replace(/^/, "")], 10);
await page.evaluate(() => { const { S } = window.__cap; S.progress.discarded = {}; S.data.slack = S.data.slack.slice(1); window.__cap.render(); });
await shot("04-morning-note-done", 9.4);
await load(true, ["session:s1", "slack:a", "meeting:m0"], 45);
await page.evaluate(() => { const { S } = window.__cap; S.data.slack = S.data.slack.slice(1); S.data.sessions = S.data.sessions.slice(1); window.__cap.render(); });
await shot("05-noon", 12.5);
await load(true, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"], 160);
await page.evaluate(() => { const { S } = window.__cap; S.data.slack = []; S.data.sessions = S.data.sessions.slice(2); S.data.prs = { ...S.data.prs, mine: [], toReview: [] }; S.myNotes = []; window.__cap.render(); });
await shot("06-golden", 17.6);
await shot("07-dusk", 19.4);

// real UI panels, shown at day light
await load(true, [], 30); await page.evaluate(() => { window.__setClock(9.2); window.__cap.setHour(9.2); window.__cap.render(); });
await hideUi(false);
await page.evaluate(() => { document.querySelectorAll(".ui").forEach((e) => { e.style.opacity = ""; }); });
await shot("08-ui-morning", 9.2);
await page.evaluate(() => {
  document.getElementById("pinchLine").textContent = "Morning, sleepyhead! Marta left a note on the board and two pieces are drying for market day.";
  const ol = document.getElementById("moves"); ol.replaceChildren(...["Peek at Marta's retake PR before standup", "Give the certificates lump a poke: it's waiting for you", "Tell Leo the quiz fix ships tomorrow"].map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
});
await element("ui-plan", "#plan");
await page.evaluate(() => { const { picks } = window.__cap; const n = picks.notes.find((r) => r.userData.info.kind === "slack"); window.__cap.inspect(n.userData.info, n); });
await element("ui-inspect-slack", "#inspect");
await page.evaluate(() => { const { picks } = window.__cap; const n = picks.lumps[0]; window.__cap.closeInspect(); window.__cap.inspect(n.userData.info, n); });
await element("ui-inspect-session", "#inspect");
await page.evaluate(() => window.__cap.closeInspect());
await page.evaluate(() => window.__cap.setSponge({ items: [
  { id: "slot:3", kind: "memory", label: "Stop slot 3 services", detail: "feat/retake-certificates · frees about 3–4 GB of RAM · keeps the worktree, database and branch", ram: true, bytes: null, safe: true },
  { id: "wt:a", kind: "worktree", label: "Remove worktree quiz-scoring", detail: "fix/quiz-scoring · all pushed · 6d old · branch stays", bytes: 2.3e9, safe: true },
  { id: "wt:b", kind: "worktree", label: "Remove worktree group-reminders", detail: "feat/group-reminders · all pushed · 9d old · branch stays", bytes: 2.1e9, safe: true },
  { id: "wt:c", kind: "worktree", label: "Remove worktree badge-spike", detail: "spike/badges · all pushed · 17d old · branch stays", bytes: 1.7e9, safe: true },
  { id: "skip:d", kind: "kept", label: "Keep recap-emails", detail: "in use", kept: true, safe: false } ] }));
await element("ui-sponge", "#spongeList");
await page.evaluate(() => { document.getElementById("spongeList").hidden = true; document.getElementById("scrim").hidden = true; window.__cap.openBook(); });
await element("ui-sketchbook", "#book");
await browser.close();
