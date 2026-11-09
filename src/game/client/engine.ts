// Render engine: scene, snapshot interpolation, limited client prediction, independent third-person camera,
// particles / screen shake / ball trail and event-driven audio + banners.
import * as THREE from "three";
import { A, PITCH, clamp, dirOf, ROLE_LABEL } from "../shared/constants";
import { angleDiff, stepMovement } from "../shared/movement";
import { FLAG_BALL, FLAG_INACTIVE, FLAG_RED, type DrillSnap, type GameEvent, type Kit, type RosterEntry, type Snapshot } from "../shared/types";
import { Sfx } from "./audio";
import { Character } from "./characters";
import { InputController } from "./input";
import type { Settings } from "./settings";
import type { GameSource } from "./sources";
import { buildWorld, type Quality, type World } from "./world";

export interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "goal" | "info" | "warn" | "yellow" | "red" | "good";
}
export interface Hud {
  phase: string;
  score: [number, number];
  clock: string;
  half: number;
  stamina: number;
  you: number;
  charge: number;
  ping: number;
  drill?: DrillSnap;
  setPiece: string;
  poss: [number, number];
  mates: { idx: number; name: string; role: string; human: boolean; connected: boolean; ball: boolean; red: boolean }[];
  tactical: boolean;
  locked: boolean;
}

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  source: GameSource;
  roster: RosterEntry[];
  you: number;
  kits: [Kit, Kit];
  stadium: Parameters<typeof buildWorld>[1]["stadium"];
  time: "day" | "evening" | "night";
  weather: "clear" | "cloudy" | "rain";
  settings: () => Settings;
  onHud: (h: Hud) => void;
  onBanner: (b: Banner) => void;
  onPause: () => void;
  onFinished: () => void;
}

class Particles {
  pts: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private base: Float32Array;
  private grav: Float32Array;
  private n: number;
  private head = 0;
  constructor(n: number, private additive: boolean, size: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.base = new Float32Array(n * 3);
    this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }),
    );
    this.pts.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, grav = 9.8) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999;
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] = Math.max(0.02, this.pos[k + 1] + this.vel[k + 1] * dt);
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.additive ? this.life[i] / this.max[i] : 1;
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

const GRASS = [new THREE.Color("#4f9d3a"), new THREE.Color("#3a7a2a"), new THREE.Color("#6b4f2a")];
const CONFETTI = ["#ff3b6b", "#ffd23f", "#3bd1ff", "#7dff9a", "#ffffff", "#c46bff"].map((c) => new THREE.Color(c));

