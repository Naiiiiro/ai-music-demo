"""命令列入口 evaluate-sound-plan：重新評估一個音效規劃資料夾。

資料夾內容：scene_source.json（場景 HTML 在 GitHub Release 的位置與 SHA-256）、sound_rules.json（規則）、
component_snapshot.json（上一次的組件快照，第一次可以沒有）。
場景 HTML 不進版控：本機沒有或內容不符時先從 Release 下載並核對，再評估、寫出報告與新的快照。
"""

import argparse
import json
import sys
import time
from pathlib import Path

from ai_music_demo.recorded_sound_fetcher import (
    DownloadFunction,
    RecordingFetchError,
    SleepFunction,
    download_url_bytes,
    download_with_retry,
)
from ai_music_demo.scene_component_extractor import ComponentExtractionError, extract_component_snapshot
from ai_music_demo.scene_source_manifest import (
    SceneSourceFormatError,
    content_matches_scene,
    parse_scene_source,
)
from ai_music_demo.sound_plan_evaluation import evaluate_sound_plan
from ai_music_demo.sound_plan_model import (
    ComponentSnapshot,
    SoundPlanFormatError,
    parse_component_snapshot,
    parse_sound_plan_rules,
    snapshot_to_json,
)
from ai_music_demo.sound_plan_report import render_sound_plan_report

RULES_FILE_NAME: str = "sound_rules.json"
SNAPSHOT_FILE_NAME: str = "component_snapshot.json"
SCENE_SOURCE_FILE_NAME: str = "scene_source.json"


def ensure_scene_html(
    plan_directory: Path,
    download_bytes: DownloadFunction = download_url_bytes,
    sleep_seconds: SleepFunction = time.sleep,
) -> Path:
    """確保資料夾裡有內容正確的場景 HTML；本機檔案已相符就跳過下載，下載後不符就失敗。"""
    scene_source = parse_scene_source(
        json.loads((plan_directory / SCENE_SOURCE_FILE_NAME).read_text(encoding="utf-8"))
    )
    scene_path = plan_directory / scene_source.asset_file_name
    if scene_path.is_file() and content_matches_scene(scene_path.read_bytes(), scene_source):
        return scene_path
    file_content = download_with_retry(scene_source.download_url, download_bytes, sleep_seconds)
    if not content_matches_scene(file_content, scene_source):
        raise SceneSourceFormatError(
            f"下載內容與清單不符：{scene_source.download_url}（預期 {scene_source.byte_size} bytes，收到 {len(file_content)} bytes）"
        )
    scene_path.write_bytes(file_content)
    return scene_path


def load_previous_snapshot(snapshot_path: Path) -> ComponentSnapshot | None:
    """讀上一次的快照；第一次評估時沒有。"""
    if not snapshot_path.exists():
        return None
    return parse_component_snapshot(json.loads(snapshot_path.read_text(encoding="utf-8")))


def run_evaluation(plan_directory: Path, snapshot: ComponentSnapshot) -> Path:
    """用指定快照評估並寫出報告與新快照，回傳報告路徑；與 Chrome 無關，方便測試。"""
    rules = parse_sound_plan_rules(json.loads((plan_directory / RULES_FILE_NAME).read_text(encoding="utf-8")))
    snapshot_path = plan_directory / SNAPSHOT_FILE_NAME
    evaluation = evaluate_sound_plan(snapshot, rules, load_previous_snapshot(snapshot_path))
    report_path = plan_directory / rules.report_file_name
    report_path.write_text(render_sound_plan_report(evaluation), encoding="utf-8")
    snapshot_path.write_text(
        json.dumps(snapshot_to_json(snapshot), ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return report_path


def main(argument_list: list[str] | None = None) -> int:
    """解析參數、從 HTML 取出組件並評估；失敗時印出原因並回傳 1。"""
    parser = argparse.ArgumentParser(description="重新評估場景 HTML 的組件音效清單")
    parser.add_argument("plan_directory", type=Path, help="音效規劃資料夾，例如 sound_plans/screw_press_separator")
    parsed_arguments = parser.parse_args(argument_list)
    plan_directory: Path = parsed_arguments.plan_directory
    try:
        snapshot = extract_component_snapshot(ensure_scene_html(plan_directory))
        report_path = run_evaluation(plan_directory, snapshot)
    except (ComponentExtractionError, SoundPlanFormatError, SceneSourceFormatError, RecordingFetchError, OSError) as evaluation_error:
        print(f"評估失敗：{evaluation_error}", file=sys.stderr)
        return 1
    print(f"已寫出 {report_path}（{len(snapshot.components)} 個組件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
