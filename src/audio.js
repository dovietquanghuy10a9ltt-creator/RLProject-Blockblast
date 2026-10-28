/** Original, synthesized crystal / soft-impact effects. No files or autoplay. */
const MAX_VOICES = 64;
const OUTPUT_HEADROOM = 0.7;
const FADE_TIME = 0.014;
const COOLDOWNS = {
  hover: 0.07, select: 0.065, pickup: 0.08, place: 0.035, clear: 0.08,
  combo: 0.08, drop: 0.09, invalid: 0.09, deal: 0.12,
  newgame: 0.25, gameover: 0.5, record: 0.7, perfect: 0.55,
};

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.volume = 0.7;
    this.paused = false;
    this.context = null;
    this._master = null;
    this._compressor = null;
    this._bus = null;
    this._notes = new Set();
    this._retiredBuses = new Set();
    this._lastPlayed = new Map();
    this._variation = 0;
    this._noiseBuffer = null;
    this._impulseBuffer = null;
    this._disposed = false;
    this._resumePromise = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this._silence();
    this._syncVolume();
  }

  /** Shared output volume, including reverb; zero also clears queued sounds. */
  setVolume(value) {
    let number;
    try { number = Number(value); } catch { return; }
    if (Number.isNaN(number)) return;
    this.volume = Math.max(0, Math.min(1, number));
    if (this.volume === 0) this._silence();
    this._syncVolume();
  }

  /** Silence hidden tabs without changing the user's sound preference. */
  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this._silence();
    this._syncVolume();
  }

  /** Call from a pointer/keyboard event. Repeated calls share one resume. */
  async unlock() {
    if (!this._canSound()) return false;
    try {
      if (!this.context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        const context = new AudioContextClass();
        this.context = context;
        try {
          this._master = context.createGain();
          this._master.gain.value = OUTPUT_HEADROOM * this.volume;
          this._master.connect(context.destination);
          if (typeof context.createDynamicsCompressor === 'function') {
            this._compressor = context.createDynamicsCompressor();
            this._compressor.threshold.value = -16;
            this._compressor.knee.value = 18;
            this._compressor.ratio.value = 3.5;
            this._compressor.attack.value = 0.003;
            this._compressor.release.value = 0.16;
            this._compressor.connect(this._master);
          }
          this._makeBuffers();
        } catch {
          this._disconnect(this._compressor, this._master);
          this.context = null;
          this._master = null;
          this._compressor = null;
          try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Device unavailable. */ }
          return false;
        }
      }
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
        if (!this._resumePromise) {
          this._resumePromise = Promise.resolve(this.context.resume())
            .catch(() => false)
            .finally(() => { this._resumePromise = null; });
        }
        await this._resumePromise;
      }
      return this._canSound() && this.context?.state === 'running';
    } catch {
      return false;
    }
  }

  play(name, intensity = 1) {
    if (!this._canSound() || this.context?.state !== 'running' || !this._master) return;
    if (!Object.hasOwn(COOLDOWNS, name)) return;

    try {
      const now = this.context.currentTime;
      const previous = this._lastPlayed.get(name) ?? -Infinity;
      if (now - previous < COOLDOWNS[name]) return;
      this._lastPlayed.set(name, now);
      const strength = Math.max(1, Math.min(6, Number(intensity) || 1));
      this._ensureBus();
      const time = now + 0.007;
      const pan = Math.sin(++this._variation * 2.4) * 0.24;
      const pitch = [587.33, 659.25, 587.33, 739.99, 659.25][this._variation % 5];

      switch (name) {
        case 'hover':
          this._tone(440 + (this._variation % 3) * 24, time, 0.055, 0.046, { pan });
          this._tone(1174.66, time + 0.002, 0.035, 0.012, { pan: -pan });
          break;
        case 'select':
          this._crystal(587.33, time, 0.15, 0.09, pan);
          this._tone(196, time, 0.055, 0.06, { to: 155, pan });
          break;
        case 'pickup':
          this._noise(time, 0.105, 0.045, { from: 580, to: 1750, pan, attack: 0.035 });
          this._tone(440, time + 0.01, 0.135, 0.085, { to: 587.33, pan, attack: 0.025 });
          this._tone(1174.66, time + 0.055, 0.16, 0.027, { pan: -pan });
          break;
        case 'place':
          this._impact(time, 0.17);
          this._crystal(pitch, time + 0.006, 0.2, 0.12, pan);
          this._noise(time, 0.032, 0.025, { from: 1900, to: 850, pan });
          break;
        case 'clear': {
          this._impact(time, 0.2);
          const lift = 1 + Math.min(strength - 1, 3) * 0.025;
          this._arpeggio([587.33, 739.99, 880, 1174.66].map((note) => note * lift), time + 0.02, 0.043, 0.32, 0.105);
          this._noise(time, 0.17, 0.032, { from: 900, to: 2800, attack: 0.028, pan });
          break;
        }
        case 'combo': {
          this._impact(time, 0.2);
          const notes = [587.33, 739.99, 880, 987.77, 1174.66, 1479.98];
          this._arpeggio(notes.slice(0, Math.min(6, 3 + Math.floor(strength))), time + 0.015, 0.045, 0.36, 0.1);
          this._tone(293.66, time, 0.35, 0.055, { attack: 0.025, pan: -0.12 });
          this._noise(time + 0.025, 0.2, 0.03, { from: 750, to: 3200, attack: 0.04, pan });
          break;
        }
        case 'drop':
        case 'invalid':
          this._tone(164.81, time, 0.14, 0.13, { to: 110, pan });
          this._tone(293.66, time + 0.018, 0.13, 0.035, { pan: -pan });
          this._noise(time, 0.058, 0.037, { from: 650, to: 260, pan });
          break;
        case 'deal':
          [587.33, 659.25, 739.99].forEach((note, index) => {
            const offset = time + index * 0.055;
            this._crystal(note, offset, 0.17, 0.06, (index - 1) * 0.38);
            this._noise(offset, 0.045, 0.022, { from: 1200, to: 600, pan: (index - 1) * 0.38 });
          });
          break;
        case 'record':
          this._tone(293.66, time, 0.56, 0.09, { attack: 0.025, pan: -0.16 });
          this._tone(440, time + 0.015, 0.5, 0.055, { attack: 0.03, pan: 0.18 });
          this._arpeggio([587.33, 880, 1174.66, 1318.51, 1479.98], time + 0.035, 0.085, 0.45, 0.11);
          this._crystal(1760, time + 0.46, 0.45, 0.05, -0.18);
          break;
        case 'perfect':
          this._impact(time, 0.22);
          this._tone(146.83, time, 0.48, 0.09, { attack: 0.02 });
          this._arpeggio([293.66, 440, 587.33, 739.99, 880, 1174.66], time + 0.025, 0.065, 0.48, 0.11);
          this._noise(time + 0.09, 0.3, 0.035, { from: 700, to: 2400, attack: 0.065, pan: 0.22 });
          break;
        case 'gameover':
          [659.25, 587.33, 440, 369.99, 293.66].forEach((note, index) => {
            this._crystal(note, time + index * 0.13, 0.4, 0.075, 0.14 - index * 0.07);
          });
          this._tone(146.83, time + 0.5, 0.43, 0.065, { attack: 0.025 });
          break;
        case 'newgame':
          this._arpeggio([293.66, 440, 587.33, 739.99, 880], time, 0.065, 0.32, 0.1);
          break;
        default:
          break;
      }
    } catch {
      // Device changes or unavailable browser audio must never affect gameplay.
    }
  }

  _canSound() {
    return !this._disposed && this.enabled && !this.paused && this.volume > 0;
  }

  _syncVolume() {
    if (!this._master || !this.context) return;
    try {
      const time = this.context.currentTime;
      this._hold(this._master.gain, time);
      this._master.gain.linearRampToValueAtTime(this._canSound() ? OUTPUT_HEADROOM * this.volume : 0, time + FADE_TIME);
    } catch { /* Context may have closed. */ }
  }

  _makeBuffers() {
    const context = this.context;
    // Deterministic, gently smoothed noise supplies the tiny tactile transients.
    let seed = 0x6d2b79f5;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296 * 2 - 1;
    };
    this._noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.65), context.sampleRate);
    const noise = this._noiseBuffer.getChannelData(0);
    let smooth = 0;
    for (let index = 0; index < noise.length; index++) {
      smooth = smooth * 0.55 + random() * 0.45;
      noise[index] = smooth;
    }
    this._impulseBuffer = context.createBuffer(2, Math.ceil(context.sampleRate * 0.36), context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = this._impulseBuffer.getChannelData(channel);
      let damped = 0;
      for (let index = 0; index < data.length; index++) {
        const seconds = index / context.sampleRate;
        damped = damped * 0.68 + random() * 0.32;
        data[index] = damped * Math.exp(-seconds * 15) * Math.min(1, seconds / 0.008);
      }
      [0.019, 0.037, 0.063].forEach((delay, index) => {
        const offset = Math.floor((delay + channel * 0.003) * context.sampleRate);
        data[offset] += [0.5, 0.28, 0.13][index];
      });
    }
  }

  _ensureBus() {
    if (this._bus) return;
    const context = this.context;
    const nodes = [];
    const make = (node) => { nodes.push(node); return node; };
    try {
      const input = make(context.createGain());
      const dry = make(context.createGain());
      const gate = make(context.createGain());
      dry.gain.value = 0.92;
      input.connect(dry);
      dry.connect(gate);
      gate.connect(this._compressor || this._master);
      // Very old implementations still receive the complete dry effects.
      if (typeof context.createConvolver === 'function' && typeof context.createBiquadFilter === 'function') {
        const reverb = make(context.createConvolver());
        const damping = make(context.createBiquadFilter());
        const wet = make(context.createGain());
        reverb.buffer = this._impulseBuffer;
        damping.type = 'lowpass';
        damping.frequency.value = 3400;
        damping.Q.value = 0.4;
        wet.gain.value = 0.17;
        input.connect(reverb);
        reverb.connect(damping);
        damping.connect(wet);
        wet.connect(gate);
      }
      this._bus = { input, gate, nodes, timer: null };
    } catch (error) {
      this._disconnect(...nodes);
      throw error;
    }
  }

  _arpeggio(notes, time, step, duration, amplitude) {
    notes.forEach((frequency, index) => {
      const pan = notes.length > 1 ? -0.3 + index / (notes.length - 1) * 0.6 : 0;
      this._crystal(frequency, time + index * step, duration, amplitude, pan);
    });
  }

  _crystal(frequency, time, duration, amplitude, pan = 0) {
    this._tone(frequency, time, duration, amplitude, { pan });
    this._tone(frequency * 2.002, time + 0.001, duration * 0.46, amplitude * 0.14, { pan: -pan });
    this._tone(frequency * 2.756, time + 0.002, duration * 0.26, amplitude * 0.035, { pan, attack: 0.005 });
  }

  _impact(time, amplitude) {
    this._tone(118, time, 0.105, amplitude, { to: 61, attack: 0.004 });
    this._tone(236, time, 0.055, amplitude * 0.17, { to: 122, attack: 0.003 });
  }

  _tone(frequency, time, duration, amplitude, { to = frequency, type = 'sine', pan = 0, attack = 0.007 } = {}) {
    if (!this._canSound() || this._notes.size >= MAX_VOICES) return;
    const source = this.context.createOscillator();
    try {
      source.type = type;
      source.frequency.setValueAtTime(frequency, time);
      if (to !== frequency) source.frequency.exponentialRampToValueAtTime(to, time + duration * 0.72);
      this._scheduleVoice(source, source, [], time, duration, amplitude, pan, attack);
    } catch {
      this._disconnect(source);
    }
  }

  _noise(time, duration, amplitude, { from = 1200, to = from, pan = 0, attack = 0.006 } = {}) {
    if (!this._canSound() || this._notes.size >= MAX_VOICES || !this._noiseBuffer) return;
    if (typeof this.context.createBiquadFilter !== 'function') return;
    let source;
    let filter;
    try {
      source = this.context.createBufferSource();
      filter = this.context.createBiquadFilter();
      source.buffer = this._noiseBuffer;
      filter.type = 'bandpass';
      filter.Q.value = 0.68;
      filter.frequency.setValueAtTime(from, time);
      filter.frequency.exponentialRampToValueAtTime(to, time + duration);
      source.connect(filter);
      this._scheduleVoice(source, filter, [filter], time, duration, amplitude, pan, attack);
    } catch {
      this._disconnect(source, filter);
    }
  }

  _scheduleVoice(source, output, additionalNodes, time, duration, amplitude, pan, attack) {
    const context = this.context;
    const nodes = [source, ...additionalNodes];
    let voice;
    try {
      const envelope = context.createGain();
      nodes.push(envelope);
      envelope.gain.setValueAtTime(0, context.currentTime);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(amplitude, time + Math.min(attack, duration * 0.3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      envelope.gain.linearRampToValueAtTime(0, time + duration + 0.012);
      output.connect(envelope);
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        nodes.push(panner);
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        envelope.connect(panner);
        panner.connect(this._bus.input);
      } else {
        envelope.connect(this._bus.input);
      }
      voice = { source, envelope, nodes };
      this._notes.add(voice);
      source.onended = () => {
        this._notes.delete(voice);
        this._disconnect(...nodes);
      };
      source.start(time);
      source.stop(time + duration + 0.018);
    } catch {
      if (voice) this._notes.delete(voice);
      try { source.stop(); } catch { /* Source may not have started. */ }
      this._disconnect(...nodes);
    }
  }

  _hold(parameter, time) {
    if (typeof parameter.cancelAndHoldAtTime === 'function') {
      parameter.cancelAndHoldAtTime(time);
    } else {
      const value = parameter.value;
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(value, time);
    }
  }

  _silence() {
    const time = this.context?.currentTime ?? 0;
    for (const voice of this._notes) {
      try {
        this._hold(voice.envelope.gain, time);
        voice.envelope.gain.linearRampToValueAtTime(0, time + FADE_TIME);
        // Replaces future stop times, including notes that have not begun.
        voice.source.stop(time + FADE_TIME + 0.002);
      } catch {
        this._disconnect(...voice.nodes);
      }
    }
    this._notes.clear();
    this._lastPlayed.clear();

    if (this._bus) {
      const retired = this._bus;
      this._bus = null;
      try {
        this._hold(retired.gate.gain, time);
        retired.gate.gain.linearRampToValueAtTime(0, time + FADE_TIME);
      } catch { /* Context may have closed. */ }
      // A fresh bus on the next play cannot revive the previous reverb tail.
      this._retiredBuses.add(retired);
      retired.timer = setTimeout(() => {
        this._disconnect(...retired.nodes);
        this._retiredBuses.delete(retired);
      }, 40);
    }
  }

  _disconnect(...nodes) {
    for (const node of nodes) {
      try { node?.disconnect(); } catch { /* Safe after device/context shutdown. */ }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._silence();
    for (const retired of this._retiredBuses) {
      clearTimeout(retired.timer);
      this._disconnect(...retired.nodes);
    }
    this._retiredBuses.clear();
    this._disconnect(this._compressor, this._master);
    const context = this.context;
    this.context = null;
    this._master = null;
    this._compressor = null;
    this._resumePromise = null;
    this._noiseBuffer = null;
    this._impulseBuffer = null;
    try {
      if (context && context.state !== 'closed') Promise.resolve(context.close()).catch(() => {});
    } catch { /* Audio cleanup never interrupts the game. */ }
  }
}
