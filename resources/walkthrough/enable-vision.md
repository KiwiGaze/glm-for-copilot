After GLM Vision is installed, you can let text-only GLM models accept pasted or attached images.

When vision is on, every GLM model in the picker accepts image input. GLM Vision analyzes each image first and the model receives the analysis as text, so even text-only models can reason about screenshots, diagrams, and error dialogs.

Each time image input changes from off to on, wait for the approval notice and select **Manage Tool Approval**. In the workspace Tool Approval manager, find **GLM Vision > analyze_image**, then enable **without approval** only for that tool. The extension never changes approval settings or approves tools for you. Organization policy can still require confirmation.

The instruction used for analysis is configurable via `GLM: Edit GLM Vision Prompt` or `glm-copilot.visionPrompt`. If the server stops, models continue to accept images, but the affected reply shows an analysis-failure notice and continues without the image. Turning vision off or uninstalling the package makes the models text-only.

[Toggle Vision for Chat Models](command:glm-copilot.toggleVision)

[Edit GLM Vision Prompt](command:glm-copilot.openVisionPromptSettings)
