# Security Policy

## Supported versions

The latest published version of **GLM Models for GitHub Copilot Chat** on the VS Code Marketplace receives
security fixes. Please update to the newest version before reporting an issue.

| Version | Supported |
|---|---|
| Latest `0.2.x` | Yes |
| Older releases | No |

## How your API key is handled

This extension is bring-your-own-key (BYOK). Your GLM API key is stored in VS Code's
`SecretStorage`, which is backed by the operating system keychain (macOS Keychain, Windows
Credential Manager, or the Linux secret service). The key is **never** written to
`settings.json`, never committed to your repository, and is sent only to the GLM API endpoint
you configure (`api.z.ai` or `open.bigmodel.cn`) over HTTPS.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately through GitHub's
[private vulnerability reporting](https://github.com/KiwiGaze/glm-for-copilot/security/advisories/new):

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version, and steps to reproduce.

We will acknowledge your report, investigate, and keep you updated on the fix. Once a fix is
released, we are happy to credit you in the advisory unless you prefer to remain anonymous.

Thank you for helping keep users of this extension safe.
