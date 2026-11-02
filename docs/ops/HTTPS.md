# HTTPS 앞단 — 리버스 프록시와 오리진

이 문서가 답하는 것은 하나다 — **공개 도메인에 TLS를 세우면서 로그인 쿠키 · CORS · 콜백 주소를 깨뜨리지 않는 법.**
실행하는 것은 `deploy/caddy/`의 두 파일이고, 이 문서는 그것이 무엇을 정하는지와 직접 바꿀 때 무엇을 맞춰야
하는지를 적는다. 시크릿과 최소 구성은 `CONFIGURATION.md`, 첫 설치 검증은 `CLEAN-INSTALL.md`가 갖는다.

## 모양

```text
https://rowcat.example.com         web            Caddy → web:3000
https://api.rowcat.example.com     API            Caddy → api:3001
https://admin.rowcat.example.com   운영 콘솔      Caddy → admin:3002
```

이 배치를 고른 이유는 저장소가 이미 그렇게 짜여 있어서다 — 웹과 콘솔은 API를 **다른 오리진**으로 부르고(CORS),
세션 쿠키는 부모 도메인에 앉는다(`AUTH_COOKIE_DOMAIN`). 이 저장소가 시험한 배치는 이것 하나다 — 한 호스트 아래
경로로 나누는 배치는 시험하지 않았다.

## 세우기

1. **DNS.** 세 이름(`rowcat.example.com`, `api.`, `admin.`)이 서버의 공인 주소를 가리키게 A(와 IPv6가 있으면 AAAA)
   레코드를 둔다. 와일드카드 한 줄(`*.rowcat.example.com`)과 정점 한 줄도 된다.
2. **포트.** 서버의 방화벽에서 80과 443(TCP), 443(UDP — HTTP/3, 없어도 동작한다)을 연다. 80은 인증서 발급의
   HTTP 확인과 https로의 전환에 쓰인다. 3000–3002는 열지 않는다(아래 「노출」).
3. **`.env`.** `CONFIGURATION.md`의 두 시크릿에 두 줄을 더한다.

   ```bash
   ROWCAT_DOMAIN=rowcat.example.com
   COMPOSE_FILE=docker-compose.yml:deploy/caddy/compose.yml
   ```

   `COMPOSE_FILE`이 있으면 이후 모든 `docker compose` 명령이 두 파일을 함께 읽는다 — `exec`, `logs`, `down`까지.
   빠뜨린 명령 하나는 프록시 없는 스택을 보고, `up`이면 앱 포트를 다시 연다.

   **오리진은 적지 않는다.** `.env`에 `WEB_ORIGIN` · `API_ORIGIN` · `VITE_API_ORIGIN`이 값을 가지면 그 값이
   아래의 파생을 이긴다 — 로컬에서 쓰던 `localhost` 줄이 남아 있으면 스택은 멀쩡히 뜨고 브라우저에서만 로그인과
   API 호출이 막힌다. `.env.example`은 그래서 셋을 주석으로 둔다. 확인은 값을 찍지 않고 한다:

   ```bash
   docker compose config --format json | jq -r '.services.api.environment | {API_ORIGIN, WEB_ORIGIN}'
   ```
4. **올리기와 첫 관리자.**

   ```bash
   docker compose up -d --wait
   docker compose logs api | grep 'enter:'   # 첫 실행 설정 코드
   ```

   `https://admin.rowcat.example.com/setup`에서 계정을 만들거나 로그인하고 그 코드를 넣는다(`CONFIGURATION.md`
   §첫 실행). DNS가 열린 뒤에는 **바로** 한다 — 아래 「노출」.

## 하나의 값에서 나오는 것

`deploy/caddy/compose.yml`은 `ROWCAT_DOMAIN` 하나에서 아래를 만든다. `.env`에 같은 변수를 직접 적으면 그 값이
이긴다(이 배치가 아닌 배포를 위해서다).

```text
API_ORIGIN            https://api.<도메인>                 콜백 · 메일 링크 · 클라이언트에 알려 주는 주소의 근거
WEB_ORIGIN            https://<도메인>,https://admin.<도메인>  CORS 허용 목록 — 콘솔 오리진이 빠지면 콘솔은 「네트워크 실패」만 그린다
AUTH_COOKIE_DOMAIN    <도메인>                             세션 쿠키가 web과 api.<도메인> 둘 다에 간다 — 웹의 서버 렌더가 그 쿠키를 읽는다
AUTH_TRUSTED_PROXIES  172.31.250.2                         Caddy의 주소 하나 — 그 연결에서 온 X-Forwarded-For만 믿는다
WEBAUTHN_RP_ID        <도메인>                             패스키가 묶이는 도메인. 웹 호스트이므로 api. · admin.에서도 같은 패스키다
VITE_API_ORIGIN       https://api.<도메인>                 web · 콘솔이 브라우저에 내리는 API 주소(실행 시점 값 — 이미지를 다시 굽지 않는다)
VITE_ADMIN_ORIGIN     https://admin.<도메인>               계정 화면의 운영 도구 링크
```

