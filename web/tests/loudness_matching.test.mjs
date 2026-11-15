// loudness_matching 的單元測試（純計算）：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAXIMUM_MATCHING_GAIN, TARGET_LOUDNESS_RMS, loudness_matching_gain, measure_gated_loudness } from "../loudness_matching.js";

const TEST_SAMPLE_RATE = 1000;
const constant_samples = (sample_count, sample_value) => new Float32Array(sample_count).fill(sample_value);
const assert_close = (actual_value, expected_value) => assert.ok(Math.abs(actual_value - expected_value) < 1e-6, `${actual_value} ≠ ${expected_value}`);

test("steady signal loudness equals its RMS", () => {
  assert_close(measure_gated_loudness([constant_samples(1000, 0.5)], TEST_SAMPLE_RATE), 0.5);
});

test("silence between bursts does not lower the measured loudness", () => {
  const burst_with_silence = new Float32Array(10000);
  burst_with_silence.fill(0.5, 0, 500);
  assert_close(measure_gated_loudness([burst_with_silence], TEST_SAMPLE_RATE), 0.5);
});

test("quiet background more than 10 dB below the average is gated out", () => {
  const loud_and_quiet = new Float32Array(2000);
  loud_and_quiet.fill(0.5, 0, 1000);
  loud_and_quiet.fill(0.01, 1000);
  assert_close(measure_gated_loudness([loud_and_quiet], TEST_SAMPLE_RATE), 0.5);
});

test("stereo loudness averages both channels", () => {
  const measured_loudness = measure_gated_loudness([constant_samples(1000, 0.4), constant_samples(1000, 0.4)], TEST_SAMPLE_RATE);
  assert_close(measured_loudness, 0.4);
});

test("matching gain brings loud and quiet clips to the same loudness", () => {
  for (const sample_value of [0.05, 0.3, 0.9]) {
    const clip_samples = constant_samples(1000, sample_value);
    const matched_loudness = loudness_matching_gain([clip_samples], TEST_SAMPLE_RATE) * measure_gated_loudness([clip_samples], TEST_SAMPLE_RATE);
    assert_close(matched_loudness, TARGET_LOUDNESS_RMS);
  }
});

test("matching gain is capped and silence is left alone", () => {
  assert.equal(loudness_matching_gain([constant_samples(1000, 0.001)], TEST_SAMPLE_RATE), MAXIMUM_MATCHING_GAIN);
  assert.equal(loudness_matching_gain([new Float32Array(1000)], TEST_SAMPLE_RATE), 1);
  assert.equal(loudness_matching_gain([new Float32Array(0)], TEST_SAMPLE_RATE), 1);
});

test("invalid inputs are rejected", () => {
  assert.throws(() => measure_gated_loudness([], TEST_SAMPLE_RATE), RangeError);
  assert.throws(() => measure_gated_loudness([new Float32Array(2), new Float32Array(3)], TEST_SAMPLE_RATE), RangeError);
  assert.throws(() => measure_gated_loudness([new Float32Array(2)], 0), RangeError);
});
