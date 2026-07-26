import { AudioEngine } from "../audio/audioEngine";
import type { AppSettings, AudioMode } from "./settings";
import { startCanvasRecording, type ActiveRecording } from "../export/recorder";
import { saveWordSlimeJson } from "../export/saveJson";
import { saveCanvasPng } from "../export/screenshot";
import { mapFeaturesToGenome, particleCountForFeatures } from "../input/genome";
import { attachTextInput } from "../input/textInput";
import { extractTextFeatures, type TextFeatures } from "../input/textFeatures";
import {
  AUTO_PERFORMANCE_DURATION_MS,
  AutoPerformanceConductor,
  type PerformanceFrame,
} from "../performance/autoPerformance";
import { InteractionLayer } from "../rendering/interactionLayer";
import { SedimentLayer } from "../rendering/sedimentLayer";
import { TextDecayLayer } from "../rendering/textDecayLayer";
import {
  createParticleRenderer,
  type ParticleRenderer,
  type ParticleRendererDraftSignature,
  type ParticleRendererStats,
} from "../rendering/webgpu/particleRenderer";
import { createInitialState, type AppState, type WordSeed } from "./state";
import {
  backgroundLabels,
  modeLabels,
  qualityLabels,
  qualityParticleBudgets,
  qualityParticleMultipliers,
  saveSettings,
} from "./settings";

export type WordSlimeApp = {
  destroy(): void;
};

