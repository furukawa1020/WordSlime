import type { TextFeatures } from "./textFeatures";

export type SlimeGenome = {
  energy: number;
  viscosity: number;
  cohesion: number;
  separation: number;
  turbulence: number;
  decay: number;
  fertility: number;
  brightness: number;
  noiseScale: number;
  pitchBase: number;
  chirpRate: number;
};

export function mapFeaturesToGenome(features: TextFeatures): SlimeGenome {
  const lengthPressure = saturate(features.length / 120);
  const repetition = features.repeatRatio;
  const punctuation = features.punctuationRatio;
  const exclamation = saturate(features.exclamationCount / 6);
  const question = saturate(features.questionCount / 6);
  const ellipsis = saturate(features.ellipsisCount / 4);
  const softScript = features.hiraganaRatio;
  const sharpScript = features.katakanaRatio + punctuation * 0.35;
  const heavyScript = features.kanjiRatio;
  const latin = features.latinRatio;
  const digit = features.digitRatio;
  const emoji = features.emojiRatio;
  const rhythm = features.rhythmVariance;

  return normalizeGenome({
    energy:
      0.34 +
      exclamation * 0.36 +
      repetition * 0.12 +
      sharpScript * 0.1 +
      digit * 0.1 -
      ellipsis * 0.44 -
      heavyScript * 0.08,
    viscosity:
      0.36 +
      softScript * 0.25 +
      ellipsis * 0.58 +
      heavyScript * 0.12 -
      latin * 0.12 -
      exclamation * 0.08,
    cohesion:
      0.46 +
      lengthPressure * 0.18 +
      softScript * 0.12 +
      heavyScript * 0.2 -
      question * 0.28 -
      emoji * 0.08,
    separation:
      0.28 +
      question * 0.35 +
      exclamation * 0.12 +
      emoji * 0.18 +
      sharpScript * 0.08 -
      heavyScript * 0.08,
    turbulence:
      0.22 +
      exclamation * 0.4 +
      punctuation * 0.18 +
      rhythm * 0.22 +
      emoji * 0.24 +
      digit * 0.12,
    decay:
      0.26 +
      ellipsis * 0.24 +
      heavyScript * 0.2 +
      lengthPressure * 0.12 -
      exclamation * 0.08,
    fertility:
      0.18 +
      repetition * 0.48 +
      exclamation * 0.1 +
      emoji * 0.14 +
      lengthPressure * 0.08,
    brightness:
      0.42 +
      exclamation * 0.2 +
      emoji * 0.22 +
      repetition * 0.08 +
      ellipsis * -0.14 +
      heavyScript * -0.08,
    noiseScale:
      0.28 +
      latin * 0.3 +
      digit * 0.2 +
      rhythm * 0.18 +
      emoji * 0.16 -
      softScript * 0.08,
    pitchBase:
      0.34 +
      latin * 0.12 +
      digit * 0.22 +
      sharpScript * 0.18 +
      question * 0.15 -
      ellipsis * 0.22 -
      heavyScript * 0.12,
    chirpRate:
      0.16 +
      repetition * 0.42 +
      emoji * 0.22 +
      exclamation * 0.12 +
      question * 0.1 -
      ellipsis * 0.12,
  });
}

export function particleCountForFeatures(
  features: TextFeatures,
  multiplier = 1,
): number {
  const count =
    24 +
    features.length * 8 +
    features.repeatRatio * 120 +
    features.emojiRatio * 80;

  return Math.round(clamp(count * multiplier, 24, 1200 * multiplier));
}

function normalizeGenome(genome: SlimeGenome): SlimeGenome {
  return {
    energy: saturate(genome.energy),
    viscosity: saturate(genome.viscosity),
    cohesion: saturate(genome.cohesion),
    separation: saturate(genome.separation),
    turbulence: saturate(genome.turbulence),
    decay: saturate(genome.decay),
    fertility: saturate(genome.fertility),
    brightness: saturate(genome.brightness),
    noiseScale: saturate(genome.noiseScale),
    pitchBase: saturate(genome.pitchBase),
    chirpRate: saturate(genome.chirpRate),
  };
}

function saturate(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
