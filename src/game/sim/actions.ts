// Player actions: kicks, passes, shots, headers, tackles, goalkeeper interactions and set pieces.
import { A, DIFF, GRAVITY, PITCH, clamp, dirOf, inPenaltyArea } from "../shared/constants";
import type { Act } from "../shared/types";
import type { MatchSim, PlayerSim } from "./sim";

const R = PITCH.BALL_R;

export interface KickOpts {
  pass?: boolean;
  shot?: boolean;
  setPiece?: boolean;
  power?: boolean;
}

export function kickBall(sim: MatchSim, p: PlayerSim, dx: number, dz: number, speed: number, ang: number, curve: number, kind: string, o: KickOpts = {}) {
  const b = sim.ball;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const vh = speed * Math.cos(ang);
  b.vx = dx * vh;
  b.vz = dz * vh;
  b.vy = speed * Math.sin(ang);
  b.curve = curve;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.lastTeam = p.team;
  b.power = !!o.power;
  if (ang > 0.05) b.y = Math.max(b.y, R + 0.12);
  p.cooldown = 0.4;
  p.actCooldown = 0.22;
  p.facing = Math.atan2(dz, dx);
  if (o.setPiece || sim.drill) sim.offside = null;
  else sim.recordOffside(p);
  if (o.pass) {
    p.stats.passes++;
    sim.lastPass = { from: p.idx, team: p.team, t: sim.time };
  } else sim.lastPass = null;
  if (o.shot) p.stats.shots++;
  sim.emit({ k: "kick", p: p.idx, v: speed, s: kind, x: b.x, y: b.y, z: b.z });
}

export interface PassCand {
  q: PlayerSim;
  score: number;
}

function nearestOppDist(sim: MatchSim, team: number, x: number, z: number) {
  let m = 99;
  for (const o of sim.players) {
    if (o.team === team || !o.active || o.red) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < m) m = d;
  }
  return m;
}

function laneBlocked(sim: MatchSim, p: PlayerSim, tx: number, tz: number) {
  const vx = tx - p.x;
  const vz = tz - p.z;
  const l2 = vx * vx + vz * vz || 1;
  let blocked = 0;
  for (const o of sim.players) {
    if (o.team === p.team || !o.active || o.red) continue;
    const t = clamp(((o.x - p.x) * vx + (o.z - p.z) * vz) / l2, 0, 1);
    const d = Math.hypot(p.x + vx * t - o.x, p.z + vz * t - o.z);
    if (d < 1.8 && t > 0.1) blocked++;
  }
  return blocked;
}

/** Human pass target selection: best aligned, open teammate in the steering direction. */
export function choosePassTarget(sim: MatchSim, p: PlayerSim, dx: number, dz: number, kind: "pass" | "through" | "long"): PlayerSim | null {
  let best: PlayerSim | null = null;
  let bs = -99;
  const d = dirOf(p.team);
  const dl = Math.hypot(dx, dz) || 1;
  for (const q of sim.players) {
    if (q.team !== p.team || q.idx === p.idx || !q.active || q.red) continue;
    const vx = q.x - p.x;
    const vz = q.z - p.z;
    const dist = Math.hypot(vx, vz);
    if (dist < 3 || dist > (kind === "long" ? 60 : 42)) continue;
    const cosA = (vx * dx + vz * dz) / (dist * dl);
    if (cosA < 0.5) continue;
    let s = cosA * 2 - dist / 45 + Math.min(nearestOppDist(sim, p.team, q.x, q.z), 8) / 16;
    if (kind === "through") s += (d * (q.x - p.x)) / 40;
    if (q.human) s += 0.15;
    if (p.callFor === q.idx) s += 1.2;
    if (q.role === "GK" && p.role !== "GK") s -= 0.6;
    s -= laneBlocked(sim, p, q.x, q.z) * 0.5;
    if (s > bs) {
      bs = s;
      best = q;
    }
  }
  return best;
}