function nameSprite(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = "rgba(8,12,24,0.72)";
  g.beginPath();
  g.roundRect(128 - w / 2, 10, w, 44, 14);
  g.fill();
  g.fillStyle = color;
  g.fillRect(128 - w / 2 + 6, 22, 5, 20);
  g.fillStyle = "#fff";
  g.fillText(text, 134, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  input: InputController;
  sfx = new Sfx();
  chars: (Character | null)[] = [];
  private tags: (THREE.Sprite | null)[] = [];
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private ring: THREE.Mesh;
  private arrow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private fx = new Particles(500, true, 0.4);
  private dirt = new Particles(300, false, 0.28);
  private buf: { t: number; s: Snapshot }[] = [];
  private last: Snapshot | null = null;
  private raf = 0;
  private lastT = 0;
  private hudT = 0;
  private events: { at: number; e: GameEvent }[] = [];
  private bannerId = 1;
  // camera
  private yaw: number;
  private pitch = 0;
  private camPos = new THREE.Vector3();
  private sprintK = 0;
  private shake = 0;
  private goalCam: { t: number; x: number; z: number; a: number } | null = null;
  private tactical = false;
  private ballSpin = new THREE.Vector3();
  // prediction
  private pred = { x: 0, z: 0, vx: 0, vz: 0, facing: 0, stamina: 100, ok: false };
  private actStart: number[] = new Array(14).fill(0);
  private actVal: number[] = new Array(14).fill(-1);
  private seq = 1;
  private lastInput = 0;
  private finishedAt = 0;
  private finishedFired = false;
  private disposed = false;
  private ro: ResizeObserver;
  private quality: Quality;
  private ownRed = false;
  private kickT = 0;
  private lastGoalTeam = -1;
  private cones: THREE.Mesh[] = [];

  constructor(private o: EngineOpts) {
    const s = o.settings();
    this.quality = s.graphics;
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: q !== "low", powerPreference: "high-performance" });
    const mobile = matchMedia("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === "high" ? 2 : q === "medium" ? 1.5 : mobile ? 1 : 1.25));
    this.renderer.shadowMap.enabled = q !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = o.time === "night" ? 1.25 : 1.0;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
    this.world = buildWorld(this.scene, { stadium: o.stadium, time: o.time, weather: o.weather, quality: q, teamColors: [o.kits[0].primary, o.kits[1].primary] });
    this.world.setScoreboard(o.kits[0].name, o.kits[1].name, 0, 0, "00:00", "");
    this.scene.add(this.fx.pts, this.dirt.pts);

    // characters
    for (const r of o.roster) {
      const ch = new Character({ kit: o.kits[r.team], gk: r.role === "GK", number: r.number, appearance: r.appearance, shadows: q !== "low" });
      this.scene.add(ch.root);
      this.chars[r.idx] = ch;
      if (r.human) {
        const tag = nameSprite(r.name, o.kits[r.team].primary);
        tag.position.y = 2.35;
        ch.root.add(tag);
        this.tags[r.idx] = tag;
      }
    }
    // ball
    const bc = document.createElement("canvas");
    bc.width = 128;
    bc.height = 64;
    const bg = bc.getContext("2d")!;
    bg.fillStyle = "#fafafa";
    bg.fillRect(0, 0, 128, 64);
    bg.fillStyle = "#16181d";
    for (let i = 0; i < 9; i++) {
      bg.beginPath();
      const cx = (i % 5) * 28 + (i > 4 ? 14 : 0) + 6;
      const cy = i > 4 ? 46 : 18;
      for (let k = 0; k < 5; k++) bg.lineTo(cx + Math.cos((k / 5) * Math.PI * 2) * 9, cy + Math.sin((k / 5) * Math.PI * 2) * 9);
      bg.fill();
    }
    const bt = new THREE.CanvasTexture(bc);
    bt.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(PITCH.BALL_R, 20, 14), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.45 }));
    this.ball.castShadow = q !== "low";
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    const tg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.scene.add(this.trail);
    // own-player markers
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 28), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    this.arrow.rotation.x = Math.PI;
    this.scene.add(this.arrow);

    const youTeam = o.roster.find((r) => r.idx === o.you)?.team ?? 0;
    this.yaw = youTeam === 0 ? 0 : Math.PI;
    this.input = new InputController(o.canvas, o.settings, {
      onPause: () => o.onPause(),
      onTactical: () => (this.tactical = !this.tactical),
      onAnyKey: () => this.sfx.init(),
    });
    this.applyAudio();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.canvas.parentElement ?? o.canvas);
    this.resize();
    o.source.start((s) => this.onSnapshot(s));
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  applyAudio() {
    const s = this.o.settings();
    this.sfx.setVolumes(s.master, s.music);
  }
  resize() {
    const p = this.o.canvas.parentElement ?? this.o.canvas;
    const w = p.clientWidth || window.innerWidth;
    const h = p.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setEnabled(b: boolean) {
    this.input.enabled = b;
    if (!b) this.input.reset();
  }
  setPaused(p: boolean) {
    this.o.source.setPaused(p);
  }
  toggleTactical() {
    this.tactical = !this.tactical;
  }
  startAudio() {
    this.sfx.init();
  }

  // ------------------------------------------------------------ snapshots
  private onSnapshot(s: Snapshot) {
    const now = performance.now();
    this.buf.push({ t: now, s });
    if (this.buf.length > 14) this.buf.shift();
    this.last = s;
    for (const e of s.ev) this.events.push({ at: now + this.o.source.delay * 1000, e });
    if (!this.pred.ok) {
      const p = s.players[this.o.you];
      if (p) Object.assign(this.pred, { x: p[0], z: p[1], vx: p[3], vz: p[4], facing: p[2], stamina: p[6], ok: true });
    }
  }

  private emitEvent(e: GameEvent) {
    const o = this.o;
    const name = (i?: number) => (i !== undefined && i >= 0 ? o.roster.find((r) => r.idx === i)?.name ?? "" : "");
    const ban = (text: string, tone: Banner["tone"], sub?: string) => o.onBanner({ id: this.bannerId++, text, tone, sub });
    const at = (x = 0, y = 0.3, z = 0) => new THREE.Vector3(x, y, z);
    switch (e.k) {
      case "kick": {
        const v = e.v ?? 10;
        this.sfx.kick(Math.min(1, v / 32));
        for (let i = 0; i < 5; i++) this.dirt.emit(e.x ?? 0, 0.1, e.z ?? 0, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.6, GRASS[i % 3]);
        if (v > 26) this.addShake(0.12);
        this.kickT = performance.now();
        break;
      }
      case "bounce":
        this.sfx.bounce(e.v ?? 3);
        break;
      case "post": {
        this.sfx.post();
        this.addShake(0.25);
        const p = at(e.x, e.y, e.z);
        for (let i = 0; i < 14; i++) this.fx.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0.5, CONFETTI[4]);
        ban("OFF THE WOODWORK!", "info");
        break;
      }
      case "net":
        this.sfx.net();
        this.world.netHit(Math.sign(e.x ?? 1), e.v ?? 5);
        this.addShake(0.2);
        break;
      case "goal": {
        this.sfx.goal();
        this.addShake(0.7);
        this.world.setCrowdExcite(1);
        const scorer = e.p !== undefined && e.p >= 0 ? this.interpPlayer(e.p) : null;
        const sx = scorer?.x ?? (e.x ?? 0);
        const sz = scorer?.z ?? (e.z ?? 0);
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 7;
          this.fx.emit(sx, 1 + Math.random(), sz, Math.cos(a) * sp, 5 + Math.random() * 8, Math.sin(a) * sp, 1.6 + Math.random(), CONFETTI[i % CONFETTI.length], 6);
        }
        this.goalCam = { t: 0, x: sx, z: sz, a: Math.random() * 6 };
        this.lastGoalTeam = e.team ?? -1;
        ban(e.v ? "OWN GOAL" : "GOAL!", "goal", `${name(e.p)}${e.q !== undefined && e.q >= 0 ? `  ·  assist ${name(e.q)}` : ""}`);
        break;
      }
      case "whistle":
        this.sfx.whistle(e.s === "full" ? "triple" : e.s === "half" ? "long" : e.s === "goal" ? "goal" : "short");
        break;
      case "tackle":
        this.sfx.tackle();
        this.addShake(0.16);
        for (let i = 0; i < 8; i++) this.fx.emit(e.x ?? 0, 0.4, e.z ?? 0, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 0.35, CONFETTI[1]);
        break;
      case "slide": {
        const p = this.interpPlayer(e.p ?? 0);
        if (p) for (let i = 0; i < 10; i++) this.dirt.emit(p.x, 0.15, p.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 0.6, GRASS[i % 3]);
        break;
      }
      case "save":
        this.sfx.save();
        this.addShake(0.14);
        ban(e.s === "catch" ? "SAVED!" : "GREAT SAVE!", "good", name(e.p));
        break;
      case "foul":
        ban("FOUL", "warn", name(e.p));
        break;
      case "card":
        ban(e.s === "red" ? "RED CARD" : "YELLOW CARD", e.s === "red" ? "red" : "yellow", name(e.p));
        if (e.p === this.o.you && e.s === "red") this.ownRed = true;
        break;
      case "offside":
        ban("OFFSIDE", "warn", name(e.p));
        break;
      case "restart": {
        const lab: Record<string, string> = { throwin: "THROW-IN", goalkick: "GOAL KICK", corner: "CORNER KICK", freekick: "FREE KICK", penalty: "PENALTY!", kickoff: "" };
        if (lab[e.s ?? ""]) ban(lab[e.s ?? ""], e.s === "penalty" ? "warn" : "info");
        break;
      }
      case "kickoff":
        ban("KICK OFF", "info", "Match underway");
        this.sfx.speak("Kick off");
        break;
      case "halftime":
        ban("HALF TIME", "info");
        this.sfx.speak("Half time");
        break;
      case "fulltime":
        ban("FULL TIME", "info");
        this.sfx.speak("Full time");
        break;
      case "stoppage":
        ban(`+${e.v} MIN`, "info", "Stoppage time");
        break;
      case "drillResult":
        ban(e.s === "goal" ? "GOAL!" : e.s === "saved" ? "SAVED!" : "MISS", e.s === "goal" ? "goal" : e.s === "saved" ? "good" : "warn");
        if (e.s === "goal") {
          this.sfx.goal();
          this.addShake(0.4);
        }
        break;
      case "cone":
        this.sfx.ui();
        ban(`CONE ${e.v}`, "good");
        break;
      case "lap":
        this.sfx.goal();
        this.addShake(0.3);
        ban("LAP COMPLETE +5s", "goal");
        break;
      case "block":
      case "touch":
        this.sfx.bounce(2);
        break;
      case "dive": {
        const p = this.interpPlayer(e.p ?? 0);
        if (p) for (let i = 0; i < 8; i++) this.dirt.emit(p.x, 0.1, p.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 0.5, GRASS[i % 3]);
        break;
      }
      case "support":
        this.sfx.ui();
        break;
    }
  }

  private addShake(v: number) {
    this.shake = Math.min(1, this.shake + v);
  }

  // ------------------------------------------------------------ interpolation
  private view = {
    x: new Float32Array(14),
    z: new Float32Array(14),
    f: new Float32Array(14),
    vx: new Float32Array(14),
    vz: new Float32Array(14),
    y: new Float32Array(14),
    act: new Int32Array(14),
    flags: new Int32Array(14),
    bx: 0, by: 0, bz: 0, bvx: 0, bvz: 0, bvy: 0, owner: -1,
  };

  private interpPlayer(i: number) {
    return { x: this.view.x[i], z: this.view.z[i] };
  }

  private interpolate(now: number) {
    const rt = now - this.o.source.delay * 1000;
    const b = this.buf;
    if (!b.length) return false;
    let a = b[0];
    let c = b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= rt) {
        a = b[i];
        c = b[Math.min(i + 1, b.length - 1)];
        break;
      }
      a = b[i];
      c = b[i];
    }
    let k = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 1;
    k = clamp(k, 0, 1);
    const v = this.view;
    for (let i = 0; i < 14; i++) {
      const p = a.s.players[i];
      const q = c.s.players[i];
      v.x[i] = p[0] + (q[0] - p[0]) * k;
      v.z[i] = p[1] + (q[1] - p[1]) * k;
      v.f[i] = p[2] + angleDiff(p[2], q[2]) * k;
      v.vx[i] = p[3] + (q[3] - p[3]) * k;
      v.vz[i] = p[4] + (q[4] - p[4]) * k;
      v.y[i] = p[7] + (q[7] - p[7]) * k;
      const src = k > 0.5 ? q : p;
      v.act[i] = src[5];
      v.flags[i] = src[8];
    }
    const pb = a.s.ball;
    const qb = c.s.ball;
    v.bx = pb[0] + (qb[0] - pb[0]) * k;
    v.by = pb[1] + (qb[1] - pb[1]) * k;
    v.bz = pb[2] + (qb[2] - pb[2]) * k;
    v.bvx = qb[3];
    v.bvy = qb[4];
    v.bvz = qb[5];
    v.owner = qb[6];
    return true;
  }

  // ------------------------------------------------------------ frame
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const o = this.o;
    o.source.update();
    if (!this.interpolate(now) || !this.last) return;
    const v = this.view;
    const you = o.you;
    const settings = o.settings();
    const s = this.last;

    // events scheduled for "now"
    while (this.events.length && this.events[0].at <= now) this.emitEvent(this.events.shift()!.e);

    // look + input
    const look = this.input.consumeLook();
    this.yaw += look.dx * 0.0022 * settings.sensitivity;
    this.pitch = clamp(this.pitch + look.dy * 0.0018 * settings.sensitivity * (settings.invertY ? -1 : 1), -0.3, 0.75);
    const controls = this.input.poll(this.yaw);
    const youFlags = v.flags[you] ?? 0;
    this.ownRed = this.ownRed || (youFlags & FLAG_RED) !== 0;
    if (you >= 0 && now - this.lastInput > 33 && !this.ownRed && this.input.enabled) {
      this.lastInput = now;
      o.source.sendInput({ seq: this.seq++, mx: controls.mx, mz: controls.mz, sprint: controls.sprint, acts: controls.acts.length ? controls.acts : undefined });
    } else if (controls.acts.length) {
      // keep actions queued if we couldn't send this frame
      for (const a of controls.acts) this.input.touchButton(a.type, false);
    }

    // prediction for own player (movement only; server stays authoritative)
    const ownAct = v.act[you] & 31;
    const locked = ownAct === A.SLIDE || ownAct === A.FALL || ownAct === A.GETUP || ownAct === A.DIVE || ownAct === A.CELEB;
    const ap = s.players[you];
    if (ap && this.pred.ok) {
      if (locked || (youFlags & FLAG_INACTIVE) || !this.input.enabled) {
        this.pred.x = v.x[you];
        this.pred.z = v.z[you];
        this.pred.vx = v.vx[you];
        this.pred.vz = v.vz[you];
        this.pred.facing = v.f[you];
      } else {
        stepMovement(this.pred, controls.mx, controls.mz, controls.sprint, dt, 1, (youFlags & FLAG_BALL) !== 0);
        const ex = ap[0] + ap[3] * 0.05 - this.pred.x;
        const ez = ap[1] + ap[4] * 0.05 - this.pred.z;
        if (Math.hypot(ex, ez) > 3) {
          this.pred.x = ap[0];
          this.pred.z = ap[1];
        } else {
          const k = Math.min(1, dt * 6);
          this.pred.x += ex * k;
          this.pred.z += ez * k;
        }
        this.pred.facing += angleDiff(this.pred.facing, ap[2]) * Math.min(1, dt * 3);
        this.pred.stamina = ap[6];
      }
      v.x[you] = this.pred.x;
      v.z[you] = this.pred.z;
      v.f[you] = this.pred.facing;
      v.vx[you] = this.pred.vx;
      v.vz[you] = this.pred.vz;
    }

    // characters
    for (const r of o.roster) {
      const ch = this.chars[r.idx];
      if (!ch) continue;
      const i = r.idx;
      const inactive = (v.flags[i] & FLAG_INACTIVE) !== 0;
      ch.root.visible = !inactive;
      if (inactive) continue;
      if (this.actVal[i] !== v.act[i]) {
        this.actVal[i] = v.act[i];
        this.actStart[i] = now;
      }
      ch.root.position.set(v.x[i], 0, v.z[i]);
      ch.root.rotation.y = Math.PI / 2 - v.f[i];
      ch.update(dt, { vx: v.vx[i], vz: v.vz[i], facing: v.f[i], action: v.act[i], actionT: (now - this.actStart[i]) / 1000, y: v.y[i], hasBall: (v.flags[i] & FLAG_BALL) !== 0 });
      const tag = this.tags[i];
      if (tag) tag.visible = i !== you;
    }

    // ball
    const R = PITCH.BALL_R;
    this.ball.position.set(v.bx, v.by, v.bz);
    const sp = Math.hypot(v.bvx, v.bvz);
    if (sp > 0.05) {
      this.ballSpin.set(v.bvz, 0, -v.bvx).normalize();
      this.ball.rotateOnWorldAxis(this.ballSpin, (sp * dt) / R);
    }
    this.ballShadow.position.set(v.bx, 0.04, v.bz);
    this.ballShadow.scale.setScalar(Math.max(0.4, 1 - v.by * 0.25));
    const power = Math.hypot(v.bvx, v.bvy, v.bvz) > 23;
    this.trailPts.unshift(new THREE.Vector3(v.bx, v.by, v.bz));
    if (this.trailPts.length > 16) this.trailPts.pop();
    this.trail.visible = power && this.trailPts.length > 3;
    if (this.trail.visible) {
      const pos = this.trail.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < 16; i++) {
        const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }

    // markers
    const youVisible = you >= 0 && !(youFlags & FLAG_INACTIVE);
    this.ring.visible = this.arrow.visible = youVisible;
    if (youVisible) {
      this.ring.position.set(v.x[you], 0.05, v.z[you]);
      this.arrow.position.set(v.x[you], 2.45 + Math.sin(now / 220) * 0.08, v.z[you]);
      this.arrow.rotation.y = now / 400;
      this.ring.scale.setScalar(1 + Math.sin(now / 250) * 0.05);
    }

    const cs = s.dr?.cones;
    if (cs && !this.cones.length) {
      for (const c of cs) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 14), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x331100 }));
        m.position.set(c.x, 0.45, c.z);
        m.castShadow = true;
        this.scene.add(m);
        this.cones.push(m);
      }
    }
    this.cones.forEach((m, i) => {
      const next = i === s.dr?.next;
      (m.material as THREE.MeshStandardMaterial).color.set(next ? 0x7dff9a : 0xff7a1a);
      (m.material as THREE.MeshStandardMaterial).emissive.set(next ? 0x0b5a1f : 0x331100);
      m.scale.setScalar(next ? 1.25 + Math.sin(now / 160) * 0.12 : 1);
    });
    this.updateCamera(dt, now, s, settings, controls.moving);
    this.world.update(dt, this.camera.position, s.phase === "goal" ? 1 : sp > 18 ? 0.45 : 0.18);
    this.fx.update(dt);
    this.dirt.update(dt);
    this.sfx.setExcite(s.phase === "goal" ? 1 : 0.25);

    // sun follows the action for sharp shadows
    const fx = this.camera.position;
    this.world.sun.position.set(v.bx * 0.5 + 25, 70, v.bz * 0.5 + 18);
    this.world.sun.target.position.set(v.bx * 0.5, 0, v.bz * 0.5);
    void fx;

    this.renderer.render(this.scene, this.camera);

    if (now - this.hudT > 100) {
      this.hudT = now;
      this.emitHud(s, now);
    }
    // finish
    const done = s.phase === "finished" || s.dr?.done;
    if (done && !this.finishedFired) {
      if (!this.finishedAt) this.finishedAt = now;
      if (now - this.finishedAt > (s.dr ? 900 : 3500)) {
        this.finishedFired = true;
        o.onFinished();
      }
    }
  };

  private updateCamera(dt: number, now: number, s: Snapshot, settings: Settings, moving: boolean) {
    const v = this.view;
    const you = this.o.you;
    const cam = this.camera;
    const useTactical = this.tactical || you < 0 || this.ownRed;
    const tx = you >= 0 ? v.x[you] : v.bx;
    const tz = you >= 0 ? v.z[you] : v.bz;
    if (useTactical) {
      const d = new THREE.Vector3(v.bx * 0.7, 36, v.bz * 0.6 + 26);
      this.camPos.lerp(d, 1 - Math.exp(-4 * dt));
      cam.position.copy(this.camPos);
      cam.lookAt(v.bx * 0.8, 0, v.bz * 0.8);
      cam.fov += (54 - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
      return;
    }
    const spd = Math.hypot(v.vx[you], v.vz[you]);
    const sprinting = spd > 6.6;
    this.sprintK += ((sprinting ? 1 : 0) - this.sprintK) * Math.min(1, dt * 2.5);
    // ball-aware assistance only when the player is not actively steering the camera
    if (moving && now - this.input.lastLook > 1400) {
      const bx = v.bx - tx;
      const bz = v.bz - tz;
      const toBall = Math.atan2(bz, bx);
      const toMove = Math.atan2(v.vz[you], v.vx[you]);
      const want = Math.hypot(bx, bz) < 18 ? toBall : toMove;
      const diff = angleDiff(this.yaw, want);
      this.yaw += clamp(diff, -1, 1) * Math.min(1, dt * 0.9);
    }
    const dist = settings.distance + 1.5 * this.sprintK;
    const baseElev = Math.atan2(settings.height, settings.distance);
    const el = clamp(baseElev + this.pitch, 0.1, 1.35);
    const horiz = dist * Math.cos(el);
    const vert = dist * Math.sin(el);
    const target = new THREE.Vector3(tx, 1.35, tz);
    const desired = new THREE.Vector3(tx - Math.cos(this.yaw) * horiz, target.y + vert, tz - Math.sin(this.yaw) * horiz);
    // collision: stay inside the stadium bowl, above the ground, and out of the ad boards
    desired.x = clamp(desired.x, -PITCH.HL - 14, PITCH.HL + 14);
    desired.z = clamp(desired.z, -PITCH.HW - 5, PITCH.HW + 8);
    desired.y = clamp(desired.y, 0.7, 16);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(desired);
    this.camPos.lerp(desired, 1 - Math.exp(-11 * dt));
    const look = new THREE.Vector3(tx + Math.cos(this.yaw) * 4.5, 1.1, tz + Math.sin(this.yaw) * 4.5);
    const bw = clamp(0.16 - Math.hypot(v.bx - tx, v.bz - tz) * 0.004, 0, 0.16);
    look.x += (v.bx - look.x) * bw;
    look.z += (v.bz - look.z) * bw;
    const pos = this.camPos.clone();
    // goal replay-style orbit, blended in and out (never replaces the gameplay camera permanently)
    if (this.goalCam) {
      const g = this.goalCam;
      g.t += dt;
      const dur = 3.6;
      const w = clamp(Math.min(g.t / 0.5, (dur - g.t) / 0.7), 0, 1);
      const e = w * w * (3 - 2 * w);
      const ang = g.a + g.t * 0.9;
      const gp = new THREE.Vector3(g.x + Math.cos(ang) * 7, 2.6, g.z + Math.sin(ang) * 7);
      gp.x = clamp(gp.x, -PITCH.HL - 10, PITCH.HL + 10);
      gp.z = clamp(gp.z, -PITCH.HW - 4, PITCH.HW + 6);
      pos.lerp(gp, e);
      look.lerp(new THREE.Vector3(g.x, 1.3, g.z), e);
      if (g.t > dur) this.goalCam = null;
    }
    this.shake *= Math.exp(-5.5 * dt);
    if (this.shake > 0.003) {
      pos.x += (Math.random() - 0.5) * this.shake * 0.7;
      pos.y += (Math.random() - 0.5) * this.shake * 0.5;
      pos.z += (Math.random() - 0.5) * this.shake * 0.7;
    }
    cam.position.copy(pos);
    cam.lookAt(look);
    const fov = 62 + 7 * this.sprintK + (performance.now() - this.kickT < 120 ? 2 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
    void s;
  }

  private clockText(s: Snapshot) {
    if (s.dr) return s.dr.timeLeft > 0 ? `${Math.floor(s.dr.timeLeft / 60)}:${String(Math.floor(s.dr.timeLeft % 60)).padStart(2, "0")}` : "∞";
    const f = s.hs > 0 ? 45 / s.hs : 1;
    const base = (s.half - 1) * 45;
    if (s.el > s.hs) return `${s.half * 45}+${Math.max(1, Math.ceil((s.el - s.hs) * f))}'`;
    const m = s.el * f + base;
    const sec = Math.floor((m % 1) * 60);
    return `${String(Math.floor(m)).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  private emitHud(s: Snapshot, now: number) {
    const o = this.o;
    const clock = this.clockText(s);
    const phaseTag = s.phase === "halftime" ? "HT" : s.phase === "finished" ? "FT" : s.half === 1 ? "1st half" : "2nd half";
    if (!s.dr) this.world.setScoreboard(o.kits[0].name, o.kits[1].name, s.score[0], s.score[1], clock, phaseTag);
    else this.world.setScoreboard("PRACTICE", s.dr.label, s.dr.value, 0, clock, "");
    const youR = o.roster.find((r) => r.idx === o.you);
    const team = youR?.team ?? 0;
    const mates = o.roster
      .filter((r) => r.team === team)
      .map((r) => {
        const fl = s.players[r.idx]?.[8] ?? 0;
        return { idx: r.idx, name: r.name, role: ROLE_LABEL[r.role], human: r.human, connected: (s.players[r.idx][8] & 1) !== 0 || !r.human ? true : false, ball: (fl & FLAG_BALL) !== 0, red: (fl & FLAG_RED) !== 0 };
      });
    void dirOf;
    o.onHud({
      phase: s.phase,
      score: s.score,
      clock,
      half: s.half,
      stamina: this.pred.ok ? s.players[o.you]?.[6] ?? 100 : 100,
      you: o.you,
      charge: this.input.getCharge(),
      ping: o.source.ping(),
      drill: s.dr,
      setPiece: s.sp ? s.sp.k : "",
      poss: s.poss,
      mates,
      tactical: this.tactical,
      locked: this.input.locked,
    });
    void now;
  }

  get lastSnapshot() {
    return this.last;
  }

  /** Read-only state used by automated browser checks; no gameplay side effects. */
  debugState() {
    const s = this.last;
    return {
      you: this.o.you,
      players: Array.from({ length: 14 }, (_, i) => ({ idx: i, x: this.view.x[i], z: this.view.z[i], act: this.view.act[i], flags: this.view.flags[i] })),
      ball: { x: this.view.bx, z: this.view.bz, owner: this.view.owner },
      snapshot: s ? { phase: s.phase, score: s.score, half: s.half, el: s.el, hs: s.hs, tick: s.tick, ball: s.ball } : null,
      ping: this.o.source.ping(),
    };
  }
  get drillCones() {
    return this.last?.dr?.cones;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.dispose();
    this.sfx.dispose();
    this.world.dispose();
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
