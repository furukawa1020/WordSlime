import type { AudioMode } from "../app/settings";
import type { AppState, WordSeed } from "../app/state";

export class AudioEngine {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private hum: OscillatorNode | undefined;
  private humGain: GainNode | undefined;
  private mode: AudioMode = "off";
  private lastChirp = 0;

  async setMode(mode: AudioMode): Promise<boolean> {
    this.mode = mode;

    if (mode === "off") {
      this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.04);
      return true;
    }

    try {
      await this.ensureContext();
      this.setMasterVolume(mode);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  playSpawn(seed: WordSeed): void {
    if (this.mode === "off" || !this.context || !this.master) {
      return;
    }

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pitch = 110 + seed.genome.pitchBase * 420 + seed.features.length * 1.4;

    osc.type = seed.features.punctuationRatio > 0.35 ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(38, pitch * 0.58), now + 0.22);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520 + seed.genome.brightness * 1600, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04 + seed.genome.energy * 0.05, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  updateHum(state: AppState): void {
    if (this.mode === "off" || !this.context || !this.humGain || !this.hum) {
      return;
    }

    const latest = state.seeds.at(-1);
    const density = Math.min(1, state.totalParticles / 12000);
    const energy = latest?.genome.energy ?? 0.2;
    const now = this.context.currentTime;

    this.hum.frequency.setTargetAtTime(44 + energy * 46, now, 0.16);
    this.humGain.gain.setTargetAtTime(0.012 + density * 0.036, now, 0.22);

    if (latest && latest.genome.chirpRate > 0.48 && now - this.lastChirp > 0.7) {
      this.lastChirp = now;
      this.playChirp(latest);
    }
  }

  destroy(): void {
    this.hum?.stop();
    void this.context?.close();
  }

  private async ensureContext(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      this.createHum();
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  private createHum(): void {
    if (!this.context || !this.master) {
      return;
    }

    this.hum = this.context.createOscillator();
    this.humGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();

    this.hum.type = "triangle";
    this.hum.frequency.value = 52;
    this.humGain.gain.value = 0;
    filter.type = "lowpass";
    filter.frequency.value = 240;
    this.hum.connect(filter);
    filter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.hum.start();
  }

  private setMasterVolume(mode: AudioMode): void {
    if (!this.context || !this.master) {
      return;
    }

    const volume = mode === "soft" ? 0.45 : mode === "weird" ? 0.58 : 0.8;
    this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.08);
  }

  private playChirp(seed: WordSeed): void {
    if (!this.context || !this.master) {
      return;
    }

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = this.mode === "weird" ? "square" : "triangle";
    osc.frequency.setValueAtTime(360 + seed.genome.pitchBase * 520, now);
    osc.frequency.exponentialRampToValueAtTime(180 + seed.genome.pitchBase * 460, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}
