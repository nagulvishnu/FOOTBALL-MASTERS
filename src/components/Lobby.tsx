"use client";
import { useState } from "react";
import type { RoomView } from "@/game/client/sources";
import { DIFFICULTIES, KIT_COLORS, PATTERNS, ROLES, ROLE_LABEL, ROLE_NAME, ROLE_NUMBER, STADIUMS, TACTICS, TACTIC_LABEL, TIMES, WEATHERS } from "@/game/shared/constants";
import type { Role, Team } from "@/game/shared/types";
import { api, Btn, CharacterPreview, Field } from "./ui";

export default function Lobby({ room, me, netStatus, onLeave }: { room: RoomView; me: string; netStatus: string; onLeave: () => void }) {
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const mine = room.members.find((m) => m.userId === me);
  const isHost = room.hostId === me;
  const locked = room.state !== "lobby";
  const act = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/rooms/${room.code}/action`, "POST", body);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };
  const link = typeof window !== "undefined" ? `${location.origin}/?room=${room.code}` : "";
  const everyoneReady = room.members.length > 0 && room.members.every((m) => m.team !== null && m.role && (m.ready || m.userId === room.hostId));
  const s = room.settings;
  const kit = room.kits[mine?.team ?? 0];

  return (
    <div className="screen">
      <div className="pitchlines" />
      <div className="relative mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Btn variant="ghost" onClick={onLeave}>← Leave</Btn>
          <div>
            <div className="lbl !mb-0">Room code</div>
            <div className="disp title text-5xl tracking-[0.2em]">{room.code}</div>
          </div>
          <Btn onClick={() => copy("code", room.code)}>{copied === "code" ? "Copied ✓" : "Copy code"}</Btn>
          <Btn variant="gold" onClick={() => copy("link", link)}>{copied === "link" ? "Link copied ✓" : "Copy invitation link"}</Btn>
          <span className="chip">{s.mode === "coop" ? "Co-op vs AI" : s.mode === "quick" ? "Quick match" : s.mode === "friends" ? "Friends vs Friends" : "Private room"}</span>
          <span className="chip" style={{ background: netStatus === "open" ? "rgba(125,255,154,.2)" : "rgba(255,59,107,.3)" }}>{netStatus === "open" ? "● connected" : netStatus}</span>
          <span className="chip">{room.members.length}/14 players</span>
        </div>
        {err && <div className="mb-3 rounded-xl border border-[var(--pink)] bg-[rgba(255,59,107,.12)] px-4 py-2 text-sm font-bold">{err}</div>}
        {s.mode === "quick" && room.state === "lobby" && <div className="panel mb-3 p-3 text-sm text-[var(--gold)]">Matchmaking: the match starts automatically once at least 2 players are connected. AI fills every empty position.</div>}

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px]">
          {([0, 1] as Team[]).map((t) => {
            const k = room.kits[t];
            const members = room.members.filter((m) => m.team === t);
            const cap = members.find((m) => m.isCaptain);
            const iAmCaptain = mine?.team === t && mine.isCaptain;
            return (
              <div key={t} className="panel p-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg border border-white/30" style={{ background: `linear-gradient(135deg, ${k.primary} 55%, ${k.secondary} 55%)` }} />
                  <div className="flex-1">
                    <div className="disp text-2xl">{k.name}</div>
                    <div className="text-[11px] text-[var(--mute)]">{cap ? `Captain: ${cap.name}` : "No captain yet"} · {TACTIC_LABEL[room.tactics[t] as keyof typeof TACTIC_LABEL]}</div>
                  </div>
                  <Btn variant={mine?.team === t ? "primary" : undefined} disabled={locked || (s.mode === "coop" && t === 1)} onClick={() => act({ type: "team", team: t })}>
                    {mine?.team === t ? "Your team" : s.mode === "coop" && t === 1 ? "AI team" : "Join"}
                  </Btn>
                </div>
                <div className="mt-3 grid gap-1.5">
                  {ROLES.map((r) => {
                    const occ = members.find((m) => m.role === r);
                    const isMine = occ?.userId === me;
                    const canTake = !occ && mine?.team === t && !locked;
                    return (
                      <div key={r} className={`slot ${isMine ? "mine" : ""} ${canTake ? "open" : ""}`} onClick={() => canTake && act({ type: "role", role: r })} title={ROLE_NAME[r]}>
                        <span className="disp w-12 text-lg text-[var(--gold)]">{ROLE_LABEL[r]}</span>
                        <span className="flex-1 truncate text-sm font-bold">
                          {occ ? occ.name : <span className="text-[var(--mute)]">{canTake ? "Open — click to take" : "CPU (AI controlled)"}</span>}
                        </span>
                        {occ && (
                          <>
                            {occ.isHost && <span className="chip">host</span>}
                            {occ.isCaptain && <span className="chip" style={{ color: "var(--gold)" }}>C</span>}
                            <span title={occ.connected ? "connected" : "offline"} style={{ color: occ.connected ? "var(--lime)" : "var(--pink)" }}>●</span>
                            <span className="chip" style={occ.ready || occ.isHost ? { background: "rgba(182,255,60,.25)" } : undefined}>{occ.ready || occ.isHost ? "ready" : "…"}</span>
                            {isHost && !isMine && !locked && <button className="text-xs text-[var(--pink)]" onClick={(e) => { e.stopPropagation(); act({ type: "kick", userId: occ.userId }); }}>✕</button>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {iAmCaptain && !locked && (
                  <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3">
                    <div className="lbl !mb-0">Captain controls</div>
                    <input className="field" defaultValue={k.name} maxLength={18} onBlur={(e) => e.target.value !== k.name && act({ type: "kit", team: t, name: e.target.value })} />
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="lbl !mb-0 mr-1">Primary</span>
                      {KIT_COLORS.map((c) => <button key={c} aria-label={c} className="h-5 w-5 rounded-full border border-white/40" style={{ background: c, outline: k.primary === c ? "2px solid #fff" : "none" }} onClick={() => act({ type: "kit", team: t, primary: c })} />)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="lbl !mb-0 mr-1">Secondary</span>
                      {KIT_COLORS.map((c) => <button key={c} aria-label={c} className="h-5 w-5 rounded-full border border-white/40" style={{ background: c, outline: k.secondary === c ? "2px solid #fff" : "none" }} onClick={() => act({ type: "kit", team: t, secondary: c })} />)}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="field" value={k.pattern} onChange={(e) => act({ type: "kit", team: t, pattern: e.target.value })}>{PATTERNS.map((p) => <option key={p}>{p}</option>)}</select>
                      <select className="field" value={room.tactics[t]} onChange={(e) => act({ type: "tactic", team: t, tactic: e.target.value })}>{TACTICS.map((x) => <option key={x} value={x}>{TACTIC_LABEL[x]}</option>)}</select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="grid content-start gap-4">
            <div className="panel flex flex-col items-center p-4">
              <div className="lbl self-start">Character preview</div>
              {mine && mine.team !== null ? (
                <CharacterPreview kit={kit} gk={mine.role === "GK"} number={mine.role ? ROLE_NUMBER[mine.role as Role] : 10} appearance={mine.appearance} size={200} />
              ) : (
                <div className="flex h-[250px] items-center text-center text-sm text-[var(--mute)]">Pick a team and position to preview your player</div>
              )}
              <div className="mt-1 text-sm font-bold">{mine?.role ? `${mine.name} · ${ROLE_NAME[mine.role as Role]}` : mine?.name}</div>
              <div className="mt-3 grid w-full gap-2">
                <Btn variant={mine?.ready ? "gold" : "primary"} big disabled={locked || !mine?.role} onClick={() => act({ type: "ready", ready: !mine?.ready })}>
                  {mine?.ready ? "Ready ✓ (click to undo)" : "Confirm & ready"}
                </Btn>
                {isHost && room.state === "lobby" && (
                  <Btn variant="primary" disabled={!everyoneReady} onClick={() => act({ type: "start" })}>
                    Start match {everyoneReady ? "" : "(waiting for players)"}
                  </Btn>
                )}
                {isHost && room.state === "finished" && <Btn variant="primary" big onClick={() => act({ type: "rematch" })}>Rematch (back to lobby)</Btn>}
                {room.state === "finished" && !isHost && <div className="text-center text-xs text-[var(--mute)]">Match finished — waiting for the host to start a rematch.</div>}
                {isHost && room.state === "countdown" && <Btn variant="danger" onClick={() => act({ type: "cancel" })}>Cancel countdown</Btn>}
                {!isHost && <div className="text-center text-xs text-[var(--mute)]">Waiting for the host to start.</div>}
              </div>
            </div>
            <div className="panel p-4">
              <div className="lbl">Match settings {isHost ? "" : "(host only)"}</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Half length">
                  <select className="field" disabled={!isHost || locked} value={s.halfMinutes} onChange={(e) => act({ type: "settings", halfMinutes: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} min</option>)}</select>
                </Field>
                <Field label="AI level">
                  <select className="field" disabled={!isHost || locked} value={s.difficulty} onChange={(e) => act({ type: "settings", difficulty: e.target.value })}>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select>
                </Field>
                <Field label="Stadium">
                  <select className="field" disabled={!isHost || locked} value={s.stadium} onChange={(e) => act({ type: "settings", stadium: e.target.value })}>{STADIUMS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                </Field>
                <Field label="Time of day">
                  <select className="field" disabled={!isHost || locked} value={s.time} onChange={(e) => act({ type: "settings", time: e.target.value })}>{TIMES.map((d) => <option key={d}>{d}</option>)}</select>
                </Field>
                <Field label="Weather">
                  <select className="field" disabled={!isHost || locked} value={s.weather} onChange={(e) => act({ type: "settings", weather: e.target.value })}>{WEATHERS.map((d) => <option key={d}>{d}</option>)}</select>
                </Field>
                <Field label="Listed publicly">
                  <select className="field" disabled={!isHost || locked} value={String(s.isPublic)} onChange={(e) => act({ type: "settings", isPublic: e.target.value === "true" })}><option value="false">Private</option><option value="true">Public</option></select>
                </Field>
              </div>
            </div>
          </div>
        </div>
      </div>
      {room.state === "countdown" && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="lbl">Kick-off in</div>
          <div key={room.countdown} className="disp title" style={{ fontSize: "clamp(120px,28vw,300px)", animation: "pulse .6s" }}>{room.countdown}</div>
          <div className="text-[var(--mute)]">Positions lock at kickoff</div>
        </div>
      )}
    </div>
  );
}
