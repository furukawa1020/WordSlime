import type { WordSeed } from "../app/state";

export class SedimentLayer {
  private readonly context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });

    if (!context) {
      throw new Error("Sediment canvas unavailable");
    }

    this.context = context;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width * dpr));
    this.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  clear(): void {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  addSeed(seed: WordSeed): void {
    const random = createSeededRandom(`${seed.id}:${seed.text}`);
    const layerY = this.height * (0.68 + random() * 0.23);
    const spreadX = 80 + seed.features.length * 1.8;
    const color = sedimentColor(seed);
    const count = Math.min(90, 14 + Math.floor(seed.particleCount / 18));

    this.context.save();
    this.context.globalCompositeOperation = "screen";

    for (let index = 0; index < count; index += 1) {
      const x = seed.origin.x + (random() * 2 - 1) * spreadX;
      const y = layerY + (random() * 2 - 1) * (18 + seed.genome.decay * 42);
      const radius = 1 + random() * (2.5 + seed.genome.viscosity * 5);
      const alpha = 0.018 + seed.genome.brightness * 0.026;

      this.context.beginPath();
      this.context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      this.context.arc(x, y, radius, 0, Math.PI * 2);
      this.context.fill();
    }

    this.drawTextBones(seed, random, color);
    this.context.restore();
  }

  private drawTextBones(
    seed: WordSeed,
    random: () => number,
    color: { r: number; g: number; b: number },
  ): void {
    const chars = Array.from(seed.text).slice(0, 18);
    const baseline = this.height * (0.74 + random() * 0.16);

    this.context.font = `${10 + seed.genome.viscosity * 8}px serif`;
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";

    chars.forEach((char, index) => {
      if (char.trim().length === 0) {
        return;
      }

      const x =
        seed.origin.x +
        (index - chars.length / 2) * (7 + seed.genome.separation * 8) +
        (random() * 2 - 1) * 12;
      const y = baseline + (random() * 2 - 1) * 18;
      const alpha = 0.024 + seed.genome.decay * 0.03;

      this.context.save();
      this.context.translate(x, y);
      this.context.rotate((random() * 2 - 1) * 0.5);
      this.context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      this.context.fillText(char, 0, 0);
      this.context.restore();
    });
  }
}

function sedimentColor(seed: WordSeed): { r: number; g: number; b: number } {
  return {
    r: Math.round(90 + seed.features.kanjiRatio * 80 + seed.features.emojiRatio * 70),
    g: Math.round(140 + seed.features.hiraganaRatio * 70),
    b: Math.round(150 + seed.features.latinRatio * 75 + seed.features.digitRatio * 55),
  };
}

function createSeededRandom(seedText: string): () => number {
  let state = hashText(seedText);

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text: string): number {
  let hash = 2166136261;

  for (const char of Array.from(text)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
