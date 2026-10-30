# 환경 설정 운영

이 문서가 답하는 것은 둘이다 — **어느 파일이 어느 실행 방식의 것인가**, 그리고
**설정이 어긋났을 때 무엇이 그것을 말해 주는가.**

값 자체는 여기 없다. 각 변수가 무엇이고 왜 그런지는 예시 파일의 주석과
`apps/api/src/config/env-schema.ts`에 있고, 이 문서는 그 위의 **운영 절차**만 갖는다.

## 파일 셋의 책임이 다르다

```text
.env                    docker compose 배포          예시: .env.example
apps/api/.env           API를 직접 띄울 때            예시: apps/api/.env.example
apps/web/.env.local     로컬 웹 오버라이드            예시: apps/web/.env.example
```

**셋을 한 파일로 합치지 않는다.** 갈라 둔 것이 의도이고, 그래서 같은 변수가 파일마다
다르게 취급된다:

```text
HOST · PORT · NODE_ENV     컴포즈가 고정한다        → 루트 예시에 없다
DATABASE_URL               컴포즈가 조립한다        → 루트 예시에는 POSTGRES_* 가 있다
DATABASE_POOL_MAX          컴포즈가 넘기지 않는다    → 코드 기본값을 쓴다
WEB_ORIGIN                 운영자가 정한다          → 두 예시 모두에 있다
MANAGED_GENERATION_ACCESS  운영자가 정한다          → 두 예시 모두에 주석으로 있다(빈 값 = allowlist)
VITE_API_ORIGIN            web·admin 컨테이너가 받는다 → 런타임 값이다(브라우저에는 <meta>로 건넨다)
EXPO_PUBLIC_API_ORIGIN     모바일 번들에 박힌다      → 예시 파일이 없다(README가 적는다)
```

이 표를 사람이 기억하지 않는다. 소유권은 `apps/api/src/config/env-inventory.ts`가
선언하고, 선언과 실제 파일이 어긋나면 `pnpm env:check`가 그 자리를 가리킨다.

## 명령 둘

```bash
pnpm env:check                     저장소의 설정 표면이 서로 일치하는가
pnpm env:doctor                    지금 이 환경으로 무엇이 되는가
pnpm env:doctor --mode production  운영 배포로 가정하고 해석한다
```

둘 다 **읽기만 한다.** 파일을 고치지 않고, 데이터베이스에 붙지 않고, 생성 제공자·확인기관·
SMTP 서버에 아무것도 보내지 않으며, 작업을 시작하지 않는다.

### `pnpm env:check` — 드리프트

비밀도 외부 서비스도 필요 없다. `pnpm check`에 걸려 있으므로 **CI가 배포 전에 잡는다.**

무엇을 대조하는가:

```text
apps/api/src/config/env-schema.ts     런타임이 아는 변수
apps/api/src/config/env-inventory.ts  각 변수의 소유권·문서화 표면·민감도
docker-compose.yml                    서비스가 실제로 받는 값과 그 값을 누가 정하는가
.env.example · apps/api/.env.example · apps/web/.env.example
```

발견은 종류로 묶여 나온다:

| 종류 | 뜻 | 고치는 자리 |
| --- | --- | --- |
| `missing:inventory` | 스키마에 변수를 더하고 인벤토리에 적지 않았다 | `env-inventory.ts` |
| `stale:inventory` | 인벤토리가 아는 런타임 변수가 스키마에 없다 | 인벤토리 항목을 지운다 |
| `missing:compose` | 컴포즈가 넘긴다고 선언했는데 넘기지 않는다 | `docker-compose.yml` |
| `stale:compose` | 컴포즈가 넘기는데 아무도 그 값을 모른다 | 컴포즈에서 지운다 |
| `mismatch:compose` | 선언한 소유권과 값의 모양이 다르다 | 둘 중 하나 |
| `missing:*-example` | 그 파일이 문서화해야 하는 값이 없다 | 그 예시 파일 |
| `stale:*-example` | 그 파일의 것이 아닌 값이 적혀 있다 | 표면을 고치거나 줄을 지운다 |
| `invalid:example` | 파서가 읽을 수 없는 줄, 또는 같은 키의 활성 대입 둘 | 그 파일 |
| `leak:client-surface` | 비밀이 브라우저·모바일 번들 표면에 선언되었다 | 분류나 표면 |
| `leak:example-value` | 커밋되는 예시에 비밀 값이 적혀 있다 | 값을 지운다 |
| `leak:credential-literal` | 값이 자격증명처럼 생겼다 | 값을 지운다 |

