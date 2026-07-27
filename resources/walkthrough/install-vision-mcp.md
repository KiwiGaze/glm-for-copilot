GLM Vision is an optional local MCP server (the official [`@z_ai/mcp-server`](https://docs.z.ai/devpack/mcp/vision-mcp-server)) that gives Copilot Chat agent mode GLM-4.6V image understanding: UI-to-code, OCR, error-screenshot diagnosis, diagram and chart analysis, and more.

Before downloading anything, the installer explains what data the package can access and asks for explicit confirmation. It then installs a fixed version locally from an integrity-locked dependency graph with npm lifecycle scripts disabled (Node.js 18+, 22+ recommended).

Once installed, the server starts automatically when you send a chat message. You can manage it any time from `MCP: List Servers` in the Command Palette, edit its analysis instruction with `GLM: Edit GLM Vision Prompt`, and remove the registration and local package with `GLM: Uninstall GLM Vision MCP Server`.

[Install GLM Vision](command:glm-copilot.installVisionMcp)