/** AI pass evaluation: forward progress, openness, lane safety. */
export function bestPassAI(sim: MatchSim, p: PlayerSim): PassCand | null {
  const d = dirOf(p.team);
  let best: PassCand | null = null;
  for (const q of sim.players) {
    if (q.team !== p.team || q.idx === p.idx || !q.active || q.red) continue;
    const dist = Math.hypot(q.x - p.x, q.z - p.z);
    if (dist < 5 || dist > 40) continue;
    const gain = (d * (q.x - p.x)) / 25;
    const open = Math.min(nearestOppDist(sim, p.team, q.x, q.z), 10) / 10;
    let s = 0.55 * gain + 0.7 * open + 0.15 * (1 - dist / 40) - laneBlocked(sim, p, q.x, q.z) * 0.9;
    if (q.role === "GK" && p.role !== "GK") s -= 0.5;
    if (p.callFor === q.idx) s += 0.6;
    if (!best || s > best.score) best = { q, score: s };
  }
  return best;
}

export type PassKind = "pass" | "through" | "long" | "cross" | "throw" | "clear";

export function kickPass(sim: MatchSim, p: PlayerSim, q: PlayerSim | null, kind: PassKind, dx: number, dz: number, power: number, skill = 1, setPiece = false) {
  const b = sim.ball;
  const d = dirOf(p.team);
  let tx: number;
  let tz: number;
  if (q) {
    const lead = kind === "through" ? 0.9 : 0.3;
    tx = q.x + q.vx * lead + (kind === "through" ? d * 4 : 0);
    tz = q.z + q.vz * lead;
  } else if (kind === "cross") {
    tx = d * (PITCH.HL - 9);
    tz = -Math.sign(p.z || 1) * 4;
  } else {
    const l = Math.hypot(dx, dz) || 1;
    const range = kind === "long" || kind === "clear" ? 22 : kind === "through" ? 18 : 12;
    const r = range * (0.6 + 0.8 * power);
    tx = b.x + (dx / l) * r;
    tz = b.z + (dz / l) * r;
  }
  tx = clamp(tx, -PITCH.HL + 1, PITCH.HL - 1);
  tz = clamp(tz, -PITCH.HW + 1, PITCH.HW - 1);
  const ex = tx - b.x;
  const ez = tz - b.z;
  const dist = Math.max(1, Math.hypot(ex, ez));
  const err = (1 - skill) * 0.2 + 0.012;
  const a0 = Math.atan2(ez, ex) + (sim.rng() + sim.rng() - 1) * err;
  let speed: number;
  let ang = 0.03;
  let code: number = A.PASS;
  switch (kind) {
    case "long":
    case "cross":
    case "clear": {
      ang = kind === "cross" ? 0.56 : kind === "clear" ? 0.62 : 0.7;
      speed = clamp(Math.sqrt((dist * GRAVITY) / Math.sin(2 * ang)) * 1.06, 9, 31);
      code = kind === "cross" ? A.CROSS : A.LONG;
      break;
    }
    case "throw": {
      ang = 0.5;
      speed = clamp(Math.sqrt((dist * GRAVITY) / Math.sin(2 * ang)) * 1.05, 6, 15);
      break;
    }
    default: {
      speed = clamp(5.5 + dist * 1.05, 7, 26);
      speed *= q ? 0.9 + 0.2 * power : 0.8 + 0.4 * power;
      if (kind === "through") code = A.THROUGH;
    }
  }
  kickBall(sim, p, Math.cos(a0), Math.sin(a0), speed, ang, 0, kind, { pass: true, setPiece });
  sim.setAction(p, p.role === "GK" ? A.GKKICK : code, 0.45);
}

export function shootAt(sim: MatchSim, p: PlayerSim, tx: number, tz: number, power: number, skill: number, curve = 0, setPiece = false) {
  const b = sim.ball;
  const dist = Math.hypot(tx - b.x, tz - b.z);
  const speed = 17 + 15 * power;
  const ang = 0.05 + power * 0.06 + (dist > 24 ? 0.06 : 0);
  const err = (1 - skill) * 0.2 * (0.4 + power) + 0.008;
  const a0 = Math.atan2(tz - b.z, tx - b.x) + (sim.rng() + sim.rng() - 1) * err;
  const vol = b.y > 0.45;
  kickBall(sim, p, Math.cos(a0), Math.sin(a0), speed, ang, curve, "shoot", { shot: true, setPiece, power: power > 0.85 });
  sim.setAction(p, vol ? A.VOLLEY : A.SHOOT, 0.5);
}

export function goalAimPoint(sim: MatchSim, p: PlayerSim, bias = 0) {
  const d = dirOf(p.team);
  const gk = sim.players.find((o) => o.team !== p.team && o.role === "GK" && o.active && !o.red);
  const side = gk ? (gk.z > 0 ? -1 : 1) : sim.rng() < 0.5 ? -1 : 1;
  return { x: d * PITCH.HL, z: side * (PITCH.GOAL_W / 2 - 0.7) * (0.8 + 0.2 * (bias || sim.rng())) };
}