export function createApp(root: HTMLElement): WordSlimeApp {
  const state = createInitialState();
  root.innerHTML = renderApp();

  const shell = query<HTMLElement>(root, ".wordslime-shell");
  const sedimentCanvas = query<HTMLCanvasElement>(root, ".sediment-canvas");
  const interactionCanvas = query<HTMLCanvasElement>(root, ".interaction-canvas");
  const textDecayCanvas = query<HTMLCanvasElement>(root, ".text-decay-canvas");
  const canvas = query<HTMLCanvasElement>(root, ".wordslime-canvas");
  const form = query<HTMLFormElement>(root, ".summon-form");
  const textarea = query<HTMLTextAreaElement>(root, ".summon-input");
  const seedHistory = query<HTMLElement>(root, ".seed-history");
  const spawnText = query<HTMLElement>(root, ".spawn-text");
  const hud = query<HTMLElement>(root, ".hud");
  const intro = query<HTMLElement>(root, ".intro");
  const toast = query<HTMLElement>(root, ".toast");
  const panel = query<HTMLElement>(root, ".panel");
  const settingsToggle = query<HTMLButtonElement>(root, ".settings-toggle");
  const audioButton = query<HTMLButtonElement>(root, ".audio-toggle");
  const autoPerformanceButton = query<HTMLButtonElement>(
    root,
    ".performance-toggle",
  );
  const saveButtons = queryAll<HTMLButtonElement>(root, ".save-button");
  const recordButtons = queryAll<HTMLButtonElement>(root, ".record-button");
  const jsonButton = query<HTMLButtonElement>(root, ".json-button");
  const resetButton = query<HTMLButtonElement>(root, ".reset-button");
  const aboutButton = query<HTMLButtonElement>(root, ".about-button");
  const aboutModal = query<HTMLElement>(root, ".about-modal");
  const aboutClose = query<HTMLButtonElement>(root, ".about-close");
  const audio = new AudioEngine();
  const sediment = new SedimentLayer(sedimentCanvas);
  const interactionLayer = new InteractionLayer(interactionCanvas);
  const textDecay = new TextDecayLayer(textDecayCanvas);
  let renderer: ParticleRenderer | undefined;
  let rendererGeneration = 0;
  let recoveringRenderer = false;
  let destroyed = false;
  let densityScale = 1;
  let clearInputQueue = () => {};
  let latestPerformanceFrame: PerformanceFrame | undefined;
  let stopAutoPerformance = () => false;
  const updateHudView = () => {
    updateHud(hud, state, renderer?.getStats());
  };
  const updateSeedHistoryView = () => {
    updateSeedHistory(seedHistory, state);
  };
  const applyParticleBudget = () => {
    const normalBudget =
      particleBudgetForViewport(state.settings.particleQuality, canvas) *
      densityScale;
    const performanceFloor =
      canvas.clientWidth <= 720 ? 42_000 : 72_000;

    renderer?.setParticleBudget(
      latestPerformanceFrame
        ? Math.max(normalBudget, performanceFloor)
        : normalBudget,
    );
  };
  const repopulateRenderer = () => {
    if (!renderer) {
      return;
    }

    renderer.clear();

    for (const seed of state.seeds) {
      renderer.addSeed(seed);
    }

    renderer.setDraftSignature(createDraftSignature(textarea.value));
  };
  applyBackground(shell, state.settings.background);
  syncSettingsPanel(panel, state.settings);
  updateAudioToggle(audioButton, state.settings.audioMode);
  const setAudioMode = async (mode: AudioMode, announce = true) => {
    state.settings.audioMode = mode;
    updatePressed(panel, "data-audio", mode);
    updateAudioToggle(audioButton, mode);
    updateHudView();
    const available = await audio.setMode(mode);

    if (available && mode !== "off") {
      audio.updateHum(state);
      if (announce) {
        showToast(toast, "音が生えました。", 1200);
      }
    } else if (!available) {
      showToast(toast, "Audio unavailable", 1600);
    }
  };

  resizeCanvas(canvas);
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas(canvas);
    sediment.resize();
    interactionLayer.resize();
    textDecay.resize();
    renderer?.resize();
    applyParticleBudget();
  });
  resizeObserver.observe(canvas);
  const pointerCleanup = attachPointerTracking(
    canvas,
    (pointer) => {
      renderer?.setPointer(pointer);
      interactionLayer.interact(pointer);
    },
    (scaleFactor) => {
      densityScale = clamp(densityScale * scaleFactor, 0.45, 1.6);
      applyParticleBudget();
      interactionLayer.showDensityPulse(scaleFactor);
    },
  );
  const settingsCleanup = attachSettingsPanel(
    panel,
    settingsToggle,
    state,
    () => {
      applyParticleBudget();
      saveSettings(state.settings);
      updateHudView();
      showToast(toast, modeLabels[state.settings.mode], 900);
    },
    repopulateRenderer,
    (background) => {
      state.settings.background = background;
      applyBackground(shell, background);
      saveSettings(state.settings);
      updateHudView();
      showToast(toast, backgroundLabels[background], 900);
    },
    setAudioMode,
  );
  const actionCleanup = attachActions({
    canvas,
    sedimentCanvas,
    interactionCanvas,
    textDecayCanvas,
    audioButton,
    saveButtons,
    recordButtons,
    jsonButton,
    resetButton,
    aboutButton,
    aboutClose,
    aboutModal,
    panel,
    settingsToggle,
    state,
    getRenderer: () => renderer,
    getSediment: () => sediment,
    getAudioStream: () => audio.getRecordingStream(),
    onStateChange: () => {
      updateHudView();
      updateSeedHistoryView();
    },
    onToast: (message, duration) => showToast(toast, message, duration),
    onAudioToggle: () => {
      void setAudioMode(state.settings.audioMode === "off" ? "soft" : "off");
    },
    onPauseToggle: () => {
      if (stopAutoPerformance()) {
        return;
      }

      state.isPaused = !state.isPaused;
      if (state.isPaused) {
        renderer?.stop();
        showToast(toast, "Paused", 900);
      } else {
        renderer?.start();
        showToast(toast, "Resumed", 900);
      }
      updateHudView();
    },
    onModeSelect: (mode) => {
      stopAutoPerformance();
      state.settings.mode = mode;
      updatePressed(panel, "data-mode", mode);
      repopulateRenderer();
      saveSettings(state.settings);
      updateHudView();
      showToast(toast, modeLabels[mode], 900);
    },
    onResetInput: () => {
      clearInputQueue();
      textarea.value = "";
      textarea.style.height = "";
      renderer?.setDraftSignature(undefined);
    },
    onBeforeReset: () => {
      stopAutoPerformance();
    },
  });

  const installRenderer = async (isRecovery: boolean): Promise<void> => {
    const generation = ++rendererGeneration;

    try {
      const particleRenderer = await createParticleRenderer(canvas, state.settings);

      if (destroyed || generation !== rendererGeneration) {
        particleRenderer.stop();
        return;
      }

      const previousRenderer = renderer;
      renderer = particleRenderer;
      previousRenderer?.stop();
      applyParticleBudget();
      renderer.setDraftSignature(createDraftSignature(textarea.value));
      if (latestPerformanceFrame) {
        renderer.setPerformanceState({
          active: true,
          progress: latestPerformanceFrame.progress,
          intensity: latestPerformanceFrame.intensity,
          phase:
            latestPerformanceFrame.movementIndex +
            latestPerformanceFrame.movementProgress * 0.999,
        });
      }
      renderer.onDeviceLost((info) => {
        if (destroyed) {
          return;
        }

        console.warn("GPU device lost", info);
        void recoverRenderer();
      });

      for (const seed of state.seeds) {
        renderer.addSeed(seed);
      }

      if (!state.isPaused) {
        renderer.start();
      }

      updateHudView();

      if (isRecovery) {
        showToast(toast, "GPUをつなぎ直しました。", 1400);
      }
    } catch (error: unknown) {
      if (destroyed || generation !== rendererGeneration) {
        return;
      }

      console.error(error);

      if (isRecovery) {
        showToast(toast, "GPU復帰に失敗しました。再読み込みしてください。", 3200);
      } else {
        root.innerHTML = renderUnsupported();
      }
    }
  };

  const recoverRenderer = async (): Promise<void> => {
    if (recoveringRenderer || destroyed) {
      return;
    }

    recoveringRenderer = true;
    renderer?.stop();
    renderer = undefined;
    showToast(toast, "GPUをつなぎ直しています。", 1800);

    try {
      await installRenderer(true);
    } finally {
      recoveringRenderer = false;
    }
  };

  void installRenderer(false);

  const updateDraftSignature = (text: string) => {
    renderer?.setDraftSignature(createDraftSignature(text));
    updateHudView();
  };

  const summonText = (text: string, replay = false) => {
    const previousSeed = state.seeds.at(-1);
    const seed = createWordSeed(text, state, canvas);
    state.seeds = [...state.seeds, seed].slice(-36);
    state.totalParticles = state.seeds.reduce(
      (total, retainedSeed) => total + retainedSeed.particleCount,
      0,
    );
    intro.dataset.hidden = "true";
    showSpawnText(spawnText, text);
    textDecay.play(text, state.settings);
    sediment.addSeed(seed);
    renderer?.addSeed(seed);
    audio.playSpawn(seed);
    if (previousSeed) {
      audio.playCollision(seed, previousSeed);
    }
    audio.updateHum(state);
    updateHudView();
    updateSeedHistoryView();

    if (replay) {
      showToast(toast, "標本をもう一度落としました。", 900);
    }
  };

  type PerformanceSnapshot = {
    mode: AppSettings["mode"];
    background: AppSettings["background"];
    audioMode: AudioMode;
    isPaused: boolean;
  };

  let performanceSnapshot: PerformanceSnapshot | undefined;
  let autoPerformanceStarting = false;
  let autoPerformanceGeneration = 0;
  const restoreAutoPerformance = (completed: boolean) => {
    autoPerformanceGeneration += 1;
    const snapshot = performanceSnapshot;
    performanceSnapshot = undefined;
    latestPerformanceFrame = undefined;
    shell.dataset.performance = "false";
    audio.stopPerformance();
    renderer?.setPerformanceState(undefined);
    applyParticleBudget();
    updatePerformanceToggle(autoPerformanceButton, false, 0);

    if (!snapshot || destroyed) {
      return;
    }

    state.settings.mode = snapshot.mode;
    state.settings.background = snapshot.background;
    state.isPaused = snapshot.isPaused;
    updatePressed(panel, "data-mode", snapshot.mode);
    updatePressed(panel, "data-background", snapshot.background);
    applyBackground(shell, snapshot.background);
    void setAudioMode(snapshot.audioMode, false);

    if (snapshot.isPaused) {
      renderer?.stop();
    } else {
      renderer?.start();
    }

    updateHudView();
    showToast(
      toast,
      completed ? "3分間の演奏が溶けました。" : "自動演奏を止めました。",
      1500,
    );
  };
  const conductor = new AutoPerformanceConductor({
    onStart: () => {
      shell.dataset.performance = "true";
      updatePerformanceToggle(autoPerformanceButton, true, 0);
    },
    onFrame: (frame) => {
      const enteringPerformance = !latestPerformanceFrame;
      latestPerformanceFrame = frame;
      if (enteringPerformance) {
        applyParticleBudget();
      }
      renderer?.setPerformanceState({
        active: true,
        progress: frame.progress,
        intensity: frame.intensity,
        phase: frame.movementIndex + frame.movementProgress * 0.999,
      });
      updatePerformanceToggle(autoPerformanceButton, true, frame.progress);
    },
    onMovement: (frame) => {
      state.settings.mode = frame.movement.mode;
      state.settings.background = frame.movement.background;
      updatePressed(panel, "data-mode", frame.movement.mode);
      updatePressed(panel, "data-background", frame.movement.background);
      applyBackground(shell, frame.movement.background);
      audio.playPerformanceTransition(
        frame.movementIndex,
        frame.movement.rootFrequency,
        frame.intensity,
      );
      updateHudView();
      showToast(toast, frame.movement.label, 1300);
    },
    onEvent: (event) => {
      if (event.kind === "beat") {
        audio.playPerformanceBeat(event);
      } else {
        summonText(event.text);
      }
    },
    onStop: restoreAutoPerformance,
  });

  const startAutoPerformance = async (startAtMs = 0) => {
    if (conductor.isRunning || autoPerformanceStarting) {
      return;
    }

    if (!renderer) {
      showToast(toast, "WebGPUを準備しています。", 1200);
      return;
    }

    autoPerformanceStarting = true;
    const generation = ++autoPerformanceGeneration;
    performanceSnapshot = {
      mode: state.settings.mode,
      background: state.settings.background,
      audioMode: state.settings.audioMode,
      isPaused: state.isPaused,
    };
    state.isPaused = false;
    renderer.start();
    intro.dataset.hidden = "true";
    updatePerformanceToggle(autoPerformanceButton, true, 0);
    await setAudioMode(
      state.settings.audioMode === "off" ? "weird" : state.settings.audioMode,
      false,
    );

    if (
      destroyed ||
      generation !== autoPerformanceGeneration ||
      !performanceSnapshot
    ) {
      return;
    }

    autoPerformanceStarting = false;
    conductor.start(startAtMs);
  };

  const handleAutoPerformanceToggle = () => {
    if (stopAutoPerformance()) {
      return;
    }

    void startAutoPerformance();
  };
  autoPerformanceButton.addEventListener("click", handleAutoPerformanceToggle);
  stopAutoPerformance = () => {
    if (conductor.isRunning) {
      conductor.stop(false);
      return true;
    }

    if (autoPerformanceStarting && performanceSnapshot) {
      autoPerformanceStarting = false;
      restoreAutoPerformance(false);
      return true;
    }

    return false;
  };
  const performanceDebugWindow = window as Window & {
    __wordSlimeStartPerformanceAt?: (elapsedMs: number) => void;
  };

  if (import.meta.env.DEV) {
    performanceDebugWindow.__wordSlimeStartPerformanceAt = (elapsedMs) => {
      stopAutoPerformance();
      void startAutoPerformance(
        clamp(elapsedMs, 0, AUTO_PERFORMANCE_DURATION_MS - 1),
      );
    };
  }

  const handleSeedHistoryClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "button[data-seed-id]",
    );

    if (!button) {
      return;
    }

    const seed = state.seeds.find((item) => item.id === button.dataset.seedId);

    if (!seed) {
      return;
    }

    textarea.value = "";
    renderer?.setDraftSignature(undefined);
    summonText(seed.text, true);
  };

  seedHistory.addEventListener("click", handleSeedHistoryClick);

  const textInput = attachTextInput(
    form,
    textarea,
    (text) => {
      summonText(text);
    },
    (queuedCount) => {
      state.queuedInputs = queuedCount;
      updateHudView();
    },
    updateDraftSignature,
  );
  clearInputQueue = textInput.clearQueue;

  updateHudView();
  updateSeedHistoryView();
  showToast(toast, "ことばを打つ。溶けるのを待つ。", 1800);
  const performanceCleanup = startPerformanceMonitor({
    state,
    panel,
    getRenderer: () => renderer,
    isAutoPerformance: () => Boolean(latestPerformanceFrame),
    onHudUpdate: updateHudView,
    onToast: (message, duration) => showToast(toast, message, duration),
    onQualityChange: applyParticleBudget,
  });

  return {
    destroy() {
      destroyed = true;
      rendererGeneration += 1;
      textInput.destroy();
      seedHistory.removeEventListener("click", handleSeedHistoryClick);
      pointerCleanup();
      settingsCleanup();
      actionCleanup();
      performanceCleanup();
      conductor.stop(false);
      delete performanceDebugWindow.__wordSlimeStartPerformanceAt;
      autoPerformanceButton.removeEventListener(
        "click",
        handleAutoPerformanceToggle,
      );
      renderer?.stop();
      interactionLayer.destroy();
      textDecay.destroy();
      audio.destroy();
      resizeObserver.disconnect();
    },
  };
}

