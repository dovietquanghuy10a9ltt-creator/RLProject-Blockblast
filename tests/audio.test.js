import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

// A scheduling/connection fake: these tests cover lifecycle and routing, not timbre.
class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); this.value = value; }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); this.value = value; }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0, 'exponential targets must stay positive');
    this.events.push({ type: 'exponential', value, time }); this.value = value;
  }
  cancelScheduledValues(time) { this.events = this.events.filter((event) => event.time < time); }
  cancelAndHoldAtTime(time) { this.cancelScheduledValues(time); this.events.push({ type: 'hold', value: this.value, time }); }
}

class AudioNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.disconnected = false; }
  connect(node) { assert.ok(node); this.connections.push(node); return node; }
  disconnect() { this.connections = []; this.disconnected = true; }
}

class Source extends AudioNode {
  constructor(context, kind) {
    super(context, kind);
    this.frequency = new Parameter();
    this.starts = [];
    this.stops = [];
    this.ended = false;
  }
  start(time) { this.starts.push(time); }
  stop(time = this.context.currentTime) { this.stops.push(time); }
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class FakeContext {
  constructor(options = {}) {
    this.options = options;
    this.state = options.state || 'running';
    this.currentTime = 10;
    this.sampleRate = 8000;
    this.nodes = [];
    this.sources = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.destination = this.node('destination');
    if (options.noStereo) this.createStereoPanner = undefined;
    if (options.noReverb) this.createConvolver = undefined;
    if (options.noCompressor) this.createDynamicsCompressor = undefined;
  }
  node(kind) { const node = new AudioNode(this, kind); this.nodes.push(node); return node; }
  createGain() { const node = this.node('gain'); node.gain = new Parameter(1); return node; }
  createStereoPanner() { const node = this.node('panner'); node.pan = new Parameter(); return node; }
  createBiquadFilter() { const node = this.node('filter'); node.frequency = new Parameter(); node.Q = new Parameter(); return node; }
  createConvolver() { return this.node('convolver'); }
  createDynamicsCompressor() {
    const node = this.node('compressor');
    for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[name] = new Parameter();
    return node;
  }
  createOscillator() { return this.source('oscillator'); }
  createBufferSource() { return this.source('buffer-source'); }
  source(kind) { const source = new Source(this, kind); this.sources.push(source); this.nodes.push(source); return source; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: (index) => data[index] };
  }
  resume() {
    this.resumeCalls++;
    if (this.options.rejectResume) return Promise.reject(new Error('Audio blocked'));
    if (this.options.pendingResume) {
      return new Promise((resolve) => { this.finishResume = () => { this.state = 'running'; resolve(); }; });
    }
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (source.stops.length && source.stops.at(-1) <= this.currentTime) source.finish();
    }
  }
}

function installContext(t, options = {}) {
  const originals = ['AudioContext', 'webkitAudioContext'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const instances = [];
  class InstalledContext extends FakeContext {
    constructor() {
      if (options.rejectConstruction) throw new Error('No audio device');
      super(options);
      instances.push(this);
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, writable: true, value: options.unsupported ? undefined : InstalledContext });
  Object.defineProperty(globalThis, 'webkitAudioContext', { configurable: true, writable: true, value: undefined });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return instances;
}

function hasPath(from, destination, omitted = null, visited = new Set()) {
  if (from === omitted || visited.has(from)) return false;
  if (from === destination) return true;
  visited.add(from);
  return from.connections.some((next) => hasPath(next, destination, omitted, visited));
}

test('audio stays lazy through play, settings, pause and mute until a permitted unlock', async (t) => {
  const instances = installContext(t);
  const audio = new GameAudio();
  t.after(() => audio.dispose());
  audio.play('newgame');
  audio.setVolume(0.45);
  audio.setPaused(true);
  assert.equal(await audio.unlock(), false);
  audio.setPaused(false);
  audio.setEnabled(false);
  assert.equal(await audio.unlock(), false);
  audio.setEnabled(true);
  assert.equal(instances.length, 0);
  assert.equal(await audio.unlock(), true);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].sources.length, 0, 'unlock must not itself play any sound');
});

test('unsupported and rejected audio is harmless', async (t) => {
  for (const options of [{ unsupported: true }, { rejectConstruction: true }, { state: 'suspended', rejectResume: true }]) {
    await t.test(JSON.stringify(options), async (child) => {
      installContext(child, options);
      const audio = new GameAudio();
      assert.equal(await audio.unlock(), false);
      assert.doesNotThrow(() => audio.play('place'));
      assert.doesNotThrow(() => audio.dispose());
    });
  }
});

test('concurrent unlocks share resume, and disposal during resume cannot reactivate audio', async (t) => {
  const instances = installContext(t, { state: 'suspended', pendingResume: true });
  const audio = new GameAudio();
  const first = audio.unlock();
  const second = audio.unlock();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].resumeCalls, 1);
  audio.dispose();
  instances[0].finishResume();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(await audio.unlock(), false);
  audio.play('place');
  audio.dispose();
  assert.equal(instances[0].closeCalls, 1);
  assert.equal(instances[0].sources.length, 0);
});

