import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { command, stopGame } from '../scripts/run.mjs';

const script = fileURLToPath(new URL('../scripts/run.mjs', import.meta.url));
const fixture = `
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [group, action] = process.argv.slice(2);
console.error('diagnostic ' + process.env.ARTEL_TOKEN);
if (group === 'game') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
  const logs = path.join(process.env.ARTEL_CONFIG_DIR, 'logs');
  mkdirSync(logs, { recursive: true });
  writeFileSync(path.join(logs, 'player.log'), 'game ' + process.env.ARTEL_TOKEN);
  console.log(JSON.stringify({ instanceId: 'instance-1', pid: child.pid }));
} else if (action === 'run') {
  writeFileSync(path.join(process.env.QA_RESULTS_PATH, 'args.json'), JSON.stringify(process.argv.slice(2)));
  console.log(JSON.stringify({ runId: 'run-1' }));
} else if (action === 'cancel') {
  console.log(JSON.stringify({ cancelled: true }));
} else if (process.env.FIXTURE_CASE === 'disconnect') {
  console.log(JSON.stringify({ error: { code: 'qa_watch_disconnected' } }));
  process.exitCode = 1;
} else {
  const passed = process.env.FIXTURE_CASE === 'pass';
  console.log(JSON.stringify({ runId: 'run-1', verdict: passed ? 'PASSED' : 'FAILED', completedAt: 'now' }));
  process.exitCode = passed ? 0 : 1;
}
`;

for (const scenario of ['pass', 'fail', 'disconnect']) {
  test(`실제 subprocess 와 파일로 ${scenario} 흐름을 검사한다`, async t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'artel-integration-'));
    const results = path.join(root, 'results');
    mkdirSync(results);
    const cli = path.join(root, 'fake cli.mjs');
    writeFileSync(cli, fixture);
    const build = path.join(root, 'game.exe');
    writeFileSync(build, '');
    t.after(async () => {
      try {
        const game = JSON.parse(readFileSync(path.join(results, 'launch.json'), 'utf8'));
        await stopGame(game.pid);
      } catch { /* 이미 종료된 fixture process 는 정리할 필요가 없다. */ }
      rmSync(root, { recursive: true, force: true });
    });
    const result = await command(process.execPath, [script], {
      timeout: 20000,
      env: {
        ...process.env, FIXTURE_CASE: scenario, ARTEL_TOKEN: 'fixture-secret-never-log',
        ARTEL_API_BASE_URL: 'https://example.com', ARTEL_CONSOLE_BASE_URL: 'https://console.example.com',
        ARTEL_CONFIG_DIR: path.join(root, 'config'), QA_BUILD_PATH: build,
        QA_PROJECT_ID: 'project', QA_TEST_RUN_ID: 'suite', QA_CLI_PATH: cli,
        QA_LAUNCH_TIMEOUT: '10', QA_TIMEOUT: '10', QA_RESULTS_PATH: results,
        QA_ARCH: JSON.stringify({ label: 'ci full', engine: 'agent', phase_cycle: 'full', skills: 'on_demand', macros: 'on', screen_capture: 'by_role', vision: 'auto', pulse_relevance: false, report_step_view: true, fold_stale_scenes: false, fold_stale_knowledge: true, fold_stale_skills: false, fold_stale_macro_results: true, fold_threshold_chars: 0, compaction: false }),
        QA_REASONING_EFFORT: 'high', QA_PROMPT_VERSION: 'v24', QA_CONTENT_MAP_MODE: 'frozen', QA_KNOWLEDGE_MODE: 'off',
        GITHUB_OUTPUT: path.join(root, 'outputs'), GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
      },
    });
    assert.equal(result.code, scenario === 'pass' ? 0 : 1, result.stderr);
    const report = JSON.parse(readFileSync(path.join(results, 'summary.json'), 'utf8'));
    assert.equal(report.verdict, { pass: 'PASSED', fail: 'FAILED', disconnect: 'UNKNOWN' }[scenario]);
    assert.equal(report.warnings.length, 0);
    const args = JSON.parse(readFileSync(path.join(results, 'args.json'), 'utf8'));
    const arch = JSON.parse(args[args.indexOf('--arch') + 1]);
    assert.equal(Object.keys(arch).length, 15);
    assert.equal(arch.fold_threshold_chars, 0);
    assert.equal(arch.compaction, false);
    assert.equal(args[args.indexOf('--reasoning-effort') + 1], 'high');
    assert.equal(args[args.indexOf('--prompt-version') + 1], 'v24');
    assert.equal(args[args.indexOf('--content-map-mode') + 1], 'frozen');
    assert.equal(args[args.indexOf('--knowledge-mode') + 1], 'off');
    assert.match(readFileSync(path.join(root, 'outputs'), 'utf8'), /run-1/);
    assert.match(readFileSync(path.join(root, 'summary'), 'utf8'), /ARTEL TC/);
    assert.equal(readdirSync(results).includes('cancel.json'), scenario === 'disconnect');
    for (const file of readdirSync(results)) {
      assert.ok(!readFileSync(path.join(results, file), 'utf8').includes('fixture-secret-never-log'), file);
    }
    // POSIX SIGKILL 은 비동기이므로 OS 가 process 를 회수할 때까지 상한을 두고 확인한다.
    const deadline = Date.now() + 2000;
    for (;;) {
      try { process.kill(report.game.pid, 0); }
      catch (error) { assert.equal(error.code, 'ESRCH'); break; }
      assert.ok(Date.now() < deadline, 'game process must exit');
      await delay(10);
    }
  });
}
