"""本機試聽伺服器：提供 web/ 的靜態檔案，並把場景音效的選用偏好寫回 repo 的 web/scene_sound_preferences.json。

用法：uv run serve-scene-sounds，然後開 http://127.0.0.1:8765/scene_sounds.html
- GET  /api/scene-sound-preferences：回傳目前的偏好檔（網頁用它判斷「可以寫回 repo」）
- POST /api/scene-sound-preferences：body 為 {"asset_id": ..., "chosen_version": "synthesized" | "recorded"}

只監聽 127.0.0.1。POST 必須是 application/json：瀏覽器對其他網站送來的這類請求會先發 CORS preflight，
這裡不回應 preflight，所以別的網頁無法偷改偏好檔；有 Origin 標頭時也必須是本機。
寫入後的偏好檔照一般流程開分支、開 PR 才進 main。
"""

import argparse
import json
import logging
import sys
import time
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ai_music_demo.scene_sound_preferences import (
    PreferenceBook,
    PreferenceFormatError,
    apply_preference_update,
    parse_preference_book,
    parse_preference_update,
    preference_book_to_json,
)
from ai_music_demo.sound_plan_model import parse_sound_plan_rules

LISTEN_HOST: str = "127.0.0.1"
DEFAULT_PORT: int = 8765
DEFAULT_WEB_DIRECTORY: Path = Path("web")
DEFAULT_PREFERENCE_PATH: Path = Path("web/scene_sound_preferences.json")
DEFAULT_RULES_PATH: Path = Path("sound_plans/screw_press_separator/sound_rules.json")
PREFERENCE_API_PATH: str = "/api/scene-sound-preferences"
MAXIMUM_REQUEST_BYTES: int = 4096
JSON_CONTENT_TYPE: str = "application/json"
UTC_TIME_FORMAT: str = "%Y-%m-%dT%H:%M:%SZ"
ALLOWED_ORIGIN_PREFIXES: tuple[str, ...] = ("http://127.0.0.1:", "http://localhost:")

logger = logging.getLogger(__name__)


class PreferenceRequestError(ValueError):
    """請求本身不合格（大小、型別、來源）；status_code 是要回給瀏覽器的 HTTP 狀態碼。"""

    def __init__(self, message: str, status_code: HTTPStatus) -> None:
        super().__init__(message)
        self.status_code = status_code


class PreferenceStore:
    """偏好檔的讀寫：讀出、套用一筆更新、先寫暫存檔再改名，寫到一半中斷也不會留下壞檔。"""

    def __init__(self, preference_path: Path, known_asset_ids: frozenset[str]) -> None:
        self.preference_path = preference_path
        self.known_asset_ids = known_asset_ids

    def read_book(self) -> PreferenceBook:
        """讀出目前的偏好檔；檔案不存在視為空的。"""
        if not self.preference_path.is_file():
            return PreferenceBook(())
        raw_book = json.loads(self.preference_path.read_text(encoding="utf-8"))
        return parse_preference_book(raw_book, self.known_asset_ids)

    def apply_raw_update(self, raw_update: Any, updated_at: str) -> PreferenceBook:
        """驗證並套用一筆更新，寫回檔案，回傳新的偏好檔。"""
        preference_update = parse_preference_update(raw_update, self.known_asset_ids)
        updated_book = apply_preference_update(self.read_book(), preference_update, updated_at)
        temporary_path = self.preference_path.with_suffix(".json.partial")
        temporary_path.write_text(preference_book_to_json(updated_book), encoding="utf-8")
        temporary_path.replace(self.preference_path)
        logger.info(
            "event=preference_saved asset_id=%s chosen_version=%s",
            preference_update.asset_id,
            preference_update.chosen_version,
        )
        return updated_book


def current_utc_timestamp() -> str:
    """現在的 UTC 時間，格式 %Y-%m-%dT%H:%M:%SZ。"""
    return time.strftime(UTC_TIME_FORMAT, time.gmtime())


