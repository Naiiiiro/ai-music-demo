/**
 * 場景音效配方（純計算）：交通工具與沒有人聲的動作聲（腳步、挖掘、旗子、竹竿）。
 * 每個函式吃取樣率，回傳一段已正規化的單聲道取樣；不用亂數。
 */
import { render_engine_firing } from "./scene_recipes_machinery.js";
import {
  apply_envelope,
  apply_filter,
  apply_filter_chain,
  create_noise_samples,
  create_oscillator_samples,
  create_silent_samples,
  create_struck_resonance,
  finish_samples,
  golden_spread,
  irregular_swell,
  mix_into,
  percussive_envelope,
  smooth_curve,
} from "./synthesis_primitives.js";

const SPEED_OF_SOUND_METERS_PER_SECOND = 343;

function filtered_burst(sample_rate, burst_seconds, decay_seconds, filter_chain, skip_values = 0) {
  return apply_envelope(apply_filter_chain(create_noise_samples(sample_rate, burst_seconds, skip_values), sample_rate, filter_chain),
    sample_rate, percussive_envelope(0.001, decay_seconds));
}

// ── 交通工具 ───────────────────────────────────────────

// 機車從遠處駛近、經過、遠離；實錄（機車駛過）的頻譜從 63 Hz 到 2 kHz 幾乎平坦，沒有明顯的共鳴峰
const SCOOTER_SPEED_METERS_PER_SECOND = 11;
const SCOOTER_PASS_SECONDS = 6.5;
const SCOOTER_LATERAL_METERS = 4;

function scooter_pass_state(elapsed_seconds) {
  const along_road_meters = SCOOTER_SPEED_METERS_PER_SECOND * (elapsed_seconds - SCOOTER_PASS_SECONDS);
  const distance_meters = Math.hypot(along_road_meters, SCOOTER_LATERAL_METERS);
  const approach_speed = -SCOOTER_SPEED_METERS_PER_SECOND * along_road_meters / distance_meters;
  return { distance_gain: SCOOTER_LATERAL_METERS / distance_meters, doppler_ratio: SPEED_OF_SOUND_METERS_PER_SECOND / (SPEED_OF_SOUND_METERS_PER_SECOND - approach_speed) };
}

/** 野狼二行程單缸駛過：從遠處漸漸變大、經過時最響且音高下掉（都卜勒），聲音是寬頻的「嗡——」，沒有尖銳共鳴。 */
export function render_scooter_engine(sample_rate) {
  const scooter_seconds = 9;
  const firing_samples = render_engine_firing(sample_rate, scooter_seconds, {
    firing_hertz: (elapsed_seconds) => 95 * scooter_pass_state(elapsed_seconds).doppler_ratio * (1 + 0.03 * Math.sin(2 * Math.PI * 0.27 * elapsed_seconds)),
    cylinder_balance: [1, 0.85, 0.95, 0.8, 0.9], pulse_decay_seconds: 0.004,
  });
  const exhaust_samples = apply_filter_chain(firing_samples, sample_rate, [
    { filter_type: "highpass", frequency: 50 }, { filter_type: "peaking", frequency: 140, quality_factor: 0.7, gain_decibels: 12 }, { filter_type: "lowpass", frequency: 5000 }]);
  const road_noise = apply_filter(create_noise_samples(sample_rate, scooter_seconds, 3800), sample_rate, { filter_type: "bandpass", frequency: 1500, quality_factor: 0.4 });
  mix_into(exhaust_samples, road_noise, sample_rate, 0, 0.4);
  const engine_rumble = apply_filter(create_noise_samples(sample_rate, scooter_seconds, 4700), sample_rate, { filter_type: "lowpass", frequency: 110 });
  mix_into(exhaust_samples, engine_rumble, sample_rate, 0, 1.5);
  const passing_samples = apply_envelope(exhaust_samples, sample_rate, (elapsed_seconds) => scooter_pass_state(elapsed_seconds).distance_gain);
  return finish_samples(apply_filter(passing_samples, sample_rate,
    { filter_type: "lowpass", frequency: (elapsed_seconds) => 1500 + 9000 * scooter_pass_state(elapsed_seconds).distance_gain }), sample_rate);
}

