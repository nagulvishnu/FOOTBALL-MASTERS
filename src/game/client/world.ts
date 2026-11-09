// 3D world: regulation pitch (105 x 68 m), goals + nets, five stadium styles, instanced crowd, sky, weather.
import * as THREE from "three";
import { PITCH } from "../shared/constants";
import type { StadiumId } from "../shared/constants";

export type Quality = "low" | "medium" | "high";
export interface WorldOpts {
  stadium: StadiumId;
  time: "day" | "evening" | "night";
  weather: "clear" | "cloudy" | "rain";
  quality: Quality;
  teamColors: [string, string];
}

interface Style {
  stand: number;
  seats: string[];
  roof: "full" | "sides" | "none";
  roofColor: number;
  accent: number;
  glow: boolean;
  palms: boolean;
  ads: string[];
}

const STYLES: Record<StadiumId, Style> = {
  international: { stand: 0x4b5870, seats: ["#2f6fdd", "#e8eefc", "#2a3f7a", "#9bb7f0"], roof: "full", roofColor: 0xe8ecf4, accent: 0xffffff, glow: false, palms: false, ads: ["#0b3d91", "#c8102e", "#ffffff", "#111827"] },
  classic: { stand: 0x8a3f31, seats: ["#c0392b", "#f2e8d5", "#8e2a20", "#d9a066"], roof: "sides", roofColor: 0x3a3d45, accent: 0xf2e8d5, glow: false, palms: false, ads: ["#14532d", "#f2e8d5", "#7c2d12", "#1e3a8a"] },
  neon: { stand: 0x15112b, seats: ["#ff2bd6", "#22e5ff", "#7a5cff", "#1b1740"], roof: "full", roofColor: 0x0d0a1f, accent: 0x22e5ff, glow: true, palms: false, ads: ["#ff2bd6", "#22e5ff", "#7a5cff", "#0d0a1f"] },
  tropical: { stand: 0xe0c9a0, seats: ["#00b8a9", "#ff7a59", "#fff2cc", "#2bb673"], roof: "none", roofColor: 0xffffff, accent: 0xff7a59, glow: false, palms: true, ads: ["#00b8a9", "#ff7a59", "#fff2cc", "#0f766e"] },
  championship: { stand: 0x222630, seats: ["#d4af37", "#1b1f2a", "#f5e6a8", "#3b4252"], roof: "full", roofColor: 0x15171d, accent: 0xd4af37, glow: false, palms: false, ads: ["#d4af37", "#111827", "#f5e6a8", "#7c1d2e"] },
};

const SKY = {
  day: { top: 0x3a8ee6, bottom: 0xcfe8ff, fog: 0xbcd9f2, sun: 3.0, hemi: 1.1, sunColor: 0xfff3d6, lights: 0 },
  evening: { top: 0x3b3f8f, bottom: 0xffa45c, fog: 0xd89a72, sun: 1.8, hemi: 0.7, sunColor: 0xffb877, lights: 0.7 },
  night: { top: 0x04061a, bottom: 0x1a2147, fog: 0x0b1030, sun: 0.35, hemi: 0.38, sunColor: 0x9db4ff, lights: 1 },
};

