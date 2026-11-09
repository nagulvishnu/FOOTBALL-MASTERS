// Keyboard / mouse / touch input. Produces camera-relative movement + queued actions with charge power.
import type { Act, ActType } from "../shared/types";
import type { Settings } from "./settings";

const CHARGE: ActType[] = ["pass", "through", "shoot", "cross"];
const INSTANT: ActType[] = ["tackle", "support", "jump"];

export class InputController {
  private down = new Set<string>();
  private held = new Map<ActType, number>();
  private acts: Act[] = [];
  private n = 0;
  private dx = 0;
  private dy = 0;
  private joy = { x: 0, y: 0 };
  private sprintTouch = false;
  private dragging = false;
  private touchLook: { id: number; x: number; y: number } | null = null;
  enabled = false;
  locked = false;
  lastLook = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private getSettings: () => Settings,
    private cb: { onPause: () => void; onTactical: () => void; onAnyKey: () => void },
  ) {
    window.addEventListener("keydown", this.kd, { capture: true });
    window.addEventListener("keyup", this.ku, { capture: true });
    window.addEventListener("blur", this.blur);
    document.addEventListener("mousemove", this.mm);
    document.addEventListener("pointerlockchange", this.plc);
    canvas.addEventListener("mousedown", this.md);
    window.addEventListener("mouseup", this.mu);
    canvas.addEventListener("touchstart", this.ts, { passive: false });
    canvas.addEventListener("touchmove", this.tm, { passive: false });
    canvas.addEventListener("touchend", this.te);
    canvas.addEventListener("touchcancel", this.te);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  dispose() {
    window.removeEventListener("keydown", this.kd, { capture: true });
    window.removeEventListener("keyup", this.ku, { capture: true });
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("mousemove", this.mm);
    document.removeEventListener("pointerlockchange", this.plc);
    this.canvas.removeEventListener("mousedown", this.md);
    window.removeEventListener("mouseup", this.mu);
    this.canvas.removeEventListener("touchstart", this.ts);
    this.canvas.removeEventListener("touchmove", this.tm);
    this.canvas.removeEventListener("touchend", this.te);
    this.canvas.removeEventListener("touchcancel", this.te);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private actionFor(code: string): string | null {
    const keys = this.getSettings().keys;
    for (const k of Object.keys(keys)) if (keys[k] === code) return k;
    return null;
  }

  private kd = (e: KeyboardEvent) => {
    const a = this.actionFor(e.code);
    this.cb.onAnyKey();
    if (!this.enabled) return;
    if (a || e.code === "Tab" || e.code.startsWith("Arrow")) e.preventDefault();
    if (!a || e.repeat) return;
    this.down.add(a);
    if (CHARGE.includes(a as ActType)) this.held.set(a as ActType, performance.now());
    else if (INSTANT.includes(a as ActType)) this.push(a as ActType, 0.5);
    else if (a === "tactical") this.cb.onTactical();
  };
  private ku = (e: KeyboardEvent) => {
    const a = this.actionFor(e.code);
    if (!a) return;
    this.down.delete(a);
    if (this.enabled && CHARGE.includes(a as ActType)) this.release(a as ActType);
    else this.held.delete(a as ActType);
  };
  private blur = () => {
    this.down.clear();
    this.held.clear();
  };
  private push(type: ActType, power: number) {
    if (this.acts.length < 4) this.acts.push({ n: ++this.n, type, power });
  }
  private release(type: ActType) {
    const t = this.held.get(type);
    if (t === undefined) return;
    this.held.delete(type);
    this.push(type, Math.min(1, (performance.now() - t) / 600));
  }
  /** Touch buttons call these. */
  touchButton(type: ActType | "sprint", down: boolean) {
    if (!this.enabled) return;
    if (type === "sprint") {
      this.sprintTouch = down;
      return;
    }
    if (CHARGE.includes(type)) {
      if (down) this.held.set(type, performance.now());
      else this.release(type);
    } else if (down) this.push(type, 0.5);
  }
  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }
  getCharge() {
    let m = 0;
    const now = performance.now();
    for (const t of this.held.values()) m = Math.max(m, Math.min(1, (now - t) / 600));
    return m;
  }

  private mm = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.locked || this.dragging) {
      this.dx += e.movementX;
      this.dy += e.movementY;
      this.lastLook = performance.now();
    }
  };
  private md = () => {
    if (!this.enabled) return;
    this.dragging = true;
    if (!this.locked && !matchMedia("(pointer: coarse)").matches) {
      try {
        void this.canvas.requestPointerLock?.();
      } catch {
        /* lock refused: drag-to-look fallback */
      }
    }
  };
  private mu = () => {
    this.dragging = false;
  };
  private plc = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    if (was && !this.locked && this.enabled) this.cb.onPause();
  };
  requestLock() {
    if (matchMedia("(pointer: coarse)").matches) return;
    try {
      void this.canvas.requestPointerLock?.();
    } catch {
      /* ignore */
    }
  }

  /** Release the mouse so menu buttons are clickable while the match is paused. */
  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private ts = (e: TouchEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (!this.touchLook && t.clientX > window.innerWidth * 0.4) this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  };
  private tm = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchLook && t.identifier === this.touchLook.id) {
        this.dx += (t.clientX - this.touchLook.x) * 1.6;
        this.dy += (t.clientY - this.touchLook.y) * 1.2;
        this.touchLook.x = t.clientX;
        this.touchLook.y = t.clientY;
        this.lastLook = performance.now();
      }
    }
  };
  private te = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (this.touchLook && t.identifier === this.touchLook.id) this.touchLook = null;
  };

  consumeLook() {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /** Movement relative to the camera yaw (angle in the x/z plane), plus drained actions. */
  poll(camYaw: number) {
    let ix = this.joy.x;
    let iy = this.joy.y;
    if (this.down.has("up")) iy += 1;
    if (this.down.has("down")) iy -= 1;
    if (this.down.has("right")) ix += 1;
    if (this.down.has("left")) ix -= 1;
    const m = Math.hypot(ix, iy);
    if (m > 1) {
      ix /= m;
      iy /= m;
    }
    const fx = Math.cos(camYaw);
    const fz = Math.sin(camYaw);
    const mx = fx * iy + -fz * ix;
    const mz = fz * iy + fx * ix;
    const acts = this.acts;
    this.acts = [];
    return { mx, mz, sprint: this.down.has("sprint") || this.sprintTouch, acts, moving: m > 0.05 };
  }

  reset() {
    this.down.clear();
    this.held.clear();
    this.acts = [];
    this.joy = { x: 0, y: 0 };
    this.sprintTouch = false;
  }
}
