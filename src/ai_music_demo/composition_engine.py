"""作曲引擎：把樂理規則組合成一串音符事件。

音樂性的來源：
- 和聲：固定的 I–V–vi–IV 和弦進行（music_theory）
- 旋律：寫定的問句、答句兩個樂句輪流出現，每小節第一拍落在和弦音上
- 節奏：大鼓與腳踏鈸用 Euclidean rhythm（rhythm_patterns）
全部規則寫定，不用亂數；同樣的參數永遠產生同一首曲子。
"""

from dataclasses import dataclass
from typing import Literal

from ai_music_demo.music_theory import (
    POP_PROGRESSION_DEGREES,
    build_scale,
    build_triad,
    scale_degree_to_midi,
    scale_mode_literal,
)
from ai_music_demo.rhythm_patterns import euclidean_rhythm

instrument_name_literal = Literal["lead", "bass", "chord", "kick", "hat"]

STEPS_PER_BAR: int = 16
BEATS_PER_BAR: int = 4
SECONDS_PER_MINUTE: float = 60.0
MELODY_STEP_LENGTH: int = 2  # 旋律以八分音符（兩個十六分格）為單位
# 旋律以和弦根音高一個八度為基準（7 個音階級數）
MELODY_DEGREE_OFFSET: int = 7
# 每小節 8 個八分音符，數字是相對旋律基準的音階級數，None 是休止；與網頁版 MELODY_PHRASES 相同。
# 偶數小節是往上走的問句，奇數小節是往下收的答句；第一個音是根音或五音，一定是和弦音
MELODY_PHRASES: tuple[tuple[int | None, ...], ...] = (
    (0, 1, 2, None, 4, 2, 1, None),
    (4, 2, 1, 2, 0, None, 0, None),
)
KICK_PULSE_COUNT: int = 4
HAT_PULSE_COUNT: int = 7
BASS_OCTAVE_SHIFT: int = -12


@dataclass(frozen=True)
class NoteEvent:
    """一個音符事件。

    屬性：
        start_seconds: 起始時間（秒）。
        duration_seconds: 長度（秒）。
        midi_note: MIDI 音高；鼓組忽略此值。
        velocity: 力度 0–1。
        instrument_name: 由哪個聲部演奏。
    """

    start_seconds: float
    duration_seconds: float
    midi_note: int
    velocity: float
    instrument_name: instrument_name_literal


@dataclass(frozen=True)
class CompositionSettings:
    """一首曲子的參數。

    屬性：
        tempo_bpm: 速度（每分鐘拍數）。
        bar_count: 小節數。
        root_midi: 主音 MIDI 音高。
        scale_mode: 大調或小調。
    """

    tempo_bpm: float = 110.0
    bar_count: int = 8
    root_midi: int = 60
    scale_mode: scale_mode_literal = "major"

    def step_seconds(self) -> float:
        """回傳一個十六分音符格的秒數。"""
        return SECONDS_PER_MINUTE / self.tempo_bpm / (STEPS_PER_BAR / BEATS_PER_BAR)

    def total_seconds(self) -> float:
        """回傳整首曲子的秒數。"""
        return self.step_seconds() * STEPS_PER_BAR * self.bar_count


def compose_piece(settings: CompositionSettings) -> list[NoteEvent]:
    """依參數作出一首曲子。

    參數：
        settings: 曲子參數。
    回傳：
        依起始時間排序的音符事件。
    """
    if settings.bar_count <= 0:
        raise ValueError(f"bar_count 必須 > 0，收到 {settings.bar_count}")
    if settings.tempo_bpm <= 0:
        raise ValueError(f"tempo_bpm 必須 > 0，收到 {settings.tempo_bpm}")
    scale_notes = build_scale(settings.root_midi, settings.scale_mode)
    all_events = (
        compose_harmony(settings, scale_notes)
        + compose_melody(settings, scale_notes)
        + compose_drums(settings)
    )
    return sorted(all_events, key=lambda note_event: note_event.start_seconds)


def chord_degree_for_bar(bar_index: int) -> int:
    """回傳第 bar_index 小節使用的和弦級數。"""
    return POP_PROGRESSION_DEGREES[bar_index % len(POP_PROGRESSION_DEGREES)]


def compose_harmony(
    settings: CompositionSettings, scale_notes: tuple[int, ...]
) -> list[NoteEvent]:
    """產生每小節的和弦（整小節長音）與貝斯（每拍根音）。"""
    bar_seconds = settings.step_seconds() * STEPS_PER_BAR
    beat_seconds = bar_seconds / BEATS_PER_BAR
    harmony_events: list[NoteEvent] = []
    for bar_index in range(settings.bar_count):
        bar_start = bar_index * bar_seconds
        triad_notes = build_triad(scale_notes, chord_degree_for_bar(bar_index))
        harmony_events += [
            NoteEvent(bar_start, bar_seconds, chord_note, 0.25, "chord") for chord_note in triad_notes
        ]
        bass_note = triad_notes[0] + BASS_OCTAVE_SHIFT
        harmony_events += [
            NoteEvent(bar_start + beat_index * beat_seconds, beat_seconds * 0.9, bass_note, 0.6, "bass")
            for beat_index in range(BEATS_PER_BAR)
        ]
    return harmony_events


def compose_melody(settings: CompositionSettings, scale_notes: tuple[int, ...]) -> list[NoteEvent]:
    """產生主旋律：依 MELODY_PHRASES 每小節輪流套用問句與答句，音高跟著當小節的和弦移動。"""
    step_seconds = settings.step_seconds()
    note_seconds = step_seconds * MELODY_STEP_LENGTH
    melody_events: list[NoteEvent] = []
    for bar_index in range(settings.bar_count):
        melody_base_degree = chord_degree_for_bar(bar_index) + MELODY_DEGREE_OFFSET
        melody_phrase = MELODY_PHRASES[bar_index % len(MELODY_PHRASES)]
        for slot_index, degree_offset in enumerate(melody_phrase):
            if degree_offset is None:
                continue
            start_seconds = (bar_index * STEPS_PER_BAR + slot_index * MELODY_STEP_LENGTH) * step_seconds
            melody_note = scale_degree_to_midi(scale_notes, melody_base_degree + degree_offset)
            melody_events.append(NoteEvent(start_seconds, note_seconds * 0.95, melody_note, 0.5, "lead"))
    return melody_events


def compose_drums(settings: CompositionSettings) -> list[NoteEvent]:
    """產生鼓組：大鼓 (4,16) 即四拍子，腳踏鈸 (7,16) 帶出切分感。"""
    step_seconds = settings.step_seconds()
    drum_layers: tuple[tuple[instrument_name_literal, int, float], ...] = (
        ("kick", KICK_PULSE_COUNT, 0.9),
        ("hat", HAT_PULSE_COUNT, 0.3),
    )
    drum_events: list[NoteEvent] = []
    for instrument_name, pulse_count, velocity in drum_layers:
        hit_pattern = euclidean_rhythm(pulse_count, STEPS_PER_BAR)
        for bar_index in range(settings.bar_count):
            drum_events += [
                NoteEvent((bar_index * STEPS_PER_BAR + step_index) * step_seconds, step_seconds, 0, velocity, instrument_name)
                for step_index, is_hit in enumerate(hit_pattern)
                if is_hit
            ]
    return drum_events
