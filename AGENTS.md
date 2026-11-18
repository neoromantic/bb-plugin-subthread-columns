# bb-plugin-subthread-columns

<!-- devkit:agents v1 -->
<!-- managed by devkit v1: edit in https://github.com/neoromantic/devkit/blob/main/agents/AGENTS.shared.md -->

## Shared rules (devkit)

These rules apply to people and coding agents in every repo that uses
[devkit](https://github.com/neoromantic/devkit). Project rules follow in `## Project` below.
Where they conflict, the project section wins.

### Data

- Use only made-up data in tests, fixtures, examples, docs and screenshots. No real people, chats,
  phone numbers, tokens, session files or local paths such as home directories.
- Never commit `.env` files with values, or credentials; `.env.example` and password-manager
  reference files are fine. Tests run offline by default; live API tests are opt-in and read
  their credentials from the environment.

### Commands

Use the project section's native commands for checks, offline tests and builds:

- Bun: `bun run <script>` (`check`, or `lint` and `typecheck`; `test`, `test:e2e`, `build`).
  `bun run format` formats; `check` fails on unformatted code and on lint errors.
- Python: the documented `uv run` / `uvx` commands, such as pytest, unittest and ruff.
- Go: the documented `go` commands from `go.mod`. Do not add Bun wrappers for Python or Go.
- Use Bun, uv or Go modules for installs. Use npm only for `npm publish` and `npm view`.

### Code

- Make the smallest change that works, then make it smaller. No drive-by refactors.
- Validate input at the boundaries (CLI arguments, HTTP, files, environment) and trust it
  inside: no fallbacks or checks for states that can't happen, no compatibility code for
  callers that don't exist. Published interfaces change only as the release procedure allows.
- No helpers or abstractions for logic with a single caller. More in the
  [code patterns standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/code-patterns.md).

### Definition of done

- The change works end to end and the project's applicable checks and tests pass locally.
  Verify with targeted checks and builds for what changed; wait for a full CI run only when the
  task needs its result. Required checks still gate the merge.
- README, docs and affected demos change with the behaviour they describe; follow the
  [product content standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/product-content.md).
- No new warnings, no commented-out code, no stray debug output.
- JS and TS follow the [lint and format standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/lint-format.md):
  no prose comments (rationale goes in the PR), tests beside their code, no mocks of the code
  under test, no fixed sleeps or retries. Fix the code; exceptions go in `.oxlintrc.json`.
  Tests follow the [testing standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/testing.md).

### Commits and releases

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
  A breaking change adds `!` (`feat!:`) and a `BREAKING CHANGE:` footer. In a monorepo the
  scope names the workspace (`feat(web):`). With squash merges the pull request title is the
  commit title and follows the same format.
- One logical change per commit. Never rewrite published history or force-push `main`.
- Follow the project's documented release procedure, including any owner-only steps. It defines
  versioning, tags, changelog and delivery (release, skill revision or production deployment).

### Files

- Don't add planning or progress files (`progress.md`, `docs/plans/`). Plans live in issues.
  `ROADMAP.md`, if present, is a short "Known gaps" list that links issues.
- Don't add agent hooks that rewrite tracked files.
- `AGENTS.md` is the canonical instruction file. `CLAUDE.md` contains only `@AGENTS.md`.
- Files marked "managed by devkit" (this block, `SECURITY.md`, `CONTRIBUTING.md`, the PR
  template, `.gitleaks.toml`, `.github/zizmor.yml`, `renovate.json`, `lefthook.yml`, the
  CI stub, `.oxfmtrc.jsonc`, the `.oxlintrc.devkit*.jsonc` configs and the usage telemetry
  clients) are synced from devkit. Change them there, not here.

<!-- /devkit:agents -->

## Project

Subthread Columns is a BB plugin: opening a parent thread shows it beside its waiting and failed
descendants as columns, each with its own chat and composer. Unread-result columns need the
optional Responsibilities plugin. It ships on npm as `bb-plugin-subthread-columns` with BB
plugin ID `subthread-columns`.

### Layout

- `package.json` `"bb"` declares the entry files: `server.ts` (`bb.server`, defines the
  `columns` and `maxColumns` settings) and `app.tsx` (`bb.app`, registers the auto-open app
  overlay and the `columns` nav panel page). Knip uses the same two files as entries.
- `columns-view.tsx` is the page and overlay UI, `columns.ts` picks and orders the columns,
  `attention.ts` decides which threads need you, `use-attention.ts` reads Responsibilities
  records and keeps seen marks, and `contract.ts` is the Responsibilities RPC contract.
- Tests sit beside their code as `*.test.ts` and run offline.
- `bun run build` writes `dist/` (gitignored). The npm package ships the sources, `dist/`, the
  docs and the screenshot listed in `files`.

### Commands

- `bun install --frozen-lockfile`
- `bun run check`: `oxfmt --check`, oxlint with the landmines rules, `tsc --noEmit`, Knip.
- `bun run test`: the offline tests.
- `bun run build`: `bb plugin build` into `dist/`.
- `bun run format`: formats the repo in place.

CI runs `check`, `build` and `test` through devkit's `ci-bun`.

### Gotchas

- `bun run build` uses `bb` from the pinned `bb-app` devDependency. It takes `esbuild`,
  `@tailwindcss/node`, `@tailwindcss/oxide` and `tailwindcss` from `node_modules` only at the
  exact versions that `bb-app` pins; otherwise it downloads them on the first build. When you
  bump `bb-app`, bump those four to its pins in the same change. Knip ignores them because
  nothing imports them.
- The page relies on experimental BB APIs and internal sidebar markup. Check a BB upgrade
  against the README's Compatibility section and update that section with any change.
- Screenshots use synthetic data only; `assets/README.md` records how `assets/columns.png` was
  captured.

### Release

Owner only, as for 0.1.0:

1. Set `version` in `package.json`, the pinned version in the README's Install section and in
   `PLUGIN_OVERVIEW.md`, and update `MIGRATION.md` when an upgrade needs steps.
2. On `main`, run `bun run check`, `bun run test` and `bun run build`, then pack the npm
   tarball with `bun pm pack`; it ships the prebuilt `dist/`.
3. Tag `vX.Y.Z` and publish the GitHub release "Subthread Columns X.Y.Z" with the npm tarball,
   a source archive (`bb-plugin-subthread-columns-X.Y.Z-source.tar.gz`) and `SHA256SUMS`.
4. Publish the same tarball to npm.