function renderUnsupported(): string {
  return `
    <main class="unsupported">
      <p>
        <strong>この水槽は、このブラウザではまだ育ちません。</strong>
        WebGPU対応ブラウザで開いてください。
      </p>
    </main>
  `;
}

function renderApp(): string {
  return `
    <main class="wordslime-shell">
      <canvas class="wordslime-canvas" aria-label="WordSlime water tank"></canvas>
      <canvas class="sediment-canvas" aria-hidden="true"></canvas>
      <canvas class="interaction-canvas" aria-hidden="true"></canvas>
      <canvas class="text-decay-canvas" aria-hidden="true"></canvas>
      <div class="ui-layer">
        <section class="intro">
          <h1>WordSlime</h1>
          <p>ことばが溶けて、勝手に生きものになる。</p>
          <p>Type something. Press Enter.</p>
        </section>

        <div class="controls" aria-label="水槽操作">
          <button class="icon-button performance-toggle" type="button" title="3分自動演奏を再生" aria-label="3分自動演奏を再生" aria-pressed="false">▶</button>
          <button class="icon-button settings-toggle" type="button" title="設定" aria-label="設定" aria-expanded="false" aria-controls="settings-panel">⚙</button>
          <button class="icon-button audio-toggle" type="button" title="音をオン" aria-label="音をオン" aria-pressed="false">♪</button>
        </div>

        <div class="quick-actions" aria-label="保存操作">
          <button class="icon-button save-button" type="button" title="PNG保存" aria-label="PNG保存">◉</button>
          <button class="icon-button record-button" type="button" title="WebM録画" aria-label="WebM録画" aria-pressed="false">●</button>
        </div>

        <section class="panel" id="settings-panel" hidden>
          <h2>Settings</h2>
          <div class="setting-group">
            <div class="setting-label">挙動</div>
            <div class="segmented" style="--count: 5">
              <button type="button" data-mode="slime" aria-pressed="true">Slime</button>
              <button type="button" data-mode="swarm" aria-pressed="false">Swarm</button>
              <button type="button" data-mode="smoke" aria-pressed="false">Smoke</button>
              <button type="button" data-mode="fungus" aria-pressed="false">Fungus</button>
              <button type="button" data-mode="glitch" aria-pressed="false">Glitch</button>
            </div>
          </div>
          <div class="setting-group">
            <div class="setting-label">粒子数</div>
            <div class="segmented" style="--count: 4">
              <button type="button" data-quality="low" aria-pressed="false">Low</button>
              <button type="button" data-quality="medium" aria-pressed="true">Medium</button>
              <button type="button" data-quality="high" aria-pressed="false">High</button>
              <button type="button" data-quality="insane" aria-pressed="false">Insane</button>
            </div>
          </div>
          <div class="setting-group">
            <div class="setting-label">背景</div>
            <div class="segmented" style="--count: 4">
              <button type="button" data-background="dark" aria-pressed="false">Dark</button>
              <button type="button" data-background="milk" aria-pressed="false">Milk</button>
              <button type="button" data-background="deep-sea" aria-pressed="true">Sea</button>
              <button type="button" data-background="paper" aria-pressed="false">Paper</button>
            </div>
          </div>
          <div class="setting-group">
            <div class="setting-label">音</div>
            <div class="segmented" style="--count: 4">
              <button type="button" data-audio="off" aria-pressed="true">Off</button>
              <button type="button" data-audio="soft" aria-pressed="false">Soft</button>
              <button type="button" data-audio="weird" aria-pressed="false">Weird</button>
              <button type="button" data-audio="loud" aria-pressed="false">Loud</button>
            </div>
          </div>
          <div class="panel-actions">
            <button class="text-button save-button" type="button">PNG</button>
            <button class="text-button record-button" type="button" title="WebM録画。音がOff以外なら音も入ります。">WebM</button>
            <button class="text-button json-button" type="button">JSON</button>
            <button class="text-button reset-button" type="button">Reset</button>
            <button class="text-button about-button" type="button">About</button>
          </div>
        </section>

        <section class="about-modal" hidden>
          <div class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
            <h2 id="about-title">WordSlime</h2>
            <p>ことばが溶けて、勝手に生きものになる。</p>
            <p>入力された言葉は外部に送信されません。WordSlime はブラウザ内で完結します。</p>
            <button class="text-button about-close" type="button">Close</button>
          </div>
        </section>

        <div class="hud" aria-hidden="true"></div>

        <div class="spawn-text" aria-hidden="true"></div>

        <div class="toast" role="status" aria-live="polite"></div>

        <div class="input-dock">
          <div class="seed-history" aria-label="最近落としたことば" data-empty="true"></div>
          <form class="summon-form">
            <textarea
              class="summon-input"
              rows="1"
              maxlength="280"
              placeholder="ことばを落とす..."
              aria-label="ことばを落とす"
            ></textarea>
            <button class="summon-button" type="submit" aria-label="投入">↵</button>
          </form>
        </div>
      </div>
    </main>
  `;
}

