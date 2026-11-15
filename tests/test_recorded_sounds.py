"""實錄音檔來源清單解析與下載核對的單元測試；不連網，用假的下載函式代替。"""

import copy
import hashlib
import json
import urllib.error
from pathlib import Path
from typing import Any

import pytest

from ai_music_demo.recorded_sound_fetcher import (
    MAXIMUM_DOWNLOAD_ATTEMPTS,
    RecordingFetchError,
    download_with_retry,
    fetch_all_recordings,
    main,
)
from ai_music_demo.recorded_sound_manifest import (
    ManifestFormatError,
    content_matches_recording,
    parse_recorded_sound_manifest,
)

REPOSITORY_MANIFEST_PATH: Path = Path(__file__).resolve().parent.parent / "web" / "recorded_sounds.json"
SCENE_MANIFEST_PATH: Path = Path(__file__).resolve().parent.parent / "web" / "scene_recorded_sounds.json"
SCENE_ASSET_COUNT: int = 42
SAMPLE_CONTENT: bytes = b"fake mp3 content"
RELEASE_BASE_URL: str = "https://github.com/example/demo/releases/download/sound-assets-v1"


def build_raw_manifest(file_content: bytes = SAMPLE_CONTENT) -> dict[str, Any]:
    """產生一份只有一筆音檔、內容對應 file_content 的合法清單。"""
    return {
        "release_base_url": RELEASE_BASE_URL,
        "recordings": [
            {
                "effect_name": "cat",
                "asset_file_name": "cat_meow.mp3",
                "sha256": hashlib.sha256(file_content).hexdigest(),
                "byte_size": len(file_content),
                "title": "Cat meow",
                "author": "someone",
                "license_name": "CC0 1.0",
                "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
                "source_page_url": "https://freesound.org/people/someone/sounds/1/",
            }
        ],
    }


def never_sleep(delay_seconds: float) -> None:
    """測試用：重試時不真的等待。"""


class RecordingDownloader:
    """假的下載函式：依序回傳預先排好的結果（bytes 或例外），並記下被要求的網址。"""

    def __init__(self, planned_results: list[bytes | Exception]) -> None:
        self.planned_results = planned_results
        self.requested_urls: list[str] = []

    def __call__(self, download_url: str) -> bytes:
        self.requested_urls.append(download_url)
        planned_result = self.planned_results[len(self.requested_urls) - 1]
        if isinstance(planned_result, Exception):
            raise planned_result
        return planned_result


def http_error(status_code: int) -> urllib.error.HTTPError:
    """建立指定狀態碼的 HTTPError。"""
    return urllib.error.HTTPError(RELEASE_BASE_URL, status_code, "error", {}, None)  # type: ignore[arg-type]


def test_repository_manifest_parses_with_three_effects() -> None:
    raw_manifest = json.loads(REPOSITORY_MANIFEST_PATH.read_text(encoding="utf-8"))
    parsed_manifest = parse_recorded_sound_manifest(raw_manifest)
    assert sorted(recording.effect_name for recording in parsed_manifest.recordings) == ["cat", "engine", "traffic"]


def test_repository_manifest_uses_only_cc0_recordings() -> None:
    raw_manifest = json.loads(REPOSITORY_MANIFEST_PATH.read_text(encoding="utf-8"))
    parsed_manifest = parse_recorded_sound_manifest(raw_manifest)
    assert {recording.license_name for recording in parsed_manifest.recordings} == {"CC0 1.0"}


def test_scene_manifest_parses_with_cc0_recordings_for_all_scene_assets() -> None:
    raw_manifest = json.loads(SCENE_MANIFEST_PATH.read_text(encoding="utf-8"))
    parsed_manifest = parse_recorded_sound_manifest(raw_manifest)
    assert len(parsed_manifest.recordings) == SCENE_ASSET_COUNT
    assert {recording.license_name for recording in parsed_manifest.recordings} == {"CC0 1.0"}
    assert parsed_manifest.release_base_url.endswith("/scene-assets-v1")


