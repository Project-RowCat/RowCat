# 공개본 — 운영하던 RowCat에서 걷어낸 것

> 기록 문서다. 운영하던 RowCat을 코드로 공개하면서 무엇을 걷었고 무엇을 남겼는지, 그 근거를 적는다.
> 코드와 다른 문서가 이 문서의 절(`§3단계`·`D8` 등)을 근거로 가리키므로 **절의 이름과 번호를 바꾸지 않는다.**
> 포크가 바꿀 자리는 `FORKING.md`, 설정은 `docs/ops/CONFIGURATION.md`.

## 결정

| # | 항목 | 결정 | 날짜 |
| --- | --- | --- | --- |
| — | 서비스 | **운영 종료.** 코드만 공개한다 — 운영 중인 배포·회원·결제가 공개본의 전제가 아니다 | 2026-10-28 |
| — | 라이선스 | **이원화.** 앱·서버는 AGPL-3.0-only, 창작자 런타임 계열과 `contracts`는 Apache-2.0 (§라이선스) | 2026-10-28 |
| — | 결제 | **통째로 제거.** 츄르·구독·쿠폰·소장·스토어 결제 전부 (§3단계) | 2026-10-28 |
| — | 관리형 생성 | **유지, 계량 없이.** 운영자 키로 돌고, 지출 방어는 허용 목록(`MANAGED_GENERATION_ACCESS`, 기본 `allowlist`) + 회원당 속도 제한(30/분 · 400/24h, 둘 다 fail-closed) + 스트림 벽시계 상한 | 2026-10-29 |
| D1 | 나레이션 팩 본문 | **싣지 않는다.** 허락의 범위가 RowCat의 기능이었고 재배포할 권리는 확인된 적이 없다. 축과 규칙은 남는다 (`docs/chat/NARRATION.md` §공개본) | 2026-10-29 |
| D2 | 이름·상표 | 이름과 `@rowcat/` 스코프는 유지. 포크는 다른 이름으로 배포한다(README의 상표 단락) | 2026-10-29 |
| D4 | 기여 | DCO(`Signed-off-by`) — `CONTRIBUTING.md` | 2026-10-29 |
| D5 | 언어 | 코드 주석·`AGENTS.md`·루트 문서·웹 기본 로케일은 영어, `docs/`의 결정 기록은 한국어 | 2026-10-29 |
| D6 | `@rowcat/mcp` | 공개 저장소(`project-rowcat/rowcat`)의 태그 워크플로에서만 배포한다(`FORKING.md` §13). 공개 전에 npm에 올라간 판은 종료된 API를 가리킨다 | 2026-10-29 |
| D7 | 공개 시점 | 서버를 내린 뒤 공개한다 — 운영 중인 코드를 읽힌 채 서비스를 돌리지 않는다 | 2026-10-28 |
| D8 | 마이그레이션 | **기준선 하나로 압축**(`apps/api/drizzle/0000_baseline.sql`). 옛 백필·이관 문장은 싣지 않는다. 옛 로컬 개발 DB는 이 기준선과 맞지 않으므로 새로 만든다 | 2026-10-29 |
| D9 | 저작권자 | `astra-void` — `Copyright (c) 2026 astra-void` | 2026-10-29 |
| — | 약관 | **기능째 제거.** 문서·`/legal/*`·푸터·동의 게이트·개정 공지 (`FORKING.md` §10) | 2026-10-29 |
| — | 히스토리 | 공개본은 새 루트 커밋에서 시작한다 — 걷어낸 것들(사업자 정보·약관 본문·팩 본문·운영 값)이 과거 커밋으로 남지 않는다 | 2026-10-29 |

## 라이선스

의존 방향이 **Apache → AGPL로 흐르면 안 된다** (Apache 패키지가 AGPL 패키지를 import하면 그 패키지를 Apache로
쓸 수 없다). 의존 그래프로 닫힌 집합이 이렇다.

```text
Apache-2.0   runtime · runtime-compiler · runtime-host · runtime-renderer-web
             runtime-renderer-native · runtime-persistence · runtime-ai-docs · contracts
AGPL-3.0     나머지 전부 — apps/*, chat, authoring, sync, markdown, query, design, domain, sdk,
             ui-web, ui-native, runtime-mcp(authoring에 의존), prompt-packs
```

- 루트 `LICENSE` = AGPL-3.0, Apache 패키지마다 자기 `LICENSE` + `NOTICE` + `package.json`의 `license`. 원문은
  손으로 옮기지 않았다(gnu.org · apache.org의 현행 판). 저작권 줄은 원문이 아니라 `NOTICE`에 적는다.
- `sdk`·`domain`을 Apache로 여는 선택지는 쓰지 않았다 — `sdk`가 `domain`에 의존하므로 둘은 함께여야 하고, 그
  결정을 내리지 않았다.
- 잠금은 `apps/api/src/license-split.test.ts`(캐시하지 않는 테스트 작업이라 거기 둔다).
- 서드파티 고지(Pretendard OFL · QuickJS-ng MIT)는 `NOTICE`.

## 2단계 — 서비스 전용 코드

운영 종료로 근거가 사라진 것들.

