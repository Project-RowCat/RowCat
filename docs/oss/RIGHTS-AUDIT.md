# 공개본 재배포 권리 감사

> 기록 문서다. 공개본이 싣는 코드·자산·이름을 이 저장소가 내보낼 권리가 있는지 한 번 확인했고, 무엇을 어떻게 봤는지와
> 결과를 적는다. 저장소가 답할 수 있는 것과 **권리자만 답할 수 있는 것**을 나눈다 — 뒤의 것이 남아 있는 동안
> 공개 베타를 내지 않는다. 다시 할 때는 §다시 하기를 따른다.

## 범위

2026-11-02, `main`(e57eac9)의 추적되는 파일 전부와 운영 의존성(`pnpm licenses list --prod`).

| 표면 | 본 것 |
| --- | --- |
| 저작자 | 히스토리의 작성자와 공동 작성자 표기, 공개 루트(1bdf364)와 그 전 |
| 라이선스 경계 | 모든 `package.json`의 `license`, 패키지별 `LICENSE`·`NOTICE`, Apache → AGPL 의존 방향 |
| 실린 자산 | 소스가 아닌 추적 파일 전부 — 글꼴, WASM, 이미지 |
| 지어낸 내용 | 시드·픽스처·템플릿·프롬프트 문장, 나레이션 팩의 흔적 |
| 배포물 메타데이터 | `@rowcat/mcp`의 `license`·`homepage`·`repository`·`files` |
| 의존성 | 운영 의존성의 라이선스 표기 |

## 결과

**저장소가 답할 수 있는 것은 모두 맞다.**

- **라이선스 경계.** Apache-2.0은 여덟 패키지(`runtime` · `runtime-compiler` · `runtime-host` · `runtime-renderer-web` ·
  `runtime-renderer-native` · `runtime-persistence` · `runtime-ai-docs` · `contracts`)이고, 각자 `LICENSE`와 `NOTICE`를
  갖는다. 나머지는 모두 `AGPL-3.0-only`다. `package.json`의 표기와 루트 `NOTICE`의 목록이 같다. 의존 방향은
  `apps/api/src/license-split.test.ts`가 잠그고, 이번에 돌려 48건이 통과했다.
- **실린 자산은 셋뿐이다.** Pretendard 다섯 굵기(OFL 1.1, 전문과 원저작 고지는 `apps/mobile/assets/fonts/OFL.txt`),
  QuickJS-ng WASM 두 벌(MIT — 두 파일은 바이트가 같고, `@jitl/quickjs-ng-wasmfile-release-sync@0.32.0`의
  `emscripten-module.wasm`과도 같다), 모바일 앱 아이콘 두 장(아래 남은 결정). 앞의 둘과 하네스 묶음은 루트 `NOTICE`에
  고지가 있다. 웹·콘솔·데스크톱은 이미지를 싣지 않는다.
- **지어낸 내용.** 시드(`apps/api/src/db/seed-*.ts`), 런타임 템플릿 여섯, 메일 문구, 대화 규칙 문장에는 다른 저작물을
  옮겨 왔다는 표기나 출처 줄이 없다(누가 썼는지는 아래 기여자 결정이 함께 답한다). 나레이션 팩 본문은 어느 커밋에도 없고(PLAN.md D1, 공개 루트 이후 `packages/prompt-packs`에는 로더와 빈
  표뿐), 남은 것은 코드가 맞추는 블록 이름과 원저작자 크레딧 문구다(`NARRATION_CREDIT` — 팩이 없는 빌드에서는 그
  화면에 닿지 않는다). 팩 문장을 옮겨 온 테스트 픽스처는 공개 감사 때 새로 썼다(`DISCLOSURE-AUDIT.md`).
- **`@rowcat/mcp` 메타데이터.** `0.1.0-alpha.4`부터 `license`는 `AGPL-3.0-only`, `homepage`·`repository`는 공개
  저장소, `files`는 `dist` · `README.md` · `LICENSE`다. 이미 올라간 옛 판의 메타데이터는 `DISCLOSURE-AUDIT.md`의
  운영자 일로 남아 있다.
- **의존성.** 운영 의존성은 거의 전부 MIT · Apache-2.0 · ISC · BSD다. 눈여겨본 것:

  | 의존성 | 표기 | 판단 |
  | --- | --- | --- |
  | `@img/sharp-libvips-*` | LGPL-3.0-or-later | 자기 배포본으로 설치되는 동적 라이브러리다. 저장소에도 이미지에도 수정본을 싣지 않는다 |
  | `lightningcss` | MPL-2.0 | 빌드 도구다. 수정하지 않는다 |
  | `dompurify` · `node-forge` · `type-fest` | 이중 라이선스 | 허용 쪽을 고른다 |
  | `@portone/browser-sdk@0.1.9` | 꾸러미 안에는 표기 없음 | 레지스트리의 그 판 메타데이터가 `(MIT OR Apache-2.0)`다 |

### 남은 결정 — 권리자

- **공개 루트 이전의 기여자.** 히스토리는 공개 루트(1bdf364, 2026-10-29)에서 시작하고, 그 뒤 작성자는 `astra-void`
  하나(와 AI 공동 작성자 표기)뿐이다. 운영 시절 다른 사람이 쓴 코드가 이 트리에 남았는지, 남았다면 그 사람이 이
  라이선스로 내보내는 데 동의했는지는 **히스토리로 답할 수 없다** — 그 기록은 공개 전에 걷어냈다. 권리자(D9의
  저작권자)가 확인하고 결과를 이 절에 적는다. 동의를 얻지 못한 부분이 있으면 공개 전에 다시 쓴다.
- **앱 아이콘의 지위.** `apps/mobile/assets/icon.png`와 `adaptive-icon.png`는 그림 안에 워드마크 `RowCat`을 담는다.
  지금 `NOTICE`의 규칙대로라면 이 그림도 AGPL-3.0-only로 배포되는데, README의 상표 단락은 이름을 포크에게 주지 않는다.
  둘 중 하나로 정한다 — 아이콘을 코드 라이선스에서 빼고 `NOTICE`에 상표 항목을 더하거나, 이름 없는 중립 아이콘으로
  바꾼다. 누가 그렸고 권리가 누구에게 있는지도 함께 적는다.

## 다시 하기

- 소스가 아닌 파일을 더하면 `NOTICE`의 「Third-party material」에 출처·라이선스·전문 위치를 함께 더한다. 목록은
  `git ls-files`에서 소스·문서 확장자를 뺀 것으로 다시 뽑는다.
- 패키지의 라이선스를 바꾸거나 Apache 패키지에 의존을 더하면 `license-split.test.ts`를 돌린다.
- 운영 의존성의 라이선스는 `pnpm licenses list --prod`로 다시 뽑고, 허용 계열이 아닌 것만 위 표에 판단과 함께 적는다.