type ActionElements = {
  canvas: HTMLCanvasElement;
  sedimentCanvas: HTMLCanvasElement;
  interactionCanvas: HTMLCanvasElement;
  textDecayCanvas: HTMLCanvasElement;
  audioButton: HTMLButtonElement;
  saveButtons: HTMLButtonElement[];
  recordButtons: HTMLButtonElement[];
  jsonButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  aboutButton: HTMLButtonElement;
  aboutClose: HTMLButtonElement;
  aboutModal: HTMLElement;
  panel: HTMLElement;
  settingsToggle: HTMLButtonElement;
  state: AppState;
  getRenderer: () => ParticleRenderer | undefined;
  getSediment: () => SedimentLayer;
  getAudioStream: () => MediaStream | undefined;
  onStateChange: () => void;
  onToast: (message: string, duration: number) => void;
  onAudioToggle: () => void;
  onPauseToggle: () => void;
  onModeSelect: (mode: AppState["settings"]["mode"]) => void;
  onResetInput: () => void;
  onBeforeReset: () => void;
};

function attachActions(elements: ActionElements): () => void {
  let recording: ActiveRecording | undefined;
  let recordingStarting = false;
  let frameCaptureBusy = false;
  let disposed = false;
  let aboutReturnFocus: HTMLElement | null = null;

  const handleSave = async () => {
    if (frameCaptureBusy) {
      elements.onToast("保存処理中です。", 900);
      return;
    }

    frameCaptureBusy = true;
    setActionPending(elements.saveButtons, true);

    try {
      await saveCanvasPng([
        elements.canvas,
        elements.sedimentCanvas,
        elements.interactionCanvas,
        elements.textDecayCanvas,
      ], {
        requestFrame: () => elements.getRenderer()?.renderOnce(),
      });
      elements.onToast("標本を保存しました。", 1400);
    } catch (error) {
      console.error(error);
      elements.onToast("PNG保存に失敗しました。", 1600);
    } finally {
      frameCaptureBusy = false;
      setActionPending(elements.saveButtons, false);
    }
  };

  const handleRecord = async () => {
    if (recording) {
      recording.stop();
      return;
    }

    if (recordingStarting) {
      return;
    }

    if (frameCaptureBusy) {
      elements.onToast("保存処理中です。", 900);
      return;
    }

    frameCaptureBusy = true;
    recordingStarting = true;
    setActionPending(elements.recordButtons, true);

    try {
      const activeRecording = await startCanvasRecording(
        [
          elements.canvas,
          elements.sedimentCanvas,
          elements.interactionCanvas,
          elements.textDecayCanvas,
        ],
        {
          audioStream: elements.getAudioStream(),
          requestFrame: () => elements.getRenderer()?.renderOnce(),
        },
      );
      frameCaptureBusy = false;
      recordingStarting = false;
      setActionPending(elements.recordButtons, false);

      if (disposed) {
        activeRecording.stop();
        void activeRecording.done.catch(() => {});
        return;
      }

      recording = activeRecording;
      setRecordingButtons(elements.recordButtons, true);
      elements.onToast("REC — slime is being captured", 1400);
      void recording.done
        .then(() => {
          elements.onToast("標本を保存しました。", 1400);
        })
        .catch((error: unknown) => {
          console.error(error);
          elements.onToast("録画に失敗しました。PNG保存を使ってください。", 1800);
        })
        .finally(() => {
          recording = undefined;
          setRecordingButtons(elements.recordButtons, false);
        });
    } catch (error) {
      frameCaptureBusy = false;
      recordingStarting = false;
      setActionPending(elements.recordButtons, false);
      console.error(error);

      if (!disposed) {
        elements.onToast("録画に失敗しました。PNG保存を使ってください。", 1800);
      }
    }
  };
  const handleRecordClick = () => {
    void handleRecord();
  };

  const handleJsonSave = () => {
    try {
      saveWordSlimeJson({
        seeds: elements.state.seeds,
        settings: elements.state.settings,
      });
      elements.onToast("標本を保存しました。", 1400);
    } catch (error) {
      console.error(error);
      elements.onToast("JSON保存に失敗しました。", 1600);
    }
  };

  const handleReset = () => {
    if (!window.confirm("この水槽を空にしますか？")) {
      return;
    }

    elements.onBeforeReset();
    elements.state.seeds = [];
    elements.state.totalParticles = 0;
    elements.state.queuedInputs = 0;
    elements.onResetInput();
    elements.getRenderer()?.clear();
    elements.getSediment().clear();
    clearCanvas(elements.interactionCanvas);
    clearCanvas(elements.textDecayCanvas);
    elements.onStateChange();
    elements.onToast("水槽を空にしました。", 1100);
  };

  const handleAboutOpen = () => {
    aboutReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : elements.aboutButton;
    elements.aboutModal.hidden = false;
    elements.aboutClose.focus();
  };

  const handleAboutClose = () => {
    elements.aboutModal.hidden = true;
    aboutReturnFocus?.focus();
    aboutReturnFocus = null;
  };

  const handleAboutBackdrop = (event: MouseEvent) => {
    if (event.target === elements.aboutModal) {
      handleAboutClose();
    }
  };

  const handleAudioToggle = () => {
    elements.onAudioToggle();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!elements.aboutModal.hidden && event.key === "Tab") {
      event.preventDefault();
      elements.aboutClose.focus();
      return;
    }

    if (event.key === "Escape") {
      if (!elements.aboutModal.hidden) {
        event.preventDefault();
        handleAboutClose();
        return;
      }

      if (!elements.panel.hidden) {
        event.preventDefault();
        elements.panel.hidden = true;
        elements.settingsToggle.setAttribute("aria-expanded", "false");
        return;
      }
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      void handleSave();
    } else if (event.key === "v" || event.key === "V") {
      event.preventDefault();
      void handleRecord();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      handleReset();
    } else if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      elements.onAudioToggle();
    } else if (event.key === " ") {
      event.preventDefault();
      elements.onPauseToggle();
    } else if (event.key === "1") {
      elements.onModeSelect("slime");
    } else if (event.key === "2") {
      elements.onModeSelect("swarm");
    } else if (event.key === "3") {
      elements.onModeSelect("smoke");
    } else if (event.key === "4") {
      elements.onModeSelect("fungus");
    } else if (event.key === "5") {
      elements.onModeSelect("glitch");
    }
  };

  elements.audioButton.addEventListener("click", handleAudioToggle);
  for (const button of elements.saveButtons) {
    button.addEventListener("click", handleSave);
  }
  for (const button of elements.recordButtons) {
    button.addEventListener("click", handleRecordClick);
  }
  elements.jsonButton.addEventListener("click", handleJsonSave);
  elements.resetButton.addEventListener("click", handleReset);
  elements.aboutButton.addEventListener("click", handleAboutOpen);
  elements.aboutClose.addEventListener("click", handleAboutClose);
  elements.aboutModal.addEventListener("click", handleAboutBackdrop);
  window.addEventListener("keydown", handleKeyDown);

  return () => {
    disposed = true;
    elements.audioButton.removeEventListener("click", handleAudioToggle);
    for (const button of elements.saveButtons) {
      button.removeEventListener("click", handleSave);
    }
    for (const button of elements.recordButtons) {
      button.removeEventListener("click", handleRecordClick);
    }
    elements.jsonButton.removeEventListener("click", handleJsonSave);
    elements.resetButton.removeEventListener("click", handleReset);
    elements.aboutButton.removeEventListener("click", handleAboutOpen);
    elements.aboutClose.removeEventListener("click", handleAboutClose);
    elements.aboutModal.removeEventListener("click", handleAboutBackdrop);
    window.removeEventListener("keydown", handleKeyDown);
    recording?.stop();
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function createWordSeed(
  text: string,
  state: AppState,
  canvas: HTMLCanvasElement,
): WordSeed {
  const features = extractTextFeatures(text);
  const genome = mapFeaturesToGenome(features);
  const particleCount = particleCountForFeatures(
    features,
    qualityParticleMultipliers[state.settings.particleQuality],
  );
  const index = state.seeds.length + 1;

  return {
    id: `seed-${Date.now().toString(36)}-${index.toString(36)}`,
    text,
    createdAt: performance.now(),
    features,
    genome,
    particleCount,
    origin: {
      x: canvas.width * 0.5,
      y: canvas.height * 0.5,
    },
  };
}

function createDraftSignature(
  text: string,
): ParticleRendererDraftSignature | undefined {
  const draftText = Array.from(text).slice(0, 280).join("");

  if (draftText.trim().length === 0) {
    return undefined;
  }

  const features = extractTextFeatures(draftText);
  const genome = mapFeaturesToGenome(features);

  return {
    energy: genome.energy,
    viscosity: genome.viscosity,
    turbulence: genome.turbulence,
    fertility: genome.fertility,
    lengthPressure: clamp(features.length / 280, 0, 1),
    repeatPressure: features.repeatRatio,
    symbolPressure: symbolPressureForFeatures(features),
    glyphComplexity: glyphComplexityForFeatures(features),
    strength: clamp(
      0.12 +
        features.length / 80 +
        features.punctuationRatio * 0.2 +
        features.repeatRatio * 0.18,
      0.08,
      1,
    ),
    hash: normalizedTextHash(draftText),
  };
}

function updateHud(
  hud: HTMLElement,
  state: AppState,
  stats?: ParticleRendererStats,
): void {
  const latest = state.seeds.at(-1);
  const mode = modeLabels[state.settings.mode];
  const quality = qualityLabels[state.settings.particleQuality];
  const seedParticles = state.seeds.reduce(
    (total, seed) => total + seed.particleCount,
    0,
  );
  const renderParticles = stats?.renderCount ?? seedParticles;
  const workgroups = stats?.computeWorkgroups ?? Math.ceil(renderParticles / 64);
  const gpuBytes =
    stats ? stats.particleBufferBytes + stats.trailTextureBytes : renderParticles * 48;
  const canvasSize = stats
    ? `${stats.canvasWidth}x${stats.canvasHeight}`
    : "pending";
  const budget = stats ? `${stats.activeBudget.toLocaleString()}` : "pending";
  const capacity = stats ? `${stats.capacity.toLocaleString()}` : "pending";
  const passCount = stats?.passCount ?? 3;
  const pipelineCount = stats?.pipelineCount ?? 12;
  const uniformBytes = stats ? formatBytes(stats.uniformBufferBytes) : "pending";
  const projectionLine =
    stats && stats.pipelineCount >= 9 ? "proj: 3d/4d wgsl<br />" : "";
  const performanceLine =
    stats && stats.performanceActive > 0.5
      ? `auto: ${formatPerformanceTime(stats.performanceProgress * AUTO_PERFORMANCE_DURATION_MS)} / 03:00 · ${Math.round(stats.performanceIntensity * 100)}%<br />world: 64-sdf + 48-vol<br />`
      : "";
  const signatureLine = latest
    ? `sig: ${formatByte(latest.genome.energy)} ${formatByte(latest.genome.viscosity)} ${formatByte(latest.genome.turbulence)} ${formatByte(latest.genome.fertility)}<br />`
    : "";
  const glyphLine = latest
    ? `glyph: ${formatByte(latest.features.length / 280)} ${formatByte(latest.features.repeatRatio)} ${formatByte(symbolPressure(latest))} ${formatByte(glyphComplexity(latest))}<br />`
    : "";
  const signalLine =
    latest && stats
      ? `signal: ${stats.seedSignalAge < 8 ? `${stats.seedSignalAge.toFixed(2)}s` : "cold"} / ${formatByte(stats.seedSignalHash)}<br />`
      : "";
  const draftLine =
    stats && stats.draftStrength > 0.01
      ? `draft: ${formatByte(stats.draftStrength)} / ${formatByte(stats.draftHash)}<br />`
      : "";
  const tankLine = stats
    ? `tank: ${formatByte(stats.reservoirEnergy)} ${formatByte(stats.reservoirViscosity)} ${formatByte(stats.reservoirTurbulence)} ${formatByte(stats.reservoirComplexity)}<br />`
    : "";

  hud.innerHTML = `
    <strong>${mode.toUpperCase()} / ${quality.toUpperCase()}</strong>
    gpu: webgpu<br />
    pipe: ${pipelineCount}p / ${passCount}pass<br />
    ${projectionLine}
    ${performanceLine}
    wg: ${workgroups.toString(16).toUpperCase().padStart(4, "0")}h<br />
    fb: ${canvasSize}<br />
    vram: ${formatBytes(gpuBytes)}<br />
    ubo: ${uniformBytes}<br />
    ${signatureLine}
    ${glyphLine}
    ${signalLine}
    ${draftLine}
    ${tankLine}
    budget: ${budget} / cap: ${capacity}<br />
    seeds: ${state.seeds.length} / draw: ${renderParticles.toLocaleString()}<br />
    ${latest ? `last: ${escapeHtml(trimText(latest.text, 18))}<br />` : ""}
    ${state.queuedInputs > 0 ? `queue: ${state.queuedInputs}<br />` : ""}
    fps: ${state.performance.fps > 0 ? Math.round(state.performance.fps) : "-"}<br />
    ${state.isPaused ? "state: pause" : latest ? `energy: ${latest.genome.energy.toFixed(2)}` : "state: idle"}
  `;
}

function updateSeedHistory(element: HTMLElement, state: AppState): void {
  const seeds = state.seeds.slice(-8).reverse();
  element.dataset.empty = String(seeds.length === 0);
  element.innerHTML = seeds
    .map((seed) => {
      const energy = formatByte(seed.genome.energy);
      const glyph = formatByte(glyphComplexity(seed));
      const compactText = seed.text.replace(/\s+/g, " ");
      const text = escapeHtml(trimText(compactText, 18));
      const title = escapeHtml(`もう一度落とす: ${trimText(compactText, 42)}`);

      return `
        <button
          class="seed-chip"
          type="button"
          data-seed-id="${escapeHtml(seed.id)}"
          style="--seed-energy: ${seed.genome.energy.toFixed(3)}; --seed-glyph: ${glyphComplexity(seed).toFixed(3)}"
          title="${title}"
          aria-label="${title}"
        >
          <span class="seed-chip-text">${text}</span>
          <span class="seed-chip-code">${energy}.${glyph}</span>
        </button>
      `;
    })
    .join("");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}mb`;
  }

  if (bytes < 1024) {
    return `${bytes}b`;
  }

  return `${Math.round(bytes / 1024).toLocaleString()}kb`;
}

function formatPerformanceTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updatePerformanceToggle(
  button: HTMLButtonElement,
  running: boolean,
  progress: number,
): void {
  const label = running ? "3分自動演奏を停止" : "3分自動演奏を再生";
  button.textContent = running ? "■" : "▶";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(running));
  button.style.setProperty(
    "--performance-progress",
    String(clamp(progress, 0, 1)),
  );
}

function formatByte(value: number): string {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
}

function symbolPressure(seed: WordSeed): number {
  return symbolPressureForFeatures(seed.features);
}

function symbolPressureForFeatures(features: TextFeatures): number {
  return clamp(
    features.punctuationRatio +
      (features.exclamationCount +
        features.questionCount +
        features.ellipsisCount) /
        12,
    0,
    1,
  );
}

function glyphComplexity(seed: WordSeed): number {
  return glyphComplexityForFeatures(seed.features);
}

function glyphComplexityForFeatures(features: TextFeatures): number {
  return clamp(
    features.rhythmVariance * 0.36 +
      features.latinRatio * 0.2 +
      features.digitRatio * 0.36 +
      features.katakanaRatio * 0.42 +
      features.kanjiRatio * 0.54 +
      features.emojiRatio * 0.82,
    0,
    1,
  );
}

function normalizedTextHash(text: string): number {
  let hash = 2166136261;

  for (const char of Array.from(text)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}

type PerformanceMonitorOptions = {
  state: AppState;
  panel: HTMLElement;
  getRenderer: () => ParticleRenderer | undefined;
  isAutoPerformance: () => boolean;
  onHudUpdate: () => void;
  onToast: (message: string, duration: number) => void;
  onQualityChange: () => void;
};

function startPerformanceMonitor(options: PerformanceMonitorOptions): () => void {
  let frameHandle = 0;
  let last = performance.now();
  let frames = 0;
  let lowFpsSamples = 0;
  const qualityOrder = ["low", "medium", "high", "insane"] as const;

  const tick = (now: number) => {
    frames += 1;

    if (now - last >= 1000) {
      const fps = (frames * 1000) / (now - last);
      options.state.performance.fps = fps;
      frames = 0;
      last = now;

      if (
        !options.state.isPaused &&
        !options.isAutoPerformance() &&
        fps > 0 &&
        fps < 26
      ) {
        lowFpsSamples += 1;
      } else {
        lowFpsSamples = 0;
      }

      if (lowFpsSamples >= 5) {
        lowFpsSamples = 0;
        degradeQuality(options, qualityOrder);
      }

      options.onHudUpdate();
    }

    frameHandle = requestAnimationFrame(tick);
  };

  frameHandle = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(frameHandle);
}

function degradeQuality(
  options: PerformanceMonitorOptions,
  qualityOrder: readonly AppState["settings"]["particleQuality"][],
): void {
  const current = options.state.settings.particleQuality;
  const index = qualityOrder.indexOf(current);

  if (index <= 0) {
    return;
  }

  const next = qualityOrder[index - 1];
  options.state.settings.particleQuality = next;
  options.state.performance.degraded = true;
  updatePressed(options.panel, "data-quality", next);
  saveSettings(options.state.settings);
  options.onQualityChange();
  options.onToast(`Particle quality lowered: ${qualityLabels[next]}`, 1700);
}

function showSpawnText(element: HTMLElement, text: string): void {
  element.textContent = trimText(text, 80);
  element.dataset.active = "false";
  void element.offsetWidth;
  element.dataset.active = "true";
}

const toastTimers = new WeakMap<HTMLElement, number>();

function showToast(element: HTMLElement, text: string, duration: number): void {
  const activeTimer = toastTimers.get(element);

  if (activeTimer !== undefined) {
    window.clearTimeout(activeTimer);
  }

  element.textContent = text;
  element.dataset.active = "true";

  const timer = window.setTimeout(() => {
    element.dataset.active = "false";
    toastTimers.delete(element);
  }, duration);
  toastTimers.set(element, timer);
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

function applyBackground(shell: HTMLElement, background: string): void {
  shell.dataset.background = background;
}

function particleBudgetForViewport(
  quality: AppState["settings"]["particleQuality"],
  canvas: HTMLCanvasElement,
): number {
  const mobileBudgets: Record<
    AppState["settings"]["particleQuality"],
    number
  > = {
    low: 2000,
    medium: 5000,
    high: 16000,
    insane: 36000,
  };
  const isMobileViewport = canvas.clientWidth <= 720;

  return isMobileViewport
    ? mobileBudgets[quality]
    : qualityParticleBudgets[quality];
}

function attachSettingsPanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  state: AppState,
  onChange: () => void,
  onModeChange: () => void,
  onBackgroundChange: (background: AppState["settings"]["background"]) => void,
  onAudioModeChange: (mode: AudioMode) => Promise<void>,
): () => void {
  const handleToggle = () => {
    const nextOpen = panel.hidden;
    panel.hidden = !nextOpen;
    toggle.setAttribute("aria-expanded", String(nextOpen));
  };

  const handleClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest("button");

    if (!button) {
      return;
    }

    const mode = button.getAttribute("data-mode");
    const quality = button.getAttribute("data-quality");
    const background = button.getAttribute("data-background");
    const audio = button.getAttribute("data-audio");

    if (
      mode === "slime" ||
      mode === "swarm" ||
      mode === "smoke" ||
      mode === "fungus" ||
      mode === "glitch"
    ) {
      state.settings.mode = mode;
      updatePressed(panel, "data-mode", mode);
      onModeChange();
      onChange();
    }

    if (
      quality === "low" ||
      quality === "medium" ||
      quality === "high" ||
      quality === "insane"
    ) {
      state.settings.particleQuality = quality;
      updatePressed(panel, "data-quality", quality);
      onChange();
    }

    if (
      background === "dark" ||
      background === "milk" ||
      background === "deep-sea" ||
      background === "paper"
    ) {
      state.settings.background = background;
      updatePressed(panel, "data-background", background);
      onBackgroundChange(background);
    }

    if (
      audio === "off" ||
      audio === "soft" ||
      audio === "weird" ||
      audio === "loud"
    ) {
      state.settings.audioMode = audio;
      updatePressed(panel, "data-audio", audio);
      onChange();
      void onAudioModeChange(audio);
    }
  };

  toggle.addEventListener("click", handleToggle);
  panel.addEventListener("click", handleClick);

  return () => {
    toggle.removeEventListener("click", handleToggle);
    panel.removeEventListener("click", handleClick);
  };
}

function updatePressed(panel: HTMLElement, attribute: string, active: string): void {
  const buttons = panel.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`);

  for (const button of buttons) {
    button.setAttribute(
      "aria-pressed",
      String(button.getAttribute(attribute) === active),
    );
  }
}

