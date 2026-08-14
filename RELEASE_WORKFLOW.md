# Release Workflow

This package is versioned with **[changesets](https://github.com/changesets/changesets)** and
published with **pnpm**. changesets is the single source of truth for version/CHANGELOG
management — `standard-version` / `release-please` are **not used**.

Configuration: root `.changeset/config.json` (`access: public`, `baseBranch: main`).

## Flow (overview)

```
1. make a change  →  2. pnpm changeset  →  3. pnpm run version  →  4. publish
```

### 1. Add a changeset for your change

After making a change (feature/fix), create a changeset describing it:

```bash
pnpm changeset
```

- Pick the bump type: **patch** (backwards-compatible fix), **minor** (new feature),
  **major** (breaking change). During the `0.x` phase, breaking changes usually ship as **minor**.
- Write a short summary — this text goes into the CHANGELOG.
- The command produces a `.changeset/<random-name>.md` file; commit it.

### 2. Bump the version + update the CHANGELOG

Apply all pending changesets, updating the `package.json` version and `CHANGELOG.md`:

```bash
pnpm run version
```

> ⚠️ **Not `pnpm version`** — that is pnpm's built-in command. To run the script you must
> always use **`pnpm run version`** (= `changeset version`).

Commit the generated `package.json` + `CHANGELOG.md` changes.

### 3. Publish

There are two ways:

**A) Via CI (recommended).**
GitHub → Actions → run the **"Publish to NPM"** workflow via `workflow_dispatch`.
First rehearse with `dry_run: true`, then do the real publish. (See `.github/workflows/publish.yml`.)
CI uses `pnpm install --frozen-lockfile`, so `pnpm-lock.yaml` must be committed.

**B) Local.**
```bash
pnpm run release   # = pnpm run build && changeset publish
```
This requires `npm login` and npm publish permissions first.

### 4. After publishing

```bash
git tag v$(node -p "require('./package.json').version") && git push --tags
npm view payfyio version          # verify the release shows up
npm dist-tag ls payfyio           # check the latest tag
```

(If changesets/CI tags for you, skip the manual tag step.)

## First release (0.1.0)

The package is not on npm yet. Order for the first release: verify `CHANGELOG.md` starts with
`## 0.1.0` and the `package.json` version is `0.1.0` → commit `pnpm-lock.yaml` → rehearse with
**3-A** using `dry_run` → real publish → `git tag v0.1.0`.

## Beta / pre-release

For beta versions, use changesets pre-release mode: see [`BETA_RELEASE.md`](./BETA_RELEASE.md).

## Rollback

```bash
# Release commit / tag that hasn't been pushed yet
git reset --hard HEAD~1
git tag -d v<version>
# Pushed tag
git push origin :refs/tags/v<version>
```

> A version published to npm cannot really be rolled back (`npm unpublish` is limited to 72
> hours and has restrictions). For a bad release, shipping a fix version is preferred.
