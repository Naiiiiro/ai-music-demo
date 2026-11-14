"""composition_engine 的單元測試。"""

import pytest

from ai_music_demo.composition_engine import CompositionSettings, compose_piece
from ai_music_demo.music_theory import build_scale, build_triad


def test_same_settings_produce_identical_piece() -> None:
    assert compose_piece(CompositionSettings()) == compose_piece(CompositionSettings())


def test_melody_follows_question_and_answer_phrases() -> None:
    lead_notes = [event.midi_note for event in compose_piece(CompositionSettings(bar_count=2)) if event.instrument_name == "lead"]
    # 與網頁版 browser_composer 測試的固定值相同：C 和弦問句 + G 和弦答句
    assert lead_notes == [72, 74, 76, 79, 76, 74, 86, 83, 81, 83, 79, 79]


def test_melody_stays_inside_scale() -> None:
    scale_pitch_classes = {note % 12 for note in build_scale(60, "major")}
    lead_events = [event for event in compose_piece(CompositionSettings()) if event.instrument_name == "lead"]
    assert lead_events
    assert all(event.midi_note % 12 in scale_pitch_classes for event in lead_events)


def test_melody_downbeat_lands_on_chord_tone() -> None:
    settings = CompositionSettings(bar_count=4)
    bar_seconds = settings.total_seconds() / settings.bar_count
    scale_notes = build_scale(60, "major")
    for bar_index, chord_degree in enumerate((0, 4, 5, 3)):
        chord_pitch_classes = {note % 12 for note in build_triad(scale_notes, chord_degree)}
        downbeat_notes = [
            event.midi_note
            for event in compose_piece(settings)
            if event.instrument_name == "lead" and event.start_seconds == pytest.approx(bar_index * bar_seconds)
        ]
        assert downbeat_notes and downbeat_notes[0] % 12 in chord_pitch_classes


def test_events_end_within_piece_length() -> None:
    settings = CompositionSettings(bar_count=2)
    assert all(event.start_seconds < settings.total_seconds() for event in compose_piece(settings))


@pytest.mark.parametrize("invalid_settings", [CompositionSettings(bar_count=0), CompositionSettings(tempo_bpm=0)])
def test_invalid_settings_raise(invalid_settings: CompositionSettings) -> None:
    with pytest.raises(ValueError):
        compose_piece(invalid_settings)
