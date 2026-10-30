# apps/desktop — 컴퓨터 한 대에서 도는 RowCat

설치 파일 하나(macOS `.dmg`, Windows `.exe`)를 두 번 눌러 여는 앱. 그 안에서 **배포 전체**가 돈다 —
Postgres 하나와 컨테이너 이미지가 돌리는 세 서버(API·웹·운영 콘솔). 터미널도 Docker도 필요 없다.

```text
Electron 메인 프로세스 (src/main.ts)     창 · 메뉴 · 켜고 끄기
  ├─ Postgres            내장 바이너리(embedded-postgres)   127.0.0.1:<db>
  ├─ API                 apps/api/dist  (Electron을 Node로)  localhost:<api>
  ├─ 웹                  apps/web/.output                   localhost:<web>   ← 창이 여는 곳
  └─ 운영 콘솔           apps/admin/dist (메인 프로세스의 정적 서버) localhost:<console>
```

## 이 앱이 지키는 것

- **서버는 이미지가 싣는 빌드 결과물 그대로다.** 데스크톱 전용 코드 경로를 API 안에 두지 않는다 — 그런
  경로는 아무 데서도 시험되지 않는 두 번째 제품이고, 그 차이는 가장 제보하기 어려운 사람들에게서 드러난다.
  다른 것은 환경 변수뿐이다(`src/stack.ts`).
- **세 서버는 모두 `localhost`의 서로 다른 포트에 선다.** 세션 쿠키가 `SameSite=Lax`라서 웹·콘솔·API가 같은
  사이트여야 로그인이 되고, 브라우저는 `localhost`의 포트를 가리지 않고 한 사이트로 본다 — `pnpm dev`와 같은
  모양이다. 게이트웨이도, 콘솔의 하위 경로도 필요 없다.
- **포트는 처음 실행할 때 한 번 정하고 다시 고르지 않는다**(`src/settings.ts`). 브라우저는 IndexedDB를
  오리진별로 나누고 오리진에는 포트가 들어 있다 — 포트가 바뀌면 그 컴퓨터의 대화와 초안이 아무도 열지 않는
  오리진 밑에 남는다. 포트가 막혀 있으면 실행이 멈추고 그렇게 말한다.
- **시크릿은 생성하고 받아 적지 않는다.** 세션 키와 DB 비밀번호는 첫 실행에서 무작위로 만들어 데이터 폴더의
  `settings.json`(0600)에 둔다. 저장소가 공개하는 값은 운영 부팅이 거부한다(`deployment-secrets.ts`).
- **운영 배포로 돈다**(`NODE_ENV=production`). 개발용 본인인증·메일 전송·시크릿이 모두 거부되는 쪽이다.
- **창은 Electron의 Chromium이다.** API가 운영 모드라 세션 쿠키가 `Secure`이고, Chromium은
  `http://localhost`에 `Secure` 쿠키를 저장하지만 Safari는 믿을 수 없다. `기본 브라우저에서 열기`는 메뉴에 있다.
- **앱이 죽어도 다음 실행이 막히지 않는다.** 서버는 IPC 채널이 닫히면 스스로 내려가고(`EXIT_WITH_PARENT`),
  남은 Postgres는 다음 실행이 자기 데이터 폴더의 `pg_ctl`로 멈춘다.
- **관리자 설정 코드는 실행할 때 띄우지 않는다.** macOS는 네이티브 대화상자가 열려 있는 앱의 종료를 거부한다 —
  첫 실행이 끌 수 없는 실행이 된다. 관리자 없이도 대화·초안·개인 AI 키는 모두 된다. 코드는 메뉴
  `RowCat → 관리자 설정 코드…`에 있다.

## 꺼져 있는 것

메일, 푸시, 소셜 로그인, 관리형 생성 키, Redis(한 프로세스라 메모리 카운터가 정확하다), 백그라운드 작업.
운영 콘솔의 준비 상태 화면이 각각을 이름으로 짚는다. ⚠ 그 화면은 공개 배포를 전제로 판정하므로 이 앱에서는
「브라우저 오리진」 같은 항목이 경고로 보인다 — 이 앱에서는 정상이다.

## 명령

먼저 세 서버를 빌드한다.

```bash
pnpm turbo run build --filter=@rowcat/api --filter=web --filter=admin
```

```bash
pnpm --filter @rowcat/desktop stack     # Electron 없이 스택만 (데이터: apps/desktop/.desktop-data)
pnpm --filter @rowcat/desktop dev       # .stage/를 조립하고 Electron으로 연다 (데이터: 「RowCat Dev」)
pnpm --filter @rowcat/desktop package   # 이 OS용 설치 파일 → apps/desktop/out/
```

