# Contributing to GLM Models for GitHub Copilot Chat

You can contribute bug reports, feature requests, documentation, or code. For non-trivial code
changes, open an issue first to agree on the approach.

## Code of conduct

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). It also lists the channels for reporting
unacceptable behaviour.

## Ways to contribute

- [Report a bug](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=bug_report.yml).
- [Request a feature](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=feature_request.yml).
- Fix typos, unclear instructions, or missing documentation.
- Submit a bug fix or feature.

## Project layout

The extension is written in TypeScript and has no runtime dependencies.

- `src/extension.ts` is the activation entry point.
- `src/client/` handles OpenAI-compatible SSE streaming from the GLM API.
- `src/provider/` implements `vscode.LanguageModelChatProvider`.
- `src/runtime/` handles lifecycle, commands, and setup.
- `src/endpoint.ts`, `src/config.ts`, and `src/consts.ts` define endpoint routing and settings.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org) 20 or later.
- [pnpm](https://pnpm.io). Use pnpm to keep dependencies consistent with the lockfile.
- VS Code 1.127 or later, as specified in `package.json`.

### Install and build

```bash
pnpm install            # install dev dependencies
pnpm exec tsc -p ./     # type-check and compile to out/
```

### Run the extension

1. Open the repository in VS Code.
2. Press <kbd>F5</kbd> to launch an Extension Development Host window.
3. In that window, run `GLM: Set API Key` and pick a GLM model from the Copilot Chat picker.

### Package a VSIX

```bash
pnpm exec vsce package --no-dependencies -o dist/
```

## Coding conventions

- Use explicit TypeScript types. Avoid `any` and dead code.
- Write code that can be read without inline logic comments. Public docstrings and type
  contracts are fine. Explain design decisions in the commit message and PR description.
- Keep changes focused on the task and preserve the surrounding style.
- Discuss new runtime dependencies in an issue before adding them.
- Add user-facing strings in English and Simplified Chinese where practical. They live in
  `package.nls.json`, `package.nls.zh-cn.json`, and `src/i18n.ts`.

## Commit messages

- Use clear, present-tense summaries (e.g. "Fix thinking stream buffering on china region").
- Explain the rationale ("why") in the body, not in code comments.

## Pull request process

1. Fork the repository and create a branch from `main`.
2. Make your change. Run the checks locally before pushing:
   ```bash
   pnpm exec tsc -p ./        # must compile with no errors
   pnpm exec vsce package --no-dependencies -o dist/   # must package cleanly
   ```
3. Open a pull request against `main` and fill in the template.
4. Wait for type-checking and packaging to pass in CI.
5. Get approval from a [code owner](.github/CODEOWNERS) before merging. This applies to all
   pull requests, including forks. Pull requests are not merged automatically.
