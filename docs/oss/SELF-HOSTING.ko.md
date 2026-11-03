# RowCat 실행하고 직접 배포하기

[English](SELF-HOSTING.md) · [README로 돌아가기](../../README.ko.md)

최소 구성은 **Postgres와 시크릿 하나**예요. 나머지(메일, 푸시, 소셜 로그인, 본인인증, 관리형 생성 키,
Redis)는 모두 선택이고, 없어도 서버는 그대로 뜨고 해당 기능만 꺼져 있다고 알려 줘요.

## 로컬에서 실행하기

필요한 것: Node.js 22 이상(컨테이너 이미지는 Node 26을 써요), `package.json`의 `packageManager` 필드에
고정된 버전의 pnpm(`corepack enable`을 하면 그 버전을 잡아 줘요 — npm이나 yarn으로 설치하지 마세요),
그리고 Compose가 포함된 Docker.

```bash
pnpm install
pnpm dev:setup   # env 파일, 시크릿, Docker Postgres, 스키마, 개발 계정까지 한 번에
pnpm dev:all     # 웹, API, 운영 콘솔을 함께 띄워요
```

`pnpm dev:setup`은 몇 번을 다시 돌려도 괜찮아요. 이미 있는 파일이나 시크릿은 덮어쓰지 않거든요. 하는 일은
이래요.

- 예시 파일로 `.env`(docker compose가 읽어요)와 `apps/api/.env`(호스트에서 도는 API가 읽어요)를 만들어요.
- `BETTER_AUTH_SECRET` 하나를 생성해 두 파일에 넣고, `.env`에는 `POSTGRES_PASSWORD`도 생성해 넣어요.
  `apps/api/.env`의 `DATABASE_URL`은 그 비밀번호를 따라가요.
- Postgres를 루프백에만 여는 `docker-compose.override.yml`(gitignore 대상)을 써요. 포트는 5432인데, 이미
  이 컴퓨터에서 Postgres가 돌고 있으면 다음 빈 포트를 쓰고 `DATABASE_URL`도 그 포트로 맞춰요.

`--no-docker`를 주면 이미 쓰고 있는 Postgres(`apps/api/.env`의 `DATABASE_URL`이 가리키는 곳)를 쓰고,
`--no-seed`를 주면 개발 계정을 만들지 않아요. 지금 구성으로 무엇이 켜지는지는
`pnpm env:doctor --file apps/api/.env`로 확인할 수 있어요(`--mode production`을 붙이면 릴리스를 막는 항목도
보여 줘요).

