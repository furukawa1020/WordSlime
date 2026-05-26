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

export const defaultSettings: AppSettings = {
  mode: "slime",
  particleQuality: "medium",
  audioMode: "off",
  background: "deep-sea",
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

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
  low: 0.45,
  medium: 1,
  high: 1.8,
  insane: 3,
};

export const qualityParticleBudgets: Record<ParticleQuality, number> = {
  low: 2000,
  medium: 6000,
  high: 10000,
  insane: 10000,
};

export const backgroundLabels: Record<BackgroundMode, string> = {
  dark: "Dark",
  milk: "Milk",
  "deep-sea": "Deep Sea",
  paper: "Paper",
};