function humanShoot(sim: MatchSim, p: PlayerSim, dx: number, dz: number, power: number) {
  const b = sim.ball;
  const d = dirOf(p.team);
  const gx = d * PITCH.HL;
  const tg = Math.hypot(gx - b.x, -b.z) || 1;
  const cosG = (dx * (gx - b.x) + dz * -b.z) / tg;
  const lat = dx * p.vz - dz * p.vx;
  const curve = clamp(lat * 0.08, -0.45, 0.45);
  const pw = clamp(0.5 + power * 0.5, 0.5, 1);
  if (cosG > 0.82 && tg < 42) {
    const g = goalAimPoint(sim, p);
    shootAt(sim, p, g.x, g.z, pw, 0.9, curve);
  } else {
    shootAt(sim, p, b.x + dx * 30, b.z + dz * 30, pw, 0.9, curve);
  }
}

function jump(p: PlayerSim, sim: MatchSim) {
  if (p.y > 0.05) return;
  p.vy = 3.6;
  sim.setAction(p, A.JUMP, 0.7);
}

function tryHeader(sim: MatchSim, p: PlayerSim, power: number, dx: number, dz: number): boolean {
  const b = sim.ball;
  const dh = Math.hypot(b.x - p.x, b.z - p.z);
  if (dh < 1.4 && b.y > 0.9 && b.y < 2.8 && b.owner < 0) {
    if (!sim.touchReceive(p)) return true;
    p.actCooldown = 0.4;
    sim.setAction(p, A.HEADER, 0.6);
    if (p.y < 0.05) p.vy = 2.6;
    const d = dirOf(p.team);
    const gdist = Math.hypot(d * PITCH.HL - b.x, b.z);
    if (gdist < 18 && d * dx > 0.2) {
      const g = goalAimPoint(sim, p);
      const l = Math.hypot(g.x - b.x, g.z - b.z) || 1;
      kickBall(sim, p, (g.x - b.x) / l, (g.z - b.z) / l, 14 + power * 6, -0.08, 0, "header", { shot: true });
    } else {
      kickBall(sim, p, dx, dz, 9 + power * 8, 0.45, 0, "header", { pass: true });
    }
    return true;
  }
  return false;
}

export function checkPending(sim: MatchSim, p: PlayerSim) {
  if (!p.pending) return;
  if (tryHeader(sim, p, p.pending.power, Math.cos(p.facing), Math.sin(p.facing))) p.pending = null;
}

function winBall(sim: MatchSim, p: PlayerSim, owner: PlayerSim, slide: boolean) {
  const b = sim.ball;
  b.owner = -1;
  const sp = slide ? 7 : 4.5;
  b.vx = Math.cos(p.facing) * sp + (sim.rng() - 0.5) * 2;
  b.vz = Math.sin(p.facing) * sp + (sim.rng() - 0.5) * 2;
  b.vy = 1.2;
  b.curve = 0;
  b.lastTouch = p.idx;
  b.lastTeam = p.team;
  sim.lastPass = null;
  sim.offside = null;
  p.stats.tackles++;
  owner.cooldown = 0.7;
  if (slide || sim.rng() < 0.25) {
    owner.down = 0.8;
    sim.setAction(owner, A.FALL, 0.8);
  }
  sim.emit({ k: "tackle", p: p.idx, q: owner.idx, x: b.x, z: b.z });
}

function behindFactor(owner: PlayerSim, t: PlayerSim) {
  const vx = t.x - owner.x;
  const vz = t.z - owner.z;
  const l = Math.hypot(vx, vz) || 1;
  return (vx * Math.cos(owner.facing) + vz * Math.sin(owner.facing)) / l; // <0 => tackler behind
}

