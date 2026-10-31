#!/usr/bin/env node
/**
 * Development supervisor.
 *
 * Runs the Azure Functions host and the TypeScript watcher, and guarantees both
 * are torn down when:
 *   - Ctrl+C (SIGINT) / SIGTERM / SIGHUP / SIGBREAK is received,
 *   - either child exits,
 *   - the user types "q" + Enter,
 *   - `pnpm stop` runs (it kills this process tree via the pid file).
 *
 * On Windows the shutdown uses `taskkill /T /F` so `func.exe` and the language
 * worker cannot survive as orphans.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const stateDir = path.join(root, '.dev');
const pidFile = path.join(stateDir, 'server.pid');
const isWindows = process.platform === 'win32';

mkdirSync(stateDir, { recursive: true });
writeFileSync(pidFile, String(process.pid));

const children = [];
let shuttingDown = false;
let exitCode = 0;

function killTree(pid) {
  if (!pid) {
    return;
  }

  try {
    if (isWindows) {
      // /T kills func.exe and the worker; /F avoids a hung graceful shutdown.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Already gone.
  }
}

function removePidFile() {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // Ignore.
  }
}

function shutdown(code = exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    killTree(child.pid);
  }

  removePidFile();
  process.exit(code);
}

function forwardLines(name, stream) {
  let buffered = '';

  return (chunk) => {
    buffered += chunk.toString();

    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      if (line.length > 0) {
        stream.write(`[${name}] ${line}\n`);
      }
    }
  };
}

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', forwardLines(name, process.stdout));
  child.stderr.on('data', forwardLines(name, process.stderr));

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.log(`[${name}] exited (${signal ?? code}); stopping the other process`);
    exitCode = code ?? 1;
    shutdown(exitCode);
  });

  children.push(child);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, stopping dev server...`);
    exitCode = 0;
    shutdown(0);
  });
}

process.on('exit', removePidFile);

// Fallback for terminals where Ctrl+C is swallowed: type q + Enter.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  if (String(data).trim().toLowerCase() === 'q') {
    console.log('Stopping dev server...');
    shutdown(0);
  }
});
process.stdin.resume();

const stopHint = process.stdin.isTTY ? 'Press Ctrl+C to stop, type q + Enter, or ' : '';
console.log(`Dev server PID ${process.pid}. ${stopHint}run "pnpm stop" to stop it.`);

start('host', [path.join(root, 'node_modules/azure-functions-core-tools/lib/main.js'), 'start', '--cors', '*']);
start('tsc', [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--w']);