function syncSettingsPanel(panel: HTMLElement, settings: AppSettings): void {
  updatePressed(panel, "data-mode", settings.mode);
  updatePressed(panel, "data-quality", settings.particleQuality);
  updatePressed(panel, "data-background", settings.background);
  updatePressed(panel, "data-audio", settings.audioMode);
}

function updateAudioToggle(button: HTMLButtonElement, mode: AudioMode): void {
  const enabled = mode !== "off";
  button.setAttribute("aria-pressed", String(enabled));
  button.title = enabled ? "ミュート" : "音をオン";
  button.setAttribute("aria-label", enabled ? "ミュート" : "音をオン");
}

function setRecordingButtons(
  buttons: readonly HTMLButtonElement[],
  isRecording: boolean,
): void {
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(isRecording));
    button.title = isRecording ? "録画停止" : "WebM録画";
    button.setAttribute("aria-label", isRecording ? "録画停止" : "WebM録画");

    if (button.classList.contains("icon-button")) {
      button.textContent = isRecording ? "■" : "●";
    } else {
      button.textContent = isRecording ? "Stop" : "WebM";
    }
  }
}

function setActionPending(
  buttons: readonly HTMLButtonElement[],
  isPending: boolean,
): void {
  for (const button of buttons) {
    button.disabled = isPending;
    button.setAttribute("aria-busy", String(isPending));
  }
}