// 實錄（曳引機發動）：點火頻率約 65 Hz，頻譜在 97、191、258、320、415、514 Hz 有峰，
// 也就是 65 Hz 的整數倍加上半階（四行程每兩轉才點火一次，各缸差異會帶出半階成分）
const TRACTOR_RUNNING_FIRING_HERTZ = 65;
const TRACTOR_CYLINDER_BALANCE = Object.freeze([1, 0.72, 0.9, 0.62]);

/** 鐵牛車柴油引擎：啟動馬達「咕嚕咕嚕」轉幾下後發動，轉速爬上來後穩定運轉，最後稍微降速。 */
export function render_tractor_engine(sample_rate) {
  const tractor_seconds = 8;
  const engine_samples = create_silent_samples(sample_rate, tractor_seconds);
  for (const crank_seconds of [0.15, 0.34, 0.53, 0.72]) {
    mix_into(engine_samples, apply_filter(create_noise_samples(sample_rate, 0.12, 600), sample_rate, { filter_type: "bandpass", frequency: 300, quality_factor: 1 }), sample_rate, crank_seconds, 0.6);
  }
  const firing_rate = smooth_curve([[0, 8], [0.9, 12], [1.6, TRACTOR_RUNNING_FIRING_HERTZ], [5.5, TRACTOR_RUNNING_FIRING_HERTZ], [tractor_seconds, 55]]);
  const running_samples = render_engine_firing(sample_rate, tractor_seconds, { firing_hertz: firing_rate, cylinder_balance: TRACTOR_CYLINDER_BALANCE, pulse_decay_seconds: 0.005 });
  const engine_body = apply_filter_chain(running_samples, sample_rate, [
    { filter_type: "highpass", frequency: 80 }, { filter_type: "peaking", frequency: 260, quality_factor: 0.8, gain_decibels: 9 },
    { filter_type: "lowpass", frequency: 2200 }]);
  mix_into(engine_samples, apply_envelope(engine_body, sample_rate, smooth_curve([[0, 0], [0.8, 0], [1.6, 1], [5.5, 1], [tractor_seconds, 0.55]])), sample_rate, 0);
  return finish_samples(engine_samples, sample_rate);
}

function rail_joint_clicks(sample_rate, duration_seconds, joint_times, click_gain_at_time) {
  const click_samples = create_silent_samples(sample_rate, duration_seconds);
  const wheel_click = create_struck_resonance(sample_rate, 0.12, [{ frequency: 620, amplitude: 1, decay_seconds: 0.02 }, { frequency: 1730, amplitude: 0.6, decay_seconds: 0.012 }]);
  for (const joint_seconds of joint_times) mix_into(click_samples, wheel_click, sample_rate, joint_seconds, click_gain_at_time(joint_seconds));
  return click_samples;
}

function horn_tone(sample_rate, horn_seconds, horn_frequencies, pitch_ratio_at_time) {
  const horn_samples = create_silent_samples(sample_rate, horn_seconds);
  for (const horn_frequency of horn_frequencies) {
    mix_into(horn_samples, create_oscillator_samples(sample_rate, horn_seconds, (elapsed_seconds) => horn_frequency * pitch_ratio_at_time(elapsed_seconds), "sawtooth"), sample_rate, 0);
  }
  const horn_body = apply_filter(horn_samples, sample_rate, { filter_type: "lowpass", frequency: 1800 });
  return apply_envelope(horn_body, sample_rate, (elapsed_seconds) => Math.min(1, elapsed_seconds / 0.08, (horn_seconds - elapsed_seconds) / 0.15));
}

/** 五分車：小柴油機車慢速拖行，窄軌每段鋼軌接縫兩下喀噠，開頭鳴一聲雙音汽笛。 */
export function render_cane_train(sample_rate) {
  const train_seconds = 10;
  const locomotive_samples = apply_filter(render_engine_firing(sample_rate, train_seconds,
    { firing_hertz: () => 18, cylinder_balance: [1, 0.8, 0.9, 0.75, 0.95, 0.85], pulse_decay_seconds: 0.012 }), sample_rate, { filter_type: "lowpass", frequency: 600 });
  const joint_times = [];
  for (let joint_seconds = 0.4; joint_seconds < train_seconds; joint_seconds += 1.6) joint_times.push(joint_seconds, joint_seconds + 0.28);
  mix_into(locomotive_samples, rail_joint_clicks(sample_rate, train_seconds, joint_times, () => 0.6), sample_rate, 0);
  mix_into(locomotive_samples, horn_tone(sample_rate, 1.6, [523, 659], () => 1), sample_rate, 1, 0.35);
  return finish_samples(locomotive_samples, sample_rate);
}