| 대상 | 처리 |
| --- | --- |
| 레거시 이전 `apps/web/src/lib/local-legacy/`, `local-data/adopt.ts` | 삭제. Dexie v24가 이전 전용 테이블 다섯을 `null`로 걷고 옛 버전 선언은 남긴다 — 공개본에는 옛 오리진이 없다 |
| 법무 문서·사업자 정보 | 삭제(약관 기능째, 위 표) |
| 업데이트 노트 이력 | 비웠다. 빈 레지스트리는 0개로 읽고 두 앱의 `업데이트` 탭이 빈 상태를 그린다 |
| OTA·스토어 제출 워크플로 | 삭제하고 `docs/ota/example-workflows.md`에 본보기로 남겼다 |
| `testflight` 빌드 프로필 규칙 | 남기고 근거를 고쳤다 — 출시 전 시험판이 운영 회원 데이터에 닿지 않게 한다(근거였던 인앱 결제 Sandbox 영수증은 결제와 함께 사라졌다) |

## 3단계 — 결제 제거

결제 이름이 붙은 파일 약 120개(테스트 포함 약 57k줄), DB 테이블 열여섯, env 키 열여덟, 주기 작업 다섯, 네이티브
의존 하나(`expo-iap`), 메일 하나(갱신 사전 알림), 문서 `docs/billing/` 전체가 사라졌다. `@portone/*`는 남는다 —
본인확인이 쓴다.

### 결제 밖의 결합 지점 — 지우기 전에 규칙을 다시 세운 곳

| 결합 | 운영하던 때 | 공개본의 규칙 |
| --- | --- | --- |
| 관리형 생성 | 예약 → 계량 → 정산. 스트림의 `billing` 프레임, 요청의 `generationId`, 카탈로그의 `pricing` | 전부 삭제. 지출 방어는 허용 목록과 속도 제한이다(위 표). 운영 콘솔의 캐시 관측 화면도 그 출처(`generation_billing`)와 함께 사라졌다 |
| 재생 자격 | 창작자 · 소장자 · 구독자 셋 | **창작자이거나, 공개·링크 공개 + 성인 게이트 + 차단** — 술어 하나(`services/story/playback.ts`). 거절은 404 하나다 |
| 작품 화면의 주 동작 | 소장/구독/시작 중 고른다 | 언제나 `start`(`STORY_START_LABEL[playMode]`). `StoryDto.purchasable`·`/me/state`의 `ownedStories` 삭제 |
| 테마 | 임의 색은 Cattower 혜택 | 누구나 저장한다. 자격 불리언(`customColorsActive`)이 계약에서 사라졌고 두 쓰기(프리셋 ↔ 색)의 분리는 남는다 — 근거가 인가에서 "서로를 지우지 않는다"로 바뀌었다 |
| 계정 삭제 | 구매된 작품은 남기고, 결제 거래는 신원만 떼어 보존 | 공개 작품만 신원을 떼고 남긴다 |
| 운영 콘솔 작품 삭제 | 구매자가 있으면 떼어 낸다 | 언제나 삭제(집행이 걸린 작품은 409) |
| 만 14세 미만 제한 | 성인 콘텐츠 · 유료 구매 · BYO | 성인 콘텐츠 · BYO (`minor_purchase_restricted` 삭제) |
| 운영 스위치 | `chat · billing · publish · sync · signup` | `billing` 삭제 — 막을 경로가 없는 스위치는 동작하는 차단기처럼 읽힌다 |
| 실패 사다리 | `츄르 충전` 갈래 | 삭제. `chat_managed_not_allowed`가 AI 설정(BYO 연결) 칸에 선다 |

순서가 규칙이었다 — 생성·재생·테마의 규칙을 먼저 다시 세우고 결제 본체를 지웠다. 거꾸로 하면 지우는 커밋 하나가
세 축을 동시에 다시 설계한다.

**남긴 것**: 런타임 공개 오류 사유 `insufficient-balance`(`@rowcat/runtime-host`) — 제작자 언어 계약의 일부라
지우면 좁히기 변경이다(`RUNTIME_API_VERSION` 하한을 올려야 한다). 어떤 호스트도 내지 않으며 공개 문서가 예약된
사유로 적는다.

## 4단계 — 운영 식별자를 설정으로

- **오리진**: `@rowcat/sdk`에 기본 오리진이 없다(넘기지 않으면 던진다). 웹·운영 콘솔은 localhost로 접고, 모바일은
  `EXPO_PUBLIC_API_ORIGIN`이 비면 시작에서 던진다. 예시는 `example.com` 계열. 원래 운영자의 도메인은
  `apps/api/src/config/operator-domain.test.ts`가 트리에서 막는다.
- **앱 신원**: `APP_NAME`·`APP_BUNDLE_ID`·`APP_SCHEME`은 `packages/domain/src/app.ts`, 같은 값의 리터럴과 EAS
  `owner`/`projectId`(비어 있고, 빌드 러너에서 비면 멈춘다)는 `apps/mobile/app.config.ts`. `eas.json`은 자리표시라
  그대로는 빌드가 서지 않는다.
- **최소 구성**: 운영 배포는 `DATABASE_URL` · `BETTER_AUTH_SECRET` · `WEB_ORIGIN` · `API_ORIGIN` 넷이면 release
  blocker가 없다(`docs/ops/CONFIGURATION.md` §최소 구성, `apps/api/src/config/minimal-config.test.ts`).
- **남긴 것**: 안드로이드 네이티브 모듈의 이름 공간 `com.projectrowcat.runtimewebview` — 앱 신원이 아니고, 바꾸면
  네이티브 세대를 하나 더 올려야 한다(`FORKING.md`의 「바꾸지 않아도 되는 것」).
