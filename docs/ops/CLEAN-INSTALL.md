# 클린룸 설치 검증

**처음 보는 사람이 README대로 운영 스택을 띄우고 첫 관리자를 세울 수 있는가**를 실제로 돌려 보는 절차다.
단위 테스트는 각 조각(설정 해석, 설정 코드, 권한)을 값으로 고정하지만, 조각 사이 — 이미지에 무엇이 실리는가,
화면이 시키는 명령이 그 이미지에서 실제로 도는가 — 는 이렇게만 드러난다. 2026-10-30 첫 실행에서 찾은 결함이
그 종류였다: 설정 완료 화면은 `db:seed:moderator`를 시켰는데 배포 이미지에는 그 스크립트가 없었다.

이 문서는 **운영 설치**만 다룬다. 개발 환경은 `pnpm dev:setup`(README)이고, 그 스크립트가 만드는 `.env`,
override, 개발 계정은 여기서 하나도 쓰지 않는다.

릴리스 전에 한 번, 그리고 `docker-compose.yml`·Dockerfile·`tsdown.config.ts`·첫 실행 설정을 바꾼 뒤에 돌린다.
아래 확인 목록의 대부분은 `scripts/compose-smoke.sh`(`pnpm test:compose`)가 자동으로 하고 CI의 `compose` 잡이 매
커밋 돌린다 — 이미지는 그 잡이 통과한 커밋만 게시된다. **스크립트가 대신하지 못하는 것은 브라우저로 콘솔
`/setup`을 거치는 것**(아래 「손으로 볼 것」)이라, 릴리스 전 한 번은 손으로 본다.

## 격리

개발 체크아웃(`.env`, override, 로컬 Postgres)을 건드리지 않는다. 커밋된 것만 담긴 새 클론과 별도 컴포즈
프로젝트 이름을 쓴다. 3000–3002가 비어 있어야 한다(컴포즈는 포트를 고정한다).

```bash
git clone <저장소> rowcat-cleanroom && cd rowcat-cleanroom
export COMPOSE_PROJECT_NAME=rowcat-cleanroom
cp .env.example .env
# BETTER_AUTH_SECRET=$(openssl rand -base64 32), POSTGRES_PASSWORD=$(openssl rand -hex 24) 를 채운다
docker compose up -d --wait
```

GHCR 이미지를 익명으로 당길 수 없으면(패키지가 비공개이면 `unauthorized`) 컴포즈는 아무 말 없이 이 클론에서
빌드한다 — `up` 출력에 `Pulling` 다음 빌드 단계가 이어지면 그쪽이다. 그것도 검증이지만, **게시된 이미지를
검증한 것은 아니다.** 결과에 어느 쪽이었는지 적는다. 익명으로 당겨지는지는 빈 도커 설정으로 확인한다:

```bash
anon="$(mktemp -d)" && echo '{}' > "$anon/config.json"
DOCKER_CONFIG="$anon" docker manifest inspect ghcr.io/project-rowcat/rowcat/api:latest
rm -rf "$anon"
```

## 스크립트가 확인하는 것

`pnpm test:compose`(CI는 `--build`). 자기 프로젝트 이름과 생성한 시크릿을 쓰고, 끝나면 `down -v`로 지운다.
실행 전에 없던 api·web·admin 이미지 태그도 지운다 — `--build` 없이 돌려도 당기기가 거절되면 컴포즈가 같은
이름으로 빌드하기 때문이다. 실패할 때만 API 로그를 보여 주며 그때도 설정 코드는 가린다.

```text
표면      API health · 웹 · 콘솔 /setup · 웹이 런타임 API 오리진을 싣는다
첫 설정   빈 DB에서 open · 로그에 코드 · compose에는 로컬 소유자 문이 없다(맞는 코드여도 403)
          틀린 코드 403 · 두 사람이 같은 코드로 동시에 → 200 하나, 409 하나, admin 하나
          닫힘 · 다시 claim 409
권한      준비 상태: admin 200 · 일반 회원 403 · 손님 401
          준비 상태 목록의 행마다 상태가 그 API 컨테이너 환경에 돌린 env:doctor와 같다
이미지    컨테이너 안에서 seed-moderator로 운영자 지정
콘텐츠    공개 작품 발행 · 표지 · 아바타 업로드 · 손님 갤러리에 보인다
재시작    API만: 설정 닫힌 채, 코드 안 찍힘, 세션 유지
          스택 전체 down → up(같은 볼륨): 위에 더해 두 세션, 갤러리의 작품, 표지·아바타 바이트가 같다
거절      production이 개발 DB 비밀번호 · 테스트용 세션 키 · 짧은 세션 키로는 뜨지 않는다
```