function attachPointerTracking(
  canvas: HTMLCanvasElement,
  onPointer: (pointer: {
    x: number;
    y: number;
    active: boolean;
    down: boolean;
    pulse: number;
    vortex: number;
    dragX: number;
    dragY: number;
  }) => void,
  onPinchDensity?: (scaleFactor: number) => void,
): () => void {
  let down = false;
  let downAt = 0;
  let downPoint = { x: 0, y: 0 };
  let lastPoint = { x: 0, y: 0 };
  let lastPinchDistance = 0;
  const activePointers = new Map<number, { x: number; y: number }>();

  const pointFromEvent = (
    event: PointerEvent,
    signal: {
      pulse?: number;
      vortex?: number;
      dragX?: number;
      dragY?: number;
    } = {},
  ) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    return {
      x,
      y,
      active: true,
      down,
      pulse: signal.pulse ?? 0,
      vortex: signal.vortex ?? 0,
      dragX: signal.dragX ?? 0,
      dragY: signal.dragY ?? 0,
    };
  };

  const handleMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dragX = down ? x - lastPoint.x : 0;
    const dragY = down ? y - lastPoint.y : 0;
    lastPoint = { x, y };
    activePointers.set(event.pointerId, { x, y });
    updatePinchDensity();
    onPointer(pointFromEvent(event, { dragX, dragY }));
  };

  const handleDown = (event: PointerEvent) => {
    down = true;
    downAt = performance.now();
    const rect = canvas.getBoundingClientRect();
    downPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    lastPoint = downPoint;
    activePointers.set(event.pointerId, downPoint);
    refreshPinchDistance();
    canvas.setPointerCapture(event.pointerId);
    onPointer(pointFromEvent(event));
  };

  const handleUp = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const moved = Math.hypot(x - downPoint.x, y - downPoint.y);
    const wasTap = performance.now() - downAt < 360 && moved < 12;
    activePointers.delete(event.pointerId);
    down = activePointers.size > 0;
    refreshPinchDistance();
    onPointer(pointFromEvent(event, { pulse: wasTap ? 1 : 0 }));
  };

  const handleDoubleClick = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    down = false;
    onPointer({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      active: true,
      down: false,
      pulse: 0.35,
      vortex: 1,
      dragX: 0,
      dragY: 0,
    });
  };

  const handleLeave = () => {
    activePointers.clear();
    lastPinchDistance = 0;
    down = false;
    onPointer({
      x: 0,
      y: 0,
      active: false,
      down: false,
      pulse: 0,
      vortex: 0,
      dragX: 0,
      dragY: 0,
    });
  };

  const refreshPinchDistance = () => {
    const pointers = Array.from(activePointers.values());
    lastPinchDistance =
      pointers.length >= 2 ? distanceBetween(pointers[0], pointers[1]) : 0;
  };

  const updatePinchDensity = () => {
    if (!onPinchDensity || activePointers.size < 2) {
      lastPinchDistance = 0;
      return;
    }

    const pointers = Array.from(activePointers.values());
    const distance = distanceBetween(pointers[0], pointers[1]);

    if (lastPinchDistance > 1) {
      onPinchDensity(clamp(distance / lastPinchDistance, 0.94, 1.06));
    }

    lastPinchDistance = distance;
  };

  canvas.addEventListener("pointermove", handleMove);
  canvas.addEventListener("pointerdown", handleDown);
  canvas.addEventListener("pointerup", handleUp);
  canvas.addEventListener("pointercancel", handleUp);
  canvas.addEventListener("pointerleave", handleLeave);
  canvas.addEventListener("dblclick", handleDoubleClick);

  return () => {
    canvas.removeEventListener("pointermove", handleMove);
    canvas.removeEventListener("pointerdown", handleDown);
    canvas.removeEventListener("pointerup", handleUp);
    canvas.removeEventListener("pointercancel", handleUp);
    canvas.removeEventListener("pointerleave", handleLeave);
    canvas.removeEventListener("dblclick", handleDoubleClick);
  };
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

function queryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const elements = Array.from(root.querySelectorAll<T>(selector));

  if (elements.length === 0) {
    throw new Error(`Missing elements: ${selector}`);
  }

  return elements;
}

function distanceBetween(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trimText(text: string, maxLength: number): string {
  const chars = Array.from(text);

  if (chars.length <= maxLength) {
    return text;
  }

  return `${chars.slice(0, maxLength - 1).join("")}…`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
