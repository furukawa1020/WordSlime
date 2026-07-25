import type { AudioMode } from "../app/settings";
import type { AppState, WordSeed } from "../app/state";
import type { PerformanceBeatEvent } from "../performance/autoPerformance";

export class AudioEngine {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private recordingDestination: MediaStreamAudioDestinationNode | undefined;
  private performanceBus: GainNode | undefined;
  private hum: OscillatorNode | undefined;
  private humGain: GainNode | undefined;
  private mode: AudioMode = "off";
  private lastChirp = 0;
  private activeVoices = 0;
  private readonly maxVoices = 12;

  async setMode(mode: AudioMode): Promise<boolean> {
    this.mode = mode;

    if (mode === "off") {
      this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.04);
      return true;
    }

    try {
      await this.ensureContext();
      if (this.mode === "off") {
        this.master?.gain.setTargetAtTime(
          0,
          this.context?.currentTime ?? 0,
          0.04,
        );
      } else {
        this.setMasterVolume(this.mode);
      }
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

    if (!this.reserveVoice()) {
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
    osc.addEventListener("ended", () => this.releaseVoice(), { once: true });
    osc.start(now);
    osc.stop(now + 0.32);
  }

  playCollision(seed: WordSeed, otherSeed: WordSeed): void {
    if (this.mode === "off" || !this.context || !this.master) {
      return;
    }

    if (!this.reserveVoice()) {
      return;
    }

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pitch =
      160 +
      (seed.genome.pitchBase + otherSeed.genome.pitchBase) * 160 +
      seed.features.punctuationRatio * 260;

    osc.type = this.mode === "weird" ? "square" : "triangle";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(62, pitch * 0.42), now + 0.11);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(420 + seed.genome.brightness * 900, now);
    filter.Q.setValueAtTime(4.5, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.018 + seed.genome.energy * 0.024, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.addEventListener("ended", () => this.releaseVoice(), { once: true });
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playPerformanceBeat(cue: PerformanceBeatEvent): void {
    if (
      this.mode === "off" ||
      !this.context ||
      !this.performanceBus ||
      !this.reserveVoice()
    ) {
      return;
    }

    const now = this.context.currentTime;
    this.activatePerformanceBus(now);
    const duration = Math.max(0.08, cue.duration);
    const osc = this.context.createOscillator();
    const overtone = cue.accent
      ? this.context.createOscillator()
      : undefined;
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();

    osc.type =
      cue.texture > 0.76
        ? "square"
        : cue.texture > 0.46
          ? "triangle"
          : "sine";
    osc.frequency.setValueAtTime(cue.frequency, now);
    osc.detune.setValueAtTime((cue.texture - 0.5) * 16, now);

    filter.type = cue.texture > 0.68 ? "bandpass" : "lowpass";
    filter.frequency.setValueAtTime(
      420 + cue.frequency * (1.8 + cue.texture * 4.2),
      now,
    );
    filter.Q.setValueAtTime(1.4 + cue.texture * 8, now);
    panner.pan.setValueAtTime(cue.pan, now);

    const peak = 0.012 + cue.intensity * (cue.accent ? 0.052 : 0.032);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      peak,
      now + Math.min(0.028, duration * 0.18),
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + duration,
    );

    osc.connect(filter);
    overtone?.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.performanceBus);
    osc.addEventListener("ended", () => this.releaseVoice(), { once: true });

    if (overtone) {
      overtone.type = cue.texture > 0.5 ? "sawtooth" : "sine";
      overtone.frequency.setValueAtTime(cue.frequency * 2.005, now);
      overtone.detune.setValueAtTime(7 + cue.texture * 9, now);
      overtone.start(now);
      overtone.stop(now + duration);
    }

    osc.start(now);
    osc.stop(now + duration);
  }

  playPerformanceTransition(
    movementIndex: number,
    rootFrequency: number,
    intensity: number,
  ): void {
    if (
      this.mode === "off" ||
      !this.context ||
      !this.performanceBus ||
      !this.reserveVoice()
    ) {
      return;
    }

    const now = this.context.currentTime;
    this.activatePerformanceBus(now);
    const duration = 3.2 + intensity * 2.4;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();

    osc.type = movementIndex % 2 === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(rootFrequency * 0.5, now);
    osc.frequency.exponentialRampToValueAtTime(
      rootFrequency * (movementIndex === 3 ? 2 : 1),
      now + duration * 0.72,
    );
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260 + intensity * 940, now);
    filter.frequency.exponentialRampToValueAtTime(
      680 + intensity * 2100,
      now + duration * 0.68,
    );
    panner.pan.setValueAtTime(movementIndex % 2 === 0 ? -0.42 : 0.42, now);
    panner.pan.linearRampToValueAtTime(
      movementIndex % 2 === 0 ? 0.42 : -0.42,
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.014 + intensity * 0.026,
      now + 0.7,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.performanceBus);
    osc.addEventListener("ended", () => this.releaseVoice(), { once: true });
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  stopPerformance(): void {
    if (!this.context || !this.performanceBus) {
      return;
    }

    const now = this.context.currentTime;
    this.performanceBus.gain.cancelScheduledValues(now);
    this.performanceBus.gain.setTargetAtTime(0.0001, now, 0.025);
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

  getRecordingStream(): MediaStream | undefined {
    if (this.mode === "off") {
      return undefined;
    }

    return this.recordingDestination?.stream;
  }

  destroy(): void {
    this.hum?.stop();
    void this.context?.close();
  }

  private async ensureContext(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.recordingDestination = this.context.createMediaStreamDestination();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      this.master.connect(this.recordingDestination);
      this.createPerformanceBus();
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

  private createPerformanceBus(): void {
    if (!this.context || !this.master) {
      return;
    }

    const bus = this.context.createGain();
    const delay = this.context.createDelay(1);
    const feedback = this.context.createGain();
    const wet = this.context.createGain();
    const wetFilter = this.context.createBiquadFilter();

    bus.gain.value = 0.9;
    delay.delayTime.value = 0.29;
    feedback.gain.value = 0.24;
    wet.gain.value = 0.2;
    wetFilter.type = "lowpass";
    wetFilter.frequency.value = 2100;

    bus.connect(this.master);
    bus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetFilter);
    wetFilter.connect(wet);
    wet.connect(this.master);
    this.performanceBus = bus;
  }

  private setMasterVolume(mode: AudioMode): void {
    if (!this.context || !this.master) {
      return;
    }

    const volume = mode === "soft" ? 0.45 : mode === "weird" ? 0.58 : 0.8;
    this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.08);
  }

  private activatePerformanceBus(now: number): void {
    if (!this.performanceBus) {
      return;
    }

    this.performanceBus.gain.cancelScheduledValues(now);
    this.performanceBus.gain.setTargetAtTime(0.9, now, 0.025);
  }

  private playChirp(seed: WordSeed): void {
    if (!this.context || !this.master) {
      return;
    }

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    if (!this.reserveVoice()) {
      return;
    }

    osc.type = this.mode === "weird" ? "square" : "triangle";
    osc.frequency.setValueAtTime(360 + seed.genome.pitchBase * 520, now);
    osc.frequency.exponentialRampToValueAtTime(180 + seed.genome.pitchBase * 460, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.master);
    osc.addEventListener("ended", () => this.releaseVoice(), { once: true });
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private reserveVoice(): boolean {
    if (this.activeVoices >= this.maxVoices) {
      return false;
    }

    this.activeVoices += 1;
    return true;
  }

  private releaseVoice(): void {
    this.activeVoices = Math.max(0, this.activeVoices - 1);
  }
}
