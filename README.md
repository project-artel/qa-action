# ARTEL QA Action

GitHub Actions에서 게임을 실행하고 ARTEL에 등록한 테스트 케이스(TC)를 검증합니다.
QA agent가 게임을 조작하며, 실행 결과와 화면은 ARTEL QA timeline에서 확인할 수 있습니다.

**[GitHub Actions 설정 가이드](https://artel.kr/docs/github-actions)** · [개발자 문서](https://artel.kr/docs) · [전체 설정](docs/configuration.md) · [v0.1.0 release](https://github.com/project-artel/qa-action/releases/tag/v0.1.0)

## 빠른 시작

ARTEL SDK가 포함된 게임 빌드와 검증할 `test-run`을 준비합니다. 게임 빌드와 TC 작성은 별도로 진행합니다.

1. ARTEL 콘솔의 **계정 설정 → CLI 토큰**에서 token을 발급합니다. 대상 프로젝트에 접근할 수 있는 계정을 사용합니다.
2. GitHub 저장소의 **Settings → Secrets and variables → Actions**에 아래 값을 등록합니다.
3. 게임 빌드 또는 artifact 다운로드 다음에 검증 step을 추가합니다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `ARTEL_TOKEN` | ARTEL CLI token |
| Variable | `ARTEL_PROJECT_ID` | 게임과 test-run이 속한 project ID |
| Variable | `ARTEL_TEST_RUN_ID` | 검증할 test-run ID |

```yaml
- name: ARTEL TC 검증
  id: artel
  uses: project-artel/qa-action@v0.1.0
  with:
    token: ${{ secrets.ARTEL_TOKEN }}
    project-id: ${{ vars.ARTEL_PROJECT_ID }}
    test-run-id: ${{ vars.ARTEL_TEST_RUN_ID }}
    build-path: ./Build/Game.x86_64
    language: ko
```

위 예시는 렌더링 환경이 준비된 Linux runner 기준입니다. `build-path`를 실제 실행 파일 경로로 바꾸세요. Windows에서는 Windows runner와 `./Build/Game.exe` 같은 경로를 사용합니다. `_Data`, DLL 등 전체 player 디렉터리가 필요합니다.

기본 연결 대상은 **stage 환경**입니다. 다른 환경을 사용하면 `api-url`과 `console-url`을 함께 지정합니다.

## 개인 Sonnet과 planner_executer 설정

ARTEL 계정 설정의 **LLM API 키**에 Anthropic key를 등록한 뒤 위 step의 `with`에 추가합니다. `ARTEL_TOKEN` 소유 계정의 key를 사용하므로 모델 key를 GitHub secret에 따로 넣을 필요는 없습니다.

```yaml
    model: claude/claude-sonnet-5-5
    key-source: user
    arch: '{"engine":"planner_executer"}'
```

사용 가능한 모델 ID는 `artel qa models`로 확인합니다. 개인 key 오류가 발생하면 공용 key로 재시도하지 않습니다. `language: ko`는 ARTEL 설명·검증 결과를 한국어로 요청하며 게임 UI 언어는 변경하지 않습니다. `planner_executer`의 한국어 출력에는 해당 기능을 지원하는 agent-server가 필요합니다.

모델, reasoning, knowledge와 agent 구조의 전체 옵션은 [설정 참고 문서](docs/configuration.md)에 있습니다.

## 결과 확인

GitHub Actions의 **Job summary**에서 서버 상태, 판정과 **QA timeline 링크**를 확인합니다. run 생성 후 검증이 실패해도 링크가 남습니다. 결과와 로그는 `artel-qa-*` artifact로 저장되며 보관 기간은 14일입니다.

| 결과 | CI 처리 |
| --- | --- |
| `PASSED`이고 실행·정리가 정상 완료됨 | 성공 |
| TC 실패, 취소, 시간 초과, 연결 오류 | 실패 |
| 최종 판정 없음 (`UNKNOWN`) | 실패 |

`UNKNOWN`은 TC 실패가 확정됐다는 뜻이 아닙니다. timeline과 `summary.json`, `result.json`, 진단 로그에서 종료 원인을 확인하세요. `verdict`만으로 성공을 판단하지 말고 Action step의 결과를 사용합니다.

| Output | 내용 |
| --- | --- |
| `timeline-url` | 생성된 QA run의 timeline URL |
| `run-id` | QA run ID |
| `instance-id` | 등록된 게임 instance ID |
| `verdict` | `PASSED`, `FAILED`, `UNKNOWN` |
| `results-path` | runner의 결과·로그 디렉터리 |
| `artifact-id` | 업로드한 artifact ID |

등록 또는 run 생성 전 실패하면 해당 ID와 링크는 비어 있을 수 있습니다. PR Checks에 timeline 링크를 추가하는 방법은 [WordVenture workflow](https://github.com/project-artel/word-venture/blob/codex/personal-key-ci/.github/workflows/artel-qa.yml)의 `PR에 QA timeline 연결` step을 참고하세요. 이 추가 step에는 `checks: write` 권한이 필요합니다.

## Runner 준비

Action이 Node.js 24와 ARTEL CLI를 설치합니다. 게임 실행에 필요한 OS, graphics runtime과 display는 workflow에서 준비해야 합니다.

- **Linux:** Linux player와 display 환경이 필요합니다. [WordVenture 적용 예시](https://github.com/project-artel/word-venture/blob/codex/personal-key-ci/.github/workflows/artel-qa.yml)는 Xvfb와 Mesa를 사용합니다. 게임에 따라 GPU가 필요할 수 있습니다.
- **Windows:** Windows player를 Windows runner에서 실행합니다. [Windows job 예시](examples/windows.yml)의 artifact 이름과 실행 경로를 수정하세요.
- **Unity:** 화면 기반 검증에는 렌더링 가능한 player를 사용합니다. `-batchmode`, `-nographics`, Dedicated Server 빌드는 대상이 아닙니다.

기본 게임 등록 대기는 120초, QA 결과 대기는 1800초입니다. job의 `timeout-minutes`는 설치와 정리 시간까지 포함해 더 크게 설정하세요.

WordVenture의 Linux CI에서는 게임 실행, ARTEL 연결과 agent 조작을 확인했습니다. 모든 TC가 통과한 것은 아니며, 다른 게임의 화면 캡처와 렌더링은 해당 빌드로 확인해야 합니다. Action 자체 테스트는 Linux·Windows·macOS에서 실행합니다.

## 운영 시 확인 사항

- job 종료 후 폐기되는 runner를 사용합니다. 강제 종료나 hard timeout, 게임 등록 전 실패에서는 게임과 QA run의 정리를 보장할 수 없어 장기간 유지되는 self-hosted runner는 사용하지 마세요.
- Fork PR에는 일반적으로 secrets가 전달되지 않습니다. 같은 저장소의 PR에서만 실행하도록 조건을 설정하고, token 전달을 위해 `pull_request_target`으로 전환하지 마세요.
- ARTEL token은 저장 로그에서 제거합니다. 게임이 출력하는 다른 민감 정보는 게임에서 제거해야 합니다.
- GitHub Enterprise Server는 이 Action이 사용하는 `upload-artifact` 버전의 지원 대상에 포함되지 않습니다.

## 개발과 테스트

```sh
npm test
```

Node.js 내장 test runner로 실행합니다. 결과 판정, timeout, 취소, 프로세스 정리, token 제거와 timeline 출력을 검증합니다. 실제 게임의 렌더링 검증은 별도로 수행합니다.
