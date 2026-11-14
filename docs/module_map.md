# 模組地圖

依賴方向只能由上往下：入口（命令列、網頁）→ 輸出 → 合成 → 作曲 → 樂理。Python 端沒有輸出層，不寫出任何音訊檔；`recorded_sound_fetcher.py` 只下載 Release 附件，不產生音訊。

| 模組 | 層級 | 主要匯出 | 依賴 |
|---|---|---|---|
| `music_theory.py` | 領域邏輯（最底層） | `build_scale`、`build_triad`、`scale_degree_to_midi`、`midi_to_frequency` | 無 |
| `rhythm_patterns.py` | 領域邏輯（最底層） | `euclidean_rhythm` | 無 |
| `composition_engine.py` | 領域邏輯 | `NoteEvent`、`CompositionSettings`、`compose_piece` | music_theory、rhythm_patterns |
| `audio_renderer.py` | 領域邏輯（合成） | `render_events`、`DEFAULT_SAMPLE_RATE` | composition_engine、music_theory、numpy |
| `resource_benchmark.py` | 命令列入口 | `main`（`benchmark-resources`）、`wave_file_bytes`、`aac_estimated_bytes` | composition_engine、audio_renderer |
| `recorded_sound_manifest.py` | 領域邏輯（純計算） | `RecordedSound`、`RecordedSoundManifest`、`parse_recorded_sound_manifest`、`content_matches_recording`、`ManifestFormatError` | 無 |
| `recorded_sound_fetcher.py` | 命令列入口（下載 Release 附件） | `main`（`fetch-recorded-sounds`）、`fetch_all_recordings`、`download_with_retry`、`RecordingFetchError` | recorded_sound_manifest |
| `web/browser_composer.js` | 領域邏輯（瀏覽器端，純計算） | `compose_bar`、`MELODY_PHRASES`、`euclidean_rhythm` | 無 |
| `web/signal_generators.js` | 領域邏輯（瀏覽器端，純計算） | `generate_inharmonic_samples`、`METALLIC_PARTIAL_FREQUENCIES`、`generate_noise_samples`、`create_noise_register`、`generate_impulse_samples`、`generate_pluck_samples` | 無 |
| `web/effect_signals.js` | 領域邏輯（瀏覽器端，純計算） | `generate_engine_pulse_samples`、`car_pass_state`、`generate_meow_source_samples`、`smooth_interpolate`、`sample_control_curve`、`TRAFFIC_PASSES` | signal_generators |
| `web/recorded_sound_manifest.js` | 領域邏輯（瀏覽器端，純計算） | `parse_recorded_sound_manifest`、`recording_file_url`、`RECORDED_SOUND_MANIFEST_PATH` | 無 |
| `web/instrument_voices.js` | 基礎設施（Web Audio 音色） | `INSTRUMENT_VOICES`、`schedule_instrument_note` | browser_composer（只用 `midi_to_frequency`）、signal_generators |
| `web/mixing_console.js` | 基礎設施（Web Audio 混音） | `create_mixing_console`、`decibels_to_gain`、`INSTRUMENT_SEND_LEVELS` | signal_generators |
| `web/browser_player.js` | 基礎設施（Web Audio 排程） | `start_endless_playback`、`run_offline_benchmark` | browser_composer、instrument_voices、mixing_console |
| `web/sound_effects.js` | 基礎設施（Web Audio 音效，與音樂分開） | `start_sound_effect`、`start_recorded_effect`、`SOUND_EFFECT_SCENES` | effect_signals、signal_generators |
| `web/index.html` | 介面入口 | — | browser_player、sound_effects、recorded_sound_manifest |
| `web/recorded_sounds.json` | 資料（實錄音檔來源清單） | — | 由 recorded_sound_fetcher 與 recorded_sound_manifest.js 讀取 |
