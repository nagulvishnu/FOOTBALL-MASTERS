"use client";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as THREE from "three";
import { Character } from "@/game/client/characters";
import type { Appearance, Kit } from "@/game/shared/types";

export async function api<T = Record<string, unknown>>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: { message?: string } })?.error?.message ?? `Request failed (${r.status})`);
  return j as T;
}

export function Btn({ variant, big, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "gold" | "danger" | "ghost"; big?: boolean }) {
  return <button {...p} className={`btn ${variant ?? ""} ${big ? "big" : ""} ${className}`} onClick={(e) => { playUi(); p.onClick?.(e); }} />;
}

let uiCtx: AudioContext | null = null;
export function playUi() {
  try {
    uiCtx ??= new AudioContext();
    const o = uiCtx.createOscillator();
    const g = uiCtx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(520, uiCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, uiCtx.currentTime + 0.05);
    g.gain.setValueAtTime(0.04, uiCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, uiCtx.currentTime + 0.07);
    o.connect(g).connect(uiCtx.destination);
    o.start();
    o.stop(uiCtx.currentTime + 0.08);
  } catch {
    /* audio unavailable */
  }
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      {children}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
        <span>{label}</span>
        <span className="text-white">{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" className="w-full accent-[#b6ff3c]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** Small three.js viewport showing a character in the chosen kit. */
export function CharacterPreview({ kit, gk, number, appearance, size = 260 }: { kit: Kit; gk: boolean; number: number; appearance: Appearance; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([kit, gk, number, appearance]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.setSize(size, size * 1.25, false);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1 / 1.25, 0.1, 50);
    cam.position.set(0, 1.25, 4.2);
    cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(2, 4, 3);
    scene.add(d);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xb6ff3c, transparent: true, opacity: 0.25 }));
    disc.rotation.x = -Math.PI / 2;
    scene.add(disc);
    const ch = new Character({ kit, gk, number, appearance, shadows: false });
    ch.root.scale.setScalar(1.15);
    scene.add(ch.root);
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      ch.root.rotation.y = Math.sin(t * 0.6) * 0.9 + 0.3;
      const cycle = t % 6;
      const kick = cycle > 4 && cycle < 4.7;
      ch.update(dt, { vx: 0, vz: 0, facing: 0, action: kick ? 3 : 0, actionT: kick ? cycle - 4 : 0, y: 0, hasBall: false });
      r.render(scene, cam);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      r.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);
  return <canvas ref={ref} style={{ width: size, height: size * 1.25 }} />;
}

export function Shell({ children, title, onBack, right }: { children: ReactNode; title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="screen">
      <div className="pitchlines" />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col gap-4 p-4 sm:p-8">
        <div className="flex items-center gap-3">
          {onBack && (
            <Btn variant="ghost" onClick={onBack}>
              ← Back
            </Btn>
          )}
          <h1 className="disp title text-3xl sm:text-5xl">{title}</h1>
          <div className="ml-auto flex items-center gap-2">{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
