# 可直接使用的音檔來源

這份文件列出拿來就能用的現成音樂和音效：一類是讓 Claude 等 AI 助理直接呼叫的 MCP 伺服器，一類是免版稅音樂庫，一類是音效庫。要靠提示詞生成音樂的來源在 [prompt_generated_music.md](prompt_generated_music.md)，標籤和描述的靈感來源在 [description_inspiration_datasets.md](description_inspiration_datasets.md)。

## 怎麼讀這份文件

- 每個來源分成四欄：**分類**、**能拿到什麼**、**授權**（能不能商用、要不要標示作者）、**怎麼用**（指令或步驟）。
- **分類**：A＝免費且可商用、B＝免費但不可商用、C＝付費才可商用、D＝付費但商用權不明、?＝無法判定、—＝不提供音檔。同一來源有免費版和付費版時，以最便宜的可商用方案歸類；逐筆授權的來源標「A（逐筆）」，只有篩選出 CC0、CC BY、CC BY-SA 的檔案屬於 A。每張表的 A 類排在最前面。
- CC（Creative Commons）是一套公開授權；名稱帶 NC（NonCommercial）的禁止商用。
- 標 ⚠️ 的內容只來自第三方文章或目錄網站，沒有對過官方文件；正式使用前請到官方頁面再確認。
- 資料查證日期：2026-11-14。分類不是法律意見。
- 金鑰一律放在環境變數，不寫進程式碼或指令紀錄。

## 跟本 repo 的關係

本專案的音樂全部由程式現場合成，不用取樣也不放音訊檔：`.gitignore` 擋掉 `*.wav`、`*.mp3` 等副檔名，`web/tests/no_audio_binary.test.mjs` 會在 `web/` 出現音訊檔時失敗。從下列來源下載的檔案請放在 `output/`（已被 `.gitignore` 排除）或 repo 以外的資料夾，只拿來試聽、比較或當參考。

---

## 1. MCP 伺服器

MCP（Model Context Protocol）是讓 AI 助理呼叫外部工具的標準介面。裝好之後，在 Claude Code 對話裡直接說「生成一段 30 秒的 lo-fi 音樂」或「找下雨的音效」，助理就會呼叫對應的伺服器。MCP 伺服器只是轉接層，生成或下載內容的授權跟著背後的服務走。

