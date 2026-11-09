import { GRAVITY, PITCH } from "../shared/constants";
import type { GameEvent } from "../shared/types";

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  curve: number; // Magnus-style lateral bend (rad-ish per metre travelled); decays in flight
  owner: number; // player idx or -1
  lastTouch: number;
  lastTeam: number; // -1 none
  power: boolean; // flagged for visual trail
}

export const newBall = (): Ball => ({ x: 0, y: PITCH.BALL_R, z: 0, vx: 0, vy: 0, vz: 0, curve: 0, owner: -1, lastTouch: -1, lastTeam: -1, power: false });

type Emit = (e: GameEvent) => void;
const R = PITCH.BALL_R;

/** One physics step for a free (unowned) ball: gravity, drag, spin, ground, posts, crossbar, nets. */
export function stepBall(b: Ball, dt: number, emit: Emit, netsActive = true) {
  const airborne = b.y > R + 0.03 || b.vy > 0.1;
  if (airborne) {
    b.vy -= GRAVITY * dt;
    if (b.curve !== 0) {
      // Magnus effect: lateral acceleration perpendicular to horizontal velocity
      b.vx += -b.vz * b.curve * dt * 2.2;
      b.vz += b.vx * b.curve * dt * 2.2;
      b.curve *= Math.max(0, 1 - 0.35 * dt);
    }
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const drag = Math.max(0, 1 - 0.012 * sp * dt);
    b.vx *= drag;
    b.vy *= drag;
    b.vz *= drag;
  } else {
    // rolling friction
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - (1.25 + 0.012 * sp * sp) * dt);
      const k = ns / sp;
      b.vx *= k;
      b.vz *= k;
      if (ns < 0.05) {
        b.vx = 0;
        b.vz = 0;
      }
    }
    b.curve = 0;
    b.power = false;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  if (b.y < R) {
    b.y = R;
    if (b.vy < -1.1) {
      emit({ k: "bounce", x: b.x, z: b.z, v: -b.vy });
      b.vy = -b.vy * 0.62;
      b.vx *= 0.93;
      b.vz *= 0.93;
      b.curve *= 0.4;
    } else b.vy = 0;
  }
  if (!netsActive) return;
  collideGoalFrame(b, emit);
}

function collideGoalFrame(b: Ball, emit: Emit) {
  const hw = PITCH.GOAL_W / 2;
  const pr = PITCH.POST_R + R;
  for (const sx of [-1, 1]) {
    const gx = sx * PITCH.HL;
    if (Math.abs(b.x - gx) > 3.5 || Math.abs(b.z) > hw + 3) continue;
    // posts
    for (const sz of [-1, 1]) {
      const px = gx;
      const pz = sz * hw;
      const dx = b.x - px;
      const dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < pr && b.y < PITCH.GOAL_H + 0.1 && d > 1e-4) {
        const nx = dx / d;
        const nz = dz / d;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= 1.55 * vn * nx;
          b.vz -= 1.55 * vn * nz;
          emit({ k: "post", x: b.x, y: b.y, z: b.z, v: -vn });
        }
        b.x = px + nx * pr;
        b.z = pz + nz * pr;
      }
    }
    // crossbar (cylinder along z at x=gx, y=GOAL_H)
    if (Math.abs(b.z) <= hw + R) {
      const dx = b.x - gx;
      const dy = b.y - PITCH.GOAL_H;
      const d = Math.hypot(dx, dy);
      if (d < pr && d > 1e-4) {
        const nx = dx / d;
        const ny = dy / d;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= 1.55 * vn * nx;
          b.vy -= 1.55 * vn * ny;
          emit({ k: "post", x: b.x, y: b.y, z: b.z, v: -vn });
        }
        b.x = gx + nx * pr;
        b.y = PITCH.GOAL_H + ny * pr;
      }
    }
    // net volume behind the goal line
    const depth = (b.x - gx) * sx;
    if (depth > 0 && depth < PITCH.GOAL_D + 1 && Math.abs(b.z) < hw + 0.05 && b.y < PITCH.GOAL_H + 0.05) {
      if (depth > PITCH.GOAL_D - R) {
        b.x = gx + sx * (PITCH.GOAL_D - R);
        const v = b.vx * sx;
        if (v > 0) {
          if (v > 2.5) emit({ k: "net", x: b.x, y: b.y, z: b.z, v });
          b.vx = -b.vx * 0.12;
          b.vz *= 0.5;
          b.vy *= 0.5;
        }
      }
      if (Math.abs(b.z) > hw - R) {
        b.z = Math.sign(b.z) * (hw - R);
        if (Math.abs(b.vz) > 2.5) emit({ k: "net", x: b.x, y: b.y, z: b.z, v: Math.abs(b.vz) });
        b.vz = -b.vz * 0.15;
        b.vx *= 0.6;
      }
      if (b.y > PITCH.GOAL_H - R && depth > 0.1) {
        b.y = PITCH.GOAL_H - R;
        if (b.vy > 0) b.vy = -b.vy * 0.15;
      }
    }
  }
}

/** Predicts ball ground position after t seconds (simple, used by AI). */
export function predictBall(b: Ball, t: number) {
  const f = Math.max(0.2, 1 - 0.18 * t);
  return { x: b.x + b.vx * t * f, z: b.z + b.vz * t * f };
}
