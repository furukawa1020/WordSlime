import { AudioEngine } from "../audio/audioEngine";
import type { AudioMode } from "./settings";
import { saveCanvasPng } from "../export/screenshot";
import { mapFeaturesToGenome, particleCountForFeatures } from "../input/genome";
import { attachTextInput } from "../input/textInput";
import { extractTextFeatures } from "../input/textFeatures";
import {
  createParticleRenderer,
  type ParticleRenderer,
} from "../rendering/webgpu/particleRenderer";
import { createInitialState, type AppState, type WordSeed } from "./state";
import {
  modeLabels,
  qualityLabels,
  qualityParticleMultipliers,
} from "./settings";

export type WordSlimeApp = {
  destroy(): void;
};

export function createApp(root: HTMLElement): WordSlimeApp {
  const state = createInitialState();
  root.innerHTML = renderApp();

  const canvas = query<HTMLCanvasElement>(root, ".wordslime-canvas");
  const form = query<HTMLFormElement>(root, ".summon-form");
  const textarea = query<HTMLTextAreaElement>(root, ".summon-input");
  const spawnText = query<HTMLElement>(root, ".spawn-text");
  const hud = query<HTMLElement>(root, ".hud");
  const intro = query<HTMLElement>(root, ".intro");
  const toast = query<HTMLElement>(root, ".toast");
  const panel = query<HTMLElement>(root, ".panel");
  const settingsToggle = query<HTMLButtonElement>(root, ".settings-toggle");
  const saveButton = query<HTMLButtonElement>(root, ".save-button");
  const resetButton = query<HTMLButtonElement>(root, ".reset-button");
  const aboutButton = query<HTMLButtonElement>(root, ".about-button");
  const aboutModal = query<HTMLElement>(root, ".about-modal");
  const aboutClose = query<HTMLButtonElement>(root, ".about-close");
  const audio = new AudioEngine();
  let renderer: ParticleRenderer | undefined;

  resizeCanvas(canvas);
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas(canvas);
    renderer?.resize();
  });
  resizeObserver.observe(canvas);
  const pointerCleanup = attachPointerTracking(canvas, (pointer) => {
    renderer?.setPointer(pointer);
  });
  const settingsCleanup = attachSettingsPanel(
    panel,
    settingsToggle,
    state,
    () => {
      updateHud(hud, state);
      showToast(toast, modeLabels[state.settings.mode], 900);
    },
    async (mode) => {
      const available = await audio.setMode(mode);
      if (available && mode !== "off") {
        showToast(toast, "音が生えました。", 1200);
      } else if (!available) {
        showToast(toast, "Audio unavailable", 1600);
      }
    },
  );
  const actionCleanup = attachActions({
    canvas,
    saveButton,
    resetButton,
    aboutButton,
    aboutClose,
    aboutModal,
    state,
    getRenderer: () => renderer,
    onStateChange: () => updateHud(hud, state),
    onToast: (message, duration) => showToast(toast, message, duration),
  });

  createParticleRenderer(canvas, state.settings)
    .then((particleRenderer) => {
      renderer = particleRenderer;
      renderer.start();
    })
    .catch((error: unknown) => {
      console.error(error);
      root.innerHTML = renderUnsupported();
    });

  const textInput = attachTextInput(
    form,
    textarea,
    (text) => {
      const seed = createWordSeed(text, state, canvas);
      state.seeds = [...state.seeds, seed].slice(-36);
      state.totalParticles += seed.particleCount;
      intro.dataset.hidden = "true";
      showSpawnText(spawnText, text);
      renderer?.addSeed(seed);
      audio.playSpawn(seed);
      audio.updateHum(state);
      updateHud(hud, state);
    },
    (queuedCount) => {
      state.queuedInputs = queuedCount;
      updateHud(hud, state);
    },
  );

  updateHud(hud, state);
  showToast(toast, "ことばを打つ。溶けるのを待つ。", 1800);

  return {
    destroy() {
      textInput.destroy();
      pointerCleanup();
      settingsCleanup();
      actionCleanup();
      renderer?.stop();
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
      <div class="ui-layer">
        <section class="intro">
          <h1>WordSlime</h1>
          <p>ことばが溶けて、勝手に生きものになる。</p>
          <p>Type something. Press Enter.</p>
        </section>

        <div class="controls" aria-label="水槽操作">
          <button class="icon-button settings-toggle" type="button" title="設定" aria-label="設定" aria-expanded="false">⚙</button>
          <button class="icon-button save-button" type="button" title="PNG保存" aria-label="PNG保存">◉</button>
        </div>

        <section class="panel" hidden>
          <h2>Settings</h2>
          <div class="setting-group">
            <div class="setting-label">挙動</div>
            <div class="segmented" style="--count: 3">
              <button type="button" data-mode="slime" aria-pressed="true">Slime</button>
              <button type="button" data-mode="swarm" aria-pressed="false">Swarm</button>
              <button type="button" data-mode="smoke" aria-pressed="false">Smoke</button>
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
            <div class="setting-label">音</div>
            <div class="segmented" style="--count: 4">
              <button type="button" data-audio="off" aria-pressed="true">Off</button>
              <button type="button" data-audio="soft" aria-pressed="false">Soft</button>
              <button type="button" data-audio="weird" aria-pressed="false">Weird</button>
              <button type="button" data-audio="loud" aria-pressed="false">Loud</button>
            </div>
          </div>
          <div class="panel-actions">
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

        <div class="hud" aria-live="polite"></div>

        <div class="spawn-text" aria-hidden="true"></div>

        <div class="toast" role="status" aria-live="polite"></div>

        <div class="input-dock">
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
  saveButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  aboutButton: HTMLButtonElement;
  aboutClose: HTMLButtonElement;
  aboutModal: HTMLElement;
  state: AppState;
  getRenderer: () => ParticleRenderer | undefined;
  onStateChange: () => void;
  onToast: (message: string, duration: number) => void;
};

function attachActions(elements: ActionElements): () => void {
  const handleSave = async () => {
    try {
      await saveCanvasPng(elements.canvas);
      elements.onToast("標本を保存しました。", 1400);
    } catch (error) {
      console.error(error);
      elements.onToast("PNG保存に失敗しました。", 1600);
    }
  };

  const handleReset = () => {
    if (!window.confirm("この水槽を空にしますか？")) {
      return;
    }

    elements.state.seeds = [];
    elements.state.totalParticles = 0;
    elements.state.queuedInputs = 0;
    elements.getRenderer()?.clear();
    elements.onStateChange();
    elements.onToast("水槽を空にしました。", 1100);
  };

  const handleAboutOpen = () => {
    elements.aboutModal.hidden = false;
  };

  const handleAboutClose = () => {
    elements.aboutModal.hidden = true;
  };

  elements.saveButton.addEventListener("click", handleSave);
  elements.resetButton.addEventListener("click", handleReset);
  elements.aboutButton.addEventListener("click", handleAboutOpen);
  elements.aboutClose.addEventListener("click", handleAboutClose);

  return () => {
    elements.saveButton.removeEventListener("click", handleSave);
    elements.resetButton.removeEventListener("click", handleReset);
    elements.aboutButton.removeEventListener("click", handleAboutOpen);
    elements.aboutClose.removeEventListener("click", handleAboutClose);
  };
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

function updateHud(hud: HTMLElement, state: AppState): void {
  const latest = state.seeds.at(-1);
  const mode = modeLabels[state.settings.mode];
  const quality = qualityLabels[state.settings.particleQuality];

  hud.innerHTML = `
    <strong>${mode} / ${quality}</strong>
    seeds: ${state.seeds.length}<br />
    particles: ${state.totalParticles.toLocaleString()}<br />
    ${latest ? `last: ${escapeHtml(trimText(latest.text, 18))}<br />` : ""}
    ${state.queuedInputs > 0 ? `queued: ${state.queuedInputs}<br />` : ""}
    ${latest ? `energy: ${latest.genome.energy.toFixed(2)}` : "waiting"}
  `;
}

function showSpawnText(element: HTMLElement, text: string): void {
  element.textContent = trimText(text, 80);
  element.dataset.active = "false";
  void element.offsetWidth;
  element.dataset.active = "true";
}

function showToast(element: HTMLElement, text: string, duration: number): void {
  element.textContent = text;
  element.dataset.active = "true";

  window.setTimeout(() => {
    element.dataset.active = "false";
  }, duration);
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
}

function attachSettingsPanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  state: AppState,
  onChange: () => void,
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
    const audio = button.getAttribute("data-audio");

    if (mode === "slime" || mode === "swarm" || mode === "smoke") {
      state.settings.mode = mode;
      updatePressed(panel, "data-mode", mode);
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

function attachPointerTracking(
  canvas: HTMLCanvasElement,
  onPointer: (pointer: {
    x: number;
    y: number;
    active: boolean;
    down: boolean;
  }) => void,
): () => void {
  let down = false;

  const pointFromEvent = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      active: true,
      down,
    };
  };

  const handleMove = (event: PointerEvent) => {
    onPointer(pointFromEvent(event));
  };

  const handleDown = (event: PointerEvent) => {
    down = true;
    canvas.setPointerCapture(event.pointerId);
    onPointer(pointFromEvent(event));
  };

  const handleUp = (event: PointerEvent) => {
    down = false;
    onPointer(pointFromEvent(event));
  };

  const handleLeave = () => {
    onPointer({ x: 0, y: 0, active: false, down: false });
  };

  canvas.addEventListener("pointermove", handleMove);
  canvas.addEventListener("pointerdown", handleDown);
  canvas.addEventListener("pointerup", handleUp);
  canvas.addEventListener("pointercancel", handleUp);
  canvas.addEventListener("pointerleave", handleLeave);

  return () => {
    canvas.removeEventListener("pointermove", handleMove);
    canvas.removeEventListener("pointerdown", handleDown);
    canvas.removeEventListener("pointerup", handleUp);
    canvas.removeEventListener("pointercancel", handleUp);
    canvas.removeEventListener("pointerleave", handleLeave);
  };
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
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