설치 파일은 **그 OS에서** 만든다 — 조립할 때 이 OS의 네이티브 바이너리(sharp, Postgres)만 들어간다.
`package` 뒤에 버전(`2026.10.31`)을 주면 설치 파일이 그 번호를 단다. 없으면 `package.json`의 자리표시자 `0.0.0`이다.

## 릴리스 — Windows 설치 파일 (`.github/workflows/desktop-release.yml`)

```bash
git tag desktop-2026-10-31 && git push origin desktop-2026-10-31
```

- **이름은 날짜다.** 태그가 `desktop-<날짜>`, 릴리스 제목이 그 날짜이고, 설치 파일의 버전은 같은 날짜를
  `YYYY.M.D`로 적은 것이다(Windows와 electron-builder는 `MAJOR.MINOR.PATCH`만 읽는다). 실재하지 않는 날짜의
  태그는 첫 단계에서 멈춘다.
- **CI가 통과한 커밋만 나간다**(`scripts/ci-passed.sh`). 그다음 Windows 러너가 세 앱을 빌드하고 `package`를
  돌려, 날짜로 이름 붙인 `.exe`와 SHA-256을 **프리릴리스**에 붙인다 — 서명되지 않았기 때문이다.
- **`workflow_dispatch`는 리허설이다.** 같은 관문과 빌드를 거치고 설치 파일을 실행 아티팩트로만 남긴다.
  릴리스를 만드는 길은 태그 푸시 하나다.
- 같은 날짜의 릴리스가 이미 있으면 멈춘다. 바꾸려면 그 릴리스를 지우고 태그를 옮긴다.

데이터와 로그는 운영체제의 앱 폴더에 있다(macOS: `~/Library/Application Support/RowCat/deployment`,
`~/Library/Logs/RowCat/rowcat.log`). 메뉴의 `데이터 폴더 열기`·`로그 폴더 열기`가 그곳을 연다.

## 조립 — 무엇이 들어가는가 (`scripts/build-app.ts`)

- API는 `pnpm deploy`(hoisted)로 운영 의존성을 받은 뒤 **`node_modules`·`package.json`·`dist`·`drizzle`만**
  옮긴다. `pnpm deploy`는 패키지 폴더를 디스크 그대로 복사해 gitignore된 파일까지 가져가고, 그 폴더에는
  개발자의 `apps/api/.env`가 있다 — 그렇게 만든 설치 파일 하나가 실제로 그 시크릿을 실었다. 지울 것을 나열하는
  방식은 다음 것을 놓친다.
- 세 서버는 `extraResources`가 아니라 `afterPack`에서 복사한다. electron-builder는 `filter`와 상관없이 extra
  resources에서 `node_modules`를 빼고, 의존성 없는 API는 첫 import에서 죽는데 설치 파일은 초록으로 빌드된다.
- Postgres 라이브러리의 심볼릭 링크를 되살린다(`native/pg-symlinks.json`). `pnpm deploy`가 링크를 파일로 복사해
  ICU 데이터 64MB가 세 번 들어갔다.
- asar는 끈다. Postgres 바이너리는 OS가 실제 경로에서 실행해야 하는 파일이다.

## 아직 안 된 것

- **서명.** 서명하지 않은 앱은 macOS에서 "확인되지 않은 개발자", Windows에서 SmartScreen 경고가 뜬다. 비전공자는
  거기서 멈춘다. 운영자 자신의 Apple Developer ID(공증 포함)와 Windows 코드 서명 인증서가 필요하다.
- **Windows 설치 파일은 CI 러너에서 만들 뿐, 실제 Windows PC에서 열어 본 기록이 아직 없다.** 첫 릴리스가 그
  확인이다. Linux(`AppImage`)는 설정만 있다.
- **크기.** macOS 설치 파일이 약 340MB다. 대부분 API 의존성인 `react-email`이 끌고 오는 `next`(약 290MB)다 —
  AGENTS.md가 적어 둔 대로 `@react-email/components`·`@react-email/render`로 바꾸면 컨테이너 이미지와 함께
  줄어든다.
- **자동 업데이트.** 새 버전은 설치 파일을 다시 받는다. 데이터 폴더는 그대로 남고, API가 부팅할 때 마이그레이션을
  적용한다.
- **같은 와이파이의 다른 기기, 모바일 앱.** 서버가 루프백에만 열린다.

## 포크

앱 id는 `APP_BUNDLE_ID` 뒤에 `.desktop`, 이름은 `APP_NAME`이다(`packages/domain/src/app.ts`). 따로 바꿀 자리는
없다. 설치 파일에는 PostgreSQL(PostgreSQL License)과 Electron·Chromium의 라이선스 파일이 함께 들어간다.
