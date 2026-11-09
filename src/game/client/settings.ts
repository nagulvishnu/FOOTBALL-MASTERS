import type { Quality } from "./world";

export interface Settings {
  sensitivity: number;
  distance: number;
  height: number;
  graphics: Quality;
  master: number;
  music: number;
  invertY: boolean;
  keys: Record<string, string>;
}

export const DEFAULT_KEYS: Record<string, string> = {
  up: "KeyW",
  left: "KeyA",
  down: "KeyS",
  right: "KeyD",
  sprint: "ShiftLeft",
  pass: "KeyJ",
  through: "KeyK",
  shoot: "Space",
  cross: "KeyL",
  tackle: "KeyE",
  support: "KeyQ",
  jump: "KeyF",
  tactical: "KeyC",
};

export const KEY_LABELS: Record<string, string> = {
  up: "Move forward",
  left: "Move left",
  down: "Move backward",
  right: "Move right",
  sprint: "Sprint",
  pass: "Short pass",
  through: "Through pass",
  shoot: "Shoot (hold to charge)",
  cross: "Cross / lofted pass",
  tackle: "Tackle (slide while sprinting)",
  support: "Call support / tactical",
  jump: "Jump / GK dive",
  tactical: "Toggle tactical camera",
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  distance: 6.5,
  height: 3.2,
  graphics: "medium",
  master: 0.8,
  music: 0.5,
  invertY: false,
  keys: DEFAULT_KEYS,
};

const KEY = "fm_settings_v1";

/** localStorage is only a preference cache; signed-in users sync settings through /api/settings. */
export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const mobile = window.matchMedia?.("(pointer: coarse)").matches;
    return { ...DEFAULT_SETTINGS, graphics: mobile ? "low" : DEFAULT_SETTINGS.graphics, ...raw, keys: { ...DEFAULT_KEYS, ...(raw.keys ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export const keyName = (code: string) => code.replace(/^Key/, "").replace(/^Digit/, "").replace("Left", "").replace("ShiftL", "Shift").replace("Space", "Space");

// ---------------------------------------------------------------- local high-score table
export interface HighScore {
  name: string;
  score: number;
  mode: string;
  detail: string;
  date: number;
}
const HS = "fm_highscores_v1";
export function getHighScores(): HighScore[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HS) ?? "[]");
  } catch {
    return [];
  }
}
export function addHighScore(h: HighScore): { rank: number; list: HighScore[] } {
  const list = [...getHighScores(), h].sort((a, b) => b.score - a.score).slice(0, 10);
  try {
    localStorage.setItem(HS, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return { rank: list.findIndex((x) => x === h) + 1, list };
}