- **쿠키 속성은 코드가 정한다** — `Secure` · `HttpOnly` · `SameSite=Lax`(`apps/api/src/auth/index.ts`). 프록시가
  `Set-Cookie`를 고치지 않게 둔다.
- **신뢰하는 프록시는 주소 하나다.** Caddy는 바깥에서 온 `X-Forwarded-For`를 버리고 자기가 본 클라이언트 주소로
  다시 쓴다(위에 신뢰할 프록시를 두지 않았으므로). API는 그 줄을 Caddy의 연결에서 왔을 때만 읽는다. 그래서
  로그인 리미터는 방문자마다 세고, 같은 네트워크의 다른 컨테이너가 클라이언트를 사칭할 수 없다.
- **Caddy 앞에 CDN을 더 두면** Caddy가 CDN의 헤더를 받아야 한다 — 전역 옵션 `servers { trusted_proxies static
  <CDN 대역> }`. 그러지 않으면 Caddy가 CDN의 주소를 클라이언트로 적어, 모든 방문자가 CDN 주소 몇 개로 세어진다
  (`CONFIGURATION.md` §프록시 뒤). 전역 옵션이 여러 줄이 되면 `ROWCAT_CADDY_OPTIONS` 대신 Caddyfile을 고친다.

## 노출

- **앱 포트는 호스트에 열리지 않는다.** 오버레이가 web · api · admin의 `ports`를 비운다(`!reset []`). 열린 채라면
  `http://<서버>:3000-3002`가 TLS를 우회해 평문으로 닿고, API는 Caddy를 거친 요청과 직접 온 요청을 구별하지 못한다.
  db와 redis는 처음부터 포트가 없다.
- **첫 실행 설정은 코드를 아는 사람만 끝낼 수 있다** — 코드는 API 로그에만 찍히고 한 번 쓰면 닫힌다. 그래도 DNS가
  열린 뒤 첫 관리자를 만들기 전까지는 누구나 `/setup` 화면을 볼 수 있으므로, 올리자마자 끝낸다.
- **콘솔 호스트가 공개인 것은 문제가 아니다.** 콘솔은 정적 파일이고, 접근 제어는 API의 권한 검사다(역할 없는
  세션은 모든 조회에서 403). 네트워크 위치로 막고 싶다면 `admin.` 블록에 Caddy의 `remote_ip` 매처를 더한다 —
  그것은 보안 경계가 아니라 표면을 줄이는 일이다.

## 인증서와 갱신