// 臺鐵列車從遠處駛近、經過、遠離：位置 = 速度 × (t − 經過時刻)，與軌道的垂直距離固定
const PASSENGER_TRAIN_SPEED_METERS_PER_SECOND = 25;
const PASSENGER_TRAIN_PASS_SECONDS = 5;
const PASSENGER_TRAIN_LATERAL_METERS = 15;
const PASSENGER_TRAIN_CAR_COUNT = 8;
const PASSENGER_CAR_LENGTH_METERS = 20;

function train_distance(elapsed_seconds) {
  const along_track_meters = PASSENGER_TRAIN_SPEED_METERS_PER_SECOND * (elapsed_seconds - PASSENGER_TRAIN_PASS_SECONDS);
  return Math.hypot(along_track_meters, PASSENGER_TRAIN_LATERAL_METERS);
}

function train_doppler_ratio(elapsed_seconds) {
  const along_track_meters = PASSENGER_TRAIN_SPEED_METERS_PER_SECOND * (elapsed_seconds - PASSENGER_TRAIN_PASS_SECONDS);
  const approach_speed = -PASSENGER_TRAIN_SPEED_METERS_PER_SECOND * along_track_meters / train_distance(elapsed_seconds);
  return SPEED_OF_SOUND_METERS_PER_SECOND / (SPEED_OF_SOUND_METERS_PER_SECOND - approach_speed);
}

/** 臺鐵列車：鳴笛（有都卜勒下滑）、駛近時滾動聲漸大、每節車廂的轉向架壓過接縫「喀噠喀噠」。 */
export function render_passenger_train(sample_rate) {
  const train_seconds = 10;
  const distance_gain = (elapsed_seconds) => PASSENGER_TRAIN_LATERAL_METERS / train_distance(elapsed_seconds);
  const rolling_noise = apply_filter(create_noise_samples(sample_rate, train_seconds, 2500), sample_rate,
    { filter_type: "lowpass", frequency: (elapsed_seconds) => 500 + 2500 * distance_gain(elapsed_seconds) });
  const train_samples = apply_envelope(rolling_noise, sample_rate, distance_gain);
  const joint_times = [];
  const train_length_seconds = (PASSENGER_TRAIN_CAR_COUNT * PASSENGER_CAR_LENGTH_METERS) / PASSENGER_TRAIN_SPEED_METERS_PER_SECOND;
  for (let car_index = 0; car_index < PASSENGER_TRAIN_CAR_COUNT; car_index += 1) {
    const car_seconds = PASSENGER_TRAIN_PASS_SECONDS - train_length_seconds / 2 + (car_index * train_length_seconds) / PASSENGER_TRAIN_CAR_COUNT;
    joint_times.push(car_seconds, car_seconds + 0.1, car_seconds + 0.62, car_seconds + 0.72);
  }
  mix_into(train_samples, rail_joint_clicks(sample_rate, train_seconds, joint_times, distance_gain), sample_rate, 0, 0.9);
  const horn_samples = apply_envelope(horn_tone(sample_rate, 2.2, [311, 370], (elapsed_seconds) => train_doppler_ratio(elapsed_seconds + 3)),
    sample_rate, (elapsed_seconds) => distance_gain(elapsed_seconds + 3));
  mix_into(train_samples, horn_samples, sample_rate, 3, 0.5);
  return finish_samples(train_samples, sample_rate);
}

// 實錄（騎單車）：500 Hz 以下幾乎沒有聲音，能量集中在 1–4 kHz；平常是很小聲的鏈條與胎面沙沙聲，
// 偶爾有車身震動的大聲「喀啦」，鏈條聲有每秒約 4.5 次的規律
const BICYCLE_RATTLE_EVENTS = Object.freeze([[0.15, 1], [1.33, 0.35], [3.57, 0.5], [3.76, 0.3], [4.03, 0.35], [4.37, 0.3], [7.2, 0.45], [9.87, 0.4]]);
const BICYCLE_CHAIN_HERTZ = 4.5;

