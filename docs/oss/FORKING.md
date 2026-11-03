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
| 그림 — 모바일 앱 아이콘 `apps/mobile/assets/icon.png`(워드마크 `RowCat`이 그림 안에 있다)·`adaptive-icon.png` | 파일을 갈아 끼운다. 데스크톱 앱의 아이콘은 따로 없고 조립할 때 `icon.png`에서 그린다(`apps/desktop/scripts/build-app.ts`의 `writeIcons`) — 그 파일 하나를 바꾸면 설치 파일도 따라 바뀐다 — 두 파일은 코드 라이선스에 들지 않는다(`NOTICE`의 「Trademarks」). `APP_NAME`을 바꿔도 그림 속 이름은 남아서, 이름을 바꾼 포크의 홈 화면에 이 프로젝트의 로고가 선다. 두 파일의 관계와 규격은 `app.config.ts`의 `icon`·`adaptiveIcon` 주석 |

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

체크아웃 없이 설치하는 `scripts/install.sh`의 기본 저장소는 `Project-RowCat/RowCat`이다. 포크의 운영자는 첫
설치에 `--repo <소유자>/<이름>`을 준다. 그 값은 `.env`의 `ROWCAT_INSTALL_REPO`에 적히고 업그레이드는 그 값을 다시
쓴다(`docs/ops/INSTALL.md`). 스크립트의 `default_repo`를 포크 이름으로 바꾸면 플래그가 없어도 된다.

## 16. 데스크톱 설치 파일

`apps/desktop`은 앱 id(`APP_BUNDLE_ID` + `.desktop`)와 이름(`APP_NAME`)을 §1에서 가져오므로 바꿀 자리가 따로 없다.
배포하려면 서명이 필요하다 — macOS는 운영자의 Developer ID 인증서와 공증, Windows는 코드 서명 인증서. 서명하지 않은
설치 파일은 열 때 경고가 뜬다(`apps/desktop/README.md`).

설치된 앱의 자동 업데이트도 고칠 곳이 없다. 업데이트 피드는 릴리스 워크플로가 도는 저장소(`GITHUB_REPOSITORY`)라서,
포크가 `desktop-<날짜>` 태그로 낸 설치 파일은 포크의 릴리스를 따라간다. 원래 저장소에서 받은 설치 파일은 계속 원래
저장소를 따라가므로, 포크의 사용자는 포크의 설치 파일을 처음 한 번 직접 설치한다. 그 저장소에서 GitHub 릴리스를
내는 워크플로는 `desktop-release.yml` 하나여야 한다 — 업데이터는 태그를 가리지 않고 저장소의 「최신」 릴리스를
받는다.

## 17. 신원 확인 · 연령 · 성인 콘텐츠

**이 저장소는 법률 판단을 하지 않는다.** 어느 나라의 법을 따를지, 성인 작품을 열지, 신원 확인 기관과 계약할지는
배포의 결정이고, 아래는 각 설정에서 코드가 **무엇을 열고 무엇을 닫는지**다. 비어 있는 설정은 언제나 닫는 쪽이다
(fail-closed) — 확인하지 않은 것을 확인했다고 적는 길은 어느 설정에도 없다.

```text
                          IDENTITY_VERIFICATION_PROVIDER 비움(기본)      portone(세 값 모두)          dev(개발에서만)
회원 자신의 성인 확인     503 — 시도 행도 남지 않는다                     열린다(19세 이상이면 성인)   누구나 통과 — 운영 부팅을 막는다
만 14세 미만 보호자 동의  503 — 동의 링크가 발급되지 않는다               열린다                       누구나 통과
성인 작품 보기·공개 발행  운영자가 콘솔에서 손으로 인정한 회원만          확인한 성인 + 본인의 표시 선택
가입 · 전체이용가 · 신고 · 제재 · 동기화 · 생성                          설정과 무관하게 그대로 돈다
```

- **수동 인정이 검증 수단 없는 배포의 유일한 성인 경로다.** 운영 콘솔 회원 상세의 성인 자격(관리자만)이 두 축을
  켜고, 사유와 전후 값이 감사 기록에 남는다(`services/admin/adult-verification.ts`). 무엇을 근거로 인정하는지는
  그 배포의 책임이다 — 코드는 아동에게는 켜지 않는다는 것만 막는다.
- **두 스위치**(기본 꺼짐):

  ```text
  MEMBERSHIP_AGE_GATE=on            나이를 묻는 진입 게이트. 보호자 동의 나이 미만은 보호자 동의를 마쳐야 들어온다
                                    ⚠ 검증 수단 없이 켜면 그 회원들은 게이트에서 멈춘다(env:doctor가 degraded로 말한다)
  ADULT_REVERIFICATION_ENABLED=on   마지막 성인 확인에서 1년이 지나면 성인 보기만 닫는다
                                    ⚠ 검증 수단 없이 켜면 다시 확인할 길이 없다
  ```

