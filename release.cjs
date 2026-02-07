/**
 * release.cjs — 一键发版脚本
 *
 * 用法:
 *   npm run release patch    # 1.0.0 → 1.0.1
 *   npm run release minor    # 1.0.0 → 1.1.0
 *   npm run release major    # 1.0.0 → 2.0.0
 *   npm run release 1.2.3    # 指定版本号
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GH = process.platform === 'win32' ? 'C:\\gh\\bin\\gh.exe' : 'gh';

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', encoding: 'utf-8', ...opts });
}

// --- Parse version arg ---
const arg = process.argv[2];
if (!arg) {
  console.error('用法: npm run release <patch|minor|major|x.y.z>');
  process.exit(1);
}

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const oldVersion = pkg.version;

let newVersion;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  newVersion = arg;
} else {
  const parts = oldVersion.split('.').map(Number);
  if (arg === 'patch') parts[2]++;
  else if (arg === 'minor') {
    parts[1]++;
    parts[2] = 0;
  } else if (arg === 'major') {
    parts[0]++;
    parts[1] = 0;
    parts[2] = 0;
  } else {
    console.error(`无效参数: ${arg}（可用: patch, minor, major, 或具体版本号）`);
    process.exit(1);
  }
  newVersion = parts.join('.');
}

const tag = `v${newVersion}`;
const distDir = path.join(__dirname, 'dist');

console.log(`\n发版: ${oldVersion} → ${newVersion}\n`);

// 1. 更新 package.json 版本号
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json 版本更新为 ${newVersion}`);

// 2. 提交版本变更
run('git add package.json');
run(`git commit -m "chore: bump version to ${newVersion}"`);

// 3. 构建
console.log('\n构建中...\n');
run('npm run build:win');

// 4. 创建 tag 并推送
run(`git tag ${tag}`);
run('git push origin master');
run(`git push origin ${tag}`);

// 5. 查找构建产物
const setupExe = `ClaudeBot Setup ${newVersion}.exe`;
const blockmap = `${setupExe}.blockmap`;
const latestYml = 'latest.yml';

for (const f of [setupExe, blockmap, latestYml]) {
  if (!fs.existsSync(path.join(distDir, f))) {
    console.error(`找不到构建产物: dist/${f}`);
    process.exit(1);
  }
}

// 6. 创建 GitHub Release 并上传
console.log('\n发布到 GitHub...\n');

const notes = `## ClaudeBot ${tag}`;
run(
  `"${GH}" release create ${tag} --repo Philo-Li/claudebot --title "ClaudeBot ${tag}" --notes "${notes}" "${path.join(distDir, setupExe)}" "${path.join(distDir, blockmap)}" "${path.join(distDir, latestYml)}"`,
);

console.log(`\n✓ 发版完成: https://github.com/Philo-Li/claudebot/releases/tag/${tag}\n`);
