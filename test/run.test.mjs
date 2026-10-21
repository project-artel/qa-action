import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { command, readOptions, verify } from '../scripts/run.mjs';
import { output, redact, escapeHtml } from '../scripts/workflow.mjs';

const options = { build: 'a build/Game.exe', project: 'project', testRun: 'suite', launchTimeout: 5, timeout: 10 };
function harness(overrides = {}) {
  const calls = [], outputs = {}, reports = [];
  const deps = {
    async cli(name, args) {
      calls.push([name, args]);
      if (overrides[name] instanceof Error) throw overrides[name];
      return overrides[name] ?? {
        launch: { instanceId: 'instance', pid: 123 },
        start: { runId: 'run' },
        result: { runId: 'run', verdict: 'PASSED', completedAt: '2026-10-21', commandExitCode: 0 },
        cancel: { cancelled: true },
      }[name];
    },
    async stopGame(pid) { calls.push(['stop', pid]); if (overrides.stop) throw overrides.stop; },
    output(name, value) { outputs[name] = value; },
    async report(report) { reports.push(report); },
  };
  return { deps, calls, outputs, reports };
}

test('통과한 run 은 게임을 종료하고 PASSED 를 출력한다', async () => {
  const h = harness();
  await verify(options, h.deps);
  assert.deepEqual(h.calls.map(c => c[0]), ['launch', 'start', 'result', 'stop']);
  assert.deepEqual(h.outputs, { 'instance-id': 'instance', 'run-id': 'run', verdict: 'PASSED' });
  assert.ok(h.calls[1][1].includes('--no-wait'));
  assert.ok(h.calls[0][1].includes('a build/Game.exe'));
  assert.ok(!h.calls[1][1].includes('--model'));
});

test('선택한 모델을 QA 시작 요청에 전달한다', async () => {
  const h = harness();
  await verify({ ...options, model: 'claude/claude-sonnet-5-5' }, h.deps);
  const args = h.calls.find(c => c[0] === 'start')[1];
  assert.equal(args[args.indexOf('--model') + 1], 'claude/claude-sonnet-5-5');
});

for (const verdict of ['FAILED', null]) {
  test(`${verdict} 판정은 CI 실패로 처리한다`, async () => {
    const h = harness({ result: { runId: 'run', verdict, completedAt: '2026-10-21', commandExitCode: 1 } });
    await assert.rejects(verify(options, h.deps), /did not pass/);
    assert.equal(h.outputs.verdict, verdict ?? 'UNKNOWN');
    assert.equal(h.calls.at(-1)[0], 'stop');
    assert.equal(h.reports.length, 1);
  });
}

test('watch 시간 초과 뒤 서버 run 을 취소하고 게임을 종료한다', async () => {
  const h = harness({ result: new Error('timeout') });
  await assert.rejects(verify(options, h.deps), /timeout/);
  assert.deepEqual(h.calls.map(c => c[0]), ['launch', 'start', 'result', 'cancel', 'stop']);
  assert.equal(h.outputs['run-id'], 'run');
  assert.equal(h.outputs.verdict, 'UNKNOWN');
});

test('취소 실패가 게임 종료나 원래 오류를 가리지 않는다', async () => {
  const h = harness({ result: new Error('disconnected'), cancel: new Error('offline') });
  await assert.rejects(verify(options, h.deps), /disconnected/);
  assert.equal(h.calls.at(-1)[0], 'stop');
  assert.equal(h.reports[0].warnings.length, 1);
});

test('QA 생성 실패에도 실행한 게임을 종료한다', async () => {
  const h = harness({ start: new Error('creation failed') });
  await assert.rejects(verify(options, h.deps), /creation failed/);
  assert.deepEqual(h.calls.map(c => c[0]), ['launch', 'start', 'stop']);
});

test('등록 실패를 통과로 처리하지 않는다', async () => {
  const h = harness({ launch: new Error('registration failed') });
  await assert.rejects(verify(options, h.deps), /registration failed/);
  assert.equal(h.outputs.verdict, 'UNKNOWN');
  assert.equal(h.calls.length, 1);
});

