// Procedural stylised footballer rig + animation blending. No external assets required; the builder is
// isolated so a glTF skeleton can later replace it without touching engine code.
import * as THREE from "three";
import { A } from "../shared/constants";
import type { Appearance, Kit } from "../shared/types";

export const SKIN = ["#f6d2b0", "#e8b48a", "#c98d5f", "#a56a3f", "#7a4a2b", "#4e2e1b"];
export const HAIR = ["#2a1b12", "#5a3a1e", "#d8b25a", "#0d0d0d", "#a2381e", "#bdbdbd"];

const geo = {
  torso: new THREE.CapsuleGeometry(0.19, 0.36, 4, 10),
  head: new THREE.SphereGeometry(0.135, 14, 12),
  upperArm: new THREE.CapsuleGeometry(0.052, 0.22, 3, 6),
  foreArm: new THREE.CapsuleGeometry(0.045, 0.2, 3, 6),
  thigh: new THREE.CapsuleGeometry(0.083, 0.3, 3, 8),
  shin: new THREE.CapsuleGeometry(0.06, 0.3, 3, 8),
  boot: new THREE.BoxGeometry(0.11, 0.07, 0.27),
  shorts: new THREE.CylinderGeometry(0.2, 0.22, 0.26, 12),
  hairCap: new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  afro: new THREE.SphereGeometry(0.21, 10, 8),
  longHair: new THREE.CapsuleGeometry(0.1, 0.22, 3, 8),
  tail: new THREE.CapsuleGeometry(0.04, 0.2, 3, 6),
  mohawk: new THREE.BoxGeometry(0.04, 0.1, 0.24),
  numberPlane: new THREE.PlaneGeometry(0.26, 0.26),
  shadow: new THREE.CircleGeometry(0.42, 16),
};