def read_json_request(headers: Any, body_reader: Any) -> Any:
    """檢查請求的來源、型別與大小後讀出 JSON；不合格丟出 PreferenceRequestError。"""
    origin_header = headers.get("Origin")
    if origin_header is not None and not origin_header.startswith(ALLOWED_ORIGIN_PREFIXES):
        raise PreferenceRequestError(f"不接受來自 {origin_header} 的請求", HTTPStatus.FORBIDDEN)
    if headers.get_content_type() != JSON_CONTENT_TYPE:
        raise PreferenceRequestError("Content-Type 必須是 application/json", HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    try:
        content_length = int(headers.get("Content-Length", ""))
    except ValueError as length_error:
        raise PreferenceRequestError("缺少 Content-Length", HTTPStatus.LENGTH_REQUIRED) from length_error
    if not 0 < content_length <= MAXIMUM_REQUEST_BYTES:
        raise PreferenceRequestError(
            f"請求大小必須介於 1 與 {MAXIMUM_REQUEST_BYTES} bytes", HTTPStatus.REQUEST_ENTITY_TOO_LARGE
        )
    try:
        return json.loads(body_reader.read(content_length))
    except (json.JSONDecodeError, UnicodeDecodeError) as decode_error:
        raise PreferenceRequestError("請求內容不是 JSON", HTTPStatus.BAD_REQUEST) from decode_error


class SceneSoundRequestHandler(SimpleHTTPRequestHandler):
    """靜態檔案照 SimpleHTTPRequestHandler 處理，只有偏好 API 另外處理。"""

    preference_store: PreferenceStore

    def _send_json(self, status_code: HTTPStatus, payload: Any) -> None:
        response_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", f"{JSON_CONTENT_TYPE}; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response_body)

    def do_GET(self) -> None:
        """偏好 API 回傳偏好檔，其餘路徑交給靜態檔案處理。"""
        if self.path.split("?", 1)[0] != PREFERENCE_API_PATH:
            super().do_GET()
            return
        self._send_json(HTTPStatus.OK, json.loads(preference_book_to_json(self.preference_store.read_book())))

    def do_POST(self) -> None:
        """寫入一筆偏好；格式錯誤回 4xx 並說明欄位。"""
        if self.path != PREFERENCE_API_PATH:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "沒有這個 API"})
            return
        try:
            raw_update = read_json_request(self.headers, self.rfile)
            updated_book = self.preference_store.apply_raw_update(raw_update, current_utc_timestamp())
        except PreferenceRequestError as request_error:
            self._send_json(request_error.status_code, {"error": str(request_error)})
            return
        except PreferenceFormatError as format_error:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(format_error)})
            return
        self._send_json(HTTPStatus.OK, json.loads(preference_book_to_json(updated_book)))

    def log_message(self, format: str, *args: Any) -> None:
        """把存取紀錄改成 key=value 格式寫進 logging。"""
        logger.info("event=http_request detail=%s", format % args)


def load_known_asset_ids(rules_path: Path) -> frozenset[str]:
    """從音效規則檔讀出所有素材 id，偏好只接受這些 id。"""
    sound_plan_rules = parse_sound_plan_rules(json.loads(rules_path.read_text(encoding="utf-8")))
    return frozenset(sound_asset.asset_id for sound_asset in sound_plan_rules.sound_assets)


def build_server(port: int, web_directory: Path, preference_store: PreferenceStore) -> ThreadingHTTPServer:
    """建立只監聽 127.0.0.1 的伺服器；port 為 0 時由系統挑一個空的埠（測試用）。"""
    handler_class = type(
        "BoundSceneSoundRequestHandler", (SceneSoundRequestHandler,), {"preference_store": preference_store}
    )
    return ThreadingHTTPServer((LISTEN_HOST, port), partial(handler_class, directory=str(web_directory)))


def configure_logging() -> None:
    """日誌寫到 stderr，格式為 UTC 時間加 key=value。"""
    logging.Formatter.converter = time.gmtime
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="time=%(asctime)s level=%(levelname)s %(message)s",
        datefmt=UTC_TIME_FORMAT,
    )


def main(argument_list: list[str] | None = None) -> int:
    """命令列入口：啟動伺服器直到 Ctrl+C；規則檔或偏好檔讀不到時回傳 1。"""
    argument_parser = argparse.ArgumentParser(description="本機試聽場景音效，並把選用偏好寫回 repo")
    argument_parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    argument_parser.add_argument("--web-directory", type=Path, default=DEFAULT_WEB_DIRECTORY)
    argument_parser.add_argument("--preference-path", type=Path, default=DEFAULT_PREFERENCE_PATH)
    argument_parser.add_argument("--rules-path", type=Path, default=DEFAULT_RULES_PATH)
    parsed_arguments = argument_parser.parse_args(argument_list)
    configure_logging()
    try:
        preference_store = PreferenceStore(
            parsed_arguments.preference_path, load_known_asset_ids(parsed_arguments.rules_path)
        )
        preference_store.read_book()
    except (OSError, ValueError) as startup_error:
        logger.error("event=startup_failed error=%s", startup_error)
        return 1
    scene_server = build_server(parsed_arguments.port, parsed_arguments.web_directory, preference_store)
    logger.info("event=server_started url=http://%s:%d/scene_sounds.html", LISTEN_HOST, scene_server.server_port)
    try:
        scene_server.serve_forever()
    except KeyboardInterrupt:
        logger.info("event=server_stopped reason=keyboard_interrupt")
    finally:
        scene_server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
