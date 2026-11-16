export class RacingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private screechSource: AudioBufferSourceNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private muted = false;
  private initialized = false;

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.28;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Dual-oscillator sport engine synthesis
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 340;
      filter.Q.value = 2.4;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.0;

      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 65;

      const oscB = ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.value = 130;

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);

      oscA.start();
      oscB.start();

      this.engineOscA = oscA;
      this.engineOscB = oscB;
      this.engineFilter = filter;
      this.engineGain = engineGain;

      // Filtered noise buffer for tire drift screech
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const screechFilter = ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1350;
      screechFilter.Q.value = 4.5;

      const screechGain = ctx.createGain();
      screechGain.gain.value = 0;

      noise.connect(screechFilter);
      screechFilter.connect(screechGain);
      screechGain.connect(master);
      noise.start();

      this.screechSource = noise;
      this.screechFilter = screechFilter;
      this.screechGain = screechGain;

      this.initialized = true;
    } catch {
      // AudioContext unavailable or blocked
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.28, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateTelemetry(
    rpmRatio: number,
    throttle: boolean,
    isBoosting: boolean,
    driftIntensity: number,
    active: boolean,
  ): void {
    if (!this.initialized || !this.ctx || !this.engineOscA || !this.engineOscB || !this.engineFilter || !this.engineGain) {
      return;
    }

    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      if (this.screechGain) this.screechGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const baseFreq = 52 + rpmRatio * 145 + (isBoosting ? 28 : 0);
    this.engineOscA.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineOscB.frequency.setTargetAtTime(baseFreq * 1.99, now, 0.04);

    const cutoff = 260 + rpmRatio * 950 + (throttle ? 240 : 0) + (isBoosting ? 500 : 0);
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.05);

    const vol = throttle || isBoosting ? 0.24 : 0.12;
    this.engineGain.gain.setTargetAtTime(vol, now, 0.06);

    if (this.screechGain && this.screechFilter) {
      const screechVol = Math.min(0.18, driftIntensity * 0.2);
      this.screechGain.gain.setTargetAtTime(screechVol, now, 0.04);
      this.screechFilter.frequency.setTargetAtTime(1150 + driftIntensity * 650, now, 0.05);
    }
  }

  public playCountdownBeep(isGo: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.42 : 0.18));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.45 : 0.2));
  }

  public playCollision(intensity: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    const amp = Math.min(0.4, 0.1 + intensity * 0.25);
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public dispose(): void {
    try {
      this.engineOscA?.stop();
      this.engineOscB?.stop();
      this.screechSource?.stop();
      void this.ctx?.close();
    } catch {
      // ignore cleanup errors
    }
    this.initialized = false;
  }
}
