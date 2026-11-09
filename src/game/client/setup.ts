// Builds everything the engine needs for an OFFLINE session (quick play skirmish or practice drill).
import { DIFFICULTIES, slotIdx, type StadiumId } from "../shared/constants";
import type { Appearance, Difficulty, DrillKind, Kit, Role, RosterEntry } from "../shared/types";
import { MatchSim } from "../sim/sim";
import { localRoster, LocalSource, type GameSource } from "./sources";

export const DEFAULT_KITS: [Kit, Kit] = [
  { name: "Team A", primary: "#e63946", secondary: "#ffffff", pattern: "stripes", gk: "#f4d03f" },
  { name: "Team B", primary: "#1d6fe8", secondary: "#ffffff", pattern: "hoops", gk: "#2ecc71" },
];

export interface LocalConfig {
  kind: "match" | DrillKind;
  name: string;
  appearance: Appearance;
  role: Role;
  difficulty: Difficulty;
  halfMinutes: number;
  stadium: StadiumId;
  time: "day" | "evening" | "night";
  weather: "clear" | "cloudy" | "rain";
}

export interface GameSetup {
  label: string;
  kind: "local" | "online";
  source: GameSource;
  roster: RosterEntry[];
  you: number;
  kits: [Kit, Kit];
  stadium: StadiumId;
  time: "day" | "evening" | "night";
  weather: "clear" | "cloudy" | "rain";
  drill?: DrillKind;
  mode: string;
  sim?: MatchSim;
}

export const DEFAULT_LOCAL: LocalConfig = {
  kind: "match",
  name: "Player",
  appearance: { gender: "m", hair: 0, hairColor: 1, skin: 1 },
  role: "LW",
  difficulty: "medium",
  halfMinutes: 1.5,
  stadium: "international",
  time: "day",
  weather: "clear",
};

export function makeLocalSetup(c: LocalConfig): GameSetup {
  const drill = c.kind === "match" ? undefined : c.kind;
  const sim = new MatchSim({
    halfSeconds: Math.round(c.halfMinutes * 60),
    halftimeSeconds: 6,
    difficulty: DIFFICULTIES.includes(c.difficulty) ? c.difficulty : "medium",
    tactics: ["balanced", "balanced"],
    seed: (Math.random() * 2 ** 30) | 0,
    drill,
    drillHuman: slotIdx(0, c.role),
  });
  const you = drill ? sim.drill!.human : slotIdx(0, c.role);
  sim.setHuman(you, true, c.name);
  for (const p of sim.players) if (p.idx !== you) p.name = `CPU ${p.role}`;
  const roster = localRoster(you, c.name, c.appearance, drill ? (i) => sim.players[i].active : undefined);
  return {
    label: drill ? c.kind : "Quick Play",
    kind: "local",
    source: new LocalSource(sim, you),
    roster,
    you,
    kits: DEFAULT_KITS,
    stadium: c.stadium,
    time: c.time,
    weather: c.weather,
    drill,
    mode: drill ? "practice" : "skirmish",
    sim,
  };
}
