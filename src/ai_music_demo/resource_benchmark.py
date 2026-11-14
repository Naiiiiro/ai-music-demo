"""資源量測：在不同曲長下量測生成時間、記憶體峰值，並估算伺服器預先算好時要傳的檔案大小，輸出 JSON。

用法：uv run benchmark-resources --output output/benchmark.json
不寫出任何音訊檔：WAV 大小由格式公式精確算出，AAC 大小由位元率估算。
"""

import argparse
import json
import sys
import time
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path

from ai_music_demo.audio_renderer import DEFAULT_SAMPLE_RATE, render_events
from ai_music_demo.composition_engine import CompositionSettings, compose_piece

BENCHMARK_BAR_COUNTS: tuple[int, ...] = (8, 32, 64, 128)
WAVE_HEADER_BYTES: int = 44
PCM_SAMPLE_WIDTH_BYTES: int = 2
AAC_BITRATE_BPS: int = 128_000
BITS_PER_BYTE: int = 8
BYTES_PER_MEBIBYTE: int = 1024 * 1024


@dataclass(frozen=True)
class BenchmarkRecord:
    """單一曲長的量測結果。"""

    bar_count: int
    audio_seconds: float
    note_event_count: int
    compose_seconds: float
    render_seconds: float
    peak_memory_mebibytes: float
    wave_bytes: int
    aac_estimated_bytes: int


def wave_file_bytes(frame_count: int) -> int:
    """單聲道 16-bit PCM WAV 的檔案大小（44 bytes 檔頭 + 每個取樣 2 bytes）。"""
    if frame_count < 0:
        raise ValueError(f"frame_count 必須 >= 0，收到 {frame_count}")
    return WAVE_HEADER_BYTES + frame_count * PCM_SAMPLE_WIDTH_BYTES


def aac_estimated_bytes(audio_seconds: float) -> int:
    """以 128 kbps 估算 AAC 檔大小；不含容器檔頭，實測（macOS afconvert）約多 1%。"""
    if audio_seconds < 0:
        raise ValueError(f"audio_seconds 必須 >= 0，收到 {audio_seconds}")
    return round(audio_seconds * AAC_BITRATE_BPS / BITS_PER_BYTE)


def measure_one_length(bar_count: int) -> BenchmarkRecord:
    """量測某個小節數下，從作曲到合成的成本，並估算預先算好時的檔案大小。"""
    settings = CompositionSettings(bar_count=bar_count)
    tracemalloc.start()
    compose_start = time.perf_counter()
    note_events = compose_piece(settings)
    render_start = time.perf_counter()
    samples = render_events(note_events, settings.total_seconds(), DEFAULT_SAMPLE_RATE)
    render_end = time.perf_counter()
    peak_memory_bytes = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    return BenchmarkRecord(
        bar_count=bar_count,
        audio_seconds=round(settings.total_seconds(), 2),
        note_event_count=len(note_events),
        compose_seconds=round(render_start - compose_start, 4),
        render_seconds=round(render_end - render_start, 4),
        peak_memory_mebibytes=round(peak_memory_bytes / BYTES_PER_MEBIBYTE, 2),
        wave_bytes=wave_file_bytes(len(samples)),
        aac_estimated_bytes=aac_estimated_bytes(settings.total_seconds()),
    )


def main(argument_list: list[str] | None = None) -> int:
    """執行所有曲長的量測並輸出 JSON 到 stdout 與指定檔案。"""
    argument_parser = argparse.ArgumentParser(description="量測演算法作曲的資源需求")
    argument_parser.add_argument("--output", type=Path, default=Path("output/benchmark.json"))
    parsed_arguments = argument_parser.parse_args(argument_list)
    benchmark_records = [measure_one_length(bar_count) for bar_count in BENCHMARK_BAR_COUNTS]
    report_text = json.dumps([asdict(record) for record in benchmark_records], indent=2)
    parsed_arguments.output.parent.mkdir(parents=True, exist_ok=True)
    parsed_arguments.output.write_text(report_text + "\n", encoding="utf-8")
    print(report_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
