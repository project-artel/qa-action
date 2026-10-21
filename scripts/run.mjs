import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { escapeHtml, output, redact } from './workflow.mjs';

export function readOptions(env) {
  const required = name => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const seconds = name => {
    const value = required(name);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 86400) {
      throw new Error(`${name} must be an integer from 1 to 86400.`);
    }
    return Number(value);
  };
  for (const name of ['ARTEL_API_BASE_URL', 'ARTEL_CONSOLE_BASE_URL']) {
    const url = new URL(required(name));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${name} must be an HTTP(S) URL without credentials.`);
    }
  }
  const build = path.resolve(env.GITHUB_WORKSPACE || process.cwd(), required('QA_BUILD_PATH'));
  if (!statSync(build).isFile()) throw new Error('build-path must point to an executable file.');
  return {
    token: required('ARTEL_TOKEN'), project: required('QA_PROJECT_ID'),
    testRun: required('QA_TEST_RUN_ID'), build,
    launchTimeout: seconds('QA_LAUNCH_TIMEOUT'), timeout: seconds('QA_TIMEOUT'),
    cli: required('QA_CLI_PATH'), results: required('QA_RESULTS_PATH'),
  };
}

// shell 없이 argv 를 전달한다. 게임 경로와 ID 를 shell 코드로 해석하지 않는다.
export function command(file, args, { env = process.env, timeout = 120000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export async function stopGame(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  if (process.platform === 'win32') {
    const result = await command('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 10000 });
    if (result.code !== 0 && result.code !== 128) throw new Error('Could not stop the game process.');
  } else {
    // CLI 는 detached process group 으로 게임을 실행한다. 같은 group 의 자식도 정리한다.
    try { process.kill(-pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export async function verify(options, deps) {
  let game = null, run = null, result = null, completed = false;
  let verdict = 'UNKNOWN', failure = null;
  const warnings = [];
  try {
    game = await deps.cli('launch', ['game', 'start', '--build', options.build,
      '--project', options.project, '--timeout', String(options.launchTimeout), '--json'],
    (options.launchTimeout + 90) * 1000);
    if (!game.instanceId || !Number.isInteger(game.pid) || game.pid < 1) {
      throw new Error('Game registration did not return an instance ID and PID.');
    }
    deps.output('instance-id', game.instanceId);
    // run ID 를 먼저 보관해야 watch 시간 초과 뒤에도 서버의 run 을 취소할 수 있다.
    run = await deps.cli('start', ['qa', 'run', '--test-run', options.testRun,
      '--instance', game.instanceId, '--no-wait', '--json'], 120000);
    if (!run.runId) throw new Error('QA creation did not return a run ID.');
    deps.output('run-id', run.runId);
    result = await deps.cli('result', ['qa', 'watch', run.runId,
      '--timeout', String(options.timeout), '--json'], (options.timeout + 30) * 1000, true);
    if (result.runId !== run.runId) throw new Error('QA result has a different run ID.');
    completed = result.completedAt != null;
    verdict = result.verdict === 'PASSED' || result.verdict === 'FAILED' ? result.verdict : 'UNKNOWN';
    if (verdict !== 'PASSED' || result.commandExitCode !== 0 || !completed) {
      throw new Error(`ARTEL verification did not pass (${verdict}).`);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (run?.runId && !completed) {
      try { await deps.cli('cancel', ['qa', 'cancel', run.runId, '--json'], 15000, false, true); }
      catch { warnings.push('Could not confirm QA cancellation; check the run in ARTEL.'); }
    }
    if (game?.pid) {
      try { await deps.stopGame(game.pid); }
      catch { warnings.push('Could not stop the game process.'); }
    }
    deps.output('verdict', verdict);
    await deps.report({ game, run, result, verdict, failure: failure?.message ?? null, warnings });
  }
  if (failure) throw failure;
  if (warnings.length) throw new Error(warnings.join(' '));
}

export async function main(env = process.env) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const options = readOptions(env);
    const clean = text => redact(text, options.token);
    await verify(options, {
      output,
      stopGame,
      cli: async (name, args, timeout, allowFailure = false, cleanup = false) => {
        if (!cleanup && controller.signal.aborted) throw new Error('ARTEL verification interrupted.');
        const response = await command(process.execPath, [options.cli, ...args], {
          env, timeout, signal: cleanup ? undefined : controller.signal,
        });
        writeFileSync(path.join(options.results, `${name}.json`), clean(response.stdout));
        writeFileSync(path.join(options.results, `${name}.log`), clean(response.stderr));
        if (response.timedOut) throw new Error(`${name} exceeded its command deadline.`);
        let payload;
        try { payload = JSON.parse(response.stdout); }
        catch { throw new Error(`${name} did not return valid JSON. See the results artifact.`); }
        if (payload.error || (!allowFailure && response.code !== 0)) {
          throw new Error(`${name} failed. See the results artifact.`);
        }
        return { ...payload, commandExitCode: response.code };
      },
      report: async report => {
        writeFileSync(path.join(options.results, 'summary.json'), clean(JSON.stringify(report, null, 2)));
        const logs = path.join(env.ARTEL_CONFIG_DIR, 'logs');
        if (existsSync(logs)) {
          for (const name of readdirSync(logs)) {
            const file = path.join(logs, name);
            if (statSync(file).isFile()) {
              writeFileSync(path.join(options.results, `game-${name}`), clean(readFileSync(file, 'utf8')));
            }
          }
        }
        if (env.GITHUB_STEP_SUMMARY) {
          const safe = value => escapeHtml(clean(value));
          appendFileSync(env.GITHUB_STEP_SUMMARY,
            `<h3>ARTEL TC 검증 결과</h3>\n<p>Verdict: <code>${safe(report.verdict)}</code></p>\n` +
            `<p>Run: <code>${safe(report.run?.runId ?? '-')}</code></p>\n` +
            (report.failure ? `<p>${safe(report.failure)}</p>\n` : '') +
            report.warnings.map(w => `<p>${safe(w)}</p>\n`).join(''));
        }
      },
    });
  } catch (error) {
    // 자식 프로세스의 출력을 workflow command 로 실행하지 않고 artifact 에만 기록한다.
    console.error(`ARTEL QA: ${redact(error.message, env.ARTEL_TOKEN).replace(/[\r\n]/g, ' ')}`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
