Your GLM models appear in the Copilot Chat model picker as soon as the extension is active. Without a custom `baseUrl`, **API Mode** filters the built-in models: GLM-5.3, GLM-5.2, GLM-4.7, and GLM-4.5 Air on the Coding Plan; or GLM-5.2, GLM-5.1, GLM-5, GLM-4.7, and GLM-4.5 Air on the Standard API. A custom `baseUrl` skips this official availability filter because the extension cannot infer that endpoint's capabilities. Custom models are always included and replace built-in definitions with the same id.

On VS Code 1.127+, the extension contributes GLM-5.3 as the default for new chats when neither the user nor organization sets `chat.defaultModel`.

Until you run `GLM: Set API Key`, the models appear with a reminder to set your key. If you do not see them right away, the model list may be long — scroll down and look for the GLM models.

To turn step-by-step reasoning on or off for models without an effort picker, use the `glm-copilot.thinking` setting. GLM-5.3 always uses thinking and lets you choose Low, High, or Max effort in the model picker. To add your own model ids, use `glm-copilot.customModels`.
