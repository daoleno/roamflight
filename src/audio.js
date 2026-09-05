export const AUDIO_PRESET = Object.freeze({
  master: 0.7,
  engine: 0.09,
  ambience: 0.2,
  music: 0.55,
  effects: 0.42,
});

export function flightMix({ speed = 0.75, bank = 0, map = false, night = false } = {}) {
  const throttle = Math.max(0, Math.min(2.2, Number.isFinite(speed) ? speed : 0.75));
  return {
    rpm: 48 + throttle * 24,
    engine: map ? 0.012 : 0.09 + throttle * 0.018,
    wind: map ? 0 : 0.004 + throttle * 0.003 + Math.max(0, throttle - 1) * 0.012,
    music: map ? 0.8 : 1,
  };
}

export class FlightAudio {
  constructor({ contextFactory } = {}) {
    this.contextFactory =
      contextFactory ||
      (() => {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error('Web Audio is unavailable in this browser.');
        return new Context({ latencyHint: 'interactive' });
      });
    this.enabled = false;
    this.active = true;
    this.graph = null;
    this.request = 0;
    this.eventCount = 0;
    this.lastEvent = null;
    this.lastChord = -1;
    this.boosting = false;
    this.duckUntil = 0;
    this.voices = new Set();
  }

  async setEnabled(value) {
    const request = ++this.request;
    if (!value) {
      this.enabled = false;
      this.applyMaster();
      return false;
    }
    try {
      if (!this.graph) this.build();
      await this.context.resume();
      if (request !== this.request) return this.enabled;
      if (this.context.state !== 'running')
        throw new Error('Audio was not unlocked by the browser.');
      this.enabled = true;
      this.applyMaster();
      return true;
    } catch (error) {
      if (request === this.request) {
        this.enabled = false;
        this.applyMaster();
      }
      throw error;
    }
  }

  setActivity(active) {
    this.active = !!active;
    this.applyMaster();
  }

  target(param, value, smoothing = 0.12) {
    param.setTargetAtTime(value, this.context.currentTime, smoothing);
  }

  applyMaster() {
    if (this.graph)
      this.target(
        this.graph.master.gain,
        this.enabled && this.active ? AUDIO_PRESET.master : 0,
        this.enabled && this.active ? 0.3 : 0.055,
      );
  }

