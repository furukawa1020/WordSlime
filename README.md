# WordSlime

## ことばが溶けて、勝手に生きものになる。

WordSlime is a browser-based WebGPU toy that turns typed words into living particle slime.
It does not analyze meaning, emotion, or mental state.
It transforms textual features such as length, repetition, punctuation, and rhythm into motion, sound, and slime-like behavior.

## Features

- WebGPU compute particle simulation with WGSL
- GPU reaction-diffusion field coupled to particle motion and compositing
- Volumetric 3D slime and rotating 4D projection
- Procedural Web Audio
- Text-to-physics mapping
- Mouse, touch, pinch, drag, and keyboard interaction
- Local-only execution
- PNG, WebM, and JSON export
- No login, no server, no external API

## Requirements

- Node.js 20.19+ or 22.12+
- A WebGPU-capable browser

## Development

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/
```

Chrome or Edge with WebGPU enabled is recommended. The app intentionally shows
an unsupported message instead of a reduced Canvas fallback when WebGPU is not
available.

PowerShell環境で `npm` が実行ポリシーに止められる場合は、次のように実行してください。

```bash
npm.cmd install
npm.cmd run dev
```

## Checks

```bash
npm run test
npm run build
```

## Controls

- `▶`: run the three-minute WebGPU performance (up to 120,000 particles)
- `Enter`: summon a word (`Shift + Enter` inserts a line break)
- `Space`: pause or resume
- `1` to `5`: switch behavior
- `S`: save PNG
- `V`: start or stop WebM recording (maximum 30 seconds)
- `M`: mute
- `R`: reset the tank

## Netlify

Netlify can build this as a static Vite site.

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `22`

The included `netlify.toml` sets these values. WebGPU requires a secure context, so use the HTTPS Netlify deploy URL when trying the live build.

## Privacy

Typed text is processed locally in your browser and is not sent anywhere.
Only visual settings are stored in `localStorage`; typed words are not auto-saved.
