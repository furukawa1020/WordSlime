export type SimulationMode = "slime" | "swarm" | "smoke" | "fungus" | "glitch";
export type ParticleQuality = "low" | "medium" | "high" | "insane";
export type AudioMode = "off" | "soft" | "weird" | "loud";
export type BackgroundMode = "dark" | "milk" | "deep-sea" | "paper";

export type AppSettings = {
  mode: SimulationMode;
  particleQuality: ParticleQuality;
  audioMode: AudioMode;
  background: BackgroundMode;
  reduceMotion: boolean;
};

const settingsStorageKey = "wordslime:settings";
const simulationModes = ["slime", "swarm", "smoke", "fungus", "glitch"] as const;
const particleQualities = ["low", "medium", "high", "insane"] as const;
const backgroundModes = ["dark", "milk", "deep-sea", "paper"] as const;

export const defaultSettings: AppSettings = createDefaultSettings();

export function createDefaultSettings(): AppSettings {
  return {
    mode: "slime",
    particleQuality: "medium",
    audioMode: "off",
    background: "deep-sea",
    reduceMotion: prefersReducedMotion(),
  };
}

export function loadSettings(): AppSettings {
  const settings = createDefaultSettings();

  try {
    const raw = window.localStorage.getItem(settingsStorageKey);

    if (!raw) {
      return settings;
    }

    const saved = JSON.parse(raw) as Partial<AppSettings>;

    return {
      ...settings,
      mode: oneOf(saved.mode, simulationModes) ?? settings.mode,
      particleQuality:
        oneOf(saved.particleQuality, particleQualities) ?? settings.particleQuality,
      background: oneOf(saved.background, backgroundModes) ?? settings.background,
    };
  } catch {
    return settings;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({
        mode: settings.mode,
        particleQuality: settings.particleQuality,
        background: settings.background,
      }),
    );
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

export const modeLabels: Record<SimulationMode, string> = {
  slime: "Slime",
  swarm: "Swarm",
  smoke: "Smoke",
  fungus: "Fungus",
  glitch: "Glitch",
};

export const qualityLabels: Record<ParticleQuality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  insane: "Insane",
};

export const qualityParticleMultipliers: Record<ParticleQuality, number> = {
  low: 0.55,
  medium: 1.6,
  high: 5,
  insane: 16,
};

export const qualityParticleBudgets: Record<ParticleQuality, number> = {
  low: 2500,
  medium: 12000,
  high: 48000,
  insane: 120000,
};

export const backgroundLabels: Record<BackgroundMode, string> = {
  dark: "Dark",
  milk: "Milk",
  "deep-sea": "Deep Sea",
  paper: "Paper",
};