- Caddy가 세 이름 각각의 인증서를 ACME(기본 Let's Encrypt)로 받고, 남은 기간이 3분의 1쯤일 때 스스로 갱신한다. 할 일은
  80 · 443을 열어 두는 것과 **`caddy-data` 볼륨을 지우지 않는 것**이다 — 그 볼륨이 인증서와 ACME 계정이다. 지우면
  다음 시작에 전부 다시 발급하고, 발급 기관의 속도 제한(같은 이름 묶음에 주당 몇 번)이 그것을 센다.
- 확인은 로그 한 줄이다: `docker compose logs caddy | grep -E 'certificate obtained|error'`.
- 만료 알림 메일을 받고 싶으면 `.env`에 `ROWCAT_CADDY_OPTIONS=email ops@example.com`(전역 옵션 한 줄). Let's
  Encrypt는 2025년부터 만료 메일을 보내지 않으므로, 갱신 실패를 알고 싶다면 바깥의 상태 확인(아래)이 그 일을 한다.

## 상태 확인 — 프록시 뒤에서

```text
https://api.<도메인>/v2/health         200 {"ok":true}   생존. 의존성을 보지 않는다
https://api.<도메인>/v2/health/ready   200 · 503         준비. 데이터베이스를 본다
https://<도메인>/                      200               web
https://admin.<도메인>/                200               콘솔
```

바깥의 감시(업타임 서비스)는 이 네 주소를 **공개 이름으로** 부른다 — 그래야 DNS · 인증서 · Caddy · 앱을 한 번에
본다. 컴포즈의 `healthcheck`는 컨테이너 안에서 앱만 보므로 인증서 만료를 말하지 못한다. 인증서의 남은 기간은
`curl -vI https://api.<도메인>/v2/health 2>&1 | grep 'expire date'`로 읽는다.

## 다른 프록시를 쓸 때

nginx · Traefik · 클라우드 로드 밸런서로 같은 배치를 세울 수 있다. 맞춰야 하는 것:

- **위 표의 값을 `.env`에 직접 적는다** — 오버레이를 쓰지 않으면 아무것도 파생되지 않는다. 앱 포트를 루프백에만
  묶거나 닫는다(`docker-compose.override.yml`).
- **SSE를 버퍼링하지 않는다.** `/v2/me/sync/events`는 20초마다 `: ping`을 보내며 최대 30분 열려 있다. nginx라면
  그 경로에 `proxy_buffering off`와 30분보다 긴 `proxy_read_timeout`이 필요하다. 버퍼링되면 동기화 깨우기가 늦게
  오고, 그것은 오류가 아니라 지연으로만 보인다.
- **요청 본문 상한을 앱보다 작게 두지 않는다.** 가장 큰 업로드는 움직이는 커버 GIF(20MiB)이고 소리는 10MiB다 —
  nginx의 기본 `client_max_body_size`(1MiB)는 업로드를 프록시에서 413으로 끝낸다. 상한은 앱이 판정한다.
- **전달 헤더는 덮어쓰게** 하고, 그 프록시의 주소를 `AUTH_TRUSTED_PROXIES`에 적는다.

## 로컬에서 시험하기

공개 DNS 없이 같은 배치를 이 컴퓨터에서 세운다. `*.localhost`는 루프백으로 풀리고, `local_certs`는 Caddy가
자기 CA로 서명하게 한다.

```bash
ROWCAT_DOMAIN=rowcat.localhost
ROWCAT_CADDY_OPTIONS=local_certs
```

Caddy의 루트 인증서는 `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt`로 꺼내
`curl --cacert`에 준다. 브라우저로 보려면 그 인증서를 신뢰해야 하므로 시험용 브라우저 프로필에만 넣는다.

### 2026-11-02에 확인한 것

`main`(e205621)에서 구운 이미지, Docker 29.7 · Compose 5.4 · Caddy 2.11.7, macOS arm64.

```text
http → https                           308
세 호스트 · 상태 확인 두 경로           200, HTTP/2
호스트의 3000 · 3001 · 3002             연결 거부
CORS 사전 요청                          web · 콘솔 오리진만 허용, 다른 오리진과 http 오리진은 허용 헤더 없음
콘솔의 CSP connect-src                  https://api.rowcat.localhost
가입 쿠키                               __Secure- 접두 · Domain=rowcat.localhost · HttpOnly · Secure · SameSite=Lax
웹 서버 렌더                            /account가 쿠키 없이 307(로그인), 쿠키와 함께 200
첫 실행 설정                            청구 200 · 재사용 409 · 이후 닫힘 · 준비 상태 조회 200
동기화 깨우기 SSE                       200 text/event-stream, 첫 프레임과 20초 하트비트가 Caddy를 지나 도착
앱 모양 요청(Origin 없음)               200
위조한 X-Forwarded-For                  매번 다른 값으로도 세 번째 실패 뒤 429 — 새 버킷이 열리지 않는다
2FA                                    켜기 → 비밀번호 로그인이 도전만 받음(세션 401) → 도전 쿠키 .rowcat.localhost → 코드로 200
재시작(down → up)                       인증서 재발급 없음, 설정은 닫힌 채
```

시험 중 고친 것 하나: 고정 주소 `.2`를 먼저 뜬 컨테이너가 동적으로 받아 Caddy가 「Address already in use」로
실패했다. 그래서 `edge` 네트워크의 동적 할당을 `ip_range`로 위쪽 절반에 묶는다.

### 확인하지 못한 것

- **실제 ACME 발급과 갱신** — 공개 DNS가 필요하다. Caddy의 기본 동작이고 이 저장소가 바꾼 것은 없다.
- **브라우저의 패스키 등록과 로그인** — 실제 인증기가 필요하다. 정해 둔 값(RP ID = 웹 호스트, 허용 오리진 =
  `WEB_ORIGIN`)은 부팅이 검사한다(`lib/webauthn-config.ts`).
- **모바일 앱** — 앱 빌드가 필요하다. 앱은 `Origin` 없이 API 오리진으로 직접 부르고, 그 모양의 요청은 위에서 통과했다.
- 웹의 CSP는 report-only이고 빌드 때 정해진 `connect-src`를 갖는다 — 다른 API 오리진에서 막히지는 않고 보고만 한다.
