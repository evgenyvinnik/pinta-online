import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d{6}\.\d+$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.YYMMDD.run>');
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

packageJson.version = version;
packageLock.version = version;
packageLock.packages[''].version = version;

writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync('package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`);
console.log(`Updated Pinta Online to ${version}`);
