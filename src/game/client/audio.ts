// Fully procedural audio (WebAudio) – no external sound assets, so nothing can fail to download.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowd!: GainNode;
  private noise!: AudioBuffer;
  private vol = 0.8;
  private amb = 0.5;
  private excite = 0.15;
  speech = true;

  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.05 * this.amb;
    src.connect(bp).connect(this.crowd).connect(this.master);
    src.start();
  }

  setVolumes(master: number, ambience: number) {
    this.vol = master;
    this.amb = ambience;
    if (this.ctx) {
      this.master.gain.value = master;
      this.crowd.gain.value = (0.03 + this.excite * 0.16) * ambience;
    }
  }

  setExcite(v: number) {
    this.excite = v;
    if (this.ctx) this.crowd.gain.setTargetAtTime((0.03 + v * 0.16) * this.amb, this.ctx.currentTime, 0.4);
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, to?: number, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number, q = 1, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  ui() {
    this.tone(660, 0.05, "square", 0.05, 990);
  }
  kick(power: number) {
    this.burst(0.07, 0.25 + power * 0.5, 1100, 0.8);
    this.tone(150, 0.12, "sine", 0.35 + power * 0.4, 55);
  }
  bounce(v: number) {
    this.tone(110, 0.09, "sine", Math.min(0.5, v * 0.06), 60);
  }
  post() {
    this.tone(880, 0.35, "triangle", 0.35, 600);
    this.burst(0.05, 0.4, 2500, 2);
  }
  net() {
    this.burst(0.35, 0.3, 1800, 0.4);
  }
  tackle() {
    this.burst(0.12, 0.45, 400, 0.7);
    this.tone(90, 0.14, "sine", 0.4, 50);
  }
  save() {
    this.burst(0.09, 0.4, 700, 0.8);
    this.tone(200, 0.1, "sine", 0.3, 120);
  }
  whistle(kind: "short" | "long" | "triple" | "goal" = "short") {
    const one = (d: number, delay: number, f = 2900) => {
      const c = this.ctx;
      if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const lfo = c.createOscillator();
      const lg = c.createGain();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      lfo.frequency.value = 38;
      lg.gain.value = 90;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.02);
      g.gain.setValueAtTime(0.28, t + d - 0.04);
      g.gain.linearRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + d + 0.02);
      lfo.stop(t + d + 0.02);
    };
    if (kind === "short") one(0.28, 0);
    else if (kind === "goal") one(0.5, 0);
    else if (kind === "long") one(0.9, 0);
    else {
      one(0.4, 0);
      one(0.4, 0.55);
      one(0.9, 1.1);
    }
  }
  goal() {
    this.setExcite(1);
    this.tone(196, 0.9, "sawtooth", 0.12, 180);
    this.tone(294, 0.9, "sawtooth", 0.08, 270);
    for (let i = 0; i < 4; i++) this.burst(0.5, 0.18, 900 + i * 300, 0.5, i * 0.12);
    setTimeout(() => this.setExcite(0.3), 4500);
  }
  groan() {
    this.tone(220, 0.6, "sawtooth", 0.05, 120);
  }
  speak(text: string) {
    if (!this.speech || typeof speechSynthesis === "undefined") return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 0.9;
      u.volume = Math.min(1, this.vol);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* speech unavailable */
    }
  }
  dispose() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    void this.ctx?.close();
    this.ctx = null;
  }
}
