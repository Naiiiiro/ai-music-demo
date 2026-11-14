# ai-music-demo

這是演算法作曲的示範專案：程式只依樂理規則產生音樂，**不使用任何 AI 模型，也不用取樣音色**。專案用來比較兩種把音樂放上網站的做法各要多少資源：

| 做法 | 程式 | 伺服器要傳給訪客的東西 |
|---|---|---|
| 伺服器預先算好，訪客下載音訊檔（只估算，不實際產生） | `src/ai_music_demo/`（Python） | WAV 或 AAC 檔，大小由 `benchmark-resources` 用公式算出 |
| 訪客的瀏覽器即時作曲、即時合成 | `web/`（JavaScript + Web Audio） | 音樂約 9 KB 的程式碼（gzip 壓縮後，加上音效共約 16 KB） |

音訊 binary 只在瀏覽器裡產生：Python 端只在記憶體合成、量測，不寫出任何音訊檔；`.gitignore` 擋掉所有音訊副檔名，`web/tests/no_audio_binary.test.mjs` 會在 `web/` 出現音訊檔時失敗。

## 音樂性從哪裡來

| 元素 | 規則 | 程式位置 |
|---|---|---|
| 和聲 | 流行樂的 I–V–vi–IV 和弦進行。在 C 大調就是 C、G、Am、F | `music_theory.py` |
| 旋律 | 兩個寫定的樂句輪流出現：偶數小節往上走（問句），奇數小節往下收（答句），音高跟著當小節的和弦移動。每小節第一拍一定落在和弦音上，所以聽起來是「對的」 | `composition_engine.py`、`web/browser_composer.js` |
| 節奏 | Euclidean rhythm（把 k 個鼓點盡量平均分到 n 格）。大鼓是 (4,16)，也就是四拍子；腳踏鈸是 (7,16)，帶出切分感 | `rhythm_patterns.py` |
| 音色 | 正弦波加泛音合成樂音；大鼓是頻率往下滑的正弦波，腳踏鈸是六個不成整數倍頻的方波疊加（TR-808 的做法），聽起來像金屬 | `audio_renderer.py` |
| 網頁版多出的樂器 | pad（兩個微走音的鋸齒波加低通濾波，比和弦高一個八度）、clap（三下接連的金屬聲經帶通濾波，打在第 2、4 拍）、pluck（Karplus-Strong 撥弦：一個週期的鋸齒波反覆平均衰減，依 Euclidean (5,16) 彈和弦琶音） | `web/browser_composer.js`、`web/instrument_voices.js` |
| 混音（僅網頁版） | send/return：每個樂器保留乾聲，再按比例送到共用的 reverb、delay 匯流排；總輸出經 limiter。reverb 的殘響由 Schroeder 網路（四條 comb filter 並聯、兩個 allpass filter 串接）現場算出。只有一種固定配置 | `web/mixing_console.js` |

整個 repo 不用亂數也不用隨機種子：所有規則和音色都是寫定的公式，每次產生的曲子都一樣。`web/tests/no_seed_usage.test.mjs` 和 `tests/test_no_seed_usage.py` 會在原始碼出現種子或亂數時失敗。

## 音效（與音樂分開）

網頁另有獨立的音效區，用自己的 AudioContext 播放，不經過音樂混音台，也一樣不載入音訊檔。訊號與控制曲線在 `web/effect_signals.js`（純計算，可在 Node 測試），接濾波器與排程在 `web/sound_effects.js`。

自然的聲音需要寬頻雜訊（輪胎、排氣、氣音）。這裡不用亂數，改用 31 位元 LFSR（線性回授移位暫存器，老遊戲機雜訊聲道的做法）：固定起始狀態、純位元運算，每次輸出都一樣（`signal_generators.js` 的 `generate_noise_samples`）。

| 音效 | 合成方式 |
|---|---|
| 引擎（8 秒） | 依轉速算出每次點火的時間點，每次點火產生一個帶雜訊、快速衰減的排氣脈衝；四個汽缸力道不同、點火時間有 ±4% 偏移，聽起來有「噗噗」的起伏。再經兩個排氣管共鳴（140、520 Hz），高頻量跟著轉速與油門變化。時間軸：怠速 → 催油 → 收油換檔 → 再催 → 滑回怠速 |
| 車流（30 秒） | 每台車是胎噪（LFSR 雜訊經帶通）加低沉引擎音。音量依 1/距離、左右依方位角、音高依距離變化速度連續套用都卜勒（胎噪的中心頻率也一起變，經過時有「咻——」往下掉），越遠高頻越少。兩條車道、8 台車寫定在 `TRAFFIC_PASSES`；背景是低通後緩慢起伏的遠方車流 |
| 貓叫（約 1 秒） | 泛音依 1/k^1.4 遞減的聲帶波形，加兩個不等速的顫音與隨聲帶開合起伏的氣音；嘴型從閉（「m」鼻音）到開再收，三個共鳴峰從「i」經「a」滑到「u」，所有轉折都用平滑曲線 |

## 使用方式

```bash
uv sync
uv run benchmark-resources --output output/benchmark.json           # 量測不同曲長的資源用量（JSON，不產生音訊檔）
uv run pytest                                                       # Python 測試
node --test web/tests                                               # JavaScript 測試

# 網頁版：瀏覽器的 ES module 必須透過 HTTP 載入
python3 -m http.server 8765 --directory web    # 開啟 http://127.0.0.1:8765
# 網址加上 ?benchmark=1 會跑離線量測，結果印在頁面上和 console 裡
```

模組分層見 [docs/module_map.md](docs/module_map.md)。

## 外部音訊來源（參考資料，本專案不使用）

想拿現成音檔或 AI 生成的音樂當對照組時，可以從下面三份文件找來源和使用方式。下載或生成的檔案請放在 `output/`，不要放進 repo。

| 文件 | 內容 |
|---|---|
| [可直接使用的音檔來源](docs/audio_sources/ready_to_use_audio.md) | MCP 伺服器、免版稅音樂庫、音效庫 |
| [用提示詞生成音樂的來源](docs/audio_sources/prompt_generated_music.md) | 雲端 AI 音樂生成 API、可在本機跑的開源模型 |
| [標籤與描述的靈感來源](docs/audio_sources/description_inspiration_datasets.md) | 附音樂標籤或文字描述的資料集 |
