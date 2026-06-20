# Changelog

All notable changes to GLM for GitHub Copilot Chat are documented here.

## 0.2.3

- **Mainland China Coding Plan** — `region: china` now routes Coding Plan requests to `open.bigmodel.cn/api/coding/paas/v4` instead of z.ai, and `GLM: Get API Key` opens the bigmodel.cn coding-plan console. International Coding Plan and all Standard endpoints are unchanged; `region` defaults to `international`, so existing users are unaffected.
- **Renamed to "GLM for GitHub Copilot Chat"** — updated the extension's marketplace display name. No functional changes.

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
