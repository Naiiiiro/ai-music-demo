"""音訊合成：把音符事件算成單聲道浮點取樣（不用任何取樣音色，全部由數學波形合成）。"""

import numpy as np
import numpy.typing as npt

from ai_music_demo.composition_engine import NoteEvent
from ai_music_demo.music_theory import midi_to_frequency

DEFAULT_SAMPLE_RATE: int = 44_100
ATTACK_SECONDS: float = 0.01
RELEASE_SECONDS: float = 0.08
KICK_START_FREQUENCY: float = 150.0
KICK_END_FREQUENCY: float = 45.0
KICK_DECAY_RATE: float = 12.0
HAT_DECAY_RATE: float = 60.0
PEAK_HEADROOM: float = 0.9
# TR-808 腳踏鈸的六個方波頻率（Hz），與網頁版 METALLIC_PARTIAL_FREQUENCIES 相同；彼此不成整數倍，聽起來像金屬
METALLIC_PARTIAL_FREQUENCIES: tuple[float, ...] = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)

float_samples_type = npt.NDArray[np.float32]


def envelope_shape(sample_count: int, sample_rate: int) -> float_samples_type:
    """回傳簡化的 ADSR 包絡（線性起音、線性收尾），避免喀喀聲。"""
    envelope_values = np.ones(sample_count, dtype=np.float32)
    attack_count = min(int(ATTACK_SECONDS * sample_rate), sample_count)
    release_count = min(int(RELEASE_SECONDS * sample_rate), sample_count - attack_count)
    envelope_values[:attack_count] = np.linspace(0, 1, attack_count, dtype=np.float32)
    if release_count > 0:
        envelope_values[-release_count:] *= np.linspace(1, 0, release_count, dtype=np.float32)
    return envelope_values


def tonal_voice(note_event: NoteEvent, sample_rate: int) -> float_samples_type:
    """合成有音高的聲部：基頻正弦波加上兩個泛音，貝斯泛音較少。"""
    sample_count = int(note_event.duration_seconds * sample_rate)
    time_axis = np.arange(sample_count, dtype=np.float32) / sample_rate
    phase_angle = 2 * np.pi * midi_to_frequency(note_event.midi_note) * time_axis
    harmonic_weight = 0.1 if note_event.instrument_name == "bass" else 0.3
    waveform = np.sin(phase_angle) + harmonic_weight * np.sin(2 * phase_angle) + harmonic_weight / 2 * np.sin(3 * phase_angle)
    return (waveform * envelope_shape(sample_count, sample_rate)).astype(np.float32)


def kick_voice(note_event: NoteEvent, sample_rate: int) -> float_samples_type:
    """合成大鼓：頻率由高往低滑落的正弦波，加指數衰減。"""
    sample_count = int(max(note_event.duration_seconds, 0.25) * sample_rate)
    time_axis = np.arange(sample_count, dtype=np.float32) / sample_rate
    sweep_frequency = KICK_END_FREQUENCY + (KICK_START_FREQUENCY - KICK_END_FREQUENCY) * np.exp(-30 * time_axis)
    phase_angle = 2 * np.pi * np.cumsum(sweep_frequency) / sample_rate
    return (np.sin(phase_angle) * np.exp(-KICK_DECAY_RATE * time_axis)).astype(np.float32)


def hat_voice(note_event: NoteEvent, sample_rate: int) -> float_samples_type:
    """合成腳踏鈸：六個非整數倍頻的方波疊加（不用亂數），加快速衰減。"""
    sample_count = int(note_event.duration_seconds * sample_rate)
    time_axis = np.arange(sample_count, dtype=np.float64) / sample_rate
    partial_frequencies = np.array(METALLIC_PARTIAL_FREQUENCIES)[:, np.newaxis]
    metallic_values = np.sign(np.sin(2 * np.pi * partial_frequencies * time_axis)).mean(axis=0)
    return (metallic_values * np.exp(-HAT_DECAY_RATE * time_axis)).astype(np.float32)


def render_events(
    note_events: list[NoteEvent], total_seconds: float, sample_rate: int = DEFAULT_SAMPLE_RATE
) -> float_samples_type:
    """把所有音符事件混成一條單聲道音訊，並正規化到 ±PEAK_HEADROOM。

    參數：
        note_events: 作曲引擎產生的事件。
        total_seconds: 輸出長度（秒）；超出的尾音會被截掉。
        sample_rate: 取樣率。
    回傳：
        float32 取樣陣列。
    """
    if total_seconds <= 0:
        raise ValueError(f"total_seconds 必須 > 0，收到 {total_seconds}")
    mixed_samples = np.zeros(int(total_seconds * sample_rate), dtype=np.float32)
    for note_event in note_events:
        if note_event.instrument_name == "kick":
            voice_samples = kick_voice(note_event, sample_rate)
        elif note_event.instrument_name == "hat":
            voice_samples = hat_voice(note_event, sample_rate)
        else:
            voice_samples = tonal_voice(note_event, sample_rate)
        start_index = int(note_event.start_seconds * sample_rate)
        end_index = min(start_index + len(voice_samples), len(mixed_samples))
        mixed_samples[start_index:end_index] += note_event.velocity * voice_samples[: end_index - start_index]
    peak_value = float(np.max(np.abs(mixed_samples)))
    if peak_value == 0:
        return mixed_samples
    return mixed_samples * (PEAK_HEADROOM / peak_value)