**환경변수를 하나 더할 때 움직이는 곳**은 이제 검사기가 말해 준다. 스키마에 키를
더하고 `pnpm env:check`를 돌리면, 인벤토리·컴포즈·예시 파일 중 빠뜨린 곳이 하나씩
나온다 — 그것을 다 채우면 끝이다.

### `pnpm env:doctor` — 준비 상태

변수 목록이 아니라 **능력**을 그린다. `OPENROUTER_API_KEY: 설정됨`은 이미 아는
사실이고, 알고 싶은 것은 *관리형 생성이 되는가*이기 때문이다.

```bash
pnpm env:doctor --file .env --mode production
pnpm --silent env:doctor --file .env --mode production --json   # 배포 파이프라인용
pnpm env:doctor --mode production --strict                      # 저하 상태도 실패로 센다
```

`--json`을 파이프로 받을 때는 `pnpm --silent`로 부른다 — 그렇지 않으면 pnpm이 스크립트 이름
줄을 앞에 찍어 JSON이 깨진다.

**옵션 이름은 `--file`이다.** `--env-file`도 받지만 그것은 Node 런타임의 옵션 이름이기도 해서,
pnpm 단일 실행 파일(`@pnpm/exe`)이 스크립트가 뜨기 전에 자기 인자로 가져가고
`<경로>: not found`로 죽는다(`--`를 넣어도 마찬가지다). `tsx`로 직접 부를 때만 그 이름이 닿는다.

**상대 경로는 명령을 친 자리 기준이다.** 스크립트는 `apps/api` 안에서 돌지만 pnpm이 남기는
`INIT_CWD`로 되짚는다 — 한동안 그러지 않아서, 저장소 루트에서 `--env-file .env`라고 치면
루트의 컴포즈 `.env`가 아니라 `apps/api/.env`를 읽고 초록을 냈다.

`--file`은 **명시적이다.** 도구가 부모 디렉터리를 뒤져 비밀이 든 파일을 스스로
찾지 않는다 — 그러면 운영자는 자기가 무엇을 검사하고 있는지 모른 채 초록을 본다.
그 파일의 값이 프로세스 환경을 이기고, 무엇을 읽었는지는 출력의 첫 줄이 말한다.
**파일 내용은 출력되지 않는다**(읽을 수 없는 줄도 번호와 이유만 말한다).

상태 어휘는 여섯이고, 그 구분이 이 도구의 값이다:

```text
READY        쓸 수 있다
DISABLED     의도적으로 꺼져 있다 — 오류가 아니다
DEGRADED     돌지만 대가가 있다(인프로세스 리미터 · dry-run 파기 · 개발 전송)
BLOCKED      이 능력을 쓰는 경로가 전부 막혀 있다(fail-closed)
INVALID      반쪽 설정 — 사용자가 절차를 절반 밟은 뒤에 실패한다
N/A          이 배포에 해당하지 않는다
```

`--mode production`은 입력의 `NODE_ENV`를 프로덕션으로 **바꿔서** 해석한다. 이 모드의
질문이 *이 설정이 운영으로 뜨면 무슨 일이 일어나는가*이기 때문이다 — 개발 기기에서
그 답이 "부팅이 막힌다"인 것은 정상이고, 그 사실을 배포 전에 아는 것이 이 명령의 값이다.

