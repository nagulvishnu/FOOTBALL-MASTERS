// Authoritative match simulation. Pure TypeScript (no DOM / no three.js) so that it can run on the
// server (online rooms) or in the browser (offline practice / skirmish) with identical rules.
import {
  A,
  DIFF,
  FORMATION,
  PITCH,
  ROLES,
  TICK_DT,
  clamp,
  dirOf,
  inPenaltyArea,
  localToWorld,
  roleOfIdx,
  ROLE_NUMBER,
  teamOfIdx,
} from "../shared/constants";
import { stepMovement } from "../shared/movement";
import {
  FLAG_BALL,
  FLAG_HUMAN,
  FLAG_INACTIVE,
  FLAG_RED,
  FLAG_YELLOW,
  type Act,
  type GameEvent,
  type InputMsg,
  type MatchResult,
  type Phase,
  type PlayerStats,
  type PlayerTuple,
  type Role,
  type SetPieceKind,
  type SimConfig,
  type Snapshot,
  type Tactic,
  type Team,
} from "../shared/types";
import { checkPending, doAct, executeSetPiece, gkInteract, resolveSlide } from "./actions";
import { aiUpdate } from "./ai";
import { newBall, stepBall, type Ball } from "./ballPhysics";
import { Drill } from "./drills";

export interface PlayerSim {
  idx: number;
  team: Team;
  role: Role;
  number: number;
  name: string;
  userId: string | null;
  human: boolean;
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  y: number;
  vy: number;
  stamina: number;
  sprinting: boolean;
  wx: number;
  wz: number;
  sprintWish: boolean;
  input: { mx: number; mz: number; sprint: boolean; at: number };
  lastSeq: number;
  lastActN: number;
  actQ: Act[];
  action: number;
  actionSeq: number;
  actionT: number;
  cooldown: number;
  actCooldown: number;
  down: number;
  lunge: { dx: number; dz: number; t: number; speed: number; hit?: boolean } | null;
  pending: { kind: "header"; t: number; power: number } | null;
  yellow: number;
  red: boolean;
  fouls: number;
  callFor: number;
  callT: number;
  supportT: number;
  supportX: number;
  supportZ: number;
  aiT: number;
  aiDirX: number;
  aiDirZ: number;
  holdT: number;
  diving: boolean;
  stats: PlayerStats;
}

export interface SetPiece {
  kind: SetPieceKind;
  team: Team;
  x: number;
  z: number;
  t: number;
  taker: number;
}

