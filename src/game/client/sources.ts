// A GameSource feeds snapshots to the render engine. LocalSource runs the shared sim in the browser
// (practice / offline skirmish). OnlineSource consumes the authoritative server stream.
import { roleOfIdx, ROLE_NUMBER, teamOfIdx } from "../shared/constants";
import type { Appearance, InputMsg, MatchResult, RosterEntry, Snapshot } from "../shared/types";
import { MatchSim } from "../sim/sim";

export interface GameSource {
  readonly delay: number; // render interpolation delay in seconds
  readonly online: boolean;
  start(onSnap: (s: Snapshot) => void): void;
  update(): void;
  stop(): void;
  sendInput(msg: InputMsg): void;
  setPaused(p: boolean): void;
  ping(): number;
  result(): MatchResult | null;
  sim?: MatchSim;
}

export function aiLook(i: number): Appearance {
  return { gender: i % 5 === 3 ? "f" : "m", hair: (i * 3) % 6, hairColor: (i * 5) % 6, skin: (i * 7) % 6 };
}

export function localRoster(you: number, name: string, appearance: Appearance, active?: (i: number) => boolean): RosterEntry[] {
  return Array.from({ length: 14 }, (_, i) => ({
    idx: i,
    team: teamOfIdx(i),
    role: roleOfIdx(i),
    number: ROLE_NUMBER[roleOfIdx(i)],
    name: i === you ? name : `CPU ${roleOfIdx(i)}`,
    human: i === you,
    userId: null,
    connected: true,
    appearance: i === you ? appearance : aiLook(i),
  })).filter((r) => (active ? active(r.idx) : true)) as RosterEntry[];
}

export class LocalSource implements GameSource {
  readonly delay = 0.04;
  readonly online = false;
  private onSnap: (s: Snapshot) => void = () => {};
  private acc = 0;
  private last = 0;
  private paused = false;
  constructor(
    public sim: MatchSim,
    private you: number,
  ) {}
  start(onSnap: (s: Snapshot) => void) {
    this.onSnap = onSnap;
    this.last = performance.now();
    onSnap(this.sim.snapshot());
  }
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.acc += dt;
    while (this.acc >= 1 / 30) {
      this.acc -= 1 / 30;
      this.sim.step(1 / 30);
      this.onSnap(this.sim.snapshot());
    }
  }
  stop() {}
  sendInput(msg: InputMsg) {
    this.sim.pushInput(this.you, msg);
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.last = performance.now();
  }
  ping() {
    return 0;
  }
  result() {
    return this.sim.result();
  }
}

export interface RoomView {
  code: string;
  hostId: string;
  state: "lobby" | "countdown" | "playing" | "finished";
  countdown: number;
  settings: { halfMinutes: number; difficulty: string; stadium: string; time: string; weather: string; isPublic: boolean; mode: string };
  kits: [import("../shared/types").Kit, import("../shared/types").Kit];
  tactics: [string, string];
  members: {
    userId: string;
    name: string;
    team: 0 | 1 | null;
    role: string | null;
    ready: boolean;
    connected: boolean;
    isHost: boolean;
    isCaptain: boolean;
    appearance: Appearance;
  }[];
  roster: RosterEntry[];
  result: MatchResult | null;
  version: number;
}

export class OnlineSource implements GameSource {
  readonly delay = 0.1;
  readonly online = true;
  private es: EventSource | null = null;
  private onSnap: (s: Snapshot) => void = () => {};
  private inflight = false;
  private pending: InputMsg | null = null;
  private lastSent = "";
  private lastSentAt = 0;
  private rtt = 0;
  private res: MatchResult | null = null;
  status: "connecting" | "open" | "reconnecting" | "replaced" | "closed" = "connecting";

  constructor(
    public readonly code: string,
    private handlers: { onRoom: (r: RoomView) => void; onStatus: (s: OnlineSource["status"]) => void },
  ) {}

  start(onSnap: (s: Snapshot) => void) {
    this.onSnap = onSnap;
    this.connect();
  }
  /** Idempotent: the lobby opens the stream; the match engine re-uses it. */
  connect() {
    if (this.es && this.es.readyState !== EventSource.CLOSED) return;
    if (this.status === "replaced") return;
    this.open();
  }
  private open() {
    const es = new EventSource(`/api/rooms/${this.code}/stream`);
    this.es = es;
    es.addEventListener("open", () => this.set("open"));
    es.addEventListener("room", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as RoomView;
      if (r.result) this.res = r.result;
      this.handlers.onRoom(r);
    });
    es.addEventListener("snap", (e) => this.onSnap(JSON.parse((e as MessageEvent).data) as Snapshot));
    es.addEventListener("replaced", () => {
      this.set("replaced");
      es.close();
    });
    es.onerror = () => {
      if (this.status === "replaced" || this.status === "closed") return;
      this.set(es.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };
  }
  private set(s: OnlineSource["status"]) {
    this.status = s;
    this.handlers.onStatus(s);
  }
  update() {}
  stop() {
    this.set("closed");
    this.es?.close();
  }
  sendInput(msg: InputMsg) {
    // never reorder: one request in flight; newest movement wins, actions are merged
    if (this.pending) {
      this.pending = { ...msg, acts: [...(this.pending.acts ?? []), ...(msg.acts ?? [])].slice(0, 4) };
    } else this.pending = msg;
    void this.flush();
  }
  private async flush() {
    if (this.inflight || !this.pending) return;
    const m = this.pending;
    const key = `${m.mx.toFixed(2)},${m.mz.toFixed(2)},${m.sprint}`;
    const now = performance.now();
    if (!m.acts?.length && key === this.lastSent && now - this.lastSentAt < 120) {
      this.pending = null;
      return;
    }
    this.pending = null;
    this.inflight = true;
    this.lastSent = key;
    this.lastSentAt = now;
    try {
      await fetch(`/api/rooms/${this.code}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "input", ...m }), keepalive: true });
      this.rtt = this.rtt * 0.8 + (performance.now() - now) * 0.2;
    } catch {
      /* transient network error: next input retries */
    } finally {
      this.inflight = false;
      if (this.pending) void this.flush();
    }
  }
  setPaused() {}
  ping() {
    return Math.round(this.rtt);
  }
  result() {
    return this.res;
  }
}
