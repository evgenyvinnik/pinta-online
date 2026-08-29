#!/usr/bin/env node
/**
 * Runs a Playwright `webServer` command and keeps a record of it.
 *
 * Section 2 of docs/final_polish.md asks for server output and process exit reasons to be
 * recorded as artifacts. The reason is a specific incident: the full local gate lost its
 * preview server partway through a 93-test run, and the fifteen cascading failures that
 * followed looked like fifteen application regressions. Playwright's own `stdout: 'pipe'`
 * interleaves server output into the test log, where it is unreadable next to parallel
 * worker output and gone entirely once the terminal scrolls.
 *
 * So this writes an ordered transcript to test-results/server-logs/<name>.log and, on exit,
 * appends why the process ended — code, signal, or a forwarded shutdown. That last line is
 * the one that distinguishes "the server crashed" from "Playwright shut it down normally",
 * which is exactly what the incident could not answer after the fact.
 *
 * Usage: node scripts/run-preview-server.mjs <log-name> <shell command...>
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

const [logName, ...commandParts] = process.argv.slice(2);
if (!logName || commandParts.length === 0) {
  console.error('usage: run-preview-server.mjs <log-name> <command...>');
  process.exit(2);
}

const command = commandParts.join(' ');
const logDir = path.resolve('test-results', 'server-logs');
mkdirSync(logDir, { recursive: true });

// Deliberately outside either Playwright outputDir: Playwright empties those before a run,
// and the server starts alongside that cleanup.
const logPath = path.join(logDir, `${logName}.log`);
const log = createWriteStream(logPath, { flags: 'w' });

const startedAt = Date.now();
const stamp = () => `[+${((Date.now() - startedAt) / 1000).toFixed(1)}s]`;
const note = (line) => log.write(`${stamp()} ${line}\n`);

note(`command: ${command}`);
note(`started: ${new Date(startedAt).toISOString()}`);

const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
note(`pid: ${child.pid}`);

// Both streams go to the transcript; only stderr is echoed onward, matching the configs'
// previous stderr: 'pipe' / stdout: 'ignore' so console output does not get noisier.
for (const [stream, label, echo] of [
  [child.stdout, 'out', null],
  [child.stderr, 'err', process.stderr],
]) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    echo?.write(chunk);
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) log.write(`${stamp()} ${label}| ${line}\n`);
  });
  stream.on('end', () => {
    if (pending) log.write(`${stamp()} ${label}| ${pending}\n`);
  });
}

let shutdownSignal = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdownSignal = signal;
    note(`received ${signal} from Playwright; forwarding to pid ${child.pid}`);
    child.kill(signal);
  });
}

child.on('error', (error) => {
  note(`failed to spawn: ${error.message}`);
  log.end(() => process.exit(1));
});

child.on('exit', (code, signal) => {
  const reason = shutdownSignal
    ? `shut down by ${shutdownSignal} (this is normal at the end of a run)`
    : signal
      ? `killed by ${signal} without a shutdown request — the server died on its own`
      : code === 0
        ? 'exited 0 on its own, which a long-running server should never do mid-run'
        : `exited with code ${code}`;
  note(`exit reason: ${reason}`);
  note(`ran for ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log.end(() => process.exit(signal ? 1 : (code ?? 1)));
});
