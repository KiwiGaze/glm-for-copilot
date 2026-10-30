# Security policy

## Supported versions

The latest Marketplace release receives security fixes. Update before reporting an issue.

| Version | Supported |
|---|---|
| Latest Marketplace release | Yes |
| Older releases | No |

## How your API key is handled

`GLM: Set API Key` stores your key in VS Code `SecretStorage`, backed by the operating system
keychain. The command does not write the key to `settings.json`.

A settings fallback exists for CI and automation. Keep real keys out of workspace settings
and Git. Chat and image analysis use the configured API endpoint and key. Usage and balance
queries use the account endpoints for the selected region (`api.z.ai` or `open.bigmodel.cn`)
when no custom `baseUrl` is set.

## Reporting a vulnerability

Report vulnerabilities through GitHub's
[private vulnerability reporting](https://github.com/KiwiGaze/glm-for-copilot/security/advisories/new).
Keep vulnerability details out of public issues.

1. Go to the repository's Security tab.
2. Click Report a vulnerability.
3. Describe the issue, the affected version, and steps to reproduce.

We will acknowledge and investigate the report, then keep you updated on the fix. After a fix
is released, we will credit you in the advisory unless you prefer to remain anonymous.
