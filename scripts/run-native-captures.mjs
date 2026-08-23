import { spawnSync } from 'node:child_process';
import process from 'node:process';

const image = 'pinta-online-native-capture:gtk4';
const platform = 'linux/amd64';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('docker', [
  'build',
  '--platform', platform,
  '--tag', image,
  '--file', 'tests/visual/native/Dockerfile',
  '.',
]);

run('docker', [
  'run', '--rm', '--init', '--platform', platform,
  '--volume', `${process.cwd()}:/work`, '--workdir', '/work', image,
  'dotnet', 'build', 'original/Pinta.sln', '--nologo',
]);

const captures = [
  ['workspace-default', 'tests/visual/pinta-reference/workspace-default-light.png', 'light'],
  ['workspace-default', 'tests/visual/pinta-reference/workspace-default-dark.png', 'dark'],
  ['workspace-states-all', 'tests/visual/pinta-reference', 'dark'],
  ['dialog-new-image', 'tests/visual/pinta-reference/dialog-new-image.png', 'dark'],
  ['tool-options-all', 'tests/visual/pinta-reference', 'dark'],
  ['menus-all', 'tests/visual/pinta-reference', 'dark'],
  ['standalone-dialogs-all', 'tests/visual/pinta-reference', 'dark'],
  ['adjustment-dialogs-all', 'tests/visual/pinta-reference', 'dark'],
  ['effect-dialogs-all', 'tests/visual/pinta-reference', 'dark'],
];

for (const [scenario, output, theme] of captures) {
  run('docker', [
    'run', '--rm', '--init', '--platform', platform,
    '--env', 'PINTA_NATIVE_SKIP_BUILD=1',
    '--volume', `${process.cwd()}:/work`, '--workdir', '/work', image,
    'bash', 'tests/visual/native/capture.sh', scenario, output, theme,
  ]);
}