- **두 나이는 배포의 설정이고, 그 나머지는 한국 법의 모양이다.** 기본값은 한국 법이고, 다른 관할의 배포는
  두 숫자를 바꾼다(API가 부팅 때 읽는다):

  ```text
  MEMBERSHIP_GUARDIAN_CONSENT_AGE=14   이 나이 미만은 보호자 동의를 거친다    기본: 「개인정보 보호법」 제22조의2
  MEMBERSHIP_ADULT_AGE=19              이 나이부터 성인으로 본다              기본: 「민법」 제4조
  ```

  판정은 API만 한다. 세 앱의 문구는 그 값을 받아 같은 숫자를 말할 뿐이다 — 웹은 서버가 쓴 `<meta>`에서
  (`apps/web/src/lib/membership-ages.ts`), 모바일은 공개 런타임 설정에서(`apps/mobile/src/lib/membership-ages.ts`),
  운영 콘솔은 숫자를 쓰지 않는다. 정수 년만 받고, 보호자 동의 나이 1–21, 성인 나이 15–25, 동의 나이 ≤ 성인 나이를
  벗어나면 **부팅이 막힌다**. 확인은 `pnpm env:doctor`의 `Age gate` 줄이다.

  ⚠ **숫자만 바뀐다.** 보호자가 본인확인으로 동의한다는 절차의 모양, 생년월일을 저장하지 않는다는 것, 나이를
  판정하는 날짜의 기준(`PRODUCT_TIME_ZONE`, KST), 성인 1년 재확인(「청소년 보호법 시행령」 제17조 제2항,
  `ADULT_REVERIFICATION_ENABLED`), 국내 본인확인 기관(PortOne, `services/identity/`)은 그대로다. 다른 관할의 법이
  다른 절차를 요구하면(예: 동의 방식, 보관 의무) 그것은 숫자가 아니라 코드로 고칠 일이고, 그 법의 검토를 거친다.

  ⚠ **이미 판정된 회원은 다시 판정하지 않는다.** 생년월일을 저장하지 않으므로, 아동으로 판정된 회원은 판정 때의
  나이로 정해진 전환일에 아동을 벗어나고, 아동이 아니라고 판정된 회원은 그대로다. 운영 중에 숫자를 바꾸면 그
  뒤에 나이를 밝히는 회원부터 새 숫자가 적용된다 — 배포를 처음 세울 때 정한다.
- **원래 서비스의 약관·개인정보처리방침·연락처는 싣지 않는다**(§10). 코드 주석이 "개인정보처리방침"을 말하는
  자리는 그 배포의 문서가 무엇을 약속할 수 있는지를 가리킬 뿐, 유효한 정책 문장이 아니다.
- **확인**: `pnpm env:doctor --mode production`의 `Identity verification`·`Age gate` 줄. 기본 구성(검증 수단 없음)의
  위 표는 `apps/api/src/routes/minimal-policy.minimal.test.ts`가 별도 프로세스(`vitest.minimal.config.ts`)에서
  값으로 확인하고, 다른 나이(13·18)는 `routes/membership-ages.jurisdiction.test.ts`(`vitest.jurisdiction.config.ts`)가, 검증 수단이 있는 쪽은 `routes/membership.test.ts`·`routes/me/adult-verification.test.ts`가 맡는다.

## 바꾸지 않아도 되는 것

| 자리 | 이유 |
| --- | --- |
| 안드로이드 네이티브 모듈 패키지 `com.projectrowcat.runtimewebview` | 앱 신원이 아니라 모듈의 이름 공간이다. 바꾸면 네이티브 세대(`RUNTIME_VERSION`)를 하나 더 올려야 한다 |
| 로컬 저장소 이름 `rowcat_chat_<viewerId>`·SecureStore 항목 이름 | 바꾸면 기존 기기의 데이터를 옮기는 마이그레이션이 된다. 새로 시작하는 포크에는 지킬 데이터가 없어 바꿔도 되지만 얻는 것도 없다 |
| `APP_SCHEME`(`rowcat`) | 바꿔도 되지만 앱 신원과 함께 바꾼다(§1) — 이미 배포한 앱의 딥링크가 끊긴다 |

## 확인

`pnpm check && pnpm typecheck && pnpm test` — `apps/api/src/config/operator-domain.test.ts`가 원래
운영자의 도메인이 다시 들어오지 않았는지 본다.
