# 用提示詞生成音樂的來源

這份文件列出要先給文字提示詞（或旋律、歌詞）才會產生音樂的來源：雲端付費 API，以及可以下載權重、自己在本機跑的開源模型。拿來就能用的現成音檔在 [ready_to_use_audio.md](ready_to_use_audio.md)，寫提示詞時可參考的標籤與描述在 [description_inspiration_datasets.md](description_inspiration_datasets.md)。

## 怎麼讀這份文件

- **分類**：A＝免費且可商用、B＝免費但不可商用、C＝付費才可商用、D＝付費但商用權不明、?＝無法判定。同一來源有免費版和付費版時，以最便宜的可商用方案歸類。每張表的 A 類排在最前面。
- **輸入**：要給什麼才能生成，例如文字描述、歌詞、一段參考旋律。
- **輸出**：能生成多長、有沒有人聲、檔案格式。
- **授權**：生成結果能不能商用；開源模型另外分「程式碼」與「模型權重」兩種授權，兩者常常不同，以較嚴的那個為準。
- 標 ⚠️ 的內容只來自第三方文章，沒有對過官方文件。資料查證日期：2026-11-14。分類不是法律意見。

## 跟本 repo 的關係

本專案刻意**不使用任何 AI 模型**，只靠樂理規則作曲。下列來源適合拿來做對照組，例如比較「AI 生成的檔案」和「瀏覽器即時合成」的傳輸量。請在另一個專案或暫存資料夾裡安裝這些套件，不要加進本專案的 `pyproject.toml`；生成的檔案放在 `output/` 或 repo 以外的地方。

---

## 1. 雲端 AI 音樂生成 API（付費）

