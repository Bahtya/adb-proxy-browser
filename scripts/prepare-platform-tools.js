const path = require('path');
const { downloadPlatformTools } = require('../src/main/adb/download');

async function main() {
  const targetDir = path.resolve(__dirname, '../bundled-tools/platform-tools');

  console.log(`[CI] Preparing platform-tools in ${targetDir}`);

  const adbPath = await downloadPlatformTools((status, progress) => {
    const suffix = typeof progress === 'number' ? ` ${progress}%` : '';
    console.log(`[CI] platform-tools ${status}${suffix}`);
  }, { targetDir });

  console.log(`[CI] ADB prepared at ${adbPath}`);
}

main().catch((err) => {
  console.error('[CI] Failed to prepare platform-tools:', err);
  process.exit(1);
});
