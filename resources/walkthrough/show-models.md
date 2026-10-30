Your models appear in the native Chat and Copilot CLI model pickers when the extension is active. New installations show the current models for the selected API Mode:

| API mode | Models on a new installation |
|---|---|
| Coding Plan | GLM-5.3 (recommended), GLM-5.3-Flash |
| Standard API | GLM-5.3-Flash (recommended), GLM-5.3-FlashX |

Run `GLM: Use Recommended Default Model` to use the recommendation in new conversations. User and organization defaults take precedence over automatic setup. Existing conversations keep their selected model; start a new conversation to use the new default.

GLM-5.2 and earlier are hidden on new installations. Existing installations keep them available on upgrade. Use `glm-copilot.showLegacyModels` to show or hide them. Hiding them may make a saved conversation's model unavailable. Custom models are always included.

With a custom `baseUrl`, API-mode filtering is skipped because the extension cannot infer the endpoint's capabilities. Choose the model manually. Custom definitions replace matching built-ins.

Run `GLM: Set API Key` to add your credentials. Until then, models show a reminder to set the key. GLM-5.3 and Flash models offer Low, High, and Max thinking effort. Add other model ids through `glm-copilot.customModels`.
