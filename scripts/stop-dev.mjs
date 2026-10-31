#!/usr/bin/env node
/**
 * Stops the development server started by `scripts/dev.mjs`.
 *
 * Works even when Ctrl+C is not delivered to the host terminal: it kills the
 * supervisor tree recorded in `.dev/server.pid`, then whatever owns the
 * Functions port (in case the pid file is stale or missing).
 *
 * Usage: pnpm stop [port]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const pidFile = path.join(root, '.dev', 'server.pid');
const port = Number(process.env.FUNCTIONS_PORT ?? process.argv[2] ?? 7071);
const isWindows = process.platform === 'win32';
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';

const targets = new Set();

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    if (isWindows) {
      execFileSync(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`Stopped process tree ${pid}`);
  } catch {
    // Already gone.
  }
}

function readSupervisorPid() {
  if (!existsSync(pidFile)) {
    return undefined;
  }

  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (!isWindows) {
    return pid;
  }

  // Guard against PID reuse: only kill it if it is still our dev supervisor.
  const commandLine = run(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
  ]);

  return commandLine.includes('dev.mjs') ? pid : undefined;
}

function findPortOwner() {
  if (isWindows) {
    const listener = new RegExp(String.raw`^\s*TCP\s+\S+:${port}\s+\S+\s+LISTENING\s+(\d+)`, 'i');

    for (const line of run(path.join(systemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      const match = listener.exec(line);
      if (match) {
        targets.add(Number(match[1]));
      }
    }
  }
}

const supervisorPid = readSupervisorPid();
if (supervisorPid) {
  targets.add(supervisorPid);
}

findPortOwner();

if (targets.size === 0) {
  rmSync(pidFile, { force: true });
  console.log(`No dev server running (port ${port} is free).`);
  process.exit(0);
}

for (const pid of targets) {
  killTree(pid);
}

rmSync(pidFile, { force: true });
