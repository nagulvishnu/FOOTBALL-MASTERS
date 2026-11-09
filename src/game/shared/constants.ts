// Shared gameplay constants. 1 world unit = 1 metre. x = pitch length, z = pitch width, y = up.
// Team 0 (A) defends -x and attacks +x. Team 1 (B) defends +x and attacks -x.
import type { Difficulty, Role, Tactic, Team } from "./types";

export const PITCH = {
  L: 105,
  W: 68,
  HL: 52.5,
  HW: 34,
  GOAL_W: 7.32,
  GOAL_H: 2.44,
  GOAL_D: 2.2,
  CIRCLE: 9.15,
  PEN_D: 16.5,
  PEN_W: 40.32,
  GA_D: 5.5,
  GA_W: 18.32,
  SPOT: 11,
  POST_R: 0.06,
  BALL_R: 0.22,
} as const;

export const GRAVITY = 9.81;
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const ROLES: Role[] = ["GK", "LB", "RB", "CML", "CMR", "LW", "RW"];
export const ROLE_LABEL: Record<Role, string> = {
  GK: "GK",
  LB: "LB",
  RB: "RB",
  CML: "CM-L",
  CMR: "CM-R",
  LW: "LW",
  RW: "RW",
};
export const ROLE_NAME: Record<Role, string> = {
  GK: "Goalkeeper",
  LB: "Left Defender",
  RB: "Right Defender",
  CML: "Left Central Midfielder",
  CMR: "Right Central Midfielder",
  LW: "Left Forward",
  RW: "Right Forward",
};
export const ROLE_NUMBER: Record<Role, number> = { GK: 1, LB: 3, RB: 2, CML: 8, CMR: 6, LW: 11, RW: 7 };

// Formation anchors in team-local coordinates: u = forward from centre, v = lateral (right of attack direction).
export const FORMATION: Record<Role, { u: number; v: number }> = {
  GK: { u: -50, v: 0 },
  LB: { u: -30, v: -14 },
  RB: { u: -30, v: 14 },
  CML: { u: -8, v: -10 },
  CMR: { u: -8, v: 10 },
  LW: { u: 18, v: -19 },
  RW: { u: 18, v: 19 },
};

export const TACTICS: Tactic[] = ["balanced", "attacking", "defensive", "pressing", "counter"];
export const TACTIC_LABEL: Record<Tactic, string> = {
  balanced: "Balanced",
  attacking: "Attacking",
  defensive: "Defensive",
  pressing: "High Pressing",
  counter: "Counterattack",
};
export const DIFFICULTIES: Difficulty[] = ["beginner", "easy", "medium", "hard", "expert"];

export const DIFF: Record<Difficulty, { speed: number; react: number; acc: number; save: number; tackle: number; shoot: number }> = {
  beginner: { speed: 0.8, react: 0.95, acc: 0.45, save: 0.3, tackle: 0.25, shoot: 0.3 },
  easy: { speed: 0.86, react: 0.75, acc: 0.6, save: 0.45, tackle: 0.35, shoot: 0.4 },
  medium: { speed: 0.92, react: 0.55, acc: 0.72, save: 0.58, tackle: 0.45, shoot: 0.5 },
  hard: { speed: 0.97, react: 0.38, acc: 0.85, save: 0.7, tackle: 0.55, shoot: 0.6 },
  expert: { speed: 1.0, react: 0.25, acc: 0.94, save: 0.82, tackle: 0.65, shoot: 0.7 },
};

export const A = {
  NONE: 0,
  PASS: 1,
  LONG: 2,
  SHOOT: 3,
  CROSS: 4,
  HEADER: 5,
  SLIDE: 6,
  TACKLE: 7,
  FALL: 8,
  GETUP: 9,
  CELEB: 10,
  DIVE: 11,
  CATCH: 12,
  GKKICK: 13,
  JUMP: 14,
  CONTROL: 15,
  VOLLEY: 16,
  THROUGH: 17,
} as const;

export const dirOf = (t: Team): 1 | -1 => (t === 0 ? 1 : -1);
export const slotIdx = (team: Team, role: Role) => team * 7 + ROLES.indexOf(role);
export const teamOfIdx = (idx: number): Team => (idx < 7 ? 0 : 1);
export const roleOfIdx = (idx: number): Role => ROLES[idx % 7];
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function localToWorld(team: Team, u: number, v: number) {
  const d = dirOf(team);
  return { x: d * u, z: d * v };
}

/** Is a point inside the penalty area belonging to the team that DEFENDS it? */
export function inPenaltyArea(defTeam: Team, x: number, z: number) {
  const sx = -dirOf(defTeam);
  return x * sx > PITCH.HL - PITCH.PEN_D && Math.abs(z) < PITCH.PEN_W / 2;
}

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const STADIUMS = [
  { id: "international", name: "International Arena", blurb: "Colossal bowl with a full canopy roof." },
  { id: "classic", name: "Classic Stadium", blurb: "Traditional brick-red stands and four pylons." },
  { id: "neon", name: "Neon Stadium", blurb: "Futuristic glow rings and pulsing light." },
  { id: "tropical", name: "Tropical Stadium", blurb: "Open-air bowl ringed by palms." },
  { id: "championship", name: "Championship Arena", blurb: "Premium gold-trim competition venue." },
] as const;
export type StadiumId = (typeof STADIUMS)[number]["id"];
export const TIMES = ["day", "evening", "night"] as const;
export const WEATHERS = ["clear", "cloudy", "rain"] as const;
export const PATTERNS = ["solid", "stripes", "hoops", "sash"] as const;
export const KIT_COLORS = ["#e63946", "#1d6fe8", "#f4a300", "#16a34a", "#8b3dff", "#ec4899", "#0ea5a5", "#f8fafc", "#111827", "#f97316"];
