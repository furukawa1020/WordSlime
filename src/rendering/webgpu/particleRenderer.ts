import type { AppSettings, SimulationMode } from "../../app/settings";
import type { WordSeed } from "../../app/state";
import { configureCanvas, createWebGpuDevice, type WebGpuDevice } from "./device";
import backgroundRenderShader from "./shaders/backgroundRender.wgsl?raw";
import particleHaloRenderShader from "./shaders/particleHaloRender.wgsl?raw";
import particleRenderShader from "./shaders/particleRender.wgsl?raw";
import particleUpdateShader from "./shaders/particleUpdate.wgsl?raw";

type PointerState = {
  x: number;
  y: number;
  active: boolean;
  down: boolean;
  pulse: number;
  vortex: number;
  dragX: number;
  dragY: number;
};

export type ParticleRenderer = {
  addSeed(seed: WordSeed): void;
  clear(): void;
  setParticleBudget(maxParticles: number): void;
  setPointer(pointer: PointerState): void;
  resize(): void;
  onDeviceLost(callback: (info: GPUDeviceLostInfo) => void): void;
  start(): void;
  stop(): void;
};

const PARTICLE_STRIDE_FLOATS = 12;
const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const PARAM_FLOATS = 16;
const WORKGROUP_SIZE = 64;

const modeValues: Record<SimulationMode, number> = {
  slime: 0,
  swarm: 1,
  smoke: 2,
  fungus: 3,
  glitch: 4,
};

const backgroundValues: Record<AppSettings["background"], number> = {
  dark: 0,
  milk: 1,
  "deep-sea": 2,
  paper: 3,
};

export async function createParticleRenderer(
  canvas: HTMLCanvasElement,
  settings: AppSettings,
): Promise<ParticleRenderer> {
  const gpu = await createWebGpuDevice(canvas);
  return new WebGpuParticleRenderer(canvas, settings, gpu);
}

