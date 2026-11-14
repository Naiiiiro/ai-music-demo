"""從打包好的 3D 場景 HTML 取出完整的標籤與組件清單。

組件清單大多是頁面執行時才產生的，原始碼裡搜不到全部，所以做法是：
在打包程式定義組件陣列的地方插入一小段輸出程式，用 headless Chrome 跑一次，
再從輸出的 DOM 讀回 JSON。純文字處理的函式和呼叫 Chrome 的函式分開。
"""

import html
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from ai_music_demo.sound_plan_model import ComponentSnapshot, ComponentTag, SceneComponent

DUMP_ELEMENT_ID: str = "sound-plan-component-dump"
DEFAULT_CHROME_EXECUTABLE_PATH: str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_TIMEOUT_SECONDS: int = 300
CHROME_VIRTUAL_TIME_BUDGET_MILLISECONDS: int = 8000

# 組件陣列的定義長這樣：var d0=[...La].map((t,e)=>[t,e]).sort(...)；壓縮後的變數名每版可能不同，所以用結構比對。
COMPONENT_LIST_DEFINITION_PATTERN: re.Pattern[str] = re.compile(
    r"var (?P<list_name>[\w$]+)=\[\.\.\.[\w$]+\]\.map\(\((?P<item>[\w$]+),(?P<index>[\w$]+)\)=>"
    r"\[(?P=item),(?P=index)\]\)\.sort\("
)
TAG_DEFINITION_PATTERN: re.Pattern[str] = re.compile(
    r'\{id:"(?P<tag_id>[\w-]+)",zh:"(?P<chinese_name>[^"]+)",en:"(?P<english_name>[^"]+)",color:"#[0-9A-Fa-f]+"'
)
UNICODE_ESCAPE_PATTERN: re.Pattern[str] = re.compile(r"\\u([0-9A-Fa-f]{4})")
DUMP_ELEMENT_PATTERN: re.Pattern[str] = re.compile(rf'<pre id="{DUMP_ELEMENT_ID}">(?P<payload>.*?)</pre>', re.DOTALL)


class ComponentExtractionError(RuntimeError):
    """無法從 HTML 取出組件清單。"""


def decode_unicode_escapes(source_text: str) -> str:
    """把打包程式裡的 \\uXXXX 轉回文字，讓中文標籤名稱可以直接比對。"""
    return UNICODE_ESCAPE_PATTERN.sub(lambda match: chr(int(match.group(1), 16)), source_text)


def build_dump_script(list_name: str) -> str:
    """產生插入用的 JS：等目前的同步程式跑完，再把組件陣列寫進一個 <pre>。"""
    return (
        "setTimeout(()=>{let dumpElement=document.createElement('pre');"
        f"dumpElement.id='{DUMP_ELEMENT_ID}';"
        f"dumpElement.textContent=JSON.stringify({list_name}.map(item=>"
        "({component_id:item.id,chinese_name:item.zh,type_tag_id:item.type,tag_ids:item.tags})));"
        "document.body.appendChild(dumpElement)},0);"
    )


def inject_component_dump(page_html: str) -> str:
    """在組件陣列定義前插入輸出程式；找不到或找到不只一處時失敗。"""
    matches = list(COMPONENT_LIST_DEFINITION_PATTERN.finditer(page_html))
    if len(matches) != 1:
        raise ComponentExtractionError(f"組件陣列定義應該剛好一處，實際找到 {len(matches)} 處；打包格式可能改了")
    definition = matches[0]
    insertion_index = definition.start()
    return page_html[:insertion_index] + build_dump_script(definition.group("list_name")) + page_html[insertion_index:]


def extract_tag_definitions(page_html: str) -> tuple[ComponentTag, ...]:
    """從原始碼取出所有標籤定義（類別與區域），依出現順序、去除重複。"""
    tags_by_identifier: dict[str, ComponentTag] = {}
    for match in TAG_DEFINITION_PATTERN.finditer(decode_unicode_escapes(page_html)):
        tags_by_identifier.setdefault(
            match.group("tag_id"),
            ComponentTag(match.group("tag_id"), match.group("chinese_name"), match.group("english_name")),
        )
    if not tags_by_identifier:
        raise ComponentExtractionError("原始碼裡找不到任何標籤定義")
    return tuple(tags_by_identifier.values())


def parse_component_dump(rendered_dom: str) -> tuple[SceneComponent, ...]:
    """從 headless Chrome 輸出的 DOM 讀回組件清單。"""
    match = DUMP_ELEMENT_PATTERN.search(rendered_dom)
    if match is None:
        raise ComponentExtractionError("輸出的 DOM 裡沒有組件清單；頁面可能在定義組件前就出錯")
    raw_components = json.loads(html.unescape(match.group("payload")))
    return tuple(
        SceneComponent(
            component_id=raw_component["component_id"],
            chinese_name=raw_component["chinese_name"],
            type_tag_id=raw_component["type_tag_id"],
            tag_ids=tuple(raw_component["tag_ids"]),
        )
        for raw_component in raw_components
    )


def render_page_dom(page_path: Path) -> str:
    """用 headless Chrome 執行頁面並回傳 DOM；Chrome 路徑可用 CHROME_EXECUTABLE_PATH 覆寫。"""
    chrome_executable_path = os.getenv("CHROME_EXECUTABLE_PATH", DEFAULT_CHROME_EXECUTABLE_PATH)
    command = [
        chrome_executable_path,
        "--headless=new",
        "--disable-gpu",
        f"--virtual-time-budget={CHROME_VIRTUAL_TIME_BUDGET_MILLISECONDS}",
        "--dump-dom",
        page_path.resolve().as_uri(),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=CHROME_TIMEOUT_SECONDS, check=True)
    except (OSError, subprocess.SubprocessError) as chrome_error:
        raise ComponentExtractionError(
            f"headless Chrome 執行失敗：{chrome_executable_path}，{page_path}"
        ) from chrome_error
    return completed.stdout


def extract_component_snapshot(page_path: Path) -> ComponentSnapshot:
    """讀取 HTML、在暫存資料夾裡插入輸出程式並執行，回傳完整快照；原檔不會被改動。"""
    page_html = page_path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as temporary_directory:
        patched_page_path = Path(temporary_directory) / page_path.name
        patched_page_path.write_text(inject_component_dump(page_html), encoding="utf-8")
        rendered_dom = render_page_dom(patched_page_path)
    return ComponentSnapshot(
        source_html_name=page_path.name,
        tags=extract_tag_definitions(page_html),
        components=parse_component_dump(rendered_dom),
    )
