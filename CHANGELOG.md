# Changelog

## 0.4.4

- Fix default-model matching across native Chat and Copilot CLI. Recommend GLM-5.3 for Coding Plan and GLM-5.3-Flash for Standard API. Explicit user and organization defaults take precedence.
- Hide GLM-5.2 and earlier on new installations. Upgrades keep older models available; manage them with `glm-copilot.showLegacyModels`.
- Add `GLM: Use Recommended Default Model` and a setup/upgrade recommendation. New defaults apply to new conversations; existing conversations keep their selected model.
- Show available 5-hour and weekly reset cards with expiry dates in the GLM Usage panel for both regions. Using a card requires confirmation, then refreshes card inventory and quota.

## 0.4.3

- Add GLM-5.3-FlashX to the Standard API picker with native image input, a 1M-token context window, 128K maximum output, tool calling, and required Low / High / Max thinking effort. FlashX is not available on Coding Plan.

## 0.4.2

- Accept the `CREDIT_LIMIT` quota entries returned by Z.AI for 5-hour and weekly usage. Continue to accept `TOKENS_LIMIT` from endpoints that use it.
- Add a Standard API balance check to the Usage panel when the current key has no usable Coding Plan quota or has exhausted its session/weekly token quota. The check runs only when requested. If it finds positive cash or token-package credit, the panel offers a switch and asks for confirmation. The confirmation explains pay-as-you-go billing, configuration scope, and model-availability changes. Dismissal, failed checks, and zero credit leave the mode and key unchanged. Monthly web-search exhaustion and custom Base URLs do not offer this option.

## 0.4.1

- Add GLM-5.3-Flash with a 1M-token context window and native PNG/JPEG input. Text-only models use Flash to describe images on the same endpoint and API key, then receive the description as untrusted visual data. Image analysis validates attachments, supports cancellation, and caches descriptions in memory. Configure it with `GLM: Edit Flash Image Analysis Prompt`.
- Remove the local Vision MCP server, npm installer, separate Vision key, enable toggle, tool-approval flow, and bundled runtime resources. Upgrades remove the retired Vision state and files and keep chat credentials.

## 0.4.0

- Add GLM-5.3 as the default Coding Plan model on Z.AI and BigModel, with a 1M-token context window and 128K maximum output. Thinking is required, with Low / High / Max effort and Max as the default. Standard API mode is unchanged: Z.AI's pricing catalog does not include GLM-5.3, and BigModel lists it but says its model API is not yet available.
- Require VS Code 1.127, which has the stable `chat.defaultModel` setting.

## 0.3.0