test('every effect schedules bounded finite voices and disconnects them after completion', async (t) => {
  const instances = installContext(t);
  const audio = new GameAudio();
  t.after(() => audio.dispose());
  await audio.unlock();
  const context = instances[0];
  for (const name of ['select', 'pickup', 'hover', 'place', 'clear', 'combo', 'invalid', 'drop', 'deal', 'record', 'perfect', 'newgame', 'gameover']) {
    const before = context.sources.length;
    audio.play(name, 6);
    const sources = context.sources.slice(before);
    assert.ok(sources.length > 0, `${name} should schedule a sound`);
    assert.ok(sources.length <= 64);
    for (const source of sources) {
      assert.ok(source.starts[0] >= context.currentTime);
      assert.ok(source.stops[0] > source.starts[0]);
      assert.ok(source.stops[0] < context.currentTime + 1.5, `${name} remains a short effect`);
      assert.ok(hasPath(source, context.destination));
    }
    context.advance(2);
    assert.ok(sources.every((source) => source.disconnected));
    assert.equal(audio._notes.size, 0);
  }
  const count = context.sources.length;
  audio.play('unknown-effect');
  assert.equal(context.sources.length, count);
});

test('volume controls both dry and reverb paths with headroom and clamped values', async (t) => {
  const instances = installContext(t);
  const audio = new GameAudio();
  t.after(() => audio.dispose());
  await audio.unlock();
  audio.play('place');
  const context = instances[0];
  const reverb = context.nodes.find((node) => node.kind === 'convolver');
  assert.ok(reverb && hasPath(reverb, context.destination));
  for (const source of context.sources) {
    assert.equal(hasPath(source, context.destination, audio._master), false, 'no dry/wet route bypasses shared volume');
  }
  audio.setVolume(0.25);
  assert.equal(audio._master.gain.events.at(-1).value, 0.175);
  audio.setVolume(5);
  assert.equal(audio.volume, 1);
  assert.ok(audio._master.gain.events.at(-1).value < 1);
  audio.setVolume(NaN);
  assert.equal(audio.volume, 1);
  assert.doesNotThrow(() => audio.setVolume(Symbol('invalid')));
});

test('mute, pause and zero volume cancel future notes and do not revive previous reverb tails', async (t) => {
  for (const kind of ['mute', 'pause', 'zero']) {
    await t.test(kind, async (child) => {
      const instances = installContext(child);
      const audio = new GameAudio();
      child.after(() => audio.dispose());
      await audio.unlock();
      const context = instances[0];
      audio.play('record');
      const queued = context.sources.filter((source) => source.starts[0] > context.currentTime + 0.1);
      assert.ok(queued.length > 0);
      const previousBus = audio._bus;
      const pause = (enabled) => kind === 'mute' ? audio.setEnabled(!enabled) : kind === 'pause' ? audio.setPaused(enabled) : audio.setVolume(enabled ? 0 : 0.7);
      pause(true);
      assert.equal(audio._notes.size, 0);
      assert.equal(audio._master.gain.events.at(-1).value, 0);
      assert.equal(previousBus.gate.gain.events.at(-1).value, 0);
      assert.ok(queued.every((source) => source.stops.at(-1) < source.starts[0]), 'future notes are stopped before starting');
      const count = context.sources.length;
      audio.play('place');
      assert.equal(context.sources.length, count);
      pause(false);
      assert.equal(context.sources.length, count, 'restoring sound does not replay any effect');
      audio.play('place');
      assert.notEqual(audio._bus, previousBus);
      await new Promise((resolve) => setTimeout(resolve, 55));
      assert.ok(previousBus.nodes.every((node) => node.disconnected));
    });
  }
});

test('hover is throttled and rapid celebrations respect the concurrent voice cap', async (t) => {
  const instances = installContext(t);
  const audio = new GameAudio();
  t.after(() => audio.dispose());
  await audio.unlock();
  const context = instances[0];
  audio.play('hover');
  const count = context.sources.length;
  for (let index = 0; index < 100; index++) audio.play('hover');
  assert.equal(context.sources.length, count);
  context.currentTime += 0.08;
  audio.play('hover');
  assert.ok(context.sources.length > count);
  for (let index = 0; index < 100; index++) {
    context.currentTime += 0.09;
    audio.play('combo', 6);
  }
  assert.ok(audio._notes.size <= 64);
  assert.ok(context.sources.length <= 64, 'sources are capped even before ended events are delivered');
});

test('basic sound still works without stereo, reverb or a compressor', async (t) => {
  const instances = installContext(t, { noStereo: true, noReverb: true, noCompressor: true });
  const audio = new GameAudio();
  t.after(() => audio.dispose());
  assert.equal(await audio.unlock(), true);
  audio.play('clear');
  const context = instances[0];
  assert.ok(context.sources.length > 0);
  assert.ok(context.sources.every((source) => hasPath(source, context.destination)));
});