동시 claim의 결정은 설정 행의 `FOR UPDATE`이고, 단위 테스트(`routes/setup.test.ts`)가 네 명으로 같은 것을
고정한다 — 그 잠금을 빼면 넷 다 admin이 되는 것을 확인했다.

## 손으로 볼 것

```text
1  다섯 서비스가 healthy, 마이그레이션이 다 들어갔다
     docker compose ps
     docker compose exec db psql -U rowcat rowcat -tAc "select count(*) from drizzle.__drizzle_migrations"
     (apps/api/drizzle/*.sql 개수와 같아야 한다)
2  API가 production으로 뜨고 설정 코드를 찍는다    docker compose logs api | grep "\[setup\]"
3  콘솔 /setup 에서 계정을 만든다                    http://localhost:3002/setup
4  틀린 코드 → 화면이 "That code doesn't match"를 말하고 단계가 그대로다
5  맞는 코드 → "You're the administrator"와 준비 상태 목록
6  화면의 준비 상태 목록이 env:doctor와 같다(스크립트도 대조한다 — 여기서는 화면이 그것을 그리는지 본다)
     docker compose exec -T api env | pnpm --silent env:doctor --mode production --file - --json
     루프백 오리진이라 Browser origins만 운영 차단으로 나온다
7  스택 전체 down → up 뒤 /setup은 "Setup is complete", 콘솔은 같은 세션으로 열린다
8  웹(3000)이 그 세션으로 뜨고 콘솔에 오류가 없다
```

`env:doctor`는 이미지에 없다(체크아웃에서 돈다). 콘솔 화면은 그 결과에서 `summary`·`detail`만 뺀 것이라 상태가
다르면 그 자체가 결함이다.

**컨테이너 환경을 파일로 쏟지 않는다.** `env > /tmp/api.env`는 세션 키와 DB 비밀번호를 포함한 전부를 공유 임시
디렉터리에 남기고, 정리 단계를 잊으면 명령보다 오래 산다. `--file -`가 표준 입력에서 읽으므로 파이프로 넘긴다.
`env:doctor`는 읽은 값을 출력하지 않는다(`config/cli.test.ts`). 파일이 꼭 필요하면 `umask 077` 아래
`mktemp`로 만들고 `trap`으로 지운다 — 고정된 경로는 두 실행이 서로의 파일을 읽고 덮는다.

## 정리

```bash
docker compose down -v
docker image rm ghcr.io/project-rowcat/rowcat/{api,web,admin}:latest   # 로컬 빌드가 남긴 태그
```

마지막 줄을 빼먹으면 다음 `docker compose up`(개발 체크아웃 포함)이 당기지도 빌드하지도 않고 **이 클론에서 만든
이미지를 그대로 쓴다** — 컴포즈는 같은 태그가 로컬에 있으면 그것을 쓴다.

## 이 절차가 증명하지 못하는 것

- **TLS와 공개 도메인.** 오리진이 루프백이라 `WEB_ORIGIN`은 진단에서 운영 차단으로 나온다. 리버스 프록시와
  신뢰 오리진은 따로다.
- **BYO 생성.** 그 요청은 브라우저에서 제공자로 바로 가고 이 서버를 지나지 않는다 — 스택이 할 일은 화면을
  내주는 것뿐이고, 실제 대화는 제공자 키가 있어야 한다. 저장소에는 키가 없다. 생성 수명주기 자체는 브라우저
  여정(`e2e/`)이 생성 대역으로 본다.
- **메일·푸시·소셜 로그인·본인확인·관리형 생성** — 꺼진 채로 뜨는 것만 본다.
- **업그레이드.** 빈 볼륨에서 시작한다. 기존 데이터 위의 마이그레이션은 다른 절차다.
- **콘솔 글꼴.** 콘솔의 CSP(`style-src 'self'`)가 공유 스타일시트의 Pretendard(jsDelivr) 가져오기를 막아 콘솔은
  시스템 글꼴로 그려지고, 브라우저 콘솔에 CSP 오류가 남는다. 기능에는 영향이 없다.