function tackle(sim: MatchSim, p: PlayerSim) {
  const owner = sim.ownerPlayer();
  const speed = Math.hypot(p.vx, p.vz);
  if (p.role === "GK" && (!owner || owner.team === p.team)) {
    const b = sim.ball;
    let dx = p.wz !== 0 || p.wx !== 0 ? p.wx : 0;
    let dz = p.wz !== 0 || p.wx !== 0 ? p.wz : Math.sign(b.z - p.z || 1);
    if (Math.hypot(dx, dz) < 0.1) dz = Math.sign(b.z - p.z || 1);
    gkDive(sim, p, dx, dz);
    dx = 0;
    return;
  }
  const dcheck = DIFF[sim.cfg.difficulty].tackle;
  if (p.sprinting && speed > 5.8) {
    p.lunge = { dx: Math.cos(p.facing), dz: Math.sin(p.facing), t: 0.55, speed: 9.5 };
    sim.setAction(p, A.SLIDE, 0.95);
    p.actCooldown = 1.3;
    p.down = 0.95;
    sim.emit({ k: "slide", p: p.idx });
    return;
  }
  sim.setAction(p, A.TACKLE, 0.4);
  p.actCooldown = 0.7;
  if (owner && owner.team !== p.team) {
    const d = Math.hypot(owner.x - p.x, owner.z - p.z);
    const dot = ((owner.x - p.x) * Math.cos(p.facing) + (owner.z - p.z) * Math.sin(p.facing)) / (d || 1);
    if (d < 1.8 && dot > 0.15) {
      if (owner.role === "GK" && inPenaltyArea(owner.team, owner.x, owner.z)) return;
      const chance = p.human ? 0.62 : dcheck + 0.12;
      if (sim.rng() < chance) winBall(sim, p, owner, false);
      else {
        const fc = behindFactor(owner, p) < -0.3 ? 0.5 : 0.12;
        if (sim.rng() < fc) sim.awardFoul(p, owner, 0.35 + sim.rng() * 0.3);
      }
    }
  }
}

/** Evaluates the contact of an active slide tackle. */
export function resolveSlide(sim: MatchSim, p: PlayerSim) {
  const l = p.lunge;
  if (!l || l.hit || p.action !== A.SLIDE) return;
  const b = sim.ball;
  const owner = sim.ownerPlayer();
  const chance = p.human ? 0.55 : DIFF[sim.cfg.difficulty].tackle + 0.12;
  if (owner && owner.team !== p.team && Math.hypot(owner.x - p.x, owner.z - p.z) < 1.4) {
    l.hit = true;
    if (owner.role === "GK" && inPenaltyArea(owner.team, owner.x, owner.z)) return;
    if (sim.rng() < chance) winBall(sim, p, owner, true);
    else {
      owner.down = 0.8;
      sim.setAction(owner, A.FALL, 0.8);
      sim.awardFoul(p, owner, behindFactor(owner, p) < -0.3 ? 0.95 : 0.65);
    }
    return;
  }
  if (!owner && Math.hypot(b.x - p.x, b.z - p.z) < 1.2 && b.y < 0.8) {
    l.hit = true;
    if (!sim.touchReceive(p)) return;
    b.vx = Math.cos(p.facing) * 8;
    b.vz = Math.sin(p.facing) * 8;
    b.vy = 0.8;
    b.lastTouch = p.idx;
    b.lastTeam = p.team;
    sim.emit({ k: "tackle", p: p.idx, q: -1, x: b.x, z: b.z });
    return;
  }
  for (const q of sim.players) {
    if (q.team === p.team || !q.active || q.red || q.down > 0 || q.idx === b.owner) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) < 0.9) {
      l.hit = true;
      if (sim.rng() < 0.55) {
        q.down = 0.8;
        sim.setAction(q, A.FALL, 0.8);
        sim.awardFoul(p, q, 0.55 + sim.rng() * 0.4);
      }
      return;
    }
  }
}

export function gkDive(sim: MatchSim, p: PlayerSim, dx: number, dz: number) {
  if (p.actCooldown > 0 || p.down > 0) return;
  const l = Math.hypot(dx, dz) || 1;
  p.lunge = { dx: dx / l, dz: dz / l, t: 0.55, speed: 6.2 };
  p.diving = true;
  p.vy = 2.4;
  sim.setAction(p, A.DIVE, 0.9);
  p.actCooldown = 1.1;
  sim.emit({ k: "dive", p: p.idx });
}

