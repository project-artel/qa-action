# ARTEL TC 검증 Action을 추가한다

ARTEL SDK가 포함된 게임 빌드를 실행하고, 기존 `test-run`의 시나리오를 검증합니다.
`PASSED`와 정상 종료가 모두 확인되어야 step이 성공합니다. 실패, 취소, 판정 불명,
시간 초과, 연결 오류는 step 실패로 처리합니다.

현재 버전은 **alpha**입니다. CLI orchestration 테스트와 실제 게임의 렌더링 검증은
별개입니다. 사용 전 아래 runner 제약을 확인하고 자신의 빌드로 화면 캡처를 검증하세요.

## Workflow에 검증 step을 추가한다

게임 저장소에서 빌드를 생성하거나 artifact를 내려받은 다음 추가합니다.
게임은 실행 파일뿐 아니라 `_Data`, DLL 등 실행에 필요한 전체 디렉터리가 있어야 합니다.

```yaml
- name: ARTEL TC 검증
  id: artel
  uses: project-artel/qa-action@v0.1.0-alpha.1
  with:
    token: ${{ secrets.ARTEL_TOKEN }}
    project-id: ${{ vars.ARTEL_PROJECT_ID }}
    test-run-id: ${{ vars.ARTEL_TEST_RUN_ID }}
    build-path: ./Build/Game.exe
```

ARTEL console에서 발급한 CLI token을 저장소의 `ARTEL_TOKEN` secret으로 등록합니다.
해당 사용자가 project와 test-run에 접근할 수 있어야 합니다. TC와 시나리오는 ARTEL에
미리 등록하고 test-run으로 묶습니다. Action은 게임 빌드와 TC 생성을 수행하지 않습니다.

## 입력값을 설정한다

| 입력 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `token` | 예 | — | ARTEL CLI token |
| `project-id` | 예 | — | 게임과 test-run이 속한 project |
| `test-run-id` | 예 | — | 실행할 시나리오 묶음 |
| `build-path` | 예 | — | workspace 기준 또는 절대 실행 파일 경로 |
| `model` | 아니요 | 서버 기본값 | `artel qa models`에서 확인한 모델 ID. 예: `claude/claude-sonnet-5-5` |
| `key-source` | 아니요 | `platform` | `user`면 ARTEL_TOKEN 소유 계정에 등록된 개인 모델 key 사용. model 필수 |
| `arch` | 아니요 | 서버 기본값 | 구조 JSON 또는 workspace 기준 `@파일경로` |
| `prompt-version` | 아니요 | 서버 기본값 | QA prompt 버전 |
| `reasoning-effort` | 아니요 | 서버 기본값 | 모델이 지원하는 reasoning effort |
| `reasoning-max-tokens` | 아니요 | 서버 기본값 | 양의 정수 token budget. effort와 동시 지정 불가 |
| `content-map-mode` | 아니요 | 서버 기본값 | `on`, `frozen`, `off` |
| `knowledge-mode` | 아니요 | 서버 기본값 | `learning`, `frozen`, `off` |
| `api-url` | 아니요 | `https://stage-orch.artel.kr` | orchestration API |
| `console-url` | 아니요 | `https://home.stage.artel.kr` | API와 짝인 console |
| `cli-version` | 아니요 | `0.0.1-alpha.1` | 설치할 정확한 CLI 버전 |
| `launch-timeout` | 아니요 | `120` | 게임 등록 대기 시간(초) |
| `timeout` | 아니요 | `1800` | QA 결과 대기 시간(초) |

### Agent 구조 설정

개인 Sonnet key를 사용하려면 `model: claude/claude-sonnet-5-5`와 `key-source: user`를
지정합니다. Anthropic key는 ARTEL 계정에 등록하며 GitHub에는 복사하지 않습니다.
개인 key 오류 시 공용 key로 재시도하지 않습니다. 현재 CLI에는 keySource 옵션이 없어
개인 key의 실행 생성은 Action이 ARTEL API를 직접 호출하고, 게임 실행과 결과 대기는 CLI를 사용합니다.

콘솔의 QA 고급 설정과 같은 JSON을 `arch`로 전달합니다. 바꾸지 않을 필드는 생략합니다.
Action은 필드를 제거하거나 기본값을 덮어쓰지 않으며, 세부 값의 지원 여부는 실행 서버가 검증합니다.

```yaml
with:
  # token, project-id, test-run-id, build-path는 앞의 예시처럼 지정합니다.
  model: claude/claude-sonnet-5-5
  arch: '{"engine":"planner_executer"}'
```

`planner_executer`는 `engine`만 지정합니다. 나머지 옵션은 `agent` 엔진용이며,
값을 바꾸면 구분 가능한 `label`(최대 50자)도 지정합니다.

```yaml
  arch: >-
    {"label":"ci-custom","phase_cycle":"full","skills":"on_demand",
     "macros":"on","screen_capture":"by_role","vision":"auto",
     "pulse_relevance":true,"report_step_view":true,"fold_stale_scenes":true,
     "fold_stale_knowledge":true,"fold_stale_skills":true,
     "fold_stale_macro_results":true,"fold_threshold_chars":2000,"compaction":true}
```

