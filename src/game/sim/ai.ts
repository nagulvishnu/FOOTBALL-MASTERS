// Role-aware football AI. AI only uses information a human could see (positions & ball), obeys the same
// movement limits as humans (shared stepMovement) and never teleports.
import { A, DIFF, FORMATION, PITCH, clamp, dirOf, localToWorld } from "../shared/constants";
import { MOVE } from "../shared/movement";
import type { Tactic } from "../shared/types";
import { bestPassAI, doAct, gkDive, goalAimPoint, kickPass, shootAt } from "./actions";
import { predictBall } from "./ballPhysics";
import type { MatchSim, PlayerSim } from "./sim";

type DiffParams = (typeof DIFF)[keyof typeof DIFF];

function seek(p: PlayerSim, tx: number, tz: number, sprint: boolean, frac = 1) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) return;
  const k = Math.min(1, dist / 2.5) * frac;
  p.wx = (dx / dist) * k;
  p.wz = (dz / dist) * k;
  p.sprintWish = sprint && p.stamina > 12;
}

function nearestOpp(sim: MatchSim, p: PlayerSim) {
  let best: PlayerSim | null = null;
  let bd = 99;
  for (const o of sim.players) {
    if (o.team === p.team || !o.active || o.red) continue;
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return { o: best, d: bd };
}

function intercept(sim: MatchSim, p: PlayerSim) {
  const b = sim.ball;
  const sp = Math.hypot(b.vx, b.vz);
  if (sp < 1.5) return { x: b.x, z: b.z };
  const speed = MOVE.sprint * sim.speedMul(p);
  for (let t = 0.2; t <= 2.4; t += 0.2) {
    const pos = predictBall(b, t);
    if (Math.hypot(pos.x - p.x, pos.z - p.z) / speed <= t) return pos;
  }
  return predictBall(b, 2.4);
}

const LINE: Record<Tactic, { att: number; def: number }> = {
  balanced: { att: 0, def: 0 },
  attacking: { att: 7, def: 5 },
  defensive: { att: -6, def: -8 },
  pressing: { att: 3, def: 4 },
  counter: { att: 10, def: -6 },
};

function anchorOf(sim: MatchSim, p: PlayerSim) {
  if (p.supportT > 0) return { x: p.supportX, z: p.supportZ };
  const f = FORMATION[p.role];
  const d = dirOf(p.team);
  const b = sim.ball;
  const owner = sim.ownerPlayer();
  const att = owner ? owner.team === p.team : b.lastTeam === p.team;
  const tac = LINE[sim.tactic[p.team]];
  const isFwd = p.role === "LW" || p.role === "RW";
  const isMid = p.role === "CML" || p.role === "CMR";
  const ballU = d * b.x;
  let u = f.u + ballU * 0.45 + (att ? tac.att : tac.def) + (att ? (isFwd ? 9 : isMid ? 5 : 2) : isFwd ? -2 : -4);
  const lim = isFwd ? [-12, 47] : isMid ? [-30, 32] : [-47, 10];
  if (att && isFwd) {
    const opp = sim.players.filter((o) => o.team !== p.team && o.active && !o.red).map((o) => d * o.x).sort((a, c) => c - a);
    lim[1] = Math.min(lim[1], Math.max(0, opp[1] ?? 47) - 0.8);
  }
  u = clamp(u, lim[0], Math.max(lim[0], lim[1]));
  const ballV = d * b.z;
  let v = f.v * (att ? 1.2 : 0.8) + (ballV - f.v) * 0.18;
  if (p.role !== "LB" && p.role !== "RB") v += Math.sin(sim.time * 0.5 + p.idx * 1.9) * 3;
  v = clamp(v, -PITCH.HW + 3, PITCH.HW - 3);
  let w = localToWorld(p.team, u, v);
  // marking when defending
  if (!att && p.role !== "LW" && p.role !== "RW") {
    let mark: PlayerSim | null = null;
    let md = 99;
    for (const o of sim.players) {
      if (o.team === p.team || !o.active || o.red || o.role === "GK") continue;
      const dd = Math.hypot(o.x - w.x, o.z - w.z);
      if (dd < md) {
        md = dd;
        mark = o;
      }
    }
    if (mark && md < (isMid ? 11 : 15)) {
      const k = isMid ? 0.45 : 0.65;
      w = { x: w.x * (1 - k) + (mark.x - d * 2) * k, z: w.z * (1 - k) + mark.z * 0.95 * k };
    }
  }
  return w;
}

function goalkeeper(sim: MatchSim, p: PlayerSim, dt: number, d: DiffParams) {
  const b = sim.ball;
  const sx = -dirOf(p.team);
  const gx = sx * PITCH.HL;
  const inward = -sx;
  if (b.owner === p.idx) {
    p.holdT += dt;
    if (sim.phase === "playing" && p.holdT > 1.3 + sim.rng() * 1.2) {
      const best = bestPassAI(sim, p);
      const q = best?.q ?? null;
      const far = q ? Math.hypot(q.x - p.x, q.z - p.z) > 22 : true;
      kickPass(sim, p, q, far ? "long" : "pass", inward, 0, 0.6, d.acc);
    }
    return;
  }
  if (sim.phase === "restart" && sim.setPiece?.taker === p.idx) return;
  const threatened = b.vx * sx > 2 && b.lastTeam !== p.team && sim.phase === "playing";
  if (threatened) {
    const t = (gx - b.x) / b.vx;
    if (t > 0 && t < 1.7) {
      const zp = b.z + b.vz * t;
      const yp = b.y + b.vy * t - 4.9 * t * t;
      if (Math.abs(zp) < PITCH.GOAL_W / 2 + 1.8 && yp < 2.8 && yp > -0.4) {
        const tz = clamp(zp, -4.2, 4.2);
        seek(p, gx + inward * 0.7, tz, true);
        const lat = tz - p.z;
        if (t < 0.55 && Math.abs(lat) > 1.1 && p.actCooldown <= 0 && sim.rng() < d.save + 0.25) gkDive(sim, p, 0, Math.sign(lat));
        return;
      }
    }
  }
  const dBall = Math.hypot(b.x - gx, b.z);
  const inBox = Math.abs(b.x) > PITCH.HL - PITCH.PEN_D && Math.abs(b.z) < PITCH.PEN_W / 2;
  const sp = Math.hypot(b.vx, b.vz);
  if (sim.phase === "playing" && b.owner < 0 && inBox && sp < 7 && Math.hypot(b.x - p.x, b.z - p.z) < 12) {
    const mate = sim.players.some((o) => o.team === p.team && o.idx !== p.idx && o.active && !o.red && Math.hypot(o.x - b.x, o.z - b.z) < Math.hypot(p.x - b.x, p.z - b.z) - 1);
    if (!mate) {
      seek(p, b.x, b.z, true);
      return;
    }
  }
  const off = clamp(dBall * 0.12, 1.2, 5.5);
  seek(p, gx + inward * off, clamp(b.z * 0.25, -3.3, 3.3), false, 0.9);
}

function carrier(sim: MatchSim, p: PlayerSim, dt: number, d: DiffParams) {
  const dir = dirOf(p.team);
  const b = sim.ball;
  const gx = dir * PITCH.HL;
  p.aiT -= dt;
  if (p.aiT <= 0) {
    p.aiT = d.react * (0.5 + sim.rng() * 0.9);
    const goalDist = Math.hypot(gx - p.x, p.z);
    const opp = nearestOpp(sim, p);
    if (goalDist < 23 && sim.rng() < d.shoot + (goalDist < 14 ? 0.3 : 0)) {
      const g = goalAimPoint(sim, p);
      shootAt(sim, p, g.x, g.z, 0.6 + sim.rng() * 0.4, d.acc);
      return;
    }
    const pass = bestPassAI(sim, p);
    const pressured = opp.d < 4.5;
    if (pass && (pass.score > 0.5 || (pressured && pass.score > 0.1) || p.callFor >= 0) && (pressured || p.callFor >= 0 || sim.rng() < 0.45)) {
      const dist = Math.hypot(pass.q.x - p.x, pass.q.z - p.z);
      const fwd = dir * (pass.q.x - p.x) > 10 && Math.hypot(pass.q.vx, pass.q.vz) > 3;
      const kind = dist > 26 ? "long" : fwd && sim.rng() < 0.35 ? "through" : "pass";
      kickPass(sim, p, pass.q, kind, 0, 0, 0.5, d.acc);
      p.callFor = -1;
      return;
    }
    // dribble toward goal, bending around the nearest opponent
    let ax = gx - p.x;
    let az = -p.z * 0.6;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    if (opp.o && opp.d < 6) {
      const ox = opp.o.x - p.x;
      const oz = opp.o.z - p.z;
      if (ox * ax + oz * az > 0) {
        const side = ax * oz - az * ox > 0 ? -1 : 1;
        const c = Math.cos(0.7 * side);
        const s = Math.sin(0.7 * side);
        const nx = ax * c - az * s;
        const nz = ax * s + az * c;
        ax = nx;
        az = nz;
      }
    }
    if (Math.abs(p.z) > PITCH.HW - 3 && az * p.z > 0) az = -az;
    p.aiDirX = ax;
    p.aiDirZ = az;
  }
  if (p.aiDirX === 0 && p.aiDirZ === 0) {
    p.aiDirX = dir;
  }
  p.wx = p.aiDirX;
  p.wz = p.aiDirZ;
  p.sprintWish = nearestOpp(sim, p).d > 7 && p.stamina > 30;
  void b;
}

export function aiUpdate(sim: MatchSim, p: PlayerSim, dt: number) {
  p.wx = 0;
  p.wz = 0;
  p.sprintWish = false;
  if (p.down > 0 || p.red || sim.phase === "finished") return;
  const d = DIFF[sim.cfg.difficulty];
  if (p.role === "GK") return goalkeeper(sim, p, dt, d);
  if (p.action === A.CELEB) return;
  if (sim.phase === "restart" && sim.setPiece?.taker === p.idx) return;
  const b = sim.ball;
  if (sim.phase !== "playing" && sim.phase !== "restart") {
    const a = anchorOf(sim, p);
    seek(p, a.x, a.z, false, 0.6);
    return;
  }
  if (b.owner === p.idx) return carrier(sim, p, dt, d);

  const owner = sim.ownerPlayer();
  const oppHas = !!owner && owner.team !== p.team;
  const ballFree = !owner;
  const isChaser = sim.chase[p.team].includes(p.idx);
  const defender = p.role === "LB" || p.role === "RB";
  const dist = Math.hypot(b.x - p.x, b.z - p.z);
  if (sim.phase === "playing" && (ballFree || oppHas) && isChaser && p.supportT <= 0) {
    const ballU = dirOf(p.team) * b.x;
    if ((!defender || ballU < 15 || dist < 12) && dist < 42) {
      const tgt = ballFree ? intercept(sim, p) : { x: owner!.x + owner!.vx * 0.3, z: owner!.z + owner!.vz * 0.3 };
      seek(p, tgt.x, tgt.z, true);
      if (oppHas && dist < 1.7 && p.actCooldown <= 0 && sim.rng() < d.tackle * dt * 5) {
        p.facing = Math.atan2(owner!.z - p.z, owner!.x - p.x);
        doAct(sim, p, { n: 0, type: "tackle", power: 0.5 });
      } else if (ballFree && dist < 3 && b.y > 1 && b.y < 2.8 && p.actCooldown <= 0 && sim.rng() < 0.3) {
        doAct(sim, p, { n: 0, type: "shoot", power: 0.6 });
      }
      return;
    }
  }
  const a = anchorOf(sim, p);
  const far = Math.hypot(a.x - p.x, a.z - p.z);
  seek(p, a.x, a.z, far > 9 || p.supportT > 0);
}
