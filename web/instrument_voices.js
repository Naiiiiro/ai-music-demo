/**
 * 樂器音色（Web Audio 基礎設施）：每種樂器一個排程函式，集中在 INSTRUMENT_VOICES 註冊表。
 * 新增樂器只要加一筆，不必修改分派邏輯；全部由振盪器、濾波器與現場算出的取樣合成，不載入音訊檔。
 */
import { midi_to_frequency } from "./browser_composer.js";
import { METALLIC_PARTIAL_FREQUENCIES, generate_inharmonic_samples, generate_pluck_samples } from "./signal_generators.js";

const METALLIC_BUFFER_SECONDS = 0.2;
const TONAL_ATTACK_SECONDS = 0.01;
const TONAL_PEAK_GAIN = 0.3;
const SILENT_GAIN = 0.001;
const PAD_ATTACK_SECONDS = 0.4;
const PAD_RELEASE_SECONDS = 0.3;
const PAD_DETUNE_CENTS = 7;
const PAD_FILTER_FREQUENCY = 1200;
const PAD_PEAK_GAIN = 0.25;
const CLAP_BURST_OFFSETS_SECONDS = [0, 0.012, 0.024];
const CLAP_BURST_DECAY_SECONDS = 0.01;
const CLAP_TAIL_SECONDS = 0.18;
const CLAP_FILTER_FREQUENCY = 1500;
const CLAP_PEAK_GAIN = 0.6;
const PLUCK_SECONDS = 1.2;
const PLUCK_PEAK_GAIN = 0.5;
const KICK_START_FREQUENCY = 150;
const KICK_END_FREQUENCY = 45;
const KICK_SWEEP_SECONDS = 0.12;
const KICK_SECONDS = 0.3;
const HAT_SECONDS = 0.05;
// 只留方波疊加的高頻泛音，低頻的嗡嗡聲濾掉，才像鈸而不像和弦
const HAT_FILTER_FREQUENCY = 7000;

const sample_buffer_cache = new Map();

function cached_sample_buffer(audio_context, cache_key, create_samples) {
  const full_cache_key = `${audio_context.sampleRate}:${cache_key}`;
  if (!sample_buffer_cache.has(full_cache_key)) {
    const channel_samples = create_samples(audio_context.sampleRate);
    const sample_buffer = audio_context.createBuffer(1, channel_samples.length, audio_context.sampleRate);
    sample_buffer.getChannelData(0).set(channel_samples);
    sample_buffer_cache.set(full_cache_key, sample_buffer);
  }
  return sample_buffer_cache.get(full_cache_key);
}

function metallic_buffer_for(audio_context) {
  return cached_sample_buffer(audio_context, "metallic", (sample_rate) =>
    generate_inharmonic_samples(sample_rate, METALLIC_BUFFER_SECONDS, METALLIC_PARTIAL_FREQUENCIES));
}

function create_tonal_voice(oscillator_type) {
  return function schedule_tonal_voice(audio_context, output_node, voice_note) {
    const { start_time, duration_seconds, midi_note, velocity } = voice_note;
    const oscillator_node = audio_context.createOscillator();
    const gain_node = audio_context.createGain();
    oscillator_node.type = oscillator_type;
    oscillator_node.frequency.value = midi_to_frequency(midi_note);
    gain_node.gain.setValueAtTime(0, start_time);
    gain_node.gain.linearRampToValueAtTime(velocity * TONAL_PEAK_GAIN, start_time + TONAL_ATTACK_SECONDS);
    gain_node.gain.linearRampToValueAtTime(0, start_time + duration_seconds);
    oscillator_node.connect(gain_node).connect(output_node);
    oscillator_node.start(start_time);
    oscillator_node.stop(start_time + duration_seconds + 0.02);
  };
}

function schedule_pad_voice(audio_context, output_node, voice_note) {
  const { start_time, duration_seconds, midi_note, velocity } = voice_note;
  const end_time = start_time + duration_seconds + PAD_RELEASE_SECONDS;
  const filter_node = audio_context.createBiquadFilter();
  filter_node.type = "lowpass";
  filter_node.frequency.value = PAD_FILTER_FREQUENCY;
  const gain_node = audio_context.createGain();
  gain_node.gain.setValueAtTime(0, start_time);
  gain_node.gain.linearRampToValueAtTime(velocity * PAD_PEAK_GAIN, start_time + PAD_ATTACK_SECONDS);
  gain_node.gain.setValueAtTime(velocity * PAD_PEAK_GAIN, start_time + duration_seconds);
  gain_node.gain.linearRampToValueAtTime(0, end_time);
  filter_node.connect(gain_node).connect(output_node);
  for (const detune_cents of [-PAD_DETUNE_CENTS, PAD_DETUNE_CENTS]) {
    const oscillator_node = audio_context.createOscillator();
    oscillator_node.type = "sawtooth";
    oscillator_node.frequency.value = midi_to_frequency(midi_note);
    oscillator_node.detune.value = detune_cents;
    oscillator_node.connect(filter_node);
    oscillator_node.start(start_time);
    oscillator_node.stop(end_time);
  }
}

