"""music_theory 的單元測試。"""

import pytest

from ai_music_demo.music_theory import build_scale, build_triad, midi_to_frequency, scale_degree_to_midi


def test_midi_to_frequency_concert_a_is_440() -> None:
    assert midi_to_frequency(69) == pytest.approx(440.0)


def test_midi_to_frequency_octave_doubles_frequency() -> None:
    assert midi_to_frequency(81) == pytest.approx(880.0)


@pytest.mark.parametrize("invalid_note", [-1, 128])
def test_midi_to_frequency_out_of_range_raises(invalid_note: int) -> None:
    with pytest.raises(ValueError):
        midi_to_frequency(invalid_note)


def test_build_scale_c_major_is_white_keys() -> None:
    assert build_scale(60, "major") == (60, 62, 64, 65, 67, 69, 71)


def test_build_scale_a_minor_has_flat_third() -> None:
    assert build_scale(57, "minor")[2] == 60


def test_scale_degree_to_midi_wraps_octave_up_and_down() -> None:
    c_major_notes = build_scale(60, "major")
    assert scale_degree_to_midi(c_major_notes, 7) == 72
    assert scale_degree_to_midi(c_major_notes, -1) == 59


def test_build_triad_fifth_degree_is_g_major() -> None:
    assert build_triad(build_scale(60, "major"), 4) == (67, 71, 74)
