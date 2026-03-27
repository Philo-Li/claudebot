const fs = require('fs');
const paths = [
  '\\\\?\\C:\\Work\\CS\\ClaudeBot\\nul',
  '\\\\?\\C:\\Work\\CS\\ClaudeBot\\dist\\win-unpacked\\resources\\app\\nul',
];
for (const p of paths) {
  try { fs.unlinkSync(p); console.log('deleted:', p); } catch (e) { console.log('skip:', p, e.message); }
}
