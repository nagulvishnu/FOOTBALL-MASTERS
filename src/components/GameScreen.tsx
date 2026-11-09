"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, type Banner, type Hud } from "@/game/client/engine";
import { addHighScore, DEFAULT_KEYS, getHighScores, KEY_LABELS, keyName, type HighScore, type Settings } from "@/game/client/settings";
import type { GameSetup } from "@/game/client/setup";
import type { RoomView } from "@/game/client/sources";
import { ROLE_LABEL } from "@/game/shared/constants";
import type { ActType, MatchResult } from "@/game/shared/types";
import { DRILL_INFO } from "@/game/sim/drills";
import { Btn, Slider } from "./ui";

interface Props {
  setup: GameSetup;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onExit: () => void;
  onRestart?: () => void;
  room?: RoomView | null;
  netStatus?: string;
  playerName: string;
}

type Panel = "main" | "controls" | "camera" | "audio";

function matchScore(r: MatchResult, you: number) {
  const me = r.players.find((p) => p.idx === you);
  if (!me) return { total: 0, parts: [] as [string, number][] };
  const mine = r.score[me.team];
  const theirs = r.score[me.team ^ 1];
  const acc = me.stats.passes ? me.stats.passOk / me.stats.passes : 0;
  const parts: [string, number][] = [
    ["Goals", me.stats.goals * 100],
    ["Assists", me.stats.assists * 50],
    ["Saves", me.stats.saves * 25],
    ["Tackles", me.stats.tackles * 10],
    ["Pass accuracy", Math.round(acc * 50)],
    ["Result bonus", mine > theirs ? 200 : mine === theirs ? 75 : 0],
    ["Goal difference", Math.max(0, (mine - theirs) * 30)],
    ["Fouls", -me.stats.fouls * 10],
  ];
  return { total: Math.max(0, parts.reduce((a, [, v]) => a + v, 0)), parts };
}

function drillScore(kind: string, d: { value: number; attempts: number }) {
  if (kind === "shooting") return d.value * 100;
  if (kind === "passing") return d.value * 25;
  if (kind === "dribbling") return d.value * 5;
  if (kind === "goalkeeper") return Math.max(0, d.value * 120 - (d.attempts - d.value) * 30);
  return 0;
}