def test_asset_download_url_joins_release_base_and_file_name() -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    download_url = parsed_manifest.asset_download_url(parsed_manifest.recordings[0])
    assert download_url == f"{RELEASE_BASE_URL}/cat_meow.mp3"


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("asset_file_name", "../escape.mp3"),
        ("asset_file_name", "cat_meow.wav"),
        ("sha256", "abc"),
        ("byte_size", 0),
        ("byte_size", True),
        ("source_page_url", "http://freesound.org/x"),
        ("title", ""),
    ],
)
def test_invalid_recording_field_is_rejected_with_field_name(field_name: str, invalid_value: object) -> None:
    raw_manifest = build_raw_manifest()
    raw_manifest["recordings"][0][field_name] = invalid_value
    with pytest.raises(ManifestFormatError, match=field_name):
        parse_recorded_sound_manifest(raw_manifest)


def test_empty_recordings_are_rejected() -> None:
    raw_manifest = build_raw_manifest()
    raw_manifest["recordings"] = []
    with pytest.raises(ManifestFormatError, match="recordings"):
        parse_recorded_sound_manifest(raw_manifest)


def test_duplicate_asset_file_names_are_rejected() -> None:
    raw_manifest = build_raw_manifest()
    raw_manifest["recordings"].append(copy.deepcopy(raw_manifest["recordings"][0]))
    with pytest.raises(ManifestFormatError, match="重複"):
        parse_recorded_sound_manifest(raw_manifest)


def test_content_with_same_size_but_different_bytes_does_not_match() -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    tampered_content = b"X" * len(SAMPLE_CONTENT)
    assert not content_matches_recording(tampered_content, parsed_manifest.recordings[0])


def test_fetch_downloads_and_writes_verified_file(tmp_path: Path) -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    fake_downloader = RecordingDownloader([SAMPLE_CONTENT])
    downloaded_count = fetch_all_recordings(parsed_manifest, tmp_path, fake_downloader, never_sleep)
    assert downloaded_count == 1
    assert (tmp_path / "cat_meow.mp3").read_bytes() == SAMPLE_CONTENT
    assert fake_downloader.requested_urls == [f"{RELEASE_BASE_URL}/cat_meow.mp3"]


def test_fetch_skips_file_whose_hash_already_matches(tmp_path: Path) -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    (tmp_path / "cat_meow.mp3").write_bytes(SAMPLE_CONTENT)
    fake_downloader = RecordingDownloader([])
    assert fetch_all_recordings(parsed_manifest, tmp_path, fake_downloader, never_sleep) == 0
    assert fake_downloader.requested_urls == []


def test_fetch_replaces_existing_file_with_wrong_content(tmp_path: Path) -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    (tmp_path / "cat_meow.mp3").write_bytes(b"stale")
    assert fetch_all_recordings(parsed_manifest, tmp_path, RecordingDownloader([SAMPLE_CONTENT]), never_sleep) == 1
    assert (tmp_path / "cat_meow.mp3").read_bytes() == SAMPLE_CONTENT


def test_fetch_rejects_tampered_download_and_leaves_no_file(tmp_path: Path) -> None:
    parsed_manifest = parse_recorded_sound_manifest(build_raw_manifest())
    with pytest.raises(RecordingFetchError, match="不符"):
        fetch_all_recordings(parsed_manifest, tmp_path, RecordingDownloader([b"tampered"]), never_sleep)
    assert list(tmp_path.iterdir()) == []


def test_download_retries_transient_server_error_then_succeeds() -> None:
    fake_downloader = RecordingDownloader([http_error(503), SAMPLE_CONTENT])
    assert download_with_retry(RELEASE_BASE_URL, fake_downloader, never_sleep) == SAMPLE_CONTENT
    assert len(fake_downloader.requested_urls) == 2


def test_download_does_not_retry_not_found() -> None:
    fake_downloader = RecordingDownloader([http_error(404)])
    with pytest.raises(RecordingFetchError):
        download_with_retry(RELEASE_BASE_URL, fake_downloader, never_sleep)
    assert len(fake_downloader.requested_urls) == 1


def test_download_gives_up_after_maximum_attempts() -> None:
    fake_downloader = RecordingDownloader([TimeoutError()] * MAXIMUM_DOWNLOAD_ATTEMPTS)
    with pytest.raises(RecordingFetchError):
        download_with_retry(RELEASE_BASE_URL, fake_downloader, never_sleep)
    assert len(fake_downloader.requested_urls) == MAXIMUM_DOWNLOAD_ATTEMPTS


def test_main_returns_one_for_missing_manifest(tmp_path: Path) -> None:
    exit_code = main(["--manifest", str(tmp_path / "missing.json"), "--output-directory", str(tmp_path)])
    assert exit_code == 1