  build() {
    const c = (this.context = this.contextFactory());
    const gain = (value, destination) => {
      const node = c.createGain();
      node.gain.value = value;
      if (destination) node.connect(destination);
      return node;
    };
    const master = gain(0);
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 10;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.25;
    const analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(c.destination);
    const buses = Object.fromEntries(
      ['engine', 'ambience', 'music', 'effects'].map((name) => [
        name,
        gain(AUDIO_PRESET[name], master),
      ]),
    );
    const oscillators = [];
    const oscillator = (type, frequency, level, destination, pan = 0) => {
      const source = c.createOscillator();
      source.type = type;
      source.frequency.value = frequency;
      const amplitude = gain(level);
      const panner = c.createStereoPanner();
      panner.pan.value = pan;
      source.connect(amplitude);
      amplitude.connect(panner);
      panner.connect(destination);
      source.start();
      oscillators.push(source);
      return { source, amplitude };
    };
    const engineFilter = c.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 330;
    engineFilter.connect(buses.engine);
    const engine = oscillator('sine', 66, 0.1, engineFilter);
    const harmonics = new Float32Array([0, 0.82, 0.12, 0.04, 0.015, 0.005]);
    engine.source.setPeriodicWave(
      c.createPeriodicWave(new Float32Array(harmonics.length), harmonics),
    );
    const mechanical = oscillator('sine', 132, 0.006, engineFilter, 0.06);

    const noiseBuffer = c.createBuffer(2, c.sampleRate * 6, c.sampleRate);
    let seed = 7369;
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const white = (seed >>> 0) / 2147483648 - 1;
        smooth = smooth * 0.965 + white * 0.035;
        data[i] = smooth * 3;
      }
      // Crossfade the loop boundary to avoid an audible seam in continuous wind.
      const fade = Math.floor(c.sampleRate * 0.08);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[data.length - fade + i] = data[data.length - fade + i] * (1 - t) + data[i] * t;
      }
    }
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noise.loopStart = 0.08;
    noise.loopEnd = 6;
    const windFilter = c.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 335;
    windFilter.Q.value = 0.35;
    const wind = gain(0.00625, buses.ambience);
    const windSoftener = c.createBiquadFilter();
    windSoftener.type = 'lowpass';
    windSoftener.frequency.value = 900;
    noise.connect(windFilter);
    windFilter.connect(windSoftener);
    windSoftener.connect(wind);
    noise.start();

    const padFilter = c.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 680;
    const padLevel = gain(1, buses.music);
    padFilter.connect(padLevel);
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.43;
    const wet = gain(0.12, buses.music);
    padFilter.connect(delay);
    delay.connect(wet);
    // Alternate silent banks so harmony changes crossfade instead of pitch-sliding.
    const pads = [0, 1].map(() => {
      const level = gain(0, padFilter);
      const voices = [130.8128, 195.9977, 261.6256, 329.6276].map((frequency, i) => {
        const voice = oscillator('sine', frequency, 0.055, level, (i - 1.5) * 0.4);
        voice.source.detune.value = i % 2 ? 1.5 : -1.5;
        return voice;
      });
      return { level, voices };
    });
    this.graph = {
      master,
      analyser,
      buses,
      engine,
      mechanical,
      engineFilter,
      wind,
      windFilter,
      pads,
      padLevel,
      padFilter,
      noise,
      noiseBuffer,
      oscillators,
    };
    this.samples = new Float32Array(analyser.fftSize);
  }

  update(state) {
    if (!this.graph || !this.enabled || !this.active) return;
    const g = this.graph,
      c = this.context,
      mix = flightMix(state);
    this.target(g.engine.source.frequency, mix.rpm, 0.18);
    this.target(g.mechanical.source.frequency, mix.rpm * 2.015, 0.18);
    const ducking = c.currentTime < this.duckUntil;
    this.target(g.engine.amplitude.gain, mix.engine * (ducking ? 0.8 : 1));
    this.target(g.engineFilter.frequency, 230 + Math.min(2.2, state.speed) * 45);
    this.target(g.wind.gain, mix.wind);
    this.target(g.windFilter.frequency, 260 + Math.min(2.2, state.speed) * 100);
    this.target(
      g.padLevel.gain,
      mix.music * (ducking ? 0.5 : 1) * (0.94 + Math.sin(c.currentTime * 0.16) * 0.06),
      ducking ? 0.08 : 0.65,
    );
    this.target(g.padFilter.frequency, state.night ? 480 : 680, 1.5);
    const chord = Math.floor(c.currentTime / 16) % 4;
    if (chord !== this.lastChord) {
      const notes = [
        [48, 55, 60, 64],
        [45, 52, 60, 64],
        [41, 53, 60, 65],
        [43, 55, 59, 62],
      ][chord];
      const bank = g.pads[chord % 2],
        previous = g.pads[1 - (chord % 2)];
      bank.voices.forEach((voice, i) =>
        voice.source.frequency.setValueAtTime(440 * 2 ** ((notes[i] - 69) / 12), c.currentTime),
      );
      this.target(bank.level.gain, 1, 0.9);
      this.target(previous.level.gain, 0, 0.9);
      this.lastChord = chord;
    }
    if (state.boost && !this.boosting) this.play('boost');
    this.boosting = !!state.boost;
  }

  play(event) {
    if (
      !this.graph ||
      !this.enabled ||
      !this.active ||
      this.context.state !== 'running' ||
      this.voices.size > 24
    )
      return;
    const c = this.context,
      bus = this.graph.buses.effects;
    const voice = (frequency, duration, offset = 0, pan = 0, noise = false) => {
      const start = c.currentTime + offset;
      const source = noise ? c.createBufferSource() : c.createOscillator();
      if (noise) source.buffer = this.graph.noiseBuffer;
      else {
        source.type = 'sine';
        source.frequency.setValueAtTime(frequency, start);
      }
      const filter = c.createBiquadFilter();
      filter.type = noise ? 'bandpass' : 'lowpass';
      filter.frequency.setValueAtTime(noise ? frequency : 3000, start);
      filter.Q.value = 0.5;
      const envelope = c.createGain();
      envelope.gain.setValueAtTime(0, c.currentTime);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(noise ? 0.4 : 0.13, start + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      const stereo = c.createStereoPanner();
      stereo.pan.value = pan;
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(stereo);
      stereo.connect(bus);
      this.voices.add(source);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        envelope.disconnect();
        stereo.disconnect();
        this.voices.delete(source);
      };
      source.start(start);
      source.stop(start + duration + 0.03);
    };
    if (event === 'drop') {
      voice(190, 0.12);
      voice(900, 0.3, 0.04, -0.12, true);
    } else if (event === 'parachute') voice(1400, 0.65, 0, 0.15, true);
    else if (event === 'boost') voice(700, 0.7, 0, 0, true);
    else if (event === 'success')
      [523.25, 659.25, 783.99].forEach((note, i) => voice(note, 0.5, i * 0.14, (i - 1) * 0.18));
    else if (event === 'miss') {
      voice(220, 0.35);
      voice(164.81, 0.45, 0.18);
    } else return;
    this.duckUntil = Math.max(this.duckUntil, c.currentTime + (event === 'success' ? 1.3 : 0.8));
    this.eventCount++;
    this.lastEvent = event;
  }

  inspect() {
    let rms = 0,
      peak = 0;
    if (this.graph) {
      this.graph.analyser.getFloatTimeDomainData(this.samples);
      for (const sample of this.samples) {
        rms += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      rms = Math.sqrt(rms / this.samples.length);
    }
    return {
      enabled: this.enabled,
      active: this.active,
      context: this.context?.state || 'not-created',
      preset: 'quiet-flight-v2',
      mix: { ...AUDIO_PRESET },
      ducking: !!this.context && this.context.currentTime < this.duckUntil,
      chord: this.lastChord,
      musicLevel: this.graph?.padLevel.gain.value ?? 0,
      harmony:
        this.graph?.pads.flatMap((bank) =>
          bank.voices.map((voice) => voice.source.frequency.value),
        ) ?? [],
      rpm: this.graph?.engine.source.frequency.value ?? 0,
      rms,
      peak,
      events: this.eventCount,
      lastEvent: this.lastEvent,
      voices: this.voices.size,
    };
  }

  dispose() {
    this.request++;
    this.enabled = false;
    for (const source of this.voices) {
      try {
        source.stop();
      } catch {}
    }
    this.voices.clear();
    if (this.graph) {
      this.graph.oscillators.forEach((source) => source.stop());
      this.graph.noise.stop();
      this.context.close().catch(() => {});
      this.graph = null;
    }
  }
}
