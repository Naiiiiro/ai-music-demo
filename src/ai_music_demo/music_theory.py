"""樂理基礎：音階、三和弦、MIDI 音高與頻率換算。

這一層只有純計算，不碰檔案也不發聲，供作曲引擎呼叫。
"""

from typing import Literal

scale_mode_literal = Literal["major", "minor"]

MAJOR_SCALE_STEPS: tuple[int, ...] = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE_STEPS: tuple[int, ...] = (0, 2, 3, 5, 7, 8, 10)
SEMITONES_PER_OCTAVE: int = 12
CONCERT_A_MIDI: int = 69
CONCERT_A_FREQUENCY: float = 440.0
DEGREES_PER_SCALE: int = 7

# 流行樂最常見的 I–V–vi–IV 進行，以音階級數（0 起算）表示
POP_PROGRESSION_DEGREES: tuple[int, ...] = (0, 4, 5, 3)


def midi_to_frequency(midi_note: int) -> float:
    """把 MIDI 音高換成頻率（Hz），以 A4 = 440 Hz 為基準的十二平均律。

    參數：
        midi_note: MIDI 音高，0–127。
    回傳：
        對應頻率（Hz）。
    """
    if not 0 <= midi_note <= 127:
        raise ValueError(f"midi_note 必須在 0–127，收到 {midi_note}")
    return CONCERT_A_FREQUENCY * 2 ** ((midi_note - CONCERT_A_MIDI) / SEMITONES_PER_OCTAVE)


def build_scale(root_midi: int, scale_mode: scale_mode_literal) -> tuple[int, ...]:
    """產生一個八度內的七聲音階。

    參數：
        root_midi: 主音的 MIDI 音高。
        scale_mode: "major"（大調）或 "minor"（自然小調）。
    回傳：
        七個 MIDI 音高，由低到高。
    """
    scale_steps = MAJOR_SCALE_STEPS if scale_mode == "major" else MINOR_SCALE_STEPS
    return tuple(root_midi + step for step in scale_steps)


def scale_degree_to_midi(scale_notes: tuple[int, ...], scale_degree: int) -> int:
    """把「音階級數」換成 MIDI 音高，級數可超過 7 或為負數（自動跨八度）。

    參數：
        scale_notes: build_scale 的結果。
        scale_degree: 0 = 主音，7 = 高八度主音，-1 = 低八度的導音。
    回傳：
        MIDI 音高。
    """
    octave_offset, degree_in_octave = divmod(scale_degree, DEGREES_PER_SCALE)
    return scale_notes[degree_in_octave] + octave_offset * SEMITONES_PER_OCTAVE


def build_triad(scale_notes: tuple[int, ...], chord_degree: int) -> tuple[int, int, int]:
    """在音階上疊三度，得到順階三和弦（根音、三音、五音）。

    參數：
        scale_notes: build_scale 的結果。
        chord_degree: 和弦根音的音階級數。
    回傳：
        三個 MIDI 音高。
    """
    return (
        scale_degree_to_midi(scale_notes, chord_degree),
        scale_degree_to_midi(scale_notes, chord_degree + 2),
        scale_degree_to_midi(scale_notes, chord_degree + 4),
    )
