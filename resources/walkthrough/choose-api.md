## Coding Plan

Use Coding Plan if you have a GLM Coding Plan subscription. Choose the `region` that matches your account:

| Region | Endpoint | API key |
|---|---|---|
| International (`z.ai`) | `api.z.ai/api/coding/paas/v4` | [z.ai](https://z.ai/manage-apikey/subscription) |
| Mainland China (`bigmodel.cn`) | `open.bigmodel.cn/api/coding/paas/v4` | [bigmodel.cn](https://bigmodel.cn/coding-plan/personal/overview) |

Set `glm-copilot.apiMode` to Coding Plan and pick the matching `glm-copilot.region` in settings.

## Standard API

Pay-as-you-go access via the GLM Open Platform. The endpoint depends on your region:

- International (`z.ai`): get your key at [z.ai](https://z.ai/manage-apikey/apikey-list).
- Mainland China (`bigmodel.cn`): get your key at [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys).

Set `glm-copilot.apiMode` to Standard API and pick the matching `glm-copilot.region`.

## Custom endpoint

Set `glm-copilot.baseUrl` to override the endpoint entirely. Both `apiMode` and `region` are ignored when a base URL is set. Use this for self-hosted proxies or compatible APIs.

Open settings to configure these options.
