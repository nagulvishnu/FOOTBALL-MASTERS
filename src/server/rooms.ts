// Authoritative room manager. Owns lobby state, position ownership, the match simulation loop and
// snapshot fan-out. Framework independent (no Next imports) so it is unit-testable and can be moved
// into a standalone Node/Colyseus process later without touching game rules.
import { randomInt } from "node:crypto";
import {
  DIFFICULTIES,
  PATTERNS,
  ROLES,
  ROLE_NUMBER,
  ROOM_CODE_ALPHABET,
  STADIUMS,
  TACTICS,
  TICK_DT,
  TIMES,
  WEATHERS,
  slotIdx,
  type StadiumId,
} from "@/game/shared/constants";
import type { Appearance, Difficulty, InputMsg, Kit, MatchResult, RosterEntry, Role, Snapshot, Tactic, Team } from "@/game/shared/types";
import { MatchSim } from "@/game/sim/sim";

export class RoomError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RoomMode = "private" | "friends" | "coop" | "quick";

export interface RoomSettings {
  halfMinutes: number;
  difficulty: Difficulty;
  stadium: StadiumId;
  time: (typeof TIMES)[number];
  weather: (typeof WEATHERS)[number];
  isPublic: boolean;
  mode: RoomMode;
}

export interface Member {
  userId: string;
  name: string;
  team: Team | null;
  role: Role | null;
  ready: boolean;
  connected: boolean;
  lastSeen: number;
  joinedAt: number;
  appearance: Appearance;
  tokens: number;
  tokenAt: number;
}

export interface Sub {
  id: number;
  send: (event: string, data: string) => void;
  close: () => void;
}

export interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  kits: [Kit, Kit];
  tactics: [Tactic, Tactic];
  members: Map<string, Member>;
  state: "lobby" | "countdown" | "playing" | "finished";
  countdownEnd: number;
  sim: MatchSim | null;
  roster: RosterEntry[];
  result: MatchResult | null;
  createdAt: number;
  lastActivity: number;
  lastJoin: number;
  subs: Map<string, Sub>;
  loop: ReturnType<typeof setInterval> | null;
  acc: number;
  lastTickAt: number;
  version: number;
  autoStart: boolean;
}

export interface RoomUser {
  id: string;
  displayName: string;
  appearance: Appearance;
}

export interface RoomHooks {
  onFinish: (room: Room, result: MatchResult) => Promise<void> | void;
}

const defaultKits = (): [Kit, Kit] => [
  { name: "Team A", primary: "#e63946", secondary: "#ffffff", pattern: "stripes", gk: "#f4d03f" },
  { name: "Team B", primary: "#1d6fe8", secondary: "#ffffff", pattern: "hoops", gk: "#2ecc71" },
];

const POSITION_PREFERENCE: Role[] = ["LW", "RW", "CML", "CMR", "LB", "RB", "GK"];
let subCounter = 1;

export class RoomManager {
  rooms = new Map<string, Room>();
  userRoom = new Map<string, string>();
  hooks: RoomHooks = { onFinish: () => {} };
  sweeper: ReturnType<typeof setInterval> | null = null;
  maxRooms = 200;

  constructor(autoSweep = true) {
    if (autoSweep) {
      this.sweeper = setInterval(() => this.sweep(), 5000);
      (this.sweeper as unknown as { unref?: () => void }).unref?.();
    }
  }

  // -------------------------------------------------------------- lookup
  get(code: string): Room {
    const r = this.rooms.get(code.toUpperCase());
    if (!r) throw new RoomError(404, "ROOM_NOT_FOUND", "Room not found");
    return r;
  }

  private member(room: Room, userId: string): Member {
    const m = room.members.get(userId);
    if (!m) throw new RoomError(403, "NOT_A_MEMBER", "You are not a member of this room");
    return m;
  }

