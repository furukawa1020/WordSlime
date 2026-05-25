import type { AppSettings, SimulationMode } from "../../app/settings";
import type { WordSeed } from "../../app/state";
import { configureCanvas, createWebGpuDevice, type WebGpuDevice } from "./device";
import particleRenderShader from "./shaders/particleRender.wgsl?raw";
import particleUpdateShader from "./shaders/particleUpdate.wgsl?raw";

type PointerState = {
  x: number;
  y: number;
  active: boolean;
  down: boolean;
};

export type ParticleRenderer = {
  addSeed(seed: WordSeed): void;
  clear(): void;
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
  fungus: 0,
  glitch: 1,
};

export async function createParticleRenderer(
  canvas: HTMLCanvasElement,
  settings: AppSettings,
): Promise<ParticleRenderer> {
  const gpu = await createWebGpuDevice(canvas);
  return new WebGpuParticleRenderer(canvas, settings, gpu);
}

class WebGpuParticleRenderer implements ParticleRenderer {
  private readonly maxParticles = 10000;
  private readonly particles = new Float32Array(
    this.maxParticles * PARTICLE_STRIDE_FLOATS,
  );
  private readonly particleBuffer: GPUBuffer;
  private readonly paramsBuffer: GPUBuffer;
  private readonly computePipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly computeBindGroup: GPUBindGroup;
  private readonly renderBindGroup: GPUBindGroup;
  private readonly params = new Float32Array(PARAM_FLOATS);
  private pointer: PointerState = { x: 0, y: 0, active: false, down: false };
  private deviceLostCallback: ((info: GPUDeviceLostInfo) => void) | undefined;
  private activeCount = 0;
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

    for (let offset = 0; offset < count; offset += 1) {
      const particleIndex = (this.nextIndex + offset) % this.maxParticles;
      const base = particleIndex * PARTICLE_STRIDE_FLOATS;
      const angle = random() * Math.PI * 2;
      const spread = 8 + random() * (26 + seed.genome.separation * 40);
      const speed = 14 + seed.genome.energy * 92 + random() * 30;
      const radius = 1.8 + seed.genome.viscosity * 3.8 + random() * 2.4;

      this.particles[base + 0] = seed.origin.x + Math.cos(angle) * spread;
      this.particles[base + 1] = seed.origin.y + Math.sin(angle) * spread;
      this.particles[base + 2] = Math.cos(angle) * speed;
      this.particles[base + 3] = Math.sin(angle) * speed;
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

  setPointer(pointer: PointerState): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(rect.width, 1);
    const scaleY = this.canvas.height / Math.max(rect.height, 1);

    this.pointer = {
      x: pointer.x * scaleX,
      y: pointer.y * scaleY,
      active: pointer.active,
      down: pointer.down,
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

    if (this.activeCount > 0) {
      const computePass = encoder.beginComputePass({
        label: "particle update pass",
      });
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(this.activeCount / WORKGROUP_SIZE),
      );
      computePass.end();
    }

    const view = this.gpu.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      label: "particle render pass",
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.018, g: 0.052, b: 0.059, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    if (this.activeCount > 0) {
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroup);
      renderPass.draw(this.activeCount * 6);
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
    this.params[10] = this.activeCount;
    this.params[11] = 0;
    this.params[12] = 0;
    this.params[13] = 0;
    this.params[14] = 0;
    this.params[15] = 0;

    this.gpu.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);
  }
}

function contiguousWriteBytes(
  startIndex: number,
  count: number,
  capacity: number,
): number {
  return Math.min(count, capacity - startIndex) * PARTICLE_STRIDE_BYTES;
}

function colorForSeed(seed: WordSeed): [number, number, number, number] {
  const brightness = 0.45 + seed.genome.brightness * 0.45;
  const green = 0.72 + seed.features.hiraganaRatio * 0.18;
  const blue = 0.78 + seed.features.latinRatio * 0.18;
  const red =
    0.34 +
    seed.features.kanjiRatio * 0.18 +
    seed.features.emojiRatio * 0.22;

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
