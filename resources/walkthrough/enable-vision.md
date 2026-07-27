With GLM Vision running, you can let text-only GLM models accept pasted or attached images.

When vision is on, every GLM model in the picker accepts image input. GLM Vision analyzes each image first and the model receives the analysis as text, so even text-only models can reason about screenshots, diagrams, and error dialogs.

The instruction used for analysis is configurable via `glm-copilot.visionPrompt`. If the server stops, models fall back to text-only until it is running again.

[Toggle Vision for Chat Models](command:glm-copilot.toggleVision)
