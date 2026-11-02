# RowCat 실행과 직접 배포

[English](SELF-HOSTING.md) · [README로 돌아가기](../../README.ko.md)

최소 구성은 **Postgres와 시크릿 하나**다. 나머지(메일, 푸시, 소셜 로그인, 본인인증, 관리형 생성 키,
Redis)는 모두 선택이며, 없으면 기동을 막지 않고 꺼져 있다고 보고된다.

## 로컬에서 실행하기

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
하나를 생성해 양쪽에 넣고, `.env`에 `POSTGRES_PASSWORD`를 생성해 넣으며(`apps/api/.env`의 `DATABASE_URL`이
그 값을 따라간다), Postgres를 루프백에만 여는 `docker-compose.override.yml`(gitignore 대상)을 쓴다. 포트는
5432이고, 이 기기에서 이미 Postgres가 돌고 있으면 다음 빈 포트를 쓴다(그때는 `DATABASE_URL`도 그 포트를
따라간다). `--no-docker`를 주면 직접 운영하는 Postgres(`apps/api/.env`의 `DATABASE_URL`이 가리키는 곳)를
쓰고, `--no-seed`는 개발 계정 생성을 건너뛴다. 이 구성으로 무엇이 켜지는지는
`pnpm env:doctor --file apps/api/.env`로 확인한다(`--mode production`을 더하면 릴리스를 막는 항목이 보인다).

