# Contributing to GLM Models for GitHub Copilot Chat

Thanks for your interest in improving **GLM Models for GitHub Copilot Chat** — a VS Code extension that
brings GLM (Z.ai / Zhipu) models into the GitHub Copilot Chat model picker. Contributions of
all kinds are welcome: bug reports, feature requests, documentation fixes, and code.

This document explains how to set up the project, the conventions we follow, and how changes
get reviewed and merged.

## Code of Conduct

This project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you
are expected to uphold it. Please report unacceptable behaviour through the channels listed
there.

## Ways to contribute

- **Report a bug** — open a [Bug report](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=bug_report.yml).
- **Request a feature** — open a [Feature request](https://github.com/KiwiGaze/glm-for-copilot/issues/new?template=feature_request.yml).
- **Improve the docs** — typos, unclear wording, and missing details are all fair game.
- **Submit code** — fix a bug or build a feature. For anything non-trivial, please open an
  issue first so we can agree on the approach before you invest time.

## Project layout

The implementation is plain TypeScript with **zero runtime dependencies**. Key directories:

- `src/extension.ts` — activation entry point.
- `src/client/` — OpenAI-compatible SSE streaming client for the GLM API.
- `src/provider/` — the `vscode.LanguageModelChatProvider` implementation.
- `src/runtime/` — lifecycle, command registration, onboarding.
- `src/endpoint.ts`, `src/config.ts`, `src/consts.ts` — endpoint routing and settings.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org) 20 or later.
- [pnpm](https://pnpm.io) (this repo uses pnpm; do not use `npm` or `yarn` — it will corrupt
  the lockfile).
- VS Code 1.116 or later.

### Install and build

```bash
pnpm install            # install dev dependencies
pnpm exec tsc -p ./     # type-check and compile to out/
```

### Run the extension

1. Open the repository in VS Code.
2. Press <kbd>F5</kbd> to launch an **Extension Development Host** window.
3. In that window, run **GLM: Set API Key** and pick a GLM model from the Copilot Chat picker.

### Package a VSIX

```bash
pnpm exec vsce package --no-dependencies -o dist/
```

## Coding conventions

Please keep changes consistent with the existing code:

- **TypeScript, explicit types.** No `any`, no dead code.
- **No inline comments explaining logic.** If code needs an inline explanation, refactor it to
  be clearer. Public docstrings and type contracts are fine; explain the *why* in the commit
  message and pull request description instead.
- **Surgical changes.** Touch only what the task needs and preserve the surrounding style.
- **Keep it dependency-free.** This extension ships with no runtime dependencies; please do not
  add any without discussing it in an issue first.
- **Localization.** User-facing strings live in `package.nls.json` / `package.nls.zh-cn.json`
  and `src/i18n.ts`. Add both English and Simplified Chinese where practical.

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
4. **Continuous integration must pass.** Every PR runs type-checking and packaging in CI.
5. **A maintainer review is required.** All pull requests — including those from forks — require
   review and approval from a [code owner](.github/CODEOWNERS) before they can be merged. Pull
   requests are never merged automatically.

We aim to review pull requests promptly. Thanks for helping make the extension better.
