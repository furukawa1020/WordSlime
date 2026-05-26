import type { SlimeGenome } from "../input/genome";
import type { TextFeatures } from "../input/textFeatures";
import type { AppSettings } from "./settings";
import { defaultSettings } from "./settings";

export type Vec2 = {
  x: number;
  y: number;
};

export type WordSeed = {
  id: string;
  text: string;
  createdAt: number;
  features: TextFeatures;
  genome: SlimeGenome;
  particleCount: number;
  origin: Vec2;
};

export type AppState = {
  isPaused: boolean;
  seeds: WordSeed[];
  settings: AppSettings;
  queuedInputs: number;
  totalParticles: number;
  performance: {
    fps: number;
    degraded: boolean;
  };
};

export function createInitialState(): AppState {
  return {
    isPaused: false,
    seeds: [],
    settings: defaultSettings,
    queuedInputs: 0,
    totalParticles: 0,
    performance: {
      fps: 0,
      degraded: false,
    },
  };
}