const matCache = new Map<string, THREE.Material>();
function lambert(color: string, rough = 0.85) {
  const k = `l${color}${rough}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    matCache.set(k, m);
  }
  return m;
}

function jerseyMaterial(kit: Kit, gk: boolean) {
  const k = `j${kit.primary}${kit.secondary}${kit.pattern}${gk ? kit.gk : ""}`;
  let m = matCache.get(k);
  if (!m) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const base = gk ? kit.gk : kit.primary;
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = gk ? kit.secondary : kit.secondary;
    if (!gk) {
      if (kit.pattern === "stripes") for (let i = 0; i < 128; i += 32) g.fillRect(i + 8, 0, 14, 128);
      else if (kit.pattern === "hoops") for (let i = 0; i < 128; i += 32) g.fillRect(0, i + 8, 128, 14);
      else if (kit.pattern === "sash") {
        g.save();
        g.translate(64, 64);
        g.rotate(-0.6);
        g.fillRect(-100, -12, 200, 24);
        g.restore();
      }
    } else {
      g.globalAlpha = 0.5;
      for (let i = 0; i < 128; i += 42) g.fillRect(i, 0, 8, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    matCache.set(k, m);
  }
  return m;
}

const numCache = new Map<string, THREE.Material>();
function numberMaterial(n: number, color: string) {
  const k = `${n}${color}`;
  let m = numCache.get(k);
  if (!m) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "900 54px Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeText(String(n), 32, 34);
    g.fillStyle = color;
    g.fillText(String(n), 32, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
    numCache.set(k, m);
  }
  return m;
}

export interface CharOpts {
  kit: Kit;
  gk: boolean;
  number: number;
  appearance: Appearance;
  shadows: boolean;
}

type Joints = Record<(typeof JOINTS)[number], number>;
const JOINTS = ["hlx", "hlz", "hrx", "hrz", "kl", "kr", "sly", "slx", "slz", "srx", "srz", "el", "er", "tx", "ty", "tz", "hx", "brx", "brz", "by"] as const;

export interface MotionIn {
  vx: number;
  vz: number;
  facing: number;
  action: number; // code
  actionT: number; // seconds since the action started
  y: number;
  hasBall: boolean;
}

export class Character {
  root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private cur = {} as Joints;
  private phase = Math.random() * 6;
  private prevFacing = 0;
  private turn = 0;
  private prevFwd = 0;
  private accel = 0;
  shadowBlob: THREE.Mesh;

  constructor(o: CharOpts) {
    for (const j of JOINTS) this.cur[j] = 0;
    this.cur.by = 0.95;
    const skin = lambert(SKIN[o.appearance.skin % 6], 0.7);
    const female = o.appearance.gender === "f";
    const jersey = jerseyMaterial(o.kit, o.gk);
    const sleeve = o.gk ? jersey : lambert(o.kit.primary);
    const shortsM = lambert(o.gk ? "#15171c" : o.kit.secondary);
    const sockM = lambert(o.gk ? o.kit.gk : o.kit.primary);
    const bootM = lambert(o.gk ? "#e8e8e8" : "#111418", 0.5);
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = o.shadows;
      parent.add(mesh);
      return mesh;
    };
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    add(this.hips, geo.shorts, shortsM, 0, -0.04, 0).scale.set(female ? 1.05 : 1, 1, 0.82);
    this.hips.add(this.torso);
    this.torso.position.y = 0.06;
    const tm = add(this.torso, geo.torso, jersey, 0, 0.36, 0);
    tm.scale.set(female ? 1.0 : 1.18, 1, 0.78);
    const num = new THREE.Mesh(geo.numberPlane, numberMaterial(o.number, o.gk ? "#111" : o.kit.secondary));
    num.position.set(0, 0.42, -0.15);
    num.rotation.y = Math.PI;
    this.torso.add(num);
    this.torso.add(this.head);
    this.head.position.y = 0.76;
    add(this.head, geo.head, skin, 0, 0.06, 0);
    this.buildHair(o, this.head);
    const shx = female ? 0.22 : 0.26;
    for (const [sh, el, sx] of [[this.shL, this.elL, 1], [this.shR, this.elR, -1]] as const) {
      this.torso.add(sh);
      sh.position.set(sx * shx, 0.6, 0);
      add(sh, geo.upperArm, sleeve, 0, -0.17, 0);
      sh.add(el);
      el.position.y = -0.33;
      add(el, geo.foreArm, skin, 0, -0.15, 0);
    }
    for (const [hp, kn, sx] of [[this.hipL, this.kneeL, 1], [this.hipR, this.kneeR, -1]] as const) {
      this.hips.add(hp);
      hp.position.set(sx * (female ? 0.12 : 0.105), -0.1, 0);
      add(hp, geo.thigh, skinOrShorts(shortsM, skin), 0, -0.23, 0);
      hp.add(kn);
      kn.position.y = -0.44;
      add(kn, geo.shin, sockM, 0, -0.22, 0);
      add(kn, geo.boot, bootM, 0, -0.43, 0.06);
    }
    this.shadowBlob = new THREE.Mesh(geo.shadow, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.03;
    this.root.add(this.shadowBlob);
    this.root.scale.setScalar(0.96);
  }

  private buildHair(o: CharOpts, head: THREE.Group) {
    const hc = lambert(HAIR[o.appearance.hairColor % 6], 0.8);
    const female = o.appearance.gender === "f";
    const style = o.appearance.hair % 6;
    const mk = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(g, hc);
      m.position.set(x, y, z);
      head.add(m);
      return m;
    };
    if (style === 0 || (style === 1 && female)) mk(geo.hairCap, 0, 0.06, -0.005);
    if (style === 1) mk(geo.hairCap, 0, 0.065, 0).scale.setScalar(1.04);
    if (style === 2) {
      mk(geo.hairCap, 0, 0.07, -0.01);
      mk(geo.longHair, 0, -0.04, -0.1);
    }
    if (style === 3 || (female && style < 2)) {
      mk(geo.hairCap, 0, 0.07, -0.01);
      const t = mk(geo.tail, 0, -0.02, -0.17);
      t.rotation.x = 0.5;
    }
    if (style === 4) mk(geo.afro, 0, 0.11, -0.01);
    if (style === 5) mk(geo.mohawk, 0, 0.2, 0);
  }

  /** Blends toward the target pose for the current locomotion state / action. */
  update(dt: number, m: MotionIn) {
    const speed = Math.hypot(m.vx, m.vz);
    const cf = Math.cos(m.facing);
    const sf = Math.sin(m.facing);
    const fwd = m.vx * cf + m.vz * sf;
    const lat = m.vx * -sf + m.vz * cf; // +right
    const sp = Math.min(1, speed / 8.2);
    let dF = m.facing - this.prevFacing;
    while (dF > Math.PI) dF -= Math.PI * 2;
    while (dF < -Math.PI) dF += Math.PI * 2;
    this.turn += (dF / Math.max(dt, 1e-3) - this.turn) * Math.min(1, dt * 8);
    this.prevFacing = m.facing;
    this.accel += ((fwd - this.prevFwd) / Math.max(dt, 1e-3) - this.accel) * Math.min(1, dt * 8);
    this.prevFwd = fwd;
    this.phase += speed * dt * 1.15;
    const ph = this.phase;
    const t: Joints = {} as Joints;
    for (const j of JOINTS) t[j] = 0;
    t.by = 0.95;
    const strafe = Math.abs(lat) > Math.abs(fwd) && speed > 1.5;
    const amp = speed < 0.4 ? 0 : 0.2 + 0.8 * sp;
    const dirSign = fwd < -0.5 ? -1 : 1;
    const s1 = Math.sin(ph);
    if (!strafe) {
      t.hlx = s1 * 0.95 * amp * dirSign;
      t.hrx = -s1 * 0.95 * amp * dirSign;
      t.kl = Math.max(0, Math.sin(ph + 1.9)) * 1.35 * amp;
      t.kr = Math.max(0, Math.sin(ph + 1.9 + Math.PI)) * 1.35 * amp;
    } else {
      t.hlz = s1 * 0.5 * Math.sign(lat);
      t.hrz = -s1 * 0.5 * Math.sign(lat);
      t.kl = Math.max(0, Math.sin(ph + 1.9)) * 0.8;
      t.kr = Math.max(0, Math.sin(ph + 1.9 + Math.PI)) * 0.8;
    }
    t.slx = -s1 * 0.85 * amp * dirSign;
    t.srx = s1 * 0.85 * amp * dirSign;
    t.el = -(0.3 + 0.9 * sp);
    t.er = -(0.3 + 0.9 * sp);
    t.slz = 0.12;
    t.srz = -0.12;
    t.tx = 0.04 + 0.32 * sp + Math.max(-0.2, Math.min(0.25, this.accel * 0.018)) + (m.hasBall ? 0.05 : 0);
    t.tz = Math.max(-0.35, Math.min(0.35, this.turn * 0.045)) + (strafe ? -Math.sign(lat) * 0.1 : 0);
    t.ty = -s1 * 0.18 * amp;
    t.by = 0.95 + (speed < 0.3 ? Math.sin(performance.now() / 600 + this.phase) * 0.004 : Math.abs(Math.sin(ph)) * -0.05 * amp - 0.04 * sp);
    t.hx = -0.1 * sp;
    let fast = false;
    const T = m.actionT;
    const code = m.action & 31;
    const kick = (big: number, back = 1) => {
      let v: number;
      if (T < 0.14) v = (T / 0.14) * 0.8 * big;
      else if (T < 0.26) v = 0.8 * big + ((T - 0.14) / 0.12) * (-1.3 * big - 0.8 * big);
      else v = -1.3 * big * Math.max(0, 1 - (T - 0.26) / 0.3);
      t.hrx = v * back;
      t.kr = T < 0.14 ? 1.3 * big : T < 0.26 ? 0.15 : 0.4;
      t.hlx = -0.2;
      t.kl = 0.25;
      t.tx = T < 0.14 ? -0.1 * big : 0.25 * big;
      t.slz = 0.7;
      t.srz = -0.7;
      t.slx = 0;
      t.srx = 0;
      fast = true;
    };
    switch (code) {
      case A.PASS:
      case A.THROUGH:
      case A.GKKICK:
        if (T < 0.6) kick(code === A.GKKICK ? 1.1 : 0.55);
        break;
      case A.LONG:
      case A.CROSS:
        if (T < 0.6) kick(0.95);
        break;
      case A.SHOOT:
      case A.VOLLEY:
        if (T < 0.7) {
          kick(1.15);
          if (code === A.VOLLEY) t.brx = -0.5;
        }
        break;
      case A.HEADER:
        t.tx = T < 0.2 ? -0.5 : 0.6;
        t.hlx = -0.5;
        t.hrx = 0.6;
        t.kl = 0.6;
        t.kr = 0.9;
        t.slx = -2.2;
        t.srx = -2.2;
        t.slz = 0.8;
        t.srz = -0.8;
        t.hx = T < 0.2 ? 0.4 : -0.5;
        fast = true;
        break;
      case A.JUMP:
        t.hlx = -0.6;
        t.hrx = 0.2;
        t.kl = 1.0;
        t.kr = 0.7;
        t.slx = -2.4;
        t.srx = -2.4;
        t.slz = 0.5;
        t.srz = -0.5;
        fast = true;
        break;
      case A.SLIDE: {
        const lying = T > 0.1 && T < 0.62;
        const up = T >= 0.62;
        t.brx = lying ? -1.42 : up ? -0.5 : -0.7;
        t.by = lying ? 0.32 : up ? 0.62 : 0.7;
        t.hrx = -0.15;
        t.kr = 0.05;
        t.hlx = 0.5;
        t.kl = 1.4;
        t.slx = 0.3;
        t.srx = 0.3;
        t.slz = 0.9;
        t.srz = -0.9;
        t.tx = 0.0;
        fast = true;
        break;
      }
      case A.TACKLE:
        t.hrx = -1.1;
        t.kr = 0.25;
        t.hlx = 0.4;
        t.kl = 0.9;
        t.tx = 0.55;
        t.slx = -0.8;
        t.srx = 0.6;
        t.by = 0.85;
        fast = true;
        break;
      case A.FALL:
        t.brx = 1.45;
        t.by = 0.24;
        t.slx = -2.4;
        t.srx = -2.4;
        t.hlx = 0.3;
        t.hrx = -0.2;
        t.tx = 0.0;
        fast = true;
        break;
      case A.GETUP:
        t.brx = 0.55 * (1 - Math.min(1, T / 0.5));
        t.by = 0.55 + 0.4 * Math.min(1, T / 0.5);
        t.kl = 1.5;
        t.kr = 1.3;
        t.hlx = -1.0;
        t.hrx = -0.8;
        t.slx = -0.8;
        t.srx = -0.4;
        t.tx = 0.5;
        fast = true;
        break;
      case A.CELEB: {
        const k = Math.abs(Math.sin(T * 8));
        t.slx = -2.9;
        t.srx = -2.9;
        t.slz = 0.5;
        t.srz = -0.5;
        t.el = -0.3;
        t.er = -0.3;
        t.by = 0.95 + k * 0.28;
        t.hlx = -k * 0.6;
        t.hrx = -k * 0.4;
        t.kl = k * 0.8;
        t.kr = k * 0.8;
        t.ty = Math.sin(T * 6) * 0.4;
        t.hx = -0.3;
        t.tx = -0.1;
        break;
      }
      case A.DIVE: {
        const s = lat >= 0 ? 1 : -1;
        t.brz = 1.3 * s;
        t.brx = 0.15;
        t.by = 0.62;
        t.slx = -3.0;
        t.srx = -3.0;
        t.slz = 0.25;
        t.srz = -0.25;
        t.hlx = -0.3;
        t.hrx = 0.3;
        t.kl = 0.4;
        t.kr = 0.2;
        fast = true;
        break;
      }
      case A.CATCH:
        t.slx = -1.7;
        t.srx = -1.7;
        t.el = -0.4;
        t.er = -0.4;
        t.slz = 0.2;
        t.srz = -0.2;
        t.tx = 0.3;
        t.kl = 0.5;
        t.kr = 0.5;
        t.hlx = -0.4;
        t.hrx = -0.4;
        t.by = 0.85;
        fast = true;
        break;
      case A.CONTROL:
        if (T < 0.35) {
          t.hrx = -0.55;
          t.kr = 0.9;
          t.tx = 0.15;
          fast = true;
        }
        break;
    }
    const k = 1 - Math.exp(-dt * (fast ? 26 : 16));
    for (const j of JOINTS) this.cur[j] += (t[j] - this.cur[j]) * k;
    const c = this.cur;
    this.hips.position.y = c.by + m.y;
    this.hips.rotation.set(c.brx, 0, c.brz);
    this.torso.rotation.set(c.tx, c.ty, c.tz);
    this.head.rotation.x = c.hx;
    this.hipL.rotation.set(c.hlx, 0, c.hlz);
    this.hipR.rotation.set(c.hrx, 0, c.hrz);
    this.kneeL.rotation.x = c.kl;
    this.kneeR.rotation.x = c.kr;
    this.shL.rotation.set(c.slx, c.sly, c.slz);
    this.shR.rotation.set(c.srx, 0, c.srz);
    this.elL.rotation.x = c.el;
    this.elR.rotation.x = c.er;
    const sh = Math.max(0.4, 1 - m.y * 0.4);
    this.shadowBlob.scale.setScalar(sh);
  }
}

function skinOrShorts(shorts: THREE.Material, _skin: THREE.Material) {
  void _skin;
  return shorts;
}
