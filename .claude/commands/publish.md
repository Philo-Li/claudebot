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

3. Check the latest GitHub release tag:
   ```bash
   gh release list --limit 1
   ```

### Step 2: Version Bump

Ask the user what kind of release this is:
- **patch** (bug fixes): e.g. 1.0.0 → 1.0.1
- **minor** (new features): e.g. 1.0.0 → 1.1.0
- **major** (breaking changes): e.g. 1.0.0 → 2.0.0

Or let them type a specific version number.

Then update `version` in `package.json` to the new version and commit:
```bash
git add package.json
git commit -m "chore: bump version to {VERSION}"
```

### Step 3: Build

Run the Windows build:
```bash
npm run build:win
```

If the build fails, diagnose the error, fix it, and retry.

### Step 4: Create GitHub Release

Create a git tag and GitHub release, uploading the installer artifacts:

```bash
git tag v{VERSION}
git push origin master --tags
gh release create v{VERSION} dist/*.exe --title "v{VERSION}" --generate-notes
```

### Step 5: Summary

After publishing, show a summary:

```
Version:  {VERSION}
Tag:      v{VERSION}
Assets:   (list uploaded .exe files)
URL:      (release URL from gh output)
```

Remind the user that installed apps with auto-update enabled will pick up this release automatically.
