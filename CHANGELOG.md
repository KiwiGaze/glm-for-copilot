 

# Changelog

All notable changes to GLM Models for GitHub Copilot Chat are documented here.

## Unreleased

- **Opt-in Standard API recovery** - when the current key exposes no usable Coding Plan quota, or its session/weekly token quota is exhausted, the GLM Usage panel can check that key's Standard API balance on demand. A switch is offered only when positive cash or token-package credit is found, and a modal discloses pay-as-you-go billing, the configuration scope, and model-availability changes before updating API Mode. No balance probe or mode change happens automatically; dismissal, failures, zero credit, monthly web-search exhaustion, and custom Base URLs leave the mode and key unchanged.

## 0.4.1

- **GLM-5.3-Flash image input** - adds the 1M-context multimodal model with native PNG/JPEG input. Text-only models automatically use GLM-5.3-Flash to produce untrusted visual context on the same endpoint and API key. Image analysis is validated, cancellable, cached in memory, and configurable through the renamed **GLM: Edit Flash Image Analysis Prompt** command.
- **Vision MCP removal** - removes the local MCP server, npm package installer, separate Vision key, enable toggle, tool-approval flow, and bundled runtime resources. Upgrades clean only the retired Vision MCP state and files; regular chat credentials remain intact.

## 0.4.0

- **GLM-5.3 support** - adds GLM-5.3 as the default Coding Plan model on both Z.AI and BigModel, with a 1M-token context window, 128K maximum output, and mandatory Low / High / Max thinking effort (Max by default). Standard API mode remains unchanged: Z.AI's Standard API pricing catalog does not include GLM-5.3, while BigModel lists the model but says its model API is not yet available. The minimum VS Code version is now 1.127, where the stable `chat.defaultModel` setting is available.

## 0.3.0

