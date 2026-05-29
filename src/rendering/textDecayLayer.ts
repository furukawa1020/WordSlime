import type { AppSettings } from "../app/settings";

type DecayParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  age: number;
  alpha: number;
};

type TextLayout = {
  source: HTMLCanvasElement;
  particles: DecayParticle[];
  color: [number, number, number];
};

const maxParticles = 900;
const maxReducedMotionParticles = 180;
const animationMs = 1450;

export class TextDecayLayer {
  private readonly context: CanvasRenderingContext2D;
  private frameHandle = 0;
  private startedAt = 0;
  private layout: TextLayout | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });

    if (!context) {
      throw new Error("Text decay canvas unavailable");
    }

    this.context = context;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.clear();
  }

  play(text: string, settings: AppSettings): void {
    this.stop();
    this.layout = createTextLayout(this.canvas, text, settings);
    this.startedAt = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy(): void {
    this.stop();
    this.clear();
  }

  private stop(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.layout) {
      return;
    }

    const elapsed = now - this.startedAt;
    const progress = Math.min(1, elapsed / animationMs);
    const dt = 1 / 60;
    this.clear();
    drawBreakingText(this.context, this.layout.source, progress);
    drawParticles(this.context, this.layout, progress, dt);

    if (progress < 1) {
      this.frameHandle = requestAnimationFrame(this.frame);
    } else {
      this.layout = undefined;
      this.clear();
    }
  };
}

function createTextLayout(
  canvas: HTMLCanvasElement,
  text: string,
  settings: AppSettings,
): TextLayout {
  const source = document.createElement("canvas");
  source.width = canvas.width;
  source.height = canvas.height;
  const sourceContext = source.getContext("2d", { alpha: true });

  if (!sourceContext) {
    throw new Error("Text decay canvas unavailable");
  }

  const random = createSeededRandom(text);
  const color = colorForText(random);
  const lines = normalizeLines(text);
  const fontSize = fitFontSize(sourceContext, lines, canvas.width, canvas.height);
  const lineHeight = fontSize * 1.18;
  const totalHeight = lineHeight * lines.length;
  const startY = canvas.height * 0.47 - totalHeight * 0.5 + fontSize * 0.86;

  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "alphabetic";
  sourceContext.font = `650 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  sourceContext.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.92)`;
  sourceContext.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.38)`;
  sourceContext.shadowBlur = fontSize * 0.32;

  for (let index = 0; index < lines.length; index += 1) {
    sourceContext.fillText(lines[index], canvas.width * 0.5, startY + index * lineHeight);
  }

  return {
    source,
    color,
    particles: sampleTextParticles(sourceContext, canvas, random, settings),
  };
}

function normalizeLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines.slice(0, 5) : [text.trim()];
}

function fitFontSize(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  width: number,
  height: number,
): number {
  const longest = lines.reduce((current, line) => (
    line.length > current.length ? line : current
  ), "");
  let size = Math.min(88, Math.max(28, width / 12));
  const maxWidth = width * 0.78;
  const maxHeight = height * 0.34;

  while (size > 18) {
    context.font = `650 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    const measured = context.measureText(longest).width;
    const measuredHeight = size * 1.18 * lines.length;

    if (measured <= maxWidth && measuredHeight <= maxHeight) {
      return size;
    }

    size -= 2;
  }

  return size;
}

function sampleTextParticles(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  random: () => number,
  settings: AppSettings,
): DecayParticle[] {
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(5, Math.floor(Math.min(canvas.width, canvas.height) / 110));
  const candidates: DecayParticle[] = [];
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.47;
  const motionScale = settings.reduceMotion ? 0.22 : 1;

  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const alpha = image.data[(y * canvas.width + x) * 4 + 3];

      if (alpha < 24 || random() < 0.45) {
        continue;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx) + (random() - 0.5) * 0.9;
      const speed = (24 + random() * 132) * motionScale;

      candidates.push({
        x: x + (random() - 0.5) * step,
        y: y + (random() - 0.5) * step,
        vx: Math.cos(angle) * speed + (dx / dist) * 26 * motionScale,
        vy: Math.sin(angle) * speed - (18 + random() * 34) * motionScale,
        radius: 0.9 + random() * 2.8,
        life: 0.7 + random() * 0.55,
        age: random() * -0.22,
        alpha: alpha / 255,
      });
    }
  }

  const limit = settings.reduceMotion ? maxReducedMotionParticles : maxParticles;
  return candidates.sort(() => random() - 0.5).slice(0, limit);
}

function drawBreakingText(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  progress: number,
): void {
  const textProgress = Math.min(1, progress / 0.62);

  if (textProgress >= 1) {
    return;
  }

  const jitter = Math.sin(progress * 58) * (1 + textProgress * 4);

  context.save();
  context.globalAlpha = 1 - textProgress;
  context.filter = `blur(${textProgress * 7}px)`;
  context.drawImage(source, jitter, -jitter * 0.45);
  context.restore();
}

function drawParticles(
  context: CanvasRenderingContext2D,
  layout: TextLayout,
  progress: number,
  dt: number,
): void {
  const [red, green, blue] = layout.color;

  context.save();
  context.globalCompositeOperation = "lighter";

  for (const particle of layout.particles) {
    particle.age += dt;

    if (particle.age < 0) {
      continue;
    }

    particle.vy += 26 * dt;
    particle.vx += Math.sin((particle.x + progress * 900) * 0.012) * 10 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;

    const lifeProgress = Math.min(1, particle.age / particle.life);
    const alpha = particle.alpha * Math.sin(Math.PI * lifeProgress) * (1 - progress * 0.16);

    if (alpha <= 0.001) {
      continue;
    }

    context.beginPath();
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function colorForText(random: () => number): [number, number, number] {
  const green = Math.floor(205 + random() * 42);
  const blue = Math.floor(215 + random() * 38);
  const red = Math.floor(120 + random() * 80);

  return [red, green, blue];
}

function createSeededRandom(text: string): () => number {
  let state = hashString(text) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function hashString(text: string): number {
  let hash = 2166136261;

  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