| 구조 필드 | 값 |
| --- | --- |
| `engine` | `agent`, `planner_executer` |
| `phase_cycle` | `off`, `in_verdict`, `lite`, `full` |
| `skills` | `off`, `on_demand` |
| `macros` | `off`, `on` |
| `screen_capture` | `on_demand`, `every_call`, `by_role` |
| `vision` | `auto`, `on`, `off` |
| `pulse_relevance`, `report_step_view` | `true`, `false` |
| `fold_stale_scenes`, `fold_stale_knowledge`, `fold_stale_skills`, `fold_stale_macro_results` | `true`, `false` |
| `fold_threshold_chars` | 0–10000000 정수 |
| `compaction` | `true`, `false` |

파일로 관리하려면 `arch: '@.github/artel/arch.json'`처럼 지정하고, 해당 job에서 먼저
`actions/checkout`으로 파일을 받아야 합니다. `false`와 `0`도 그대로 전달됩니다.
이 입력은 콘솔에 저장된 개인 설정을 자동으로 가져오지는 않습니다.

timeout은 1–86400초입니다. job의 `timeout-minutes`는 설치, 등록, 검증과 정리 시간을
포함하도록 더 크게 설정합니다. 다른 ARTEL 환경을 사용하면 `api-url`과 `console-url`을
함께 지정합니다. 기본값은 stage 환경입니다.

## Runner의 게임 실행 환경을 준비한다

Node.js 24와 CLI는 Action이 설치합니다. 게임의 OS, CPU architecture, graphics runtime과
SDK 화면 캡처에 필요한 렌더링 환경은 runner가 제공해야 합니다. Unity의 `-batchmode`,
`-nographics`, Dedicated Server 빌드는 화면 기반 검증 대상으로 사용하지 않습니다.

Windows `.exe`는 Windows runner에서 실행합니다. Linux에서는 Linux player와 display/
graphics 환경이 필요하며, Xvfb만으로 모든 게임의 렌더링이 보장되지는 않습니다.
일반 GitHub-hosted runner에서 특정 게임의 화면 캡처가 되는지는 실제 빌드로 확인해야 합니다.
필요하면 [GPU runner](https://docs.github.com/en/actions/reference/runners/larger-runners)를
사용합니다. GPU runner의 이름은 조직에서 설정한 이름을 workflow의 `runs-on`에 넣습니다.

현재 자동 테스트는 CLI orchestration을 검증합니다. 실제 GitHub runner에서 Unity 실행,
ARTEL 연결, screen capture까지 통과한 플랫폼은 아직 없습니다. 정식 release 전에 이 검증이 필요합니다.

## 결과와 로그를 확인한다

`run-id`, `instance-id`, `verdict`, `results-path`, `artifact-id`를 step output으로 제공합니다.
등록 이전 실패에서는 ID가 비어 있을 수 있습니다. Job summary에는 판정과 run ID가 표시됩니다.
`verdict` output만으로 CI 성공을 판단하지 마세요. 정리 실패 등은 `PASSED`여도 step을 실패시킵니다.

각 호출은 고유한 `artel-qa-*` artifact를 남깁니다. `result.json`은 CLI 최종 결과,
`summary.json`은 Action 결과이며, `launch`, `start`, `cancel`의 JSON과 진단 로그도 저장합니다.
게임 로그는 별도 파일로 수집합니다. ARTEL CLI token은 저장 전에 제거하지만 게임 자체가
출력하는 다른 민감 정보는 게임에서 제거해야 합니다. Artifact 보관 기간은 14일입니다.
GitHub Enterprise Server는 이 버전의 `upload-artifact` 지원 범위에 포함하지 않습니다.

완료되지 않은 QA run은 취소를 요청하고, 등록 시 받은 PID의 게임을 종료합니다.
취소 요청 실패는 summary에 기록합니다. Runner 강제 종료나 job hard timeout에서는 정리를
보장할 수 없습니다. CLI가 등록 결과를 반환하기 전에 실패하면 PID를 알 수 없어 게임을
직접 종료할 수 없습니다. 따라서 초기 버전은 **job 종료 후 폐기되는 runner**에서 사용하고,
장기간 유지되는 self-hosted runner는 사용하지 마세요. 해당 경우 ARTEL에 남은 run도 확인합니다.

Fork PR에는 일반적으로 secrets가 전달되지 않습니다. 예제는 같은 저장소의 PR에서만 실행합니다.
신뢰하지 않는 빌드에 token을 주기 위해 `pull_request_target`으로 전환하지 마세요.

## 테스트를 실행한다

```sh
npm test
```

외부 패키지 설치 없이 Node.js 내장 test runner를 사용합니다. 통과·실패·판정 불명,
시간 초과, 연결 오류, run 취소, 게임 종료, argv 전달과 token 제거를 검사합니다.

## Action 배포를 준비한다

`.github/workflows/ci.yml`에서 Linux, Windows, macOS 테스트를 실행합니다.
alpha는 prerelease tag로 배포합니다. 실제 SDK 빌드로 성공·실패 TC를 각각 검증한 다음
정식 release와 `v1` tag를 게시합니다. 소비자는 검증된 release commit SHA로 고정할 수 있습니다.
`examples/windows.yml`의 artifact 이름과 실행 파일 경로는 소비자 저장소에 맞게 바꿉니다.
