---
description: Generate a changelog summary from recent git commits
---

# Changelog Generator

Generate a changelog summary based on recent git commits.

## Workflow

### Step 1: Analyze Recent Changes

1. Get recent commits:
   ```bash
   git log --oneline -20
   ```

2. Summarize the changes into these categories:
   - **New Features**: New functionality
   - **Improvements**: Enhancements to existing features
   - **Bug Fixes**: Stability and bug fixes

3. Show the summary to the user.

### Step 2: Ask User for Version Number

Ask the user:
- What version number to use (suggest based on changes: features = minor bump, fixes only = patch bump)
- What date to use (default: today)

### Step 3: Update Version

Update the `version` field in `package.json` to match the new version.

### Step 4: Commit Changes

After all updates are complete:
```bash
git add package.json
git commit -m "chore: bump version to {VERSION}"
```
