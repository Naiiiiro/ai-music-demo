// synthesis_primitives 的單元測試（純計算）：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apply_envelope,
  apply_filter,
  apply_formants,
  create_noise_samples,
  create_oscillator_samples,
  create_silent_samples,
  create_struck_resonance,
  create_voice_source,
  finish_samples,
  golden_spread,
  irregular_swell,
  mix_into,
  percussive_envelope,
  smooth_curve,
} from "../synthesis_primitives.js";

const TEST_SAMPLE_RATE = 8000;
const peak_of = (sample_values) => sample_values.reduce((maximum_value, sample_value) => Math.max(maximum_value, Math.abs(sample_value)), 0);
const root_mean_square = (sample_values) => Math.sqrt(sample_values.reduce((sum_value, sample_value) => sum_value + sample_value * sample_value, 0) / sample_values.length);
const tail_of = (sample_values) => sample_values.subarray(Math.floor(sample_values.length / 2));

test("silent samples have the rounded-up length", () => {
  assert.equal(create_silent_samples(TEST_SAMPLE_RATE, 0.00001).length, 1);
  assert.equal(create_silent_samples(TEST_SAMPLE_RATE, 1).length, TEST_SAMPLE_RATE);
});

test("invalid sample rate or duration is rejected", () => {
  assert.throws(() => create_silent_samples(0, 1), RangeError);
  assert.throws(() => create_silent_samples(TEST_SAMPLE_RATE, 0), RangeError);
});

test("noise is deterministic, bounded, and skip shifts the sequence", () => {
  const first_noise = create_noise_samples(TEST_SAMPLE_RATE, 0.1);
  assert.deepEqual(create_noise_samples(TEST_SAMPLE_RATE, 0.1), first_noise);
  assert.ok(peak_of(first_noise) <= 1);
  assert.deepEqual(create_noise_samples(TEST_SAMPLE_RATE, 0.1, 3).subarray(0, 10), first_noise.subarray(3, 13));
  assert.throws(() => create_noise_samples(TEST_SAMPLE_RATE, 0.1, -1), RangeError);
});

test("sine oscillator crosses zero twice per cycle", () => {
  const sine_samples = create_oscillator_samples(TEST_SAMPLE_RATE, 1, 100);
  let rising_crossings = 0;
  for (let sample_index = 1; sample_index < sine_samples.length; sample_index += 1) {
    if (sine_samples[sample_index - 1] < 0 && sine_samples[sample_index] >= 0) rising_crossings += 1;
  }
  assert.ok(Math.abs(rising_crossings - 100) <= 1, `${rising_crossings} 次上升過零`);
});

test("unknown waveform is rejected", () => {
  assert.throws(() => create_oscillator_samples(TEST_SAMPLE_RATE, 0.1, 100, "noise"), RangeError);
});

test("lowpass keeps low tones and removes high tones", () => {
  const lowpass_settings = { filter_type: "lowpass", frequency: 300 };
  const low_tone = apply_filter(create_oscillator_samples(TEST_SAMPLE_RATE, 0.5, 60), TEST_SAMPLE_RATE, lowpass_settings);
  const high_tone = apply_filter(create_oscillator_samples(TEST_SAMPLE_RATE, 0.5, 3000), TEST_SAMPLE_RATE, lowpass_settings);
  assert.ok(peak_of(tail_of(low_tone)) > 0.9);
  assert.ok(peak_of(tail_of(high_tone)) < 0.05);
});

test("bandpass passes its center frequency at unity gain", () => {
  const center_tone = apply_filter(create_oscillator_samples(TEST_SAMPLE_RATE, 0.5, 1000), TEST_SAMPLE_RATE,
    { filter_type: "bandpass", frequency: 1000, quality_factor: 2 });
  assert.ok(Math.abs(peak_of(tail_of(center_tone)) - 1) < 0.05);
});

test("filter frequency above Nyquist is clamped and stays stable", () => {
  const filtered_noise = apply_filter(create_noise_samples(TEST_SAMPLE_RATE, 0.2), TEST_SAMPLE_RATE, { filter_type: "lowpass", frequency: 20000 });
  assert.ok(filtered_noise.every(Number.isFinite));
  assert.ok(peak_of(filtered_noise) < 4);
});

test("unknown filter type or non-positive quality factor is rejected", () => {
  const input_samples = create_silent_samples(TEST_SAMPLE_RATE, 0.01);
  assert.throws(() => apply_filter(input_samples, TEST_SAMPLE_RATE, { filter_type: "notch", frequency: 100 }), RangeError);
  assert.throws(() => apply_filter(input_samples, TEST_SAMPLE_RATE, { filter_type: "lowpass", frequency: 100, quality_factor: 0 }), RangeError);
});

