"""場景音效偏好：純計算的解析／更新，以及本機伺服器寫回偏好檔的整合測試（只連 127.0.0.1）。"""

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from ai_music_demo.scene_sound_preferences import (
    PreferenceBook,
    PreferenceFormatError,
    PreferenceUpdate,
    SoundPreference,
    apply_preference_update,
    parse_preference_book,
    parse_preference_update,
    preference_book_to_json,
)
from ai_music_demo.scene_sound_server import PreferenceStore, build_server, load_known_asset_ids

KNOWN_ASSET_IDS: frozenset[str] = frozenset({"dog_bark", "flowing_water"})
FIRST_TIMESTAMP: str = "2026-11-15T10:00:00Z"
SECOND_TIMESTAMP: str = "2026-11-15T11:00:00Z"
REPOSITORY_ROOT: Path = Path(__file__).resolve().parent.parent
RULES_PATH: Path = REPOSITORY_ROOT / "sound_plans" / "screw_press_separator" / "sound_rules.json"
REPOSITORY_PREFERENCE_PATH: Path = REPOSITORY_ROOT / "web" / "scene_sound_preferences.json"


def test_update_adds_preference_and_replaces_older_one() -> None:
    first_book = apply_preference_update(PreferenceBook(()), PreferenceUpdate("dog_bark", "synthesized"), FIRST_TIMESTAMP)
    second_book = apply_preference_update(first_book, PreferenceUpdate("dog_bark", "recorded"), SECOND_TIMESTAMP)
    assert second_book.preferences == (SoundPreference("dog_bark", "recorded", SECOND_TIMESTAMP),)


def test_book_round_trips_through_json_sorted_by_asset() -> None:
    book = apply_preference_update(PreferenceBook(()), PreferenceUpdate("flowing_water", "recorded"), FIRST_TIMESTAMP)
    book = apply_preference_update(book, PreferenceUpdate("dog_bark", "synthesized"), FIRST_TIMESTAMP)
    parsed_book = parse_preference_book(json.loads(preference_book_to_json(book)), KNOWN_ASSET_IDS)
    assert [preference.asset_id for preference in parsed_book.preferences] == ["dog_bark", "flowing_water"]
    assert parsed_book == book


@pytest.mark.parametrize(
    "raw_update",
    [
        {"asset_id": "unicorn", "chosen_version": "recorded"},
        {"asset_id": "dog_bark", "chosen_version": "both"},
        {"asset_id": "dog_bark"},
        {"asset_id": "dog_bark", "chosen_version": "recorded", "extra_field": 1},
        ["dog_bark", "recorded"],
    ],
)
def test_invalid_update_is_rejected(raw_update: Any) -> None:
    with pytest.raises(PreferenceFormatError):
        parse_preference_update(raw_update, KNOWN_ASSET_IDS)


@pytest.mark.parametrize(
    "raw_book",
    [
        {},
        {"preferences": [{"asset_id": "dog_bark", "chosen_version": "recorded", "updated_at": "2026-11-15 10:00"}]},
        {"preferences": [{"asset_id": "dog_bark", "chosen_version": "recorded", "updated_at": FIRST_TIMESTAMP}] * 2},
    ],
)
def test_invalid_book_is_rejected(raw_book: Any) -> None:
    with pytest.raises(PreferenceFormatError):
        parse_preference_book(raw_book, KNOWN_ASSET_IDS)


def test_local_timestamp_is_rejected_on_update() -> None:
    with pytest.raises(PreferenceFormatError):
        apply_preference_update(PreferenceBook(()), PreferenceUpdate("dog_bark", "recorded"), "2026-11-15T18:00:00+08:00")


def test_repository_preference_file_matches_sound_rules() -> None:
    raw_book = json.loads(REPOSITORY_PREFERENCE_PATH.read_text(encoding="utf-8"))
    parse_preference_book(raw_book, load_known_asset_ids(RULES_PATH))


@pytest.fixture
def running_server(tmp_path: Path) -> Iterator[tuple[str, Path]]:
    """在系統挑的空埠啟動伺服器，回傳（網址前綴, 偏好檔路徑）。"""
    web_directory = tmp_path / "web"
    web_directory.mkdir()
    (web_directory / "scene_sounds.html").write_text("<p>ok</p>", encoding="utf-8")
    preference_path = web_directory / "scene_sound_preferences.json"
    scene_server = build_server(0, web_directory, PreferenceStore(preference_path, KNOWN_ASSET_IDS))
    server_thread = threading.Thread(target=scene_server.serve_forever, daemon=True)
    server_thread.start()
    yield f"http://127.0.0.1:{scene_server.server_port}", preference_path
    scene_server.shutdown()
    scene_server.server_close()


def send_request(url: str, payload: Any = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    """送出請求，回傳（狀態碼, 解析後的 JSON 或文字）。"""
    request_body = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json"} if payload is not None else {}
    request_headers.update(headers or {})
    http_request = urllib.request.Request(url, data=request_body, headers=request_headers)
    try:
        with urllib.request.urlopen(http_request, timeout=5) as http_response:
            response_text = http_response.read().decode("utf-8")
            status_code = http_response.status
    except urllib.error.HTTPError as http_error:
        return http_error.code, json.loads(http_error.read().decode("utf-8"))
    if response_text.startswith("{"):
        return status_code, json.loads(response_text)
    return status_code, response_text


def test_server_writes_preference_file(running_server: tuple[str, Path]) -> None:
    base_url, preference_path = running_server
    status_code, response_book = send_request(
        f"{base_url}/api/scene-sound-preferences", {"asset_id": "dog_bark", "chosen_version": "synthesized"}
    )
    assert status_code == 200
    assert response_book["preferences"][0]["chosen_version"] == "synthesized"
    saved_book = parse_preference_book(json.loads(preference_path.read_text(encoding="utf-8")), KNOWN_ASSET_IDS)
    assert saved_book.preferences[0].asset_id == "dog_bark"
    assert send_request(f"{base_url}/api/scene-sound-preferences")[1] == response_book


def test_server_serves_static_page(running_server: tuple[str, Path]) -> None:
    base_url, _ = running_server
    assert send_request(f"{base_url}/scene_sounds.html") == (200, "<p>ok</p>")


def test_server_rejects_unknown_asset_without_writing(running_server: tuple[str, Path]) -> None:
    base_url, preference_path = running_server
    status_code, response_body = send_request(
        f"{base_url}/api/scene-sound-preferences", {"asset_id": "unicorn", "chosen_version": "recorded"}
    )
    assert status_code == 422
    assert "asset_id" in response_body["error"]
    assert not preference_path.exists()


def test_server_rejects_foreign_origin(running_server: tuple[str, Path]) -> None:
    base_url, preference_path = running_server
    status_code, _ = send_request(
        f"{base_url}/api/scene-sound-preferences",
        {"asset_id": "dog_bark", "chosen_version": "recorded"},
        {"Origin": "https://example.com"},
    )
    assert status_code == 403
    assert not preference_path.exists()


def test_server_rejects_non_json_content_type(running_server: tuple[str, Path]) -> None:
    base_url, preference_path = running_server
    status_code, _ = send_request(
        f"{base_url}/api/scene-sound-preferences",
        {"asset_id": "dog_bark", "chosen_version": "recorded"},
        {"Content-Type": "text/plain"},
    )
    assert status_code == 415
    assert not preference_path.exists()