| 分類 | 服務 | 輸入 | 輸出 | 授權與費用 |
|---|---|---|---|---|
| C | ElevenLabs Eleven Music | 文字提示詞，或分段的作曲計畫（composition plan） | 3 秒到 10 分鐘，可含人聲，預設 MP3 | 免費方案能生成音樂，但沒有商用授權；Starter 方案（每月 6 美元起）起可廣泛商用；電影、電視、大型遊戲要 Enterprise 方案 |
| C | Google Lyria 2（Vertex AI，`lyria-002`） | 文字提示詞，可加反向提示詞（不要出現的元素） | 約 30 秒的純音樂，48 kHz WAV | 每 30 秒 0.06 美元；輸出帶 SynthID 浮水印。⚠️ 是否在 Google 生成式 AI 侵權保障的適用名單內未確認；Vertex AI 已推出 Lyria 3 |
| C | Stability AI Stable Audio 2.5 | 文字提示詞；也能輸入一段音訊再改寫或補段 | 音樂與音效，主打企業用 | 官方 API 依點數計費，或經 fal、Replicate 等平台。⚠️ 第三方文章說生成結果歸使用者；text-to-audio 端點路徑未驗證；Stability 已在 2026-05 推出 Stable Audio 3.0 |
| C | Suno | 文字提示詞與歌詞 | 整首歌，含人聲 | ⚠️ 免費版只能個人、非商用，Pro 或 Premier 方案才可商用；據報導 2026 年仍沒有自助式公開 API，多半經第三方代理（見 [ready_to_use_audio.md](ready_to_use_audio.md) 的 Suno MCP，商用權不明）；Sony 的版權訴訟還沒結束 |
| C | AIVA | 文字提示詞或風格設定 | 純音樂 | ⚠️ 免費版版權歸 AIVA、只能非商用、要標示 AIVA；Pro 方案（約每月 49 歐元）才把版權給使用者 |
| C | Udio、Mubert、Beatoven、MusicGPT | 文字提示詞（各家不同） | 各家不同 | ⚠️ 免費版多半只能非商用，付費方案才可商用；把音樂放進自己的 App 散布，通常要另買 API 授權。價格比較可參考 [APIFrame 的整理](https://apiframe.ai/blog/ai-music-generation-api-comparison) |
| ? | Google Lyria RealTime（Gemini API） | 即時調整的文字提示詞 | 連續串流的音樂，經 WebSocket 傳送 | Gemini API 條款：Google 不主張生成內容的所有權；免費層的資料會拿去改進模型；服務歐洲經濟區（EEA）、英國、瑞士的使用者時只能用付費版。⚠️ 條款沒提到 Lyria，實驗性質 |
| ? | Mureka | 文字提示詞 | 整首歌 | ⚠️ 只找到第三方文章，商用條款不清楚 |

挑選時主要比兩件事：最長能生成多久，以及生成結果能不能商用。

### 怎麼用

ElevenLabs Eleven Music：送出提示詞與長度（毫秒），回傳音檔。預設模型是 `music_v1`；⚠️ 據第三方指南，可用 `model_id: "music_v2_5"` 換成較新的模型。

```bash
export ELEVENLABS_API_KEY=...
curl -X POST https://api.elevenlabs.io/v1/music \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt": "warm lo-fi hip hop, mellow piano, soft vinyl crackle, 80 bpm", "music_length_ms": 30000}' \
  --output output/eleven_lofi.mp3
```

想看完整的作曲計畫和中繼資料，改呼叫 `POST /v1/music/detailed`。

Google Lyria 2：先開好 Google Cloud 專案並啟用 Vertex AI。⚠️ 下面的 JSON 欄位依官方文件的結構整理，送出前請對照 [Lyria API 參考](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/lyria-music-generation)。

```bash
export GOOGLE_CLOUD_PROJECT=...
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/$GOOGLE_CLOUD_PROJECT/locations/us-central1/publishers/google/models/lyria-002:predict" \
  -d '{"instances": [{"prompt": "calm acoustic guitar for a morning cafe", "negative_prompt": "drums"}], "parameters": {"sample_count": 1}}'
```

回應裡的音訊是 base64 編碼的 WAV，解碼後存檔。

Stable Audio 2.5：在 [Stability AI 平台](https://platform.stability.ai/)申請金鑰，依官方 API 參考呼叫；也可以用 fal（`fal-ai/stable-audio-25/text-to-audio`）或 Replicate（`stability-ai/stable-audio-2.5`）的托管版本。

---

## 2. 開源音樂生成模型（自己架、本機跑）

| 分類 | 模型 | 能做什麼 | 硬體需求 | 授權 |
|---|---|---|---|---|
| A | [ACE-Step 1.5](https://ace-step.github.io/ace-step-v1.5.github.io)（2026-01） | 整首歌，含人聲與歌詞；也能翻唱、重畫其中一段、把人聲轉成伴奏 | 論文數據：A100 生成一首不到 2 秒，RTX 3090 不到 10 秒 | 程式碼（[GitHub](https://github.com/ace-step/ACE-Step-1.5)）與模型權重（Hugging Face `ACE-Step/Ace-Step1.5`）都是 MIT |
| A | [YuE](https://github.com/multimodal-art-projection/YuE) | 整首歌，歌詞和旋律保持連貫 | ⚠️ 需要大顯存 GPU | 程式碼與模型權重（Hugging Face `m-a-p/YuE-s1-7B-anneal-en-cot`）都是 Apache-2.0 |
| A | [Stable Audio Open 1.0](https://huggingface.co/stabilityai/stable-audio-open-1.0) | 純音樂、音效、鼓組循環，最長約 47 秒；1.2B 參數 | 一般顯卡 | Stability AI 社群授權：生成結果歸使用者；年營收低於 100 萬美元可免費商用，但要先向 Stability AI 註冊；超過門檻要另簽企業授權。Hugging Face 上要先同意條款才能下載 |
| B | [MusicGen](https://huggingface.co/facebook/musicgen-small)（Meta） | 約 30 秒的純音樂，可以用一段旋律引導；有 small、medium、large（3.3B 參數）三種大小 | small 版可在一般顯卡或 CPU 跑（較慢） | 程式碼（audiocraft）MIT；**模型權重 CC-BY-NC 4.0，不能商用** |

要找其他模型，可以用 Hugging Face 的搜尋（`text-to-audio` 任務標籤），或在 Claude Code 裡透過 Hugging Face MCP 查詢。

### 怎麼用

以下都用 `uv` 管理套件，在本專案以外的資料夾執行。

MusicGen（透過 Hugging Face `transformers`）：

```bash
mkdir musicgen-trial && cd musicgen-trial
uv init && uv add transformers torch scipy
```

```python
"""用 MusicGen small 依文字提示詞生成約 5 秒的音樂。"""

import scipy.io.wavfile
from transformers import AutoProcessor, MusicgenForConditionalGeneration

model_name: str = "facebook/musicgen-small"
text_processor = AutoProcessor.from_pretrained(model_name)
music_model = MusicgenForConditionalGeneration.from_pretrained(model_name)

model_inputs = text_processor(
    text=["lo-fi piano with soft drums, relaxing"], padding=True, return_tensors="pt"
)
# MusicGen 每秒約 50 個 token，256 個 token 約 5 秒
generated_audio = music_model.generate(**model_inputs, max_new_tokens=256)

sampling_rate: int = music_model.config.audio_encoder.sampling_rate
scipy.io.wavfile.write("musicgen_output.wav", rate=sampling_rate, data=generated_audio[0, 0].numpy())
```

Stable Audio Open（透過 `diffusers`）：先在 Hugging Face 模型頁同意條款，再用 `uv run huggingface-cli login` 登入。

```python
"""用 Stable Audio Open 依文字提示詞生成 10 秒音訊。"""

import soundfile
import torch
from diffusers import StableAudioPipeline

audio_pipeline = StableAudioPipeline.from_pretrained(
    "stabilityai/stable-audio-open-1.0", torch_dtype=torch.float16
).to("cuda")
generated_result = audio_pipeline(
    "128 bpm tech house drum loop", num_inference_steps=100, audio_end_in_s=10.0
)
output_audio = generated_result.audios[0].T.float().cpu().numpy()
soundfile.write("stable_audio_output.wav", output_audio, audio_pipeline.vae.sampling_rate)
```

ACE-Step 1.5、YuE：照各自 GitHub repo 的 README 安裝與執行。⚠️ 安裝步驟這裡沒有逐一驗證。

---

## 資料來源

- [ElevenLabs Music API 參考](https://elevenlabs.io/docs/api-reference/music/compose.md)
- [Eleven Music API 介紹頁](https://elevenlabs.io/eleven-music-api)
- [ElevenLabs 價格與方案](https://elevenlabs.io/pricing)
- [Google Lyria 生成音樂說明](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/music/generate-music)
- [Google Lyria API 參考](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/lyria-music-generation)
- [Google Cloud：生成式 AI 侵權保障](https://cloud.google.com/blog/products/ai-machine-learning/protecting-customers-with-generative-ai-indemnification)
- [Gemini API 服務條款](https://aistudio.google.com/docs/terms)
- [TechCrunch：Google 擴大開放 Lyria](https://techcrunch.com/?p=3009803)
- [Stability AI：Stable Audio 2.5 發表](https://stability.ai/news/stability-ai-introduces-stable-audio-25-the-first-audio-model-built-for-enterprise-sound-production-at-scale)
- [Stability AI：Stable Audio 授權與自架比較](https://stability.ai/explainers/stable-audio-vs-competitors-licensing-export-rights-and-self-hosting-compared)
- [Stability AI：audio-to-audio API 使用技巧](https://kb.stability.ai/knowledge-base/tips-for-using-the-audio-to-audio-api)
- [Stable Audio Open 1.0 授權全文](https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md)
- [Sonilo：官方 Suno API 現況](https://sonilo.com/blog/guides/official-suno-api-saas-builders-2026)
- [Sonilo：2026 AI 音樂 API 比較](https://sonilo.com/blog/ai-music-api-comparison-2026)
- [Sonilo：廣告與 App 內使用 AI 配樂的授權](https://sonilo.com/blog/comparisons/ai-soundtrack-apis-ads-client-work-monetized-channels)
- [terms.law：Suno 生成內容的權利](https://terms.law/ai-output-rights/suno/)
- [fast.io：2026 Suno 替代品授權比較](https://fast.io/resources/suno-alternatives-2026/)
- [APIFrame：AI 音樂生成 API 比較](https://apiframe.ai/blog/ai-music-generation-api-comparison)
- [ACE-Step 論文](https://arxiv.org/html/2506.00045)
- [ACE-Step 1.5](https://ace-step.github.io/ace-step-v1.5.github.io)
- [2026 AI 音樂生成總覽（Suno、Udio、MusicGen、Stable Audio 等）](https://www.youngju.dev/blog/culture/2026-05-14-ai-music-generation-2026-suno-udio-riffusion-musicgen-mubert-stable-audio-deep-dive.en)
