import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { output } from './workflow.mjs';

if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(process.env.CLI_VERSION ?? '')) {
  throw new Error('cli-version must be an exact npm version.');
}
const root = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'artel-qa-'));
for (const name of ['cli', 'config', 'results']) mkdirSync(path.join(root, name));
output('cli-path', path.join(root, 'cli'));
output('config-path', path.join(root, 'config'));
output('results-path', path.join(root, 'results'));
output('artifact-name', path.basename(root));