function schedule_clap_voice(audio_context, output_node, voice_note) {
  const { start_time, velocity } = voice_note;
  const filter_node = audio_context.createBiquadFilter();
  filter_node.type = "bandpass";
  filter_node.frequency.value = CLAP_FILTER_FREQUENCY;
  const gain_node = audio_context.createGain();
  gain_node.gain.setValueAtTime(0, start_time);
  // 三下極短的金屬聲接連觸發，模擬多隻手掌不同步拍下
  for (const burst_offset of CLAP_BURST_OFFSETS_SECONDS) {
    gain_node.gain.setValueAtTime(velocity * CLAP_PEAK_GAIN, start_time + burst_offset);
    gain_node.gain.exponentialRampToValueAtTime(velocity * CLAP_PEAK_GAIN * 0.2, start_time + burst_offset + CLAP_BURST_DECAY_SECONDS);
  }
  gain_node.gain.exponentialRampToValueAtTime(SILENT_GAIN, start_time + CLAP_TAIL_SECONDS);
  const metallic_source = audio_context.createBufferSource();
  metallic_source.buffer = metallic_buffer_for(audio_context);
  metallic_source.connect(filter_node).connect(gain_node).connect(output_node);
  metallic_source.start(start_time);
  metallic_source.stop(start_time + CLAP_TAIL_SECONDS);
}

function schedule_pluck_voice(audio_context, output_node, voice_note) {
  const { start_time, midi_note, velocity } = voice_note;
  const gain_node = audio_context.createGain();
  gain_node.gain.value = velocity * PLUCK_PEAK_GAIN;
  const pluck_source = audio_context.createBufferSource();
  pluck_source.buffer = cached_sample_buffer(audio_context, `pluck:${midi_note}`, (sample_rate) =>
    generate_pluck_samples(midi_to_frequency(midi_note), sample_rate, PLUCK_SECONDS));
  pluck_source.connect(gain_node).connect(output_node);
  pluck_source.start(start_time);
}

function schedule_kick_voice(audio_context, output_node, voice_note) {
  const { start_time, velocity } = voice_note;
  const oscillator_node = audio_context.createOscillator();
  const gain_node = audio_context.createGain();
  oscillator_node.frequency.setValueAtTime(KICK_START_FREQUENCY, start_time);
  oscillator_node.frequency.exponentialRampToValueAtTime(KICK_END_FREQUENCY, start_time + KICK_SWEEP_SECONDS);
  gain_node.gain.setValueAtTime(velocity * 0.5, start_time);
  gain_node.gain.exponentialRampToValueAtTime(SILENT_GAIN, start_time + KICK_SECONDS);
  oscillator_node.connect(gain_node).connect(output_node);
  oscillator_node.start(start_time);
  oscillator_node.stop(start_time + KICK_SECONDS);
}

function schedule_hat_voice(audio_context, output_node, voice_note) {
  const { start_time, velocity } = voice_note;
  const gain_node = audio_context.createGain();
  gain_node.gain.setValueAtTime(velocity * 0.3, start_time);
  gain_node.gain.exponentialRampToValueAtTime(SILENT_GAIN, start_time + HAT_SECONDS);
  const filter_node = audio_context.createBiquadFilter();
  filter_node.type = "highpass";
  filter_node.frequency.value = HAT_FILTER_FREQUENCY;
  const metallic_source = audio_context.createBufferSource();
  metallic_source.buffer = metallic_buffer_for(audio_context);
  metallic_source.connect(filter_node).connect(gain_node).connect(output_node);
  metallic_source.start(start_time);
  metallic_source.stop(start_time + HAT_SECONDS + 0.01);
}

/**
 * 樂器名稱 → 排程函式。每個函式的簽名都是
 * (audio_context, output_node, {start_time, duration_seconds, midi_note, velocity}) => void，
 * 在 start_time 把一個音排進 audio_context 的時間軸，輸出接到 output_node。
 */
export const INSTRUMENT_VOICES = Object.freeze({
  chord: create_tonal_voice("sine"),
  bass: create_tonal_voice("sine"),
  lead: create_tonal_voice("triangle"),
  pad: schedule_pad_voice,
  pluck: schedule_pluck_voice,
  kick: schedule_kick_voice,
  hat: schedule_hat_voice,
  clap: schedule_clap_voice,
});

/**
 * 依樂器名稱排程一個音。
 * @param {BaseAudioContext} audio_context 即時或離線的 Web Audio context
 * @param {AudioNode} output_node 輸出節點（通常是混音台的樂器通道）
 * @param {string} instrument_name 樂器名稱，必須存在於 INSTRUMENT_VOICES
 * @param {{start_time: number, duration_seconds: number, midi_note: number, velocity: number}} voice_note 音的參數
 */
export function schedule_instrument_note(audio_context, output_node, instrument_name, voice_note) {
  if (!Object.hasOwn(INSTRUMENT_VOICES, instrument_name)) throw new RangeError(`沒有這個樂器的音色：${instrument_name}`);
  INSTRUMENT_VOICES[instrument_name](audio_context, output_node, voice_note);
}