/** 單車：小聲而持續的鏈條、胎面沙沙聲（偏高頻），偶爾壓過路面接縫時車身「喀啦」一下。 */
export function render_bicycle_ride(sample_rate) {
  const ride_seconds = 11;
  const chain_hiss = apply_filter_chain(create_noise_samples(sample_rate, ride_seconds, 300), sample_rate, [
    { filter_type: "highpass", frequency: 700 }, { filter_type: "peaking", frequency: 1500, quality_factor: 0.5, gain_decibels: 4 }, { filter_type: "lowpass", frequency: 4500 }]);
  const bicycle_samples = apply_envelope(chain_hiss, sample_rate,
    (elapsed_seconds) => 0.06 * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(2 * Math.PI * BICYCLE_CHAIN_HERTZ * elapsed_seconds)) ** 2));
  for (const [rattle_seconds, rattle_gain] of BICYCLE_RATTLE_EVENTS) {
    const frame_rattle = filtered_burst(sample_rate, 0.25, 0.03, [{ filter_type: "highpass", frequency: 800 }, { filter_type: "bandpass", frequency: 1500, quality_factor: 0.8 }],
      Math.round(rattle_seconds * 1000));
    mix_into(bicycle_samples, frame_rattle, sample_rate, rattle_seconds, rattle_gain);
    mix_into(bicycle_samples, frame_rattle, sample_rate, rattle_seconds + 0.045, rattle_gain * 0.4);
  }
  return finish_samples(bicycle_samples, sample_rate);
}

// ── 沒有人聲的動作 ─────────────────────────────────────

// 實錄（石板、水泥地上的腳步）：步伐慢，每 1.0 到 1.4 秒一步；每步很短（約 70 ms 掉 20 dB），能量集中在 250 Hz 一帶
const FOOTSTEP_TIMES_SECONDS = Object.freeze([0.05, 1.03, 2.23, 3.44, 4.82, 6.0]);

function footstep_sound(sample_rate, step_index) {
  const heel_thump = filtered_burst(sample_rate, 0.15, 0.022, [{ filter_type: "lowpass", frequency: 450 }, { filter_type: "peaking", frequency: 250, quality_factor: 1, gain_decibels: 6 }], 40 * step_index);
  const sole_contact = filtered_burst(sample_rate, 0.12, 0.015, [{ filter_type: "bandpass", frequency: 700 + 200 * golden_spread(step_index), quality_factor: 1 }], 77 * step_index);
  return apply_filter(mix_into(heel_thump, sole_contact, sample_rate, 0.012, 0.25), sample_rate, { filter_type: "lowpass", frequency: 2200 });
}

/** 單人腳步：慢步走在硬地上，每一步是腳跟落地的低沉「咚」加一點鞋底接觸聲，步距略不規則。 */
export function render_single_footsteps(sample_rate) {
  const walk_samples = create_silent_samples(sample_rate, 6.5);
  FOOTSTEP_TIMES_SECONDS.forEach((step_seconds, step_index) => {
    mix_into(walk_samples, footstep_sound(sample_rate, step_index), sample_rate, step_seconds, step_index % 2 === 0 ? 1 : 0.85);
  });
  return finish_samples(walk_samples, sample_rate);
}

// 實錄（挖泥巴）：整體偏高頻（2–8 kHz 最強）；平常是很小聲的濕泥沙沙聲（約 -26 dB），
// 鏟子插進泥土時有一下短而亮的「嚓」，約每 1.5 秒一次，接著是泥巴被翻起的黏稠聲
const SHOVEL_STRIKE_TIMES_SECONDS = Object.freeze([0.3, 1.9, 3.4, 4.1, 4.9, 6.0, 7.2, 9.1]);