한동안 여기에 *배포 역할*(`DEPLOYMENT_ENVIRONMENT`)이라는 둘째 축이 있었다 — `NODE_ENV`와
별개로 "이것이 **그** 운영 배포인가"를 답했고, 스토어 결제의 샌드박스·운영 세계를 가르려고
생겼다. 결제가 제품에서 사라지면서(`docs/oss/PLAN.md` §3단계) 그 축도 함께 사라졌다.

종료 코드:

```text
0   설정이 구조적으로 유효하고, 운영을 막는 상태가 없다
1   설정이 유효하지 않거나(부팅이 막힌다) 운영 배포를 막는 상태가 있다
```

`--strict`는 경고와 저하 상태까지 실패로 센다. **기본이 그렇지 않은 이유**는 의도적으로
꺼 둔 선택 기능이 실패가 되면 그 진단이 곧 무시되기 때문이다.

## 최소 구성

운영 배포가 **뜨고 브라우저를 받는 데** 필요한 값은 넷이다. 나머지는 전부 꺼진 채로 뜨고,
`env:doctor --mode production`은 그것을 `disabled`·`degraded`로 말할 뿐 release blocker로
세지 않는다(`apps/api/src/config/minimal-config.test.ts`가 값으로 고정한다).

```text
DATABASE_URL         Postgres. 컴포즈는 POSTGRES_*로 스스로 조립한다(POSTGRES_PASSWORD는 기본값이 없다)
BETTER_AUTH_SECRET   비거나 32자보다 짧으면 프로덕션 부팅이 막힌다(세션 쿠키 위조를 막는 유일한 장치)
WEB_ORIGIN           브라우저 오리진(CSV). 루프백뿐이면 운영 release blocker다 — 운영 콘솔 오리진도 함께 적는다
API_ORIGIN           공개 API 주소. 콜백과 절대 URL의 근거다 — 비우면 http://localhost:3001로 접힌다
```

`API_ORIGIN`은 진단이 막지 않지만 최소에 넣는다 — 비워 둔 배포는 부팅하고, 소셜 콜백과
클라이언트에 알려 주는 주소가 전부 `localhost`를 가리킨다. 웹과 API의 호스트가 갈리면
(`example.com` ↔ `api.example.com`) `AUTH_COOKIE_DOMAIN=.example.com`도 사실상 필요하다 —
진단은 이 경우를 `degraded`로 말한다.

**`docker compose up`이 운영자에게 요구하는 값은 `BETTER_AUTH_SECRET`과 `POSTGRES_PASSWORD` 둘이다**(`:?`).
둘 다 운영자가 생성하는 시크릿이고, 공개 저장소가 대신 적어 줄 수 있는 값이 아니다(아래 「개발 기본값은
운영 시크릿이 아니다」). 데이터베이스 주소는 컴포즈가 그 비밀번호로 조립하고, 두 오리진은 루프백으로 접혀 로컬 스택은 그대로 뜬다(부팅은 경고만 한다).
공개 도메인에 세울 때 `.env`에 `WEB_ORIGIN`·`API_ORIGIN`을 더한다. 컴포즈는 `REDIS_URL`과
`BACKGROUND_JOBS_ENABLED=on`을 스스로 채우므로 아래 표의 앞 두 줄은 컴포즈 밖 배포의 이야기다.

### 개발 기본값은 운영 시크릿이 아니다

이 저장소는 공개돼 있으므로 로컬용으로 적어 둔 값은 누구나 읽는 자격 증명이다. 그런 값으로 뜬 배포는
아무 증상 없이 잘 돈다 — 세션 키는 여전히 쿠키에 서명하고 데이터베이스는 여전히 답한다. 잃은 것은
비밀뿐이고 그 사실은 어디에도 드러나지 않는다. 그래서 프로덕션 부팅이 그 상태를 거부한다
(`apps/api/src/config/deployment-secrets.ts`, `env:doctor --mode production`도 같은 함수를 지난다):

```text
BETTER_AUTH_SECRET   32자 미만 · 이 저장소가 테스트용으로 적은 값      → 부팅 거부
DATABASE_URL         비밀번호가 개발용 `rowcat`                         → 부팅 거부
                     (DATABASE_URL이 아예 없으면 스키마 기본값이 바로 그 값이다)
```

