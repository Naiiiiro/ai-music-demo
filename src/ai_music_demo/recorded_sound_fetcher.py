"""下載實錄音檔：讀 web/recorded_sounds.json，從 GitHub Release 下載每個音檔並核對 SHA-256。

用法：uv run fetch-recorded-sounds
音檔寫進 web/recorded_sounds/（已被 .gitignore 排除，不進版控）。已存在且雜湊值相符的檔案直接跳過，
所以可以重複執行。任何一個檔案下載失敗或雜湊值不符，命令就以非零值結束，部署流程跟著失敗。
"""

import argparse
import json
import logging
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

from ai_music_demo.recorded_sound_manifest import (
    RecordedSound,
    RecordedSoundManifest,
    content_matches_recording,
    parse_recorded_sound_manifest,
)

DEFAULT_MANIFEST_PATH: Path = Path("web/recorded_sounds.json")
DEFAULT_OUTPUT_DIRECTORY: Path = Path("web/recorded_sounds")
DOWNLOAD_TIMEOUT_SECONDS: float = 30.0
MAXIMUM_DOWNLOAD_ATTEMPTS: int = 3
RETRY_BASE_DELAY_SECONDS: float = 1.0
TRANSIENT_HTTP_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})
LOG_TIME_FORMAT: str = "%Y-%m-%dT%H:%M:%SZ"

logger = logging.getLogger(__name__)

type DownloadFunction = Callable[[str], bytes]
type SleepFunction = Callable[[float], None]


class RecordingFetchError(RuntimeError):
    """某個音檔下載失敗，或內容與清單記錄的不符。"""


def download_url_bytes(download_url: str) -> bytes:
    """以 HTTP GET 下載整個檔案；逾時 DOWNLOAD_TIMEOUT_SECONDS 秒。"""
    with urllib.request.urlopen(download_url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as http_response:
        return http_response.read()


def _is_transient_error(download_error: Exception) -> bool:
    """只有逾時、連線失敗、HTTP 429 與 5xx 值得重試；404 等錯誤重試也不會好。"""
    if isinstance(download_error, urllib.error.HTTPError):
        return download_error.code in TRANSIENT_HTTP_STATUS_CODES
    return isinstance(download_error, (urllib.error.URLError, TimeoutError))


def download_with_retry(download_url: str, download_bytes: DownloadFunction, sleep_seconds: SleepFunction) -> bytes:
    """下載檔案，暫時性錯誤以指數退避重試，最多 MAXIMUM_DOWNLOAD_ATTEMPTS 次。"""
    for attempt_number in range(1, MAXIMUM_DOWNLOAD_ATTEMPTS + 1):
        try:
            return download_bytes(download_url)
        except (urllib.error.URLError, TimeoutError) as download_error:
            if not _is_transient_error(download_error) or attempt_number == MAXIMUM_DOWNLOAD_ATTEMPTS:
                raise RecordingFetchError(f"下載失敗：{download_url}（第 {attempt_number} 次）") from download_error
            retry_delay_seconds = RETRY_BASE_DELAY_SECONDS * 2 ** (attempt_number - 1)
            logger.warning(
                "event=download_retry url=%s attempt=%d delay_seconds=%.1f",
                download_url,
                attempt_number,
                retry_delay_seconds,
            )
            sleep_seconds(retry_delay_seconds)
    raise AssertionError("unreachable: 迴圈每一輪不是回傳就是丟出例外")


def fetch_one_recording(
    manifest: RecordedSoundManifest,
    recording: RecordedSound,
    output_directory: Path,
    download_bytes: DownloadFunction,
    sleep_seconds: SleepFunction,
) -> bool:
    """確保 output_directory 裡有內容正確的音檔。

    回傳：True 表示這次有下載，False 表示原本的檔案已正確而跳過。
    例外：下載失敗或內容不符時丟出 RecordingFetchError，不會留下內容錯誤的檔案。
    """
    target_path = output_directory / recording.asset_file_name
    if target_path.is_file() and content_matches_recording(target_path.read_bytes(), recording):
        logger.info("event=recording_skipped file=%s reason=hash_matches", recording.asset_file_name)
        return False
    download_url = manifest.asset_download_url(recording)
    file_content = download_with_retry(download_url, download_bytes, sleep_seconds)
    if not content_matches_recording(file_content, recording):
        raise RecordingFetchError(
            f"內容與清單不符：{recording.asset_file_name}（預期 {recording.byte_size} bytes，收到 {len(file_content)} bytes）"
        )
    temporary_path = target_path.with_suffix(target_path.suffix + ".partial")
    temporary_path.write_bytes(file_content)
    temporary_path.replace(target_path)
    logger.info("event=recording_downloaded file=%s bytes=%d", recording.asset_file_name, len(file_content))
    return True


def fetch_all_recordings(
    manifest: RecordedSoundManifest,
    output_directory: Path,
    download_bytes: DownloadFunction = download_url_bytes,
    sleep_seconds: SleepFunction = time.sleep,
) -> int:
    """下載清單裡所有音檔；回傳實際下載（非跳過）的檔案數。"""
    output_directory.mkdir(parents=True, exist_ok=True)
    return sum(
        fetch_one_recording(manifest, recording, output_directory, download_bytes, sleep_seconds)
        for recording in manifest.recordings
    )


def load_manifest_file(manifest_path: Path) -> RecordedSoundManifest:
    """讀取並解析來源清單檔。"""
    try:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as read_error:
        raise RecordingFetchError(f"無法讀取來源清單：{manifest_path}") from read_error
    return parse_recorded_sound_manifest(raw_manifest)


def configure_logging() -> None:
    """日誌寫到 stderr，格式為 UTC 時間加 key=value。"""
    logging.Formatter.converter = time.gmtime
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="time=%(asctime)s level=%(levelname)s %(message)s",
        datefmt=LOG_TIME_FORMAT,
    )


def main(argument_list: list[str] | None = None) -> int:
    """命令列入口：成功回傳 0；清單錯誤、下載失敗或雜湊值不符回傳 1。"""
    argument_parser = argparse.ArgumentParser(description="從 GitHub Release 下載實錄音檔並核對 SHA-256")
    argument_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    argument_parser.add_argument("--output-directory", type=Path, default=DEFAULT_OUTPUT_DIRECTORY)
    parsed_arguments = argument_parser.parse_args(argument_list)
    configure_logging()
    try:
        manifest = load_manifest_file(parsed_arguments.manifest)
        downloaded_count = fetch_all_recordings(manifest, parsed_arguments.output_directory)
    except (RecordingFetchError, ValueError) as fetch_error:
        logger.error("event=fetch_failed error=%s cause=%r", fetch_error, fetch_error.__cause__)
        return 1
    logger.info(
        "event=fetch_finished downloaded=%d total=%d output=%s",
        downloaded_count,
        len(manifest.recordings),
        parsed_arguments.output_directory,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
