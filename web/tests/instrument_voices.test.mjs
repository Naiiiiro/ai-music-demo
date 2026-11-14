// instrument_voices 的單元測試：用假的 AudioContext 確認每個音色都能排程，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTRUMENT_VOICES, schedule_instrument_note } from "../instrument_voices.js";

function create_fake_audio_param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

function create_fake_audio_context(started_sources) {
  const create_fake_node = () => ({
    gain: create_fake_audio_param(), frequency: create_fake_audio_param(), detune: create_fake_audio_param(), Q: create_fake_audio_param(),
    connect: (target_node) => target_node,
    start() { started_sources.push(this); },
    stop() {},
  });
  return {
    sampleRate: 8000,
    createGain: create_fake_node,
    createOscillator: create_fake_node,
    createBiquadFilter: create_fake_node,
    createBufferSource: create_fake_node,
    createBuffer: (channel_count, frame_count, sample_rate) => {
      const channel_data = new Float32Array(frame_count);
      return { sampleRate: sample_rate, getChannelData: () => channel_data };
    },
  };
}

const SAMPLE_NOTE = Object.freeze({ start_time: 0, duration_seconds: 0.5, midi_note: 64, velocity: 0.5 });

test("every registered voice starts at least one sound source", () => {
  for (const instrument_name of Object.keys(INSTRUMENT_VOICES)) {
    const started_sources = [];
    schedule_instrument_note(create_fake_audio_context(started_sources), {}, instrument_name, SAMPLE_NOTE);
    assert.ok(started_sources.length > 0, instrument_name);
  }
});

test("pad uses two detuned oscillators", () => {
  const started_sources = [];
  schedule_instrument_note(create_fake_audio_context(started_sources), {}, "pad", SAMPLE_NOTE);
  assert.deepEqual(started_sources.map((source_node) => source_node.detune.value).sort((left, right) => left - right), [-7, 7]);
});

test("pluck plays a precomputed sample buffer", () => {
  const started_sources = [];
  schedule_instrument_note(create_fake_audio_context(started_sources), {}, "pluck", SAMPLE_NOTE);
  assert.ok(started_sources[0].buffer.getChannelData(0).some((sample_value) => sample_value !== 0));
});

test("unknown instrument throws", () => {
  assert.throws(() => schedule_instrument_note(create_fake_audio_context([]), {}, "toString", SAMPLE_NOTE), RangeError);
});
