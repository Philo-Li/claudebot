---
description: Bump version, create GitHub Release, and let CI build & upload artifacts
---

# Publish Release

Bump the version, generate a changelog, create a GitHub Release with release notes, and push a tag to trigger CI builds. The CI workflow (`.github/workflows/release.yml`) handles building on all platforms and uploading artifacts.

## Workflow

### Step 1: Pre-flight Checks

1. Verify working tree is clean:

   ```bash
   git status --porcelain
   ```

   If there are uncommitted changes, stop and ask the user to commit or stash first.

2. Read current version from `package.json`.

3. Get the latest git tag to determine the last release:
   ```bash
   git describe --tags --abbrev=0
   ```

### Step 2: Generate Changelog

1. Get all commits since the last tag:

   ```bash
   git log <last-tag>..HEAD --pretty=format:"%s"
   ```

   If there is no previous tag, get the last 20 commits:

   ```bash
   git log --oneline -20
   ```

2. Parse commits by Conventional Commits prefixes and categorize into English sections:

   ```
   ## New Features
   - <description from feat commits>

   ## Improvements
   - <description from refactor/perf/style commits>

   ## Bug Fixes
   - <description from fix commits>

   ## Other
   - <description from chore/docs/test/ci commits>
   ```

   Rules:
   - Remove the `type(scope): ` prefix from each commit message, keep only the description
   - Omit any section that has no commits
   - Omit commits like "chore: bump version to ..." from the changelog

3. Based on the changes, determine a suggested bump type:
   - If there are `feat` commits → suggest **minor**
   - If only `fix` commits → suggest **patch**
   - Otherwise → suggest **patch**

### Step 3: Confirm Version Number

Use `AskUserQuestion` to present the suggested version bump and let the user choose:

- **patch** (current → next patch)
- **minor** (current → next minor)
- **major** (current → next major)
- Or they can type a specific version number

### Step 4: Confirm Changelog Content

Show the generated changelog to the user and ask them to confirm or modify it using `AskUserQuestion`.

### Step 5: Update package.json

Write the new version number into `package.json`'s `version` field.

### Step 6: Commit, Tag, and Push

```bash
git add package.json
git commit -m "chore: bump version to {VERSION}"
git tag v{VERSION}
git push origin main --tags
```

### Step 7: Create GitHub Release

Create the release with changelog as notes — **do NOT upload any files**. CI will build and upload artifacts automatically.

```bash
gh release create v{VERSION} \
  --repo Philo-Li/claudebot \
  --title "ClaudeBot v{VERSION}" \
  --notes "{CHANGELOG}"
```

Important: The `--notes` body is what `electron-updater` shows as `info.releaseNotes` in the auto-update popup. Use the changelog generated in Step 2.

### Step 8: Summary

After publishing, show a summary:

```
发版完成

版本:    {VERSION}
标签:    v{VERSION}
地址:    https://github.com/Philo-Li/claudebot/releases/tag/v{VERSION}

更新日志:
{CHANGELOG}

CI 正在构建产物，构建完成后会自动上传到 Release。
```

Remind the user to check the Actions tab to monitor CI build progress.
