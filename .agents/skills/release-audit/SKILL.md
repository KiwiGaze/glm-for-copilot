---
name: release-audit
description: >-
  Audit this VS Code extension's docs and metadata for release readiness before
  publishing a new version. Use when bumping the version, writing release notes,
  or verifying that package.json, the README badge and command table, the
  CHANGELOG, and the English/Simplified-Chinese NLS files agree with what is
  actually implemented. Runs typecheck, lint, tests, and a vsce package dry run,
  then reports release blockers without committing, tagging, or publishing.
---

# Release audit

Verify the `glm-for-github-copilot-chat` extension is ready to ship a target
version `X.Y.Z`. Treat every version number and every documented command or
feature as a claim to check against the code — never assume the docs are right.
Report blockers plainly. Do not commit, tag, or publish unless explicitly asked.

Package manager is **pnpm** (`pnpm-lock.yaml`, `.npmrc`). Never run `npm`/`yarn`.

## 1. Version consistency

The marketplace version lives in exactly two places and must match `X.Y.Z`:

- `package.json` → `"version"`.
- `README.md` → the badge `Marketplace-X.Y.Z`.

Find stray references:

```bash
grep -rniE "0\.[0-9]+\.[0-9]+" --include="*.md" --include="*.json" --include="*.txt" \
  . --exclude-dir=node_modules --exclude-dir=out --exclude-dir=dist --exclude-dir=.git \
  | grep -v pnpm-lock
```

Historical mentions inside `CHANGELOG.md` and the FAQ line about a feature
landing in a past version (e.g. "replaced … in v0.2.0") are correct, not stale.

## 2. CHANGELOG.md

- Rename `## [Unreleased]` to `## X.Y.Z`.
- Match the sibling entries' format: flat bullets directly under the version
  heading, `- **Bold label** - description`. Do **not** leave a `### Added` /
  `### Changed` subsection — those are only staging conventions; no released
  entry uses them.
- Name every new user-facing command or feature in the bullet text.
- Confirm no dangling `[Unreleased]: <url>` link-reference is left at the bottom:
  `grep -n "Unreleased\|^\[" CHANGELOG.md`.

## 3. README.md

- The **Commands** table lists every contributed command (see step 5), with the
  exact title from the NLS file.
- Feature sections mention any new commands (e.g. the usage-tracking section
  names `GLM: Refresh Usage` and `GLM: Show Usage Details`).
- `llms.txt` and `docs/glm-api.md` defer to the README for the command/model
  list, so they need no per-command updates — confirm they still defer rather
  than duplicating a now-stale list.

## 4. i18n parity

Every key in `package.nls.json` must also exist in `package.nls.zh-cn.json`
(command titles and config descriptions alike). Diff the key sets:

```bash
node -e "const a=require('./package.nls.json'),b=require('./package.nls.zh-cn.json'); \
  const m=Object.keys(a).filter(k=>!(k in b)); \
  console.log(m.length?('MISSING in zh-cn: '+m.join(', ')):'NLS parity OK')"
```

## 5. Command registration

Every `contributes.commands[].command` in `package.json` must be registered with
`vscode.commands.registerCommand` somewhere in `src/`. The usage commands
(`glm-copilot.refreshUsage`, `glm-copilot.openUsageDetail`) live in
`src/runtime/usage-bar.ts`; the rest are in `src/runtime/commands.ts` and
`src/runtime/provider.ts`. Verify:

```bash
for c in $(node -e "require('./package.json').contributes.commands.forEach(x=>console.log(x.command))"); do
  grep -rq "registerCommand('$c'" src && echo "OK  $c" || echo "MISSING  $c"
done
```

## 6. Build and release checks

All must pass (CI runs only typecheck + package, but run the full set):

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm exec vsce package --no-dependencies -o "${TMPDIR:-/tmp}/glm-X.Y.Z.vsix"
```

Package the `.vsix` to a scratch path, not the repo (`*.vsix` is gitignored
anyway). A clean "Packaged: … (N files)" line means the artifact builds.

## 7. Report

Summarise: what changed, what was verified, the check results, and any remaining
blocker. The only thing not verifiable locally is the actual Marketplace publish
(publisher auth via `vsce publish`) — flag it as the lone external step. If files
were edited by a concurrent session, say so and leave changes uncommitted unless
asked.
