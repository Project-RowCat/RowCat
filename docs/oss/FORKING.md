# 포크하기 — 바꿀 자리 목록

이 저장소는 어느 운영자의 도메인·계정·키도 기본값으로 갖지 않는다. 운영 값은 전부 배포 설정이거나,
바이너리에 박히는 값이라 **한 자리**에 모여 있다. 아래가 그 목록 전부다.

## 1. 앱 신원 — 코드의 두 파일

| 파일 | 값 | 비고 |
| --- | --- | --- |
| `packages/domain/src/app.ts` | `APP_BUNDLE_ID` · `APP_SCHEME` · `APP_NAME` | 서버(Apple 로그인 청중·신뢰 오리진·메일 제목·패스키 이름·푸시 제목)와 웹·운영 콘솔·앱(탭 제목·워드마크)이 공유. 문장 속 이름은 §11 |
| `apps/mobile/app.config.ts` | `ios.bundleIdentifier` · `android.package` · `scheme` · `name` 리터럴 | 위와 같은 값. `src/lib/app-identity.test.ts`가 일치를 지킨다 |
| `apps/mobile/app.config.ts` | `EAS_OWNER` · `EAS_PROJECT_ID` | 비어 있으면 EAS 빌드 러너에서 멈춘다 |
| `apps/mobile/app.config.ts` | `OTA_SIGNING_KEY_ID` 표 | 채널별 키 id. 인증서는 저장소에 없다 |

번들 id·스킴은 런타임 설정이 아니다 — 바꾸는 것은 스토어 앱과 딥링크를 바꾸는 일이다.

## 2. EAS

1. `cd apps/mobile && eas init` — 프로젝트를 만든다. 동적 설정이라 값을 써넣지 못하므로
   출력된 계정 이름과 프로젝트 id를 `EAS_OWNER`·`EAS_PROJECT_ID`에 손으로 적는다.
2. `eas.json`의 자리표시(`https://api.example.com` · `https://staging-api.example.com` ·
   `https://example.com`)를 자기 배포로 바꾼다. 자리표시가 남아 있으면 빌드가 멈춘다.
   `testflight`의 API는 `production`과 달라야 한다.
3. 푸시를 쓰면 EAS 프로젝트에 APNs 키와 FCM 자격을 등록한다(`EXPO_ACCESS_TOKEN`은 선택).

## 3. OTA 서명 키

채널마다 `pnpm mobile:update keys:generate <preview|testflight|production>` — 개인 키는 저장소 밖에
두고 인증서(`apps/mobile/certs/<keyId>.pem`)만 커밋한다. 인증서가 없는 채널의 EAS 빌드는 멈춘다
(`ROWCAT_OTA=off`로 명시적으로 끌 수 있다). 절차: `docs/ota/OPERATIONS.md`. 발행 워크플로 본보기:
`docs/ota/example-workflows.md`.

## 4. 스토어 등록

새 번들 id로 App Store Connect·Play Console에 앱을 만든다. `eas.json`의 `submit.production`
(`ascAppId`·`appleTeamId`·서비스 계정 키 경로)을 채운다. `app.config.ts`의 `version`은 자유롭게 정하되
한 번 승인되면 줄일 수 없다.

## 5. 오리진 — API·웹·운영 콘솔

| 변수 | 자리 | 비고 |
| --- | --- | --- |
| `WEB_ORIGIN` | API | 웹·운영 콘솔 오리진 CSV(CORS). 첫 항목이 정본 웹 오리진 |
| `API_ORIGIN` | API | 공개 API 오리진(`/v2`는 코드가 붙인다) |
| `AUTH_TRUSTED_ORIGINS` · `AUTH_COOKIE_DOMAIN` | API | 웹과 API 오리진이 다를 때 |
| `VITE_API_ORIGIN` | web·admin 런타임 환경 | 비우면 `http://localhost:3001` — 운영 배포는 반드시 채운다. 이미지에 박히지 않으므로 다시 빌드할 필요가 없다(admin CSP도 이 값) |
| `VITE_ADMIN_ORIGIN` | web 런타임 환경 | 비우면 운영 도구 링크가 그려지지 않는다 |
| `EXPO_PUBLIC_API_ORIGIN` · `EXPO_PUBLIC_WEB_ORIGIN` | 모바일 | 기본값이 없다 |
| `ROWCAT_API_BASE_URL` | `rowcat-mcp` | 기본값이 없다(`setup`이 묻는다) |

