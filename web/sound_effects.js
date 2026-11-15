/**
 * 音效（Web Audio）：汽車引擎、馬路車流、貓叫。與音樂完全分開：自己的 AudioContext、自己的輸出鏈，
 * 不經過 mixing_console。合成版的訊號與控制曲線由 effect_signals 算好，這裡只負責接上濾波器並排進時間軸，
 * 不用亂數，每次播放都一樣。實錄版從同一個網站載入部署時下載的音檔，走同一條輸出鏈。
 * 每個版本播放前都先量出有聲部分的響度，再用 loudness_matching 的增益對齊到同一個目標，比較時才不會被音量差誤導。
 */
import {
  ENGINE_RPM_POINTS,
  MEOW_FORMANT_PATHS,
  MEOW_MOUTH_POINTS,
  MEOW_SECONDS,
  TRAFFIC_PASSES,
  TRAFFIC_SCENE_SECONDS,
  car_pass_state,
  car_pass_window,
  engine_brightness_frequency,
  generate_engine_pulse_samples,
  generate_meow_source_samples,
  mouth_opening_to_frequency,
  sample_control_curve,
  smooth_interpolate,
  traffic_ambience_level,
} from "./effect_signals.js";
import { loudness_matching_gain } from "./loudness_matching.js";
import { generate_noise_samples } from "./signal_generators.js";

const EFFECTS_VOLUME_GAIN = 0.7;
const START_DELAY_SECONDS = 0.05;
const AUTO_STOP_MARGIN_SECONDS = 0.5;

const ENGINE_DC_BLOCK_FREQUENCY = 30;
// 排氣管的兩個共鳴：低頻的「轟」與中頻的「嗡」
const EXHAUST_RESONANCES = Object.freeze([
  { frequency: 140, quality_factor: 1.2, gain_decibels: 9 },
  { frequency: 520, quality_factor: 2, gain_decibels: 5 },
]);
const ENGINE_OUTPUT_GAIN = 0.9;

const NOISE_BUFFER_SECONDS = 5;
const TIRE_NOISE_CENTER_FREQUENCY = 1000;
const TIRE_NOISE_QUALITY_FACTOR = 0.7;
const CAR_PEAK_GAIN = 1.4;
const CAR_ENGINE_FILTER_FREQUENCY = 220;
const CAR_ENGINE_LEVEL = 0.25;
// 每台車從雜訊緩衝的不同位置開始播，各台車的胎噪才不會一模一樣
const CAR_NOISE_OFFSET_STEP_SECONDS = 0.61;
const AMBIENCE_FILTER_FREQUENCY = 300;
const AMBIENCE_GAIN = 0.2;

const MEOW_FORMANT_QUALITY_FACTOR = 4;
const MEOW_DIRECT_LEVEL = 0.45;
const MEOW_OUTPUT_GAIN = 1.2;

function create_filter(audio_context, filter_type, filter_frequency) {
  const filter_node = audio_context.createBiquadFilter();
  filter_node.type = filter_type;
  filter_node.frequency.value = filter_frequency;
  return filter_node;
}

function create_gain(audio_context, gain_value) {
  const gain_node = audio_context.createGain();
  gain_node.gain.value = gain_value;
  return gain_node;
}

function create_buffer_source(audio_context, channel_samples) {
  const sample_buffer = audio_context.createBuffer(1, channel_samples.length, audio_context.sampleRate);
  sample_buffer.getChannelData(0).set(channel_samples);
  const buffer_source = audio_context.createBufferSource();
  buffer_source.buffer = sample_buffer;
  return buffer_source;
}

function apply_control_curve(audio_param, start_time, duration_seconds, value_at_time) {
  audio_param.setValueCurveAtTime(sample_control_curve(duration_seconds, value_at_time), start_time, duration_seconds);
}