/** 考古挖掘：鏟子一下下插進濕土的「嚓」，翻土時的黏稠聲，底下是持續的細碎沙沙聲。 */
export function render_excavation_work(sample_rate) {
  const dig_seconds = 10;
  const soil_texture = apply_filter_chain(create_noise_samples(sample_rate, dig_seconds, 2100), sample_rate, [
    { filter_type: "highpass", frequency: 250 }, { filter_type: "peaking", frequency: 3000, quality_factor: 0.5, gain_decibels: 8 }, { filter_type: "lowpass", frequency: 7000 }]);
  const dig_samples = apply_envelope(soil_texture, sample_rate, (elapsed_seconds) => 0.05 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4.6 * elapsed_seconds)));
  const ground_body = apply_filter(create_noise_samples(sample_rate, dig_seconds, 6600), sample_rate, { filter_type: "lowpass", frequency: 500 });
  mix_into(dig_samples, ground_body, sample_rate, 0, 0.08);
  SHOVEL_STRIKE_TIMES_SECONDS.forEach((strike_seconds, strike_index) => {
    const strike_gain = 0.6 + 0.4 * golden_spread(strike_index + 2);
    mix_into(dig_samples, filtered_burst(sample_rate, 0.12, 0.018, [{ filter_type: "highpass", frequency: 400 }, { filter_type: "peaking", frequency: 3000, quality_factor: 0.6, gain_decibels: 8 }], 500 + strike_index * 37), sample_rate, strike_seconds, strike_gain);
    const mud_squelch = apply_envelope(apply_filter(create_noise_samples(sample_rate, 0.35, 900 + strike_index * 53), sample_rate,
      { filter_type: "bandpass", frequency: (elapsed_seconds) => 1400 + 1800 * elapsed_seconds, quality_factor: 2 }), sample_rate, smooth_curve([[0, 0], [0.08, 1], [0.35, 0]]));
    mix_into(dig_samples, mud_squelch, sample_rate, strike_seconds + 0.05, strike_gain * 0.35);
  });
  return finish_samples(dig_samples, sample_rate);
}

/** 旗子拍動：風聲裡夾著布面甩動的「啪啪」，幾個不等速的起伏相乘後取高次方，拍打才會又尖又不規則。 */
export function render_flag_flap(sample_rate) {
  const flag_seconds = 8;
  const flapping_cloth = apply_filter(create_noise_samples(sample_rate, flag_seconds, 3300), sample_rate, { filter_type: "bandpass", frequency: 750, quality_factor: 0.7 });
  const gust_strength = irregular_swell([0.17, 0.29]);
  const snap_pattern = irregular_swell([3.1, 4.7, 7.3], 0.9);
  const flag_samples = apply_envelope(flapping_cloth, sample_rate, (elapsed_seconds) => gust_strength(elapsed_seconds) * snap_pattern(elapsed_seconds) ** 6);
  const wind_bed = apply_filter(create_noise_samples(sample_rate, flag_seconds, 4400), sample_rate, { filter_type: "lowpass", frequency: 300 });
  return finish_samples(mix_into(flag_samples, apply_envelope(wind_bed, sample_rate, gust_strength), sample_rate, 0, 0.25), sample_rate);
}

/** 竹竿摩擦：卡住、滑開反覆發生（stick-slip），一串越來越密的脈衝經過竹管的共鳴，形成「吱——嘎」。 */
export function render_bamboo_creak(sample_rate) {
  const creak_seconds = 6;
  const creak_samples = create_silent_samples(sample_rate, creak_seconds);
  const slip_impulse = filtered_burst(sample_rate, 0.01, 0.0015, [{ filter_type: "highpass", frequency: 400 }], 60);
  for (const [creak_start, creak_length] of [[0.3, 0.9], [1.9, 0.6], [3.2, 1.2], [5, 0.7]]) {
    const slip_rate = smooth_curve([[0, 35], [creak_length * 0.6, 110], [creak_length, 60]]);
    for (let slip_seconds = 0; slip_seconds < creak_length; slip_seconds += 1 / slip_rate(slip_seconds)) {
      mix_into(creak_samples, slip_impulse, sample_rate, creak_start + slip_seconds, 0.6 + 0.4 * golden_spread(Math.round(slip_seconds * 1000)));
    }
  }
  const wood_body = apply_filter_chain(creak_samples, sample_rate, [
    { filter_type: "peaking", frequency: 620, quality_factor: 4, gain_decibels: 14 }, { filter_type: "peaking", frequency: 1450, quality_factor: 5, gain_decibels: 10 }]);
  const breeze = apply_filter(create_noise_samples(sample_rate, creak_seconds, 2700), sample_rate, { filter_type: "lowpass", frequency: 400 });
  return finish_samples(mix_into(wood_body, breeze, sample_rate, 0, 0.08), sample_rate);
}