const emptyStats = (): PlayerStats => ({ goals: 0, assists: 0, saves: 0, tackles: 0, passes: 0, passOk: 0, shots: 0, fouls: 0 });

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MatchSim {
  cfg: SimConfig;
  rng: () => number;
  players: PlayerSim[] = [];
  ball: Ball = newBall();
  phase: Phase = "prematch";
  phaseT = 3;
  half = 1;
  elapsed = 0;
  stoppage = 0;
  stoppageAnnounced = false;
  deadTime = 0;
  score: [number, number] = [0, 0];
  events: GameEvent[] = [];
  tick = 0;
  time = 0;
  playTime = 0;
  setPiece: SetPiece | null = null;
  kickoffTeam: Team = 0;
  tactic: [Tactic, Tactic];
  poss: [number, number] = [0, 0];
  offside: { team: Team; ids: Set<number> } | null = null;
  lastPass: { from: number; team: number; t: number } | null = null;
  assistCand: { from: number; to: number; team: number; t: number } | null = null;
  chase: [number[], number[]] = [[], []];
  drill: Drill | null = null;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed);
    this.tactic = [...cfg.tactics] as [Tactic, Tactic];
    for (let i = 0; i < 14; i++) {
      const team = teamOfIdx(i);
      const role = roleOfIdx(i);
      this.players.push({
        idx: i, team, role, number: ROLE_NUMBER[role], name: `${role}`, userId: null, human: false, active: true,
        x: 0, z: 0, vx: 0, vz: 0, facing: dirOf(team) > 0 ? 0 : Math.PI, y: 0, vy: 0, stamina: 100, sprinting: false,
        wx: 0, wz: 0, sprintWish: false, input: { mx: 0, mz: 0, sprint: false, at: -99 }, lastSeq: -1, lastActN: -1, actQ: [],
        action: 0, actionSeq: 0, actionT: 0, cooldown: 0, actCooldown: 0, down: 0, lunge: null, pending: null,
        yellow: 0, red: false, fouls: 0, callFor: -1, callT: 0, supportT: 0, supportX: 0, supportZ: 0, aiT: 0,
        aiDirX: 0, aiDirZ: 0, holdT: 0, diving: false, stats: emptyStats(),
      });
    }
    if (cfg.drill) {
      this.drill = new Drill(this, cfg.drill, cfg.drillHuman ?? 3);
      this.phase = "playing";
      this.phaseT = 0;
    } else {
      this.resetFormation(this.kickoffTeam);
    }
  }

  get canPlay() {
    return this.phase === "playing" || this.phase === "restart";
  }

  emit = (e: GameEvent) => {
    this.events.push(e);
  };

  setAction(p: PlayerSim, code: number, dur: number) {
    p.action = code;
    p.actionSeq = (p.actionSeq + 1) & 7;
    p.actionT = dur;
  }

  // ---------------------------------------------------------------- controllers
  setHuman(idx: number, human: boolean, name?: string, userId?: string | null) {
    const p = this.players[idx];
    if (!p) return;
    p.human = human;
    if (name !== undefined) p.name = name;
    if (userId !== undefined) p.userId = userId;
    p.input = { mx: 0, mz: 0, sprint: false, at: this.time };
    p.actQ = [];
    p.wx = p.wz = 0;
  }

  /** Validates and stores an input message. Returns false if rejected. */
  pushInput(idx: number, msg: InputMsg): boolean {
    const p = this.players[idx];
    if (!p || !p.human) return false;
    if (!Number.isFinite(msg.seq) || msg.seq <= p.lastSeq - 1000) return false;
    if (msg.seq < p.lastSeq) return false;
    p.lastSeq = msg.seq;
    let mx = Number(msg.mx);
    let mz = Number(msg.mz);
    if (!Number.isFinite(mx) || !Number.isFinite(mz)) return false;
    const m = Math.hypot(mx, mz);
    if (m > 1) {
      mx /= m;
      mz /= m;
    }
    p.input = { mx, mz, sprint: !!msg.sprint, at: this.time };
    if (msg.acts) {
      for (const a of msg.acts.slice(0, 4)) {
        if (!a || typeof a.n !== "number" || a.n <= p.lastActN) continue;
        if (!["pass", "through", "shoot", "cross", "tackle", "support", "jump"].includes(a.type)) continue;
        p.lastActN = a.n;
        if (p.actQ.length < 4) p.actQ.push({ n: a.n, type: a.type, power: clamp(Number(a.power) || 0, 0, 1) });
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- helpers
  ownerPlayer() {
    return this.ball.owner >= 0 ? this.players[this.ball.owner] : null;
  }

  speedMul(p: PlayerSim) {
    return p.human ? 1 : DIFF[this.cfg.difficulty].speed;
  }

  resetFormation(kickTeam: Team) {
    for (const p of this.players) {
      const f = FORMATION[p.role];
      const u = Math.min(f.u, -3);
      const w = localToWorld(p.team, u, f.v);
      p.x = w.x;
      p.z = w.z;
      p.vx = p.vz = 0;
      p.y = p.vy = 0;
      p.lunge = null;
      p.pending = null;
      p.down = 0;
      p.action = 0;
      p.actionT = 0;
      p.facing = dirOf(p.team) > 0 ? 0 : Math.PI;
      if (p.team !== kickTeam) {
        const d = Math.hypot(p.x, p.z);
        if (d < PITCH.CIRCLE + 1 && d > 0) {
          p.x = (p.x / d) * (PITCH.CIRCLE + 1);
          p.z = (p.z / d) * (PITCH.CIRCLE + 1);
        }
      }
      if (p.red) {
        p.x = 0;
        p.z = PITCH.HW + 6;
      }
    }
  }

  pickTaker(kind: SetPieceKind, team: Team, x: number, z: number): PlayerSim | null {
    const cands = this.players.filter((p) => p.team === team && p.active && !p.red);
    if (!cands.length) return null;
    if (kind === "goalkick") return cands.find((p) => p.role === "GK") ?? cands[0];
    if (kind === "kickoff") return cands.find((p) => p.role === "CMR") ?? cands.find((p) => p.role !== "GK") ?? cands[0];
    if (kind === "penalty") {
      return (
        cands.find((p) => p.human && p.role !== "GK") ?? cands.find((p) => p.role === "LW") ?? cands.find((p) => p.role !== "GK") ?? cands[0]
      );
    }
    let best: PlayerSim | null = null;
    let bd = Infinity;
    for (const p of cands) {
      if (p.role === "GK" && cands.length > 1) continue;
      const d = Math.hypot(p.x - x, p.z - z) + (p.human ? -3 : 0);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  startRestart(kind: SetPieceKind, team: Team, x: number, z: number) {
    this.phase = "restart";
    this.phaseT = 0;
    this.offside = null;
    this.lastPass = null;
    const b = this.ball;
    if (kind === "kickoff") {
      this.resetFormation(team);
      x = 0;
      z = 0;
    }
    b.x = x;
    b.z = z;
    b.y = PITCH.BALL_R;
    b.vx = b.vy = b.vz = 0;
    b.curve = 0;
    b.owner = -1;
    b.power = false;
    const taker = this.pickTaker(kind, team, x, z);
    this.setPiece = { kind, team, x, z, t: 0, taker: taker ? taker.idx : -1 };
    if (taker) {
      const d = dirOf(team);
      let ax: number = d; // aim direction roughly toward opponent goal
      let az = 0;
      if (kind === "throwin") {
        ax = 0;
        az = -Math.sign(z);
      } else if (kind === "corner") {
        ax = -Math.sign(x);
        az = -Math.sign(z) * 0.5;
      } else if (kind === "penalty" || kind === "freekick") {
        const gx = d * PITCH.HL;
        const l = Math.hypot(gx - x, -z) || 1;
        ax = (gx - x) / l;
        az = -z / l;
      }
      const l = Math.hypot(ax, az) || 1;
      ax /= l;
      az /= l;
      if (kind === "throwin") {
        taker.x = x;
        taker.z = z + Math.sign(z) * 0.9;
      } else {
        taker.x = x - ax * 0.95;
        taker.z = z - az * 0.95;
      }
      taker.vx = taker.vz = 0;
      taker.facing = Math.atan2(az, ax);
      taker.down = 0;
      taker.lunge = null;
    }
    this.emit({ k: "restart", s: kind, team, x, z });
    if (kind !== "kickoff") this.emit({ k: "whistle", s: "short" });
  }

  awardFoul(fouler: PlayerSim, victim: PlayerSim, severity: number) {
    fouler.fouls++;
    fouler.stats.fouls++;
    this.emit({ k: "foul", p: fouler.idx, q: victim.idx, team: fouler.team, x: victim.x, z: victim.z });
    // cards
    const r = this.rng();
    let card: "yellow" | "red" | null = null;
    if (severity > 0.85 && r < 0.12) card = "red";
    else if (severity > 0.6 && r < 0.4) card = "yellow";
    else if (fouler.fouls >= 3 && r < 0.3) card = "yellow";
    if (card === "yellow") {
      fouler.yellow++;
      if (fouler.yellow >= 2) card = "red";
    }
    if (card) this.emit({ k: "card", s: card, p: fouler.idx, team: fouler.team });
    if (card === "red") {
      fouler.red = true;
      if (this.ball.owner === fouler.idx) this.ball.owner = -1;
    }
    const vx = victim.x;
    const vz = victim.z;
    if (inPenaltyArea(fouler.team, vx, vz)) {
      const sx = -dirOf(fouler.team);
      this.startRestart("penalty", victim.team, sx * (PITCH.HL - PITCH.SPOT), 0);
    } else {
      this.startRestart("freekick", victim.team, clamp(vx, -PITCH.HL + 1, PITCH.HL - 1), clamp(vz, -PITCH.HW + 1, PITCH.HW - 1));
    }
    if (fouler.red) {
      fouler.x = 0;
      fouler.z = PITCH.HW + 6;
      fouler.vx = fouler.vz = 0;
    }
  }

  callOffside(p: PlayerSim) {
    this.emit({ k: "offside", p: p.idx, team: p.team });
    const team = (p.team ^ 1) as Team;
    this.startRestart("freekick", team, clamp(p.x, -PITCH.HL + 2, PITCH.HL - 2), clamp(p.z, -PITCH.HW + 1, PITCH.HW - 1));
  }

  /** Called whenever a player legally gains/deflects the ball. Returns false if play was stopped (offside). */
  touchReceive(p: PlayerSim) {
    const off = this.offside;
    if (off && !this.drill) {
      if (off.team === p.team && off.ids.has(p.idx)) {
        this.offside = null;
        this.callOffside(p);
        return false;
      }
      this.offside = null;
    }
    const lp = this.lastPass;
    if (lp) {
      if (p.team === lp.team && p.idx !== lp.from) {
        this.players[lp.from].stats.passOk++;
        this.assistCand = { from: lp.from, to: p.idx, team: p.team, t: this.time };
      }
      this.lastPass = null;
    }
    this.ball.lastTouch = p.idx;
    this.ball.lastTeam = p.team;
    return true;
  }

  recordOffside(p: PlayerSim) {
    const d = dirOf(p.team);
    const opp = this.players.filter((q) => q.team !== p.team && q.active && !q.red).map((q) => q.x * d).sort((a, b) => b - a);
    const line = Math.max(opp[1] ?? 0, 0, p.x * d);
    const ids = new Set<number>();
    for (const q of this.players) {
      if (q.team === p.team && q.idx !== p.idx && q.active && !q.red && q.x * d > line + 0.3) ids.add(q.idx);
    }
    this.offside = ids.size ? { team: p.team, ids } : null;
  }

  goalScored(sx: number) {
    const team: Team = sx > 0 ? 0 : 1;
    this.score[team]++;
    const b = this.ball;
    let scorer = -1;
    let assist = -1;
    let own = 0;
    if (b.lastTouch >= 0) {
      const sp = this.players[b.lastTouch];
      if (sp.team === team) {
        scorer = sp.idx;
        sp.stats.goals++;
        const ac = this.assistCand;
        if (ac && ac.to === sp.idx && ac.team === team && this.time - ac.t < 8 && ac.from !== sp.idx) {
          assist = ac.from;
          this.players[ac.from].stats.assists++;
        }
      } else {
        scorer = sp.idx;
        own = 1;
      }
    }
    this.phase = "goal";
    this.phaseT = 4.5;
    this.offside = null;
    this.lastPass = null;
    this.setPiece = null;
    this.emit({ k: "goal", team, p: scorer, q: assist, v: own, x: b.x, y: b.y, z: b.z });
    this.emit({ k: "whistle", s: "goal" });
    for (const p of this.players) {
      if (p.team === team && !p.red && p.down <= 0) this.setAction(p, A.CELEB, 3.5);
    }
    this.kickoffTeam = (team ^ 1) as Team;
  }

  // ---------------------------------------------------------------- main step
  step(dt = TICK_DT) {
    this.events = [];
    this.tick++;
    this.time += dt;
    if (this.phase === "finished") return;
    this.updatePhase(dt);
    this.computeChasers();

    for (const p of this.players) {
      if (!p.active) continue;
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.actCooldown = Math.max(0, p.actCooldown - dt);
      p.callT = Math.max(0, p.callT - dt);
      p.supportT = Math.max(0, p.supportT - dt);
      if (p.callT === 0) p.callFor = -1;
      if (p.actionT > 0) {
        p.actionT -= dt;
        if (p.actionT <= 0) {
          if (p.action === A.FALL) this.setAction(p, A.GETUP, 0.55);
          else {
            p.action = A.NONE;
            p.diving = false;
          }
        }
      }
      if (p.down > 0) p.down = Math.max(0, p.down - dt);
      if (p.pending) {
        p.pending.t -= dt;
        if (p.pending.t <= 0) p.pending = null;
      }
      if (p.vy !== 0 || p.y > 0) {
        p.vy -= 9.81 * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
        }
      }
    }

    // controls
    for (const p of this.players) {
      if (!p.active || p.red) continue;
      if (p.human) {
        const stale = this.time - p.input.at > 0.7;
        p.wx = stale ? 0 : p.input.mx;
        p.wz = stale ? 0 : p.input.mz;
        p.sprintWish = stale ? false : p.input.sprint;
        if (p.actQ.length) {
          const q = p.actQ;
          p.actQ = [];
          for (const a of q) doAct(this, p, a);
        }
      } else {
        aiUpdate(this, p, dt);
      }
      if (p.pending) checkPending(this, p);
      if (p.lunge) resolveSlide(this, p);
    }

    // movement
    for (const p of this.players) {
      if (!p.active || p.red) continue;
      const frozen = p.down > 0;
      if (p.lunge && p.lunge.t > 0) {
        p.lunge.t -= dt;
        p.vx = p.lunge.dx * p.lunge.speed * Math.max(0.25, p.lunge.t / 0.55);
        p.vz = p.lunge.dz * p.lunge.speed * Math.max(0.25, p.lunge.t / 0.55);
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.sprinting = false;
        if (p.lunge.t <= 0) p.lunge = null;
      } else {
        stepMovement(p, frozen ? 0 : p.wx, frozen ? 0 : p.wz, frozen ? false : p.sprintWish, dt, this.speedMul(p), this.ball.owner === p.idx);
      }
    }
    // separation between players
    for (let i = 0; i < 14; i++) {
      const a = this.players[i];
      if (!a.active || a.red) continue;
      for (let j = i + 1; j < 14; j++) {
        const b = this.players[j];
        if (!b.active || b.red) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.71 - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }
    for (const p of this.players) {
      if (!p.active || p.red) continue;
      p.x = clamp(p.x, -PITCH.HL - 4, PITCH.HL + 4);
      p.z = clamp(p.z, -PITCH.HW - 3.5, PITCH.HW + 3.5);
    }

    this.enforceSetPiece();

    // ball
    const sub = dt / 2;
    for (let s = 0; s < 2; s++) {
      const b = this.ball;
      if (this.phase === "restart" || this.phase === "prematch" || this.phase === "halftime") continue;
      if (b.owner >= 0) this.followOwner(sub);
      else stepBall(b, sub, this.emit, true);
    }
    if (this.phase === "playing") this.afterBall(dt);
    if (this.drill) this.drill.tick(dt);

    if (this.phase === "playing") {
      const b = this.ball;
      if (b.owner >= 0) this.poss[this.players[b.owner].team]++;
      else if (b.lastTeam >= 0) this.poss[b.lastTeam]++;
    }
  }

  followOwner(dt: number) {
    const b = this.ball;
    const p = this.players[b.owner];
    if (!p || p.red || p.down > 0) {
      b.owner = -1;
      return;
    }
    const sp = Math.hypot(p.vx, p.vz);
    const lead = p.role === "GK" && p.action === A.CATCH ? 0.35 : 0.62 + 0.14 * Math.min(1, sp / 8);
    const tx = p.x + Math.cos(p.facing) * lead;
    const tz = p.z + Math.sin(p.facing) * lead;
    const k = Math.min(1, 16 * dt);
    b.x += (tx - b.x) * k;
    b.z += (tz - b.z) * k;
    b.y = PITCH.BALL_R + (p.role === "GK" && p.action === A.CATCH ? 0.9 : 0);
    b.vx = p.vx;
    b.vz = p.vz;
    b.vy = 0;
    b.curve = 0;
    b.power = false;
  }

  computeChasers() {
    this.chase = [[], []];
    if (this.phase !== "playing") return;
    const b = this.ball;
    for (const team of [0, 1] as Team[]) {
      const list = this.players
        .filter((p) => p.team === team && p.active && !p.red && p.role !== "GK")
        .map((p) => ({ idx: p.idx, d: Math.hypot(p.x - b.x, p.z - b.z) }))
        .sort((a, c) => a.d - c.d);
      const n = this.tactic[team] === "pressing" ? 3 : 2;
      this.chase[team] = list.slice(0, n).map((e) => e.idx);
    }
  }

  enforceSetPiece() {
    const sp = this.setPiece;
    if (this.phase !== "restart" || !sp) return;
    const excl = sp.kind === "throwin" || sp.kind === "goalkick" || sp.kind === "kickoff" ? 0 : sp.kind === "corner" ? 6 : PITCH.CIRCLE;
    for (const p of this.players) {
      if (!p.active || p.red || p.idx === sp.taker) continue;
      if (sp.kind === "penalty") {
        const sx = Math.sign(sp.x);
        const isGK = p.role === "GK" && p.team !== sp.team;
        if (isGK) {
          p.x = sx * (PITCH.HL - 0.4);
          p.z = clamp(p.z, -3.6, 3.6);
        } else {
          const lineX = sx * (PITCH.HL - PITCH.PEN_D - 0.5);
          const inBox = p.x * sx > PITCH.HL - PITCH.PEN_D - 0.2 && Math.abs(p.z) < PITCH.PEN_W / 2 + 0.2;
          if (inBox) p.x = lineX;
          const d = Math.hypot(p.x - sp.x, p.z - sp.z);
          if (d < PITCH.CIRCLE && p.x * sx < PITCH.HL - PITCH.PEN_D) {
            /* arc rule satisfied by line placement */
          }
        }
      } else if (excl > 0 && p.team !== sp.team) {
        const dx = p.x - sp.x;
        const dz = p.z - sp.z;
        const d = Math.hypot(dx, dz);
        if (d < excl) {
          const k = d > 0.01 ? excl / d : 1;
          p.x = sp.x + (d > 0.01 ? dx * k : excl);
          p.z = sp.z + (d > 0.01 ? dz * k : 0);
        }
      }
    }
  }

  afterBall(dt: number) {
    const b = this.ball;
    // loose-ball pickups
    if (b.owner < 0) this.pickups();
    gkInteract(this);
    if (this.phase !== "playing") return;
    // boundaries & goals
    const R = PITCH.BALL_R;
    const hw = PITCH.GOAL_W / 2;
    if (Math.abs(b.x) > PITCH.HL + R) {
      const sx = Math.sign(b.x);
      if (Math.abs(b.z) < hw && b.y < PITCH.GOAL_H) {
        if (this.drill) this.drill.onGoal(sx);
        else this.goalScored(sx);
        return;
      }
      if (this.drill) {
        this.drill.onOut();
        return;
      }
      const defTeam: Team = sx > 0 ? 1 : 0;
      const last = b.lastTeam < 0 ? 0 : b.lastTeam;
      if (last === defTeam) {
        const cz = Math.sign(b.z || 1) * (PITCH.HW - 0.3);
        this.startRestart("corner", (defTeam ^ 1) as Team, sx * (PITCH.HL - 0.3), cz);
      } else {
        this.startRestart("goalkick", defTeam, sx * (PITCH.HL - PITCH.GA_D), Math.sign(b.z || 1) * 5);
      }
      this.emit({ k: "out", x: b.x, z: b.z });
      return;
    }
    if (Math.abs(b.z) > PITCH.HW + R) {
      if (this.drill) {
        this.drill.onOut();
        return;
      }
      const last = b.lastTeam < 0 ? 0 : b.lastTeam;
      this.startRestart("throwin", (last ^ 1) as Team, clamp(b.x, -PITCH.HL + 3, PITCH.HL - 3), Math.sign(b.z) * PITCH.HW);
      this.emit({ k: "out", x: b.x, z: b.z });
    }
    void dt;
  }

  pickups() {
    const b = this.ball;
    let best: PlayerSim | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (!p.active || p.red || p.down > 0 || p.cooldown > 0 || p.lunge) continue;
      if (this.phase !== "playing") continue;
      const reach = p.role === "GK" ? 1.0 : 0.85;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < reach && b.y < 1.0 + p.y && !(b.vy > 3.5 && b.y > 0.5) && d < bd) {
        best = p;
        bd = d;
      }
    }
    if (!best) return;
    const rel = Math.hypot(b.vx - best.vx, b.vz - best.vz);
    if (rel <= 13.5) {
      if (!this.touchReceive(best)) return;
      b.owner = best.idx;
      if (rel > 6) {
        this.emit({ k: "touch", p: best.idx, v: rel });
        this.setAction(best, A.CONTROL, 0.3);
      }
    } else {
      if (!this.touchReceive(best)) return;
      b.vx = -b.vx * 0.25 + best.vx * 0.5;
      b.vz = -b.vz * 0.25 + best.vz * 0.5;
      b.vy = Math.abs(b.vy) * 0.3 + 1.2;
      best.cooldown = 0.25;
      this.emit({ k: "block", p: best.idx, v: rel });
    }
  }

  // ---------------------------------------------------------------- phases / clock
  updatePhase(dt: number) {
    if (this.drill) return;
    switch (this.phase) {
      case "prematch":
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.emit({ k: "kickoff" });
          this.startRestart("kickoff", this.kickoffTeam, 0, 0);
        }
        return;
      case "restart": {
        const sp = this.setPiece;
        if (!sp) return;
        sp.t += dt;
        this.phaseT = sp.t;
        if (sp.kind !== "kickoff") this.deadTime += dt;
        const taker = this.players[sp.taker];
        if (!taker) {
          this.phase = "playing";
          return;
        }
        const wait = taker.human ? 8 : sp.kind === "kickoff" ? 1.2 : sp.kind === "penalty" ? 2.5 : 1.6;
        if (sp.t >= wait) executeSetPiece(this, taker, null);
        return;
      }
      case "goal":
        this.phaseT -= dt;
        this.deadTime += dt;
        if (this.phaseT <= 0) {
          if (this.elapsed >= this.cfg.halfSeconds + this.stoppage && this.stoppageAnnounced) this.endHalf();
          else this.startRestart("kickoff", this.kickoffTeam, 0, 0);
        }
        return;
      case "halftime":
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.half = 2;
          this.elapsed = 0;
          this.deadTime = 0;
          this.stoppage = 0;
          this.stoppageAnnounced = false;
          this.kickoffTeam = 1;
          for (const p of this.players) p.stamina = Math.min(100, p.stamina + 40);
          this.emit({ k: "kickoff" });
          this.startRestart("kickoff", 1, 0, 0);
        }
        return;
      case "playing": {
        this.elapsed += dt;
        const hs = this.cfg.halfSeconds;
        if (!this.stoppageAnnounced && this.elapsed >= hs) {
          this.stoppageAnnounced = true;
          this.stoppage = clamp(Math.round(this.deadTime * 0.5), 0, Math.round(hs * 0.15));
          this.emit({ k: "stoppage", v: Math.ceil((this.stoppage / hs) * 45) });
        }
        if (this.stoppageAnnounced && this.elapsed >= hs + this.stoppage) this.endHalf();
        return;
      }
    }
  }

  endHalf() {
    this.ball.owner = -1;
    this.setPiece = null;
    this.offside = null;
    if (this.half === 1) {
      this.phase = "halftime";
      this.phaseT = this.cfg.halftimeSeconds;
      this.emit({ k: "whistle", s: "half" });
      this.emit({ k: "halftime" });
      this.resetFormation(1);
      this.ball.x = 0;
      this.ball.z = 0;
      this.ball.vx = this.ball.vz = this.ball.vy = 0;
      this.ball.y = PITCH.BALL_R;
    } else {
      this.phase = "finished";
      this.emit({ k: "whistle", s: "full" });
      this.emit({ k: "fulltime" });
      const w = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
      for (const p of this.players) if (p.team === w && !p.red) this.setAction(p, A.CELEB, 8);
    }
  }

  // ---------------------------------------------------------------- output
  snapshot(): Snapshot {
    const players: PlayerTuple[] = this.players.map((p) => {
      const flags =
        (p.human ? FLAG_HUMAN : 0) | (p.yellow ? FLAG_YELLOW : 0) | (p.red ? FLAG_RED : 0) | (this.ball.owner === p.idx ? FLAG_BALL : 0) | (p.active ? 0 : FLAG_INACTIVE);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return [r2(p.x), r2(p.z), r2(p.facing), r2(p.vx), r2(p.vz), p.action + 32 * p.actionSeq, Math.round(p.stamina), r2(p.y), flags];
    });
    const b = this.ball;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const sp = this.setPiece;
    return {
      tick: this.tick,
      phase: this.phase,
      half: this.half,
      el: r2(this.elapsed),
      hs: this.cfg.halfSeconds,
      st: this.stoppageAnnounced ? this.stoppage : 0,
      pt: r2(this.phaseT),
      score: [this.score[0], this.score[1]],
      ball: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.owner],
      players,
      sp: sp ? { k: sp.kind, team: sp.team, x: r2(sp.x), z: r2(sp.z), taker: sp.taker } : null,
      poss: [this.poss[0], this.poss[1]],
      ev: this.events,
      dr: this.drill ? this.drill.snap() : undefined,
    };
  }

  result(): MatchResult {
    const total = this.poss[0] + this.poss[1] || 1;
    return {
      score: [this.score[0], this.score[1]],
      possession: [Math.round((this.poss[0] / total) * 100), Math.round((this.poss[1] / total) * 100)],
      durationSeconds: Math.round(this.cfg.halfSeconds * 2),
      players: this.players
        .filter((p) => p.active)
        .map((p) => ({ idx: p.idx, team: p.team, role: p.role, name: p.name, userId: p.userId, yellow: p.yellow, red: p.red, stats: { ...p.stats } })),
    };
  }
}

export { ROLES };
