import type { AppSettings, SimulationMode } from "../../app/settings";
import type { WordSeed } from "../../app/state";
import { configureCanvas, createWebGpuDevice, type WebGpuDevice } from "./device";
import backgroundRenderShader from "./shaders/backgroundRender.wgsl?raw";
import hyperProjectionRenderShader from "./shaders/hyperProjectionRender.wgsl?raw";
import modeSignatureRenderShader from "./shaders/modeSignatureRender.wgsl?raw";
import performanceScoreRenderShader from "./shaders/performanceScoreRender.wgsl?raw";
import performanceVolumeRenderShader from "./shaders/performanceVolumeRender.wgsl?raw";
import performanceWorldRenderShader from "./shaders/performanceWorldRender.wgsl?raw";
import particleHaloRenderShader from "./shaders/particleHaloRender.wgsl?raw";
import particleReactionShader from "./shaders/particleReaction.wgsl?raw";
import particleRenderShader from "./shaders/particleRender.wgsl?raw";
import particleUpdateShader from "./shaders/particleUpdate.wgsl?raw";
import trailCompositeShader from "./shaders/trailComposite.wgsl?raw";
import trailFeedbackShader from "./shaders/trailFeedback.wgsl?raw";

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

export type ParticleRendererDraftSignature = {
  energy: number;
  viscosity: number;
  turbulence: number;
  fertility: number;
  lengthPressure: number;
  repeatPressure: number;
  symbolPressure: number;
  glyphComplexity: number;
  strength: number;
  hash: number;
};

export type ParticleRendererPerformanceState = {
  active: boolean;
  progress: number;
  intensity: number;
  phase: number;
};

export type ParticleRenderer = {
  addSeed(seed: WordSeed): void;
  clear(): void;
  getStats(): ParticleRendererStats;
  setDraftSignature(draft: ParticleRendererDraftSignature | undefined): void;
  setParticleBudget(maxParticles: number): void;
  setPerformanceState(
    performanceState: ParticleRendererPerformanceState | undefined,
  ): void;
  setPointer(pointer: PointerState): void;
  resize(): void;
  renderOnce(): void;
  onDeviceLost(callback: (info: GPUDeviceLostInfo) => void): void;
  start(): void;
  stop(): void;
};

export type ParticleRendererStats = {
  activeBudget: number;
  activeCount: number;
  capacity: number;
  canvasHeight: number;
  canvasWidth: number;
  computeSubsteps: number;
  computeWorkgroups: number;
  draftHash: number;
  draftStrength: number;
  particleBufferBytes: number;
  passCount: number;
  pipelineCount: number;
  performanceActive: number;
  performanceIntensity: number;
  performanceProgress: number;
  renderCount: number;
  reservoirComplexity: number;
  reservoirEnergy: number;
  reservoirTurbulence: number;
  reservoirViscosity: number;
  seedSignalAge: number;
  seedSignalHash: number;
  trailTextureBytes: number;
  uniformBufferBytes: number;
};

