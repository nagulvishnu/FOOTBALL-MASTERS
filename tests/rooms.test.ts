import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomError, RoomManager, type RoomUser } from "@/server/rooms";
import { slotIdx } from "@/game/shared/constants";
import type { MatchResult } from "@/game/shared/types";

const user = (n: number): RoomUser => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, displayName: `P${n}`, appearance: { gender: "m", hair: 0, hairColor: 0, skin: 1 } });
const noSub = () => ({ send: () => {}, close: () => {} });

let mgr: RoomManager;
beforeEach(() => {
  mgr = new RoomManager(false);
});
afterEach(() => mgr.shutdown());

function expectErr(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RoomError);
    expect((e as RoomError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function readyRoom() {
  const room = mgr.create(user(1));
  mgr.join(room.code, user(2));
  mgr.setTeam(room.code, user(1).id, 0);
  mgr.setRole(room.code, user(1).id, "LW");
  mgr.setTeam(room.code, user(2).id, 1);
  mgr.setRole(room.code, user(2).id, "GK");
  mgr.setReady(room.code, user(2).id, true);
  return room;
}

describe("rooms: creation, joining and teams", () => {
  it("creates a room with a unique 5-char code and host", () => {
    const a = mgr.create(user(1));
    const b = mgr.create(user(2));
    expect(a.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.hostId).toBe(user(1).id);
  });
  it("joins by code (case-insensitive) and rejects unknown codes", () => {
    const r = mgr.create(user(1));
    mgr.join(r.code.toLowerCase(), user(2));
    expect(r.members.size).toBe(2);
    expectErr(() => mgr.join("ZZZZZ", user(3)), "ROOM_NOT_FOUND");
  });
  it("enforces 14 player capacity", () => {
    const r = mgr.create(user(1));
    for (let i = 2; i <= 14; i++) mgr.join(r.code, user(i));
    expectErr(() => mgr.join(r.code, user(15)), "ROOM_FULL");
  });
  it("assigns teams and caps a team at 7", () => {
    const r = mgr.create(user(1));
    for (let i = 2; i <= 8; i++) mgr.join(r.code, user(i));
    for (let i = 1; i <= 7; i++) mgr.setTeam(r.code, user(i).id, 0);
    expectErr(() => mgr.setTeam(r.code, user(8).id, 0), "TEAM_FULL");
    mgr.setTeam(r.code, user(8).id, 1);
    expect(r.members.get(user(8).id)!.team).toBe(1);
  });
  it("co-op rooms keep Team B for the AI", () => {
    const r = mgr.create(user(1), { mode: "coop" });
    expectErr(() => mgr.setTeam(r.code, user(1).id, 1), "COOP_AI_TEAM");
  });
});

describe("rooms: positions and ready state", () => {
  it("requires a team before a position", () => {
    const r = mgr.create(user(1));
    expectErr(() => mgr.setRole(r.code, user(1).id, "GK"), "NO_TEAM");
  });
  it("rejects duplicate position ownership on the same team but allows it on the other", () => {
    const r = mgr.create(user(1));
    mgr.join(r.code, user(2));
    mgr.join(r.code, user(3));
    mgr.setTeam(r.code, user(1).id, 0);
    mgr.setTeam(r.code, user(2).id, 0);
    mgr.setTeam(r.code, user(3).id, 1);
    mgr.setRole(r.code, user(1).id, "GK");
    expectErr(() => mgr.setRole(r.code, user(2).id, "GK"), "POSITION_TAKEN");
    mgr.setRole(r.code, user(3).id, "GK");
    expect(r.members.get(user(3).id)!.role).toBe("GK");
  });
  it("changing team releases the position; ready needs a position", () => {
    const r = mgr.create(user(1));
    mgr.setTeam(r.code, user(1).id, 0);
    expectErr(() => mgr.setReady(r.code, user(1).id, true), "NO_POSITION");
    mgr.setRole(r.code, user(1).id, "RB");
    mgr.setReady(r.code, user(1).id, true);
    mgr.setTeam(r.code, user(1).id, 1);
    const m = r.members.get(user(1).id)!;
    expect(m.role).toBeNull();
    expect(m.ready).toBe(false);
  });
  it("only the host may change settings; only captains set kit/tactics", () => {
    const r = readyRoom();
    expectErr(() => mgr.setSettings(r.code, user(2).id, { halfMinutes: 3 }), "HOST_ONLY");
    mgr.setSettings(r.code, user(1).id, { halfMinutes: 3, difficulty: "expert" });
    expect(r.settings.halfMinutes).toBe(3);
    mgr.setTactic(r.code, user(1).id, 0, "attacking");
    expect(r.tactics[0]).toBe("attacking");
    expectErr(() => mgr.setTactic(r.code, user(2).id, 0, "defensive"), "CAPTAIN_ONLY");
  });
});

describe("rooms: match start, authority and locking", () => {
  it("refuses to start until everyone is ready, then counts down and initialises the match", () => {
    const r = mgr.create(user(1));
    mgr.join(r.code, user(2));
    mgr.setTeam(r.code, user(1).id, 0);
    expectErr(() => mgr.start(r.code, user(1).id), "NOT_READY");
    mgr.setRole(r.code, user(1).id, "LW");
    mgr.setTeam(r.code, user(2).id, 1);
    mgr.setRole(r.code, user(2).id, "GK");
    expectErr(() => mgr.start(r.code, user(1).id), "NOT_READY");
    mgr.setReady(r.code, user(2).id, true);
    mgr.subscribe(r.code, user(1).id, noSub());
    mgr.subscribe(r.code, user(2).id, noSub());
    expectErr(() => mgr.start(r.code, user(2).id), "HOST_ONLY");
    mgr.start(r.code, user(1).id);
    expect(r.state).toBe("countdown");
    r.countdownEnd = Date.now() - 1;
    (mgr as unknown as { tickRoom: (r: unknown) => void }).tickRoom(r);
    expect(r.state).toBe("playing");
    expect(r.sim).not.toBeNull();
    // humans own exactly their slots, AI fills the rest
    const humans = r.sim!.players.filter((p) => p.human).map((p) => p.idx);
    expect(humans.sort()).toEqual([slotIdx(0, "LW"), slotIdx(1, "GK")].sort());
    expect(r.sim!.players.filter((p) => !p.human).length).toBe(12);
    // selection is locked after kickoff
    expectErr(() => mgr.setRole(r.code, user(1).id, "RW"), "LOCKED");
    expectErr(() => mgr.setTeam(r.code, user(1).id, 1), "LOCKED");
    expectErr(() => mgr.join(r.code, user(3)), "MATCH_STARTED");
  });

  it("validates input: only the owner's slot is affected and malformed input is rejected", () => {
    const r = readyRoom();
    mgr.subscribe(r.code, user(1).id, noSub());
    mgr.start(r.code, user(1).id);
    r.countdownEnd = 0;
    (mgr as unknown as { tickRoom: (r: unknown) => void }).tickRoom(r);
    expect(mgr.input(r.code, user(1).id, { seq: 1, mx: 1, mz: 0, sprint: true })).toBe(true);
    const lw = r.sim!.players[slotIdx(0, "LW")];
    expect(lw.input.mx).toBe(1);
    expect(r.sim!.players[slotIdx(0, "RW")].input.mx).toBe(0); // AI slot untouched
    expect(mgr.input(r.code, user(1).id, { seq: 2, mx: Infinity, mz: 0, sprint: false })).toBe(false);
    expectErr(() => mgr.input(r.code, "99999999-9999-4999-8999-999999999999", { seq: 1, mx: 0, mz: 0, sprint: false }), "NOT_A_MEMBER");
  });

  it("rate-limits input floods", () => {
    const r = readyRoom();
    let limited = false;
    for (let i = 0; i < 400; i++) {
      try {
        mgr.input(r.code, user(1).id, { seq: i, mx: 0, mz: 0, sprint: false });
      } catch (e) {
        limited = (e as RoomError).code === "RATE_LIMITED";
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("AI takes over on disconnect and the human regains control on reconnect", () => {
    const r = readyRoom();
    const sub = mgr.subscribe(r.code, user(1).id, noSub());
    mgr.subscribe(r.code, user(2).id, noSub());
    mgr.start(r.code, user(1).id);
    r.countdownEnd = 0;
    (mgr as unknown as { tickRoom: (r: unknown) => void }).tickRoom(r);
    const idx = slotIdx(0, "LW");
    expect(r.sim!.players[idx].human).toBe(true);
    sub.unsubscribe(); // connection lost
    expect(r.sim!.players[idx].human).toBe(false);
    expect(r.roster[idx].connected).toBe(false);
    expect(r.members.get(user(1).id)!.role).toBe("LW"); // slot is kept
    mgr.subscribe(r.code, user(1).id, noSub()); // reconnect
    expect(r.sim!.players[idx].human).toBe(true);
    expect(r.roster[idx].connected).toBe(true);
  });

  it("prevents duplicate sessions: the newest connection wins", () => {
    const r = readyRoom();
    const events: string[] = [];
    let closed = 0;
    const a = mgr.subscribe(r.code, user(1).id, { send: (e) => events.push(e), close: () => closed++ });
    mgr.subscribe(r.code, user(1).id, noSub());
    expect(events).toContain("replaced");
    expect(closed).toBe(1);
    a.unsubscribe(); // stale connection closing must not disconnect the live one
    expect(r.members.get(user(1).id)!.connected).toBe(true);
  });

  it("runs a full match, stores results and calls the persistence hook once", async () => {
    const r = readyRoom();
    r.settings.halfMinutes = 1;
    let calls = 0;
    let got: MatchResult | null = null;
    mgr.hooks.onFinish = (_room, res) => {
      calls++;
      got = res;
    };
    mgr.start(r.code, user(1).id);
    r.countdownEnd = 0;
    const tick = (mgr as unknown as { tickRoom: (r: unknown) => void }).tickRoom.bind(mgr);
    tick(r);
    for (let i = 0; i < 3000 && r.state === "playing"; i++) {
      r.lastTickAt = Date.now() - 250;
      tick(r);
    }
    expect(r.state).toBe("finished");
    expect(calls).toBe(1);
    expect(got!.players.length).toBe(14);
    expect(r.result!.score[0] + r.result!.score[1]).toBe(got!.score[0] + got!.score[1]);
    mgr.rematch(r.code, user(1).id);
    expect(r.state).toBe("lobby");
  });
});

describe("rooms: matchmaking and cleanup", () => {
  it("quick match balances teams and auto-assigns open positions", () => {
    const codes = new Set<string>();
    for (let i = 1; i <= 6; i++) codes.add(mgr.quickMatch(user(i)).code);
    expect(codes.size).toBe(1);
    const room = mgr.rooms.get([...codes][0])!;
    const a = [...room.members.values()].filter((m) => m.team === 0).length;
    const b = [...room.members.values()].filter((m) => m.team === 1).length;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    const seen = new Set([...room.members.values()].map((m) => `${m.team}-${m.role}`));
    expect(seen.size).toBe(6); // no duplicate ownership
  });
  it("public discovery lists only public lobbies", () => {
    mgr.create(user(1), { isPublic: false });
    const pub = mgr.create(user(2), { isPublic: true });
    const list = mgr.list();
    expect(list.map((l) => l.code)).toEqual([pub.code]);
  });
  it("cleans up abandoned lobbies and transfers the host", () => {
    const r = mgr.create(user(1));
    mgr.join(r.code, user(2));
    mgr.leave(r.code, user(1).id);
    expect(r.hostId).toBe(user(2).id);
    mgr.leave(r.code, user(2).id);
    expect(mgr.rooms.has(r.code)).toBe(false);
    const stale = mgr.create(user(3));
    mgr.sweep(Date.now() + 10 * 60_000);
    expect(mgr.rooms.has(stale.code)).toBe(false);
  });
});
