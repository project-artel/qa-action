# Action 입력값과 agent 설정

| 입력 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `token` | 예 | — | ARTEL CLI token |
| `project-id` | 예 | — | 게임과 test-run이 속한 project |
| `test-run-id` | 예 | — | 실행할 시나리오 묶음 |
| `build-path` | 예 | — | workspace 기준 또는 절대 실행 파일 경로 |
| `model` | 아니요 | 서버 기본값 | `artel qa models`에서 확인한 모델 ID. 예: `claude/claude-sonnet-5-5` |
| `key-source` | 아니요 | `platform` | `user`면 ARTEL_TOKEN 소유 계정에 등록된 개인 모델 key 사용. model 필수 |
| `language` | 아니요 | 서버 기본값 | ARTEL 설명·검증 결과의 언어: `ko`, `en`. 게임 언어는 변경하지 않음 |
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
개인 key 오류 시 공용 key로 재시도하지 않습니다. 현재 CLI에는 keySource와 language 옵션이 없어
개인 key나 언어를 지정하면 Action이 ARTEL API로 실행을 생성하고, 게임 실행과 결과 대기는 CLI를 사용합니다.

`language: ko`는 ARTEL의 자연어 설명과 검증 결과를 한국어로 요청합니다. 게임 UI, 코드 식별자,
오류 코드와 원본 진단 로그는 번역하지 않습니다. `planner_executer`는 출력 언어를 지원하는
agent-server 버전이 필요합니다. 이전 서버에서는 설정이 기록돼도 영어로 답할 수 있습니다.

콘솔의 QA 고급 설정과 같은 JSON을 `arch`로 전달합니다. 바꾸지 않을 필드는 생략합니다.
Action은 필드를 제거하거나 기본값을 덮어쓰지 않으며, 세부 값의 지원 여부는 실행 서버가 검증합니다.

```yaml
with:
  # token, project-id, test-run-id, build-path는 앞의 예시처럼 지정합니다.
  model: claude/claude-sonnet-5-5
  key-source: user
  language: ko
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