**Dev Container로 열어도 된다**(`.devcontainer/`). 컨테이너가 만들어질 때 같은 `pnpm dev:setup`이 돌고,
Postgres는 컨테이너 안의 Docker에서 뜬다. 새로 클론한 저장소에서 쓴다("Clone Repository in Container
Volume", 또는 데스크톱 편집기에서 연 Codespace).

| 포트 | 서비스 |
| --- | --- |
| 3000 | 웹 앱 |
| 3001 | API (`/v2`) |
| 3002 | 운영 콘솔 |

`db:seed:dev-user`는 비밀번호가 `rowcat-dev`인 `dev@rowcat.test` 계정을 만든다(다른 값을 쓰려면 이메일과
비밀번호를 인자로 넘긴다). 이메일을 인증된 것으로 표시하고, 본인인증·성인 관문을 열고, 관리형 생성 허용
목록에 올린다. `NODE_ENV=production`에서는 실행을 거부한다.

override 없이 셸에서 Postgres에 접속하려면: `docker compose exec db psql -U rowcat rowcat`.

## 첫 관리자

배포에 관리자가 없는 동안 API는 기동할 때마다 일회용 설정 코드를 출력한다
(`docker compose logs api | grep "\[setup\]"`, 또는 `pnpm dev:api`를 돌리는 터미널). 콘솔의
`/setup`(로컬에서는 `http://localhost:3002/setup`)을 열고, 이 배포를 운영할 계정을 만들거나 그 계정으로
로그인한 뒤 코드를 입력한다. 그 계정이 `admin`이 되고, 설정은 영구히 닫히며, 페이지 끝에 이 배포에서 무엇이
켜져 있고 나머지는 어떤 변수로 켜는지가 나온다. 기동 시점에 이미 관리자가 있는 배포는 설정을 아예 열지
않는다.

## AI 생성

생성에는 어딘가의 키가 필요하다. 관리형 생성은 `apps/api/.env`의 `OPENROUTER_API_KEY`를 쓴다. 이 값이
없으면 관리형 요청은 503으로 응답하고 나머지는 그대로 동작한다. 대신 어느 회원이든 AI 설정에서 자신의
Anthropic 또는 Gemini 키를 연결할 수 있다 — 그 경로는 이 서버를 거치지 않는다. 운영자의 키를 누가 쓸 수
있는지는 `MANAGED_GENERATION_ACCESS`가 정한다(기본값 `allowlist`, 또는 `everyone`).

## 배포하기

**배포에는 값이 둘이 아니라 넷 필요하다.** 로컬에서는 오리진이 localhost로 접히지만, 운영 배포는
`WEB_ORIGIN`과 `API_ORIGIN`도 설정한다(웹과 API가 다른 호스트에 있으면 `AUTH_COOKIE_DOMAIN`까지). 이 넷을
채우면 `pnpm env:doctor --mode production --file <env 파일>`이 릴리스를 막는 항목 없음을 보고하고, 꺼진 채로
남는 기능을 하나하나 짚어 준다 — `docs/ops/CONFIGURATION.md`(최소 구성) 참고.

### 공개된 이미지

`main`에 푸시할 때마다 세 앱 이미지가 GHCR에 올라가고(`.github/workflows/images.yml`), 이미지에는 배포별
값이 하나도 들어 있지 않다 — 웹과 운영 콘솔은 시작할 때 환경에서 API 오리진을 받는다. 그래서 배포에 빌드가
필요 없다.

```bash
cp .env.example .env   # BETTER_AUTH_SECRET과 POSTGRES_PASSWORD를 채우고, 실제 도메인이면 WEB_ORIGIN, API_ORIGIN, VITE_API_ORIGIN도
docker compose up -d   # api, web, admin을 받아 오고 Postgres와 Redis도 함께 뜬다
```

받아 오려면 GHCR 패키지가 공개돼 있어야 한다(저장소 소유자가 한 번 바꾸는 설정). 공개 전에는 당기기가
거절되고 컴포즈가 대신 이 체크아웃을 빌드한다 — 느릴 뿐 결과는 같고, 빌드가 시작되는 것 말고는 알려 주지
않는다. 실제로 어느 쪽이 돌았는지는 `docs/ops/CLEAN-INSTALL.md`가 확인한다.

두 시크릿은 복사하지 않고 생성한다: `BETTER_AUTH_SECRET`은 `openssl rand -base64 32`, `POSTGRES_PASSWORD`는
`openssl rand -hex 24`(16진수라 데이터베이스 URL에 그대로 들어간다). 둘이 없으면 컴포즈가 시작하지 않고, API는
production에서 짧은 세션 키나 예전 예시 비밀번호 `rowcat`으로는 뜨지 않는다 — 그 비밀번호로 처음 만든
데이터베이스는 업그레이드 전에 `ALTER ROLE`이 필요하다(`docs/ops/CONFIGURATION.md`, 개발 기본값은 운영
시크릿이 아니다).

`docker compose up --build`는 공개된 이미지 대신 이 체크아웃을 빌드해 실행한다. 한 빌드에 고정하려면
`ROWCAT_IMAGE_TAG=sha-<commit>`을 쓰고, 자체 이미지를 발행하는 포크는 `ROWCAT_IMAGE_REGISTRY`를 그쪽으로
가리킨다(`docs/oss/FORKING.md` §15).

### HTTPS

공개 도메인에서는 `deploy/caddy/`가 스택을 HTTPS 뒤에 둔다. `.env`에 `ROWCAT_DOMAIN`(과
`COMPOSE_FILE=docker-compose.yml:deploy/caddy/compose.yml`)을 넣으면, Caddy가 웹·API·콘솔을 세 호스트 이름으로
서빙하고 인증서를 스스로 갱신하며, 그 값 하나에서 모든 오리진과 쿠키 도메인을 끌어내고 앱의 평문 HTTP 포트를
닫는다(`docs/ops/HTTPS.md`).

### 백업과 업그레이드

`scripts/backup.sh`는 데이터베이스를 덤프하고 — 미디어 바이트까지 모든 것이 거기 있다 — `scripts/restore.sh`는
덤프를 빈 데이터베이스에 넣는다. `BETTER_AUTH_SECRET`이 2단계 인증 시크릿도 암호화하므로 `.env`를 덤프와 함께
보관한다. 업그레이드, 되돌릴 수 있는 경계, 어떤 백업으로도 되살릴 수 없는 것(잃어버린 종단간 키)은
`docs/ops/BACKUP.md`에 있다.

## Docker 없이 컴퓨터 한 대에서

`apps/desktop`은 배포 전체를 데스크톱 앱 하나로 묶는다 — 내장 Postgres와 같은 세 빌드를 `localhost`에 띄우고
자기 창에서 연다. 세 앱을 빌드한 뒤 `pnpm --filter @rowcat/desktop package`를 실행하면, 그 명령을 돌린 OS용
설치 파일이 `apps/desktop/out/`에 생긴다. 배포하는 쪽이 자기 인증서로 서명하기 전까지는 서명되지 않은
설치 파일이다(`apps/desktop/README.md`). `desktop-<날짜>` 태그를 푸시하면 Windows 설치 파일이 GitHub 릴리스로
나가고(`.github/workflows/desktop-release.yml`), 설치된 Windows 앱은 그 릴리스로 스스로 업데이트한다.

## 변경 검증

```bash
pnpm check && pnpm typecheck && pnpm test
```

`pnpm check`는 Biome과 함께 설정·생성물의 어긋남 검사를 돌린다. API 테스트는 실제 Postgres를 쓰며(테스트
워커마다 자기 데이터베이스를 만든다), 닿을 수 있는 Postgres가 없으면 건너뛴다. `pnpm test:e2e`는 Playwright
브라우저 여정을 돌리고 필요한 스택은 스스로 띄운다. `pnpm test:compose`는 운영용 컴포즈 스택을 띄워 첫 실행
설정까지 마친 뒤 내린다(`--build`를 주면 이 체크아웃을 먼저 빌드한다). CI는 이 셋을 모두 돌리며, 이미지와
npm 릴리스는 CI를 통과한 커밋에서만 발행된다.