test("percussive envelope rises, peaks at one and decays by 1/e per decay time", () => {
  const envelope_at_time = percussive_envelope(0.1, 0.5);
  assert.equal(envelope_at_time(-0.1), 0);
  assert.equal(envelope_at_time(0.05), 0.5);
  assert.equal(envelope_at_time(0.1), 1);
  assert.ok(Math.abs(envelope_at_time(0.6) - Math.exp(-1)) < 1e-9);
  assert.throws(() => percussive_envelope(-1, 1), RangeError);
  assert.throws(() => percussive_envelope(0, 0), RangeError);
});

test("smooth curve passes through its points", () => {
  const curve_at_time = smooth_curve([[0, 10], [1, 20]]);
  assert.equal(curve_at_time(0), 10);
  assert.equal(curve_at_time(0.5), 15);
  assert.equal(curve_at_time(2), 20);
  assert.throws(() => smooth_curve([]), RangeError);
});

test("irregular swell stays between zero and one", () => {
  const swell_at_time = irregular_swell([0.3, 0.7, 1.1]);
  for (let time_seconds = 0; time_seconds < 10; time_seconds += 0.01) {
    const swell_value = swell_at_time(time_seconds);
    assert.ok(swell_value >= 0 && swell_value <= 1);
  }
  assert.throws(() => irregular_swell([]), RangeError);
});

test("golden spread stays in [0, 1) and does not repeat early", () => {
  const spread_values = Array.from({ length: 50 }, (_, event_index) => golden_spread(event_index));
  assert.ok(spread_values.every((spread_value) => spread_value >= 0 && spread_value < 1));
  assert.equal(new Set(spread_values.map((spread_value) => spread_value.toFixed(6))).size, 50);
});

test("mix into adds at the offset and drops what falls outside", () => {
  const target_samples = new Float32Array(4);
  mix_into(target_samples, Float32Array.from([1, 1, 1]), 1, 2, 0.5);
  assert.deepEqual(Array.from(target_samples), [0, 0, 0.5, 0.5]);
  mix_into(target_samples, Float32Array.from([1, 2, 3]), 1, -2);
  assert.deepEqual(Array.from(target_samples), [3, 0, 0.5, 0.5]);
});

test("envelope multiplies each sample by its time value", () => {
  const ramped_samples = apply_envelope(Float32Array.from([1, 1, 1, 1]), 4, (elapsed_seconds) => elapsed_seconds);
  assert.deepEqual(Array.from(ramped_samples), [0, 0.25, 0.5, 0.75]);
});

test("struck resonance starts loud and decays", () => {
  const ring_samples = create_struck_resonance(TEST_SAMPLE_RATE, 1, [{ frequency: 440, amplitude: 1, decay_seconds: 0.1 }]);
  assert.ok(root_mean_square(ring_samples.subarray(0, 800)) > 20 * root_mean_square(ring_samples.subarray(7200)));
  assert.throws(() => create_struck_resonance(TEST_SAMPLE_RATE, 1, []), RangeError);
});

test("voice source is silent where loudness is zero and shaped by formants", () => {
  const voice_samples = create_voice_source(TEST_SAMPLE_RATE, 0.5, {
    pitch_at_time: () => 200, loudness_at_time: (elapsed_seconds) => (elapsed_seconds < 0.25 ? 1 : 0), spectral_tilt: 1, breath_level: 0.1 });
  assert.ok(peak_of(voice_samples.subarray(0, 1000)) > 0.5);
  assert.equal(peak_of(voice_samples.subarray(2100)), 0);
  const vowel_samples = apply_formants(voice_samples, TEST_SAMPLE_RATE, [{ frequency: 700, quality_factor: 5, relative_gain: 1 }]);
  assert.equal(vowel_samples.length, voice_samples.length);
});

test("finish samples normalizes the peak and fades both edges", () => {
  const finished_samples = finish_samples(Float32Array.from({ length: 1000 }, () => 2), 1000, 0.5);
  assert.ok(Math.abs(peak_of(finished_samples) - 0.5) < 1e-6);
  assert.equal(finished_samples[0], 0);
  assert.equal(finished_samples[999], 0);
  assert.deepEqual(finish_samples(new Float32Array(10), 1000), new Float32Array(10));
});
