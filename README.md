# GLM Models for GitHub Copilot Chat

[![VS Marketplace Version](https://img.shields.io/badge/Marketplace-0.4.2-1f6feb)](https://marketplace.visualstudio.com/items?itemName=yijiazhen-qi.glm-for-github-copilot-chat)
[![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/yijiazhen-qi.glm-for-github-copilot-chat.svg)](https://marketplace.visualstudio.com/items?itemName=yijiazhen-qi.glm-for-github-copilot-chat)
[![Install from VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Install-007ACC)](https://marketplace.visualstudio.com/items?itemName=yijiazhen-qi.glm-for-github-copilot-chat)
[![CI](https://github.com/KiwiGaze/glm-for-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/KiwiGaze/glm-for-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)

<p align="center">
  <img src="docs/glm-composer-light.png" alt="GLM-5.2 selected in the Copilot Chat composer in light theme, with Thinking Effort set to Max" width="420">
</p>

Bring Z.AI's GLM models into GitHub Copilot Chat with your own API key (BYOK) — **[GLM-5.3](https://z.ai/blog/glm-5.3)**, the default 1M-context Coding Plan model, multimodal **GLM-5.3-Flash**, and a curated lineup (GLM-5.2, GLM-5.1, GLM-5, GLM-4.7, GLM-4.5 Air). No new sidebar or chat UI: the models appear in the picker you already use, with image input, agent mode, tool calling, and thinking through Copilot's native provider path.

> **Unofficial, community-built extension.** Not affiliated with, endorsed by, or sponsored by Zhipu AI, Z.AI, GitHub, or Microsoft. "GLM", "Copilot", and "Visual Studio Code" are trademarks of their respective owners. You bring your own GLM API key and pay your own usage.

## Features

- **GLM-5.3 by default, right in the picker.** The Coding Plan model has a 1M-token context window and step-by-step thinking that streams live into Copilot's native thinking UI. Its per-model **Thinking Effort** control offers Low / High / Max, defaults to Max, and always keeps thinking enabled. Switch models mid-chat without losing history.

- **Powers Copilot up, doesn't replace it.** GLM models appear alongside GPT and Claude. Because the extension uses Copilot's native Language Model Provider API, agent mode and tool calling keep working as usual.
- **Dual API.** Use your **GLM Coding Plan** subscription or the pay-as-you-go **Standard API** — each available International (`z.ai`) or Mainland China (`bigmodel.cn`). See [Coding Plan vs Standard API](#coding-plan-vs-standard-api).
- **Live usage & balance tracking.** A status-bar readout plus a full **GLM: Show Usage Details** panel. Coding Plan shows session (5-hour) and weekly (7-day) token limits, monthly web searches, and reset countdowns. Standard API shows cash balance and token resource packages. The status bar turns red when quota hits 100% or balance reaches 0. Works on both International (`z.ai`) and Mainland China (`bigmodel.cn`) endpoints for both API modes; no `baseUrl` override.

<p align="center">
  <img src="docs/glm-usage-panel.png" alt="GLM Usage panel showing session, weekly, and web-search quota with reset countdowns for a GLM Coding plan" width="760">
</p>

- **Keys stay in your OS keychain by default.** **GLM: Set API Key** stores your key via VS Code `SecretStorage` (macOS, Windows, Linux). The extension also honors a settings fallback for CI or automation, so do not put real keys in workspace settings.
- **Zero runtime dependencies.** Pure VS Code API and Node.js built-ins — no Python, Docker, MCP server, or local package installation.
- **Add any model.** Newly released, fine-tuned, or proxy-hosted GLM models via [`glm-copilot.customModels`](#settings).
- **See images on every model.** GLM-5.3-Flash accepts pasted images directly. For text-only models, the extension asks Flash for a neutral description first and supplies it as untrusted visual context. No separate server or key is required. See [Image input](#image-input).

## Getting Started

### Prerequisites

- VS Code 1.127 or later
- An active GitHub Copilot subscription (Free, Pro, or Enterprise)
- A GLM API key from [z.ai](https://z.ai/manage-apikey/apikey-list) or [bigmodel.cn](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys), or a GLM Coding Plan subscription

### Installation

Install from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yijiazhen-qi.glm-for-github-copilot-chat)**, or search **"GLM Models for GitHub Copilot Chat"** in the Extensions panel (`Cmd/Ctrl + Shift + X`):

```bash
code --install-extension yijiazhen-qi.glm-for-github-copilot-chat
```

Upgrading from an older Marketplace listing? Uninstall it first — the old and new IDs can both register the same `glm-copilot.*` commands and settings:

```bash
code --uninstall-extension YijiazhenQi.glm-for-copilot-chat
code --install-extension yijiazhen-qi.glm-for-github-copilot-chat
```

### Usage

1. **GLM: Set API Key** (Command Palette, `Cmd/Ctrl + Shift + P`) → paste your key. GLM key format is `{id}.{secret}`.
2. (Optional) **GLM: Open Settings** to choose your API mode and region.
3. Open Copilot Chat and start with **GLM-5.3**, or pick another available GLM model.

Use **GLM: Set API Key** or **GLM: Clear API Key** to update or remove the key later.

## Models

| Model | Tier | Context | Max Output | Available on official endpoints | Images | Tools | Thinking |
|---|---|---|---|---|---|---|---|
| **GLM-5.3** | Default coding model | 1M | 128K | Coding Plan only | Via Flash | Yes | Always on (Low / High / Max) |
| **GLM-5.3-Flash** | Multimodal | 1M | 128K | Coding Plan + Standard | Native | Yes | Always on (Low / High / Max) |
| **GLM-5.2** | Flagship | 1M | 128K | Coding Plan + Standard | Via Flash | Yes | Yes (effort) |
| **GLM-5.1** | Prior flagship | 200K | 128K | Standard only | Via Flash | Yes | Yes |
| **GLM-5** | Prior flagship | 200K | 128K | Standard only | Via Flash | Yes | Yes |
| **GLM-4.7** | Fast coding | 200K | 128K | Coding Plan + Standard | Via Flash | Yes | Yes |
| **GLM-4.5 Air** | Lightweight | 128K | 96K | Coding Plan + Standard | Via Flash | Yes | Yes |

Without a custom `baseUrl`, the picker filters built-in models by **API Mode**, so you never pick one the official endpoint can't serve. GLM-5.3 is currently Coding-Plan-only; GLM-5.3-Flash, GLM-5.2, GLM-4.7, and GLM-4.5 Air work on both; GLM-5 and GLM-5.1 are Standard-only. A custom `baseUrl` skips this official availability filter because the extension cannot infer the capabilities of a compatible endpoint. Custom models are always included and replace built-in definitions with the same id. Need a model not listed — newer, older (GLM-4.6), or proxy-hosted? Add it with [`glm-copilot.customModels`](#settings).

For new conversations, the extension contributes GLM-5.3 as VS Code's default. An explicit user or organization `chat.defaultModel` setting takes precedence. GLM-5.3 is omitted from the official Standard API picker, where you must select another available model.

## Settings

| Setting | Default | Description |
|---|---|---|
| `glm-copilot.apiMode` | `coding-plan` | Which GLM API to use: `coding-plan` or `standard`. See below. |
| `glm-copilot.region` | `international` | Server region for both chat API modes and Flash image analysis: `international` (z.ai) or `china` (bigmodel.cn). A custom `baseUrl` overrides it for all model requests. |
| `glm-copilot.baseUrl` | *(empty)* | Override the GLM API base URL. Overrides `apiMode` and `region`, including Flash image fallback, and skips official API-mode model filtering because compatible endpoint capabilities cannot be inferred. Images are never silently sent to a different endpoint. |
| `glm-copilot.maxTokens` | `0` | Maximum output tokens per request. `0` means no explicit limit (uses API default). |
| `glm-copilot.maxRetries` | `3` | Automatic retries for transient chat failures (HTTP `429`/`5xx`), not counting the first attempt. `0` disables retries (fail fast). Range 0–10. Backoff honors the server's `Retry-After`. |
| `glm-copilot.thinking` | `enabled` | Step-by-step reasoning for models without a per-model Thinking Effort picker: `enabled` (higher quality) or `disabled` (faster). GLM-5.2 uses None / High / Max; GLM-5.3 requires thinking and uses Low / High / Max, defaulting to Max. |
| `glm-copilot.visionPrompt` | *(empty)* | Instruction sent to GLM-5.3-Flash when a text-only model needs image analysis. Empty uses the built-in neutral description prompt. Changing it invalidates the in-memory analysis cache. |
| `glm-copilot.customModels` | `[]` | Add your own models. Array of model id strings or objects: `{ id, name?, maxInputTokens?, maxOutputTokens?, toolCalling?, thinking?, nativeImageInput? }`. `nativeImageInput` defaults to `false`. |
| `glm-copilot.modelIdOverrides` | `{}` | Remap a built-in model's API id (keys = picker id, values = id sent to the API). Use for regional endpoints or proxies with different names. |
| `glm-copilot.debugLogging` | `false` | Write verbose debug logs to the GLM output channel. View with **GLM: Show Logs**. |
| `glm-copilot.usageRefreshIntervalMinutes` | `5` | How often (in minutes) to refresh the GLM usage status bar. Minimum `1`. Shows Coding Plan quota or Standard API balance for both `z.ai` and `bigmodel.cn` regions. Only when no `baseUrl` override. |
| `glm-copilot.showUsageStatusBar` | `true` | Show the GLM usage status-bar item. Coding Plan quota or Standard API balance, both `z.ai` and `bigmodel.cn` regions. Only when no `baseUrl` override. |

## Coding Plan vs Standard API

**Coding Plan** requires a GLM Coding Plan subscription — best for teams or high-volume coding. **Standard API** is pay-as-you-go via the GLM Open Platform. The endpoint follows your `region` either way.

If the Usage panel cannot find usable Coding Plan quota for the current key, or the session/weekly token quota is exhausted, it offers **Check Standard API**. The extension checks the current key's Standard balance only after you click that action. A positive cash or token-package balance opens a pay-as-you-go confirmation; only **Switch to Standard API** changes `glm-copilot.apiMode`. Dismissing the confirmation or receiving an unavailable, unauthorized, empty, or zero balance changes neither the mode nor the stored key. The model picker then refreshes for Standard availability without selecting a replacement model automatically. Monthly web-search exhaustion alone does not offer this recovery, and it is unavailable with a custom `baseUrl`.

| Mode | Region | Endpoint | Get a key |
|---|---|---|---|
| Coding Plan | International | `https://api.z.ai/api/coding/paas/v4` | [z.ai/manage-apikey/subscription](https://z.ai/manage-apikey/subscription) |
| Coding Plan | Mainland China | `https://open.bigmodel.cn/api/coding/paas/v4` | [bigmodel.cn/coding-plan](https://bigmodel.cn/coding-plan/personal/overview) |
| Standard | International | `https://api.z.ai/api/paas/v4` | [z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list) |
| Standard | Mainland China | `https://open.bigmodel.cn/api/paas/v4` | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys) |

Full API documentation: [docs.z.ai](https://docs.z.ai).

GLM-5.3 is documented for Coding Plan on both the [Z.AI](https://docs.z.ai/devpack/latest-model) and [BigModel](https://docs.bigmodel.cn/cn/coding-plan/latest-model.md) endpoints. The current [Z.AI Standard API pricing catalog](https://docs.z.ai/guides/overview/pricing.md) does not include it. BigModel's [model overview](https://docs.bigmodel.cn/cn/guide/start/model-overview.md) lists GLM-5.3, but its [model page](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3) says the model API is not yet available. This extension therefore does not expose GLM-5.3 on the official Standard endpoints yet; a compatible custom `baseUrl` may serve it.

GLM-5.3-Flash is documented for Coding Plan and Standard use by both [Z.AI](https://docs.z.ai/guides/vlm/glm-5.3-flash) and [BigModel](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash/).

Usage details rely on regional usage endpoints (`api.z.ai` for International, `open.bigmodel.cn` for Mainland China) that are not part of the public chat-completions API. If those endpoints are unavailable or change, the extension degrades to a status message instead of blocking chat.

## Image input

Paste or attach PNG and JPEG images directly in Copilot Chat. No MCP server, local package, toggle, or separate Vision key is required.

- **Native Flash path** — GLM-5.3-Flash receives text and images in their original order as multimodal content.
- **Text-model fallback** — for other models, the extension sends each image group to GLM-5.3-Flash first, then wraps the returned description as untrusted visual data for the selected model. Text found in an image is context, never authorization or a tool instruction.
- **Same endpoint and key** — both requests use the active `baseUrl` and chat API key. A custom endpoint must serve a compatible `glm-5.3-flash` model; the extension never reroutes images to Z.AI or BigModel behind your back.
- **Validated and cached** — up to 16 PNG/JPEG images are accepted, with a 5 MB limit per image. Descriptions are cached in memory using image content, endpoint, resolved model id, and prompt.
- **Visible progress, graceful failure** — Flash fallback reports progress. If it is unavailable, the selected text model still receives the remaining content plus an unavailable marker. Cancelling stops image analysis and prevents the main request.

Customize fallback analysis with **GLM: Edit Flash Image Analysis Prompt** or [`glm-copilot.visionPrompt`](#settings).

## Commands

| Command | Description |
|---|---|
| **GLM: Set API Key** | Set or update your GLM API key |
| **GLM: Get API Key** | Open the key management page for your selected API mode |
| **GLM: Clear API Key** | Remove your stored API key |
| **GLM: Open Settings** | Open the extension settings |
| **GLM: Show Logs** | Open the GLM output channel |
| **GLM: Refresh Usage** | Refresh GLM usage/balance now (Coding Plan quota or Standard API balance; both `z.ai` and `bigmodel.cn`) |
| **GLM: Show Usage Details** | Open the GLM usage panel (Coding Plan quota or Standard API balance; both `z.ai` and `bigmodel.cn`) |
| **GLM: Edit Flash Image Analysis Prompt** | Open the multiline setting used by text-model image fallback |

## Frequently asked questions

### Is this an official GLM or GitHub extension?

No. Unofficial, community-built, open source — not affiliated with Zhipu AI, Z.AI, GitHub, or Microsoft. It just lets you use your own GLM API key inside Copilot Chat.

### Do I still need a GitHub Copilot subscription?

Yes. This adds GLM models *to* Copilot Chat; it doesn't replace Copilot. You need an active Copilot subscription (Free, Pro, or Enterprise) and your own GLM API key.

### Where does my API key go?

**GLM: Set API Key** stores the key in VS Code `SecretStorage` (the OS keychain on macOS, Windows, Linux). Chat and Flash image fallback send it only to the configured GLM endpoint over HTTPS. A settings fallback exists for CI or automation, but avoid putting real keys in `settings.json`, especially workspace settings that could be committed.

### Can I use a proxy or self-hosted endpoint?

Yes. Set `glm-copilot.baseUrl` to an OpenAI-compatible endpoint; it overrides `apiMode` and `region` for chat and image fallback. Text-only models require that endpoint to expose a compatible `glm-5.3-flash` model, or a mapped id through `modelIdOverrides`.

### Is GLM-4.6 still supported?

GLM-4.6 was superseded by GLM-4.7 and the GLM-5 series in v0.2.0. Add it with `glm-copilot.customModels` if your account still serves it.

## Contributing

Contributions welcome — see the [contributing guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md). All PRs require code-owner review and are never auto-merged.

- **Bug?** [Open a report](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=bug_report.yml) · **Feature?** [Request it](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=feature_request.yml)
- **Help?** [Support](SUPPORT.md) or [Discussions](https://github.com/KiwiGaze/glm-for-copilot/discussions) · **Security?** [Policy](SECURITY.md)

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE.txt) © GLM Models for GitHub Copilot Chat contributors
