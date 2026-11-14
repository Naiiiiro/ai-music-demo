// effect_signals 的單元測試，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTROL_CURVE_POINTS_PER_SECOND,
  ENGINE_RPM_POINTS,
  MEOW_FORMANT_PATHS,
  MEOW_LOUDNESS_POINTS,
  MEOW_MOUTH_POINTS,
  MEOW_PITCH_POINTS,
  MEOW_SECONDS,
  TRAFFIC_PASSES,
  TRAFFIC_SCENE_SECONDS,
  car_pass_state,
  car_pass_window,
  engine_brightness_frequency,
  generate_engine_pulse_samples,
  generate_meow_source_samples,
  mouth_opening_to_frequency,
  rpm_to_firing_frequency,
  sample_control_curve,
  smooth_interpolate,
  traffic_ambience_level,
} from "../effect_signals.js";

const TEST_SAMPLE_RATE = 8000;
const peak_of = (sample_values) => sample_values.reduce((maximum_value, sample_value) => Math.max(maximum_value, Math.abs(sample_value)), 0);
const end_time_of = (timeline_points) => timeline_points[timeline_points.length - 1].time_seconds;
const assert_close = (actual_value, expected_value, tolerance) => assert.ok(Math.abs(actual_value - expected_value) <= tolerance, `${actual_value} 與 ${expected_value} 差超過 ${tolerance}`);

test("smooth interpolation hits the points, clamps the ends and passes the midpoint", () => {
  const timeline_points = [{ time_seconds: 0, level: 0 }, { time_seconds: 2, level: 10 }];
  assert.equal(smooth_interpolate(timeline_points, -1, "level"), 0);
  assert.equal(smooth_interpolate(timeline_points, 2, "level"), 10);
  assert.equal(smooth_interpolate(timeline_points, 5, "level"), 10);
  assert.equal(smooth_interpolate(timeline_points, 1, "level"), 5);
  assert.ok(smooth_interpolate(timeline_points, 0.2, "level") < 1, "smoothstep 起步比直線慢");
});

test("control curve includes both ends at the configured density", () => {
  const control_curve = sample_control_curve(1, (elapsed_seconds) => elapsed_seconds);
  assert.equal(control_curve.length, CONTROL_CURVE_POINTS_PER_SECOND + 1);
  assert.equal(control_curve[0], 0);
  assert.equal(control_curve[control_curve.length - 1], 1);
  assert.throws(() => sample_control_curve(0, () => 0), RangeError);
});

test("four cylinder engine at 3000 rpm fires at 100 hertz", () => {
  assert.equal(rpm_to_firing_frequency(3000), 100);
  assert.throws(() => rpm_to_firing_frequency(0), RangeError);
});

test("engine timeline moves forward with throttle between zero and one", () => {
  ENGINE_RPM_POINTS.forEach((rpm_point, point_index) => {
    assert.ok(rpm_point.throttle >= 0 && rpm_point.throttle <= 1);
    if (point_index > 0) assert.ok(rpm_point.time_seconds > ENGINE_RPM_POINTS[point_index - 1].time_seconds);
  });
});

test("engine gets brighter with rpm and throttle", () => {
  assert.ok(engine_brightness_frequency(5000, 1) > engine_brightness_frequency(5000, 0));
  assert.ok(engine_brightness_frequency(5000, 0.5) > engine_brightness_frequency(800, 0.5));
});

test("engine pulses fire at the idle firing rate with uneven cylinders", () => {
  const steady_idle = [{ time_seconds: 0, rpm: 900, throttle: 0 }, { time_seconds: 1, rpm: 900, throttle: 0 }];
  const engine_samples = generate_engine_pulse_samples(TEST_SAMPLE_RATE, steady_idle);
  assert.equal(engine_samples.length, TEST_SAMPLE_RATE);
  const pulse_onsets = [];
  for (let sample_index = 1; sample_index < engine_samples.length; sample_index += 1) {
    if (engine_samples[sample_index] - engine_samples[sample_index - 1] > 0.15) pulse_onsets.push(sample_index);
  }
  // 900 rpm 的四缸引擎每秒點火 30 次；時間有 ±4% 的偏移，所以允許一兩次誤差
  assert_close(pulse_onsets.length, 30, 2);
  const pulse_peaks = pulse_onsets.slice(0, 8).map((onset_index) => engine_samples[onset_index]);
  assert.ok(peak_of(pulse_peaks) - Math.min(...pulse_peaks) > 0.05, "各汽缸力道應該不同");
});

test("engine samples are finite, bounded and repeat exactly", () => {
  const engine_samples = generate_engine_pulse_samples(TEST_SAMPLE_RATE);
  assert.equal(engine_samples.length, TEST_SAMPLE_RATE * end_time_of(ENGINE_RPM_POINTS));
  assert.ok(engine_samples.every(Number.isFinite));
  assert.ok(peak_of(engine_samples) <= 1.5);
  assert.deepEqual(engine_samples, generate_engine_pulse_samples(TEST_SAMPLE_RATE));
});

