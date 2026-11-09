"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, getHighScores, loadSettings, saveSettings, type Settings } from "@/game/client/settings";
import { DEFAULT_LOCAL, makeLocalSetup, type GameSetup, type LocalConfig } from "@/game/client/setup";
import { OnlineSource, type RoomView } from "@/game/client/sources";
import { DIFFICULTIES, ROLES, ROLE_LABEL, ROLE_NAME, STADIUMS, TIMES, WEATHERS, slotIdx } from "@/game/shared/constants";
import type { Appearance, DrillKind, Role } from "@/game/shared/types";
import { DRILL_INFO } from "@/game/sim/drills";
import { api, Btn, CharacterPreview, Field, Shell, Slider } from "./ui";
import Lobby from "./Lobby";
import { DEFAULT_KITS } from "@/game/client/setup";
import { HighScores } from "./GameScreen";

const GameScreen = dynamic(() => import("./GameScreen"), { ssr: false });

interface User {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  appearance: Appearance;
}
type View = "start" | "menu" | "quick" | "practice" | "join" | "create" | "lobby" | "game" | "profile" | "settings" | "scores";

const CFG_KEY = "fm_local_cfg_v1";

export default function App() {
  const [view, setView] = useState<View>("start");
  const [user, setUser] = useState<User | null>(null);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cfg, setCfg] = useState<LocalConfig>(DEFAULT_LOCAL);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [net, setNet] = useState("connecting");
  const [auth, setAuth] = useState<null | (() => void)>(null);
  const [toast, setToast] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("Player");
  const sourceRef = useRef<OnlineSource | null>(null);
  const viewRef = useRef(view);
  const userRef = useRef(user);
  useEffect(() => {
    viewRef.current = view;
    userRef.current = user;
  });

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  };

  const refreshMe = useCallback(async () => {
    try {
      const r = await api<{ user: User | null; activeRoom: string | null }>("/api/auth/me");
      setUser(r.user);
      setActiveRoom(r.activeRoom);
      return r.user;
    } catch {
      return null;
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setName(localStorage.getItem("fm_name") || "Player");
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? "null");
      if (c) setCfg({ ...DEFAULT_LOCAL, ...c });
    } catch {
      /* ignore */
    }
    refreshMe().then(async (u) => {
      setReady(true);
      const q = new URLSearchParams(location.search).get("room");
      if (q) {
        setJoinCode(q.toUpperCase());
        setView("join");
      }
      if (u) {
        try {
          const r = await api<{ settings: Partial<Settings> }>("/api/settings");
          if (r.settings && Object.keys(r.settings).length) setSettings((cur) => ({ ...cur, ...r.settings, keys: { ...cur.keys, ...(r.settings.keys ?? {}) } }));
        } catch {
          /* settings stay local */
        }
      }
    });
  }, [refreshMe]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // persist settings locally; sync to the account (debounced) when signed in
  const syncT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
    if (userRef.current) {
      if (syncT.current) clearTimeout(syncT.current);
      syncT.current = setTimeout(() => api("/api/settings", "PUT", { sensitivity: s.sensitivity, distance: s.distance, height: s.height, graphics: s.graphics, master: s.master, music: s.music, invertY: s.invertY, keys: s.keys }).catch(() => {}), 800);
    }
  }, []);

  const needAuth = (fn: () => void) => (user ? fn() : setAuth(() => fn));
  const displayName = user?.displayName ?? name;

  // ------------------------------------------------------------ offline
  const startLocal = (c: LocalConfig) => {
    const full = { ...c, name: displayName, appearance: user?.appearance ?? c.appearance };
    setCfg(c);
    localStorage.setItem(CFG_KEY, JSON.stringify({ ...c, name: undefined }));
    setSetup(makeLocalSetup(full));
    setView("game");
  };
  const restartLocal = () => {
    setSetup(null);
    setTimeout(() => startLocal(cfg), 0);
  };

  // ------------------------------------------------------------ online
  const enterRoom = async (code: string) => {
    try {
      await api(`/api/rooms/${code}/action`, "POST", { type: "join" });
      sourceRef.current?.stop();
      const src = new OnlineSource(code, { onRoom: (r) => setRoom(r), onStatus: setNet });
      sourceRef.current = src;
      setRoom(null);
      src.connect();
      setView("lobby");
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const leaveRoom = async () => {
    const code = room?.code ?? sourceRef.current?.code;
    try {
      if (code) await api(`/api/rooms/${code}/action`, "POST", { type: "leave" });
    } catch {
      /* already gone */
    }
    sourceRef.current?.stop();
    sourceRef.current = null;
    setRoom(null);
    setSetup(null);
    setActiveRoom(null);
    setView("menu");
  };
  // lobby -> game when the server starts the match; game -> lobby on rematch
  useEffect(() => {
    if (!room || !user) return;
    const me = room.members.find((m) => m.userId === user.id);
    if (room.state === "playing" && viewRef.current === "lobby" && me && me.team !== null && me.role && room.roster.length === 14 && sourceRef.current) {
      setSetup({
        label: "Online match",
        kind: "online",
        source: sourceRef.current,
        roster: room.roster,
        you: slotIdx(me.team, me.role as Role),
        kits: room.kits,
        stadium: room.settings.stadium as GameSetup["stadium"],
        time: room.settings.time as GameSetup["time"],
        weather: room.settings.weather as GameSetup["weather"],
        mode: room.settings.mode,
      });
      setView("game");
    }
    if (room.state === "lobby" && viewRef.current === "game" && sourceRef.current) {
      setSetup(null);
      setView("lobby");
    }
  }, [room, user]);

  const quickMatch = () =>
    needAuth(async () => {
      try {
        const r = await api<{ code: string }>("/api/matchmaking", "POST");
        enterRoom(r.code);
      } catch (e) {
        flash((e as Error).message);
      }
    });

  // ------------------------------------------------------------ render
  if (!ready) return <div className="screen flex items-center justify-center"><div className="disp title text-4xl">Loading…</div></div>;

  if (view === "game" && setup) {
    return (
      <GameScreen
        key={setup.source.sim ? "local" + setup.source.sim.cfg.seed : "online"}
        setup={setup}
        settings={settings}
        onSettings={updateSettings}
        onExit={() => {
          if (setup.kind === "online") {
            setSetup(null);
            setView(room?.state === "lobby" || !room ? "lobby" : "lobby");
          } else {
            setSetup(null);
            setView("menu");
          }
        }}
        onRestart={setup.kind === "local" ? restartLocal : undefined}
        room={room}
        netStatus={net}
        playerName={displayName}
      />
    );
  }
  if (view === "lobby" && room && user) {
    return <Lobby room={room} me={user.id} netStatus={net} onLeave={leaveRoom} />;
  }
  if (view === "lobby") return <div className="screen flex items-center justify-center"><div className="disp text-3xl">Joining room…</div></div>;

  const authModal = auth && (
    <AuthModal
      onClose={() => setAuth(null)}
      onDone={async () => {
        const fn = auth;
        setAuth(null);
        await refreshMe();
        setTimeout(fn, 50);
      }}
      defaultName={name}
    />
  );
  const toastEl = toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--pink)] bg-[#1a0a12] px-5 py-3 text-sm font-bold">{toast}</div>;

  if (view === "start") {
    const best = getHighScores()[0];
    return (
      <div className="screen flex items-center justify-center" onClick={() => setView("menu")}>
        <div className="pitchlines" />
        <div className="relative px-4 text-center">
          <div className="chip mb-3 anim-in">7 vs 7 · 3D · online multiplayer</div>
          <h1 className="disp title anim-in text-[clamp(56px,13vw,170px)] leading-[0.9]">Football<br />Masters</h1>
          <p className="anim-in mx-auto mt-4 max-w-md text-[var(--mute)]">One footballer. Your own camera. A fixed position. AI fills every gap — jump in and score within seconds.</p>
          <div className="anim-in mt-8 flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <input className="field max-w-xs text-center" placeholder="Your name" value={user?.displayName ?? name} disabled={!!user} maxLength={20} onChange={(e) => { setName(e.target.value); localStorage.setItem("fm_name", e.target.value); }} />
            <Btn variant="primary" big onClick={() => { if (!user && !/^[\w \-]{2,24}$/.test(name)) return flash("Name: 2-24 letters, numbers, spaces"); setView("menu"); }}>Press start</Btn>
            {best && <div className="text-xs text-[var(--mute)]">Local best: <b className="text-[var(--gold)]">{best.score}</b> · {best.name} · {best.mode}</div>}
          </div>
        </div>
        {toastEl}
      </div>
    );
  }

  if (view === "menu") {
    return (
      <div className="screen">
        <div className="pitchlines" />
        <div className="relative mx-auto grid min-h-full max-w-6xl items-center gap-8 p-5 sm:p-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="disp title text-[clamp(48px,9vw,120px)] leading-[0.9]">Football<br />Masters</h1>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {user ? <span className="chip" style={{ background: "rgba(182,255,60,.2)" }}>● {user.displayName}{user.isGuest ? " (guest)" : ""}</span> : <span className="chip">Offline — sign in for online play</span>}
              {user ? <Btn variant="ghost" onClick={async () => { await api("/api/auth/logout", "POST"); setUser(null); setActiveRoom(null); }}>Log out</Btn> : <Btn variant="ghost" onClick={() => setAuth(() => () => {})}>Sign in</Btn>}
            </div>
            <div className="mt-6 grid gap-3">
              <Btn variant="primary" big onClick={() => startLocal({ ...cfg, kind: "match" })}>⚽ Play now — 7v7 vs AI (offline)</Btn>
              {activeRoom && <Btn variant="gold" onClick={() => enterRoom(activeRoom)}>↩ Rejoin your match ({activeRoom})</Btn>}
            </div>
            <div className="panel mt-6 max-w-md p-4">
              <HighScores list={getHighScores()} />
            </div>
          </div>
          <div className="panel anim-in grid gap-2.5 p-5">
            <div className="lbl !mb-0">Play online</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Btn onClick={() => needAuth(() => setView("create"))}>Create room</Btn>
              <Btn onClick={() => needAuth(() => { setJoinCode(""); setView("join"); })}>Join room</Btn>
              <Btn variant="gold" onClick={quickMatch}>Quick match</Btn>
              <Btn onClick={() => needAuth(() => setView("join"))}>Public rooms</Btn>
            </div>
            <div className="lbl !mb-0 mt-2">Solo</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Btn onClick={() => setView("quick")}>Match setup</Btn>
              <Btn onClick={() => setView("practice")}>Practice</Btn>
            </div>
            <div className="lbl !mb-0 mt-2">More</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Btn onClick={() => needAuth(() => setView("profile"))}>Profile</Btn>
              <Btn onClick={() => setView("settings")}>Settings</Btn>
              <Btn onClick={() => setView("scores")}>High scores</Btn>
              <button className="btn" disabled title="Not implemented yet">Tournament · unavailable</button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--mute)]">Friends vs Friends and Co-op vs AI are created from “Create room”. Tournament mode is not built yet and is therefore disabled.</p>
          </div>
        </div>
        {authModal}
        {toastEl}
      </div>
    );
  }

  if (view === "quick") {
    return (
      <Shell title="Match setup" onBack={() => setView("menu")}>
        <div className="panel grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
          <Field label="Your position">
            <select className="field" value={cfg.role} onChange={(e) => setCfg({ ...cfg, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_NAME[r]}</option>)}</select>
          </Field>
          <Field label="AI difficulty">
            <select className="field" value={cfg.difficulty} onChange={(e) => setCfg({ ...cfg, difficulty: e.target.value as LocalConfig["difficulty"] })}>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select>
          </Field>
          <Field label="Half length">
            <select className="field" value={cfg.halfMinutes} onChange={(e) => setCfg({ ...cfg, halfMinutes: Number(e.target.value) })}>{[1, 1.5, 2, 3, 5].map((n) => <option key={n} value={n}>{n} min</option>)}</select>
          </Field>
          <Field label="Stadium">
            <select className="field" value={cfg.stadium} onChange={(e) => setCfg({ ...cfg, stadium: e.target.value as LocalConfig["stadium"] })}>{STADIUMS.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.blurb}</option>)}</select>
          </Field>
          <Field label="Time of day">
            <select className="field" value={cfg.time} onChange={(e) => setCfg({ ...cfg, time: e.target.value as LocalConfig["time"] })}>{TIMES.map((d) => <option key={d}>{d}</option>)}</select>
          </Field>
          <Field label="Weather">
            <select className="field" value={cfg.weather} onChange={(e) => setCfg({ ...cfg, weather: e.target.value as LocalConfig["weather"] })}>{WEATHERS.map((d) => <option key={d}>{d}</option>)}</select>
          </Field>
          <div className="sm:col-span-2"><Btn variant="primary" big className="w-full" onClick={() => startLocal({ ...cfg, kind: "match" })}>Kick off</Btn></div>
        </div>
      </Shell>
    );
  }

  if (view === "practice") {
    return (
      <Shell title="Practice" onBack={() => setView("menu")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(DRILL_INFO) as DrillKind[]).map((k) => (
            <div key={k} className="panel anim-in flex flex-col gap-2 p-5">
              <div className="disp text-2xl">{DRILL_INFO[k].title}</div>
              <p className="flex-1 text-sm text-[var(--mute)]">{DRILL_INFO[k].blurb}</p>
              <Btn variant="primary" onClick={() => startLocal({ ...cfg, kind: k })}>Start</Btn>
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (view === "scores") {
    return (
      <Shell title="High scores" onBack={() => setView("menu")}>
        <div className="panel max-w-xl p-5"><HighScores list={getHighScores()} /><p className="mt-3 text-xs text-[var(--mute)]">Scores are stored in this browser only (localStorage). Online results are saved to the database instead.</p></div>
      </Shell>
    );
  }

  if (view === "settings") {
    return (
      <Shell title="Settings" onBack={() => setView("menu")}>
        <div className="panel max-w-xl p-5">
          <Slider label="Camera sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => updateSettings({ ...settings, sensitivity: v })} fmt={(v) => v.toFixed(2)} />
          <Slider label="Camera distance" value={settings.distance} min={3} max={14} step={0.25} onChange={(v) => updateSettings({ ...settings, distance: v })} fmt={(v) => `${v.toFixed(1)} m`} />
          <Slider label="Camera height" value={settings.height} min={1} max={8} step={0.25} onChange={(v) => updateSettings({ ...settings, height: v })} fmt={(v) => `${v.toFixed(1)} m`} />
          <Slider label="Master volume" value={settings.master} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ ...settings, master: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Crowd ambience" value={settings.music} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ ...settings, music: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.invertY} onChange={(e) => updateSettings({ ...settings, invertY: e.target.checked })} /> Invert vertical look</label>
          <div className="lbl">Graphics quality</div>
          <div className="flex gap-2">{(["low", "medium", "high"] as const).map((g) => <Btn key={g} variant={settings.graphics === g ? "primary" : undefined} onClick={() => updateSettings({ ...settings, graphics: g })}>{g}</Btn>)}</div>
          <p className="mt-4 text-xs text-[var(--mute)]">Key bindings can be changed from the pause menu (Esc) during a match. {user ? "Settings sync to your account." : "Sign in to sync settings to your account."}</p>
        </div>
      </Shell>
    );
  }

  if (view === "join") {
    return (
      <JoinView
        code={joinCode}
        setCode={setJoinCode}
        onBack={() => setView("menu")}
        onJoin={(c) => needAuth(() => enterRoom(c))}
        authed={!!user}
        needAuth={() => setAuth(() => () => {})}
        authModal={authModal}
        toast={toastEl}
      />
    );
  }

  if (view === "create") return <CreateView onBack={() => setView("menu")} onCreated={enterRoom} flash={flash} toast={toastEl} />;
  if (view === "profile" && user) return <ProfileView user={user} onBack={() => setView("menu")} onChanged={refreshMe} />;
  return <div className="screen" />;
}

// ---------------------------------------------------------------- sub-views
function AuthModal({ onClose, onDone, defaultName }: { onClose: () => void; onDone: () => void; defaultName: string }) {
  const [tab, setTab] = useState<"guest" | "login" | "register">("guest");
  const [f, setF] = useState({ name: defaultName === "Player" ? "" : defaultName, username: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      if (tab === "guest") await api("/api/auth/guest", "POST", { name: f.name });
      else if (tab === "login") await api("/api/auth/login", "POST", { identifier: f.username, password: f.password });
      else await api("/api/auth/register", "POST", { username: f.username, email: f.email || undefined, password: f.password });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <form className="panel anim-in w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="disp text-3xl">Online play</div>
        <p className="mb-3 text-xs text-[var(--mute)]">Rooms need a server session. Play as a guest or create an account to keep stats and friends.</p>
        <div className="mb-3 flex gap-1">{(["guest", "login", "register"] as const).map((t) => <Btn type="button" key={t} variant={tab === t ? "primary" : undefined} onClick={() => setTab(t)}>{t === "guest" ? "Guest" : t === "login" ? "Sign in" : "Register"}</Btn>)}</div>
        <div className="grid gap-3">
          {tab === "guest" ? (
            <Field label="Display name"><input className="field" autoFocus value={f.name} maxLength={24} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          ) : (
            <>
              <Field label={tab === "login" ? "Username or email" : "Username"}><input className="field" autoFocus value={f.username} maxLength={255} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
              {tab === "register" && <Field label="Email (optional)"><input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
              <Field label="Password"><input className="field" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            </>
          )}
          {err && <div className="text-sm font-bold text-[var(--pink)]">{err}</div>}
          <Btn variant="primary" type="submit" disabled={busy}>{busy ? "…" : tab === "guest" ? "Continue as guest" : tab === "login" ? "Sign in" : "Create account"}</Btn>
        </div>
      </form>
    </div>
  );
}

function JoinView({ code, setCode, onBack, onJoin, authed, needAuth, authModal, toast }: { code: string; setCode: (c: string) => void; onBack: () => void; onJoin: (c: string) => void; authed: boolean; needAuth: () => void; authModal: React.ReactNode; toast: React.ReactNode }) {
  const [list, setList] = useState<{ code: string; players: number; capacity: number; mode: string; stadium: string; halfMinutes: number; host: string }[]>([]);
  const load = useCallback(() => { if (authed) api<{ rooms: typeof list }>("/api/rooms").then((r) => setList(r.rooms)).catch(() => {}); }, [authed]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  return (
    <Shell title="Join a room" onBack={onBack}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <Field label="Room code">
            <input className="field disp text-center text-4xl tracking-[0.3em]" value={code} maxLength={5} placeholder="ABCDE" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <div className="mt-3"><Btn variant="primary" big className="w-full" disabled={code.length < 5} onClick={() => (authed ? onJoin(code) : needAuth())}>Join</Btn></div>
        </div>
        <div className="panel p-5">
          <div className="flex items-center"><div className="lbl !mb-0 flex-1">Public rooms</div><Btn variant="ghost" onClick={load}>Refresh</Btn></div>
          {!authed && <p className="mt-2 text-sm text-[var(--mute)]">Sign in to browse public rooms.</p>}
          {authed && list.length === 0 && <p className="mt-2 text-sm text-[var(--mute)]">No public rooms right now. Create one or try Quick match.</p>}
          <div className="mt-2 grid gap-2">
            {list.map((r) => (
              <div key={r.code} className="slot">
                <span className="disp text-xl">{r.code}</span>
                <span className="flex-1 text-xs text-[var(--mute)]">{r.host} · {r.halfMinutes} min halves · {r.players}/{r.capacity}</span>
                <Btn onClick={() => onJoin(r.code)}>Join</Btn>
              </div>
            ))}
          </div>
        </div>
      </div>
      {authModal}
      {toast}
    </Shell>
  );
}

function CreateView({ onBack, onCreated, flash, toast }: { onBack: () => void; onCreated: (c: string) => void; flash: (m: string) => void; toast: React.ReactNode }) {
  const [f, setF] = useState({ mode: "private", halfMinutes: 5, difficulty: "medium", stadium: "international", time: "day", weather: "clear", isPublic: false });
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Create room" onBack={onBack}>
      <div className="panel grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
        <Field label="Mode">
          <select className="field" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            <option value="private">Private room</option>
            <option value="friends">Friends vs Friends</option>
            <option value="coop">Co-op vs AI (all humans on Team A)</option>
          </select>
        </Field>
        <Field label="Half length"><select className="field" value={f.halfMinutes} onChange={(e) => setF({ ...f, halfMinutes: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} min</option>)}</select></Field>
        <Field label="AI difficulty"><select className="field" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Stadium"><select className="field" value={f.stadium} onChange={(e) => setF({ ...f, stadium: e.target.value })}>{STADIUMS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Time of day"><select className="field" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}>{TIMES.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Weather"><select className="field" value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })}>{WEATHERS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> List this room in public room discovery</label>
        <div className="sm:col-span-2">
          <Btn variant="primary" big className="w-full" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<{ code: string }>("/api/rooms", "POST", f); onCreated(r.code); } catch (e) { flash((e as Error).message); } finally { setBusy(false); } }}>Create room</Btn>
        </div>
      </div>
      {toast}
    </Shell>
  );
}

function ProfileView({ user, onBack, onChanged }: { user: User; onBack: () => void; onChanged: () => void }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [matches, setMatches] = useState<{ id: string; teamAName: string; teamBName: string; scoreA: number; scoreB: number; team: number; position: string; goals: number; assists: number; mode: string; playedAt: string }[]>([]);
  const [friends, setFriends] = useState<{ id: string; status: string; name: string; incoming: boolean }[]>([]);
  const [ap, setAp] = useState<Appearance>(user.appearance);
  const [dn, setDn] = useState(user.displayName);
  const [fn, setFn] = useState("");
  const [msg, setMsg] = useState("");
  const loadAll = useCallback(() => {
    api<{ stats: Record<string, number> | null }>("/api/stats").then((r) => setStats(r.stats)).catch(() => {});
    api<{ matches: typeof matches }>("/api/matches").then((r) => setMatches(r.matches)).catch(() => {});
    api<{ friends: typeof friends }>("/api/friends").then((r) => setFriends(r.friends)).catch(() => {});
  }, []);
  useEffect(loadAll, [loadAll]);
  const save = async () => {
    try {
      await api("/api/profile", "PATCH", { displayName: dn, ...ap });
      setMsg("Saved ✓ (applies to the next room you join)");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const pick = (k: keyof Appearance, n: number) => setAp({ ...ap, [k]: n });
  return (
    <Shell title="Profile" onBack={onBack}>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="panel flex flex-col items-center p-4">
          <CharacterPreview kit={DEFAULT_KITS[0]} gk={false} number={10} appearance={ap} size={220} />
          <div className="mt-2 grid w-full gap-2">
            <Field label="Display name"><input className="field" value={dn} maxLength={24} onChange={(e) => setDn(e.target.value)} /></Field>
            <Field label="Body"><div className="flex gap-1">{(["m", "f"] as const).map((g) => <Btn key={g} variant={ap.gender === g ? "primary" : undefined} onClick={() => setAp({ ...ap, gender: g })}>{g === "m" ? "Male" : "Female"}</Btn>)}</div></Field>
            {([["hair", "Hairstyle"], ["hairColor", "Hair colour"], ["skin", "Skin tone"]] as const).map(([k, l]) => (
              <Field key={k} label={l}><div className="flex gap-1">{[0, 1, 2, 3, 4, 5].map((n) => <Btn key={n} variant={ap[k] === n ? "primary" : undefined} className="!px-3" onClick={() => pick(k, n)}>{n + 1}</Btn>)}</div></Field>
            ))}
            <Btn variant="primary" onClick={save}>Save profile</Btn>
            {msg && <div className="text-xs text-[var(--gold)]">{msg}</div>}
          </div>
        </div>
        <div className="grid content-start gap-4">
          <div className="panel p-4">
            <div className="lbl">Career statistics (server)</div>
            {stats ? (
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
                {[["Matches", stats.matches], ["Wins", stats.wins], ["Draws", stats.draws], ["Losses", stats.losses], ["Goals", stats.goals], ["Assists", stats.assists], ["Saves", stats.saves], ["Tackles", stats.tackles], ["Playtime", `${Math.round(stats.playtimeSeconds / 60)}m`]].map(([k, v]) => (
                  <div key={String(k)} className="rounded-xl bg-white/5 p-2"><div className="lbl !mb-0">{k}</div><div className="disp text-2xl">{v}</div></div>
                ))}
              </div>
            ) : <div className="text-sm text-[var(--mute)]">No statistics yet.</div>}
          </div>
          <div className="panel p-4">
            <div className="lbl">Recent online matches</div>
            {matches.length === 0 && <div className="text-sm text-[var(--mute)]">Play an online match to see history here.</div>}
            {matches.map((m) => (
              <div key={m.id} className="flex items-center gap-2 border-t border-[var(--line)] py-1.5 text-sm">
                <span className="flex-1 truncate">{m.teamAName} <b>{m.scoreA}–{m.scoreB}</b> {m.teamBName}</span>
                <span className="chip">{ROLE_LABEL[m.position as Role] ?? m.position}</span>
                <span className="text-xs text-[var(--mute)]">{m.goals}G {m.assists}A</span>
              </div>
            ))}
          </div>
          <div className="panel p-4">
            <div className="lbl">Friends</div>
            {user.isGuest ? <div className="text-sm text-[var(--mute)]">Guests cannot add friends — register an account.</div> : (
              <>
                <div className="flex gap-2"><input className="field" placeholder="Add by username" value={fn} onChange={(e) => setFn(e.target.value)} /><Btn onClick={async () => { try { await api("/api/friends", "POST", { username: fn }); setFn(""); loadAll(); } catch (e) { setMsg((e as Error).message); } }}>Add</Btn></div>
                {friends.map((f) => (
                  <div key={f.id} className="mt-2 flex items-center gap-2 text-sm">
                    <span className="flex-1 font-bold">{f.name}</span>
                    <span className="chip">{f.status === "accepted" ? "friend" : f.incoming ? "wants to be friends" : "request sent"}</span>
                    {f.incoming && <Btn onClick={async () => { await api("/api/friends", "PATCH", { id: f.id, action: "accept" }); loadAll(); }}>Accept</Btn>}
                    <Btn variant="ghost" onClick={async () => { await api("/api/friends", "PATCH", { id: f.id, action: f.incoming ? "decline" : "remove" }); loadAll(); }}>✕</Btn>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