export default function GameScreen({ setup, settings, onSettings, onExit, onRestart, room, netStatus, playerName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  const [hud, setHud] = useState<Hud | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState<Panel>("main");
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState(0);
  const [rebind, setRebind] = useState<string | null>(null);
  const [hs, setHs] = useState<{ rank: number; list: HighScore[]; score: number } | null>(null);
  const [touch] = useState(() => typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches);
  const online = setup.kind === "online";
  const startedRef = useRef(false);
  const pausedRef = useRef(false);

  const rawResult: MatchResult | null = setup.drill ? null : online ? room?.result ?? setup.source.result() : setup.source.result();
  const scoring = rawResult ? matchScore(rawResult, setup.you) : null;
  const dr = hud?.drill;
  const drScore = setup.drill && dr ? drillScore(dr.kind, dr) : 0;
  const hsDone = useRef(false);
  useEffect(() => {
    settingsRef.current = settings;
    startedRef.current = started;
    pausedRef.current = paused;
  });

  const openPause = useCallback(() => {
    if (!startedRef.current || pausedRef.current) return;
    pausedRef.current = true;
    engineRef.current?.input.releaseLock();
    setPanel("main");
    setPaused(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const eng = new Engine({
      canvas,
      source: setup.source,
      roster: setup.roster,
      you: setup.you,
      kits: setup.kits,
      stadium: setup.stadium,
      time: setup.time,
      weather: setup.weather,
      settings: () => settingsRef.current,
      onHud: setHud,
      onBanner: (b) => {
        setBanners((l) => [...l.slice(-2), b]);
        if (b.tone === "goal") setFlash((f) => f + 1);
        setTimeout(() => setBanners((l) => l.filter((x) => x.id !== b.id)), 2600);
      },
      onPause: openPause,
      onFinished: () => {
        eng.input.releaseLock();
        setFinished(true);
        if (online || hsDone.current) return;
        const snapDrill = setup.drill ? eng.lastSnapshot?.dr : undefined;
        if (setup.drill && !snapDrill) return;
        hsDone.current = true;
        const r = setup.source.result();
        const score = snapDrill ? drillScore(snapDrill.kind, snapDrill) : r ? matchScore(r, setup.you).total : 0;
        const detail = snapDrill ? snapDrill.sub : r ? `${r.score[0]}-${r.score[1]}` : "";
        const h: HighScore = { name: playerName, score, mode: setup.drill ? DRILL_INFO[setup.drill].title : "Quick Play", detail, date: Date.now() };
        const { rank, list } = addHighScore(h);
        setHs({ rank, list, score });
      },
    });
    engineRef.current = eng;
    const w = window as typeof window & { __fmDebug?: () => unknown };
    w.__fmDebug = () => eng.debugState();
    eng.setEnabled(false);
    if (!online) eng.setPaused(true);
    const vis = () => document.hidden && openPause();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      delete w.__fmDebug;
      eng.dispose();
      engineRef.current = null;
    };
  }, [setup, online, openPause, playerName]);

  // engine enable/pause follows UI state
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const active = started && !paused && !finished;
    e.setEnabled(active);
    if (!online) e.setPaused(!active);
  }, [started, paused, finished, online]);

  useEffect(() => {
    engineRef.current?.applyAudio();
  }, [settings.master, settings.music]);

  const begin = () => {
    const e = engineRef.current;
    if (!e) return;
    e.startAudio();
    setStarted(true);
    setPaused(false);
    setTimeout(() => e.input.requestLock(), 30);
  };
  const resume = () => {
    pausedRef.current = false;
    setPaused(false);
    setTimeout(() => engineRef.current?.input.requestLock(), 30);
  };

  // keyboard: Esc pause, R restart (offline), rebinding
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (rebind) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== "Escape") onSettings({ ...settingsRef.current, keys: { ...settingsRef.current.keys, [rebind]: e.code } });
        setRebind(null);
        return;
      }
      if (e.code === "Escape" && started && !paused && !finished) openPause();
      if (e.code === "KeyR" && !online && (paused || finished || !started) && onRestart) onRestart();
      if ((e.code === "Enter" || e.code === "Space") && !started) {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener("keydown", kd, true);
    return () => window.removeEventListener("keydown", kd, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebind, started, paused, finished, online, onRestart, openPause]);

  // results + high score table (offline only: stored locally)
  const result: MatchResult | null = finished ? rawResult : null;

  const sp = (t: ActType | "sprint", down: boolean) => engineRef.current?.input.touchButton(t, down);
  const you = setup.roster.find((r) => r.idx === setup.you);
  const kits = setup.kits;
  const phaseLabel = hud ? ({ prematch: "Pre-match", restart: hud.setPiece ? hud.setPiece.replace("kick", " kick").replace("throwin", "throw-in") : "", playing: "", goal: "GOAL", halftime: "Half time", finished: "Full time" } as Record<string, string>)[hud.phase] : "";
  const keys = settings.keys;

  return (
    <div className="fixed inset-0 bg-black" key="game" style={flash ? { animation: "shakeUi .4s" } : undefined}>
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block", touchAction: "none" }} />
      </div>
      {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle, rgba(255,235,120,.5), rgba(255,255,255,.1))", animation: "flash .7s forwards" }} />}

      {/* HUD */}
      {hud && started && !finished && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-center">
            <div className="panel flex items-center gap-3 px-4 py-2">
              {!dr ? (
                <>
                  <span className="chip" style={{ background: kits[0].primary, color: "#fff" }}>{kits[0].name}</span>
                  <span className="hud-score" key={hud.score[0]} style={{ animation: "pulse .5s" }}>{hud.score[0]}</span>
                  <div>
                    <div className="disp text-lg text-[var(--gold)]">{hud.clock}</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--mute)]">{hud.half === 1 ? "1st half" : "2nd half"}</div>
                  </div>
                  <span className="hud-score" key={`b${hud.score[1]}`} style={{ animation: "pulse .5s" }}>{hud.score[1]}</span>
                  <span className="chip" style={{ background: kits[1].primary, color: "#fff" }}>{kits[1].name}</span>
                </>
              ) : (
                <>
                  <span className="disp text-lg">{dr!.label}</span>
                  <span className="hud-score text-[var(--lime)]">{dr!.value}</span>
                  <span className="disp text-lg text-[var(--gold)]">{dr!.timeLeft > 0 ? hud.clock : ""}</span>
                </>
              )}
            </div>
            {dr && <div className="mt-1 text-sm font-bold text-white drop-shadow">{dr.sub}</div>}
            {phaseLabel && !dr && <div className="disp mt-1 text-sm tracking-widest text-white drop-shadow">{phaseLabel}</div>}
          </div>

          <div className="pointer-events-none absolute left-3 top-3 text-xs font-bold">
            {online && (
              <div className="panel mb-2 flex items-center gap-2 px-3 py-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: netStatus === "open" ? (hud.ping < 120 ? "#7dff9a" : "#ffd23f") : "#ff3b6b" }} />
                {netStatus === "open" ? `${hud.ping} ms` : netStatus}
              </div>
            )}
            <div className="panel w-44 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--mute)]">Your team</div>
              {hud.mates.map((m) => (
                <div key={m.idx} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ opacity: m.red ? 0.4 : 1, color: m.idx === hud.you ? "var(--gold)" : "inherit" }}>
                  <span className="w-9 font-black">{m.role}</span>
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.ball && <span>⚽</span>}
                  {m.human ? <span className="text-[var(--lime)]">●</span> : <span className="text-[var(--mute)]">AI</span>}
                </div>
              ))}
            </div>
          </div>

          <button className="absolute right-3 top-3 panel px-3 py-2 text-sm font-black" onClick={openPause} aria-label="Pause">
            ❚❚
          </button>

          <div className="pointer-events-none absolute bottom-4 left-4 w-64">
            <div className="panel p-3">
              <div className="flex items-center gap-2">
                <span className="disp text-2xl text-[var(--gold)]">{you?.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{you?.name}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--mute)]">{you ? ROLE_LABEL[you.role] : "Spectator"}</div>
                </div>
              </div>
              <div className="bar mt-2">
                <i style={{ width: `${hud.stamina}%`, background: hud.stamina > 30 ? "linear-gradient(90deg,#7dff9a,#b6ff3c)" : "linear-gradient(90deg,#ff3b6b,#ffb800)" }} />
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--mute)]">Stamina</div>
            </div>
          </div>

          {hud.charge > 0.04 && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 w-56 -translate-x-1/2">
              <div className="bar" style={{ height: 12 }}>
                <i style={{ width: `${hud.charge * 100}%`, background: "linear-gradient(90deg,#3bd1ff,#ffd23f,#ff3b6b)" }} />
              </div>
            </div>
          )}
          {hud.tactical && <div className="chip pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">Tactical camera · press {keyName(keys.tactical)} to return</div>}
        </>
      )}

      {/* banners */}
      <div className="pointer-events-none absolute left-1/2 top-[22%] flex -translate-x-1/2 flex-col items-center gap-2">
        {banners.map((b) => (
          <div key={b.id} className="text-center" style={{ animation: "banner 2.6s both" }}>
            <div
              className="disp"
              style={{
                fontSize: b.tone === "goal" ? "clamp(56px,11vw,120px)" : "clamp(26px,4.5vw,48px)",
                color: b.tone === "goal" ? "#ffd23f" : b.tone === "red" ? "#ff3b6b" : b.tone === "yellow" ? "#ffe14d" : b.tone === "good" ? "#7dff9a" : b.tone === "warn" ? "#ffb066" : "#fff",
                textShadow: "0 4px 0 rgba(0,0,0,.5), 0 0 40px rgba(255,210,63,.45)",
                lineHeight: 1,
              }}
            >
              {b.text}
            </div>
            {b.sub && <div className="mt-1 text-lg font-extrabold text-white drop-shadow-lg">{b.sub}</div>}
          </div>
        ))}
      </div>

      {/* touch controls */}
      {touch && started && !paused && !finished && <TouchControls sp={sp} onJoy={(x, y) => engineRef.current?.input.setJoystick(x, y)} gk={you?.role === "GK"} />}

      {/* reconnect overlay */}
      {online && netStatus && netStatus !== "open" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 text-center">
          <div className="panel p-8">
            <div className="disp text-3xl">{netStatus === "replaced" ? "Opened elsewhere" : "Reconnecting…"}</div>
            <p className="mt-2 max-w-sm text-[var(--mute)]">{netStatus === "replaced" ? "This account joined the match from another tab. Close this one." : "The AI is covering your position. You will regain control automatically."}</p>
            <div className="mt-4"><Btn onClick={onExit}>Back to lobby</Btn></div>
          </div>
        </div>
      )}

      {/* start overlay */}
      {!started && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={begin}>
          <div className="panel anim-in max-w-xl p-7 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="disp title text-5xl">{setup.drill ? DRILL_INFO[setup.drill].title : online ? "Match Ready" : "Kick Off"}</div>
            <p className="mt-2 text-[var(--mute)]">{setup.drill ? DRILL_INFO[setup.drill].blurb : you ? `You are ${you.name} · #${you.number} · ${ROLE_LABEL[you.role]}` : ""}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-left text-sm">
              {(["up", "sprint", "pass", "through", "shoot", "cross", "tackle", "support"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="text-[var(--mute)]">{KEY_LABELS[k]}</span>
                  <span className="kbd">{k === "up" ? "WASD" : keyName(keys[k])}</span>
                </div>
              ))}
              <div className="col-span-2 flex items-center justify-between"><span className="text-[var(--mute)]">Camera</span><span className="kbd">Mouse / right-side drag</span></div>
            </div>
            <div className="mt-5"><Btn variant="primary" big onClick={begin}>{online ? "Enter match" : "Click to play"}</Btn></div>
            <p className="mt-3 text-xs text-[var(--mute)]">Press Enter or click · Esc pauses · R restarts instantly{online ? " (offline only)" : ""}</p>
            <div className="mt-3"><Btn variant="ghost" onClick={onExit}>{online ? "Back to lobby" : "Main menu"}</Btn></div>
          </div>
        </div>
      )}

      {/* pause */}
      {paused && !finished && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="panel anim-in max-h-[92vh] w-full max-w-lg overflow-auto p-6">
            <div className="disp text-4xl">{panel === "main" ? "Paused" : panel === "controls" ? "Controls" : panel === "camera" ? "Camera & graphics" : "Audio"}</div>
            {online && panel === "main" && <p className="mt-1 text-xs text-[var(--gold)]">Online match keeps running while you are paused.</p>}
            {panel === "main" && (
              <div className="mt-4 grid gap-2">
                <Btn variant="primary" big onClick={resume}>Resume</Btn>
                <Btn onClick={() => setPanel("controls")}>Controls</Btn>
                <Btn onClick={() => setPanel("camera")}>Camera & graphics</Btn>
                <Btn onClick={() => setPanel("audio")}>Audio</Btn>
                {!online && onRestart && <Btn variant="gold" onClick={onRestart}>Restart (R)</Btn>}
                <Btn variant="danger" onClick={onExit}>{online ? "Back to lobby" : "Leave match"}</Btn>
              </div>
            )}
            {panel === "controls" && (
              <div className="mt-4">
                <div className="grid max-h-[50vh] gap-1.5 overflow-auto pr-1">
                  {Object.keys(DEFAULT_KEYS).map((k) => (
                    <div key={k} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[var(--mute)]">{KEY_LABELS[k]}</span>
                      <button className="kbd min-w-[90px] cursor-pointer" style={rebind === k ? { borderColor: "var(--gold)", color: "var(--gold)" } : undefined} onClick={() => setRebind(k)}>
                        {rebind === k ? "press a key…" : keyName(keys[k])}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <Btn onClick={() => onSettings({ ...settings, keys: DEFAULT_KEYS })}>Reset defaults</Btn>
                  <Btn variant="primary" onClick={() => setPanel("main")}>Done</Btn>
                </div>
              </div>
            )}
            {panel === "camera" && (
              <div className="mt-4">
                <Slider label="Camera sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => onSettings({ ...settings, sensitivity: v })} fmt={(v) => v.toFixed(2)} />
                <Slider label="Camera distance" value={settings.distance} min={3} max={14} step={0.25} onChange={(v) => onSettings({ ...settings, distance: v })} fmt={(v) => `${v.toFixed(1)} m`} />
                <Slider label="Camera height" value={settings.height} min={1} max={8} step={0.25} onChange={(v) => onSettings({ ...settings, height: v })} fmt={(v) => `${v.toFixed(1)} m`} />
                <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.invertY} onChange={(e) => onSettings({ ...settings, invertY: e.target.checked })} /> Invert vertical look</label>
                <div className="lbl">Graphics quality (applies next match)</div>
                <div className="mb-4 flex gap-2">
                  {(["low", "medium", "high"] as const).map((g) => (
                    <Btn key={g} variant={settings.graphics === g ? "primary" : undefined} onClick={() => onSettings({ ...settings, graphics: g })}>{g}</Btn>
                  ))}
                </div>
                <Btn variant="primary" onClick={() => setPanel("main")}>Done</Btn>
              </div>
            )}
            {panel === "audio" && (
              <div className="mt-4">
                <Slider label="Master volume" value={settings.master} min={0} max={1} step={0.05} onChange={(v) => onSettings({ ...settings, master: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Crowd ambience" value={settings.music} min={0} max={1} step={0.05} onChange={(v) => onSettings({ ...settings, music: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
                <Btn variant="primary" onClick={() => setPanel("main")}>Done</Btn>
              </div>
            )}
          </div>
        </div>
      )}

      {/* results / game over */}
      {finished && (
        <div className="absolute inset-0 z-20 overflow-auto bg-black/75 p-4 backdrop-blur-md">
          <div className="panel anim-in mx-auto my-4 max-w-3xl p-6">
            <div className="disp title text-center text-5xl">{setup.drill ? "Drill complete" : "Full time"}</div>
            {result && (
              <>
                <div className="my-3 flex items-center justify-center gap-5">
                  <span className="chip" style={{ background: kits[0].primary }}>{kits[0].name}</span>
                  <span className="hud-score text-6xl">{result.score[0]} - {result.score[1]}</span>
                  <span className="chip" style={{ background: kits[1].primary }}>{kits[1].name}</span>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <Stat label="Possession" v={`${result.possession[0]}% – ${result.possession[1]}%`} />
                  <Stat label="Duration" v={`${Math.round(result.durationSeconds / 60)} min`} />
                  <Stat label="Pass accuracy" v={`${passAcc(result, 0)}% – ${passAcc(result, 1)}%`} />
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--mute)]"><tr><th className="p-1">Player</th><th>Pos</th><th>G</th><th>A</th><th>Saves</th><th>Tackles</th><th>Pass %</th></tr></thead>
                    <tbody>
                      {[...result.players].sort((a, b) => b.stats.goals * 3 + b.stats.assists * 2 + b.stats.saves + b.stats.tackles - (a.stats.goals * 3 + a.stats.assists * 2 + a.stats.saves + a.stats.tackles)).map((p) => (
                        <tr key={p.idx} style={{ color: p.idx === setup.you ? "var(--gold)" : undefined, borderTop: "1px solid var(--line)" }}>
                          <td className="p-1 font-bold"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: kits[p.team].primary }} />{p.name}{p.red ? " 🟥" : p.yellow ? " 🟨" : ""}</td>
                          <td>{ROLE_LABEL[p.role]}</td><td>{p.stats.goals}</td><td>{p.stats.assists}</td><td>{p.stats.saves}</td><td>{p.stats.tackles}</td>
                          <td>{p.stats.passes ? Math.round((p.stats.passOk / p.stats.passes) * 100) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {setup.drill && dr && (
              <div className="my-4 text-center">
                <div className="hud-score text-6xl text-[var(--lime)]">{dr.value}</div>
                <div className="text-[var(--mute)]">{dr.sub}</div>
              </div>
            )}
            {!online && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--line)] p-3">
                  <div className="lbl">Your score</div>
                  <div className="disp text-5xl text-[var(--gold)]">{hs?.score ?? (setup.drill ? drScore : scoring?.total ?? 0)}</div>
                  {!setup.drill && scoring && (
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-[var(--mute)]">
                      {scoring.parts.filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span className="text-white">{v > 0 ? "+" : ""}{v}</span></div>)}
                    </div>
                  )}
                  {hs && hs.rank > 0 && hs.rank <= 10 && <div className="mt-2 chip" style={{ background: "var(--gold)", color: "#111" }}>New #{hs.rank} on the leaderboard!</div>}
                </div>
                <HighScores list={hs?.list ?? getHighScores()} mine={hs ? hs.list[hs.rank - 1] : undefined} />
              </div>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {!online && onRestart && <Btn variant="primary" big onClick={onRestart}>Play again (R)</Btn>}
              <Btn big onClick={onExit}>{online ? "Back to lobby" : "Main menu"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const passAcc = (r: MatchResult, t: number) => {
  const p = r.players.filter((x) => x.team === t).reduce((a, x) => a + x.stats.passes, 0);
  const o = r.players.filter((x) => x.team === t).reduce((a, x) => a + x.stats.passOk, 0);
  return p ? Math.round((o / p) * 100) : 0;
};

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <div className="lbl !mb-0">{label}</div>
      <div className="disp text-lg">{v}</div>
    </div>
  );
}

export function HighScores({ list, mine }: { list: HighScore[]; mine?: HighScore }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-3">
      <div className="lbl">Local high scores</div>
      {list.length === 0 && <div className="text-sm text-[var(--mute)]">No scores yet — play a match!</div>}
      <ol className="text-sm">
        {list.slice(0, 8).map((h, i) => (
          <li key={h.date + h.name + i} className="flex items-center gap-2 py-0.5" style={{ color: h === mine || (mine && h.date === mine.date) ? "var(--gold)" : undefined }}>
            <span className="w-5 text-[var(--mute)]">{i + 1}</span>
            <span className="flex-1 truncate font-bold">{h.name}</span>
            <span className="truncate text-[10px] uppercase text-[var(--mute)]">{h.mode}</span>
            <span className="disp w-14 text-right">{h.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TouchControls({ sp, onJoy, gk }: { sp: (t: ActType | "sprint", d: boolean) => void; onJoy: (x: number, y: number) => void; gk: boolean }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const [on, setOn] = useState<string | null>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const R = 56;
  const btn = (k: ActType | "sprint", label: string, style: React.CSSProperties, size = 64) => (
    <button
      key={k + label}
      className={`tbtn ${on === label ? "on" : ""}`}
      style={{ ...style, width: size, height: size }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setOn(label); sp(k, true); }}
      onPointerUp={() => { setOn(null); sp(k, false); }}
      onPointerCancel={() => { setOn(null); sp(k, false); }}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <div
        className="pointer-events-auto absolute bottom-0 left-0 h-[55%] w-[40%]"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => { origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; setAnchor({ x: e.clientX, y: e.clientY }); (e.target as HTMLElement).setPointerCapture(e.pointerId); setKnob({ x: 0, y: 0 }); }}
        onPointerMove={(e) => {
          const o = origin.current;
          if (!o || o.id !== e.pointerId) return;
          let dx = e.clientX - o.x;
          let dy = e.clientY - o.y;
          const m = Math.hypot(dx, dy);
          if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
          setKnob({ x: dx, y: dy });
          onJoy(dx / R, -dy / R);
        }}
        onPointerUp={() => { origin.current = null; setKnob(null); onJoy(0, 0); }}
        onPointerCancel={() => { origin.current = null; setKnob(null); onJoy(0, 0); }}
      >
        {knob && anchor && (
          <div className="fixed" style={{ left: anchor.x - R, top: anchor.y - R, width: R * 2, height: R * 2, borderRadius: "50%", border: "2px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.06)" }}>
            <div style={{ position: "absolute", left: R - 24 + knob.x, top: R - 24 + knob.y, width: 48, height: 48, borderRadius: "50%", background: "rgba(182,255,60,.6)" }} />
          </div>
        )}
        {!knob && <div className="absolute bottom-10 left-8 flex h-28 w-28 items-center justify-center rounded-full border-2 border-white/20 text-[10px] font-bold uppercase text-white/40">Move</div>}
      </div>
      <div className="pointer-events-auto absolute bottom-0 right-0 h-[60%] w-[46%]">
        {btn("shoot", "SHOOT", { right: 20, bottom: 24 }, 84)}
        {btn("pass", "PASS", { right: 116, bottom: 20 })}
        {btn("through", "THRU", { right: 100, bottom: 96 })}
        {btn("cross", "LOB", { right: 22, bottom: 124 })}
        {btn("tackle", gk ? "DIVE" : "TACK", { right: 188, bottom: 70 }, 56)}
        {btn("sprint", "RUN", { right: 188, bottom: 134 }, 56)}
        {btn("support", "CALL", { right: 110, bottom: 168 }, 48)}
      </div>
    </div>
  );
}
