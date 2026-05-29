# WordSlime

## ことばが溶けて、勝手に生きものになる。

WordSlime is a browser-based WebGPU toy that turns typed words into living particle slime.
It does not analyze meaning, emotion, or mental state.
It transforms textual features such as length, repetition, punctuation, and rhythm into motion, sound, and slime-like behavior.

## Features

- WebGPU particle simulation
- Procedural Web Audio
- Text-to-physics mapping
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

## Netlify

Netlify can build this as a static Vite site.

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `22`

The included `netlify.toml` sets these values. WebGPU requires a secure context, so use the HTTPS Netlify deploy URL when trying the live build.

## Privacy

Typed text is processed locally in your browser and is not sent anywhere.
Only visual settings are stored in `localStorage`; typed words are not auto-saved.