test("every car pass is audible only inside the thirty second scene", () => {
  assert.ok(TRAFFIC_PASSES.length >= 3);
  TRAFFIC_PASSES.forEach((traffic_pass, pass_index) => {
    const { start_seconds, end_seconds } = car_pass_window(traffic_pass);
    assert.ok(start_seconds >= 0 && end_seconds <= TRAFFIC_SCENE_SECONDS);
    assert.ok([1, -1].includes(traffic_pass.direction));
    if (pass_index > 0) assert.ok(traffic_pass.closest_seconds >= TRAFFIC_PASSES[pass_index - 1].closest_seconds);
  });
});

test("car is loudest and centered at the closest point and silent at the window edges", () => {
  const traffic_pass = TRAFFIC_PASSES[0];
  const { start_seconds, end_seconds } = car_pass_window(traffic_pass);
  const closest_state = car_pass_state(traffic_pass, traffic_pass.closest_seconds);
  assert.equal(closest_state.gain, 1);
  assert.equal(closest_state.pan, 0);
  assert.equal(closest_state.pitch_ratio, 1);
  assert_close(car_pass_state(traffic_pass, start_seconds).gain, 0, 1e-9);
  assert_close(car_pass_state(traffic_pass, end_seconds).gain, 0, 1e-9);
  assert.ok(car_pass_state(traffic_pass, traffic_pass.closest_seconds + 2).gain < closest_state.gain / 3, "音量依 1/距離 衰減");
});

test("car moves from one side to the other and doppler falls smoothly through the pass", () => {
  const traffic_pass = TRAFFIC_PASSES[0];
  const approaching_state = car_pass_state(traffic_pass, traffic_pass.closest_seconds - 3);
  const receding_state = car_pass_state(traffic_pass, traffic_pass.closest_seconds + 3);
  assert.ok(approaching_state.pan < 0 && receding_state.pan > 0);
  const speed = traffic_pass.speed_meters_per_second;
  assert.ok(approaching_state.pitch_ratio > 1 && approaching_state.pitch_ratio < 343 / (343 - speed));
  assert.ok(receding_state.pitch_ratio < 1 && receding_state.pitch_ratio > 343 / (343 + speed));
  const pitch_ratios = sample_control_curve(2, (elapsed_seconds) => car_pass_state(traffic_pass, traffic_pass.closest_seconds - 1 + elapsed_seconds).pitch_ratio);
  pitch_ratios.slice(1).forEach((pitch_ratio, ratio_index) => assert.ok(pitch_ratio < pitch_ratios[ratio_index]));
});

test("far car sounds duller than near car", () => {
  const traffic_pass = TRAFFIC_PASSES[0];
  assert.ok(car_pass_state(traffic_pass, traffic_pass.closest_seconds + 4).brightness_frequency < car_pass_state(traffic_pass, traffic_pass.closest_seconds).brightness_frequency);
});

test("car speed at or above speed of sound throws", () => {
  assert.throws(() => car_pass_state({ ...TRAFFIC_PASSES[0], speed_meters_per_second: 343 }, 0), RangeError);
});

test("ambience fades in and out at the scene edges", () => {
  assert.equal(traffic_ambience_level(0), 0);
  assert.equal(traffic_ambience_level(TRAFFIC_SCENE_SECONDS), 0);
  assert.ok(traffic_ambience_level(TRAFFIC_SCENE_SECONDS / 2) > 0.3);
});

test("meow timelines all end together", () => {
  for (const timeline_points of [MEOW_PITCH_POINTS, MEOW_LOUDNESS_POINTS, MEOW_MOUTH_POINTS, ...MEOW_FORMANT_PATHS.map((formant_path) => formant_path.frequency_points)]) {
    assert.equal(end_time_of(timeline_points), MEOW_SECONDS);
  }
});

test("mouth opening widens the low pass", () => {
  assert.ok(mouth_opening_to_frequency(1) > mouth_opening_to_frequency(0));
  assert.equal(mouth_opening_to_frequency(2), mouth_opening_to_frequency(1));
});

test("meow source starts and ends silent, peaks in the middle and repeats exactly", () => {
  const voice_samples = generate_meow_source_samples(TEST_SAMPLE_RATE);
  assert.equal(voice_samples.length, Math.ceil(TEST_SAMPLE_RATE * MEOW_SECONDS));
  assert.ok(voice_samples.every(Number.isFinite));
  assert.equal(voice_samples[0], 0);
  const middle_peak = peak_of(voice_samples.slice(0.2 * TEST_SAMPLE_RATE, 0.4 * TEST_SAMPLE_RATE));
  assert.ok(middle_peak > 0.3 && middle_peak <= 1.5);
  assert.ok(peak_of(voice_samples.slice(-20)) < 0.05);
  assert.deepEqual(voice_samples, generate_meow_source_samples(TEST_SAMPLE_RATE));
});
