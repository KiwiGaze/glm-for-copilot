Your GLM models appear in the Copilot Chat model picker as soon as the extension is active. The picker shows only the models available for your selected **API Mode** — GLM-5.3 (the extension default when no explicit `chat.defaultModel` is set), GLM-5.2, GLM-4.7, and GLM-4.5 Air on the Coding Plan, or GLM-5.2, GLM-5.1, GLM-5, GLM-4.7, and GLM-4.5 Air on the Standard API.

Until you run `GLM: Set API Key`, the models appear with a reminder to set your key. If you do not see them right away, the model list may be long — scroll down and look for the GLM models.

To turn step-by-step reasoning on or off for models without an effort picker, use the `glm-copilot.thinking` setting. GLM-5.3 always uses thinking and lets you choose Low, High, or Max effort in the model picker. To add your own model ids, use `glm-copilot.customModels`.