const rnd = (() => {
  let s = 12345;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
})();

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makePitchTexture(ppm: number) {
  const mx = 6;
  const W = (PITCH.L + mx * 2) * ppm;
  const H = (PITCH.W + mx * 2) * ppm;
  const X = (x: number) => (x + PITCH.HL + mx) * ppm;
  const Z = (z: number) => (z + PITCH.HW + mx) * ppm;
  return canvasTex(W, H, (g) => {
    const stripes = 14;
    const sw = W / stripes;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? "#2f8f3a" : "#38a244";
      g.fillRect(i * sw, 0, sw + 1, H);
    }
    // diagonal mow shading + noise
    for (let i = 0; i < 16000; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "10,60,20" : "170,230,120"},${0.03 + rnd() * 0.05})`;
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 1);
    }
    const grd = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
    grd.addColorStop(0, "rgba(255,255,255,0.05)");
    grd.addColorStop(1, "rgba(0,0,0,0.22)");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,0.93)";
    g.fillStyle = "rgba(255,255,255,0.93)";
    g.lineWidth = Math.max(2, 0.13 * ppm);
    const line = (x1: number, z1: number, x2: number, z2: number) => {
      g.beginPath();
      g.moveTo(X(x1), Z(z1));
      g.lineTo(X(x2), Z(z2));
      g.stroke();
    };
    const rect = (x1: number, z1: number, x2: number, z2: number) => g.strokeRect(X(x1), Z(z1), (x2 - x1) * ppm, (z2 - z1) * ppm);
    const dot = (x: number, z: number, r = 0.22) => {
      g.beginPath();
      g.arc(X(x), Z(z), r * ppm, 0, Math.PI * 2);
      g.fill();
    };
    const arc = (x: number, z: number, r: number, a0: number, a1: number) => {
      g.beginPath();
      g.arc(X(x), Z(z), r * ppm, a0, a1);
      g.stroke();
    };
    rect(-PITCH.HL, -PITCH.HW, PITCH.HL, PITCH.HW);
    line(0, -PITCH.HW, 0, PITCH.HW);
    arc(0, 0, PITCH.CIRCLE, 0, Math.PI * 2);
    dot(0, 0);
    for (const s of [-1, 1]) {
      const gx = s * PITCH.HL;
      rect(Math.min(gx, gx - s * PITCH.PEN_D), -PITCH.PEN_W / 2, Math.max(gx, gx - s * PITCH.PEN_D), PITCH.PEN_W / 2);
      rect(Math.min(gx, gx - s * PITCH.GA_D), -PITCH.GA_W / 2, Math.max(gx, gx - s * PITCH.GA_D), PITCH.GA_W / 2);
      const sx = gx - s * PITCH.SPOT;
      dot(sx, 0);
      // penalty arc: only the part outside the penalty area
      const a = Math.acos((PITCH.PEN_D - PITCH.SPOT) / PITCH.CIRCLE);
      if (s > 0) arc(sx, 0, PITCH.CIRCLE, Math.PI - a, Math.PI + a);
      else arc(sx, 0, PITCH.CIRCLE, -a, a);
    }
    // corner arcs
    arc(-PITCH.HL, -PITCH.HW, 1, 0, Math.PI / 2);
    arc(PITCH.HL, -PITCH.HW, 1, Math.PI / 2, Math.PI);
    arc(PITCH.HL, PITCH.HW, 1, Math.PI, Math.PI * 1.5);
    arc(-PITCH.HL, PITCH.HW, 1, Math.PI * 1.5, Math.PI * 2);
    // technical areas + substitution zone (south touchline)
    g.strokeStyle = "rgba(255,255,255,0.7)";
    rect(-18, PITCH.HW + 1.2, -4, PITCH.HW + 4.6);
    rect(4, PITCH.HW + 1.2, 18, PITCH.HW + 4.6);
    g.strokeStyle = "rgba(255,210,60,0.9)";
    line(-2.5, PITCH.HW, -2.5, PITCH.HW + 1.4);
    line(2.5, PITCH.HW, 2.5, PITCH.HW + 1.4);
  });
}

function netTexture() {
  return canvasTex(
    128,
    128,
    (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 3;
      for (let i = 0; i <= 128; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 128);
        g.moveTo(0, i);
        g.lineTo(128, i);
        g.stroke();
      }
    },
    false,
  );
}

export interface World {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(dt: number, camPos: THREE.Vector3, excite: number): void;
  setScoreboard(a: string, b: string, sa: number, sb: number, clock: string, tag: string): void;
  netHit(sx: number, v: number): void;
  setCrowdExcite(v: number): void;
  dispose(): void;
}

export function buildWorld(scene: THREE.Scene, o: WorldOpts): World {
  const style = STYLES[o.stadium];
  const sky = SKY[o.time];
  const group = new THREE.Group();
  scene.add(group);
  const q = o.quality;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);

  // ---------- sky + fog + lights
  const fogDensity = o.weather === "clear" ? 0.0016 : o.weather === "cloudy" ? 0.004 : 0.0055;
  scene.fog = new THREE.FogExp2(sky.fog, fogDensity);
  const gray = o.weather === "clear" ? 0 : o.weather === "cloudy" ? 0.45 : 0.6;
  const skyTop = new THREE.Color(sky.top).lerp(new THREE.Color(0x667080), gray);
  const skyBot = new THREE.Color(sky.bottom).lerp(new THREE.Color(0x9aa3ad), gray);
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: skyTop }, bot: { value: skyBot } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*1.4+0.1,0.0,1.0); gl_FragColor = vec4(mix(bot,top,pow(h,0.8)),1.0); }",
    }),
  );
  const skyMesh = new THREE.Mesh(track(new THREE.SphereGeometry(520, 24, 12)), skyMat);
  group.add(skyMesh);
  if (o.time === "night" && o.weather !== "rain") {
    const pts = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = rnd() * 1.2 + 0.1;
      pts.set([Math.cos(th) * Math.cos(ph) * 480, Math.sin(ph) * 480, Math.sin(th) * Math.cos(ph) * 480], i * 3);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    group.add(new THREE.Points(g, track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }))));
  }
  const hemi = new THREE.HemisphereLight(o.time === "night" ? 0x6f86d6 : 0xdfeeff, 0x2b3a22, sky.hemi * (1 - gray * 0.25));
  group.add(hemi);
  const sun = new THREE.DirectionalLight(sky.sunColor, sky.sun * (1 - gray * 0.55));
  sun.position.set(40, 70, 30);
  sun.castShadow = q !== "low";
  const sz = q === "high" ? 2048 : 1024;
  sun.shadow.mapSize.set(sz, sz);
  const sc = sun.shadow.camera;
  sc.left = -32;
  sc.right = 32;
  sc.top = 32;
  sc.bottom = -32;
  sc.near = 10;
  sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);

  // ---------- pitch + surroundings
  const ppm = q === "high" ? 24 : q === "medium" ? 16 : 10;
  const pitchTex = track(makePitchTexture(ppm));
  const pitch = new THREE.Mesh(
    track(new THREE.PlaneGeometry(PITCH.L + 12, PITCH.W + 12)),
    track(new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95, metalness: 0 })),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = q !== "low";
  group.add(pitch);
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(900, 900)),
    track(new THREE.MeshStandardMaterial({ color: o.stadium === "tropical" ? 0xe6d3a3 : 0x2c3b2c, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // ---------- goals + nets + corner flags
  const netTex = track(netTexture());
  const netMat = track(new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.8 }));
  const postMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 }));
  const backNets: Record<number, { mesh: THREE.Mesh; base: number; spring: number; vel: number }> = {};
  const gw = PITCH.GOAL_W;
  const gh = PITCH.GOAL_H;
  const gd = PITCH.GOAL_D;
  const postGeo = track(new THREE.CylinderGeometry(0.06, 0.06, gh, 8));
  const barGeo = track(new THREE.CylinderGeometry(0.06, 0.06, gw + 0.12, 8));
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.x = sx * PITCH.HL;
    for (const sz2 of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(0, gh / 2, sz2 * gw / 2);
      p.castShadow = q === "high";
      g.add(p);
      const back = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, gh + 0.4, 6)), postMat);
      back.position.set(sx * gd, gh / 2, sz2 * gw / 2);
      g.add(back);
    }
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, gh, 0);
    g.add(bar);
    const mkNet = (w: number, h: number, repX: number, repY: number) => {
      const geo = track(new THREE.PlaneGeometry(w, h));
      const m = new THREE.Mesh(geo, netMat);
      void repX;
      void repY;
      return m;
    };
    const back = mkNet(gw, gh, 1, 1);
    back.rotation.y = Math.PI / 2;
    back.position.set(sx * gd, gh / 2, 0);
    g.add(back);
    backNets[sx] = { mesh: back, base: sx * gd, spring: 0, vel: 0 };
    for (const sz2 of [-1, 1]) {
      const side = mkNet(gd, gh, 1, 1);
      side.position.set(sx * gd / 2, gh / 2, sz2 * gw / 2);
      g.add(side);
    }
    const top = mkNet(gd, gw, 1, 1);
    top.rotation.x = Math.PI / 2;
    top.position.set(sx * gd / 2, gh, 0);
    g.add(top);
    group.add(g);
  }
  const flagMat = track(new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
  const flagPole = track(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6));
  const flagGeo = track(new THREE.PlaneGeometry(0.4, 0.3));
  for (const sx of [-1, 1])
    for (const sz2 of [-1, 1]) {
      const p = new THREE.Mesh(flagPole, postMat);
      p.position.set(sx * PITCH.HL, 0.75, sz2 * PITCH.HW);
      const f = new THREE.Mesh(flagGeo, flagMat);
      f.position.set(sx * PITCH.HL - sx * 0.2, 1.35, sz2 * PITCH.HW);
      group.add(p, f);
    }

  // ---------- advertising boards
  const adTex = track(
    canvasTex(2048, 64, (g) => {
      const names = ["MASTERS", "KICKOFF", "NOVA SPORT", "ARENA+", "GOALZONE", "VELOCITY", "STRIKER", "PITCHPRO"];
      const w = 2048 / names.length;
      names.forEach((n, i) => {
        g.fillStyle = style.ads[i % style.ads.length];
        g.fillRect(i * w, 0, w, 64);
        const light = ["#ffffff", "#f2e8d5", "#fff2cc", "#f5e6a8", "#d4af37", "#22e5ff"].includes(style.ads[i % style.ads.length]);
        g.fillStyle = light ? "#111" : "#fff";
        g.font = "bold 38px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(n, i * w + w / 2, 34);
      });
    }),
  );
  adTex.wrapS = THREE.RepeatWrapping;
  const adMats = [0, 1].map((i) => {
    const t = adTex.clone();
    t.repeat.set(i ? 1 : 2.2, 1);
    t.needsUpdate = true;
    return track(new THREE.MeshStandardMaterial({ map: track(t), emissive: 0xffffff, emissiveMap: t, emissiveIntensity: o.time === "night" ? 0.9 : 0.25, roughness: 0.6 }));
  });
  const ad = (w: number, x: number, z: number, ry: number, m: THREE.Material) => {
    const b = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.9, 0.15)), m);
    b.position.set(x, 0.45, z);
    b.rotation.y = ry;
    group.add(b);
  };
  ad(PITCH.L + 8, 0, -PITCH.HW - 3.2, 0, adMats[0]);
  ad(PITCH.L + 8, 0, PITCH.HW + 6.2, Math.PI, adMats[0]);
  ad(PITCH.W + 12, -PITCH.HL - 6.5, 0, Math.PI / 2, adMats[1]);
  ad(PITCH.W + 12, PITCH.HL + 6.5, 0, -Math.PI / 2, adMats[1]);

  // ---------- stands + crowd (instanced)
  const rows = q === "high" ? 16 : q === "medium" ? 11 : 7;
  const rowD = 0.95;
  const rowH = 0.7;
  const spacing = q === "low" ? 1.3 : q === "medium" ? 1.0 : 0.85;
  const standMat = track(new THREE.MeshStandardMaterial({ color: style.stand, roughness: 0.9 }));
  const trimMat = track(new THREE.MeshStandardMaterial({ color: style.accent, emissive: style.glow ? style.accent : 0x000000, emissiveIntensity: style.glow ? 1.2 : 0, roughness: 0.5 }));
  type Side = { cx: number; cz: number; len: number; dirX: number; dirZ: number };
  const sides: Side[] = [
    { cx: 0, cz: -(PITCH.HW + 8), len: PITCH.L + 14, dirX: 0, dirZ: -1 },
    { cx: 0, cz: PITCH.HW + 11, len: PITCH.L + 14, dirX: 0, dirZ: 1 },
    { cx: -(PITCH.HL + 11), cz: 0, len: PITCH.W + 22, dirX: -1, dirZ: 0 },
    { cx: PITCH.HL + 11, cz: 0, len: PITCH.W + 22, dirX: 1, dirZ: 0 },
  ];
  const seats: { x: number; y: number; z: number; ry: number }[] = [];
  for (const s of sides) {
    const alongX = s.dirZ !== 0;
    for (let r = 0; r < rows; r++) {
      const off = r * rowD;
      const h = (r + 1) * rowH;
      const tier = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? s.len : rowD, h, alongX ? rowD : s.len)), standMat);
      tier.position.set(s.cx + s.dirX * off, h / 2 - 0.05, s.cz + s.dirZ * off);
      group.add(tier);
      const n = Math.floor(s.len / spacing) - 2;
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.12) continue;
        const a = -s.len / 2 + 1 + i * spacing;
        seats.push({
          x: alongX ? s.cx + a : s.cx + s.dirX * off,
          y: h + 0.35,
          z: alongX ? s.cz + s.dirZ * off : s.cz + a,
          ry: Math.atan2(-s.dirX, -s.dirZ),
        });
      }
    }
    // front wall trim
    const trim = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? s.len : 0.3, 0.5, alongX ? 0.3 : s.len)), trimMat);
    trim.position.set(s.cx - s.dirX * 0.7, 0.6, s.cz - s.dirZ * 0.7);
    group.add(trim);
  }
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.15 } };
  const patch = (m: THREE.Material) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.uniforms.uExcite = uniforms.uExcite;
      sh.vertexShader =
        "uniform float uTime; uniform float uExcite;\n" +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x*1.7 + instanceMatrix[3].z*2.3;
          transformed.y += max(0.0, sin(uTime*(3.0+uExcite*7.0) + ph)) * (0.025 + 0.2*uExcite);
          #endif`,
        );
    };
    return m;
  };
  const bodyGeo = track(new THREE.BoxGeometry(0.46, 0.62, 0.3));
  const headGeo = track(new THREE.SphereGeometry(0.14, 6, 5));
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, track(patch(new THREE.MeshLambertMaterial({ color: 0xffffff }))), seats.length);
  const headMesh = new THREE.InstancedMesh(headGeo, track(patch(new THREE.MeshLambertMaterial({ color: 0xffffff }))), seats.length);
  const skins = ["#f1c9a5", "#e0ac84", "#c68642", "#8d5524", "#5c3a21", "#ffdbac"];
  const palette = [...style.seats, o.teamColors[0], o.teamColors[1], o.teamColors[0], o.teamColors[1]];
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  seats.forEach((s, i) => {
    m4.makeRotationY(s.ry);
    m4.setPosition(s.x, s.y, s.z);
    bodyMesh.setMatrixAt(i, m4);
    bodyMesh.setColorAt(i, col.set(palette[Math.floor(rnd() * palette.length)]));
    m4.setPosition(s.x, s.y + 0.46, s.z);
    headMesh.setMatrixAt(i, m4);
    headMesh.setColorAt(i, col.set(skins[Math.floor(rnd() * skins.length)]));
  });
  bodyMesh.frustumCulled = false;
  headMesh.frustumCulled = false;
  group.add(bodyMesh, headMesh);

  // ---------- roof + structure
  const roofMat = track(new THREE.MeshStandardMaterial({ color: style.roofColor, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
  if (style.roof !== "none") {
    for (const s of sides) {
      const alongX = s.dirZ !== 0;
      if (style.roof === "sides" && !alongX) continue;
      const depth = rows * rowD + 6;
      const roof = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? s.len + 4 : depth, 0.35, alongX ? depth : s.len + 4)), roofMat);
      const hgt = rows * rowH + 10;
      roof.position.set(s.cx + s.dirX * (rows * rowD * 0.55), hgt, s.cz + s.dirZ * (rows * rowD * 0.55));
      if (alongX) roof.rotation.x = -s.dirZ * 0.12;
      else roof.rotation.z = s.dirX * 0.12;
      group.add(roof);
      const edge = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? s.len + 4 : 0.3, 0.3, alongX ? 0.3 : s.len + 4)), trimMat);
      edge.position.set(s.cx + s.dirX * (rows * rowD * 0.55 - depth / 2 + 0.2), hgt - 0.6, s.cz + s.dirZ * (rows * rowD * 0.55 - depth / 2 + 0.2));
      group.add(edge);
      const pillarGeo = track(new THREE.CylinderGeometry(0.35, 0.35, hgt, 8));
      const count = Math.floor(s.len / 24);
      for (let i = 0; i <= count; i++) {
        const a = -s.len / 2 + (i * s.len) / count;
        const p = new THREE.Mesh(pillarGeo, standMat);
        p.position.set(alongX ? s.cx + a : s.cx + s.dirX * (rows * rowD + 1.5), hgt / 2, alongX ? s.cz + s.dirZ * (rows * rowD + 1.5) : s.cz + a);
        group.add(p);
      }
    }
  }
  let tubeMat: THREE.MeshBasicMaterial | null = null;
  if (o.stadium === "neon") {
    const tm = track(new THREE.MeshBasicMaterial({ color: 0xff2bd6 }));
    tubeMat = tm;
    for (const s of sides) {
      const alongX = s.dirZ !== 0;
      const t = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? s.len : 0.2, 0.2, alongX ? 0.2 : s.len)), tm);
      t.position.set(s.cx + s.dirX * 3, 1.6, s.cz + s.dirZ * 3);
      group.add(t);
    }
  }
  if (style.palms) {
    const trunkGeo = track(new THREE.CylinderGeometry(0.2, 0.32, 9, 6));
    const leafGeo = track(new THREE.ConeGeometry(3.2, 1.2, 7));
    const trunkMat = track(new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    const leafMat = track(new THREE.MeshLambertMaterial({ color: 0x1f9d55 }));
    const n = 26;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * 105;
      const z = Math.sin(a) * 82;
      const h = 0.85 + rnd() * 0.5;
      m4.makeScale(1, h, 1);
      m4.setPosition(x, 4.5 * h, z);
      trunks.setMatrixAt(i, m4);
      m4.makeScale(1, 1, 1);
      m4.setPosition(x, 9.2 * h, z);
      leaves.setMatrixAt(i * 2, m4);
      m4.makeScale(0.7, 1, 0.7);
      m4.setPosition(x, 9.9 * h, z);
      leaves.setMatrixAt(i * 2 + 1, m4);
    }
    group.add(trunks, leaves);
  }

  // ---------- floodlight towers
  const towerMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.6, metalness: 0.5 }));
  const panelMat = track(new THREE.MeshBasicMaterial({ color: o.time === "day" ? 0xdfe6f0 : 0xfff6d0, fog: false }));
  const spots: THREE.SpotLight[] = [];
  for (const sx of [-1, 1])
    for (const sz2 of [-1, 1]) {
      const x = sx * (PITCH.HL + 22);
      const z = sz2 * (PITCH.HW + 26);
      const tower = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.9, 44, 8)), towerMat);
      tower.position.set(x, 22, z);
      const panel = new THREE.Mesh(track(new THREE.BoxGeometry(9, 5, 0.6)), panelMat);
      panel.position.set(x, 45, z);
      panel.lookAt(0, 20, 0);
      group.add(tower, panel);
      if (sky.lights > 0) {
        const sp = new THREE.SpotLight(0xfff0cf, 3200 * sky.lights, 220, 0.62, 0.6, 1.6);
        sp.position.set(x, 44, z);
        sp.target.position.set(0, 0, 0);
        group.add(sp, sp.target);
        spots.push(sp);
      }
    }

  // ---------- scoreboard
  const sbCanvas = document.createElement("canvas");
  sbCanvas.width = 1024;
  sbCanvas.height = 256;
  const sbTex = track(new THREE.CanvasTexture(sbCanvas));
  sbTex.colorSpace = THREE.SRGBColorSpace;
  const sbMat = track(new THREE.MeshBasicMaterial({ map: sbTex, fog: false }));
  for (const sx of [-1, 1]) {
    const sb = new THREE.Mesh(track(new THREE.BoxGeometry(24, 6, 0.8)), [towerMat, towerMat, towerMat, towerMat, sbMat, towerMat]);
    sb.position.set(sx * (PITCH.HL + 8 + rows * rowD * 0.5), rows * rowH + 6.5, 0);
    sb.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(sb);
  }
  const sbCtx = sbCanvas.getContext("2d")!;
  let sbKey = "";
  const setScoreboard: World["setScoreboard"] = (a, b, sa, sb, clock, tag) => {
    const key = `${a}|${b}|${sa}|${sb}|${clock}|${tag}`;
    if (key === sbKey) return;
    sbKey = key;
    const g = sbCtx;
    g.fillStyle = "#06080f";
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = o.teamColors[0];
    g.fillRect(0, 0, 18, 256);
    g.fillStyle = o.teamColors[1];
    g.fillRect(1006, 0, 18, 256);
    g.textAlign = "center";
    g.fillStyle = "#ffd23f";
    g.font = "900 120px Impact, sans-serif";
    g.fillText(`${sa} - ${sb}`, 512, 130);
    g.fillStyle = "#fff";
    g.font = "bold 46px sans-serif";
    g.fillText(a.toUpperCase(), 230, 90);
    g.fillText(b.toUpperCase(), 794, 90);
    g.fillStyle = "#7dff9a";
    g.font = "bold 64px monospace";
    g.fillText(clock, 512, 220);
    g.fillStyle = "#9aa3b2";
    g.font = "bold 34px sans-serif";
    g.fillText(tag, 150, 220);
    sbTex.needsUpdate = true;
  };
  setScoreboard("Team A", "Team B", 0, 0, "00:00", "");

  // ---------- tunnel + benches
  const tunnel = new THREE.Mesh(track(new THREE.BoxGeometry(7, 3.4, 5)), track(new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 1 })));
  tunnel.position.set(0, 1.7, -(PITCH.HW + 8) + 1.8);
  group.add(tunnel);
  const benchMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2f3a }));
  const canopyMat = track(new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35 }));
  for (const bx of [-11, 11]) {
    const seat = new THREE.Mesh(track(new THREE.BoxGeometry(9, 0.5, 0.9)), benchMat);
    seat.position.set(bx, 0.55, PITCH.HW + 5.2);
    const canopy = new THREE.Mesh(track(new THREE.BoxGeometry(10, 0.1, 2.6)), canopyMat);
    canopy.position.set(bx, 2.3, PITCH.HW + 4.9);
    group.add(seat, canopy);
  }

  // ---------- rain
  let rain: THREE.LineSegments | null = null;
  const rainN = o.weather === "rain" ? (q === "high" ? 1800 : q === "medium" ? 1000 : 500) : 0;
  const rainPos = new Float32Array(rainN * 6);
  if (rainN) {
    for (let i = 0; i < rainN; i++) {
      const x = (rnd() - 0.5) * 80;
      const y = rnd() * 40;
      const z = (rnd() - 0.5) * 80;
      rainPos.set([x, y, z, x - 0.1, y - 1.1, z], i * 6);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
    rain = new THREE.LineSegments(g, track(new THREE.LineBasicMaterial({ color: 0xbcd0e8, transparent: true, opacity: 0.45, fog: false })));
    rain.frustumCulled = false;
    group.add(rain);
  }

  let excite = 0.15;
  let t = 0;
  return {
    group,
    sun,
    update(dt, camPos, ex) {
      t += dt;
      excite += (ex - excite) * Math.min(1, dt * 2);
      uniforms.uTime.value = t;
      uniforms.uExcite.value = excite;
      skyMesh.position.copy(camPos);
      if (rain) {
        const a = rain.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < rainN; i++) {
          const k = i * 6;
          rainPos[k + 1] -= 32 * dt;
          rainPos[k + 4] -= 32 * dt;
          if (rainPos[k + 1] < 0) {
            rainPos[k + 1] += 40;
            rainPos[k + 4] += 40;
          }
        }
        a.needsUpdate = true;
        rain.position.set(camPos.x, 0, camPos.z);
      }
      for (const k of [-1, 1]) {
        const n = backNets[k];
        n.vel += (-n.spring * 90 - n.vel * 7) * dt;
        n.spring += n.vel * dt;
        n.mesh.position.x = n.base + k * n.spring;
      }
      if (tubeMat) tubeMat.color.setHSL(0.85 + Math.sin(t * 1.5) * 0.08, 1, 0.55);
      for (const s of spots) s.intensity = 3200 * sky.lights * (0.96 + Math.sin(t * 30) * 0.01);
    },
    setScoreboard,
    netHit(sx, v) {
      const n = backNets[sx];
      if (n) n.vel += Math.min(4.5, v * 0.35);
    },
    setCrowdExcite(v) {
      excite = Math.max(excite, v);
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      bodyMesh.dispose();
      headMesh.dispose();
      scene.fog = null;
    },
  };
}