class WebGpuParticleRenderer implements ParticleRenderer {
  private readonly maxParticles = 120000;
  private readonly particles = new Float32Array(
    this.maxParticles * PARTICLE_STRIDE_FLOATS,
  );
  private readonly particleBuffer: GPUBuffer;
  private readonly paramsBuffer: GPUBuffer;
  private readonly computePipeline: GPUComputePipeline;
  private readonly backgroundPipeline: GPURenderPipeline;
  private readonly haloPipeline: GPURenderPipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly computeBindGroup: GPUBindGroup;
  private readonly backgroundBindGroup: GPUBindGroup;
  private readonly haloBindGroup: GPUBindGroup;
  private readonly renderBindGroup: GPUBindGroup;
  private readonly params = new Float32Array(PARAM_FLOATS);
  private pointer: PointerState = {
    x: 0,
    y: 0,
    active: false,
    down: false,
    pulse: 0,
    vortex: 0,
    dragX: 0,
    dragY: 0,
  };
  private deviceLostCallback: ((info: GPUDeviceLostInfo) => void) | undefined;
  private activeCount = 0;
  private activeBudget = this.maxParticles;
  private nextIndex = 0;
  private running = false;
  private frameHandle = 0;
  private lastTime = performance.now();
  private readonly startedAt = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: AppSettings,
    private readonly gpu: WebGpuDevice,
  ) {
    const updateModule = gpu.device.createShaderModule({
      label: "particle update shader",
      code: particleUpdateShader,
    });
    const backgroundModule = gpu.device.createShaderModule({
      label: "background flow shader",
      code: backgroundRenderShader,
    });
    const haloModule = gpu.device.createShaderModule({
      label: "particle halo shader",
      code: particleHaloRenderShader,
    });
    const renderModule = gpu.device.createShaderModule({
      label: "particle render shader",
      code: particleRenderShader,
    });

    this.particleBuffer = gpu.device.createBuffer({
      label: "particle buffer",
      size: this.particles.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuffer = gpu.device.createBuffer({
      label: "simulation params",
      size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.computePipeline = gpu.device.createComputePipeline({
      label: "particle update pipeline",
      layout: "auto",
      compute: {
        module: updateModule,
        entryPoint: "main",
      },
    });
    this.backgroundPipeline = gpu.device.createRenderPipeline({
      label: "background flow pipeline",
      layout: "auto",
      vertex: {
        module: backgroundModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: backgroundModule,
        entryPoint: "fs_main",
        targets: [{ format: gpu.format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
    this.haloPipeline = gpu.device.createRenderPipeline({
      label: "particle halo pipeline",
      layout: "auto",
      vertex: {
        module: haloModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: haloModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
    this.renderPipeline = gpu.device.createRenderPipeline({
      label: "particle render pipeline",
      layout: "auto",
      vertex: {
        module: renderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: renderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    this.computeBindGroup = gpu.device.createBindGroup({
      label: "particle update bind group",
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.backgroundBindGroup = gpu.device.createBindGroup({
      label: "background flow bind group",
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.haloBindGroup = gpu.device.createBindGroup({
      label: "particle halo bind group",
      layout: this.haloPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.renderBindGroup = gpu.device.createBindGroup({
      label: "particle render bind group",
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
      ],
    });

    void gpu.lost.then((info) => {
      this.stop();
      this.deviceLostCallback?.(info);
    });
  }

  addSeed(seed: WordSeed): void {
    const count = Math.min(seed.particleCount, this.maxParticles);
    const color = colorForSeed(seed);
    const random = createSeededRandom(seed.text);
    const profile = createSpawnProfile(seed);

    for (let offset = 0; offset < count; offset += 1) {
      const particleIndex = (this.nextIndex + offset) % this.maxParticles;
      const base = particleIndex * PARTICLE_STRIDE_FLOATS;
      const unit = count <= 1 ? 0 : offset / (count - 1);
      const spawn = createParticleSpawn(seed, profile, unit, random);
      const radius = 1.8 + seed.genome.viscosity * 3.8 + random() * 2.4;

      this.particles[base + 0] = spawn.x;
      this.particles[base + 1] = spawn.y;
      this.particles[base + 2] = spawn.vx;
      this.particles[base + 3] = spawn.vy;
      this.particles[base + 4] = color[0];
      this.particles[base + 5] = color[1];
      this.particles[base + 6] = color[2];
      this.particles[base + 7] = color[3];
      this.particles[base + 8] = 0;
      this.particles[base + 9] = 10 + seed.genome.decay * 26 + random() * 18;
      this.particles[base + 10] = radius;
      this.particles[base + 11] = seed.genome.energy;
    }

    this.gpu.device.queue.writeBuffer(
      this.particleBuffer,
      this.nextIndex * PARTICLE_STRIDE_BYTES,
      this.particles.buffer,
      this.nextIndex * PARTICLE_STRIDE_BYTES,
      contiguousWriteBytes(this.nextIndex, count, this.maxParticles),
    );

    const wrappedCount = count - (this.maxParticles - this.nextIndex);

    if (wrappedCount > 0) {
      this.gpu.device.queue.writeBuffer(
        this.particleBuffer,
        0,
        this.particles.buffer,
        0,
        wrappedCount * PARTICLE_STRIDE_BYTES,
      );
    }

    this.nextIndex = (this.nextIndex + count) % this.maxParticles;
    this.activeCount = Math.min(this.maxParticles, this.activeCount + count);
  }

  clear(): void {
    this.activeCount = 0;
    this.nextIndex = 0;
    this.particles.fill(0);
  }

  setParticleBudget(maxParticles: number): void {
    this.activeBudget = Math.max(256, Math.min(this.maxParticles, Math.floor(maxParticles)));
  }

  setPointer(pointer: PointerState): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(rect.width, 1);
    const scaleY = this.canvas.height / Math.max(rect.height, 1);

    this.pointer = {
      x: pointer.x * scaleX,
      y: pointer.y * scaleY,
      active: pointer.active,
      down: pointer.down,
      pulse: Math.max(this.pointer.pulse, pointer.pulse),
      vortex: Math.max(this.pointer.vortex, pointer.vortex),
      dragX: pointer.dragX * scaleX,
      dragY: pointer.dragY * scaleY,
    };
  }

  resize(): void {
    configureCanvas(this.gpu.context, this.gpu.device, this.gpu.format);
  }

  onDeviceLost(callback: (info: GPUDeviceLostInfo) => void): void {
    this.deviceLostCallback = callback;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private readonly frame = (now: number) => {
    if (!this.running) {
      return;
    }

    const dt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.render(dt, (now - this.startedAt) / 1000);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private render(dt: number, time: number): void {
    this.writeParams(dt, time);

    const encoder = this.gpu.device.createCommandEncoder({
      label: "particle frame encoder",
    });

    const renderCount = this.renderCount();

    if (renderCount > 0) {
      const computePass = encoder.beginComputePass({
        label: "particle update pass",
      });
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(renderCount / WORKGROUP_SIZE),
      );
      computePass.end();
    }

    const view = this.gpu.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      label: "particle render pass",
      colorAttachments: [
        {
          view,
          clearValue: clearColorForBackground(this.settings.background),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPass.setPipeline(this.backgroundPipeline);
    renderPass.setBindGroup(0, this.backgroundBindGroup);
    renderPass.draw(3);

    if (renderCount > 0) {
      renderPass.setPipeline(this.haloPipeline);
      renderPass.setBindGroup(0, this.haloBindGroup);
      renderPass.draw(renderCount * 6);

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroup);
      renderPass.draw(renderCount * 6);
    }

    renderPass.end();
    this.gpu.device.queue.submit([encoder.finish()]);
  }

  private writeParams(dt: number, time: number): void {
    this.params[0] = dt;
    this.params[1] = time;
    this.params[2] = this.canvas.width;
    this.params[3] = this.canvas.height;
    this.params[4] = this.pointer.x;
    this.params[5] = this.pointer.y;
    this.params[6] = this.pointer.active ? 1 : 0;
    this.params[7] = this.pointer.down ? 1 : 0;
    this.params[8] = modeValues[this.settings.mode];
    this.params[9] = this.settings.reduceMotion ? 1 : 0;
    this.params[10] = this.renderCount();
    this.params[11] = backgroundValues[this.settings.background];
    this.params[12] = this.pointer.pulse;
    this.params[13] = this.pointer.vortex;
    this.params[14] = this.pointer.dragX;
    this.params[15] = this.pointer.dragY;

    this.gpu.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);

    this.pointer.pulse = Math.max(0, this.pointer.pulse - dt * 3.2);
    this.pointer.vortex = Math.max(0, this.pointer.vortex - dt * 1.45);
    this.pointer.dragX *= 0.86;
    this.pointer.dragY *= 0.86;
  }

  private renderCount(): number {
    return Math.min(this.activeCount, this.activeBudget);
  }
}

type SpawnProfile =
  | "burst"
  | "scatter"
  | "sink"
  | "soft"
  | "sharp"
  | "heavy"
  | "slide"
  | "orbit"
  | "mutate"
  | "split";

type ParticleSpawn = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

function createSpawnProfile(seed: WordSeed): SpawnProfile {
  const features = seed.features;

  if (features.exclamationCount >= 2) return "burst";
  if (features.questionCount >= 2) return "scatter";
  if (features.ellipsisCount > 0) return "sink";
  if (features.emojiRatio > 0.12) return "mutate";
  if (features.repeatRatio > 0.45) return "split";
  if (features.digitRatio > 0.35) return "orbit";
  if (features.latinRatio > 0.45) return "slide";
  if (features.kanjiRatio > 0.45) return "heavy";
  if (features.katakanaRatio > 0.35) return "sharp";
  if (features.hiraganaRatio > 0.45) return "soft";

  return "soft";
}

function createParticleSpawn(
  seed: WordSeed,
  profile: SpawnProfile,
  unit: number,
  random: () => number,
): ParticleSpawn {
  const center = seed.origin;
  const jitter = () => random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const energySpeed = 24 + seed.genome.energy * 126;

  if (profile === "burst") {
    const spread = 4 + random() * 16;
    const speed = energySpeed * (0.95 + random() * 0.75);
    return {
      x: center.x + Math.cos(angle) * spread,
      y: center.y + Math.sin(angle) * spread,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  }

  if (profile === "scatter") {
    const spread = 26 + random() * 110;
    const speed = 28 + seed.genome.separation * 120 + random() * 36;
    return {
      x: center.x + Math.cos(angle) * spread,
      y: center.y + Math.sin(angle) * spread,
      vx: Math.cos(angle) * speed + jitter() * 30,
      vy: Math.sin(angle) * speed + jitter() * 30,
    };
  }

  if (profile === "sink") {
    const spread = 12 + random() * 42;
    return {
      x: center.x + jitter() * spread * 2.2,
      y: center.y - random() * spread,
      vx: jitter() * 12,
      vy: 18 + seed.genome.viscosity * 72 + random() * 28,
    };
  }

  if (profile === "slide") {
    const lane = jitter() * (18 + seed.features.length * 0.7);
    return {
      x: center.x + jitter() * 64,
      y: center.y + lane,
      vx: (random() > 0.5 ? 1 : -1) * (56 + seed.genome.noiseScale * 110),
      vy: jitter() * 16,
    };
  }

  if (profile === "orbit") {
    const orbitAngle = unit * Math.PI * 2 * (2 + Math.round(seed.features.digitRatio * 4));
    const radius = 18 + seed.features.length * 2.2 + random() * 18;
    const tangent = orbitAngle + Math.PI * 0.5;
    return {
      x: center.x + Math.cos(orbitAngle) * radius,
      y: center.y + Math.sin(orbitAngle) * radius,
      vx: Math.cos(tangent) * (42 + seed.genome.energy * 64),
      vy: Math.sin(tangent) * (42 + seed.genome.energy * 64),
    };
  }

  if (profile === "split") {
    const clusterCount = 2 + Math.min(4, Math.floor(seed.features.repeatRatio * 5));
    const cluster = Math.floor(unit * clusterCount);
    const clusterAngle = (cluster / clusterCount) * Math.PI * 2;
    const clusterCenter = {
      x: center.x + Math.cos(clusterAngle) * (24 + seed.genome.fertility * 40),
      y: center.y + Math.sin(clusterAngle) * (24 + seed.genome.fertility * 40),
    };
    const localAngle = random() * Math.PI * 2;
    const spread = 8 + random() * 22;
    return {
      x: clusterCenter.x + Math.cos(localAngle) * spread,
      y: clusterCenter.y + Math.sin(localAngle) * spread,
      vx: Math.cos(localAngle) * (32 + seed.genome.fertility * 92),
      vy: Math.sin(localAngle) * (32 + seed.genome.fertility * 92),
    };
  }

  if (profile === "heavy") {
    const spread = 6 + random() * 24;
    return {
      x: center.x + Math.cos(angle) * spread,
      y: center.y + Math.sin(angle) * spread * 0.62,
      vx: Math.cos(angle) * (8 + random() * 18),
      vy: 24 + seed.genome.decay * 70 + random() * 18,
    };
  }

  if (profile === "sharp") {
    const sides = 5;
    const corner = Math.floor(unit * sides);
    const cornerAngle = (corner / sides) * Math.PI * 2 - Math.PI * 0.5;
    const radius = 22 + seed.genome.turbulence * 56;
    return {
      x: center.x + Math.cos(cornerAngle) * radius + jitter() * 16,
      y: center.y + Math.sin(cornerAngle) * radius + jitter() * 16,
      vx: Math.cos(cornerAngle) * (40 + seed.genome.energy * 70),
      vy: Math.sin(cornerAngle) * (40 + seed.genome.energy * 70),
    };
  }

  if (profile === "mutate") {
    const spiral = unit * Math.PI * 9 + random() * 0.6;
    const radius = 8 + unit * (70 + seed.genome.turbulence * 70);
    return {
      x: center.x + Math.cos(spiral) * radius + jitter() * 22,
      y: center.y + Math.sin(spiral) * radius + jitter() * 22,
      vx: Math.cos(spiral + 1.4) * (46 + random() * 92),
      vy: Math.sin(spiral + 1.4) * (46 + random() * 92),
    };
  }

  const spread = 10 + random() * (28 + seed.genome.cohesion * 36);

  return {
    x: center.x + Math.cos(angle) * spread,
    y: center.y + Math.sin(angle) * spread,
    vx: Math.cos(angle) * (18 + seed.genome.energy * 46),
    vy: Math.sin(angle) * (18 + seed.genome.energy * 46),
  };
}

function contiguousWriteBytes(
  startIndex: number,
  count: number,
  capacity: number,
): number {
  return Math.min(count, capacity - startIndex) * PARTICLE_STRIDE_BYTES;
}

function colorForSeed(seed: WordSeed): [number, number, number, number] {
  const brightness = 0.48 + seed.genome.brightness * 0.46;
  const red =
    0.3 +
    seed.features.kanjiRatio * 0.18 +
    seed.features.katakanaRatio * 0.2 +
    seed.features.emojiRatio * 0.34 +
    seed.features.exclamationCount * 0.018;
  const green =
    0.68 +
    seed.features.hiraganaRatio * 0.2 -
    seed.features.digitRatio * 0.1 +
    seed.features.emojiRatio * 0.08;
  const blue =
    0.76 +
    seed.features.latinRatio * 0.16 +
    seed.features.digitRatio * 0.2 -
    seed.features.kanjiRatio * 0.08;

  return [
    Math.min(1, red * brightness),
    Math.min(1, green * brightness),
    Math.min(1, blue * brightness),
    0.52 + seed.genome.brightness * 0.36,
  ];
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

function clearColorForBackground(
  background: AppSettings["background"],
): GPUColor {
  if (background === "milk") {
    return { r: 0.84, g: 0.86, b: 0.82, a: 1 };
  }

  if (background === "paper") {
    return { r: 0.72, g: 0.74, b: 0.69, a: 1 };
  }

  if (background === "dark") {
    return { r: 0.006, g: 0.008, b: 0.01, a: 1 };
  }

  return { r: 0.018, g: 0.052, b: 0.059, a: 1 };
}
