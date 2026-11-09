// Practice drills layered on top of the same simulation (offline only).
import { PITCH, clamp, dirOf } from "../shared/constants";
import type { DrillKind, DrillSnap } from "../shared/types";
import type { MatchSim } from "./sim";

const CONES = [
  { x: -18, z: 0 },
  { x: -9, z: 7 },
  { x: 0, z: -7 },
  { x: 9, z: 7 },
  { x: 18, z: -7 },
  { x: 27, z: 0 },
];

export const DRILL_INFO: Record<DrillKind, { title: string; blurb: string }> = {
  free: { title: "Free Movement", blurb: "No pressure. Learn the controls, camera and ball feel." },
  shooting: { title: "Shooting Practice", blurb: "10 shots from random spots against a keeper." },
  passing: { title: "Passing Practice", blurb: "60 seconds. Complete as many passes to teammates as you can." },
  dribbling: { title: "Dribbling Course", blurb: "45 seconds. Dribble through the cones in order." },
  goalkeeper: { title: "Goalkeeper Practice", blurb: "You are the keeper. Face 10 shots - dive with E / F." },
};

export class Drill {
  kind: DrillKind;
  human: number;
  attempts = 0;
  total = 0;
  value = 0;
  sub = "";
  timeLeft = 0;
  done = false;
  cooldown = 1.5;
  live = false;
  liveT = 0;
  conceded = 0;
  next = 0;
  laps = 0;

  constructor(private sim: MatchSim, kind: DrillKind, human: number) {
    this.kind = kind;
    const active = new Set<number>();
    switch (kind) {
      case "free":
        human = 3;
        active.add(3);
        break;
      case "shooting":
        human = 5;
        active.add(5).add(7);
        this.total = 10;
        break;
      case "passing":
        human = 3;
        [3, 4, 5, 6].forEach((i) => active.add(i));
        this.timeLeft = 60;
        break;
      case "dribbling":
        human = 3;
        active.add(3);
        this.timeLeft = 45;
        break;
      case "goalkeeper":
        human = 0;
        active.add(0);
        this.total = 10;
        break;
    }
    this.human = human;
    for (const p of sim.players) {
      p.active = active.has(p.idx);
      if (!p.active) {
        p.x = (p.idx - 7) * 2 - 12;
        p.z = PITCH.HW + 8;
      }
      p.human = p.idx === human;
      p.stamina = 100;
    }
    sim.kickoffTeam = 0;
    this.reset(true);
    this.updateSub();
  }

  get h() {
    return this.sim.players[this.human];
  }

  /** Place the human + ball for a new attempt. */
  reset(initial = false) {
    const s = this.sim;
    const b = s.ball;
    const h = this.h;
    this.live = false;
    this.liveT = 0;
    b.vx = b.vy = b.vz = 0;
    b.y = PITCH.BALL_R;
    b.curve = 0;
    b.owner = -1;
    b.lastTouch = -1;
    b.lastTeam = -1;
    h.vx = h.vz = 0;
    h.lunge = null;
    h.down = 0;
    switch (this.kind) {
      case "shooting": {
        const x = PITCH.HL - (16 + s.rng() * 14);
        const z = (s.rng() - 0.5) * 30;
        h.facing = Math.atan2(-z, PITCH.HL - x);
        b.x = x;
        b.z = z;
        h.x = x - Math.cos(h.facing) * 0.7;
        h.z = z - Math.sin(h.facing) * 0.7;
        b.owner = h.idx;
        break;
      }
      case "goalkeeper": {
        const gx = -PITCH.HL;
        h.x = gx + 1.5;
        h.z = 0;
        h.facing = 0;
        b.x = gx + 40;
        b.z = 0;
        break;
      }
      case "dribbling": {
        h.x = CONES[0].x - 7;
        h.z = 0;
        h.facing = 0;
        b.x = h.x + 0.7;
        b.z = 0;
        b.owner = h.idx;
        this.next = 0;
        break;
      }
      default: {
        h.x = initial ? -6 : h.x;
        h.z = initial ? 0 : h.z;
        h.facing = 0;
        b.x = h.x + 0.7;
        b.z = h.z;
        b.owner = h.idx;
        if (this.kind === "passing") {
          const mates = s.players.filter((p) => p.active && p.idx !== h.idx);
          mates.forEach((m, i) => {
            m.x = 6 + i * 6;
            m.z = (i - 1) * 14;
          });
          h.x = -6;
          h.z = 0;
          b.x = h.x + 0.7;
          b.z = 0;
        }
      }
    }
  }