function support(sim: MatchSim, p: PlayerSim) {
  if (p.actCooldown > 0) return;
  p.actCooldown = 0.5;
  const d = dirOf(p.team);
  const owner = sim.ownerPlayer();
  if (owner && owner.team === p.team && owner.idx !== p.idx) {
    // ask the ball carrier (if AI) to pass to me
    if (!owner.human) {
      owner.callFor = p.idx;
      owner.callT = 3;
      owner.aiT = 0;
    }
  } else {
    // send the nearest AI teammate on a supporting run ahead
    let best: PlayerSim | null = null;
    let bd = 99;
    for (const q of sim.players) {
      if (q.team !== p.team || q.human || !q.active || q.red || q.role === "GK") continue;
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist < bd) {
        bd = dist;
        best = q;
      }
    }
    if (best) {
      best.supportT = 4;
      best.supportX = clamp(p.x + d * 14, -PITCH.HL + 4, PITCH.HL - 4);
      best.supportZ = clamp(-Math.sign(p.z || 1) * 12, -PITCH.HW + 4, PITCH.HW - 4);
    }
  }
  sim.emit({ k: "support", p: p.idx });
}

export function doAct(sim: MatchSim, p: PlayerSim, act: Act) {
  if (p.down > 0 || p.red || p.lunge) return;
  if (act.type === "support") return support(sim, p);
  if (!sim.canPlay) return;
  if (p.actCooldown > 0) return;
  const b = sim.ball;
  const im = Math.hypot(p.wx, p.wz);
  const dx = im > 0.3 ? p.wx / im : Math.cos(p.facing);
  const dz = im > 0.3 ? p.wz / im : Math.sin(p.facing);
  if (sim.phase === "restart") {
    const sp = sim.setPiece;
    if (sp && sp.taker === p.idx && act.type !== "jump") executeSetPiece(sim, p, act, dx, dz);
    return;
  }
  if (act.type === "tackle") return tackle(sim, p);
  if (act.type === "jump") {
    if (p.role === "GK" && b.owner !== p.idx) return gkDive(sim, p, im > 0.2 ? p.wx : 0, im > 0.2 ? p.wz : Math.sign(b.z - p.z || 1));
    jump(p, sim);
    return;
  }
  const hasBall = b.owner === p.idx;
  const dBall = Math.hypot(b.x - p.x, b.z - p.z);
  const nearLoose = b.owner < 0 && dBall < 1.7 && b.y < 0.9;
  const airNear = b.owner < 0 && dBall < 3 && b.y >= 0.9 && b.y < 3;
  if (hasBall || nearLoose) {
    const power = act.power;
    if (p.role === "GK" && hasBall) {
      const q = choosePassTarget(sim, p, dx, dz, "pass");
      if (act.type === "pass" || act.type === "through") kickPass(sim, p, q, "pass", dx, dz, power);
      else kickPass(sim, p, choosePassTarget(sim, p, dx, dz, "long"), "long", dx, dz, power);
      return;
    }
    if (nearLoose && !sim.touchReceive(p)) return;
    switch (act.type) {
      case "pass":
        kickPass(sim, p, choosePassTarget(sim, p, dx, dz, "pass"), "pass", dx, dz, power);
        break;
      case "through":
        kickPass(sim, p, choosePassTarget(sim, p, dx, dz, "through"), "through", dx, dz, power);
        break;
      case "cross": {
        const d = dirOf(p.team);
        if (d * p.x > 26 && Math.abs(p.z) > 15) kickPass(sim, p, null, "cross", dx, dz, power, 0.9);
        else kickPass(sim, p, choosePassTarget(sim, p, dx, dz, "long"), "long", dx, dz, power, 0.95);
        break;
      }
      case "shoot":
        humanShoot(sim, p, dx, dz, power);
        break;
    }
    return;
  }
  if (airNear && (act.type === "shoot" || act.type === "cross")) {
    if (!tryHeader(sim, p, act.power, dx, dz)) {
      p.pending = { kind: "header", t: 0.5, power: act.power };
      jump(p, sim);
    }
    return;
  }
  p.actCooldown = 0.12;
}

