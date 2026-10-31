# RowCat

[English](README.md)

RowCat은 이용자가 만든 이야기를 다루는 UGC 플랫폼이었다. 사람들은 인터랙티브 이야기를 공유 갤러리에
발행했고, 그 이야기를 AI 대화로, 또는 샌드박스 안의 크리에이터 런타임으로 작성된 작은 프로그램으로
즐겼다. 호스팅 서비스는 종료되었다. **이 저장소는 그 코드**이며, 누구나 읽고 배우거나 다른 이름으로 직접
배포할 수 있도록 공개한 것이다. 뒤에서 돌고 있는 호스팅 인스턴스는 없다.

## 들어 있는 것

- **이야기 갤러리** — 발행, 탐색(검색·태그·관련 작품·인기순), 즐겨찾기, 한 단계 답글이 달리는 댓글,
  크리에이터 팔로우와 차단, 공개 크리에이터 프로필.
- **로컬 우선 대화와 초안** — 대화와 이야기 초안은 기기 자신의 데이터베이스(웹은 IndexedDB, 모바일은
  SQLite)에 살고, 한 회원의 기기들 사이에서 종단간 암호화로 동기화된다. 서버는 자신이 열 수 없는
  암호문만 저장하며, 새 기기는 짧은 코드로 페어링한다.
- **두 갈래의 AI 생성** — 운영자의 공급자 키(OpenRouter)를 쓰는 서버 측 「관리형」 경로는 허용 목록과
  요청 한도로 막혀 있고, BYO(bring-your-own-key) 경로에서는 브라우저나 앱이 회원 자신의 키로 Anthropic
  또는 Gemini를 직접 호출한다. 대화방별 메모리, 페르소나, 등장인물, 누적 요약은 기기에서 조립된다.
- **크리에이터 런타임** — 크리에이터는 `@rowcat/runtime`에 맞춰 TSX를 쓴다. 서버가 발행 시점에
  컴파일하고, 플레이어는 격리된 QuickJS/WASM 가상 머신 안에서 실행한다. 같은 패치 번들이 웹에서는 shadow
  DOM으로, 모바일에서는 React Native 뷰로 그려진다. 작성 중에는 Monaco 기반 스튜디오가 미리 보여 준다.
- **클라이언트** — 웹 앱(TanStack Start, SSR), 직접 호스팅하는 서명된 OTA 업데이트 서버를 갖춘 Expo 모바일
  앱, 모더레이션과 배포 설정을 위한 운영 콘솔, 그리고 코딩 에이전트가 회원의 기기 중 하나로서 런타임
  프로젝트를 작성할 수 있게 하는 MCP 서버(`apps/mcp`).
- **실제 제품이 갖춰야 할 나머지** — 패스키, 2단계 인증, Google·Apple·카카오 로그인, 이의 제기가 있는
  모더레이션, 인앱·네이티브 푸시 알림, 법정대리인 동의와 연령 확인. 이용약관이나 개인정보 처리방침은
  들어 있지 않다 — 배포하는 쪽이 직접 작성한다(`docs/oss/FORKING.md`).

설계 근거는 대부분 글로 남아 있다. `AGENTS.md`가 색인이고, `docs/`에 결정 기록이 있으며, 각 파일의 머리
주석이 그 파일이 지키는 경계를 설명한다. `AGENTS.md`와 코드 주석은 영어, `docs/`의 결정 기록은
한국어다.

## 빠른 시작

최소 구성은 **Postgres와 시크릿 하나**다. 나머지(메일, 푸시, 소셜 로그인, 본인인증, 관리형 생성 키,
Redis)는 모두 선택이며, 없으면 기동을 막지 않고 꺼져 있다고 보고된다.

준비물: Node.js 22 이상(컨테이너 이미지는 Node 26을 쓴다), `package.json`의 `packageManager` 필드에 고정된
버전의 pnpm(`corepack enable`이 그 버전을 잡는다 — npm이나 yarn으로 설치하지 않는다), 그리고 Compose가
포함된 Docker.

```bash
pnpm install
pnpm dev:setup   # env 파일, 공유 시크릿 하나, Docker의 Postgres, 스키마, 개발 계정
pnpm dev:all     # 웹, API, 운영 콘솔을 함께 띄운다
```

`pnpm dev:setup`은 다시 실행해도 안전하다 — 이미 있는 파일이나 시크릿은 덮어쓰지 않는다. 예시 파일로부터
`.env`(docker compose가 읽는다)와 `apps/api/.env`(호스트에서 도는 API가 읽는다)를 만들고, `BETTER_AUTH_SECRET`
하나를 생성해 양쪽에 넣으며, Postgres를 루프백에만 여는 `docker-compose.override.yml`(gitignore 대상)을
쓴다. 포트는 5432이고, 이 기기에서 이미 Postgres가 돌고 있으면 다음 빈 포트를 쓴다(그때는 `DATABASE_URL`도
그 포트를 따라간다). `--no-docker`를 주면 직접 운영하는 Postgres(`apps/api/.env`의 `DATABASE_URL`이
가리키는 곳)를 쓰고, `--no-seed`는 개발 계정 생성을 건너뛴다. 이 구성으로 무엇이 켜지는지는
`pnpm env:doctor --file apps/api/.env`로 확인한다(`--mode production`을 더하면 릴리스를 막는 항목이 보인다).