const PARTICLE_STRIDE_FLOATS = 12;
const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const PARAM_FLOATS = 36;
const WORKGROUP_SIZE = 64;
const PERFORMANCE_PARTICLES_DESKTOP = 120000;
const PERFORMANCE_PARTICLES_COMPACT = 96000;
const PERFORMANCE_PARTICLES_MOBILE = 48000;
const TAU = Math.PI * 2;

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
  private readonly trailSampler: GPUSampler;
  private readonly computePipeline: GPUComputePipeline;
  private readonly reactionPipeline: GPUComputePipeline;
  private readonly backgroundPipeline: GPURenderPipeline;
  private readonly hyperProjectionPipeline: GPURenderPipeline;
  private readonly modeSignaturePipeline: GPURenderPipeline;
  private readonly performanceScorePipeline: GPURenderPipeline;
  private readonly performanceVolumePipeline: GPURenderPipeline;
  private readonly performanceWorldPipeline: GPURenderPipeline;
  private readonly trailFeedbackPipeline: GPURenderPipeline;
  private readonly trailCompositePipeline: GPURenderPipeline;
  private readonly haloPipeline: GPURenderPipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly computeBindGroup: GPUBindGroup;
  private readonly reactionBindGroup: GPUBindGroup;
  private readonly backgroundBindGroup: GPUBindGroup;
  private readonly hyperProjectionBindGroup: GPUBindGroup;
  private readonly modeSignatureBindGroup: GPUBindGroup;
  private readonly performanceScoreBindGroup: GPUBindGroup;
  private readonly performanceVolumeBindGroup: GPUBindGroup;
  private readonly performanceWorldBindGroup: GPUBindGroup;
  private readonly haloBindGroup: GPUBindGroup;
  private readonly renderBindGroup: GPUBindGroup;
  private trailTextures: GPUTexture[] = [];
  private trailViews: GPUTextureView[] = [];
  private trailFeedbackBindGroups: GPUBindGroup[] = [];
  private trailCompositeBindGroups: GPUBindGroup[] = [];
  private trailWidth = 1;
  private trailHeight = 1;
  private trailScale = 0.9;
  private readonly params = new Float32Array(PARAM_FLOATS);
  private readonly signature = new Float32Array(8);
  private readonly draftSignature = new Float32Array(8);
  private readonly reservoir = new Float32Array(4);
  private readonly performanceState = new Float32Array(4);
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
  private lastSceneTime = 0;
  private readonly startedAt = performance.now();
  private trailReadIndex = 0;
  private trailNeedsClear = true;
  private signatureAge = 999;
  private signatureHash = 0;
  private draftStrength = 0;
  private draftHash = 0;
  private reservoirDepth = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: AppSettings,
    private readonly gpu: WebGpuDevice,
  ) {
    const updateModule = gpu.device.createShaderModule({
      label: "particle update shader",
      code: particleUpdateShader,
    });
    const reactionModule = gpu.device.createShaderModule({
      label: "particle reaction shader",
      code: particleReactionShader,
    });
    const backgroundModule = gpu.device.createShaderModule({
      label: "background flow shader",
      code: backgroundRenderShader,
    });
    const hyperProjectionModule = gpu.device.createShaderModule({
      label: "3d 4d hyper projection shader",
      code: hyperProjectionRenderShader,
    });
    const modeSignatureModule = gpu.device.createShaderModule({
      label: "mode signature shader",
      code: modeSignatureRenderShader,
    });
    const performanceScoreModule = gpu.device.createShaderModule({
      label: "auto performance score shader",
      code: performanceScoreRenderShader,
    });
    const performanceVolumeModule = gpu.device.createShaderModule({
      label: "auto performance volume raymarch shader",
      code: performanceVolumeRenderShader,
    });
    const performanceWorldModule = gpu.device.createShaderModule({
      label: "auto performance world sdf shader",
      code: performanceWorldRenderShader,
    });
    const haloModule = gpu.device.createShaderModule({
      label: "particle halo shader",
      code: particleHaloRenderShader,
    });
    const renderModule = gpu.device.createShaderModule({
      label: "particle render shader",
      code: particleRenderShader,
    });
    const trailFeedbackModule = gpu.device.createShaderModule({
      label: "trail feedback shader",
      code: trailFeedbackShader,
    });
    const trailCompositeModule = gpu.device.createShaderModule({
      label: "trail composite shader",
      code: trailCompositeShader,
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
    this.trailSampler = gpu.device.createSampler({
      label: "trail sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    this.computePipeline = gpu.device.createComputePipeline({
      label: "particle update pipeline",
      layout: "auto",
      compute: {
        module: updateModule,
        entryPoint: "main",
      },
    });
    this.reactionPipeline = gpu.device.createComputePipeline({
      label: "particle reaction pipeline",
      layout: "auto",
      compute: {
        module: reactionModule,
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
    this.hyperProjectionPipeline = gpu.device.createRenderPipeline({
      label: "3d 4d hyper projection pipeline",
      layout: "auto",
      vertex: {
        module: hyperProjectionModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: hyperProjectionModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
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
    this.modeSignaturePipeline = gpu.device.createRenderPipeline({
      label: "mode signature pipeline",
      layout: "auto",
      vertex: {
        module: modeSignatureModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: modeSignatureModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
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
    this.performanceScorePipeline = gpu.device.createRenderPipeline({
      label: "auto performance score pipeline",
      layout: "auto",
      vertex: {
        module: performanceScoreModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: performanceScoreModule,
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
    this.performanceVolumePipeline = gpu.device.createRenderPipeline({
      label: "auto performance volume raymarch pipeline",
      layout: "auto",
      vertex: {
        module: performanceVolumeModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: performanceVolumeModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
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
    this.performanceWorldPipeline = gpu.device.createRenderPipeline({
      label: "auto performance world sdf pipeline",
      layout: "auto",
      vertex: {
        module: performanceWorldModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: performanceWorldModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: gpu.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
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
    this.trailFeedbackPipeline = gpu.device.createRenderPipeline({
      label: "trail feedback pipeline",
      layout: "auto",
      vertex: {
        module: trailFeedbackModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: trailFeedbackModule,
        entryPoint: "fs_main",
        targets: [{ format: gpu.format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
    this.trailCompositePipeline = gpu.device.createRenderPipeline({
      label: "trail composite pipeline",
      layout: "auto",
      vertex: {
        module: trailCompositeModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: trailCompositeModule,
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
    this.reactionBindGroup = gpu.device.createBindGroup({
      label: "particle reaction bind group",
      layout: this.reactionPipeline.getBindGroupLayout(0),
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
    this.hyperProjectionBindGroup = gpu.device.createBindGroup({
      label: "3d 4d hyper projection bind group",
      layout: this.hyperProjectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.modeSignatureBindGroup = gpu.device.createBindGroup({
      label: "mode signature bind group",
      layout: this.modeSignaturePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.performanceScoreBindGroup = gpu.device.createBindGroup({
      label: "auto performance score bind group",
      layout: this.performanceScorePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.performanceVolumeBindGroup = gpu.device.createBindGroup({
      label: "auto performance volume raymarch bind group",
      layout: this.performanceVolumePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
      ],
    });
    this.performanceWorldBindGroup = gpu.device.createBindGroup({
      label: "auto performance world sdf bind group",
      layout: this.performanceWorldPipeline.getBindGroupLayout(0),
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
    this.createTrailTargets();

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
      const spawn = createParticleSpawn(
        seed,
        this.settings.mode,
        profile,
        unit,
        random,
        { width: this.canvas.width, height: this.canvas.height },
      );
      const radius = radiusForMode(seed, this.settings.mode, random);
      const particleColor = varyParticleColor(
        color,
        seed,
        this.settings.mode,
        random,
      );

      this.particles[base + 0] = spawn.x;
      this.particles[base + 1] = spawn.y;
      this.particles[base + 2] = spawn.vx;
      this.particles[base + 3] = spawn.vy;
      this.particles[base + 4] = particleColor[0];
      this.particles[base + 5] = particleColor[1];
      this.particles[base + 6] = particleColor[2];
      this.particles[base + 7] = particleColor[3];
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
    this.captureSignature(seed);
  }

  clear(): void {
    this.activeCount = 0;
    this.nextIndex = 0;
    this.particles.fill(0);
    this.signature.fill(0);
    this.draftSignature.fill(0);
    this.reservoir.fill(0);
    this.signatureAge = 999;
    this.signatureHash = 0;
    this.draftStrength = 0;
    this.draftHash = 0;
    this.reservoirDepth = 0;
    this.trailNeedsClear = true;
  }

  getStats(): ParticleRendererStats {
    const renderCount = this.renderCount();
    const computeSubsteps = this.computeSubsteps();

    return {
      activeBudget: this.activeBudget,
      activeCount: this.activeCount,
      capacity: this.maxParticles,
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      computeSubsteps,
      computeWorkgroups:
        Math.ceil(renderCount / WORKGROUP_SIZE) * computeSubsteps * 2,
      draftHash: this.draftHash,
      draftStrength: this.draftStrength,
      particleBufferBytes: this.particles.byteLength,
      passCount: computeSubsteps * 2 + 2,
      pipelineCount: 12,
      performanceActive: this.performanceState[0],
      performanceIntensity: this.performanceState[2],
      performanceProgress: this.performanceState[1],
      renderCount,
      reservoirComplexity: this.reservoir[3],
      reservoirEnergy: this.reservoir[0],
      reservoirTurbulence: this.reservoir[2],
      reservoirViscosity: this.reservoir[1],
      seedSignalAge: this.signatureAge,
      seedSignalHash: this.signatureHash,
      trailTextureBytes:
        this.trailWidth * this.trailHeight * 4 * 2,
      uniformBufferBytes: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    };
  }

  setDraftSignature(draft: ParticleRendererDraftSignature | undefined): void {
    if (!draft || draft.strength <= 0) {
      this.draftSignature.fill(0);
      this.draftStrength = 0;
      this.draftHash = 0;
      return;
    }

    this.draftSignature[0] = clamp01(draft.energy);
    this.draftSignature[1] = clamp01(draft.viscosity);
    this.draftSignature[2] = clamp01(draft.turbulence);
    this.draftSignature[3] = clamp01(draft.fertility);
    this.draftSignature[4] = clamp01(draft.lengthPressure);
    this.draftSignature[5] = clamp01(draft.repeatPressure);
    this.draftSignature[6] = clamp01(draft.symbolPressure);
    this.draftSignature[7] = clamp01(draft.glyphComplexity);
    this.draftStrength = clamp01(draft.strength);
    this.draftHash = clamp01(draft.hash);
  }

  setParticleBudget(maxParticles: number): void {
    this.activeBudget = Math.max(256, Math.min(this.maxParticles, Math.floor(maxParticles)));
    const nextTrailScale = trailScaleForBudget(this.activeBudget);

    if (Math.abs(nextTrailScale - this.trailScale) > 0.001) {
      this.trailScale = nextTrailScale;
      this.createTrailTargets();
    }
  }

  setPerformanceState(
    performanceState: ParticleRendererPerformanceState | undefined,
  ): void {
    if (!performanceState?.active) {
      this.performanceState.fill(0);
      return;
    }

    this.performanceState[0] = 1;
    this.performanceState[1] = clamp01(performanceState.progress);
    this.performanceState[2] = clamp01(performanceState.intensity);
    this.performanceState[3] = Math.max(0, performanceState.phase);
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
    this.createTrailTargets();
  }

  renderOnce(): void {
    if (this.running) {
      return;
    }

    this.render(0, this.lastSceneTime);
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
    this.lastSceneTime = (now - this.startedAt) / 1000;
    this.render(dt, this.lastSceneTime);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private render(dt: number, time: number): void {
    const computeSubsteps = this.computeSubsteps();
    this.writeParams(dt / computeSubsteps, time);

    const encoder = this.gpu.device.createCommandEncoder({
      label: "particle frame encoder",
    });

    const renderCount = this.renderCount();

    if (renderCount > 0) {
      for (let substep = 0; substep < computeSubsteps; substep += 1) {
        const computePass = encoder.beginComputePass({
          label: `particle update pass ${substep + 1}/${computeSubsteps}`,
        });
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        computePass.dispatchWorkgroups(
          Math.ceil(renderCount / WORKGROUP_SIZE),
        );
        computePass.end();

        const reactionPass = encoder.beginComputePass({
          label: `particle reaction pass ${substep + 1}/${computeSubsteps}`,
        });
        reactionPass.setPipeline(this.reactionPipeline);
        reactionPass.setBindGroup(0, this.reactionBindGroup);
        reactionPass.dispatchWorkgroups(
          Math.ceil(renderCount / WORKGROUP_SIZE),
        );
        reactionPass.end();
      }
    }

    const readTrailIndex = this.trailReadIndex;
    const writeTrailIndex = 1 - readTrailIndex;
    const trailPass = encoder.beginRenderPass({
      label: "trail accumulation pass",
      colorAttachments: [
        {
          view: this.trailViews[writeTrailIndex],
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    if (!this.trailNeedsClear) {
      trailPass.setPipeline(this.trailFeedbackPipeline);
      trailPass.setBindGroup(0, this.trailFeedbackBindGroups[readTrailIndex]);
      trailPass.draw(3);
    }

    if (renderCount > 0) {
      trailPass.setPipeline(this.haloPipeline);
      trailPass.setBindGroup(0, this.haloBindGroup);
      trailPass.draw(renderCount * 6);

      trailPass.setPipeline(this.renderPipeline);
      trailPass.setBindGroup(0, this.renderBindGroup);
      trailPass.draw(renderCount * 6);
    }

    trailPass.end();

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

    renderPass.setPipeline(this.modeSignaturePipeline);
    renderPass.setBindGroup(0, this.modeSignatureBindGroup);
    renderPass.draw(3);

    renderPass.setPipeline(this.trailCompositePipeline);
    renderPass.setBindGroup(0, this.trailCompositeBindGroups[writeTrailIndex]);
    renderPass.draw(3);

    renderPass.setPipeline(this.performanceVolumePipeline);
    renderPass.setBindGroup(0, this.performanceVolumeBindGroup);
    renderPass.draw(3);

    renderPass.setPipeline(this.performanceWorldPipeline);
    renderPass.setBindGroup(0, this.performanceWorldBindGroup);
    renderPass.draw(3);

    renderPass.setPipeline(this.hyperProjectionPipeline);
    renderPass.setBindGroup(0, this.hyperProjectionBindGroup);
    renderPass.draw(3);

    renderPass.setPipeline(this.performanceScorePipeline);
    renderPass.setBindGroup(0, this.performanceScoreBindGroup);
    renderPass.draw(3);

    renderPass.end();
    this.gpu.device.queue.submit([encoder.finish()]);
    this.trailReadIndex = writeTrailIndex;
    this.trailNeedsClear = false;
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
    const draftMix = this.draftStrength * 0.72;
    for (let index = 0; index < this.signature.length; index += 1) {
      this.params[16 + index] = mix(
        this.signature[index],
        this.draftSignature[index],
        draftMix,
      );
    }
    this.params[24] = this.signatureAge;
    this.params[25] = this.signatureHash;
    this.params[26] = this.draftStrength;
    this.params[27] = this.draftHash;
    this.params.set(this.reservoir, 28);
    this.params.set(this.performanceState, 32);

    this.gpu.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);

    this.signatureAge = Math.min(999, this.signatureAge + dt);
    this.pointer.pulse = Math.max(0, this.pointer.pulse - dt * 3.2);
    this.pointer.vortex = Math.max(0, this.pointer.vortex - dt * 1.45);
    this.pointer.dragX *= 0.86;
    this.pointer.dragY *= 0.86;
  }

  private renderCount(): number {
    const performanceFloor =
      this.performanceState[0] > 0.5
        ? this.canvas.clientWidth <= 720
          ? PERFORMANCE_PARTICLES_MOBILE
          : this.canvas.clientWidth < 1000
            ? PERFORMANCE_PARTICLES_COMPACT
            : PERFORMANCE_PARTICLES_DESKTOP
        : 0;

    return Math.min(
      this.activeBudget,
      Math.max(this.activeCount, performanceFloor),
    );
  }

  private computeSubsteps(): number {
    if (this.performanceState[0] < 0.5) {
      return 1;
    }

    return this.canvas.clientWidth <= 720 ? 1 : 2;
  }

  private captureSignature(seed: WordSeed): void {
    const features = seed.features;

    this.signature[0] = seed.genome.energy;
    this.signature[1] = seed.genome.viscosity;
    this.signature[2] = seed.genome.turbulence;
    this.signature[3] = seed.genome.fertility;
    this.signature[4] = clamp01(features.length / 280);
    this.signature[5] = features.repeatRatio;
    this.signature[6] = clamp01(
      features.punctuationRatio +
        (features.exclamationCount + features.questionCount + features.ellipsisCount) /
          12,
    );
    this.signature[7] = clamp01(
      features.rhythmVariance * 0.36 +
        features.latinRatio * 0.2 +
        features.digitRatio * 0.36 +
        features.katakanaRatio * 0.42 +
        features.kanjiRatio * 0.54 +
        features.emojiRatio * 0.82,
    );
    this.signatureAge = 0;
    this.signatureHash = hashText(seed.text) / 0xffffffff;
    this.absorbReservoir(seed);
  }

  private absorbReservoir(seed: WordSeed): void {
    const features = seed.features;
    const symbol = clamp01(
      features.punctuationRatio +
        (features.exclamationCount + features.questionCount + features.ellipsisCount) /
          12,
    );
    const complexity = clamp01(
      features.rhythmVariance * 0.36 +
        features.latinRatio * 0.2 +
        features.digitRatio * 0.36 +
        features.katakanaRatio * 0.42 +
        features.kanjiRatio * 0.54 +
        features.emojiRatio * 0.82,
    );
    const blend = this.reservoirDepth === 0
      ? 1
      : clamp01(0.12 + seed.particleCount / 28000);

    this.reservoir[0] = mix(this.reservoir[0], seed.genome.energy, blend);
    this.reservoir[1] = mix(this.reservoir[1], seed.genome.viscosity, blend * 0.8);
    this.reservoir[2] = mix(
      this.reservoir[2],
      clamp01(seed.genome.turbulence * 0.78 + symbol * 0.38),
      blend,
    );
    this.reservoir[3] = clamp01(
      this.reservoir[3] * 0.92 +
        (complexity * 0.4 + seed.genome.fertility * 0.34 + features.repeatRatio * 0.26) *
          0.22,
    );
    this.reservoirDepth = Math.min(255, this.reservoirDepth + 1);
  }

  private createTrailTargets(): void {
    for (const texture of this.trailTextures) {
      texture.destroy();
    }

    const size = {
      width: Math.max(1, Math.floor(this.canvas.width * this.trailScale)),
      height: Math.max(1, Math.floor(this.canvas.height * this.trailScale)),
    };
    this.trailWidth = size.width;
    this.trailHeight = size.height;

    this.trailTextures = [0, 1].map((index) =>
      this.gpu.device.createTexture({
        label: `trail texture ${index}`,
        size,
        format: this.gpu.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.trailViews = this.trailTextures.map((texture) => texture.createView());
    this.trailFeedbackBindGroups = this.trailViews.map((view) =>
      this.gpu.device.createBindGroup({
        label: "trail feedback bind group",
        layout: this.trailFeedbackPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.trailSampler },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: this.paramsBuffer } },
        ],
      }),
    );
    this.trailCompositeBindGroups = this.trailViews.map((view) =>
      this.gpu.device.createBindGroup({
        label: "trail composite bind group",
        layout: this.trailCompositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.trailSampler },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: this.paramsBuffer } },
        ],
      }),
    );
    this.trailReadIndex = 0;
    this.trailNeedsClear = true;
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
  mode: SimulationMode,
  profile: SpawnProfile,
  unit: number,
  random: () => number,
  size: { width: number; height: number },
): ParticleSpawn {
  const center = seed.origin;
  const jitter = () => random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const energySpeed = 24 + seed.genome.energy * 126;

  if (mode === "swarm") {
    const orbitAngle = unit * TAU * 9.0 + random() * 0.35;
    const minSize = Math.min(size.width, size.height);
    const ring = minSize * (0.14 + random() * 0.26);
    const tangent = orbitAngle + Math.PI * 0.5;

    return {
      x: center.x + Math.cos(orbitAngle) * ring + jitter() * 18,
      y: center.y + Math.sin(orbitAngle) * ring * 0.72 + jitter() * 18,
      vx: Math.cos(tangent) * (90 + seed.genome.energy * 140),
      vy: Math.sin(tangent) * (90 + seed.genome.energy * 140),
    };
  }

  if (mode === "smoke") {
    const plumeWidth = Math.min(size.width * 0.42, 420);
    const lift = 34 + seed.genome.energy * 72 + random() * 42;

    return {
      x: center.x + jitter() * plumeWidth,
      y: size.height * (0.72 + random() * 0.16),
      vx: jitter() * (24 + seed.genome.turbulence * 80),
      vy: -lift,
    };
  }

  if (mode === "fungus") {
    const branchCount = 7;
    const branch = Math.floor(unit * branchCount);
    const branchUnit = unit * branchCount - branch;
    const branchAngle =
      -Math.PI * 0.78 + (branch / Math.max(1, branchCount - 1)) * Math.PI * 1.56;
    const curl = Math.sin(branchUnit * Math.PI * 3.0 + branch) * 0.32;
    const distance =
      36 + branchUnit * Math.min(size.width, size.height) * 0.34 +
      random() * 28;
    const base = {
      x: center.x,
      y: size.height * 0.72,
    };
    const angle = branchAngle + curl;

    return {
      x: base.x + Math.cos(angle) * distance + jitter() * 14,
      y: base.y + Math.sin(angle) * distance * 0.9 + jitter() * 14,
      vx: Math.cos(angle) * (28 + seed.genome.fertility * 110),
      vy: Math.sin(angle) * (28 + seed.genome.fertility * 110) - 12,
    };
  }

  if (mode === "glitch") {
    const columns = 18;
    const rows = 10;
    const column = Math.floor(random() * columns);
    const row = Math.floor((unit * rows * 3 + random() * rows) % rows);
    const cellWidth = size.width / columns;
    const cellHeight = size.height / rows;
    const direction = random() > 0.5 ? 1 : -1;

    return {
      x: column * cellWidth + random() * cellWidth,
      y: row * cellHeight + cellHeight * (0.35 + random() * 0.3),
      vx: direction * (120 + seed.genome.noiseScale * 260 + random() * 120),
      vy: jitter() * 38,
    };
  }

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

function radiusForMode(
  seed: WordSeed,
  mode: SimulationMode,
  random: () => number,
): number {
  const base = 1.8 + seed.genome.viscosity * 3.8 + random() * 2.4;

  if (mode === "swarm") {
    return Math.max(1.1, base * (0.48 + random() * 0.24));
  }

  if (mode === "smoke") {
    return base * (1.35 + random() * 0.75);
  }

  if (mode === "fungus") {
    return base * (0.7 + seed.genome.fertility * 0.55 + random() * 0.18);
  }

  if (mode === "glitch") {
    return base * (0.58 + random() * 0.42);
  }

  return base;
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
    0.26 + seed.genome.brightness * 0.2,
  ];
}

function varyParticleColor(
  baseColor: [number, number, number, number],
  seed: WordSeed,
  mode: SimulationMode,
  random: () => number,
): [number, number, number, number] {
  const accent = random();
  const chroma = 0.08 + seed.genome.turbulence * 0.14 + seed.genome.energy * 0.08;
  const warmth = accent < 0.34 ? chroma : 0;
  const bloom = accent > 0.68 ? chroma : 0;
  let red = baseColor[0] * (0.68 + random() * 0.22) + warmth * 0.35;
  let green = baseColor[1] * (0.7 + random() * 0.2) + chroma * 0.12;
  let blue = baseColor[2] * (0.72 + random() * 0.2) + bloom * 0.32;
  let alpha = baseColor[3] * (0.58 + random() * 0.18);

  if (mode === "swarm") {
    red = accent > 0.5 ? 0.92 + random() * 0.08 : 0.12 + random() * 0.12;
    green = accent > 0.5 ? 0.58 + random() * 0.18 : 0.72 + random() * 0.18;
    blue = accent > 0.5 ? 0.16 + random() * 0.12 : 0.88 + random() * 0.1;
    alpha *= 0.5;
  } else if (mode === "smoke") {
    red = 0.22 + random() * 0.12;
    green = 0.31 + random() * 0.16;
    blue = 0.46 + random() * 0.22;
    alpha *= 0.4;
  } else if (mode === "fungus") {
    red = accent > 0.78 ? 0.72 + random() * 0.18 : 0.14 + random() * 0.12;
    green = accent > 0.78 ? 0.2 + random() * 0.16 : 0.86 + random() * 0.12;
    blue = accent > 0.78 ? 0.72 + random() * 0.18 : 0.22 + random() * 0.16;
    alpha *= 0.48;
  } else if (mode === "glitch") {
    red = accent > 0.5 ? 0.96 : 0.04 + random() * 0.12;
    green = accent > 0.5 ? 0.14 + random() * 0.14 : 0.92 + random() * 0.08;
    blue = accent > 0.5 ? 0.82 + random() * 0.16 : 0.96;
    alpha *= 0.42;
  }

  return [
    Math.min(1, red),
    Math.min(1, green),
    Math.min(1, blue),
    alpha,
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

function trailScaleForBudget(activeBudget: number): number {
  if (activeBudget <= 2500) {
    return 0.58;
  }

  if (activeBudget <= 6000) {
    return 0.64;
  }

  if (activeBudget <= 16000) {
    return 0.72;
  }

  if (activeBudget <= 50000) {
    return 0.82;
  }

  return 0.9;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
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
