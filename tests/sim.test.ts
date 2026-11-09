import { describe, expect, it } from "vitest";
import { MatchSim } from "@/game/sim/sim";
import { newBall, stepBall } from "@/game/sim/ballPhysics";
import { PITCH, TICK_DT } from "@/game/shared/constants";
import type { GameEvent, SimConfig } from "@/game/shared/types";

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  halfSeconds: 60,
  halftimeSeconds: 2,
  difficulty: "medium",
  tactics: ["balanced", "balanced"],
  seed: 7,
  ...over,
});

function runAll(sim: MatchSim, maxSeconds = 600) {
  const events: GameEvent[] = [];
  for (let i = 0; i < maxSeconds / TICK_DT && sim.phase !== "finished"; i++) {
    sim.step(TICK_DT);
    events.push(...sim.events);
  }
  return events;
}

describe("ball physics", () => {
  it("falls under gravity, bounces and loses energy", () => {
    const b = newBall();
    b.y = 5;
    let maxAfter = 0;
    let bounced = false;
    for (let i = 0; i < 600; i++) {
      stepBall(b, 1 / 60, (e) => e.k === "bounce" && (bounced = true));
      if (bounced) maxAfter = Math.max(maxAfter, b.y);
    }
    expect(bounced).toBe(true);
    expect(maxAfter).toBeLessThan(5);
    expect(b.y).toBeCloseTo(PITCH.BALL_R, 1);
  });
  it("rolling friction brings a ground ball to rest", () => {
    const b = newBall();
    b.vx = 10;
    for (let i = 0; i < 60 * 12; i++) stepBall(b, 1 / 60, () => {});
    expect(b.vx).toBe(0);
    expect(b.x).toBeGreaterThan(5);
  });
  it("curve bends the trajectory in flight", () => {
    const b = newBall();
    b.vx = 20;
    b.vy = 5;
    b.curve = 0.4;
    for (let i = 0; i < 60; i++) stepBall(b, 1 / 60, () => {});
    expect(Math.abs(b.z)).toBeGreaterThan(0.3);
  });
  it("bounces off the post", () => {
    const b = newBall();
    b.x = PITCH.HL - 0.5;
    b.z = PITCH.GOAL_W / 2;
    b.vx = 20;
    let post = false;
    for (let i = 0; i < 30; i++) stepBall(b, 1 / 60, (e) => e.k === "post" && (post = true));
    expect(post).toBe(true);
    expect(b.vx).toBeLessThan(5);
  });
});