## 6. 인증 — OAuth 콘솔

- Google: `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET`. 리다이렉트 URI `<API_ORIGIN>/v2/auth/callback/google`.
- Apple: Services ID(`APPLE_SIGN_IN_CLIENT_ID`) · `APPLE_SIGN_IN_TEAM_ID` · `APPLE_SIGN_IN_KEY_ID` ·
  `.p8` 개인 키(`APPLE_SIGN_IN_PRIVATE_KEY`). 넷 중 하나라도 빠지면 부팅이 막힌다. App ID에 Sign in with
  Apple을 켜고 Services ID의 주 앱으로 둔다. 네이티브 토큰의 청중은 `APP_BUNDLE_ID`다.
- Kakao: `KAKAO_REST_API_KEY`(REST API 키 — Admin 키가 아니다), 콘솔에서 보안을 켰다면
  `KAKAO_CLIENT_SECRET`. Redirect URI와 플랫폼 > Web 도메인에 `<API_ORIGIN>`.
- 로그인 정보가 그 제공자에게 간다 — 배포가 게시하는 개인정보처리방침이 그 사실을 적기 전에는 비워 둔다.
- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`(32자 미만이면 프로덕션 부팅이 막힌다).
- `POSTGRES_PASSWORD` — `openssl rand -hex 24`. 컴포즈에 기본값이 없고, 개발용 `rowcat`이면 프로덕션 부팅이 막힌다
  (`docs/ops/CONFIGURATION.md` 「개발 기본값은 운영 시크릿이 아니다」).

## 7. 메일

`MAIL_TRANSPORT=smtp` · `MAIL_FROM`(예: `RowCat <no-reply@example.com>`) · `SMTP_HOST` · `SMTP_PORT` ·
`SMTP_SECURE` · `SMTP_USER` · `SMTP_PASSWORD`. 발신 도메인의 SPF·DKIM·DMARC는 메일 제공자에서 설정한다.
메일이 켜지면 이메일 소유 확인도 켜진다. 비밀번호 재설정은 `PASSWORD_RESET_ENABLED=on`이 함께 있어야
열린다.

## 8. 패스키(WebAuthn)

`WEBAUTHN_RP_ID` · `WEBAUTHN_ORIGIN` — 비우면 `WEB_ORIGIN`에서 파생된다. 서브도메인 여럿이 같은 패스키를
쓸 때만 상위 도메인을 적는다. rpID가 모든 오리진을 덮지 못하면 부팅이 막힌다. `WEBAUTHN_RP_NAME` — 비우면
`APP_NAME`.

## 9. 관리형 생성

`OPENROUTER_API_KEY`(없으면 관리형 생성만 503, BYO는 된다) · `MANAGED_GENERATION_ACCESS`
(`allowlist` 기본 — 운영 콘솔에서 회원별로 켠다 · `everyone`). 계량이 없으므로 키의 청구서를 지키는 것은
허용 목록과 속도 제한뿐이다.

## 10. 법적 문서

이 저장소는 이용약관·개인정보처리방침·사업자 정보를 **싣지 않는다** — 문서도, `/legal/*` 화면도, 푸터도,
약관 동의 게이트도, 개정 공지도 없다. 배포를 공개 서비스로 여는 포크는 자기 문서를 직접 마련해 웹에 붙이고,
그 나라의 법이 상시 표시를 요구하면 그것만 담는 푸터를 더한다. 동의를 기록해야 한다면 그 게이트는 진입
게이트(`resolveMembershipGate`, 연령·보호자 동의 뒤)에 선다 — 만 14세 미만에게는 앞에 세우지 않고 보호자
동의 안에서 받는다(「민법」 제5조). 문서가 정해야 하는 운영 값(보존기간, 비밀번호 재설정 메일, Apple·Kakao
로그인, 성인 재확인)은 해당 환경 변수를 그 문서가 적은 뒤에 켠다.

## 11. 이름

`@rowcat/` 스코프와 내부 식별자(`RowCatApiError`, 로컬 저장소 이름 `rowcat_*` 등)는 코드에 남는다 — 사람이
보지 않고, 저장소 이름은 바꾸는 순간 기기에 쌓인 데이터를 옮기는 일이 된다. 포크를 배포할 때는 다른 이름을
쓴다(상표 정책은 README). 사람이 보는 이름은 두 갈래다.

| 자리 | 바꾸는 법 |
| --- | --- |
| 껍데기 — 탭 제목·워드마크·푸시 제목·모델 목록의 관리형 그룹 이름·운영 콘솔 제목·운영 CLI 배너·메일 제목·패스키 이름 | `APP_NAME` 하나와 `app.config.ts`의 `name` 리터럴 |
| 문장 — 웹·모바일의 안내 문구("○○ 계정", "○○ 제공 모델"), `docs/public/runtime` | 직접 고친다. 한국어 조사가 이름에 붙어(`RowCat이`·`RowCat을`) 변수로 바꾸면 문장이 어긋나서 상수로 빼지 않았다 — `grep -rn "RowCat" apps/*/src docs` |

`apps/mcp`(`@rowcat/mcp`·`rowcat-mcp`)는 패키지 이름이 곧 이름이라 껍데기에 들지 않는다. 포크가 그 도구를
따로 내려면 패키지 이름부터 바꾼다(아래 §13).

## 12. 시간대

제품 시간대는 `packages/domain/src/membership.ts`의 `PRODUCT_TIME_ZONE`(IANA 이름)과
`PRODUCT_TIME_ZONE_OFFSET_MINUTES`(나이 판정이 쓰는 고정 오프셋) 둘이다. 웹·운영 콘솔·모바일의 날짜 표시와
API의 `BACKGROUND_JOBS_TIMEZONE` 기본값이 앞의 것을 읽는다. 둘은 함께 바꾸고, 일광 절약 시간이 없는 시간대만
된다 — `membership.test.ts`가 일 년치 날짜로 둘을 견준다. `docker-compose.yml`과 두 `.env.example`의 기본값
줄은 `pnpm env:check`가 코드 기본값과 같은지 본다.

시간대를 바꿔도 **법이 바뀌지는 않는다** — 만 14세 보호자 동의·성인 재확인·보존기간은 한국 법을 전제로
적혔다. 다른 나라에서 운영하는 포크는 그 규칙들(`docs/membership/`)을 그 나라의 법으로 다시 판단한다.

## 13. `@rowcat/mcp` 배포

npm 배포는 `.github/workflows/mcp-publish.yml`과 `apps/mcp/scripts/release-policy.mjs`가 함께 지킨다. 그 정책은
**배포 권한이 있는 저장소**를 `RELEASE_REPOSITORY`(`Project-RowCat/RowCat`)로 고정하고, 공개
manifest(`apps/mcp/package.json`의 `repository`·`bugs`·`homepage`)가 그 저장소를 가리키는지 본다 — npm이 신뢰
배포에 붙이는 출처 증명(provenance)이 `repository.url`을 배포한 저장소와 견주므로, 어긋나면 다른 관문을 다 지난
뒤 레지스트리에서 실패한다. 포크가 그 도구를 따로 내려면 패키지 이름(`PACKAGE_NAME`)·`RELEASE_REPOSITORY`·
`release-policy.test.mjs`와 `version.test.ts`의 고정값·manifest의 세 칸·`verify-package.ts`의 저장소 확인을 함께
자기 것으로 바꾸고, npm 쪽에 그 저장소와 워크플로 파일 이름을 신뢰 배포자로 등록한다. 바꾸지 않으면 게이트가
배포를 거절한다(새는 쪽이 아니라 막히는 쪽이다).

## 14. 나레이션 팩 본문

공개본에는 본문이 없다 — RowCat이 받았던 허락은 자기 기능을 범위로 한 것이었고 재배포할 권리는 확인된 적이
없다(`docs/chat/NARRATION.md` §공개본). 그래서 대화 설정의 「서술 방식」 줄이 서지 않는다. 쓸 권리가 있는
본문을 가진 포크는 그 절의 절차대로 스물넷 **전부**를 넣고(일부만 넣으면 검사가 막는다), 출처 고지
(`NARRATION_CREDIT`·웹의 `narrationCredit`)를 받은 허락의 내용으로 고쳐 쓴다.

## 15. 컨테이너 이미지

`.github/workflows/images.yml`이 main에 푸시될 때마다 세 이미지(api·web·admin)를
`ghcr.io/<소유자>/rowcat/<앱>`에 `latest`와 `sha-<커밋>`으로 올린다. 소유자는 워크플로가 돌아간 저장소에서
읽으므로 포크는 자기 이름 공간에 올린다 — 바꿀 것은 `docker-compose.yml`이 기본으로 당겨 오는 이름 하나다
(`ROWCAT_IMAGE_REGISTRY`, 또는 그 기본값과 `docker-bake.hcl`의 `REGISTRY` 기본값). 이미지에는 배포 값이 하나도
박히지 않는다 — web과 운영 콘솔도 API 오리진을 시작할 때 환경에서 읽는다(§5) — 그래서 이미지 하나가 모든 배포에
쓰인다. 처음 올린 뒤 GitHub의 패키지 설정에서 공개 여부를 확인한다. 배포는 `ROWCAT_IMAGE_TAG`를 `sha-<커밋>`으로
고정해 `latest`가 발밑에서 바뀌지 않게 한다.

## 16. 데스크톱 설치 파일

`apps/desktop`은 앱 id(`APP_BUNDLE_ID` + `.desktop`)와 이름(`APP_NAME`)을 §1에서 가져오므로 바꿀 자리가 따로 없다.
배포하려면 서명이 필요하다 — macOS는 운영자의 Developer ID 인증서와 공증, Windows는 코드 서명 인증서. 서명하지 않은
설치 파일은 열 때 경고가 뜬다(`apps/desktop/README.md`).

## 바꾸지 않아도 되는 것

| 자리 | 이유 |
| --- | --- |
| 안드로이드 네이티브 모듈 패키지 `com.projectrowcat.runtimewebview` | 앱 신원이 아니라 모듈의 이름 공간이다. 바꾸면 네이티브 세대(`RUNTIME_VERSION`)를 하나 더 올려야 한다 |
| 로컬 저장소 이름 `rowcat_chat_<viewerId>`·SecureStore 항목 이름 | 바꾸면 기존 기기의 데이터를 옮기는 마이그레이션이 된다. 새로 시작하는 포크에는 지킬 데이터가 없어 바꿔도 되지만 얻는 것도 없다 |
| `APP_SCHEME`(`rowcat`) | 바꿔도 되지만 앱 신원과 함께 바꾼다(§1) — 이미 배포한 앱의 딥링크가 끊긴다 |

## 확인

`pnpm check && pnpm typecheck && pnpm test` — `apps/api/src/config/operator-domain.test.ts`가 원래
운영자의 도메인이 다시 들어오지 않았는지 본다.
