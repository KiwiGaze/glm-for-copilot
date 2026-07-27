With GLM Vision running, you can let text-only GLM models accept pasted or attached images.

When vision is on, every GLM model in the picker accepts image input. GLM Vision analyzes each image first and the model receives the analysis as text, so even text-only models can reason about screenshots, diagrams, and error dialogs.

The instruction used for analysis is configurable via `GLM: Edit GLM Vision Prompt` or `glm-copilot.visionPrompt`. If the server stops or is uninstalled, models fall back to text-only.

[Toggle Vision for Chat Models](command:glm-copilot.toggleVision)

[Edit GLM Vision Prompt](command:glm-copilot.openVisionPromptSettings)
