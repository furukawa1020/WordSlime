import "./styles/global.css";
import { extractTextFeatures } from "./input/textFeatures";
import { mapFeaturesToGenome } from "./input/genome";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

const sampleText = "Type something. Let it rot.";
const sampleFeatures = extractTextFeatures(sampleText);
const sampleGenome = mapFeaturesToGenome(sampleFeatures);

app.innerHTML = `
  <main class="wordslime-shell">
    <canvas class="wordslime-canvas" aria-label="WordSlime water tank"></canvas>
    <div class="ui-layer">
      <section class="intro">
        <h1>WordSlime</h1>
        <p>ことばが溶けて、勝手に生きものになる。</p>
        <p>Type something. Press Enter.</p>
      </section>
      <div class="hud" aria-live="polite">
        <strong>Deep Tank</strong>
        seeds: 0<br />
        particles: 0<br />
        energy: ${sampleGenome.energy.toFixed(2)}
      </div>
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

console.info("WordSlime seed features", sampleFeatures);
