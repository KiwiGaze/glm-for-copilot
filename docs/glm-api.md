# GLM API Reference

Reference for the GLM (Zhipu / Z.ai) API surface this extension targets. Captured
from the Z.AI and BigModel docs (August 2026); the API mechanics here are stable.

For the current list of model ids, context windows, and capabilities shown in the
Copilot Chat model picker, see the [Models table in the README](../README.md#models)
and the `glm-copilot.MODELS` constant in `src/consts.ts` — those are the source of
truth and evolve as Z.ai ships new models.

## Authentication

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

- API key format is `{id}.{secret}` (two segments joined by a dot). Pass it verbatim
  in the `Authorization` header.
- Keys are provisioned per environment (Coding Plan vs Standard).

## Endpoints

Append `/chat/completions` to any base URL below.

| Mode | Region | Base URL |
| --- | --- | --- |
| Coding Plan | International | `https://api.z.ai/api/coding/paas/v4` |
| Coding Plan | Mainland China | `https://open.bigmodel.cn/api/coding/paas/v4` |
| Standard | International | `https://api.z.ai/api/paas/v4` |
| Standard | Mainland China | `https://open.bigmodel.cn/api/paas/v4` |

The Coding Plan endpoint is restricted to coding scenarios. The `glm-copilot.baseUrl`
setting overrides all of the above and is used verbatim (useful for proxies). Because
the extension cannot infer a compatible endpoint's capabilities, a custom base URL
also keeps every built-in model visible instead of applying official API-mode filters,
unless a custom model with the same id replaces its built-in definition.

## Streaming

Streaming is OpenAI-compatible server-sent events:

- Lines of the form `data: {…}` and a terminating `data: [DONE]`.
- Text deltas: `choices[0].delta.content`.
- Reasoning/thinking deltas: `choices[0].delta.reasoning_content`.
- Tool-call deltas: `choices[0].delta.tool_calls[]`.
- Usage: top-level `usage` object, emitted in the final streaming chunk before
  `data: [DONE]`. The extension opts in with `stream_options: { include_usage: true }`.

## GLM-5.3-Flash multimodal input

The International [Z.AI model guide](https://docs.z.ai/guides/vlm/glm-5.3-flash)
and Mainland China [BigModel model guide](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash/)
identify `glm-5.3-flash` as a multimodal model with a 1M-token context window.
Its Chat Completions input accepts text, images, video, and files; this extension
intentionally implements only VS Code image attachments.

Images are sent in an OpenAI-compatible user-message content array. `image_url.url`
may contain a public URL or a Base64 data URL; the extension uses data URLs so an
attachment does not need a separate upload:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Explain this screenshot." },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

Multiple images are supported. The extension preserves the order of text and image
parts, accepts PNG and JPEG, limits each image to 5 MB, and accepts at most 16 images
per request. It does not log Base64 payloads.

The output uses the same Chat Completion and SSE shapes as text models: final text in
`content`, optional reasoning in `reasoning_content`, and optional `tool_calls`. The
model requires `thinking: { "type": "enabled" }`; supported `reasoning_effort` values
are `low`, `high`, and `max`, with `max` used by default. The model-specific guide
describes its text limits as matching GLM-5.3, so the extension currently advertises
a 128K maximum output.

The model is documented for Coding Plan and Standard access in both regions. Access
remains account-dependent and may return model-not-found (`1211`), plan-permission
(`1311`), or rate-limit errors.

### Text-model image fallback

When the selected model does not declare native image support, the extension calls
`glm-5.3-flash` on the same resolved base URL with the same chat API key, then provides
the description to the selected model as untrusted visual data. A custom base URL is
never bypassed. Such an endpoint must expose Flash itself or use
`glm-copilot.modelIdOverrides` to map `glm-5.3-flash` to a compatible model.

Fallback requests contain no tools or conversation history and use `temperature: 1`,
`top_p: 0.95`, `reasoning_effort: "max"`, and a 32K output limit. Only final `content`
is forwarded; Flash reasoning is discarded. The configurable analysis instruction is
`glm-copilot.visionPrompt`.

## Thinking mode

Top-level request field, binary:

```json
{ "thinking": { "type": "enabled" | "disabled" } }
```

Enabled by default. In this extension, the `glm-copilot.thinking` setting maps
to `thinking.type` for models without a per-model reasoning-effort control.

### Reasoning effort

GLM-5.2, GLM-5.3, and GLM-5.3-Flash accept a top-level `reasoning_effort` string that tunes how
much the model reasons. It only takes effect when thinking is enabled.

```json
{ "reasoning_effort": "max" }
```

For GLM-5.2, the extension surfaces `none` / `high` / `max` through the Copilot
model picker: `none` sends `thinking: { type: "disabled" }` with no
`reasoning_effort`, while `high` and `max` send `thinking: { type: "enabled" }`
plus the matching `reasoning_effort`.

For GLM-5.3, the official Coding Plan guides define `low` / `high` / `max`, with
`max` as the default. The extension exposes only those three effort levels and
sends `thinking: { type: "enabled" }` plus the selected effort on every request;
an unsupported or stale stored choice falls back to `max`.
The built-in model is available only on the official Coding Plan endpoints. Z.AI's
current Standard API pricing catalog does not include GLM-5.3; BigModel lists the
model, but its model page says the model API is not yet available. A compatible
custom base URL may serve the model and keeps it visible in the picker.

Official model guides: [Z.AI Coding Plan](https://docs.z.ai/devpack/latest-model)
and [BigModel Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/latest-model.md).
Standard API availability is checked against the [Z.AI pricing catalog](https://docs.z.ai/guides/overview/pricing.md)
and the [BigModel GLM-5.3 model page](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3).

## Tools

OpenAI function-calling format:

```json
{
  "tools": [
    { "type": "function",
      "function": { "name": "...", "description": "...", "parameters": { ... } } }
  ]
}
```

The assistant returns tool calls in the standard `tool_calls[]` shape; results are
sent back as `role: "tool"` messages with the matching `tool_call_id`.

## Key management pages

| Mode / Region | Where to get a key |
| --- | --- |
| Coding Plan — International | <https://z.ai/manage-apikey/subscription> |
| Coding Plan — Mainland China | <https://bigmodel.cn/coding-plan/personal/overview> |
| Standard — International | <https://z.ai/manage-apikey/apikey-list> |
| Standard — Mainland China | <https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys> |

The `GLM: Get API Key` command opens the correct page for the active
`apiMode` / `region`.
