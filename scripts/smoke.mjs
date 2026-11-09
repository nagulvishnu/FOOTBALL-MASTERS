// Multiplayer smoke test against a RUNNING server:  BASE=http://localhost:3000 node scripts/smoke.mjs
// Uses two independent guest sessions (separate cookie jars) like two browsers would.
const BASE = process.env.BASE ?? "http://localhost:3000";

async function session(name) {
  const r = await fetch(`${BASE}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error("guest failed " + r.status);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { name, cookie };
}
const post = async (s, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie: s.cookie }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};

function stream(s, code) {
  const ctl = new AbortController();
  const st = { room: null, snap: null, snaps: 0, replaced: false, abort: () => ctl.abort() };
  (async () => {
    const r = await fetch(`${BASE}/api/rooms/${code}/stream`, { headers: { cookie: s.cookie }, signal: ctl.signal });
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(block)?.[1];
          const data = /data: (.*)/.exec(block)?.[1];
          if (!ev || !data) continue;
          if (ev === "room") st.room = JSON.parse(data);
          if (ev === "snap") {
            st.snap = JSON.parse(data);
            st.snaps++;
          }
          if (ev === "replaced") st.replaced = true;
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return st;
}
const wait = async (cond, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout: " + label);
};
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) process.exitCode = 1;
};

const A = await session("Alice");
const B = await session("Bobby");
const created = await post(A, "/api/rooms", { mode: "private", halfMinutes: 1 });
const code = created.code;
ok(!!code, `room created (${code})`);
ok((await post(B, `/api/rooms/${code}/action`, { type: "join" })).status === 200, "second session joined by code");
ok((await post(A, `/api/rooms/${code}/action`, { type: "team", team: 0 })).status === 200, "A chose Team A");
ok((await post(B, `/api/rooms/${code}/action`, { type: "team", team: 1 })).status === 200, "B chose Team B");
ok((await post(A, `/api/rooms/${code}/action`, { type: "role", role: "LW" })).status === 200, "A took LW");
ok((await post(B, `/api/rooms/${code}/action`, { type: "role", role: "GK" })).status === 200, "B took GK");
const sA = stream(A, code);
let sB = stream(B, code);
await wait(() => sA.room && sB.room, 5000, "streams");
const dup = await post(B, `/api/rooms/${code}/action`, { type: "role", role: "LW" });
ok(dup.status === 200, "B (team B) may also take LW on the other team");
const clash = await post(B, `/api/rooms/${code}/action`, { type: "role", role: "GK" });
ok(clash.status === 200, "B re-takes GK");
ok((await post(B, `/api/rooms/${code}/action`, { type: "ready", ready: true })).status === 200, "B ready");
ok((await post(A, `/api/rooms/${code}/action`, { type: "start" })).status === 200, "host started match");
await wait(() => sA.snaps > 5 && sB.snaps > 5, 15000, "snapshots after countdown");
ok(sA.room.state === "playing", "room state = playing");
ok(sA.room.roster.filter((r) => r.human).length === 2 && sA.room.roster.length === 14, "2 humans + 12 AI in the roster");
const late = await post(A, `/api/rooms/${code}/action`, { type: "role", role: "RW" });
ok(late.status === 409, "position selection is locked after kickoff (409)");
await wait(() => sA.snap.phase === "playing" || sA.snap.phase === "restart", 10000, "phase");
// A moves; both clients must see the same authoritative movement
const LW = 5;
const x0 = sA.snap.players[LW][0];
const t0 = Date.now();
let seq = 1;
while (Date.now() - t0 < 2500) {
  await post(A, `/api/rooms/${code}/action`, { type: "input", seq: seq++, mx: 1, mz: 0, sprint: true });
  await new Promise((r) => setTimeout(r, 40));
}
const xa = sA.snap.players[LW][0];
const xb = sB.snap.players[LW][0];
ok(Math.abs(xa - x0) > 3, `A's player moved from input (${x0.toFixed(1)} -> ${xa.toFixed(1)})`);
ok(Math.abs(xa - xb) < 1.5, `B sees A's movement (A view ${xa.toFixed(1)}, B view ${xb.toFixed(1)})`);
ok(Math.abs(sA.snap.ball[0] - sB.snap.ball[0]) < 2 && sA.snap.score.join() === sB.snap.score.join(), "ball + score synchronised");
// B disconnects -> AI takeover; reconnect -> control restored
const GK = 7;
ok((sA.snap.players[GK][8] & 1) === 1, "B's slot is human-controlled");
sB.abort();
await wait(() => (sA.snap.players[GK][8] & 1) === 0, 5000, "AI takeover");
ok(true, "disconnect -> AI takes over B's position");
sB = stream(B, code);
await wait(() => sB.snaps > 0 && (sA.snap.players[GK][8] & 1) === 1, 5000, "restore");
ok(sA.room.members.find((m) => m.name === "Bobby")?.role === "GK", "B reconnected to the same position and regained control");
// duplicate session: a third stream for B replaces the previous one
const sB2 = stream(B, code);
await wait(() => sB.replaced, 5000, "replaced");
ok(true, "duplicate session replaced the older connection");
// non-members cannot control or read the room
const C = await session("Carol");
ok((await post(C, `/api/rooms/${code}/action`, { type: "input", seq: 1, mx: 1, mz: 0, sprint: false })).status === 403, "non-member input rejected (403)");
sA.abort();
sB.abort();
sB2.abort();
await post(A, `/api/rooms/${code}/action`, { type: "leave" });
await post(B, `/api/rooms/${code}/action`, { type: "leave" });
console.log(process.exitCode ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED");
process.exit(process.exitCode ?? 0);
