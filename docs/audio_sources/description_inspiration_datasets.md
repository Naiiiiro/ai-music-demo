# 標籤與描述的靈感來源

這份文件列出附有音樂標籤（類型、情緒、樂器）或文字描述的資料集。它們原本用來訓練和評估 AI 音樂模型，在這裡有兩種用途：

- 寫提示詞時參考別人怎麼描述音樂，例如「溫暖的 lo-fi 鋼琴，帶黑膠底噪」。
- 整理出一套標籤詞彙，對應到本專案作曲引擎的參數，例如「憂鬱」對應小調、慢速。

要生成音樂的服務在 [prompt_generated_music.md](prompt_generated_music.md)，現成音檔在 [ready_to_use_audio.md](ready_to_use_audio.md)。

## 怎麼讀這份文件

- **內容**：資料集裡有什麼，筆數多少，描述是人寫的還是模型生成的。
- **附不附音檔**：只拿標籤和文字時，通常不用下載音檔。
- **授權**：文字標註和音檔常是兩種授權，表格分開寫。
- **分類**（看文字標註與中繼資料，不看音檔）：A＝免費且可商用、B＝免費但不可商用、?＝無法判定。表格的 A 類排在最前面。CC BY-SA 可商用，但要標示來源，衍生作品也要用同樣授權。
- 標 ⚠️ 的內容沒有對過官方文件。資料查證日期：2026-11-14。分類不是法律意見。

---

## 資料集一覽

| 分類 | 名稱 | 內容 | 附不附音檔 | 授權 |
|---|---|---|---|---|
| A | [Song Describer Dataset（SDD）](https://zenodo.org/records/10072001) | 706 首歌、約 1,100 條人寫的英文描述，專門用來評估「文字生成音樂」與「音樂生成文字」；v1.0.0 發布於 2023-11-16 | 附，音檔取自 MTG-Jamendo | Zenodo 頁面標 CC BY-SA 4.0；音檔依 MTG-Jamendo 各曲的 CC 授權 |
| A | [MusicCaps](https://huggingface.co/datasets/google/MusicCaps)（Google） | 約 5,500 段 10 秒的片段，每段有音樂人寫的長描述和一串關鍵詞（`aspect_list`） | 不附，只給 YouTube 影片 ID 與起訖秒數 | 標註是 CC BY-SA 4.0（Hugging Face 卡片）；音檔版權屬於原 YouTube 影片 |
| A | [MTG-Jamendo](https://github.com/MTG/mtg-jamendo-dataset) | Jamendo 上的歌曲加上上傳者標的標籤，分成類型、樂器、情緒與主題三組；⚠️ 約 5.5 萬首、195 個標籤 | 附 | 程式碼 Apache-2.0；音檔混用 CC 與 CC-NC（禁止商用），要逐首看；⚠️ 標籤檔沒有另外標示授權 |
| A | [FMA（Free Music Archive dataset）](https://github.com/mdeff/fma) | Free Music Archive 的歌曲與類型、藝人、專輯等中繼資料 | 附，有多種大小的子集 | 程式碼 MIT、中繼資料 CC BY 4.0；音檔依各藝人選的 CC 授權；README 註明供研究用途 |
| A | [JamendoMaxCaps](https://huggingface.co/datasets/amaai-lab/JamendoMaxCaps) | 大規模的 Jamendo 音樂描述，缺少的中繼資料用模型補上 | ⚠️ 未確認 | Hugging Face 卡片標 CC BY-SA 3.0；⚠️ 音檔是否沿用 Jamendo 各曲授權未確認 |
| ? | [LP-MusicCaps](https://huggingface.co/datasets/seungheondoh/LP-MusicCaps-MSD) | 用大型語言模型把既有標籤改寫成自然語言描述，數量大 | 不附 | Hugging Face 卡片沒填授權 |

挑選方式：

| 想要的東西 | 先看 |
|---|---|
| 人寫的、品質高的長描述 | MusicCaps、SDD |
| 一套分好類的標籤詞彙 | MTG-Jamendo |
| 數量大、句型多樣的描述 | LP-MusicCaps、JamendoMaxCaps |
| 依音樂類型整理的大量曲目 | FMA |

---

## 怎麼用

以下都用 `uv` 管理套件，在本專案以外的資料夾執行。

MusicCaps：只下載文字，不需要音檔。

```bash
mkdir caption-study && cd caption-study
uv init && uv add datasets
```

```python
"""列出 MusicCaps 前 5 筆的描述與關鍵詞，當作寫提示詞的參考。"""

from datasets import load_dataset

caption_dataset = load_dataset("google/MusicCaps", split="train")
for caption_row in caption_dataset.select(range(5)):
    print(caption_row["caption"])
    print(caption_row["aspect_list"])
```

MTG-Jamendo：clone repo 後，標籤檔在 `data/` 資料夾（TSV 格式，一列一首歌、最後幾欄是標籤），不必下載音檔。

```bash
git clone https://github.com/MTG/mtg-jamendo-dataset.git
head data/autotagging_moodtheme.tsv
```

Song Describer：到 [Zenodo 頁面](https://zenodo.org/records/10072001)下載描述檔與資料說明（`datasheet.pdf`）。

用 Claude Code 查詢：已連上 Hugging Face MCP 時，可以直接請助理搜尋 `music caption` 相關的資料集，或讀取某個資料集的欄位說明。

### 對應到本專案的作曲參數（範例）

本專案的作曲引擎由調性、和弦進行、節奏型決定曲子（見 [README](../../README.md)）。資料集的情緒標籤可以先整理成像下面這樣的對照，再決定要不要變成程式參數：

| 情緒標籤（取自 MTG-Jamendo moodtheme） | 可對應的參數方向 |
|---|---|
| `happy` | 大調、較快的速度 |
| `sad` | 小調、較慢的速度 |
| `energetic` | 較密的大鼓與腳踏鈸節奏 |
| `calm` | 稀疏的節奏、保留 pad 長音 |

這張表只是方向示意，作曲引擎目前沒有讀取這些標籤。

---

## 資料來源

- [Song Describer Dataset 論文](https://arxiv.org/abs/2311.10057v3)
- [Song Describer Dataset（Zenodo）](https://zenodo.org/records/10072001)
- [UPF MTG 軟體與資料集](https://www.upf.edu/web/mtg/software-datasets)
- [JamendoMaxCaps 論文](https://arxiv.org/abs/2502.07461)
- [LP-MusicCaps-MSD（Hugging Face）](https://huggingface.co/datasets/seungheondoh/LP-MusicCaps-MSD/discussions)
- [MusicCaps（Hugging Face）](https://huggingface.co/datasets/google/MusicCaps)
- [JamendoMaxCaps（Hugging Face）](https://huggingface.co/datasets/amaai-lab/JamendoMaxCaps)
- [FMA dataset（GitHub）](https://github.com/mdeff/fma)
