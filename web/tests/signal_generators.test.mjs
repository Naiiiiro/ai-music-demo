// signal_generators 的單元測試，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  METALLIC_PARTIAL_FREQUENCIES,
  create_noise_register,
  generate_impulse_samples,
  generate_inharmonic_samples,
  generate_noise_samples,
  generate_pluck_samples,
} from "../signal_generators.js";

const peak_of = (sample_slice) => Math.max(...Array.from(sample_slice, Math.abs));

test("inharmonic samples stay within plus minus one and are not silent", () => {
  const metallic_samples = generate_inharmonic_samples(8000, 0.1, METALLIC_PARTIAL_FREQUENCIES);
  assert.equal(metallic_samples.length, 800);
  assert.ok(peak_of(metallic_samples) <= 1);
  assert.ok(peak_of(metallic_samples) > 0.5);
});

test("inharmonic samples repeat exactly on every call", () => {
  assert.deepEqual(generate_inharmonic_samples(8000, 0.1, METALLIC_PARTIAL_FREQUENCIES), generate_inharmonic_samples(8000, 0.1, METALLIC_PARTIAL_FREQUENCIES));
});

test("inharmonic samples of zero length are empty", () => {
  assert.equal(generate_inharmonic_samples(8000, 0, METALLIC_PARTIAL_FREQUENCIES).length, 0);
});

test("inharmonic samples invalid input throws", () => {
  assert.throws(() => generate_inharmonic_samples(0, 1, METALLIC_PARTIAL_FREQUENCIES), RangeError);
  assert.throws(() => generate_inharmonic_samples(8000, -1, METALLIC_PARTIAL_FREQUENCIES), RangeError);
  assert.throws(() => generate_inharmonic_samples(8000, 1, []), RangeError);
  assert.throws(() => generate_inharmonic_samples(8000, 1, [0]), RangeError);
});

test("impulse length follows decay time and repeats on every call", () => {
  const first_impulse = generate_impulse_samples(8000, 0.5);
  assert.equal(first_impulse.length, 4000);
  assert.deepEqual(first_impulse, generate_impulse_samples(8000, 0.5));
});

test("impulse decays to about minus sixty decibels at the end", () => {
  const impulse_samples = generate_impulse_samples(8000, 1);
  assert.ok(peak_of(impulse_samples.subarray(0, 400)) > 0.5);
  assert.ok(peak_of(impulse_samples.subarray(7600)) < 0.0015);
});

test("impulse invalid input throws", () => {
  assert.throws(() => generate_impulse_samples(0, 1), RangeError);
  assert.throws(() => generate_impulse_samples(8000, 0), RangeError);
});

test("pluck repeats with the period of its frequency", () => {
  const pluck_samples = generate_pluck_samples(400, 8000, 0.5);
  // 400 Hz @ 8000 Hz → 週期 20 個取樣；第二圈是第一圈相鄰平均，形狀高度相關
  const first_cycle = pluck_samples.subarray(0, 20);
  const second_cycle = pluck_samples.subarray(20, 40);
  const correlation = first_cycle.reduce((sum_value, sample_value, sample_index) => sum_value + sample_value * second_cycle[sample_index], 0);
  assert.ok(correlation > 0);
});

test("pluck fades out over time", () => {
  const pluck_samples = generate_pluck_samples(220, 8000, 1);
  assert.ok(peak_of(pluck_samples.subarray(7000)) < peak_of(pluck_samples.subarray(0, 1000)) * 0.5);
});

test("pluck invalid input throws", () => {
  assert.throws(() => generate_pluck_samples(0, 8000, 1), RangeError);
  assert.throws(() => generate_pluck_samples(5000, 8000, 1), RangeError);
  assert.throws(() => generate_pluck_samples(220, 8000, 0), RangeError);
});

test("noise samples are bounded, centered, broadband and repeat exactly", () => {
  const noise_samples = generate_noise_samples(8000, 1);
  assert.equal(noise_samples.length, 8000);
  assert.ok(peak_of(noise_samples) <= 1);
  const mean_value = noise_samples.reduce((sum_value, sample_value) => sum_value + sample_value, 0) / noise_samples.length;
  assert.ok(Math.abs(mean_value) < 0.05);
  // 白噪音相鄰取樣幾乎不相關；有明確音高的訊號相關係數會接近 1
  const neighbor_correlation = noise_samples.slice(1).reduce((sum_value, sample_value, sample_index) => sum_value + sample_value * noise_samples[sample_index], 0)
    / noise_samples.reduce((sum_value, sample_value) => sum_value + sample_value * sample_value, 0);
  assert.ok(Math.abs(neighbor_correlation) < 0.1);
  assert.deepEqual(noise_samples, generate_noise_samples(8000, 1));
});

test("noise register restarts from the same state", () => {
  const first_register = create_noise_register();
  const second_register = create_noise_register();
  const first_values = Array.from({ length: 50 }, () => first_register());
  assert.deepEqual(first_values, Array.from({ length: 50 }, () => second_register()));
  assert.ok(new Set(first_values).size > 3);
});

test("noise invalid input throws", () => {
  assert.throws(() => generate_noise_samples(0, 1), RangeError);
  assert.throws(() => generate_noise_samples(8000, 0), RangeError);
});