describe("match simulation", () => {
  it("plays a full AI-only match with valid state and a proper state machine", () => {
    const sim = new MatchSim(cfg());
    const events = runAll(sim);
    expect(sim.phase).toBe("finished");
    const kinds = new Set(events.map((e) => e.k));
    expect(kinds.has("kickoff")).toBe(true);
    expect(kinds.has("halftime")).toBe(true);
    expect(kinds.has("fulltime")).toBe(true);
    for (const p of sim.players) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(PITCH.HL + 4.01);
    }
    expect(Number.isFinite(sim.ball.x)).toBe(true);
    const goals = events.filter((e) => e.k === "goal").length;
    expect(sim.score[0] + sim.score[1]).toBe(goals); // goals are never double counted
    // something football-like happened
    const kicks = events.filter((e) => e.k === "kick").length;
    expect(kicks).toBeGreaterThan(20);
    const r = sim.result();
    expect(r.possession[0] + r.possession[1]).toBeGreaterThanOrEqual(99);
  });

  it("is deterministic for a given seed", () => {
    const a = new MatchSim(cfg({ halfSeconds: 20 }));
    const b = new MatchSim(cfg({ halfSeconds: 20 }));
    runAll(a);
    runAll(b);
    expect(a.score).toEqual(b.score);
    expect(a.ball.x).toBeCloseTo(b.ball.x, 6);
  });

  it("detects a goal server-side exactly once and restarts with kickoff", () => {
    const sim = new MatchSim(cfg());
    for (let i = 0; i < 120 && sim.phase !== "restart"; i++) sim.step(TICK_DT);
    // force play and shoot a ball into team B's goal (+x)
    sim.phase = "playing";
    sim.setPiece = null;
    const b = sim.ball;
    b.x = 40;
    b.z = 0;
    b.vx = 30;
    b.vy = 0;
    b.vz = 0;
    b.owner = -1;
    b.lastTouch = 5;
    b.lastTeam = 0;
    for (const p of sim.players) p.active = p.idx === 5; // remove the keeper so nothing interferes
    let goals = 0;
    for (let i = 0; i < 60; i++) {
      sim.step(TICK_DT);
      goals += sim.events.filter((e) => e.k === "goal").length;
    }
    expect(goals).toBe(1);
    expect(sim.score).toEqual([1, 0]);
    expect(sim.phase).toBe("goal");
  });

  it("awards a goal kick/corner when the ball crosses the goal line wide", () => {
    const sim = new MatchSim(cfg());
    sim.phase = "playing";
    sim.setPiece = null;
    for (const p of sim.players) p.active = false;
    const b = sim.ball;
    b.x = 50;
    b.z = 12;
    b.vx = 20;
    b.lastTeam = 0;
    for (let i = 0; i < 30 && sim.phase === "playing"; i++) sim.step(TICK_DT);
    expect(sim.phase).toBe("restart");
    expect(sim.snapshot().sp?.k).toBe("goalkick");
    expect(sim.snapshot().sp?.team).toBe(1);
  });

  it("throw-in for touchline exit", () => {
    const sim = new MatchSim(cfg());
    sim.phase = "playing";
    sim.setPiece = null;
    for (const p of sim.players) p.active = false;
    const b = sim.ball;
    b.x = 10;
    b.z = 33;
    b.vz = 15;
    b.lastTeam = 1;
    for (let i = 0; i < 30 && sim.phase === "playing"; i++) sim.step(TICK_DT);
    expect(sim.snapshot().sp?.k).toBe("throwin");
    expect(sim.snapshot().sp?.team).toBe(0);
  });

  it("validates human input and ignores spoofed/invalid messages", () => {
    const sim = new MatchSim(cfg());
    sim.setHuman(3, true, "Tester");
    expect(sim.pushInput(3, { seq: 1, mx: 5, mz: 0, sprint: true })).toBe(true);
    expect(Math.hypot(sim.players[3].input.mx, sim.players[3].input.mz)).toBeLessThanOrEqual(1.0001);
    expect(sim.pushInput(3, { seq: 0, mx: 1, mz: 0, sprint: false })).toBe(false); // stale seq
    expect(sim.pushInput(3, { seq: 2, mx: NaN, mz: 0, sprint: false })).toBe(false);
    expect(sim.pushInput(4, { seq: 1, mx: 1, mz: 0, sprint: false })).toBe(false); // AI-controlled slot
  });

  it("human player accelerates with limited speed and consumes stamina when sprinting", () => {
    const sim = new MatchSim(cfg());
    sim.setHuman(5, true, "Runner");
    for (let i = 0; i < 90; i++) {
      sim.pushInput(5, { seq: i + 1, mx: 1, mz: 0, sprint: true });
      sim.step(TICK_DT);
    }
    const p = sim.players[5];
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(8.3);
    expect(p.stamina).toBeLessThan(100);
  });

  it("AI takeover: releasing a human slot returns it to AI control", () => {
    const sim = new MatchSim(cfg());
    sim.setHuman(2, true, "Bob");
    expect(sim.players[2].human).toBe(true);
    sim.setHuman(2, false);
    expect(sim.players[2].human).toBe(false);
    const x0 = sim.players[2].x;
    for (let i = 0; i < 200; i++) sim.step(TICK_DT);
    expect(Number.isFinite(sim.players[2].x)).toBe(true);
    expect(x0).not.toBeNaN();
  });

  it("practice drills run and finish", () => {
    const sim = new MatchSim(cfg({ drill: "shooting" }));
    for (let i = 0; i < 30 * 40; i++) sim.step(TICK_DT);
    const snap = sim.snapshot();
    expect(snap.dr?.kind).toBe("shooting");
  });
});
