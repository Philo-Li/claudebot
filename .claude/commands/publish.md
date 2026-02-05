---
description: Build and publish a new release to GitHub Releases
---

# Publish Release

Build the app and publish a new version to GitHub Releases for auto-update.

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

2. Parse commits by Conventional Commits prefixes and categorize into Chinese sections:

   ```
   ## 🚀 新功能
   - <description from feat commits>

   ## ⚡ 改进
   - <description from refactor/perf/style commits>

   ## 🐛 修复
   - <description from fix commits>

   ## 🔧 其他
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

### Step 6: Commit and Tag

```bash
git add package.json
git commit -m "chore: bump version to {VERSION}"
git tag v{VERSION}
```

### Step 7: Build

Run the Windows build:
```bash
npm run build:win
```

If the build fails, diagnose the error, fix it, and retry.

### Step 8: Push

```bash
git push origin master --tags
```

### Step 9: Create GitHub Release

Upload the 3 build artifacts with the changelog as release notes body:

```bash
gh release create v{VERSION} \
  "dist/ClaudeBot Setup {VERSION}.exe" \
  "dist/ClaudeBot Setup {VERSION}.exe.blockmap" \
  "dist/latest.yml" \
  --repo Philo-Li/claudebot \
  --title "ClaudeBot v{VERSION}" \
  --notes "{CHANGELOG}"
```

Important: The `--notes` body is what `electron-updater` shows as `info.releaseNotes` in the auto-update popup. Use the changelog generated in Step 2.

### Step 10: Summary

After publishing, show a summary:

```
✅ 发版完成

版本:    {VERSION}
标签:    v{VERSION}
产物:    ClaudeBot Setup {VERSION}.exe, .blockmap, latest.yml
地址:    https://github.com/Philo-Li/claudebot/releases/tag/v{VERSION}

更新日志:
{CHANGELOG}
```

Remind the user that installed apps with auto-update will pick up this release automatically.
