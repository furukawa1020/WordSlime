import type {
  BackgroundMode,
  SimulationMode,
} from "../app/settings";

export const AUTO_PERFORMANCE_DURATION_MS = 180_000;

export type PerformanceMovement = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  mode: SimulationMode;
  background: BackgroundMode;
  bpm: number;
  rootFrequency: number;
  intensity: readonly [number, number];
  phrases: readonly string[];
  seedEveryBeats: number;
};

export type PerformanceFrame = {
  elapsedMs: number;
  durationMs: number;
  progress: number;
  movementIndex: number;
  movementProgress: number;
  intensity: number;
  phase: number;
  movement: PerformanceMovement;
};

export type PerformanceBeatEvent = {
  kind: "beat";
  atMs: number;
  movementIndex: number;
  beat: number;
  frequency: number;
  intensity: number;
  texture: number;
  duration: number;
  pan: number;
  accent: boolean;
};

export type PerformanceSeedEvent = {
  kind: "seed";
  atMs: number;
  movementIndex: number;
  text: string;
};

export type PerformanceEvent =
  | PerformanceBeatEvent
  | PerformanceSeedEvent;

export const performanceMovements: readonly PerformanceMovement[] = [
  {
    id: "germination",
    label: "GERMINATION",
    startMs: 0,
    endMs: 24_000,
    mode: "fungus",
    background: "deep-sea",
    bpm: 52,
    rootFrequency: 55,
    intensity: [0.18, 0.42],
    phrases: ["・・・", "ことばの底", "ゆら　ゆら", "発芽発芽"],
    seedEveryBeats: 5,
  },
  {
    id: "liquefaction",
    label: "LIQUEFACTION",
    startMs: 24_000,
    endMs: 52_000,
    mode: "slime",
    background: "dark",
    bpm: 66,
    rootFrequency: 65.41,
    intensity: [0.36, 0.68],
    phrases: ["ぬるぬるぬる", "融解融解", "oooOOO", "ことば／液体"],
    seedEveryBeats: 6,
  },
  {
    id: "swarm",
    label: "SWARM",
    startMs: 52_000,
    endMs: 82_000,
    mode: "swarm",
    background: "deep-sea",
    bpm: 82,
    rootFrequency: 73.42,
    intensity: [0.58, 0.88],
    phrases: ["群群群群", "swarm//swarm", "88888888", "→→→→→"],
    seedEveryBeats: 8,
  },
  {
    id: "hypercube",
    label: "HYPERCUBE",
    startMs: 82_000,
    endMs: 114_000,
    mode: "glitch",
    background: "dark",
    bpm: 104,
    rootFrequency: 82.41,
    intensity: [0.74, 1],
    phrases: ["!!! 4D SIGNAL !!!", "ERROR ERROR ??", "101010101", "次元次元次元"],
    seedEveryBeats: 10,
  },
  {
    id: "mycelium",
    label: "MYCELIUM",
    startMs: 114_000,
    endMs: 148_000,
    mode: "fungus",
    background: "paper",
    bpm: 62,
    rootFrequency: 49,
    intensity: [0.72, 0.4],
    phrases: ["胞子　胞子　胞子", "菌糸菌糸", "branch.branch", "土へ　土へ"],
    seedEveryBeats: 5,
  },
  {
    id: "dissolution",
    label: "DISSOLUTION",
    startMs: 148_000,
    endMs: AUTO_PERFORMANCE_DURATION_MS,
    mode: "smoke",
    background: "deep-sea",
    bpm: 44,
    rootFrequency: 55,
    intensity: [0.42, 0.06],
    phrases: ["…………", "dissolve", "おやすみ", "　　。"],
    seedEveryBeats: 4,
  },
] as const;

export const performanceEvents: readonly PerformanceEvent[] =
  createPerformanceEvents();

export function performanceFrameAt(elapsedMs: number): PerformanceFrame {
  const elapsed = clamp(elapsedMs, 0, AUTO_PERFORMANCE_DURATION_MS);
  const movementIndex = movementIndexAt(elapsed);
  const movement = performanceMovements[movementIndex];
  const movementDuration = movement.endMs - movement.startMs;
  const movementProgress = clamp(
    (elapsed - movement.startMs) / movementDuration,
    0,
    1,
  );
  const eased = easeInOutSine(movementProgress);
  const baseIntensity = mix(
    movement.intensity[0],
    movement.intensity[1],
    eased,
  );
  const beatPhase =
    ((elapsed - movement.startMs) / (60_000 / movement.bpm)) % 1;
  const pulse = Math.sin(beatPhase * Math.PI) ** 8;

  return {
    elapsedMs: elapsed,
    durationMs: AUTO_PERFORMANCE_DURATION_MS,
    progress: elapsed / AUTO_PERFORMANCE_DURATION_MS,
    movementIndex,
    movementProgress,
    intensity: clamp(baseIntensity + pulse * 0.08, 0, 1),
    phase: beatPhase,
    movement,
  };
}

