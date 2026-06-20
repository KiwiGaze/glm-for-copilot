GLM for GitHub Copilot Chat uses your own GLM API key to make GLM models available in the Copilot model picker.

Your key is stored in VS Code's SecretStorage (the OS keychain). It is never written to `settings.json` or your Git history.

Paste it once, then update or remove it later from the Command Palette.

- `Cmd/Ctrl + Shift + P`: Open the Command Palette
- `GLM: Set API Key`: Set or update your API key
- `GLM: Clear API Key`: Remove your API key
- `GLM: Get API Key`: Open the key management page for your selected API mode