  private launch() {
    const s = this.sim;
    const b = s.ball;
    const gx = -PITCH.HL;
    const x = gx + 14 + s.rng() * 11;
    const z = (s.rng() - 0.5) * 28;
    b.x = x;
    b.z = z;
    b.y = PITCH.BALL_R;
    const tz = clamp((s.rng() - 0.5) * 7.2, -3.5, 3.5);
    const dx = gx - x;
    const dz = tz - z;
    const l = Math.hypot(dx, dz);
    const sp = 13 + s.rng() * 11;
    b.vx = (dx / l) * sp;
    b.vz = (dz / l) * sp;
    b.vy = s.rng() < 0.35 ? 3 + s.rng() * 2.5 : 0.3;
    b.lastTeam = 1;
    b.lastTouch = 8;
    this.live = true;
    this.liveT = 0;
    s.emit({ k: "kick", p: 8, v: sp, s: "shoot", x, y: b.y, z });
  }

  private resolve(outcome: "goal" | "saved" | "miss") {
    if (this.cooldown > 0 || this.done) return;
    this.attempts++;
    if (this.kind === "shooting" && outcome === "goal") this.value++;
    if (this.kind === "goalkeeper") {
      if (outcome === "saved") this.value++;
      if (outcome === "goal") this.conceded++;
    }
    this.live = false;
    this.sim.emit({ k: "drillResult", s: outcome });
    if (this.total && this.attempts >= this.total) {
      this.finish();
      return;
    }
    this.cooldown = 1.6;
    this.updateSub();
  }

  private finish() {
    this.done = true;
    this.updateSub();
    this.sim.phase = "finished";
    this.sim.emit({ k: "drillDone" });
  }

  private updateSub() {
    const h = this.h;
    switch (this.kind) {
      case "shooting":
        this.sub = `${this.attempts}/${this.total} shots`;
        break;
      case "goalkeeper":
        this.sub = `${this.attempts}/${this.total} shots - ${this.conceded} conceded`;
        break;
      case "passing":
        this.value = h.stats.passOk;
        this.sub = `${h.stats.passes} passes attempted`;
        break;
      case "dribbling":
        this.sub = `Cone ${this.next + 1}/${CONES.length} - laps ${this.laps}`;
        break;
      default:
        this.sub = `Goals: ${this.sim.score[0]}`;
    }
  }

  onGoal(sx: number) {
    if (this.kind === "shooting" && sx > 0) this.resolve("goal");
    else if (this.kind === "goalkeeper" && sx < 0) this.resolve("goal");
    else if (this.kind === "free" || this.kind === "passing" || this.kind === "dribbling") {
      if (sx > 0) this.sim.score[0]++;
      this.reset();
    } else this.onOut();
  }

  onOut() {
    if (this.kind === "shooting" || this.kind === "goalkeeper") {
      if (this.live) this.resolve("miss");
      else if (this.cooldown <= 0) this.reset();
    } else this.reset();
  }

  tick(dt: number) {
    const s = this.sim;
    const b = s.ball;
    if (this.done) return;
    if (this.timeLeft > 0 || this.kind === "passing" || this.kind === "dribbling") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft === 0) {
        this.finish();
        return;
      }
    }
    if (this.kind === "shooting") {
      if (this.cooldown > 0) {
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.reset();
      } else if (!this.live) {
        if (b.owner < 0 && b.lastTouch === this.human) {
          this.live = true;
          this.liveT = 0;
        }
      } else {
        this.liveT += dt;
        const gk = s.players[7];
        const sp = Math.hypot(b.vx, b.vz);
        if (b.owner === gk.idx) this.resolve("saved");
        else if (this.liveT > 6 || (this.liveT > 1 && sp < 0.6 && b.owner < 0)) this.resolve("miss");
      }
    } else if (this.kind === "goalkeeper") {
      if (this.cooldown > 0) {
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
          b.owner = -1;
          this.launch();
        }
      } else if (this.live) {
        this.liveT += dt;
        const sp = Math.hypot(b.vx, b.vz);
        if (b.owner === this.human || (b.lastTouch === this.human && this.liveT > 0.2)) this.resolve("saved");
        else if (this.liveT > 4 || (this.liveT > 1 && sp < 0.6)) this.resolve("miss");
      }
    } else if (this.kind === "dribbling") {
      const c = CONES[this.next];
      const h = this.h;
      if (b.owner === h.idx && Math.hypot(h.x - c.x, h.z - c.z) < 1.8) {
        this.value += 10;
        this.next++;
        s.emit({ k: "cone", v: this.next });
        if (this.next >= CONES.length) {
          this.laps++;
          this.value += 50;
          this.timeLeft += 5;
          this.next = 0;
          s.emit({ k: "lap" });
        }
      }
    }
    if (this.kind === "passing" || this.kind === "dribbling" || this.kind === "free") this.updateSub();
  }

  snap(): DrillSnap {
    return {
      kind: this.kind,
      label: DRILL_INFO[this.kind].title,
      value: this.value,
      sub: this.sub,
      timeLeft: Math.round(this.timeLeft * 10) / 10,
      attempts: this.attempts,
      total: this.total,
      done: this.done,
      cones: this.kind === "dribbling" ? CONES : undefined,
      next: this.kind === "dribbling" ? this.next : undefined,
    };
  }
}

export { dirOf };
