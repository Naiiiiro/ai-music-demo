"""audio_renderer 與 resource_benchmark 大小估算的單元測試。"""

import numpy as np
import pytest

from ai_music_demo.audio_renderer import PEAK_HEADROOM, hat_voice, render_events
from ai_music_demo.composition_engine import CompositionSettings, NoteEvent, compose_piece
from ai_music_demo.resource_benchmark import aac_estimated_bytes, wave_file_bytes

TEST_SAMPLE_RATE = 8_000


def test_render_length_matches_requested_seconds() -> None:
    settings = CompositionSettings(bar_count=1)
    rendered_samples = render_events(compose_piece(settings), settings.total_seconds(), TEST_SAMPLE_RATE)
    assert len(rendered_samples) == int(settings.total_seconds() * TEST_SAMPLE_RATE)


def test_render_is_normalized_to_headroom() -> None:
    settings = CompositionSettings(bar_count=1)
    rendered_samples = render_events(compose_piece(settings), settings.total_seconds(), TEST_SAMPLE_RATE)
    assert float(np.max(np.abs(rendered_samples))) == pytest.approx(PEAK_HEADROOM, rel=1e-3)


def test_render_without_events_is_silent() -> None:
    assert not np.any(render_events([], 1.0, TEST_SAMPLE_RATE))


def test_hat_voice_is_bounded_audible_and_repeatable() -> None:
    hat_event = NoteEvent(0.0, 0.05, 0, 0.3, "hat")
    hat_samples = hat_voice(hat_event, TEST_SAMPLE_RATE)
    assert len(hat_samples) == 400
    assert 0.5 < float(np.max(np.abs(hat_samples))) <= 1.0
    assert np.array_equal(hat_samples, hat_voice(hat_event, TEST_SAMPLE_RATE))


def test_render_zero_length_raises() -> None:
    with pytest.raises(ValueError):
        render_events([], 0.0, TEST_SAMPLE_RATE)


def test_wave_size_is_header_plus_two_bytes_per_frame() -> None:
    assert wave_file_bytes(TEST_SAMPLE_RATE) == 44 + TEST_SAMPLE_RATE * 2


def test_wave_size_of_empty_audio_is_header_only() -> None:
    assert wave_file_bytes(0) == 44


def test_wave_size_negative_frames_raises() -> None:
    with pytest.raises(ValueError):
        wave_file_bytes(-1)


def test_aac_estimate_follows_bitrate() -> None:
    assert aac_estimated_bytes(10.0) == 160_000


def test_aac_estimate_negative_seconds_raises() -> None:
    with pytest.raises(ValueError):
        aac_estimated_bytes(-0.1)