- Report authentication or server errors when an HTTP 200 response contains a failed GLM business envelope. Previously these responses appeared as `no-data`. Preserve business codes and server messages in the GLM output logs and offer the API-key action for authentication failures.
- Add `GLM: Install GLM Vision MCP Server` and a walkthrough step for the official `@z_ai/mcp-server@0.1.4` package (GLM-4.6V). Installation requires confirmation that explains the local process's access to the selected Vision key and image paths, and its transmission of images to Z.AI/BigModel. The installer checks the key and Node.js/npm, uses `npm ci --ignore-scripts` with a locked dependency graph and SHA-512 integrity hashes, and launches a fixed local entry point.
- Prefer a dedicated Vision key in `SecretStorage`. Without one, reuse the chat key only when `glm-copilot.baseUrl` is empty. A custom Base URL requires a separate Z.AI or BigModel key from `GLM: Set Vision API Key`; the proxy credential is not used. Region, Base URL, or active-key changes prompt a restart. `GLM: Uninstall GLM Vision MCP Server` disables registration and the vision toggle, removes the dedicated key and temporary images, then removes the local package. Vision stays disabled if cleanup fails.
- Add `GLM: Toggle Vision for Chat Models` and `glm-copilot.visionEnabled`. Once installed and enabled, every GLM model accepts attached images, including during a temporary Vision server outage. The server's `analyze_image` tool describes visible code, terminal output, errors, and UI for the text model. Configure the instruction with `GLM: Edit GLM Vision Prompt` or `glm-copilot.visionPrompt`; an empty value uses the built-in prompt, and edits trigger fresh analysis on the next turn.
- Validate PNG/JPEG images against a 5 MB limit before analysis. Cache descriptions by content in memory for the session, without writing them to extension storage. Show progress in the thinking block, except on cache hits. If analysis fails, show a localized notice and continue without the image. Disabling Vision or removing its package returns models to text-only input.
- Show `Manage Tool Approval` each time Vision is enabled and `analyze_image` becomes available. To stop repeated confirmations, open the workspace Tool Approval manager and allow `GLM Vision > analyze_image` to run without approval. The extension does not change approval settings; organization policy may still require confirmation.
- Contributed by [@elijahqi](https://github.com/elijahqi) in [#36](https://github.com/KiwiGaze/glm-for-copilot/pull/36).

## 0.2.10

- Add Standard API balance tracking to the status bar and details panel. Query cash balance (available, recharged, gifted, spent, frozen) and token packages from both `z.ai` and `bigmodel.cn` account endpoints, which share the same JSON format.
- Support quota tracking for Coding Plan and balance tracking for Standard API in both regions. Coding Plan reports 5-hour and weekly token limits plus monthly web searches.
- Use the theme's `statusBarItem.errorBackground` color when a Coding Plan metric reaches 100% or the Standard API available balance reaches 0.
- Contributed by [@Dootmaan](https://github.com/Dootmaan) in [#28](https://github.com/KiwiGaze/glm-for-copilot/pull/28).

If VS Code reports "No utility model is configured for 'copilot-utility-small' while the selected main agent model is BYOK.", set `Chat: Byok Utility Model Default` to `Main Agent Model` in VS Code settings.

## 0.2.9

- Add Coding Plan usage tracking for Mainland China (`bigmodel.cn`). Query session (5-hour), weekly (7-day, when available), and monthly web-search limits from `open.bigmodel.cn/api/monitor/usage/quota/limit`. The response format matches z.ai; the China monitor endpoint uses the raw API key without a `Bearer` prefix.
- Contributed by [@Dootmaan](https://github.com/Dootmaan) in [#26](https://github.com/KiwiGaze/glm-for-copilot/pull/26).

## 0.2.8

- Add `glm-copilot.maxRetries` (0 to 10) for transient chat failures (HTTP 429 and 5xx). Set 0 to disable retries. Reduce the default from 9 retries to 3, or 4 total attempts, so throttled requests spend less time waiting. (#20)

## 0.2.7

- Retry transient GLM API failures (HTTP 429 and 5xx) before streaming output. Use exponential backoff with jitter and honor `Retry-After` / `retry-after-ms` when present. Allow up to 10 total attempts, with a 1-second base delay and 10-second cap. Non-retryable 4xx errors and exhausted retries still show the existing error. Cancellation stops the backoff wait.
- Send `User-Agent: glm-copilot/<version>` on chat requests to identify the client to the GLM gateway.

## 0.2.6

- Add a usage status bar, `GLM: Refresh Usage`, and `GLM: Show Usage Details` for Coding Plan in the International (z.ai) region. Show session, weekly, and web-search quota, plan, renewal, reset, and last-updated details. These account endpoints are outside the public API and may change; failures show a status message.

## 0.2.5

- Move the extension package to `yijiazhen-qi.glm-for-github-copilot-chat`. Update install links, package metadata, and release artifact names.
- Change the Marketplace display name to `GLM Models for GitHub Copilot Chat`.
- Document uninstalling the old `YijiazhenQi.glm-for-copilot-chat` listing before installing the new one.
- Match the settings title to the product name, update walkthrough model examples, and remove a stale project-plan reference from the contributing guide.

## 0.2.4

- Replace retired Marketplace version and install badges with active Marketplace links.

## 0.2.3

- Route Mainland China Coding Plan requests to `open.bigmodel.cn/api/coding/paas/v4` when `region` is `china`. Open the bigmodel.cn Coding Plan console from `GLM: Get API Key`. International Coding Plan and Standard endpoints are unchanged. The default region remains `international`.
- Clarify the GitHub Copilot Chat integration in the Marketplace display name.

## 0.2.2

- Add a per-model Thinking Effort picker for GLM-5.2 with None / High / Max. None disables thinking; High and Max set reasoning effort. The selection persists per model.
- Make GLM-5.2 available on Standard API as well as Coding Plan.
- Update the GLM-5.2 context window to 1M tokens.

## 0.2.1

- Send `Accept-Encoding: identity` so the z.ai nginx gateway does not gzip-buffer the SSE stream. Previously, `reasoning_content` deltas arrived in batches and the thinking block appeared after reasoning finished. Thinking now streams as it is generated.
- Use the official z.ai logo, a white "Z" on a dark rounded tile, as the extension icon.

## 0.2.0

- Add GLM-4.7, GLM-5, GLM-5.1, and GLM-5.2 to the picker; remove GLM-4.6.
- Filter built-in models by API mode. GLM-5 and GLM-5.1 are Standard API only, GLM-5.2 is Coding Plan only, and GLM-4.7 and GLM-4.5 Air work on both. A custom `baseUrl` shows all built-ins.
- Add `glm-copilot.customModels`. Entries can be model id strings or objects with a name, token limits, and capability flags. Custom models always appear and use the active endpoint.
- Make `glm-copilot.modelIdOverrides` a generic id-to-id map for regional endpoints and proxies.

## 0.1.0

Initial release.

- Add GLM-4.6 and GLM-4.5 Air to Copilot Chat through the VS Code Language Model Provider API.
- Support Coding Plan (`api.z.ai/api/coding/paas/v4`) and Standard API (`api.z.ai` for International, `open.bigmodel.cn` for Mainland China).
- Add `glm-copilot.thinking` to enable or disable reasoning.
- Support OpenAI-compatible function calling for Copilot agent mode and tools.
- Store the API key in VS Code `SecretStorage` (the OS keychain).
- Add a setup walkthrough for setting the API key, choosing the API mode, and opening the model picker.
- Add `glm-copilot.baseUrl` for compatible proxies and self-hosted GLM endpoints.
- Add `glm-copilot.modelIdOverrides` to map picker ids to API model names.
- Add English and Simplified Chinese localizations in `package.nls.json` and `package.nls.zh-cn.json`.
- Add optional debug logs in the GLM output channel, opened with `GLM: Show Logs`.
