"""rhythm_patterns 的單元測試。"""

import pytest

from ai_music_demo.rhythm_patterns import euclidean_rhythm


def test_euclidean_three_in_eight_is_tresillo() -> None:
    hit_positions = [index for index, is_hit in enumerate(euclidean_rhythm(3, 8)) if is_hit]
    assert len(hit_positions) == 3
    assert sorted({(later - earlier) % 8 for earlier, later in zip(hit_positions, hit_positions[1:] + hit_positions[:1])}) == [2, 3]


def test_euclidean_four_in_sixteen_is_four_on_the_floor() -> None:
    assert [index for index, is_hit in enumerate(euclidean_rhythm(4, 16)) if is_hit] == [0, 4, 8, 12]


def test_euclidean_zero_pulses_is_silent() -> None:
    assert not any(euclidean_rhythm(0, 8))


def test_euclidean_full_pulses_hits_every_step() -> None:
    assert all(euclidean_rhythm(8, 8))


@pytest.mark.parametrize(("pulse_count", "step_count"), [(1, 0), (9, 8), (-1, 8)])
def test_euclidean_invalid_input_raises(pulse_count: int, step_count: int) -> None:
    with pytest.raises(ValueError):
        euclidean_rhythm(pulse_count, step_count)
