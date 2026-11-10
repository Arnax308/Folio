// Bump the version everywhere, then build the desktop app.
//   npm run release            -> patch (0.2.0 -> 0.2.1)
//   npm run release -- minor   -> 0.3.0
//   npm run release -- major   -> 1.0.0
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const kind = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: npm run release -- [patch|minor|major]');
  process.exit(1);
}
execSync(`npm version ${kind} --no-git-tag-version`, { stdio: 'inherit' });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const cargo = 'src-tauri/Cargo.toml';
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`\nFolio is now v${version}. Building the installer...\n`);
execSync('npx tauri build', { stdio: 'inherit' });