function schedule_engine_scene(audio_context, output_node, start_time) {
  const scene_seconds = ENGINE_RPM_POINTS[ENGINE_RPM_POINTS.length - 1].time_seconds;
  const pulse_source = create_buffer_source(audio_context, generate_engine_pulse_samples(audio_context.sampleRate));
  let chain_end = pulse_source.connect(create_filter(audio_context, "highpass", ENGINE_DC_BLOCK_FREQUENCY));
  for (const exhaust_resonance of EXHAUST_RESONANCES) {
    const resonance_filter = create_filter(audio_context, "peaking", exhaust_resonance.frequency);
    resonance_filter.Q.value = exhaust_resonance.quality_factor;
    resonance_filter.gain.value = exhaust_resonance.gain_decibels;
    chain_end = chain_end.connect(resonance_filter);
  }
  const brightness_filter = create_filter(audio_context, "lowpass", engine_brightness_frequency(ENGINE_RPM_POINTS[0].rpm, ENGINE_RPM_POINTS[0].throttle));
  apply_control_curve(brightness_filter.frequency, start_time, scene_seconds, (elapsed_seconds) => engine_brightness_frequency(
    smooth_interpolate(ENGINE_RPM_POINTS, elapsed_seconds, "rpm"), smooth_interpolate(ENGINE_RPM_POINTS, elapsed_seconds, "throttle")));
  chain_end.connect(brightness_filter).connect(create_gain(audio_context, ENGINE_OUTPUT_GAIN)).connect(output_node);
  pulse_source.start(start_time);
  return scene_seconds;
}

function schedule_car_pass(audio_context, output_node, noise_buffer, traffic_pass, pass_index, scene_start_time) {
  const { start_seconds, end_seconds } = car_pass_window(traffic_pass);
  const pass_start_time = scene_start_time + start_seconds;
  const pass_seconds = end_seconds - start_seconds;
  const pass_curve = (read_state) => (elapsed_seconds) => read_state(car_pass_state(traffic_pass, start_seconds + elapsed_seconds));

  const car_gain = create_gain(audio_context, 0);
  apply_control_curve(car_gain.gain, pass_start_time, pass_seconds, pass_curve((pass_state) => CAR_PEAK_GAIN * pass_state.gain));
  const panner_node = audio_context.createStereoPanner();
  apply_control_curve(panner_node.pan, pass_start_time, pass_seconds, pass_curve((pass_state) => pass_state.pan));
  const air_filter = create_filter(audio_context, "lowpass", TIRE_NOISE_CENTER_FREQUENCY);
  apply_control_curve(air_filter.frequency, pass_start_time, pass_seconds, pass_curve((pass_state) => pass_state.brightness_frequency));
  car_gain.connect(air_filter).connect(panner_node).connect(output_node);

  // 胎噪的中心頻率也套都卜勒，車子經過時會聽到「咻——」往下掉
  const tire_noise = audio_context.createBufferSource();
  tire_noise.buffer = noise_buffer;
  tire_noise.loop = true;
  const tire_filter = create_filter(audio_context, "bandpass", TIRE_NOISE_CENTER_FREQUENCY);
  tire_filter.Q.value = TIRE_NOISE_QUALITY_FACTOR;
  apply_control_curve(tire_filter.frequency, pass_start_time, pass_seconds, pass_curve((pass_state) => TIRE_NOISE_CENTER_FREQUENCY * pass_state.pitch_ratio));
  tire_noise.connect(tire_filter).connect(car_gain);

  const engine_oscillator = audio_context.createOscillator();
  engine_oscillator.type = "sawtooth";
  apply_control_curve(engine_oscillator.frequency, pass_start_time, pass_seconds, pass_curve((pass_state) => traffic_pass.engine_frequency * pass_state.pitch_ratio));
  engine_oscillator.connect(create_filter(audio_context, "lowpass", CAR_ENGINE_FILTER_FREQUENCY)).connect(create_gain(audio_context, CAR_ENGINE_LEVEL)).connect(car_gain);

  tire_noise.start(pass_start_time, (pass_index * CAR_NOISE_OFFSET_STEP_SECONDS) % NOISE_BUFFER_SECONDS);
  engine_oscillator.start(pass_start_time);
  for (const sound_source of [tire_noise, engine_oscillator]) sound_source.stop(pass_start_time + pass_seconds);
}

function schedule_traffic_scene(audio_context, output_node, start_time) {
  const noise_samples = generate_noise_samples(audio_context.sampleRate, NOISE_BUFFER_SECONDS);
  const ambience_source = create_buffer_source(audio_context, noise_samples);
  ambience_source.loop = true;
  const ambience_gain = create_gain(audio_context, 0);
  apply_control_curve(ambience_gain.gain, start_time, TRAFFIC_SCENE_SECONDS, (elapsed_seconds) => AMBIENCE_GAIN * traffic_ambience_level(elapsed_seconds));
  ambience_source.connect(create_filter(audio_context, "lowpass", AMBIENCE_FILTER_FREQUENCY)).connect(ambience_gain).connect(output_node);
  ambience_source.start(start_time);
  ambience_source.stop(start_time + TRAFFIC_SCENE_SECONDS);
  TRAFFIC_PASSES.forEach((traffic_pass, pass_index) => {
    schedule_car_pass(audio_context, output_node, ambience_source.buffer, traffic_pass, pass_index, start_time);
  });
  return TRAFFIC_SCENE_SECONDS;
}

