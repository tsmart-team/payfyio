# Beta / Pre-release Guide (changesets)

Beta versions are shipped with **changesets pre-release mode**. The `release-please` and manual
`npm version` flows are **not used** (for the general flow see [`RELEASE_WORKFLOW.md`](./RELEASE_WORKFLOW.md)).

## Enter pre-release mode

```bash
pnpm changeset pre enter beta
```

This creates the root `.changeset/pre.json` file. From now on the `version`/`publish` commands
produce versions with a `-beta.N` suffix (e.g. `0.2.0-beta.0`).

## Beta cycle

```bash
# 1. change + changeset
pnpm changeset

# 2. bump the beta version (e.g. 0.2.0-beta.0 → .1 → .2 ...)
pnpm run version
git commit -am "version: beta"

# 3. publish with the beta tag
pnpm run release            # changeset publish; in pre mode it uses the `beta` dist-tag automatically
```

Users:

```bash
npm install @fyio/payfyio@beta
```

## Promote to stable

When the beta is done, exit pre-release mode and publish the normal version:

```bash
pnpm changeset pre exit
pnpm run version            # 0.2.0-beta.N → 0.2.0
git commit -am "version: 0.2.0"
pnpm run release            # latest dist-tag
```

## Check dist-tags

```bash
npm dist-tag ls payfyio
```