export function gkInteract(sim: MatchSim) {
  const b = sim.ball;
  if (b.owner >= 0 || sim.phase !== "playing") return;
  for (const gk of sim.players) {
    if (gk.role !== "GK" || !gk.active || gk.red || gk.cooldown > 0 || gk.down > 0) continue;
    const dh = Math.hypot(b.x - gk.x, b.z - gk.z);
    const reachH = gk.diving ? 2.4 : 1.25;
    const reachY = gk.diving ? 2.3 : 2.2;
    if (dh > reachH || b.y > reachY) continue;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const sx = -dirOf(gk.team);
    const own = b.lastTeam === gk.team;
    if (sp <= 8 || own) {
      if (b.y > 1.0 || dh >= 1.0) {
        if (!sim.touchReceive(gk)) return;
        b.owner = gk.idx;
        gk.holdT = 0;
        sim.setAction(gk, A.CATCH, 0.6);
      }
      continue;
    }
    if (b.vx * sx < 1) continue; // not heading toward this goal
    const skill = gk.human ? 0.66 : DIFF[sim.cfg.difficulty].save;
    const chance = clamp(skill * (1.28 - sp / 36), 0.15, 0.95) * (gk.diving ? 1 : 0.92);
    gk.cooldown = 0.5;
    if (sim.rng() < chance) {
      sim.touchReceive(gk);
      gk.stats.saves++;
      if (sp < 19 && sim.rng() < 0.7) {
        b.owner = gk.idx;
        gk.holdT = 0;
        b.vx = b.vy = b.vz = 0;
        sim.setAction(gk, A.CATCH, 0.7);
        sim.emit({ k: "save", p: gk.idx, s: "catch", x: b.x, y: b.y, z: b.z });
      } else {
        b.vx = -sx * (3 + sim.rng() * 3);
        b.vz = (b.z - gk.z >= 0 ? 1 : -1) * (3 + sim.rng() * 4);
        b.vy = 2 + sim.rng() * 2;
        b.curve = 0;
        b.lastTouch = gk.idx;
        b.lastTeam = gk.team;
        sim.emit({ k: "save", p: gk.idx, s: "parry", x: b.x, y: b.y, z: b.z });
      }
    }
  }
}

/** Executes the pending set piece with `taker`. `act` null => AI/automatic delivery. */
export function executeSetPiece(sim: MatchSim, taker: PlayerSim, act: Act | null, hdx?: number, hdz?: number) {
  const sp = sim.setPiece;
  if (!sp || sp.taker !== taker.idx) return;
  const b = sim.ball;
  if (Math.hypot(b.x - taker.x, b.z - taker.z) > 2.5) {
    taker.x = b.x - Math.cos(taker.facing) * 0.95;
    taker.z = b.z - Math.sin(taker.facing) * 0.95;
  }
  const human = !!act && taker.human;
  const skill = human ? 0.9 : DIFF[sim.cfg.difficulty].acc;
  const power = act ? act.power : 0.5;
  const d = dirOf(taker.team);
  sim.phase = "playing";
  sim.setPiece = null;
  const kind = sp.kind;
  let dx = hdx ?? Math.cos(taker.facing);
  let dz = hdz ?? Math.sin(taker.facing);
  if (human && Math.hypot(taker.wx, taker.wz) < 0.3) {
    dx = Math.cos(taker.facing);
    dz = Math.sin(taker.facing);
  }
  const pickQ = (k: "pass" | "through" | "long") => (human ? choosePassTarget(sim, taker, dx, dz, k) : bestPassAI(sim, taker)?.q ?? null);
  switch (kind) {
    case "kickoff": {
      const q = human ? choosePassTarget(sim, taker, dx, dz, "pass") : sim.players.find((o) => o.team === taker.team && o.role === "CML" && o.active) ?? null;
      kickPass(sim, taker, q, "pass", dx, dz, 0.4, 1, true);
      break;
    }
    case "throwin":
      kickPass(sim, taker, pickQ("pass"), "throw", dx, dz, power, skill, true);
      break;
    case "goalkick":
      kickPass(sim, taker, pickQ("long"), "long", dx, dz, power, skill, true);
      break;
    case "corner":
      kickPass(sim, taker, null, "cross", dx, dz, power, skill, true);
      break;
    case "freekick": {
      const dist = Math.hypot(d * PITCH.HL - b.x, b.z);
      const shoot = human ? act!.type === "shoot" : dist < 28 && sim.rng() < 0.55;
      if (shoot) {
        const g = goalAimPoint(sim, taker);
        shootAt(sim, taker, g.x, g.z, human ? clamp(0.4 + act!.power * 0.6, 0.4, 1) : 0.75, skill, (sim.rng() - 0.5) * 0.5, true);
      } else kickPass(sim, taker, pickQ("pass"), act?.type === "cross" ? "long" : "pass", dx, dz, power, skill, true);
      break;
    }
    case "penalty": {
      const g = goalAimPoint(sim, taker);
      shootAt(sim, taker, g.x, g.z, human ? clamp(0.5 + act!.power * 0.5, 0.5, 1) : 0.75, human ? 0.9 : skill, 0, true);
      break;
    }
  }
  taker.cooldown = 1.0;
}
