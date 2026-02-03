---
description: Run syntax checks and verify the project builds correctly
---

# Code Quality Check & Build

Run syntax checks and verify the Electron app builds correctly.

## Workflow

### Step 1: Syntax Check

Check all JavaScript files for syntax errors:

```bash
node --check main.cjs
node --check preload-config.cjs
node --check dopamind-client.cjs
node --check bot.js
node --check claude-runner.js
```

### Step 2: Build Verification

Run the Electron Builder to verify packaging works:

```bash
npm run build:win
```

### Step 3: Error Handling

If any check or build reports errors:

1. **Syntax errors**: Read the error output, fix the issue in the source file, re-run check
2. **Build errors**: Check electron-builder.yml config, verify dependencies, fix and re-build

### Step 4: Summary

After all checks pass, provide a summary:

```
✓ main.cjs syntax OK
✓ preload-config.cjs syntax OK
✓ dopamind-client.cjs syntax OK
✓ bot.js syntax OK
✓ claude-runner.js syntax OK
✓ Build successful
```

If fixes were made, list the files that were modified.
