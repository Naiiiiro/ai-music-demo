"""音效規劃的單元測試：組件抽取的文字處理、規則評估、報告與命令列；不啟動 Chrome。"""

import hashlib
import json
import urllib.error
from email.message import Message
from pathlib import Path
from typing import Any

import pytest

from ai_music_demo.recorded_sound_fetcher import RecordingFetchError
from ai_music_demo.scene_component_extractor import (
    ComponentExtractionError,
    extract_tag_definitions,
    inject_component_dump,
    parse_component_dump,
)
from ai_music_demo.scene_source_manifest import SceneSourceFormatError, parse_scene_source
from ai_music_demo.sound_plan_command import ensure_scene_html, run_evaluation
from ai_music_demo.sound_plan_evaluation import evaluate_sound_plan
from ai_music_demo.sound_plan_model import (
    ComponentSnapshot,
    ComponentTag,
    SceneComponent,
    SoundPlanFormatError,
    parse_component_snapshot,
    parse_sound_plan_rules,
)
from ai_music_demo.sound_plan_report import render_sound_plan_report

REPOSITORY_PLAN_DIRECTORY: Path = Path(__file__).resolve().parent.parent / "sound_plans" / "screw_press_separator"
BUNDLED_LIST_DEFINITION: str = "var d0=[...La].map((t,e)=>[t,e]).sort((t,e)=>t[1]-e[1]);"


def build_snapshot(components: tuple[SceneComponent, ...]) -> ComponentSnapshot:
    """兩個類別標籤、一個區域標籤的小快照。"""
    tags = (
        ComponentTag("bird", "鳥類", "Birds"),
        ComponentTag("town", "建築與聚落", "Buildings"),
        ComponentTag("a_farm", "農田區", "Paddy Fields"),
    )
    return ComponentSnapshot(source_html_name="scene.html", tags=tags, components=components)


def build_raw_rules(boundary_component_id: str = "school") -> dict[str, Any]:
    """一組鴨叫素材共用兩隻鴨子，加一筆邊界決議。"""
    return {
        "report_file_name": "plan.md",
        "judgement_principle": "會動的才設計",
        "sound_assets": [
            {
                "asset_id": "duck_quack",
                "chinese_name": "鴨叫聲",
                "sound_description": "鴨叫",
                "component_patterns": ["duck[A-Z]"],
            }
        ],
        "silent_reason_by_type": {"town": "靜態建築"},
        "boundary_decisions": [
            {"component_id": boundary_component_id, "reason": "沒有事件", "decided_on": "2026-11-15"}
        ],
    }


DUCK_A: SceneComponent = SceneComponent("duckA", "稻田鴨 A", "bird", ("bird", "a_farm"))
DUCK_B: SceneComponent = SceneComponent("duckB", "稻田鴨 B", "bird", ("bird", "a_farm"))
SCHOOL: SceneComponent = SceneComponent("school", "國小", "town", ("town", "a_farm"))


def test_inject_component_dump_inserts_script_before_list_definition() -> None:
    patched_html = inject_component_dump("<script>" + BUNDLED_LIST_DEFINITION + "</script>")

    assert patched_html.index("setTimeout") < patched_html.index("var d0=")
    assert "JSON.stringify(d0.map(" in patched_html


def test_inject_component_dump_fails_when_bundle_format_changed() -> None:
    with pytest.raises(ComponentExtractionError):
        inject_component_dump("<script>var other=[1];</script>")


def test_extract_tag_definitions_decodes_escaped_chinese_and_removes_duplicates() -> None:
    escaped_tag = '{id:"bird",zh:"\\u9CE5\\u985E",en:"Birds",color:"#3a7"}'

    tags = extract_tag_definitions(escaped_tag + escaped_tag)

    assert tags == (ComponentTag("bird", "鳥類", "Birds"),)


def test_parse_component_dump_reads_escaped_json_from_dom() -> None:
    payload = '[{"component_id":"duckA","chinese_name":"稻田鴨 A","type_tag_id":"bird","tag_ids":["bird"]}]'
    rendered_dom = '<pre id="sound-plan-component-dump">' + payload.replace('"', "&quot;") + "</pre>"

    assert parse_component_dump(rendered_dom) == (SceneComponent("duckA", "稻田鴨 A", "bird", ("bird",)),)