**Dev Container로 열어도 된다**(`.devcontainer/`). 컨테이너가 만들어질 때 같은 `pnpm dev:setup`이 돌고,
Postgres는 컨테이너 안의 Docker에서 뜬다. 새로 클론한 저장소에서 쓴다("Clone Repository in Container
Volume", 또는 데스크톱 편집기에서 연 Codespace).

| 포트 | 서비스 |
| --- | --- |
| 3000 | 웹 앱 |
| 3001 | API (`/v2`) |
| 3002 | 운영 콘솔 |

**첫 관리자는 운영 콘솔에서 정한다.** 배포에 관리자가 없는 동안 API는 기동할 때마다 일회용 설정 코드를
출력한다(`docker compose logs api | grep "\[setup\]"`, 또는 `pnpm dev:api`를 돌리는 터미널). 콘솔의
`/setup`(로컬에서는 `http://localhost:3002/setup`)을 열고, 이 배포를 운영할 계정을 만들거나 그 계정으로
로그인한 뒤 코드를 입력한다. 그 계정이 `admin`이 되고, 설정은 영구히 닫히며, 페이지 끝에 이 배포에서 무엇이
켜져 있고 나머지는 어떤 변수로 켜는지가 나온다. 기동 시점에 이미 관리자가 있는 배포는 설정을 아예 열지
않는다.

`db:seed:dev-user`는 비밀번호가 `rowcat-dev`인 `dev@rowcat.test` 계정을 만든다(다른 값을 쓰려면 이메일과
비밀번호를 인자로 넘긴다). 이메일을 인증된 것으로 표시하고, 본인인증·성인 관문을 열고, 관리형 생성 허용
목록에 올린다. `NODE_ENV=production`에서는 실행을 거부한다.

**AI 생성에는 어딘가의 키가 필요하다.** 관리형 생성은 `apps/api/.env`의 `OPENROUTER_API_KEY`를 쓴다. 이
값이 없으면 관리형 요청은 503으로 응답하고 나머지는 그대로 동작한다. 대신 어느 회원이든 AI 설정에서 자신의
Anthropic 또는 Gemini 키를 연결할 수 있다 — 그 경로는 이 서버를 거치지 않는다. 운영자의 키를 누가 쓸 수
있는지는 `MANAGED_GENERATION_ACCESS`가 정한다(기본값 `allowlist`, 또는 `everyone`).

**배포에는 값이 둘이 아니라 넷 필요하다.** 로컬에서는 오리진이 localhost로 접히지만, 운영 배포는
`WEB_ORIGIN`과 `API_ORIGIN`도 설정한다(웹과 API가 다른 호스트에 있으면 `AUTH_COOKIE_DOMAIN`까지). 이 넷을
채우면 `pnpm env:doctor --mode production --file <env 파일>`이 릴리스를 막는 항목 없음을 보고하고, 꺼진 채로
남는 기능을 하나하나 짚어 준다 — `docs/ops/CONFIGURATION.md`(최소 구성) 참고.

override 없이 셸에서 Postgres에 접속하려면: `docker compose exec db psql -U rowcat rowcat`.

### 공개된 이미지로 실행하기

`main`에 푸시할 때마다 세 앱 이미지가 GHCR에 올라가고(`.github/workflows/images.yml`), 이미지에는 배포별
값이 하나도 들어 있지 않다 — 웹과 운영 콘솔은 시작할 때 환경에서 API 오리진을 받는다. 그래서 배포에 빌드가
필요 없다.

```bash
cp .env.example .env   # BETTER_AUTH_SECRET을 채우고, 실제 도메인이면 WEB_ORIGIN, API_ORIGIN, VITE_API_ORIGIN도
docker compose up -d   # api, web, admin을 받아 오고 Postgres와 Redis도 함께 뜬다
```

`docker compose up --build`는 공개된 이미지 대신 이 체크아웃을 빌드해 실행한다. 한 빌드에 고정하려면
`ROWCAT_IMAGE_TAG=sha-<commit>`을 쓰고, 자체 이미지를 발행하는 포크는 `ROWCAT_IMAGE_REGISTRY`를 그쪽으로
가리킨다(`docs/oss/FORKING.md` §15).

### Docker 없이 컴퓨터 한 대에서

`apps/desktop`은 배포 전체를 데스크톱 앱 하나로 묶는다 — 내장 Postgres와 같은 세 빌드를 `localhost`에 띄우고
자기 창에서 연다. 세 앱을 빌드한 뒤 `pnpm --filter @rowcat/desktop package`를 실행하면, 그 명령을 돌린 OS용
설치 파일이 `apps/desktop/out/`에 생긴다. 배포하는 쪽이 자기 인증서로 서명하기 전까지는 서명되지 않은
설치 파일이다(`apps/desktop/README.md`). `desktop-<날짜>` 태그를 푸시하면 Windows 설치 파일이 GitHub 릴리스로
나가고(`.github/workflows/desktop-release.yml`), 설치된 Windows 앱은 그 릴리스로 스스로 업데이트한다.

## 저장소 지도

pnpm 워크스페이스(`apps/*`, `packages/*`), TypeScript strict, Biome, 작업 순서는 Turborepo.

| 경로 | 내용 |
| --- | --- |
| `apps/api` | Hono + Better Auth + Drizzle(Postgres). 유일한 공개 API `/v2` |
| `apps/web` | TanStack Start(SSR) + React 19 + TanStack Router/Query + Tailwind 4 |
| `apps/admin` | 운영 콘솔(Vite SPA, SSR 없음) |
| `apps/mobile` | Expo 네이티브 클라이언트 — SQLite, SecureStore, 직접 호스팅하는 OTA |
| `apps/mcp` | `@rowcat/mcp`, stdio MCP 서버(`rowcat-mcp`) |
| `apps/desktop` | 컴퓨터 한 대용 설치 파일(Electron): 내장 Postgres + 세 빌드 |
| `packages/contracts` · `domain` · `sdk` · `query` | 와이어 형태(zod) · 제품 모델 · API 클라이언트 · TanStack Query 정책 |
| `packages/chat` · `authoring` · `markdown` | 대화, 이야기 초안, 메시지 본문의 순수 규칙 |
| `packages/sync` | 동기화 프로토콜: 봉투 암호화, 키링, HLC, 엔진 |
| `packages/runtime` · `runtime-compiler` · `runtime-host` | 크리에이터 언어 계약 · 소스 → 아티팩트(실행하지 않음) · QuickJS/WASM 호스트 |
| `packages/runtime-renderer-web` · `runtime-renderer-native` · `runtime-persistence` | 패치 번들 → DOM / React Native · 플레이어 저장 |
| `packages/runtime-ai-docs` · `runtime-mcp` | AI가 읽는 런타임 문서 코퍼스 · MCP 도구 계층 |
| `packages/design` · `ui-web` · `ui-native` | 디자인 토큰 · 공용 웹 컴포넌트 · 공용 네이티브 컴포넌트 |
| `docs/` | 결정 기록(한국어). `docs/public/runtime`은 크리에이터가 읽는 런타임 문서 |

계층 규칙 — 어느 패키지가 어느 패키지를 가져올 수 있는지 — 은 `AGENTS.md`의 표("Layer rules")이고, 각
패키지의 `src/index.ts` 머리 주석이 같은 내용을 다시 적는다.

## 변경 검증

```bash
pnpm check && pnpm typecheck && pnpm test
```

`pnpm check`는 Biome과 함께 설정·생성물의 어긋남 검사를 돌린다. API 테스트는 실제 Postgres를 쓰며(테스트
워커마다 자기 데이터베이스를 만든다), 닿을 수 있는 Postgres가 없으면 건너뛴다. `pnpm test:e2e`는 Playwright
브라우저 여정을 돌리고, 필요한 스택은 스스로 띄운다.

## 라이선스

저장소는 **GNU Affero General Public License v3.0 only**(`AGPL-3.0-only`)로 배포된다. `LICENSE` 참고.

재사용 가능한 구성 요소인 여덟 패키지는 대신 **Apache License 2.0**이며, 각자 `LICENSE` 파일을 가진다:
`packages/runtime`, `runtime-compiler`, `runtime-host`, `runtime-renderer-web`, `runtime-renderer-native`,
`runtime-persistence`, `runtime-ai-docs`, `contracts`. 함께 들어 있는 서드파티 자산과 그 라이선스는
`NOTICE`에 있다.

## 상표

코드는 라이선스에 따라 자유롭게 쓸 수 있지만, 이름은 그렇지 않다. "RowCat"이라는 이름은 이 프로젝트에
남는다. 포크를 배포한다면 다른 이름과 정체성으로 내놓는다 — 이름, 앱 정체성, 운영자별 설정이 들어 있는
자리는 `docs/oss/FORKING.md`가 모두 나열한다.

## 기여와 보안

- [CONTRIBUTING.md](CONTRIBUTING.md) — 변경을 제안하는 방법(DCO 서명 필요)
- [SECURITY.md](SECURITY.md) — 취약점은 공개 이슈가 아니라 비공개로 제보한다
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [docs/oss/FORKING.md](docs/oss/FORKING.md) — 직접 배포하기