- **Usage error reporting** - HTTP 200 responses containing failed GLM business envelopes now report authentication or server errors instead of `no-data`. Business codes and server messages are preserved in the GLM output logs, and authentication failures provide the existing API-key recovery action.
- **One-click GLM Vision MCP server** - install the official Z.AI vision MCP server (`@z_ai/mcp-server@0.1.4`, GLM-4.6V) with **GLM: Install GLM Vision MCP Server** or the new walkthrough step. Nothing is downloaded or registered silently: a modal confirmation explains that the third-party local process receives the API key selected for Vision and image paths and sends image content to Z.AI/BigModel. After consent, the flow checks for the required key and Node.js/npm, installs a fully locked dependency graph with SHA-512 integrity hashes through `npm ci --ignore-scripts`, and launches only the fixed local entry point instead of executing a future `npx` download. A dedicated Vision key in `SecretStorage` takes priority; without one, the stored chat key is reused only when `glm-copilot.baseUrl` is empty. When a custom Base URL is active at server start, Vision requires the separate Z.AI or BigModel key from **GLM: Set Vision API Key** and does not select the proxy credential. Region, Base URL, or active-key changes prompt a restart. **GLM: Uninstall GLM Vision MCP Server** disables the registration and vision toggle, removes the dedicated key and temp images, and then removes the local package; Vision remains disabled if package cleanup fails.
- **Image input for text-only GLM models** - after GLM Vision is installed, **GLM: Toggle Vision for Chat Models** (or `glm-copilot.visionEnabled`) turns on image input: every GLM model in the picker then accepts pasted or attached images, including during a temporary server outage. Each image is analyzed by the GLM Vision server (`analyze_image`, GLM-4.6V) and injected as text before the request reaches the chat model — visible code, terminal output, errors, and UI included. The analysis instruction is configurable via **GLM: Edit GLM Vision Prompt** or `glm-copilot.visionPrompt` (empty = built-in prompt; changing it re-analyzes images on the next turn). Analyses are content-addressed and cached in memory for the session (never written to extension storage). Images are validated against a type allowlist (`png`/`jpeg`) and a 5 MB cap before any tool call. A status line streams into the thinking block while analysis runs (cache hits stay silent). If analysis fails or the server stops, the reply opens with a localized "image analysis failed" notice and continues without the image. Turning vision off or removing the local package makes the models text-only. Each off-to-on transition now shows a **Manage Tool Approval** action after `analyze_image` is available. To stop repeated confirmations, open the workspace Tool Approval manager, find **GLM Vision > analyze_image**, and enable **without approval** only for that tool. The extension never changes approval settings, and organization policy can still require confirmation.
- Contributed by [@elijahqi](https://github.com/elijahqi) in [pull request 36](https://github.com/KiwiGaze/glm-for-copilot/pull/36). Thank you for your contribution.

## 0.2.10

- **Standard API balance tracking** - the usage status bar and details panel now also work for the Standard API (pay-as-you-go) mode, not just Coding Plan. Cash balance (available, recharged, gifted, spent, frozen) and token resource packages are queried from both `z.ai` and `bigmodel.cn` account endpoints, which share the same JSON shape. The status bar turns red when the available balance reaches 0.
- **Full usage support matrix** - all four combinations now work: Coding Plan × {International, China} for quota tracking (5h/weekly token limits + monthly web searches), and Standard API × {International, China} for balance tracking (cash + token packages).
- **Status-bar warning colors** - the status bar now uses `statusBarItem.errorBackground` (VS Code theme error color) when any Coding Plan metric hits 100% or when the Standard API available balance reaches 0.
- Contributed by [@Dootmaan](https://github.com/Dootmaan) in [pull request 28](https://github.com/KiwiGaze/glm-for-copilot/pull/28).

> 💡 If you encountered "No utility model is configured for 'copilot-utility-small' while the selected main agent model is BYOK." error during use, please change the "**Chat:** **Byok Utility Model Default**" option from "None" to "Main Agent Model" in VSCode settings.

## 0.2.9

- **Coding Plan usage for Mainland China** - the usage status bar and details panel now also work for the Coding Plan on the Mainland China (`bigmodel.cn`) region, not just the International (`z.ai`) region. Session (5-hour) and weekly (7-day, if available) token limits plus monthly web searches are queried from `open.bigmodel.cn/api/monitor/usage/quota/limit`, which shares the same JSON shape as the z.ai endpoint (only the host and auth scheme differ — the China monitor endpoint authenticates with the raw API key without the `Bearer` prefix). The gate no longer hides the bar for the China region. (#26 [Link to the PR](https://github.com/KiwiGaze/glm-for-copilot/pull/26), thanks @Dootmaan [GitHub](https://github.com/Dootmaan))

## 0.2.8

- **Configurable retry limit** - new `glm-copilot.maxRetries` setting (0–10) caps automatic retries for transient chat failures (HTTP 429 and 5xx). Set `0` to disable automatic retries and fail fast when rate limited. The default drops from 9 retries (10 total attempts) to 3 (4 total attempts), so peak-hour throttling no longer holds a request through ~1.5 minutes of backoff by default. (#20)

## 0.2.7

- **Retry with exponential backoff** - chat requests now retry transient GLM API failures (HTTP 429 and 5xx) with exponential backoff and jitter before any output is streamed, honoring the server's `Retry-After` / `retry-after-ms` header when present. Up to 10 total attempts, 1s base delay, 10s cap. This clears rate-limit windows instead of failing fast, so the same API key that works in other GLM clients no longer surfaces "HTTP 429 Too many requests" in Copilot Chat. Non-retryable errors (4xx) and exhausted retries still surface the existing user-facing error. Cancellation during a backoff wait aborts promptly.
- **Identifying User-Agent** - chat requests now send `User-Agent: glm-copilot/<version>`. The z.ai Coding Plan gateway throttles unidentified HTTP clients more aggressively than known coding-tool traffic; sending a stable product User-Agent removes a source of spurious rate limits on top of the retry/backoff above.

## 0.2.6

- **Coding Plan usage tracking** - adds a GLM usage status bar plus **GLM: Refresh Usage**
  and **GLM: Show Usage Details** commands for Session / Weekly / Web Searches quota,
  plan, renewal, reset, and last-updated details. Visible only for the Coding Plan on the
  International (z.ai) region. Note: this relies on z.ai usage endpoints that are not part
  of the public API and may change without notice; failures degrade gracefully to status states.

## 0.2.5

- **Marketplace identity** - moved the extension package to `yijiazhen-qi.glm-for-github-copilot-chat` and updated install links, package metadata, and release artifact names.
- **Display name** - changed the visible Marketplace name to `GLM Models for GitHub Copilot Chat`.
- **Migration note** - documented uninstalling the old `YijiazhenQi.glm-for-copilot-chat` listing before installing the new one.
- **Docs cleanup** - aligned the settings title with the product name, refreshed the walkthrough model examples, and removed a stale project-plan reference from the contributing guide.

## 0.2.4

- **README badges** — replaced the retired Marketplace version and installs badges with active Marketplace links.

## 0.2.3

- **Mainland China Coding Plan** — `region: china` now routes Coding Plan requests to `open.bigmodel.cn/api/coding/paas/v4` instead of z.ai, and `GLM: Get API Key` opens the bigmodel.cn coding-plan console. International Coding Plan and all Standard endpoints are unchanged; `region` defaults to `international`, so existing users are unaffected.
- **Display name update** — clarified the extension's GitHub Copilot Chat integration in the Marketplace name. No functional changes.

## 0.2.2

- **GLM-5.2 Thinking Effort picker** — GLM-5.2 gains a per-model Thinking Effort control (None / High / Max) in the Copilot model picker. None turns thinking off; High and Max select how deeply the model reasons. The choice persists per model.
- **GLM-5.2 on the Standard API** — GLM-5.2 is now available on the Standard API in addition to the Coding Plan, so it appears in the picker under both API modes.
- **GLM-5.2 context window** — updated to 1M tokens.

## 0.2.1

- **Live thinking stream fix** — request `Accept-Encoding: identity` so z.ai's (nginx) edge does not gzip-buffer the SSE stream. Without it, `reasoning_content` deltas arrived batched and the "Thinking…" block only appeared after reasoning finished; now thinking tokens render live as they generate.
- **New extension icon** — the official z.ai logo (the white “Z” mark on its dark rounded tile) is now the extension icon.

## 0.2.0

- **New model lineup** — GLM-4.7, GLM-5, GLM-5.1, and GLM-5.2 join GLM-4.5 Air in the picker (GLM-4.6 removed).
- **Plan-aware picker** — the model list is filtered by your API Mode: GLM-5 and GLM-5.1 are Standard-API only, GLM-5.2 is Coding-Plan only, while GLM-4.7 and GLM-4.5 Air work on both. You only ever see models your plan can serve. (With a custom `baseUrl`, all built-in models are shown.)
- **Custom models** — add your own model ids with the new `glm-copilot.customModels` setting (plain id strings, or objects with `name`, token limits, and capability flags). Custom models always appear and target your active endpoint.
- **`modelIdOverrides`** — now a generic id-to-id map for any built-in model, for regional endpoints (bigmodel.cn) and proxies.

## 0.1.0

Initial release.

- **GLM-4.6 and GLM-4.5 Air in Copilot Chat** — both models appear in the Copilot Chat model picker via the VS Code Language Model Provider API.
- **Dual API support** — choose between a Z.ai GLM Coding Plan subscription (`api.z.ai/api/coding/paas/v4`) and the Standard pay-as-you-go API (`api.z.ai` for International, `open.bigmodel.cn` for Mainland China).
- **Thinking mode** — toggle step-by-step reasoning on or off with the `glm-copilot.thinking` setting.
- **Tool calling** — full support for OpenAI-compatible function calling; Copilot's agent mode and tool integrations work unchanged.
- **BYOK** — API key stored in VS Code SecretStorage (OS keychain). Never written to `settings.json`.
- **Onboarding walkthrough** — three-step guided setup: set API key, choose API mode, open the model picker.
- **`baseUrl` override** — point the extension at any OpenAI-compatible proxy or self-hosted GLM endpoint.
- **`modelIdOverrides`** — remap VS Code model IDs to different API model names for compatible third-party endpoints.
- **i18n** — English and Simplified Chinese localizations (`package.nls.json`, `package.nls.zh-cn.json`).
- **Debug logging** — optional verbose output to the GLM output channel (`GLM: Show Logs`).
