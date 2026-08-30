import { spawnSync } from 'node:child_process';
import process from 'node:process';

function option(name) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

const config = option('--config');
const project = option('--project');
const requestedShard = option('--shard');
const requestedShardCount = option('--shards');
const label = option('--label') ?? project ?? 'browser';
if (!config || !project) {
  console.error('Usage: run-browser-shards.mjs --config=<file> --project=<name> [--shards=4] [--shard=1/4]');
  process.exit(2);
}

const shardCount = Number(requestedShardCount ?? '4');
if (!Number.isInteger(shardCount) || shardCount < 1) {
  console.error(`Invalid shard count: ${requestedShardCount}`);
  process.exit(2);
}

const shards = requestedShard
  ? [requestedShard]
  : Array.from({ length: shardCount }, (_, index) => `${index + 1}/${shardCount}`);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

for (const shard of shards) {
  console.log(`\n${label} shard ${shard}`);
  const result = spawnSync(
    npx,
    ['playwright', 'test', `--config=${config}`, `--project=${project}`, `--shard=${shard}`, '--workers=1'],
    { stdio: 'inherit' },
  );

  if (result.error) {
    console.error(`Unable to start Playwright: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