| 分類 | 名稱 | 能拿到什麼 | 授權與費用 | 狀態 |
|---|---|---|---|---|
| A（逐筆） | Freesound MCP（`johnkimdw/freesound-mcp-server`） | 搜尋與下載 Freesound 音效 | 依每個音效自己的 CC 授權；Freesound API 本身商用要跟營運單位 UPF（西班牙龐培法布拉大學）逐案談 | ⚠️ 只在目錄看到，功能與維護狀態不明 |
| C | ElevenLabs 官方 MCP（`elevenlabs-mcp`） | 生成音樂、音效、語音，也能轉錄與變聲 | 免費方案能生成，但沒有商用授權；Starter 方案（每月 6 美元起）起可商用 | 目前最成熟；2026-05 推出 v0.4.0 |
| C | ElevenLabs Music 社群 MCP（`jeremybradford-p171/elevenlabs-music-mcp`） | 專門串接 Eleven Music 的音樂生成 | 同 ElevenLabs 官方 MCP | ⚠️ 社群維護 |
| D | AceDataCloud Suno MCP（`mcp-suno`） | Suno 的整首歌生成、歌詞、翻唱 | 用 AceDataCloud 的 token 計費，不是 Suno 帳號；Suno 沒有官方公開 API，經代理生成的歌商用權歸誰沒有依據；Suno 的版權訴訟還沒結束 | ⚠️ 曾有目錄標成 unhealthy |
| D | RunAPI Suno MCP（`@runapi.ai/suno-mcp`） | 同上，經 RunAPI 代理 | 用 `RUNAPI_API_KEY` 計費；商用權問題同 AceDataCloud | ⚠️ 第三方代理 |
| — | Spotify MCP（`marcelmarais/spotify-mcp-server`） | 控制播放、搜尋、管理播放清單；**拿不到音檔** | 只能在 Spotify 內收聽，不能下載或再散布 | 舊的 `varunneal/spotify-mcp` 已在 2026-03 標為停止維護 |
| — | DAW 類 MCP（Ableton Live、REAPER、FL Studio、SuperCollider） | 讓助理操作編曲軟體或聲音合成語言 | 依各軟體授權 | ⚠️ 名單見 [ChatForest 的評測](https://chatforest.com/reviews/music-audio-production-mcp-servers/)，個別專案未驗證 |

### 怎麼裝

ElevenLabs（需要 [uv](https://docs.astral.sh/uv/)，金鑰到 ElevenLabs 後台申請）：

```bash
export ELEVENLABS_API_KEY=...        # 放進 shell 設定或密碼管理工具，不要寫進 repo
claude mcp add elevenlabs --env ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" -- uvx elevenlabs-mcp
```

AceDataCloud Suno（遠端伺服器，本機不用安裝）：

```bash
export ACEDATA_TOKEN=...
claude mcp add suno --transport http https://suno.mcp.acedata.cloud/mcp \
  --header "Authorization: Bearer $ACEDATA_TOKEN"
```

其餘伺服器照各自 README 安裝。裝完用 `claude mcp list` 確認連線狀態。

---

## 2. 免版稅音樂庫（現成曲目）

| 分類 | 名稱 | 能拿到什麼 | 授權與費用 | 有沒有 API |
|---|---|---|---|---|
| A | [Pixabay Music](https://pixabay.com/music/) | 免費背景音樂 | Pixabay Content License：免費、可商用、不必標示作者；不能把原檔單獨轉賣或散布，要混進自己的作品裡用；2019-01-09 前上架的是 CC0。⚠️ 仍可能被 YouTube Content ID 認領（條款沒提，來自第三方文章） | 沒有公開的音樂 API，只能手動下載 |
| A（逐筆） | [Jamendo](https://developer.jamendo.com/) | 獨立音樂人的 CC 授權歌曲，可依類型、情緒、樂器標籤搜尋 | 每首歌各有 CC 授權，不帶 NC 的可商用；要標示作者並連回該曲的 Jamendo 頁面；API 免費但只限非商用，商用要找 Jamendo 另談（API 條款 3.3），條款沒寫具體請求上限 | 有，REST API，需要 `client_id` |
| A（逐筆） | [Free Music Archive](https://freemusicarchive.org/) | 獨立音樂，網站可依類型瀏覽 | 作者自選授權（CC0、CC BY、BY-SA、BY-ND、BY-NC 系列），不帶 NC 的可商用；舊的「FMA-Limited」曲目只能個人收聽；FMA 本身不出授權 | 官方 FAQ 沒提 API，以網站手動下載為主 |
| C | [Epidemic Sound](https://developers.epidemicsound.com/docs/) | 約 5.5 萬首歌、25 萬個音效，回傳的下載連結已附授權 | 免費 key 可拿完整曲庫做原型、測試，不能上線或商用；上線要 Scale 或 Enterprise 方案，價格沒公開 | 有 |
| C | Soundstripe、Musicbed | 影音配樂用的付費曲庫 | ⚠️ 訂閱制；Musicbed 是逐案談的授權（未查官方條款） | ⚠️ 沒查到 API 細節 |

### 怎麼用

Jamendo：搜尋「lofi」標籤、能下載的歌，結果裡的 `audiodownload` 是下載網址，`license_ccurl` 是這首歌的授權。網址不含 `-nc` 的才能商用。

```bash
export JAMENDO_CLIENT_ID=...
curl "https://api.jamendo.com/v3.0/tracks/?client_id=$JAMENDO_CLIENT_ID&format=json&limit=10&tags=lofi&audioformat=mp32"
```

Epidemic Sound：到開發者後台申請免費 key，依[官方文件](https://developers.epidemicsound.com/docs/)呼叫搜尋與下載端點。⚠️ 端點路徑這裡沒有逐一驗證。

Free Music Archive、Pixabay：網站上搜尋後手動下載，把授權條款連結記在同一個資料夾的文字檔裡。

---

## 3. 音效（SFX）

| 分類 | 名稱 | 能拿到什麼 | 授權與費用 | 有沒有 API |
|---|---|---|---|---|
| A（逐筆） | [Openverse](https://api.openverse.org/) | 一次搜尋 Freesound、Jamendo、Wikimedia Commons 的開放授權音訊 | 每筆結果附授權，可以用 `license_type=commercial` 篩出能商用的；官方聲明不保證授權資訊正確，要回原站核對。⚠️ API 服務條款未讀 | 有，匿名也能用（有速率限制） |
| A（逐筆） | [Freesound](https://freesound.org/docs/api/) | 60 萬個以上的音效與取樣，社群上傳 | 每個音效各有 CC 授權，CC0、CC BY 可商用；API 免費但只限非商用，商用要跟 UPF 逐案談；不能整庫複製 | 有，需要 token |
| B | BBC Sound Effects | BBC 的音效檔案庫，3.3 萬個以上，可下載 WAV 或 MP3 | ⚠️ RemArc 授權：只限個人、教育、研究用途，AI 訓練不算研究，不可商用；商用要透過 Pro Sound Effects 另購（來自新聞報導，未讀授權原文） | ⚠️ 未確認，網站可手動下載 |
| C | ElevenLabs Sound Effects | 用文字描述生成音效，例如「雨打在鐵皮屋頂」 | 免費方案沒有商用授權；Starter 方案（每月 6 美元起）起可商用 | 有，也可透過上面的 ElevenLabs MCP |
| C | Epidemic Sound | 25 萬個音效 | 同上方音樂庫：免費 key 只能做原型，上線要付費 | 有 |

### 怎麼用

Openverse：搜尋可商用的「rain」音效，不需要金鑰。

```bash
curl "https://api.openverse.org/v1/audio/?q=rain&license_type=commercial"
```

Freesound：到 `https://freesound.org/apiv2/apply` 申請 token。用 token 可以搜尋和下載預覽檔（`previews` 欄位）；下載原始檔要走 OAuth2 登入。

```bash
export FREESOUND_API_KEY=...
curl "https://freesound.org/apiv2/search/text/?query=engine&fields=id,name,license,previews&token=$FREESOUND_API_KEY"
```

ElevenLabs Sound Effects：

```bash
curl -X POST https://api.elevenlabs.io/v1/sound-generation \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text": "cat meowing softly, close microphone"}' \
  --output output/cat_meow.mp3
```

---

## 資料來源

- [ChatForest：Music/Audio MCP servers](https://chatforest.com/reviews/music-audio-production-mcp-servers/)
- [ElevenLabs MCP](https://docsearch.algolia.com/mcp/docs/repo/elevenlabs/elevenlabs-mcp)
- [ElevenLabs 價格與方案](https://elevenlabs.io/pricing)
- [ElevenLabs Music 社群 MCP](https://lobehub.com/zh-TW/mcp/jeremybradford-p171_elevenlabs-music-mcp)
- [mcp-suno（PyPI）](https://pypi.org/project/mcp-suno/)
- [@runapi.ai/suno-mcp](https://socket.dev/npm/package/@runapi.ai/suno-mcp)
- [Freesound MCP Server](https://glama.ai/mcp/servers/cqv73xdc39)
- [Freesound API 使用條款](https://freesound.org/help/tos_api)
- [Openverse](https://www.firecrawl.dev/alexandria/agents/providers/openverse-org)
- [Openverse：用 Openverse 做的應用（含授權聲明）](https://docs.openverse.org/api/reference/made_with_ov.html)
- [Jamendo API](https://publicapis.io/jamendo-api)
- [Jamendo API 使用條款](https://devportal.jamendo.com/api_terms_of_use)
- [Free Music Archive FAQ](https://freemusicarchive.org/faq)
- [Pixabay 授權條款](https://pixabay.com/service/terms/)
- [Shotstack：影片與 App 的免費音樂](https://shotstack.io/learn/how-to-get-free-music-for-video-project-app)
- [Epidemic Sound API](https://www.epidemicsound.com/blog/epidemic-sound-api/)
- [Epidemic Sound：免費試用 API](https://www.epidemicsound.com/blog/free-api/)
- [MusicRadar：BBC 開放音效下載](https://www.musicradar.com/news/the-bbc-is-letting-you-download-more-than-16000-free-sound-effect-samples-from-its-archive)