export type AutoPerformanceHooks = {
  onStart(): void;
  onFrame(frame: PerformanceFrame): void;
  onMovement(frame: PerformanceFrame): void;
  onEvent(event: PerformanceEvent): void;
  onStop(completed: boolean): void;
};

export class AutoPerformanceConductor {
  private frameHandle = 0;
  private startedAt = 0;
  private eventIndex = 0;
  private activeMovementIndex = -1;
  private running = false;

  constructor(private readonly hooks: AutoPerformanceHooks) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.startedAt = performance.now();
    this.eventIndex = 0;
    this.activeMovementIndex = -1;
    this.hooks.onStart();
    this.tick(this.startedAt);
  }

  stop(completed = false): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.hooks.onStop(completed);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) {
      return;
    }

    const elapsed = Math.min(
      AUTO_PERFORMANCE_DURATION_MS,
      Math.max(0, now - this.startedAt),
    );
    const frame = performanceFrameAt(elapsed);

    if (frame.movementIndex !== this.activeMovementIndex) {
      this.activeMovementIndex = frame.movementIndex;
      this.hooks.onMovement(frame);
    }

    while (
      this.eventIndex < performanceEvents.length &&
      performanceEvents[this.eventIndex].atMs <= elapsed
    ) {
      const event = performanceEvents[this.eventIndex];

      if (elapsed - event.atMs <= 1200) {
        this.hooks.onEvent(event);
      }

      this.eventIndex += 1;
    }

    this.hooks.onFrame(frame);

    if (elapsed >= AUTO_PERFORMANCE_DURATION_MS) {
      this.stop(true);
      return;
    }

    this.frameHandle = requestAnimationFrame(this.tick);
  };
}

function movementIndexAt(elapsedMs: number): number {
  const index = performanceMovements.findIndex(
    (movement) => elapsedMs < movement.endMs,
  );

  return index >= 0 ? index : performanceMovements.length - 1;
}

function createPerformanceEvents(): PerformanceEvent[] {
  const events: PerformanceEvent[] = [];
  const scale = [0, 3, 5, 7, 10, 12, 15, 17];

  performanceMovements.forEach((movement, movementIndex) => {
    const beatDuration = 60_000 / movement.bpm;
    const beatCount = Math.ceil(
      (movement.endMs - movement.startMs) / beatDuration,
    );

    for (let beat = 0; beat < beatCount; beat += 1) {
      const atMs = movement.startMs + beat * beatDuration;

      if (atMs >= movement.endMs) {
        break;
      }

      const localProgress = beat / Math.max(1, beatCount - 1);
      const accent = beat % 4 === 0;
      const semitone = scale[(beat * 3 + movementIndex * 2) % scale.length];
      const octave = beat % 8 >= 6 ? 2 : 1;
      const movementIntensity = mix(
        movement.intensity[0],
        movement.intensity[1],
        localProgress,
      );

      events.push({
        kind: "beat",
        atMs,
        movementIndex,
        beat,
        frequency:
          movement.rootFrequency *
          octave *
          2 ** (semitone / 12),
        intensity: clamp(
          movementIntensity + (accent ? 0.12 : 0),
          0.05,
          1,
        ),
        texture: clamp(
          movementIndex / (performanceMovements.length - 1) * 0.62 +
            ((beat * 0.137) % 0.38),
          0,
          1,
        ),
        duration: accent ? 0.44 : 0.16 + movementIntensity * 0.16,
        pan: Math.sin((beat + movementIndex * 5) * 1.618) * 0.72,
        accent,
      });

      if (beat % movement.seedEveryBeats === 0) {
        const phraseIndex =
          Math.floor(beat / movement.seedEveryBeats) %
          movement.phrases.length;
        events.push({
          kind: "seed",
          atMs: atMs + Math.min(180, beatDuration * 0.18),
          movementIndex,
          text: movement.phrases[phraseIndex],
        });
      }
    }
  });

  return events.sort((first, second) => first.atMs - second.atMs);
}

function easeInOutSine(value: number): number {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