강도 점수나 엔트로피 추정은 하지 않는다 — 길이 하한과 "이 저장소가 공개한 값"은 사실이지만, 강도 점수는
추측이고 좋은 키를 거절하는 추측은 운영자에게 검사가 통과할 때까지 키를 늘리는 법을 가르친다. 개발·테스트
실행은 묻지 않는다(로컬은 이 값들을 일부러 쓴다). `pnpm dev:setup`은 `POSTGRES_PASSWORD`를 생성해 `.env`에
적고 `apps/api/.env`의 `DATABASE_URL`을 거기에 맞춘다.

생성은 이렇게 한다. 비밀번호를 16진수로 만드는 이유는 `DATABASE_URL` 안에 이스케이프 없이 들어가야 해서다
(base64의 `/`·`+`는 URL을 깨뜨린다):

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 24      # POSTGRES_PASSWORD
```

**이미 떠 있는 데이터베이스는 만들어질 때의 비밀번호를 유지한다.** Postgres 이미지는 `POSTGRES_PASSWORD`를
볼륨이 처음 만들어질 때만 읽으므로 `.env`만 바꾸면 API가 접속하지 못한다. 예전 예시의 `rowcat`으로 떠 있던
배포는 역할의 비밀번호를 먼저 바꾸고 `.env`를 맞춘 뒤 API를 다시 띄운다:

```bash
NEW=$(openssl rand -hex 24)
docker compose exec db psql -U rowcat -d rowcat -c "ALTER ROLE rowcat WITH PASSWORD '$NEW'"
# .env의 POSTGRES_PASSWORD를 $NEW로 바꾼 뒤
docker compose up -d api
```

`BETTER_AUTH_SECRET`을 바꾸면 기존 세션이 모두 풀리고(다시 로그인), 첫 실행 설정 코드도 바뀐다.

그 넷만으로 꺼져 있는 것:

```text
레이트리밋 카운터     REDIS_URL 없음 → 인프로세스. 단일 인스턴스에서는 정확하고, 복제본 수만큼 상한이 곱해진다
주기 작업            BACKGROUND_JOBS_ENABLED 없음 → 고아 미디어 청소·보존기간 파기·푸시 배달이 돌지 않는다
트랜잭션 메일        MAIL_TRANSPORT 없음 → 이메일 소유 확인 없음 · 이메일 변경과 비밀번호 재설정 닫힘
네이티브 푸시        PUSH_TRANSPORT 없음 → 인앱 편지함만. 등록·전달 기록은 쌓였다가 만료된다
소셜 로그인          Google·Apple·Kakao 없음 → 이메일·비밀번호와 패스키(rpID는 WEB_ORIGIN에서 파생)
본인확인             IDENTITY_VERIFICATION_PROVIDER 없음 → 성인 자격 확인과 법정대리인 동의가 503(fail-closed).
                     그래서 성인 작품은 아무도 발행·열람하지 못한다. 진단은 이것을 `blocked`로 그린다 — 능력의
                     상태이지 release blocker가 아니다
관리형 생성          OPENROUTER_API_KEY 없음 → 관리형 생성만 503, BYO는 이 서버를 지나지 않으므로 그대로 된다
연령 게이트          MEMBERSHIP_AGE_GATE 없음 → 연령을 묻지 않는다
모바일 OTA 발행      OTA_CI_* 없음 → 콘솔은 읽기·비율·중지·재개, 발행·되돌림은 CLI
로그인 리미터 IP     AUTH_TRUSTED_PROXIES·AUTH_IP_HEADER 없음 → 프록시 뒤라면 경고(부팅은 한다)
```

미디어 저장소는 이 표에 없다 — 바이트는 Postgres(`media_blob`)에 들어가고 설정할 변수가 없다.

확인은 이렇게 한다(값은 출력되지 않는다):

```bash
pnpm env:doctor --mode production --file .env
```

## 첫 실행 — 첫 관리자와 콘솔의 준비 상태

설정이 떠도 운영자가 없으면 운영 콘솔은 403만 그린다. 첫 관리자는 콘솔의 `/setup`에서 세운다.

```text
1. API가 뜰 때 관리자가 없으면 로그에 설정 코드를 찍는다   [setup] … enter: XXXX-XXXX-XXXX
     docker compose logs api | grep "\[setup\]"
