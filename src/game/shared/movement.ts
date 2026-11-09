// Movement integrator shared by the authoritative server sim, AI and client-side prediction.
import { clamp } from "./constants";

export const MOVE = {
  jog: 5.4,
  sprint: 8.2,
  accel: 22,
  decel: 28,
  turnRate: 11, // rad/s
  staminaDrain: 17,
  staminaRegen: 7.5,
  ballFactor: 0.93,
};

export interface MoverState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  stamina: number;
  sprinting?: boolean;
}

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Applies acceleration/deceleration, diagonal normalisation, smooth turning and stamina. */
export function stepMovement(p: MoverState, wx: number, wz: number, sprint: boolean, dt: number, speedMul = 1, hasBall = false) {
  let mag = Math.hypot(wx, wz);
  if (mag > 1) {
    wx /= mag;
    wz /= mag;
    mag = 1;
  }
  const wantsSprint = sprint && mag > 0.2 && p.stamina > 2;
  p.sprinting = wantsSprint;
  const top = (wantsSprint ? MOVE.sprint : MOVE.jog) * speedMul * (hasBall ? MOVE.ballFactor : 1);
  const tvx = mag > 0.05 ? (wx / Math.max(mag, 1e-6)) * top * mag : 0;
  const tvz = mag > 0.05 ? (wz / Math.max(mag, 1e-6)) * top * mag : 0;
  const dvx = tvx - p.vx;
  const dvz = tvz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  const speedNow = Math.hypot(p.vx, p.vz);
  const targetSp = Math.hypot(tvx, tvz);
  const rate = targetSp >= speedNow ? MOVE.accel : MOVE.decel;
  const maxDv = rate * dt;
  if (dl <= maxDv) {
    p.vx = tvx;
    p.vz = tvz;
  } else {
    p.vx += (dvx / dl) * maxDv;
    p.vz += (dvz / dl) * maxDv;
  }
  // facing follows intent (or velocity when drifting)
  if (mag > 0.1) {
    const want = Math.atan2(wz, wx);
    const d = angleDiff(p.facing, want);
    const step = MOVE.turnRate * dt;
    p.facing += clamp(d, -step, step);
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (wantsSprint) p.stamina = Math.max(0, p.stamina - MOVE.staminaDrain * dt * Math.min(1, speedNow / 5));
  else p.stamina = Math.min(100, p.stamina + MOVE.staminaRegen * dt * (speedNow < 1 ? 1.8 : 1));
}