def test_parse_component_dump_fails_without_dump_element() -> None:
    with pytest.raises(ComponentExtractionError):
        parse_component_dump("<html></html>")


def test_evaluation_counts_area_duplicates_once_and_shares_one_asset() -> None:
    evaluation = evaluate_sound_plan(
        build_snapshot((DUCK_A, DUCK_B, SCHOOL)), parse_sound_plan_rules(build_raw_rules()), None
    )

    assert evaluation.designed_count_with_duplicates == 4
    assert evaluation.designed_components == (DUCK_A, DUCK_B)
    assert evaluation.components_using_asset(evaluation.rules.sound_assets[0]) == (DUCK_A, DUCK_B)


def test_boundary_decision_reason_overrides_type_reason() -> None:
    evaluation = evaluate_sound_plan(build_snapshot((SCHOOL,)), parse_sound_plan_rules(build_raw_rules()), None)

    assert evaluation.silent_reason(SCHOOL) == "沒有事件"


def test_boundary_decision_conflicting_with_asset_fails() -> None:
    rules = parse_sound_plan_rules(build_raw_rules(boundary_component_id="duckA"))

    with pytest.raises(SoundPlanFormatError):
        evaluate_sound_plan(build_snapshot((DUCK_A,)), rules, None)


def test_rule_warnings_report_unmatched_pattern_and_missing_boundary_component() -> None:
    evaluation = evaluate_sound_plan(build_snapshot((SCHOOL,)), parse_sound_plan_rules(build_raw_rules("gone")), None)

    assert len(evaluation.rule_warnings) == 2


def test_version_difference_lists_added_and_removed_components() -> None:
    previous_snapshot = build_snapshot((DUCK_A, SCHOOL))
    current_snapshot = build_snapshot((DUCK_A, DUCK_B))

    evaluation = evaluate_sound_plan(current_snapshot, parse_sound_plan_rules(build_raw_rules()), previous_snapshot)

    assert evaluation.version_difference is not None
    assert evaluation.version_difference.added_components == (DUCK_B,)
    assert evaluation.version_difference.removed_components == (SCHOOL,)


def test_rules_with_duplicated_asset_identifier_fail() -> None:
    raw_rules = build_raw_rules()
    raw_rules["sound_assets"] = raw_rules["sound_assets"] * 2

    with pytest.raises(SoundPlanFormatError):
        parse_sound_plan_rules(raw_rules)


def test_rules_with_invalid_pattern_fail() -> None:
    raw_rules = build_raw_rules()
    raw_rules["sound_assets"][0]["component_patterns"] = ["duck[A-"]

    with pytest.raises(SoundPlanFormatError):
        parse_sound_plan_rules(raw_rules)


def test_report_contains_deduplicated_count_and_asset_count() -> None:
    evaluation = evaluate_sound_plan(
        build_snapshot((DUCK_A, DUCK_B, SCHOOL)), parse_sound_plan_rules(build_raw_rules()), None
    )

    report = render_sound_plan_report(evaluation)

    assert "| **扣除重複後，需設計音效的組件** | **2** |" in report
    assert "| **共用後需要製作的音效素材** | **1** |" in report


SCENE_CONTENT: bytes = b"<html>scene</html>"


def build_raw_scene_source(file_content: bytes = SCENE_CONTENT) -> dict[str, Any]:
    """一份對應 file_content 的合法場景來源清單。"""
    return {
        "release_base_url": "https://github.com/example/demo/releases/download/scene-assets-v1",
        "asset_file_name": "scene-3d.html",
        "sha256": hashlib.sha256(file_content).hexdigest(),
        "byte_size": len(file_content),
    }


def write_scene_source(plan_directory: Path, raw_scene_source: dict[str, Any]) -> None:
    """把場景來源清單寫進測試資料夾。"""
    (plan_directory / "scene_source.json").write_text(json.dumps(raw_scene_source), encoding="utf-8")


