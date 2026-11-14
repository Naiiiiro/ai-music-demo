"""守門測試：Python 端全部用寫定的規則與確定性的訊號合成，不得出現亂數種子或 random 模組。"""

import re
from pathlib import Path

SOURCE_DIRECTORY: Path = Path(__file__).resolve().parent.parent / "src" / "ai_music_demo"
RANDOMNESS_PATTERN: re.Pattern[str] = re.compile(r"seed|import random|np\.random", re.IGNORECASE)


def test_python_sources_use_no_random_seed() -> None:
    offending_paths = [
        source_path.name
        for source_path in sorted(SOURCE_DIRECTORY.glob("*.py"))
        if RANDOMNESS_PATTERN.search(source_path.read_text(encoding="utf-8"))
    ]
    assert offending_paths == []
