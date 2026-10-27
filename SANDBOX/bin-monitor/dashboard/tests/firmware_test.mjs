// Runs actual portable firmware logic on the host. This is not a board build.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const build = mkdtempSync(join(tmpdir(), 'bnts-firmware-test-'));
try {
  const binary = join(build, 'firmware-tests');
  const compile = spawnSync(process.env.CXX || 'g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', join(here, 'firmware/stubs'), join(here, 'firmware_tests.cpp'), '-o', binary], { stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else {
    const run = spawnSync(binary, [], { stdio: 'inherit' });
    if (run.error) throw run.error;
    process.exitCode = run.status ?? 1;
  }
} finally { rmSync(build, { recursive: true, force: true }); }
