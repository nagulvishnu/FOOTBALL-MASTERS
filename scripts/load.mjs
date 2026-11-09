// 14-client load test: BASE=http://localhost:3000 SECONDS=20 node scripts/load.mjs
// Simulates 14 independent guest sessions (7v7), each streaming snapshots and sending ~25 inputs/s.
const BASE = process.env.BASE ?? "http://localhost:3000";
const SECONDS = Number(process.env.SECONDS ?? 20);
const ROLES = ["GK", "LB", "RB", "CML", "CMR", "LW", "RW"];
const post = async (s, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie: s.cookie }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const clients = [];
for (let i = 0; i < 14; i++) {
  const r = await fetch(`${BASE}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Load${i}` }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!r.ok || !cookie) throw new Error(`guest ${i} failed: ${r.status} ${await r.text().catch(() => "")}`);
  clients.push({ i, cookie, snaps: 0, bytes: 0, lat: [], inputs: 0, errors: 0 });
}
const created = await post(clients[0], "/api/rooms", { halfMinutes: 1 });
if (!created.code) throw new Error(`create failed: ${JSON.stringify(created)}`);
const code = created.code;
for (const c of clients.slice(1)) {
  const j = await post(c, `/api/rooms/${code}/action`, { type: "join" });
  if (j.status !== 200) throw new Error(`join ${c.i} failed: ${JSON.stringify(j)}`);
}
for (const c of clients) {
  const team = await post(c, `/api/rooms/${code}/action`, { type: "team", team: c.i < 7 ? 0 : 1 });
  if (team.status !== 200) throw new Error(`team ${c.i} failed: ${JSON.stringify(team)}`);
  const role = await post(c, `/api/rooms/${code}/action`, { type: "role", role: ROLES[c.i % 7] });
  if (role.status !== 200) throw new Error(`role ${c.i} failed: ${JSON.stringify(role)}`);
  const ready = await post(c, `/api/rooms/${code}/action`, { type: "ready", ready: true });
  if (ready.status !== 200) throw new Error(`ready ${c.i} failed: ${JSON.stringify(ready)}`);
}
for (const c of clients) {
  c.ctl = new AbortController();
  (async () => {
    const r = await fetch(`${BASE}/api/rooms/${code}/stream`, { headers: { cookie: c.cookie }, signal: c.ctl.signal });
    let buf = "";
    const dec = new TextDecoder();
    try {
      for await (const chunk of r.body) {
        c.bytes += chunk.length;
        buf += dec.decode(chunk, { stream: true });
        let k;
        while ((k = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          if (block.startsWith("event: snap")) c.snaps++;
        }
      }
    } catch {
      /* aborted */
    }
  })();
}
await new Promise((r) => setTimeout(r, 1000));
console.log("start:", (await post(clients[0], `/api/rooms/${code}/action`, { type: "start" })).status);
await new Promise((r) => setTimeout(r, 6500));
const t0 = Date.now();
let seq = 1;
const timers = clients.map((c) =>
  setInterval(async () => {
    const t = performance.now();
    const a = Math.sin(Date.now() / 700 + c.i);
    const res = await post(c, `/api/rooms/${code}/action`, { type: "input", seq: seq++, mx: Math.cos(a), mz: Math.sin(a), sprint: c.i % 2 === 0, acts: Date.now() % 900 < 45 ? [{ n: Date.now(), type: "pass", power: 0.5 }] : undefined });
    c.inputs++;
    if (res.status !== 200) c.errors++;
    c.lat.push(performance.now() - t);
  }, 40),
);
const s0 = clients.map((c) => c.snaps);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
timers.forEach(clearInterval);
const el = (Date.now() - t0) / 1000;
const rate = clients.map((c, k) => (c.snaps - s0[k]) / el);
const lat = clients.flatMap((c) => c.lat).sort((a, b) => a - b);
const pct = (p) => lat[Math.floor(lat.length * p)]?.toFixed(1);
console.log(`clients=14 duration=${el.toFixed(1)}s`);
console.log(`snapshot rate/client: min ${Math.min(...rate).toFixed(1)} avg ${(rate.reduce((a, b) => a + b, 0) / 14).toFixed(1)} max ${Math.max(...rate).toFixed(1)} Hz`);
console.log(`input requests: ${clients.reduce((a, c) => a + c.inputs, 0)} errors: ${clients.reduce((a, c) => a + c.errors, 0)}  latency p50 ${pct(0.5)}ms p95 ${pct(0.95)}ms p99 ${pct(0.99)}ms`);
console.log(`downstream per client: ${(clients.reduce((a, c) => a + c.bytes, 0) / 14 / (el + 8) / 1024).toFixed(1)} KiB/s`);
const room = await fetch(`${BASE}/api/rooms/${code}`, { headers: { cookie: clients[0].cookie } }).then((r) => r.json());
console.log("room state:", room.room.state, "humans:", room.room.roster?.filter((r) => r.human).length);
clients.forEach((c) => c.ctl.abort());
process.exit(0);