function schedule_meow_scene(audio_context, output_node, start_time) {
  const voice_source = create_buffer_source(audio_context, generate_meow_source_samples(audio_context.sampleRate));
  const mouth_filter = create_filter(audio_context, "lowpass", mouth_opening_to_frequency(0));
  apply_control_curve(mouth_filter.frequency, start_time, MEOW_SECONDS,
    (elapsed_seconds) => mouth_opening_to_frequency(smooth_interpolate(MEOW_MOUTH_POINTS, elapsed_seconds, "opening")));
  const meow_output = create_gain(audio_context, MEOW_OUTPUT_GAIN);
  meow_output.connect(output_node);
  voice_source.connect(mouth_filter);
  mouth_filter.connect(create_gain(audio_context, MEOW_DIRECT_LEVEL)).connect(meow_output);
  for (const formant_path of MEOW_FORMANT_PATHS) {
    const formant_filter = create_filter(audio_context, "bandpass", formant_path.frequency_points[0].frequency);
    formant_filter.Q.value = MEOW_FORMANT_QUALITY_FACTOR;
    apply_control_curve(formant_filter.frequency, start_time, MEOW_SECONDS,
      (elapsed_seconds) => smooth_interpolate(formant_path.frequency_points, elapsed_seconds, "frequency"));
    mouth_filter.connect(formant_filter).connect(create_gain(audio_context, formant_path.relative_gain)).connect(meow_output);
  }
  voice_source.start(start_time);
  return MEOW_SECONDS;
}

/**
 * 音效名稱 → 場景排程函式。每個函式的簽名都是 (audio_context, output_node, start_time) => 場景秒數。
 */
export const SOUND_EFFECT_SCENES = Object.freeze({
  engine: schedule_engine_scene,
  traffic: schedule_traffic_scene,
  cat: schedule_meow_scene,
});

/** 各場景的長度（秒）；離線算出整段取樣時，要先知道緩衝區要開多長。 */
export const SOUND_EFFECT_SCENE_SECONDS = Object.freeze({
  engine: ENGINE_RPM_POINTS[ENGINE_RPM_POINTS.length - 1].time_seconds,
  traffic: TRAFFIC_SCENE_SECONDS,
  cat: MEOW_SECONDS,
});

const OFFLINE_RENDER_CHANNEL_COUNT = 2;

/**
 * 開一條音效輸出鏈（自己的 AudioContext → 音量 → 保護用壓縮器），並提供停止與自動停止的控制。
 * @param {() => void} on_finished 播完或被停止時呼叫一次
 */
function open_effect_output(on_finished) {
  const audio_context = new AudioContext();
  const effects_gain = create_gain(audio_context, EFFECTS_VOLUME_GAIN);
  const safety_limiter = audio_context.createDynamicsCompressor();
  effects_gain.connect(safety_limiter).connect(audio_context.destination);
  let is_stopped = false;
  let auto_stop_handle = null;
  function stop_effect() {
    if (is_stopped) return;
    is_stopped = true;
    clearTimeout(auto_stop_handle);
    audio_context.close();
    on_finished();
  }
  return {
    audio_context,
    output_node: effects_gain,
    start_time: () => audio_context.currentTime + START_DELAY_SECONDS,
    stop_effect,
    stop_after: (scene_seconds) => { auto_stop_handle = setTimeout(stop_effect, (scene_seconds + AUTO_STOP_MARGIN_SECONDS) * 1000); },
    is_stopped: () => is_stopped,
  };
}

function buffer_channel_list(audio_buffer) {
  return Array.from({ length: audio_buffer.numberOfChannels }, (_, channel_index) => audio_buffer.getChannelData(channel_index));
}

/** 量出整段的響度、套上對齊增益（再加上 level_offset_decibels）後開始播放，播完自動停止。 */
function play_loudness_matched_buffer(effect_output, audio_buffer, level_offset_decibels = 0) {
  const matching_gain = loudness_matching_gain(buffer_channel_list(audio_buffer), audio_buffer.sampleRate) * 10 ** (level_offset_decibels / 20);
  const buffer_source = effect_output.audio_context.createBufferSource();
  buffer_source.buffer = audio_buffer;
  buffer_source.connect(create_gain(effect_output.audio_context, matching_gain)).connect(effect_output.output_node);
  buffer_source.start(effect_output.start_time());
  effect_output.stop_after(audio_buffer.duration);
}

