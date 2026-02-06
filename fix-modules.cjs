// afterPack hook: copy all missing production dependencies into the packaged app
// electron-builder's dependency walker has bugs that skip some hoisted modules
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

module.exports = async function (context) {
  // macOS .app bundle has a different structure than Windows/Linux
  const isMac = process.platform === 'darwin';
  const appDir = isMac
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
    : path.join(context.appOutDir, 'resources', 'app');
  const appNodeModules = path.join(appDir, 'node_modules');
  if (!fs.existsSync(appNodeModules)) {
    fs.mkdirSync(appNodeModules, { recursive: true });
  }
  const srcNodeModules = path.join(__dirname, 'node_modules');

  // Get all production dependencies from npm
  const result = cp.execSync('npm ls --prod --all --parseable', {
    cwd: __dirname,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const prodModules = new Set();
  for (const line of result.trim().split('\n').slice(1)) {
    const normalized = line.trim().split(path.sep).join('/');
    const parts = normalized.split('/node_modules/');
    if (parts.length >= 2) {
      prodModules.add(parts[parts.length - 1]);
    }
  }

  // Find what's missing in the build output
  const existing = new Set(fs.readdirSync(appNodeModules));
  let copied = 0;

  for (const mod of prodModules) {
    if (!existing.has(mod)) {
      const src = path.join(srcNodeModules, mod);
      const dest = path.join(appNodeModules, mod);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true, dereference: true });
        console.log(`  \u2022 copied missing module: ${mod}`);
        copied++;
      }
    }
  }

  if (copied > 0) {
    console.log(`  \u2022 fixed ${copied} missing modules`);
  }
};