  private newCode() {
    for (let i = 0; i < 50; i++) {
      let c = "";
      for (let j = 0; j < 5; j++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new RoomError(503, "NO_CODE", "Could not allocate a room code");
  }

  captainOf(room: Room, team: Team): string | null {
    let best: Member | null = null;
    for (const m of room.members.values()) if (m.team === team && (!best || m.joinedAt < best.joinedAt)) best = m;
    return best?.userId ?? null;
  }

  // -------------------------------------------------------------- room lifecycle
  create(user: RoomUser, opts: Partial<RoomSettings> = {}): Room {
    if (this.rooms.size >= this.maxRooms) throw new RoomError(503, "SERVER_FULL", "Server is at room capacity");
    this.leaveExisting(user.id, undefined);
    const mode = opts.mode ?? "private";
    const settings: RoomSettings = {
      halfMinutes: clampInt(opts.halfMinutes ?? 5, 1, 10),
      difficulty: DIFFICULTIES.includes(opts.difficulty as Difficulty) ? (opts.difficulty as Difficulty) : "medium",
      stadium: STADIUMS.some((s) => s.id === opts.stadium) ? (opts.stadium as StadiumId) : "international",
      time: TIMES.includes(opts.time as (typeof TIMES)[number]) ? (opts.time as (typeof TIMES)[number]) : "day",
      weather: WEATHERS.includes(opts.weather as (typeof WEATHERS)[number]) ? (opts.weather as (typeof WEATHERS)[number]) : "clear",
      isPublic: opts.isPublic ?? mode === "quick",
      mode,
    };
    const now = Date.now();
    const room: Room = {
      code: this.newCode(),
      hostId: user.id,
      settings,
      kits: defaultKits(),
      tactics: ["balanced", "balanced"],
      members: new Map(),
      state: "lobby",
      countdownEnd: 0,
      sim: null,
      roster: [],
      result: null,
      createdAt: now,
      lastActivity: now,
      lastJoin: now,
      subs: new Map(),
      loop: null,
      acc: 0,
      lastTickAt: now,
      version: 1,
      autoStart: mode === "quick",
    };
    this.rooms.set(room.code, room);
    this.addMember(room, user);
    return room;
  }

  private addMember(room: Room, user: RoomUser): Member {
    const now = Date.now();
    const m: Member = {
      userId: user.id,
      name: user.displayName,
      team: null,
      role: null,
      ready: false,
      connected: false,
      lastSeen: now,
      joinedAt: now,
      appearance: user.appearance,
      tokens: 90,
      tokenAt: now,
    };
    room.members.set(user.id, m);
    this.userRoom.set(user.id, room.code);
    room.lastJoin = now;
    room.version++;
    return m;
  }

  join(code: string, user: RoomUser): Room {
    const room = this.get(code);
    const existing = room.members.get(user.id);
    if (existing) {
      existing.lastSeen = Date.now();
      return room; // re-joining (reconnect) keeps team + position
    }
    if (room.state !== "lobby") throw new RoomError(409, "MATCH_STARTED", "This match has already started");
    if (room.members.size >= 14) throw new RoomError(409, "ROOM_FULL", "Room is full (14 players)");
    this.leaveExisting(user.id, room.code);
    this.addMember(room, user);
    this.broadcastRoom(room);
    return room;
  }

  private leaveExisting(userId: string, exceptCode: string | undefined) {
    const code = this.userRoom.get(userId);
    if (code && code !== exceptCode) {
      const r = this.rooms.get(code);
      if (r) this.leave(r.code, userId);
      this.userRoom.delete(userId);
    }
  }

  leave(code: string, userId: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    const m = room.members.get(userId);
    if (!m) return;
    if (room.state === "playing" && room.sim && m.team !== null && m.role) {
      room.sim.setHuman(slotIdx(m.team, m.role), false);
      this.updateRosterConn(room);
    }
    room.members.delete(userId);
    this.userRoom.delete(userId);
    const sub = room.subs.get(userId);
    if (sub) {
      room.subs.delete(userId);
      sub.close();
    }
    if (room.state === "countdown") room.state = "lobby";
    if (room.hostId === userId) {
      const next = [...room.members.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0];
      if (next) room.hostId = next.userId;
    }
    room.version++;
    if (room.members.size === 0) this.destroy(room);
    else this.broadcastRoom(room);
  }

  destroy(room: Room) {
    if (room.loop) clearInterval(room.loop);
    room.loop = null;
    for (const s of room.subs.values()) s.close();
    room.subs.clear();
    for (const id of room.members.keys()) if (this.userRoom.get(id) === room.code) this.userRoom.delete(id);
    this.rooms.delete(room.code);
  }

  // -------------------------------------------------------------- lobby actions
  private lobbyOnly(room: Room) {
    if (room.state !== "lobby") throw new RoomError(409, "LOCKED", "Selections are locked once the match has started");
  }

  setTeam(code: string, userId: string, team: Team) {
    const room = this.get(code);
    const m = this.member(room, userId);
    this.lobbyOnly(room);
    if (team !== 0 && team !== 1) throw new RoomError(422, "BAD_TEAM", "Invalid team");
    if (room.settings.mode === "coop" && team === 1) throw new RoomError(409, "COOP_AI_TEAM", "Team B is AI-controlled in Co-op vs AI");
    if (m.team === team) return room;
    const count = [...room.members.values()].filter((x) => x.team === team).length;
    if (count >= 7) throw new RoomError(409, "TEAM_FULL", "That team already has 7 players");
    m.team = team;
    m.role = null;
    m.ready = false;
    this.touch(room);
    return room;
  }

  setRole(code: string, userId: string, role: Role) {
    const room = this.get(code);
    const m = this.member(room, userId);
    this.lobbyOnly(room);
    if (!ROLES.includes(role)) throw new RoomError(422, "BAD_ROLE", "Invalid position");
    if (m.team === null) throw new RoomError(409, "NO_TEAM", "Choose a team first");
    for (const o of room.members.values()) {
      if (o.userId !== userId && o.team === m.team && o.role === role) throw new RoomError(409, "POSITION_TAKEN", "That position is already taken");
    }
    m.role = role;
    m.ready = false;
    this.touch(room);
    return room;
  }

  setReady(code: string, userId: string, ready: boolean) {
    const room = this.get(code);
    const m = this.member(room, userId);
    this.lobbyOnly(room);
    if (ready && (m.team === null || !m.role)) throw new RoomError(409, "NO_POSITION", "Pick a team and position before confirming");
    m.ready = ready;
    this.touch(room);
    return room;
  }

  setSettings(code: string, userId: string, s: Partial<RoomSettings>) {
    const room = this.get(code);
    this.member(room, userId);
    this.lobbyOnly(room);
    if (room.hostId !== userId) throw new RoomError(403, "HOST_ONLY", "Only the host can change room settings");
    const cur = room.settings;
    if (s.halfMinutes !== undefined) cur.halfMinutes = clampInt(s.halfMinutes, 1, 10);
    if (s.difficulty && DIFFICULTIES.includes(s.difficulty)) cur.difficulty = s.difficulty;
    if (s.stadium && STADIUMS.some((x) => x.id === s.stadium)) cur.stadium = s.stadium;
    if (s.time && TIMES.includes(s.time)) cur.time = s.time;
    if (s.weather && WEATHERS.includes(s.weather)) cur.weather = s.weather;
    if (s.isPublic !== undefined) cur.isPublic = !!s.isPublic;
    this.touch(room);
    return room;
  }

  setKit(code: string, userId: string, team: Team, kit: Partial<Kit>) {
    const room = this.get(code);
    const m = this.member(room, userId);
    this.lobbyOnly(room);
    if (m.team !== team || this.captainOf(room, team) !== userId) throw new RoomError(403, "CAPTAIN_ONLY", "Only the team captain can change the kit");
    const k = room.kits[team];
    const color = /^#[0-9a-fA-F]{6}$/;
    if (kit.name !== undefined) k.name = kit.name.replace(/[^\w \-]/g, "").slice(0, 18) || k.name;
    if (kit.primary && color.test(kit.primary)) k.primary = kit.primary;
    if (kit.secondary && color.test(kit.secondary)) k.secondary = kit.secondary;
    if (kit.gk && color.test(kit.gk)) k.gk = kit.gk;
    if (kit.pattern && PATTERNS.includes(kit.pattern)) k.pattern = kit.pattern;
    this.touch(room);
    return room;
  }

  setTactic(code: string, userId: string, team: Team, tactic: Tactic) {
    const room = this.get(code);
    const m = this.member(room, userId);
    if (m.team !== team || this.captainOf(room, team) !== userId) throw new RoomError(403, "CAPTAIN_ONLY", "Only the team captain can set tactics");
    if (!TACTICS.includes(tactic)) throw new RoomError(422, "BAD_TACTIC", "Invalid tactic");
    if (room.state !== "lobby" && room.state !== "countdown") throw new RoomError(409, "LOCKED", "Tactics can only be chosen before kickoff");
    room.tactics[team] = tactic;
    this.touch(room);
    return room;
  }

  kick(code: string, userId: string, targetId: string) {
    const room = this.get(code);
    this.member(room, userId);
    if (room.hostId !== userId) throw new RoomError(403, "HOST_ONLY", "Only the host can remove players");
    if (targetId === userId) throw new RoomError(409, "SELF", "You cannot remove yourself");
    this.lobbyOnly(room);
    this.leave(code, targetId);
    return room;
  }

  start(code: string, userId: string, force = false) {
    const room = this.get(code);
    this.member(room, userId);
    if (room.hostId !== userId && !force) throw new RoomError(403, "HOST_ONLY", "Only the host can start the match");
    this.lobbyOnly(room);
    const members = [...room.members.values()];
    if (!members.length) throw new RoomError(409, "EMPTY", "No players");
    for (const m of members) {
      if (m.team === null || !m.role) throw new RoomError(409, "NOT_READY", `${m.name} has not chosen a position`);
      if (m.userId !== room.hostId && !m.ready && !force) throw new RoomError(409, "NOT_READY", `${m.name} is not ready`);
    }
    room.state = "countdown";
    room.countdownEnd = Date.now() + (force ? 3000 : 5000);
    this.ensureLoop(room);
    this.touch(room);
    return room;
  }

  cancelStart(code: string, userId: string) {
    const room = this.get(code);
    this.member(room, userId);
    if (room.hostId !== userId) throw new RoomError(403, "HOST_ONLY", "Only the host can cancel");
    if (room.state === "countdown") {
      room.state = "lobby";
      this.touch(room);
    }
    return room;
  }

  rematch(code: string, userId: string) {
    const room = this.get(code);
    this.member(room, userId);
    if (room.hostId !== userId) throw new RoomError(403, "HOST_ONLY", "Only the host can start a rematch");
    if (room.state !== "finished") throw new RoomError(409, "NOT_FINISHED", "Match is not finished");
    room.state = "lobby";
    room.sim = null;
    room.result = null;
    room.roster = [];
    for (const m of room.members.values()) m.ready = false;
    if (room.loop) clearInterval(room.loop);
    room.loop = null;
    this.touch(room);
    return room;
  }

  // -------------------------------------------------------------- gameplay input
  input(code: string, userId: string, msg: InputMsg) {
    const room = this.get(code);
    const m = this.member(room, userId);
    const now = Date.now();
    m.tokens = Math.min(90, m.tokens + ((now - m.tokenAt) / 1000) * 90);
    m.tokenAt = now;
    if (m.tokens < 1) throw new RoomError(429, "RATE_LIMITED", "Input rate limit exceeded");
    m.tokens -= 1;
    m.lastSeen = now;
    if (room.state !== "playing" || !room.sim || m.team === null || !m.role) return false;
    return room.sim.pushInput(slotIdx(m.team, m.role), msg);
  }

  // -------------------------------------------------------------- match
  private ensureLoop(room: Room) {
    if (room.loop) return;
    room.lastTickAt = Date.now();
    room.loop = setInterval(() => this.tickRoom(room), 1000 / 60);
    (room.loop as unknown as { unref?: () => void }).unref?.();
  }

  initMatch(room: Room) {
    const s = room.settings;
    const sim = new MatchSim({
      halfSeconds: s.halfMinutes * 60,
      halftimeSeconds: s.halfMinutes <= 2 ? 20 : 60,
      difficulty: s.difficulty,
      tactics: [...room.tactics] as [Tactic, Tactic],
      seed: randomInt(1, 2 ** 30),
    });
    for (const p of sim.players) p.name = `CPU ${p.role}`;
    for (const m of room.members.values()) {
      if (m.team === null || !m.role) continue;
      sim.setHuman(slotIdx(m.team, m.role), m.connected, m.name, m.userId);
      sim.players[slotIdx(m.team, m.role)].name = m.name;
      sim.players[slotIdx(m.team, m.role)].userId = m.userId;
    }
    room.sim = sim;
    room.state = "playing";
    room.acc = 0;
    room.lastTickAt = Date.now();
    this.updateRosterConn(room);
    this.touch(room);
  }

  private buildRoster(room: Room): RosterEntry[] {
    const byIdx = new Map<number, Member>();
    for (const m of room.members.values()) if (m.team !== null && m.role) byIdx.set(slotIdx(m.team, m.role), m);
    const out: RosterEntry[] = [];
    for (let i = 0; i < 14; i++) {
      const team = (i < 7 ? 0 : 1) as Team;
      const role = ROLES[i % 7];
      const m = byIdx.get(i);
      out.push({
        idx: i,
        team,
        role,
        number: ROLE_NUMBER[role],
        name: m ? m.name : `CPU ${role}`,
        human: !!m,
        userId: m ? m.userId : null,
        connected: !!m && m.connected,
        appearance: m ? m.appearance : aiAppearance(i),
      });
    }
    return out;
  }

  private updateRosterConn(room: Room) {
    room.roster = this.buildRoster(room);
    room.version++;
  }

  private tickRoom(room: Room) {
    const now = Date.now();
    if (room.state === "countdown") {
      if (now >= room.countdownEnd) this.initMatch(room);
      else if (Math.floor((room.countdownEnd - now) / 1000) !== Math.floor((room.countdownEnd - now - 17) / 1000)) this.broadcastRoom(room);
      return;
    }
    if (room.state !== "playing" || !room.sim) return;
    room.acc += Math.min(now - room.lastTickAt, 250);
    room.lastTickAt = now;
    const stepMs = TICK_DT * 1000;
    while (room.acc >= stepMs && room.state === "playing") {
      room.acc -= stepMs;
      room.sim.step(TICK_DT);
      this.broadcastSnapshot(room, room.sim.snapshot());
      if (room.sim.phase === "finished") {
        this.finish(room);
        break;
      }
    }
  }

  private finish(room: Room) {
    if (!room.sim) return;
    room.state = "finished";
    room.result = room.sim.result();
    if (room.loop) clearInterval(room.loop);
    room.loop = null;
    room.version++;
    this.broadcastRoom(room);
    const result = room.result;
    Promise.resolve(this.hooks.onFinish(room, result)).catch((e) => console.error("[rooms] persist failed:", e instanceof Error ? e.message : "unknown"));
  }

  // -------------------------------------------------------------- connections
  subscribe(code: string, userId: string, sub: Omit<Sub, "id">): { unsubscribe: () => void } {
    const room = this.get(code);
    const m = this.member(room, userId);
    const old = room.subs.get(userId);
    const mine: Sub = { ...sub, id: subCounter++ };
    if (old) {
      old.send("replaced", "{}"); // duplicate-session prevention: newest connection wins
      room.subs.delete(userId);
      old.close();
    }
    room.subs.set(userId, mine);
    const wasConnected = m.connected;
    m.connected = true;
    m.lastSeen = Date.now();
    if (room.state === "playing" && room.sim && m.team !== null && m.role) {
      room.sim.setHuman(slotIdx(m.team, m.role), true); // human control restored
    }
    if (room.state === "playing") this.updateRosterConn(room);
    else room.version++;
    mine.send("room", JSON.stringify(this.view(room)));
    if (room.sim) mine.send("snap", JSON.stringify(room.sim.snapshot()));
    if (!wasConnected) this.broadcastRoom(room, userId);
    return {
      unsubscribe: () => {
        const cur = room.subs.get(userId);
        if (!cur || cur.id !== mine.id) return;
        room.subs.delete(userId);
        this.markDisconnected(room, userId);
      },
    };
  }

  private markDisconnected(room: Room, userId: string) {
    const m = room.members.get(userId);
    if (!m) return;
    m.connected = false;
    m.lastSeen = Date.now();
    if (room.state === "playing" && room.sim && m.team !== null && m.role) {
      room.sim.setHuman(slotIdx(m.team, m.role), false); // immediate AI takeover
      this.updateRosterConn(room);
    } else room.version++;
    this.broadcastRoom(room);
  }

  private touch(room: Room) {
    room.version++;
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
  }

  broadcastRoom(room: Room, exceptUser?: string) {
    if (!room.subs.size) return;
    const data = JSON.stringify(this.view(room));
    for (const [uid, s] of room.subs) if (uid !== exceptUser) s.send("room", data);
  }

  private broadcastSnapshot(room: Room, snap: Snapshot) {
    if (!room.subs.size) return;
    const data = JSON.stringify(snap);
    for (const s of room.subs.values()) s.send("snap", data);
  }

  view(room: Room) {
    const members = [...room.members.values()].map((m) => ({
      userId: m.userId,
      name: m.name,
      team: m.team,
      role: m.role,
      ready: m.ready,
      connected: m.connected,
      isHost: m.userId === room.hostId,
      isCaptain: m.team !== null && this.captainOf(room, m.team) === m.userId,
      appearance: m.appearance,
    }));
    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      countdown: room.state === "countdown" ? Math.max(0, Math.ceil((room.countdownEnd - Date.now()) / 1000)) : 0,
      settings: room.settings,
      kits: room.kits,
      tactics: room.tactics,
      members,
      roster: room.roster,
      result: room.result,
      version: room.version,
    };
  }

  /** Public room discovery. */
  list() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (!r.settings.isPublic || r.state !== "lobby") continue;
      out.push({
        code: r.code,
        players: r.members.size,
        capacity: 14,
        mode: r.settings.mode,
        stadium: r.settings.stadium,
        halfMinutes: r.settings.halfMinutes,
        host: r.members.get(r.hostId)?.name ?? "?",
      });
    }
    return out.sort((a, b) => b.players - a.players).slice(0, 30);
  }

  /** Quick Match: join the fullest open matchmaking room or create one. Team balancing + auto position. */
  quickMatch(user: RoomUser): Room {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.autoStart || r.state !== "lobby" || r.members.size >= 14) continue;
      if (r.members.has(user.id)) {
        best = r;
        break;
      }
      if (!best || r.members.size > best.members.size) best = r;
    }
    const room = best ? this.join(best.code, user) : this.create(user, { mode: "quick", isPublic: true });
    const m = room.members.get(user.id)!;
    if (m.team === null) {
      const a = [...room.members.values()].filter((x) => x.team === 0).length;
      const b = [...room.members.values()].filter((x) => x.team === 1).length;
      const team: Team = a <= b ? 0 : 1;
      const taken = new Set([...room.members.values()].filter((x) => x.team === team && x.role).map((x) => x.role));
      const role = POSITION_PREFERENCE.find((r) => !taken.has(r));
      if (role) {
        m.team = team;
        m.role = role;
        m.ready = true;
      }
      this.touch(room);
    }
    return room;
  }

  // -------------------------------------------------------------- maintenance
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const connected = [...room.members.values()].filter((m) => m.connected).length;
      if (room.state === "lobby" || room.state === "countdown") {
        for (const m of [...room.members.values()]) {
          if (!m.connected && now - m.lastSeen > 45_000) this.leave(room.code, m.userId);
        }
        if (!this.rooms.has(room.code)) continue;
        if (room.autoStart && room.state === "lobby" && connected >= 2 && now - room.lastJoin > 8000) {
          try {
            for (const m of room.members.values()) if (m.team !== null && m.role) m.ready = true;
            this.start(room.code, room.hostId, true);
          } catch {
            /* members without positions: wait */
          }
        }
        if (connected === 0 && now - room.lastActivity > 120_000) this.destroy(room);
      } else if (room.state === "playing") {
        if (connected === 0 && now - room.lastActivity > 120_000 && [...room.members.values()].every((m) => now - m.lastSeen > 120_000)) this.destroy(room);
      } else if (room.state === "finished" && now - room.lastActivity > 300_000) {
        this.destroy(room);
      }
    }
  }

  shutdown() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const r of [...this.rooms.values()]) this.destroy(r);
  }
}

function clampInt(v: number, a: number, b: number) {
  const n = Math.round(Number(v));
  return Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
}

export function aiAppearance(i: number): Appearance {
  return { gender: i % 5 === 3 ? "f" : "m", hair: (i * 3) % 6, hairColor: (i * 5) % 6, skin: (i * 7) % 6 };
}

const g = globalThis as unknown as { __fmRooms?: RoomManager };
export function getRoomManager(): RoomManager {
  if (!g.__fmRooms) {
    g.__fmRooms = new RoomManager();
    const shutdown = () => g.__fmRooms?.shutdown();
    process.once("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  }
  return g.__fmRooms;
}