for (const result of [
  { runId: 'other', verdict: 'PASSED', completedAt: 'now', commandExitCode: 0 },
  { runId: 'run', verdict: 'PASSED', completedAt: null, commandExitCode: 0 },
  { runId: 'run', verdict: 'PASSED', completedAt: 'now', commandExitCode: 1 },
]) {
  test(`잘못된 성공 결과를 거절한다: ${JSON.stringify(result)}`, async () => {
    await assert.rejects(verify(options, harness({ result }).deps));
  });
}

test('게임 종료 실패를 CI 실패로 처리한다', async () => {
  await assert.rejects(verify(options, harness({ stop: new Error('denied') }).deps), /stop/);
});

test('출력 파일에서 여러 줄의 값을 보존하고 토큰을 제거한다', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'artel-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'output');
  output('run-id', 'one\ntwo', file);
  assert.match(readFileSync(file, 'utf8'), /one\ntwo/);
  assert.equal(redact('secret / secret', 'secret'), '[REDACTED] / [REDACTED]');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('실제 subprocess 에 shell 문자를 실행하지 않고 인자로 전달한다', async () => {
  const value = 'a path/$(echo hacked); & value';
  const result = await command(process.execPath, ['-e', 'console.log(process.argv[1])', value]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), value);
});

test('멈춘 subprocess 에 deadline 을 적용한다', async () => {
  const result = await command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});

test('필수 입력과 유한 timeout 을 검사한다', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'artel-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'game'), '');
  const env = {
    GITHUB_WORKSPACE: dir, QA_BUILD_PATH: 'game', ARTEL_TOKEN: 'token',
    ARTEL_API_BASE_URL: 'https://example.com', ARTEL_CONSOLE_BASE_URL: 'https://console.example.com',
    QA_PROJECT_ID: 'p', QA_TEST_RUN_ID: 't', QA_LAUNCH_TIMEOUT: '10', QA_TIMEOUT: '20',
    QA_CLI_PATH: 'cli', QA_RESULTS_PATH: dir,
  };
  assert.equal(readOptions(env).build, path.join(dir, 'game'));
  assert.equal(readOptions(env).arch, undefined);
  const planner = { engine: 'planner_executer' };
  writeFileSync(path.join(dir, 'agent config.json'), JSON.stringify(planner));
  assert.deepEqual(JSON.parse(readOptions({ ...env, QA_ARCH: '@agent config.json' }).arch), planner);
  assert.deepEqual(JSON.parse(readOptions({ ...env, QA_ARCH: '{"new_option":false}' }).arch), { new_option: false });
  for (const arch of ['null', '[]', '"text"', '{broken']) {
    assert.throws(() => readOptions({ ...env, QA_ARCH: arch }), /arch/);
  }
  assert.throws(() => readOptions({ ...env, QA_ARCH: '@missing.json' }));
  assert.throws(() => readOptions({ ...env, QA_REASONING_EFFORT: 'high', QA_REASONING_MAX_TOKENS: '1024' }), /one reasoning/);
  for (const budget of ['0', '-1', '1.2', 'NaN']) {
    assert.throws(() => readOptions({ ...env, QA_REASONING_MAX_TOKENS: budget }), /positive/);
  }
  assert.throws(() => readOptions({ ...env, QA_CONTENT_MAP_MODE: 'bad' }), /QA_CONTENT_MAP_MODE/);
  assert.throws(() => readOptions({ ...env, QA_KNOWLEDGE_MODE: 'bad' }), /QA_KNOWLEDGE_MODE/);
  for (const bad of ['0', '-1', 'Infinity', '1.5', '90000']) {
    assert.throws(() => readOptions({ ...env, QA_TIMEOUT: bad }));
  }
  assert.throws(() => readOptions({ ...env, ARTEL_TOKEN: '' }), /required/);
  assert.throws(() => readOptions({ ...env, ARTEL_API_BASE_URL: 'https://user:password@example.com' }));
});
