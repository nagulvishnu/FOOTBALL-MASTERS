export type Team = 0 | 1;
export type Role = "GK" | "LB" | "RB" | "CML" | "CMR" | "LW" | "RW";
export type Tactic = "balanced" | "attacking" | "defensive" | "pressing" | "counter";
export type Difficulty = "beginner" | "easy" | "medium" | "hard" | "expert";
export type ActType = "pass" | "through" | "shoot" | "cross" | "tackle" | "support" | "jump";
export type Phase = "prematch" | "restart" | "playing" | "goal" | "halftime" | "finished";
export type SetPieceKind = "kickoff" | "throwin" | "goalkick" | "corner" | "freekick" | "penalty";
export type DrillKind = "free" | "shooting" | "passing" | "dribbling" | "goalkeeper";

export interface Act {
  n: number; // monotonically increasing id (dedupe)
  type: ActType;
  power: number; // 0..1 charge
}

/** Message a client sends: INPUT only, never world state. */
export interface InputMsg {
  seq: number;
  mx: number;
  mz: number;
  sprint: boolean;
  acts?: Act[];
}

export interface GameEvent {
  k: string;
  team?: number;
  p?: number;
  q?: number;
  x?: number;
  y?: number;
  z?: number;
  v?: number;
  s?: string;
}

export interface Kit {
  name: string;
  primary: string;
  secondary: string;
  pattern: "solid" | "stripes" | "hoops" | "sash";
  gk: string;
}

export interface Appearance {
  gender: "m" | "f";
  hair: number; // 0..5
  hairColor: number; // 0..5
  skin: number; // 0..5
}

export interface RosterEntry {
  idx: number;
  team: Team;
  role: Role;
  number: number;
  name: string;
  human: boolean;
  userId: string | null;
  connected: boolean;
  appearance: Appearance;
}

/** Player tuple: [x, z, facing, vx, vz, actionCode+32*seq, stamina, y, flags] */
export type PlayerTuple = [number, number, number, number, number, number, number, number, number];
export const FLAG_HUMAN = 1;
export const FLAG_YELLOW = 2;
export const FLAG_RED = 4;
export const FLAG_BALL = 8;
export const FLAG_INACTIVE = 16;

export interface Snapshot {
  tick: number;
  phase: Phase;
  half: number;
  el: number; // elapsed seconds in this half
  hs: number; // regulation seconds per half
  st: number; // announced stoppage seconds (0 if not yet)
  pt: number; // phase timer seconds (countdown for restarts/halftime)
  score: [number, number];
  ball: [number, number, number, number, number, number, number]; // x y z vx vy vz owner
  players: PlayerTuple[];
  sp: { k: string; team: number; x: number; z: number; taker: number } | null;
  poss: [number, number];
  ev: GameEvent[];
  dr?: DrillSnap;
}

export interface DrillSnap {
  kind: DrillKind;
  label: string;
  value: number;
  sub: string;
  timeLeft: number;
  attempts: number;
  total: number;
  done: boolean;
  cones?: { x: number; z: number }[];
  next?: number;
}

export interface PlayerStats {
  goals: number;
  assists: number;
  saves: number;
  tackles: number;
  passes: number;
  passOk: number;
  shots: number;
  fouls: number;
}

export interface MatchResult {
  score: [number, number];
  possession: [number, number];
  durationSeconds: number;
  players: {
    idx: number;
    team: Team;
    role: Role;
    name: string;
    userId: string | null;
    yellow: number;
    red: boolean;
    stats: PlayerStats;
  }[];
}

export interface SimConfig {
  halfSeconds: number;
  halftimeSeconds: number;
  difficulty: Difficulty;
  tactics: [Tactic, Tactic];
  seed: number;
  drill?: DrillKind;
  drillHuman?: number; // idx of human in drill
}
