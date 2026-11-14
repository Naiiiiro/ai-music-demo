"""把 SoundPlanEvaluation 寫成 Markdown 報告。純文字組裝，不讀寫檔案。"""

from collections import defaultdict

from ai_music_demo.sound_plan_evaluation import SoundPlanEvaluation, TagEvaluation
from ai_music_demo.sound_plan_model import SceneComponent

REGENERATE_COMMAND: str = "uv run evaluate-sound-plan <本資料夾>"


def join_component_names(components: tuple[SceneComponent, ...]) -> str:
    """組件名稱用頓號串起來。"""
    return "、".join(component.chinese_name for component in components)


def render_header(evaluation: SoundPlanEvaluation) -> list[str]:
    """標題、來源與判斷原則。"""
    snapshot = evaluation.snapshot
    type_tag_count = sum(1 for tag in snapshot.tags if not tag.is_area_tag)
    return [
        f"# {snapshot.source_html_name} 組件音效建議清單",
        "",
        f"> 此檔由 `{REGENERATE_COMMAND}` 產生，請改 `sound_rules.json` 後重跑，不要手動編輯。",
        "",
        (
            f"- **來源：** `{snapshot.source_html_name}` 執行時的組件清單，共 {len(snapshot.components)} 個組件、"
            f"{len(snapshot.tags)} 個標籤（類別 {type_tag_count}、區域 {len(snapshot.tags) - type_tag_count}）"
        ),
        f"- **判斷原則：** {evaluation.rules.judgement_principle}",
        "",
    ]


def render_statistics(evaluation: SoundPlanEvaluation) -> list[str]:
    """去重前後的數量與素材數。"""
    designed_count = len(evaluation.designed_components)
    total_count = len(evaluation.snapshot.components)
    return [
        "## 一、統計",
        "",
        "| 項目 | 數量 |",
        "|---|---|",
        f"| 各標籤「建議設計」直接相加（含重複） | {evaluation.designed_count_with_duplicates} |",
        f"| **扣除重複後，需設計音效的組件** | **{designed_count}** |",
        f"| 不設計音效的組件 | {total_count - designed_count} |",
        f"| 組件總數 | {total_count} |",
        f"| **共用後需要製作的音效素材** | **{len(evaluation.rules.sound_assets)}** |",
        "",
        "- 每個組件剛好一個類別標籤，所以類別標籤的「建議設計」相加就等於去重後的數量。",
        "- 一個組件可以用到不只一組素材（例如噴水池加鐘聲），所以素材的使用次數加總會比組件數多。",
        "",
    ]


def render_asset_table(evaluation: SoundPlanEvaluation) -> list[str]:
    """每組共用素材由哪些組件使用。"""
    lines = [
        "## 二、共用音效素材",
        "",
        "| 素材 | 聲音內容 | 可沿用 repo 既有音效 | 使用的組件數 | 使用的組件 |",
        "|---|---|---|---|---|",
    ]
    for asset in evaluation.rules.sound_assets:
        users = evaluation.components_using_asset(asset)
        reusable_effect = asset.reusable_repository_effect or "否"
        lines.append(
            f"| {asset.chinese_name}（`{asset.asset_id}`） | {asset.sound_description} | {reusable_effect} "
            f"| {len(users)} | {join_component_names(users)} |"
        )
    return [*lines, ""]


def render_boundary_decisions(evaluation: SoundPlanEvaluation) -> list[str]:
    """使用者確認過的邊界組件。"""
    names_by_identifier = {c.component_id: c.chinese_name for c in evaluation.snapshot.components}
    lines = ["## 三、邊界組件決議（維持不設計）", "", "| 組件 | 理由 | 決議日期 |", "|---|---|---|"]
    for decision in evaluation.rules.boundary_decisions:
        component_name = names_by_identifier.get(decision.component_id, f"`{decision.component_id}`（這一版已不存在）")
        lines.append(f"| {component_name} | {decision.reason} | {decision.decided_on} |")
    return [*lines, ""]


def render_version_difference(evaluation: SoundPlanEvaluation) -> list[str]:
    """和上一份快照的差異；新增組件需要人工判斷後補進規則。"""
    difference = evaluation.version_difference
    lines = ["## 四、與上一版的差異", ""]
    if difference is None:
        return [*lines, "- 第一次評估，沒有上一版可比較。", ""]
    if not difference.added_components and not difference.removed_components:
        return [*lines, "- 組件清單和上一版相同。", ""]
    lines.append(f"- **新增 {len(difference.added_components)} 個（目前依規則判定，請人工確認）：**")
    lines += [
        f"  - {c.chinese_name}（`{c.component_id}`）：{'建議設計' if evaluation.assets_by_component[c.component_id] else '不設計'}"
        for c in difference.added_components
    ]
    lines.append(
        f"- **移除 {len(difference.removed_components)} 個：** {join_component_names(difference.removed_components)}"
    )
    return [*lines, ""]


def render_rule_warnings(evaluation: SoundPlanEvaluation) -> list[str]:
    """這一版 HTML 已經失效的規則。"""
    if not evaluation.rule_warnings:
        return ["## 五、規則檢查", "", "- 所有規則都比對得到組件。", ""]
    return ["## 五、規則檢查", "", *[f"- ⚠️ {warning}" for warning in evaluation.rule_warnings], ""]


def render_tag_section(evaluation: SoundPlanEvaluation, tag_evaluation: TagEvaluation) -> list[str]:
    """一個標籤：建議設計的組件附素材名，不設計的組件依理由分組。"""
    tag = tag_evaluation.tag
    designed = tag_evaluation.designed_components
    silent = tag_evaluation.silent_components
    tag_kind = "區域標籤" if tag.is_area_tag else "類別標籤"
    lines = [
        f"### {tag.chinese_name}（{tag_kind}）— 共 {len(designed) + len(silent)}，建議設計 {len(designed)}，不設計 {len(silent)}",
        "",
        "**建議設計音效**",
        "",
    ]
    for component in designed:
        asset_names = "、".join(asset.chinese_name for asset in evaluation.assets_by_component[component.component_id])
        lines.append(f"- {component.chinese_name}：{asset_names}")
    if not designed:
        lines.append("- （無）")
    lines += ["", "**不設計音效**", ""]
    components_by_reason: dict[str, list[SceneComponent]] = defaultdict(list)
    for component in silent:
        components_by_reason[evaluation.silent_reason(component)].append(component)
    for reason, components in components_by_reason.items():
        lines.append(f"- {reason}（{len(components)}）：{join_component_names(tuple(components))}")
    if not silent:
        lines.append("- （無）")
    return [*lines, ""]


def render_sound_plan_report(evaluation: SoundPlanEvaluation) -> str:
    """組出完整報告。"""
    lines = [
        *render_header(evaluation),
        *render_statistics(evaluation),
        *render_asset_table(evaluation),
        *render_boundary_decisions(evaluation),
        *render_version_difference(evaluation),
        *render_rule_warnings(evaluation),
        "## 六、各標籤清單",
        "",
    ]
    for tag_evaluation in evaluation.tag_evaluations:
        lines += render_tag_section(evaluation, tag_evaluation)
    return "\n".join(lines)
