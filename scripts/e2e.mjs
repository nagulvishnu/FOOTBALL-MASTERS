// Two independent browser sessions (separate cookie jars) play one online match
// against the running production server. Verifies lobby flow, kick-off, movement
// replication, ball/clock sync, AI takeover on disconnect and reconnection.
//
// Usage: node scripts/e2e.mjs   (BASE_URL=http://127.0.0.1:3000 by default)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = path.resolve("artifacts/e2e");
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log("[e2e]", ...a);
let failures = 0;
const check = (name, ok, extra = "") => {
  if (ok) log("PASS", name, extra);
  else {
    failures++;
    console.error("[e2e] FAIL", name, extra);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LAUNCH = [
  { channel: "msedge", headless: true },
  { channel: "chrome", headless: true },
  { executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true },
  { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true },
];
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"];

async function launch() {
  let last;
  for (const opt of LAUNCH) {
    try {
      return await chromium.launch({ ...opt, args: ARGS });
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function signInGuest(page, name, entry) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Press start" }).click();
  await page.getByRole("button", { name: entry === "create" ? "Create room" : "Join room" }).click();
  const modal = page.locator("form.panel");
  await modal.waitFor({ state: "visible" });
  await modal.locator("input").first().fill(name);
  await modal.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("heading", { name: entry === "create" ? "Create room" : "Join a room" }).waitFor({ timeout: 20000 });
}

async function joinTeam(page, team, slotTitle) {
  await page.getByRole("button", { name: "Join", exact: true }).nth(team).click();
  await page.locator(`.slot[title="${slotTitle}"]`).nth(team).click();
  await page.getByRole("button", { name: "Confirm & ready" }).click();
  await page.getByRole("button", { name: /Ready ✓/ }).waitFor();
}

async function enterMatch(page) {
  await page.getByText("Match Ready", { exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "Enter match" }).click();
  await page.waitForFunction(() => typeof window.__fmDebug === "function", null, { timeout: 30000 });
  await page.waitForFunction(() => window.__fmDebug()?.snapshot !== null, null, { timeout: 30000 });
}

const debug = (page) => page.evaluate(() => window.__fmDebug());

const browser = await launch();
log("browser launched");

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  for (const [tag, page] of [["A", A], ["B", B]]) {
    page.on("console", (m) => {
      if (m.type() === "error") console.error(`[e2e][${tag} console]`, m.text());
    });
    page.on("pageerror", (e) => console.error(`[e2e][${tag} pageerror]`, e.message));
  }

  // ---------------------------------------------------------------- lobby
  await signInGuest(A, "E2E Alpha", "create");
  await A.getByRole("button", { name: "Create room" }).click();
  await A.getByText("Room code").waitFor({ timeout: 20000 });
  const code = (await A.locator("div.disp.title").filter({ hasText: /^[A-Z0-9]{5}$/ }).first().innerText()).trim();
  check("host created a room", /^[A-Z0-9]{5}$/.test(code), code);

  await signInGuest(B, "E2E Beta", "join");
  await B.getByPlaceholder("ABCDE").fill(code);
  await B.getByRole("button", { name: "Join", exact: true }).click();
  await B.getByText("Room code").waitFor({ timeout: 20000 });
  await B.getByText("2/14 players").waitFor({ timeout: 20000 });
  check("guest joined the same room", true, code);

  await joinTeam(A, 0, "Left Forward");
  await joinTeam(B, 1, "Left Forward");
  await A.getByText("2/14 players").waitFor();

  const start = A.getByRole("button", { name: /Start match/ });
  await start.waitFor();
  check("start enabled once both players are ready", await start.isEnabled());
  await start.click();

  // ---------------------------------------------------------------- kick-off
  await enterMatch(A);
  await enterMatch(B);
  check("both browsers reached the match screen", true);

  const a0 = await debug(A);
  const b0 = await debug(B);
  check("server sim is running", ["prematch", "playing", "restart", "halftime"].includes(a0.snapshot?.phase), a0.snapshot?.phase);
  const idxA = a0.you;
  const idxB = b0.you;
  check("players control different slots", idxA !== idxB, `${idxA} vs ${idxB}`);

  // ---------------------------------------------------------------- movement
  await A.keyboard.down("w");
  await A.waitForTimeout(1500);
  await A.keyboard.up("w");
  await B.waitForTimeout(900);

  const a1 = await debug(A);
  const b1 = await debug(B);
  const movedA = Math.hypot(a1.players[idxA].x - a0.players[idxA].x, a1.players[idxA].z - a0.players[idxA].z);
  const seenOnB = Math.hypot(b1.players[idxA].x - b0.players[idxA].x, b1.players[idxA].z - b0.players[idxA].z);
  check("own player moved", movedA > 1, `${movedA.toFixed(2)} m`);
  check("remote client sees the movement", seenOnB > 0.8, `${seenOnB.toFixed(2)} m`);

  // Interpolated ball positions differ slightly because each client renders on
  // its own clock. The authoritative check is the raw snapshot: at the same
  // server tick both clients must have byte-identical ball state.
  let ra = a1;
  let rb = b1;
  for (let i = 0; i < 80 && ra.snapshot.tick !== rb.snapshot.tick; i++) {
    await sleep(40);
    ra = await debug(A);
    rb = await debug(B);
  }
  const sameTick = ra.snapshot.tick === rb.snapshot.tick;
  const ballGap = Math.hypot(ra.snapshot.ball[0] - rb.snapshot.ball[0], ra.snapshot.ball[1] - rb.snapshot.ball[1]);
  check("clients receive the same server tick", sameTick, `${ra.snapshot.tick} / ${rb.snapshot.tick}`);
  check("ball state is identical at that tick", sameTick && ballGap < 1e-6, `${ballGap.toFixed(4)} m`);
  check("match clock agrees between clients", Math.abs(a1.snapshot.el - b1.snapshot.el) < 1.5, `${a1.snapshot.el.toFixed(2)} / ${b1.snapshot.el.toFixed(2)}`);
  check("both clients report a ping", typeof a1.ping === "number" && a1.ping >= 0, `${a1.ping} ms`);

  await A.screenshot({ path: path.join(OUT, "match-alpha.png") });
  await B.screenshot({ path: path.join(OUT, "match-beta.png") });

  // ---------------------------------------------------------------- disconnect
  await B.close();
  let aiTookOver = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await debug(A);
    if (((s.players[idxB].flags ?? 0) & 1) === 0) {
      aiTookOver = true;
      break;
    }
  }
  check("AI takes over the disconnected player's slot", aiTookOver);

  // ---------------------------------------------------------------- reconnect
  const B2 = await ctxB.newPage();
  await B2.goto(`${BASE}/?room=${code}`, { waitUntil: "domcontentloaded" });
  await B2.getByRole("heading", { name: "Join a room" }).waitFor({ timeout: 20000 });
  const prefill = await B2.getByPlaceholder("ABCDE").inputValue();
  check("invitation link prefills the room code", prefill === code, prefill);
  await B2.getByRole("button", { name: "Join", exact: true }).click();
  await enterMatch(B2);
  let restored = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const s = await debug(A);
    if (((s.players[idxB].flags ?? 0) & 1) === 1) {
      restored = true;
      break;
    }
  }
  check("reconnected player regains human control", restored);
  await B2.screenshot({ path: path.join(OUT, "match-beta-reconnected.png") });

  // Free the two WebGL contexts of the online match before measuring the
  // offline client: software rendering three canvases at once starves rAF.
  await ctxA.close();
  await ctxB.close();

  // ---------------------------------------------------------------- offline
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const C = await ctxC.newPage();
  C.on("pageerror", (e) => console.error("[e2e][offline pageerror]", e.message));
  await C.goto(BASE, { waitUntil: "domcontentloaded" });
  await C.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}" });
  await C.getByRole("button", { name: "Press start" }).click();
  await C.getByRole("button", { name: /Play now/ }).click();
  await C.getByText("Kick Off", { exact: true }).waitFor({ timeout: 30000 });
  await C.getByRole("button", { name: "Click to play" }).click();
  await C.waitForFunction(() => typeof window.__fmDebug === "function", null, { timeout: 30000 });
  await C.waitForFunction(() => window.__fmDebug()?.snapshot !== null, null, { timeout: 30000 });
  await C.waitForFunction(() => window.__fmDebug()?.snapshot?.phase === "playing", null, { timeout: 30000 });
  const c0 = await debug(C);
  let c1 = c0;
  await C.keyboard.down("w");
  for (let i = 0; i < 16; i++) {
    await C.waitForTimeout(250);
    c1 = await debug(C);
    if (Math.hypot(c1.players[c0.you].x - c0.players[c0.you].x, c1.players[c0.you].z - c0.players[c0.you].z) > 1.5) break;
  }
  await C.keyboard.up("w");
  const movedC = Math.hypot(c1.players[c0.you].x - c0.players[c0.you].x, c1.players[c0.you].z - c0.players[c0.you].z);
  check("offline 7v7 match runs", ["prematch", "playing", "restart"].includes(c1.snapshot.phase), c1.snapshot.phase);
  check("offline player moves", movedC > 1, `${movedC.toFixed(2)} m`);
  check("offline match has 14 players", c1.players.length === 14);
  await C.screenshot({ path: path.join(OUT, "offline-match.png") });
  await C.keyboard.press("Escape");
  await C.getByText("Paused", { exact: true }).waitFor({ timeout: 15000 });
  check("pause menu opens in an offline match", true);
  const lock = await C.evaluate(() => document.pointerLockElement?.tagName ?? null);
  check("pause releases the mouse for menu clicks", lock === null, String(lock));
  await C.getByRole("button", { name: "Resume" }).click({ timeout: 10000 });
  await C.getByText("Paused", { exact: true }).waitFor({ state: "hidden", timeout: 10000 });
  check("resume closes the pause menu", true);
  await ctxC.close();
} catch (e) {
  failures++;
  console.error("[e2e] EXCEPTION", e?.stack ?? e);
} finally {
  await browser.close();
}

log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