2. 콘솔 /setup 에서 계정을 만들거나 로그인한다             Better Auth의 일반 가입이다
3. 코드를 넣으면 그 계정이 admin 이 되고 설정이 닫힌다      다시 열리지 않는다
4. 끝 화면이 이 배포의 능력별 상태와 켜는 변수 이름을 보인다  같은 목록이 운영 화면에도 있다
```

- **코드는 API 로그에만 있다.** `HMAC(BETTER_AUTH_SECRET, 데이터베이스마다의 salt)`라서 복제본·재시작마다 같은
  값이 찍히고 평문은 어디에도 저장되지 않는다. `BETTER_AUTH_SECRET`을 바꾸면 코드도 바뀐다.
- **이미 관리자가 있는 배포는 부팅에서 닫힌다** — 이 기능이 들어오기 전에 `db:seed:moderator`나 psql로
  관리자를 세운 배포를 올려도 경로가 열리지 않는다.
- **마지막 관리자를 잃어도 다시 열리지 않는다.** 되살리는 길은 데이터베이스다 —
  `DELETE FROM deployment_setup;` 뒤에 API를 재시작하면 새 salt로 새 코드가 찍힌다(관리자가 남아 있으면 그
  부팅에서 다시 닫힌다). 운영자를 더 세우는 것은 여전히 `db:seed:moderator`다.
- **콘솔의 준비 상태는 `env:doctor`에서 값을 뺀 것이다.** 능력·상태·변수 이름만 내보내고 `summary`·`detail`
  (호스트·오리진·Services ID)은 통째로 버린다. 구체적인 값과 각 상태의 뜻은 여전히 `pnpm env:doctor`가 말한다.
  admin만 본다.

## 이 도구들이 증명하지 못하는 것

```text
env:check 가 초록이다   → 저장소가 자기와 맞는다.
                          배포된 비밀 저장소가 옳다는 뜻이 아니다(그 파일은 저장소에 없다).

env:doctor 가 초록이다  → 설정의 구조가 유효하고 능력이 켜져 있다.
                          살아 있는 연결을 확인했다는 뜻이 아니다.
```

바깥에서 따로 확인해야 하는 것들:

- SMTP 서버가 그 자격증명으로 인증을 받아 주는가
- 관리형 생성을 켰다면(`OPENROUTER_API_KEY`) 그 제공자 계정의 지출 한도 — 관리형 생성은 계량하지
  않으므로 이 배포가 지키는 천장은 회원당 속도 제한과 허용 목록(`MANAGED_GENERATION_ACCESS`)뿐이고,
  `everyone`이면 앞의 것 하나다
- 포트원 채널이 활성이고 그 계약이 본인확인을 포함하는가
- DNS·리버스 프록시가 `API_ORIGIN`·`WEB_ORIGIN`으로 실제 트래픽을 보내는가
- Apple Services ID의 Return URL에 이 배포의 콜백이 등록되어 있는가

**부팅 검증이 여전히 권위다.** 진단은 그 위에 얹히는 층이고, 잘못된 설정을 통과시키지
않는다 — `apps/api/src/env.ts`가 같은 함수(`resolveEnvironment`)를 지나고, 실패하면
서버는 트래픽을 받기 전에 죽는다.

## 예시 파일은 손으로 쓴다

생성기를 만들지 않는다. 그 파일들의 주석이 이 저장소에서 가장 밀도 높은 운영 문서이고,
`KEY=` 줄만 찍어 내는 생성기는 드리프트를 줄이면서 그 문서를 통째로 지운다.

드리프트를 막는 것은 생성이 아니라 **검사**다.
