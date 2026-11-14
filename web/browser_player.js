/**
 * Web Audio 播放器：即時呼叫 browser_composer 逐小節作曲並合成，經 mixing_console 混音後輸出，不下載任何音訊檔。
 * 另外在 ?benchmark=1 模式用 OfflineAudioContext 離線算出整首曲子，量測瀏覽器端的 CPU 時間。
 */
import { BEATS_PER_BAR, STEPS_PER_BAR, compose_bar } from "./browser_composer.js";
import { schedule_instrument_note } from "./instrument_voices.js";
import { create_mixing_console } from "./mixing_console.js";

const TEMPO_BPM = 110;
const STEP_SECONDS = 60 / TEMPO_BPM / (STEPS_PER_BAR / BEATS_PER_BAR);
const SCHEDULE_AHEAD_SECONDS = 0.5;
const SCHEDULER_INTERVAL_MILLISECONDS = 100;
const BENCHMARK_BAR_COUNT = 32;
const OFFLINE_SAMPLE_RATE = 44100;
const DELAY_STEP_COUNT = 2;

function create_song_mixing_console(audio_context) {
  return create_mixing_console(audio_context, { delay_seconds: STEP_SECONDS * DELAY_STEP_COUNT });
}

function schedule_bar(audio_context, mixing_console, bar_index, bar_start_time) {
  for (const note_event of compose_bar(bar_index)) {
    schedule_instrument_note(audio_context, mixing_console.instrument_input_for(note_event.instrument_name), note_event.instrument_name, {
      start_time: bar_start_time + note_event.step_index * STEP_SECONDS,
      duration_seconds: note_event.length_steps * STEP_SECONDS,
      midi_note: note_event.midi_note,
      velocity: note_event.velocity,
    });
  }
}

/**
 * 開始無限播放：每 100ms 檢查一次，把未來 0.5 秒內要開始的小節排進 Web Audio 時間軸。
 * @returns {() => void} 停止播放的函式
 */
export function start_endless_playback() {
  const audio_context = new AudioContext();
  const mixing_console = create_song_mixing_console(audio_context);
  const bar_seconds = STEP_SECONDS * STEPS_PER_BAR;
  let next_bar_index = 0;
  let next_bar_time = audio_context.currentTime + 0.1;
  const scheduler_handle = setInterval(() => {
    while (next_bar_time < audio_context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      schedule_bar(audio_context, mixing_console, next_bar_index, next_bar_time);
      next_bar_index += 1;
      next_bar_time += bar_seconds;
    }
  }, SCHEDULER_INTERVAL_MILLISECONDS);
  return function stop_playback() {
    clearInterval(scheduler_handle);
    audio_context.close();
  };
}

/**
 * 用 OfflineAudioContext 離線算出 bar_count 小節，並量測作曲排程與合成各花多少時間。
 * @param {number} bar_count 小節數，必須是正整數
 * @returns {Promise<{rendered_buffer: AudioBuffer, compose_milliseconds: number, render_milliseconds: number}>}
 */
async function render_offline_bars(bar_count) {
  if (!Number.isInteger(bar_count) || bar_count <= 0) throw new RangeError(`bar_count 必須是正整數，收到 ${bar_count}`);
  const bar_seconds = STEP_SECONDS * STEPS_PER_BAR;
  const frame_count = Math.ceil(bar_seconds * bar_count * OFFLINE_SAMPLE_RATE);
  const offline_context = new OfflineAudioContext(1, frame_count, OFFLINE_SAMPLE_RATE);
  const compose_start = performance.now();
  const mixing_console = create_song_mixing_console(offline_context);
  for (let bar_index = 0; bar_index < bar_count; bar_index += 1) {
    schedule_bar(offline_context, mixing_console, bar_index, bar_index * bar_seconds);
  }
  const render_start = performance.now();
  const rendered_buffer = await offline_context.startRendering();
  const render_end = performance.now();
  return {
    rendered_buffer,
    compose_milliseconds: render_start - compose_start,
    render_milliseconds: render_end - render_start,
  };
}

/**
 * 離線量測：用 OfflineAudioContext 算出 BENCHMARK_BAR_COUNT 小節，回傳耗時。
 * @returns {Promise<{audio_seconds: number, compose_milliseconds: number, render_milliseconds: number}>}
 */
export async function run_offline_benchmark() {
  const benchmark_result = await render_offline_bars(BENCHMARK_BAR_COUNT);
  return {
    audio_seconds: Number(benchmark_result.rendered_buffer.duration.toFixed(2)),
    compose_milliseconds: Number(benchmark_result.compose_milliseconds.toFixed(1)),
    render_milliseconds: Number(benchmark_result.render_milliseconds.toFixed(1)),
  };
}
