// Runs actual portable firmware logic on the host. This is not a board build.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const build = mkdtempSync(join(tmpdir(), 'bnts-firmware-test-'));
try {
  // The modular controller + relay tests, then the one-file Uno program.
  for (const name of ['firmware_tests.cpp', 'standalone_tests.cpp']) {
    const binary = join(build, name.replace('.cpp', ''));
    const compile = spawnSync(process.env.CXX || 'g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', join(here, 'firmware/stubs'), join(here, name), '-o', binary], { stdio: 'inherit' });
    if (compile.error) throw compile.error;
    if (compile.status !== 0) { process.exitCode = compile.status ?? 1; break; }
    const run = spawnSync(binary, [], { stdio: 'inherit' });
    if (run.error) throw run.error;
    if (run.status !== 0) { process.exitCode = run.status ?? 1; break; }
  }
} finally { rmSync(build, { recursive: true, force: true }); }