**Dev Container로 열어도 돼요**(`.devcontainer/`). 컨테이너가 만들어질 때 같은 `pnpm dev:setup`이 돌고,
Postgres는 컨테이너 안의 Docker에서 떠요. 새로 클론한 저장소에서 써 주세요("Clone Repository in Container
Volume", 또는 데스크톱 편집기에서 연 Codespace).

| 포트 | 서비스 |
| --- | --- |
| 3000 | 웹 앱 |
| 3001 | API (`/v2`) |
| 3002 | 운영 콘솔 |

`db:seed:dev-user`는 비밀번호가 `rowcat-dev`인 `dev@rowcat.test` 계정을 만들어요(다른 값을 쓰고 싶으면
이메일과 비밀번호를 인자로 넘기면 돼요). 이메일은 인증된 상태로, 본인인증·성인 관문은 열린 상태로 만들고,
관리형 생성 허용 목록에도 올려 줘요. `NODE_ENV=production`에서는 실행되지 않아요.

override 없이 셸에서 Postgres에 접속하고 싶다면: `docker compose exec db psql -U rowcat rowcat`.

## 첫 관리자 정하기

배포에 관리자가 아직 없으면, API가 뜰 때마다 일회용 설정 코드를 출력해요
(`docker compose logs api | grep "\[setup\]"`, 또는 `pnpm dev:api`를 돌리는 터미널에서 볼 수 있어요).

1. 콘솔의 `/setup`을 열어요(로컬에서는 `http://localhost:3002/setup`).
2. 이 배포를 운영할 계정을 만들거나 그 계정으로 로그인해요.
3. 코드를 입력해요.

그 계정이 `admin`이 되고, 설정 화면은 다시 열리지 않아요. 페이지 끝에는 지금 무엇이 켜져 있고 나머지는
어떤 변수로 켜는지가 정리돼 나와요. 처음 뜰 때부터 관리자가 있는 배포라면 설정 화면은 아예 열리지 않아요.

## AI 생성

AI 답변을 받으려면 어딘가의 키가 필요해요. 관리형 생성은 `apps/api/.env`의 `OPENROUTER_API_KEY`를 써요.
이 값이 없으면 관리형 요청만 503으로 응답하고 나머지는 그대로 동작해요. 대신 회원 누구나 AI 설정에서 자기
Anthropic이나 Gemini 키를 연결할 수 있고, 그 경로는 이 서버를 거치지 않아요. 운영자의 키를 누가 쓸 수
있는지는 `MANAGED_GENERATION_ACCESS`로 정해요(기본값은 `allowlist`, 모두에게 열려면 `everyone`).

## 배포하기

**운영 배포에는 값이 둘이 아니라 넷 필요해요.** 로컬에서는 오리진이 localhost로 잡히지만, 운영 배포에서는
`WEB_ORIGIN`과 `API_ORIGIN`도 설정해야 해요(웹과 API가 서로 다른 호스트에 있으면 `AUTH_COOKIE_DOMAIN`까지).
이 넷을 채우고 `pnpm env:doctor --mode production --file <env 파일>`을 돌리면 릴리스를 막는 항목이 없다고
알려 주고, 꺼진 채 남는 기능도 하나씩 짚어 줘요. 자세한 건 `docs/ops/CONFIGURATION.md`(최소 구성)를 봐
주세요.

### 체크아웃 없이: `scripts/install.sh`

Docker만 있는 서버라면 릴리스의 설치 스크립트를 내려받아, 실행하기 전에 한 번 읽어 보세요.

```bash
curl -fsSLO https://raw.githubusercontent.com/Project-RowCat/RowCat/<릴리스>/scripts/install.sh
bash install.sh --ref <릴리스> --domain rowcat.example.com   # 지금 앞에 있는 컴퓨터라면 --local
```

그 커밋의 컴포즈 파일과 백업 스크립트를 받고, 두 시크릿을 생성해 소유자만 읽는 `.env`에 쓰고, 세 이미지를
다이제스트로 고정해요(빌드도 `latest`도 없어요). 그다음 Caddy의 HTTPS 뒤에 스택을 띄우고 첫 실행 설정 코드를
보여 줘요. 같은 디렉터리에서 더 새 `--ref`로 다시 실행하면 업그레이드예요. 먼저 데이터베이스를 백업하고
`.env`는 그대로 둬요. 안내는 `docs/ops/INSTALL.md`, 검증은 `pnpm test:install`이에요.

### 공개된 이미지

`main`에 푸시할 때마다 세 앱 이미지가 GHCR에 올라가요(`.github/workflows/images.yml`). 이미지에는 배포별
값이 하나도 들어 있지 않고, 웹과 운영 콘솔은 시작할 때 환경 변수에서 API 오리진을 받아요. 그래서 따로 빌드할
필요가 없어요.

```bash
cp .env.example .env   # BETTER_AUTH_SECRET과 POSTGRES_PASSWORD를 채우고, 실제 도메인이면 WEB_ORIGIN, API_ORIGIN, VITE_API_ORIGIN도
docker compose up -d   # api, web, admin을 받아 오고 Postgres와 Redis도 함께 떠요
```

이미지를 받으려면 GHCR 패키지가 공개돼 있어야 해요(저장소 소유자가 한 번만 바꾸면 되는 설정이에요). 공개
전에는 받기가 거절되고, 컴포즈가 대신 이 체크아웃을 빌드해요. 느릴 뿐 결과는 같지만, 빌드가 시작되는 것
말고는 따로 알려 주지 않아요. 실제로 어느 쪽으로 떴는지는 `docs/ops/CLEAN-INSTALL.md`에서 확인할 수 있어요.

두 시크릿은 복사하지 말고 새로 생성해 주세요. `BETTER_AUTH_SECRET`은 `openssl rand -base64 32`,
`POSTGRES_PASSWORD`는 `openssl rand -hex 24`로 만들면 돼요(16진수라 데이터베이스 URL에 그대로 넣을 수
있어요). 둘 중 하나라도 없으면 컴포즈가 시작하지 않고, API는 production에서 너무 짧은 세션 키나 예전 예시
비밀번호 `rowcat`으로는 뜨지 않아요. 그 비밀번호로 처음 만든 데이터베이스라면 업그레이드 전에
`ALTER ROLE`이 필요해요(`docs/ops/CONFIGURATION.md`의 "개발 기본값은 운영 시크릿이 아니다").

공개된 이미지 대신 이 체크아웃을 빌드해서 돌리려면 `docker compose up --build`를 쓰면 돼요. 한 빌드에
고정하고 싶으면 `ROWCAT_IMAGE_TAG=sha-<commit>`을, 자체 이미지를 발행하는 포크라면 `ROWCAT_IMAGE_REGISTRY`를
그쪽으로 지정해 주세요(`docs/oss/FORKING.md` §15).

### HTTPS

공개 도메인에 올릴 때는 `deploy/caddy/`가 스택을 HTTPS 뒤에 세워 줘요. `.env`에 `ROWCAT_DOMAIN`(과
`COMPOSE_FILE=docker-compose.yml:deploy/caddy/compose.yml`)만 넣으면, Caddy가 웹·API·콘솔을 세 호스트 이름으로
서빙하고 인증서도 알아서 갱신해요. 그 값 하나로 모든 오리진과 쿠키 도메인을 정하고, 앱의 평문 HTTP 포트는
닫아요(`docs/ops/HTTPS.md`).

### 백업과 업그레이드

`scripts/backup.sh`는 데이터베이스를 덤프해요. 미디어 파일까지 모든 데이터가 데이터베이스에 있어요.
`scripts/restore.sh`는 덤프를 빈 데이터베이스에 복원해요. `BETTER_AUTH_SECRET`이 2단계 인증 시크릿도
암호화하니까 `.env`는 꼭 덤프와 함께 보관해 주세요. 업그레이드 방법, 어디까지 되돌릴 수 있는지, 어떤 백업으로도
되살릴 수 없는 것(잃어버린 종단간 암호화 키)은 `docs/ops/BACKUP.md`에 정리돼 있어요.

## Docker 없이 컴퓨터 한 대에서

`apps/desktop`은 배포 전체를 데스크톱 앱 하나로 묶어요. 내장 Postgres와 같은 세 빌드를 `localhost`에 띄우고
자기 창에서 열어요. 세 앱을 빌드한 다음 `pnpm --filter @rowcat/desktop package`를 실행하면, 명령을 돌린 OS용
설치 파일이 `apps/desktop/out/`에 생겨요. 배포하는 쪽이 자기 인증서로 서명하기 전까지는 서명되지 않은 설치
파일이에요(`apps/desktop/README.md`). `desktop-<날짜>` 태그를 푸시하면 Windows 설치 파일이 GitHub 릴리스로
올라가고(`.github/workflows/desktop-release.yml`), 이미 설치된 Windows 앱은 그 릴리스로 알아서 업데이트돼요.

## 변경 검증하기

```bash
pnpm check && pnpm typecheck && pnpm test
```

`pnpm check`는 Biome과 함께 설정·생성물이 어긋나지 않았는지도 검사해요. API 테스트는 실제 Postgres를 쓰고
(테스트 워커마다 자기 데이터베이스를 만들어요), 연결할 Postgres가 없으면 건너뛰어요. `pnpm test:e2e`는
Playwright 브라우저 여정을 돌리고 필요한 스택은 알아서 띄워요. `pnpm test:compose`는 운영용 컴포즈 스택을
띄워 첫 실행 설정까지 마친 뒤 내려요(`--build`를 주면 이 체크아웃을 먼저 빌드해요). CI는 이 셋을 모두
돌리고, 이미지와 npm 릴리스는 CI를 통과한 커밋에서만 발행돼요.