def never_sleep(delay_seconds: float) -> None:
    """測試用：重試時不真的等待。"""


def test_ensure_scene_html_downloads_missing_file_and_verifies_hash(tmp_path: Path) -> None:
    write_scene_source(tmp_path, build_raw_scene_source())
    requested_urls: list[str] = []

    scene_path = ensure_scene_html(tmp_path, lambda url: requested_urls.append(url) or SCENE_CONTENT, never_sleep)

    assert scene_path.read_bytes() == SCENE_CONTENT
    assert requested_urls == ["https://github.com/example/demo/releases/download/scene-assets-v1/scene-3d.html"]


def test_ensure_scene_html_skips_download_when_local_file_matches(tmp_path: Path) -> None:
    write_scene_source(tmp_path, build_raw_scene_source())
    (tmp_path / "scene-3d.html").write_bytes(SCENE_CONTENT)

    def refuse_download(download_url: str) -> bytes:
        raise AssertionError(f"不應該下載：{download_url}")

    assert ensure_scene_html(tmp_path, refuse_download, never_sleep).read_bytes() == SCENE_CONTENT


def test_ensure_scene_html_fails_when_downloaded_content_differs(tmp_path: Path) -> None:
    write_scene_source(tmp_path, build_raw_scene_source())

    with pytest.raises(SceneSourceFormatError):
        ensure_scene_html(tmp_path, lambda download_url: b"tampered", never_sleep)
    assert not (tmp_path / "scene-3d.html").exists()


def test_ensure_scene_html_propagates_permanent_download_error(tmp_path: Path) -> None:
    write_scene_source(tmp_path, build_raw_scene_source())

    def missing_asset(download_url: str) -> bytes:
        raise urllib.error.HTTPError(download_url, 404, "Not Found", Message(), None)

    with pytest.raises(RecordingFetchError):
        ensure_scene_html(tmp_path, missing_asset, never_sleep)


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("asset_file_name", "../escape.html"),
        ("release_base_url", "http://insecure.example/assets"),
        ("sha256", "not-a-hash"),
        ("byte_size", 0),
    ],
)
def test_parse_scene_source_rejects_invalid_field(field_name: str, invalid_value: Any) -> None:
    raw_scene_source = build_raw_scene_source()
    raw_scene_source[field_name] = invalid_value

    with pytest.raises(SceneSourceFormatError):
        parse_scene_source(raw_scene_source)


def test_repository_scene_source_is_valid() -> None:
    scene_source = parse_scene_source(
        json.loads((REPOSITORY_PLAN_DIRECTORY / "scene_source.json").read_text(encoding="utf-8"))
    )

    assert scene_source.download_url.endswith("/scene-assets-v1/screw-press-separator-3d.html")


def test_run_evaluation_writes_report_and_snapshot(tmp_path: Path) -> None:
    (tmp_path / "sound_rules.json").write_text(json.dumps(build_raw_rules(), ensure_ascii=False), encoding="utf-8")

    report_path = run_evaluation(tmp_path, build_snapshot((DUCK_A, SCHOOL)))

    assert report_path.read_text(encoding="utf-8").startswith("# scene.html")
    assert (tmp_path / "component_snapshot.json").exists()


def test_repository_plan_keeps_reviewed_counts() -> None:
    """回歸：目前這版 HTML 評估出 129 個需設計組件、44 組共用素材，且所有規則都有效。"""
    snapshot = parse_component_snapshot(
        json.loads((REPOSITORY_PLAN_DIRECTORY / "component_snapshot.json").read_text(encoding="utf-8"))
    )
    rules = parse_sound_plan_rules(
        json.loads((REPOSITORY_PLAN_DIRECTORY / "sound_rules.json").read_text(encoding="utf-8"))
    )

    evaluation = evaluate_sound_plan(snapshot, rules, None)

    assert len(snapshot.components) == 1211
    assert len(evaluation.designed_components) == 129
    assert len(rules.sound_assets) == 44
    assert evaluation.rule_warnings == ()
