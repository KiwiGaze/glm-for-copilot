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
setting overrides all of the above and is used verbatim (useful for proxies).

## Streaming

Streaming is OpenAI-compatible server-sent events:

- Lines of the form `data: {…}` and a terminating `data: [DONE]`.
- Text deltas: `choices[0].delta.content`.
- Reasoning/thinking deltas: `choices[0].delta.reasoning_content`.
- Tool-call deltas: `choices[0].delta.tool_calls[]`.
- Usage: top-level `usage` object, emitted in the final streaming chunk before
  `data: [DONE]`. The extension opts in with `stream_options: { include_usage: true }`.

## Thinking mode

Top-level request field, binary:

```json
{ "thinking": { "type": "enabled" | "disabled" } }
```

Enabled by default. In this extension, the `glm-copilot.thinking` setting maps
to `thinking.type` for models without a per-model reasoning-effort control.

### Reasoning effort

GLM-5.2 and GLM-5.3 accept a top-level `reasoning_effort` string that tunes how
much the model reasons. It only takes effect when thinking is enabled.

```json
{ "reasoning_effort": "max" }
```

For GLM-5.2, the extension surfaces `none` / `high` / `max` through the Copilot
model picker: `none` sends `thinking: { type: "disabled" }` with no
`reasoning_effort`, while `high` and `max` send `thinking: { type: "enabled" }`
plus the matching `reasoning_effort`.

For GLM-5.3, the official Coding Plan guides define `low` / `high` / `max`, with
`max` as the default. On the Coding Plan route, a disabled thinking toggle is
converted to `low`, so the extension exposes only those three effort levels and
sends `thinking: { type: "enabled" }` plus the selected effort on every request.
The built-in model is available only in Coding Plan mode. Z.AI's current Standard
API pricing catalog does not include GLM-5.3; BigModel lists the model, but its
model page says the model API is not yet available.

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