/** 用 OfflineAudioContext 把合成場景整段算成 AudioBuffer，才能在播放前量響度。 */
function render_scene_buffer(effect_name, sample_rate) {
  const offline_context = new OfflineAudioContext(OFFLINE_RENDER_CHANNEL_COUNT,
    Math.ceil(SOUND_EFFECT_SCENE_SECONDS[effect_name] * sample_rate), sample_rate);
  SOUND_EFFECT_SCENES[effect_name](offline_context, offline_context.destination, 0);
  return offline_context.startRendering();
}

function report_failure(effect_output, on_failed) {
  return (playback_error) => {
    if (effect_output.is_stopped()) return;
    on_failed(playback_error);
    effect_output.stop_effect();
  };
}

/**
 * 播放一段合成音效（先離線算好、對齊音量），播完自動停止。音效有自己的 AudioContext，與音樂播放互不影響。
 * @param {string} effect_name 音效名稱，必須存在於 SOUND_EFFECT_SCENES
 * @param {() => void} on_finished 播完或被停止時呼叫一次
 * @param {(render_error: Error) => void} [on_failed] 離線合成失敗時先呼叫，再呼叫 on_finished
 * @returns {() => void} 提前停止的函式
 */
export function start_sound_effect(effect_name, on_finished, on_failed = console.error) {
  if (!Object.hasOwn(SOUND_EFFECT_SCENES, effect_name)) throw new RangeError(`沒有這個音效：${effect_name}`);
  const effect_output = open_effect_output(on_finished);
  render_scene_buffer(effect_name, effect_output.audio_context.sampleRate)
    .then((audio_buffer) => { if (!effect_output.is_stopped()) play_loudness_matched_buffer(effect_output, audio_buffer); })
    .catch(report_failure(effect_output, on_failed));
  return effect_output.stop_effect;
}

/**
 * 播放一段已算好的合成取樣（例如 scene_sound_catalog 的配方），對齊音量後播放，播完自動停止。
 * 取樣在 AudioContext 建立後依它的取樣率現場計算，所以不需要下載任何音檔。
 * @param {(sample_rate: number) => Float32Array} render_samples 吃取樣率、回傳單聲道取樣的純函式
 * @param {() => void} on_finished 播完或被停止時呼叫一次
 * @param {number} [level_offset_decibels=0] 對齊響度之後再加減的分貝數
 * @returns {() => void} 提前停止的函式
 */
export function start_rendered_effect(render_samples, on_finished, level_offset_decibels = 0) {
  const effect_output = open_effect_output(on_finished);
  const rendered_samples = render_samples(effect_output.audio_context.sampleRate);
  const audio_buffer = effect_output.audio_context.createBuffer(1, rendered_samples.length, effect_output.audio_context.sampleRate);
  audio_buffer.getChannelData(0).set(rendered_samples);
  play_loudness_matched_buffer(effect_output, audio_buffer, level_offset_decibels);
  return effect_output.stop_effect;
}

async function load_audio_buffer(audio_context, recording_url) {
  const http_response = await fetch(recording_url);
  if (!http_response.ok) throw new Error(`載入實錄音檔失敗：${recording_url}（HTTP ${http_response.status}）`);
  return audio_context.decodeAudioData(await http_response.arrayBuffer());
}

/**
 * 播放一段實錄音檔（對齊音量），播完自動停止；載入中按停止會直接結束，不會在之後才突然出聲。
 * @param {string} recording_url 同一個網站上的音檔網址（見 recorded_sound_manifest.recording_file_url）
 * @param {() => void} on_finished 播完、被停止或載入失敗時呼叫一次
 * @param {(load_error: Error) => void} on_failed 載入或解碼失敗時先呼叫，再呼叫 on_finished
 * @returns {() => void} 提前停止的函式
 */
export function start_recorded_effect(recording_url, on_finished, on_failed) {
  const effect_output = open_effect_output(on_finished);
  load_audio_buffer(effect_output.audio_context, recording_url)
    .then((audio_buffer) => { if (!effect_output.is_stopped()) play_loudness_matched_buffer(effect_output, audio_buffer); })
    .catch(report_failure(effect_output, on_failed));
  return effect_output.stop_effect;
}
