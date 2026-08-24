import { readFileSync } from 'node:fs';
import process from 'node:process';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const versions = [packageJson.version, packageLock.version, packageLock.packages?.['']?.version];

if (versions.some((version) => version !== packageJson.version)) {
  console.error(`Version metadata is out of sync: ${versions.join(', ')}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.(?:\d+|\d{6}\.\d+)$/.test(packageJson.version)) {
  console.error(`Unsupported Pinta Online version: ${packageJson.version}`);
  process.exit(1);
}

console.log(`Pinta Online version metadata is synchronized at ${packageJson.version}`);
