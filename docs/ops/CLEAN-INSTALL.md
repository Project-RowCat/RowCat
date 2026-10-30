# 클린룸 설치 검증

**처음 보는 사람이 README대로 운영 스택을 띄우고 첫 관리자를 세울 수 있는가**를 실제로 돌려 보는 절차다.
단위 테스트는 각 조각(설정 해석, 설정 코드, 권한)을 값으로 고정하지만, 조각 사이 — 이미지에 무엇이 실리는가,
화면이 시키는 명령이 그 이미지에서 실제로 도는가 — 는 이렇게만 드러난다. 2026-10-30 첫 실행에서 찾은 결함이
그 종류였다: 설정 완료 화면은 `db:seed:moderator`를 시켰는데 배포 이미지에는 그 스크립트가 없었다.

릴리스 전에 한 번, 그리고 `docker-compose.yml`·Dockerfile·`tsdown.config.ts`·첫 실행 설정을 바꾼 뒤에 돌린다.
아래 확인 목록의 대부분은 `scripts/compose-smoke.sh`(`pnpm test:compose`)가 자동으로 하고 CI의 `compose` 잡이 매
커밋 돌린다 — 이미지는 그 잡이 통과한 커밋만 게시된다. 브라우저로 콘솔 `/setup` 화면을 직접 거치는 것(4번)은
스크립트가 API로 대신하므로 릴리스 전 한 번은 손으로 본다.

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

GHCR 이미지가 공개돼 있지 않으면 `up`은 당기기에 실패하고(`denied`) 이 클론에서 빌드한다 — 그것도 검증이지만,
**공개 이미지를 검증한 것은 아니다.** 결과에 어느 쪽이었는지 적는다.

## 확인할 것

```text
1  다섯 서비스가 healthy                                docker compose ps
2  API가 production으로 뜨고 설정 코드를 찍는다         docker compose logs api | grep "\[setup\]"
3  GET /v2/setup → {"open":true}
4  콘솔 /setup 에서 계정을 만든다                        http://localhost:3002/setup
5  틀린 코드는 거절된다(setup_code_invalid)
6  맞는 코드 → 그 계정이 admin, 준비 상태 목록이 보인다
7  GET /v2/setup → {"open":false}, 다시 claim → 409 setup_closed
8  준비 상태: admin 200 · 일반 회원 403 · 손님 401        GET /v2/admin/deployment/readiness
9  API 재시작 → 코드가 다시 찍히지 않고, 설정은 닫힌 채, 세션은 유지
10 이미지 안에서 운영자 지정이 된다
     docker compose exec api node dist/db/seed-moderator.mjs <email> staff
11 웹(3000)이 그 세션으로 뜨고 콘솔 오류가 없다
```

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
- **메일·푸시·소셜 로그인·본인확인·관리형 생성** — 꺼진 채로 뜨는 것만 본다.
- **업그레이드.** 빈 볼륨에서 시작한다. 기존 데이터 위의 마이그레이션은 다른 절차다.
