# 모바일 OTA — 운영 절차

왜 그 모양인가는 [`ARCHITECTURE.md`](./ARCHITECTURE.md)에 있다. 여기 있는 것은 **누르는 순서**와
**잘못됐을 때 돌아오는 길**이다.

```text
명령의 자리     pnpm mobile:update …              저장소 루트에서(apps/mobile/scripts/ota)
               pnpm --filter @rowcat/api mobile-updates …   위 명령이 부르는 운영 CLI(직접 불러도 된다)
배포 이미지 안  node dist/services/mobile-updates/cli.mjs …  사고 대응 — 서명 키 없이 되는 것만(pause 등)
```

## 발행 환경

| 값 | 무엇 | 어디 |
| --- | --- | --- |
| `ROWCAT_OTA_SIGNING_KEY` 또는 `ROWCAT_OTA_SIGNING_KEY_FILE` | 그 채널의 **개인 키**(PEM) | CI 비밀 · 저장소 밖 파일 |
| `ROWCAT_OTA_STORAGE` | `s3` 또는 `file`(로컬 검증) | |
| `ROWCAT_OTA_S3_ENDPOINT` · `_BUCKET` · `_REGION` · `_ACCESS_KEY_ID` · `_SECRET_ACCESS_KEY` | 자산 버킷(R2·S3·MinIO) — 넷 중 하나라도 비면 멈춘다 | CI 비밀 |
| `ROWCAT_OTA_STORAGE_DIR` | `file`일 때의 폴더 | |
| `ROWCAT_OTA_ASSET_BASE_URL` | 그 버킷을 내보내는 **CDN 오리진**(https · 질의 없음) | |
| `DATABASE_URL` · `API_ORIGIN` | **대상 배포**의 DB와 공개 오리진 — 등록이 번들의 오리진과 견준다 | CI 비밀 |
| `ROWCAT_RELEASE_ACTOR` | 이력에 남을 이름(CI 작업 id 등) | |

- 개인 키는 **API 서버의 환경에 두지 않는다.** API는 서명된 바이트를 고르기만 한다.
- 발행 도구는 `expo export`에 이 값들을 넘기지 않고(`ROWCAT_OTA_*`·`AWS_*`·셸의 `EXPO_PUBLIC_*`를 지운다),
  내보낸 번들에 키·자격의 조각이 있으면 멈춘다.
- CDN은 버킷의 `Cache-Control`을 그대로 내보내고, `Accept-Encoding`에 따라 gzip/brotli로 압축하게 둔다.

## 운영 콘솔에서 — 평상시의 면

운영 콘솔의 **모바일 업데이트**(`/mobile-updates`)가 평상시의 면이다. CLI는 그대로 남고, 콘솔이나 CI가 없을
때의 비상구다(아래 「콘솔·CI가 없을 때」).

```text
읽기            staff · admin   릴리스 목록(채널 · 플랫폼 · 상태 · 런타임 필터) · 상세 · 이력 · 작업
비율 · 중지 · 재개   admin         릴리스 상세의 「조작」 — 서명 키 불필요, API가 곧바로 한다
새 OTA 릴리스    admin           CI 작업을 요청한다 — 결과는 작업 상세에서 본다
되돌리기         admin           계획을 확인하고 CI 작업을 요청한다
```

### 운영 발행

1. **새 OTA 릴리스** → 채널 `운영` · 플랫폼 · 소스(`main` 브랜치의 머리 또는 `main`에 이미 병합된 40자 커밋) ·
   업데이트 노트(날짜 또는 `없음`) · 사유. 처음 비율은 draft 하나다.
2. 작업 상세가 열린다. `대기` → `실행 중`(CI가 커밋을 확정했다) → `완료` 또는 `실패`(멈춘 단계와 사유). CI
   실행 링크가 그 로그로 간다.
3. `완료`면 결과 릴리스(draft 0%)로 간다. 커밋 · 런타임 · API 오리진 · 서명 키를 확인하고 **5%로 확대**.
4. 지켜본 뒤 10 → 25 → 50 → 100. 각 단계가 확인 창이고, 비율은 줄지 않는다.
5. 두 플랫폼이면 작업을 둘 요청한다(스트림마다 살아 있는 작업은 하나다).

### 멈추기와 되돌리기

- **중지**: 릴리스 상세 → 중지 → 사유. 새로 묻는 설치가 받지 않는다. 이미 받은 기기는 그대로다. **재개**는 멈춘
  비율 그대로 다시 연다.
- **되돌리기**: 릴리스 상세 → 되돌리기. 확인 창이 서버의 계획(회복 대상 · 더 새로운 활성 릴리스 · 진행 중인 작업)을
  먼저 보여 준다. 요청하면 CI가 `pnpm mobile:update rollback`을 그대로 돌린다(표시 → 재서명 → 100% 등록). 작업
  상세의 결과 릴리스가 회복 릴리스다.
- 되돌림 요청이 502(「CI 작업을 시작하지 못했습니다」)면 **아무것도 바뀌지 않았다.** 지금 퍼짐은 **중지**로 멈추고,
  CI가 돌아오면 다시 요청하거나 아래 CLI로 되돌린다.

### 작업이 실패했을 때

| 사유 | 뜻 · 다음 |
| --- | --- |
| CI 작업을 시작하지 못했습니다 | 아무것도 서명·등록되지 않았다. GitHub 상태 · 토큰(`OTA_CI_GITHUB_TOKEN`) 만료를 본다 |
| 소스가 허용된 브랜치에 없습니다 | 그 커밋은 `main`의 조상이 아니다 — 병합한 뒤 다시 요청한다 |
| 네이티브 런타임 지문이 기록과 다릅니다 | 새 런타임 세대와 새 바이너리가 필요하다(아래 「새 네이티브 런타임을 내는 날」). 콘솔에서 넘길 길이 없다 |
| 업데이트 노트가 레지스트리에 없습니다 | 그 커밋에 그 날짜의 노트가 없다 — 노트를 커밋하거나 `없음`으로 다시 요청한다 |
| 채널 환경이 이 배포와 맞지 않습니다 | `ota-<채널>` 환경의 `API_ORIGIN`이 바이너리의 값과 다르다 |
| 자산 업로드 · 서명 · 등록 단계 | CI 로그를 본다. 등록 단계에서 멈췄으면 한 플랫폼이 이미 등록됐을 수 있다 — 릴리스 목록을 먼저 본다 |
| CI 실행은 끝났지만 결과를 알리지 않았습니다 | **등록됐을 수 있다.** 릴리스 목록에서 그 커밋의 릴리스를 찾는다 |
| CI가 알린 결과가 등록 표와 맞지 않습니다 | 결과로 적지 않았다. 릴리스 목록을 직접 확인한다 |

`대기` 상태의 작업은 **작업 취소**로 거둘 수 있다(그 뒤에 CI가 시작해도 서명 전에 멈춘다). `실행 중`인 작업은
콘솔에서 취소하지 않는다 — CI 실행 화면에서 멈추면 재조정이 그 결과를 적는다.

## CI 연결 — 처음 한 번

**이 저장소는 워크플로를 싣지 않는다.** 콘솔의 `새 OTA 릴리스`·`되돌리기`를 쓰려면 먼저
[`example-workflows.md`](./example-workflows.md)의 본보기를 자기 저장소의 `.github/workflows/mobile-ota.yml`로
옮겨 `main`에 병합한다. 파일 이름과 브랜치는 API가 상수로 갖는다(디스패치 주소와 OIDC `workflow_ref`의 대조) —
다른 이름이면 디스패치가 404이고, 다른 브랜치면 보고가 거절된다. 워크플로 없이 아래 API 값만 채우면 콘솔의 요청은
전부 `CI 작업을 시작하지 못했습니다`로 끝난다(아무것도 서명·등록되지 않는다).

### API 배포

| 값 | 무엇 |
| --- | --- |
| `OTA_CI_GITHUB_REPOSITORY` | `owner/repo` |
| `OTA_CI_GITHUB_TOKEN` | 이 저장소 하나의 **Actions: read and write**만 가진 fine-grained 토큰(또는 GitHub App 설치 토큰). 내용 쓰기·관리 권한을 주지 않는다 |
| `OTA_CI_CHANNELS` | 이 배포가 등록 대상인 채널 — 운영 배포는 `production`, Sandbox 배포는 `testflight` |
| `BACKGROUND_JOBS_ENABLED=on` | 잃어버린 CI 보고를 재조정한다(프로덕션에서 없으면 부팅이 막힌다) |

셋은 함께 채우거나 함께 비운다. 비우면 콘솔은 읽기와 비율·중지·재개만 한다.

### GitHub 환경(채널마다 하나 — `ota-preview` · `ota-testflight` · `ota-production`)

| 종류 | 이름 |
| --- | --- |
| 비밀 | `ROWCAT_OTA_SIGNING_KEY`(그 채널의 개인 키) · `ROWCAT_OTA_S3_ACCESS_KEY_ID` · `ROWCAT_OTA_S3_SECRET_ACCESS_KEY` · `DATABASE_URL`(대상 배포) |
| 변수 | `ROWCAT_OTA_STORAGE` · `ROWCAT_OTA_S3_ENDPOINT` · `ROWCAT_OTA_S3_BUCKET` · `ROWCAT_OTA_S3_REGION` · `ROWCAT_OTA_ASSET_BASE_URL` · `API_ORIGIN`(대상 배포) · `ROWCAT_OTA_REPORT_URL`(= `<API_ORIGIN>/v2/mobile/update-jobs`) |
| 보호 | 배포 브랜치 규칙 `main`만. `ota-production`에는 원하면 필수 검토자 |

- 채널마다 **다른** 환경이다 — 한 실행이 세 키를 모두 갖지 않는다.
- `ROWCAT_OTA_REPORT_URL`은 OIDC 토큰의 `aud`가 된다. API는 자기 주소와 같은 `aud`만 받으므로 Sandbox용 토큰이
  운영 배포에서 재생되지 않는다.
- 서명 키는 `Publish`/`Rollback` 단계의 `env`에만 있다. 체크아웃 · 소스 확인 · 보고 · 설치 단계는 보지 못한다.

## 스토어 제출

iOS 빌드를 App Store Connect(TestFlight)에 올리는 일은 `apps/mobile/scripts/submit-ios.mjs`가 한다. 그 스크립트는
GitHub Actions 밖에서의 업로드를 `--acknowledge-ungated "<사유>"` 없이 거절한다 — 누가 올렸는지를 남기는 자리가 수동
워크플로이기 때문이다. 그 워크플로의 본보기도 [`example-workflows.md`](./example-workflows.md)에 있다. 그것은 기록이지
관문이 아니다: IPA를 지은 커밋이 무엇을 통과했는지는 아무것도 확인하지 않는다.

## 콘솔·CI가 없을 때 — CLI가 비상구다

- **콘솔이 없다**: 아래 CLI 절차가 그대로 된다. 운영 컨테이너 안에서도 `node dist/services/mobile-updates/cli.mjs
  pause <id> --reason "…"`.
- **CI가 없다**: 콘솔의 **중지**는 된다(서명 키 불필요). 발행·되돌림은 키가 있는 자리에서 `pnpm mobile:update`로
  한다. 그때 콘솔에 남은 작업은 `실패(CI 작업을 시작하지 못했습니다)`이고, 이력에는 CLI의 `actor`가 남는다.

## 처음 한 번 — 채널의 신뢰 뿌리

**인증서가 커밋되기 전까지 그 채널의 EAS 빌드는 멈춘다**(의도한 실패 — 서명 없이 OTA를 켜는 길도,
조용히 끄는 길도 없다). 셋 다 만든다.

```bash
pnpm mobile:update keys:generate preview --key-out ~/rowcat-ota-keys
pnpm mobile:update keys:generate testflight --key-out ~/rowcat-ota-keys
pnpm mobile:update keys:generate production --key-out ~/rowcat-ota-keys
```

1. `apps/mobile/certs/rowcat-<채널>-1.pem`(인증서)을 커밋한다.
2. `~/rowcat-ota-keys/rowcat-<채널>-1.private-key.pem`을 그 채널의 CI 비밀로 옮기고, 원본은 오프라인
   보관소에 둔다. **채널마다 다른 비밀이다** — 하나의 CI 작업이 세 키를 모두 갖지 않게 한다.
3. 그 뒤로 지은 바이너리부터 OTA를 받는다. 이미 스토어에 나간 바이너리(인증서 없이 지은 것)는 받지
   않는다 — 그 바이너리는 다음 스토어 릴리스까지 스토어 번들로 돈다.

인증서 없이 급히 스토어 빌드를 내야 하면 그 빌드만 `ROWCAT_OTA=off`로 짓는다(그 바이너리는 OTA를
영영 받지 못한다는 것을 알고 고른다).

## preview 발행

```bash
pnpm mobile:update publish preview --api-origin https://<그 preview 바이너리의 API>
```

- preview의 API 오리진은 `eas.json`에 없다 — **그 바이너리를 지을 때 쓴 값**을 적는다. 그 배포의
  `DATABASE_URL`·`API_ORIGIN`으로 등록된다.
- 비율을 적지 않으면 100%다(내부 QA).

## TestFlight 발행

```bash
pnpm mobile:update publish testflight
```

- API 오리진은 `eas.json`의 Sandbox 값이고, 등록 대상은 **Sandbox 배포의 DB**다.
- 셸에 운영 오리진이 서 있으면 멈춘다.

## 운영 발행 — 카나리아부터

```bash
pnpm mobile:update publish production --note 2026-10-03
```

1. **draft로 등록된다**(아무에게도 가지 않는다). 운영은 `--allow-dirty`·`--skip-checks`를 받지 않고,
   업데이트 노트를 말해야 한다(`--note <날짜>` — 그 노트가 생성된 레지스트리에 있어야 한다 — 또는
   `--no-note`).
2. 출력된 두 id(iOS·Android)로 카나리아를 연다:

   ```bash
   pnpm mobile:update rollout <ios-id>,<android-id> 10
   ```

3. 지켜본다(크래시·지원 문의). 그다음:

   ```bash
   pnpm mobile:update rollout <ios-id>,<android-id> 25
   pnpm mobile:update rollout <ios-id>,<android-id> 50
   pnpm mobile:update rollout <ios-id>,<android-id> 100
   ```

   비율은 **줄지 않는다** — 앞 단계에 든 설치는 그대로 남고 칸이 더해진다.
4. 이력: `pnpm mobile:update show <id>`.

## 발행이 중간에 실패했을 때

| 어디서 멈췄나 | 다시 하는 법 |
| --- | --- |
| 등록 전(검사·환경·런타임·내보내기·서명) | 고치고 `publish`를 다시 돌린다 — 아무것도 등록되지 않았다. 이미 올린 자산은 해시가 같아 다시 올라가지 않는다 |
| 한 플랫폼은 등록됐고 다른 쪽이 실패 | 도구가 출력한 `pnpm mobile:update register <묶음>` 한 줄만 다시 돌린다. `publish`를 처음부터 돌리면 등록된 쪽이 「같은 코드」로 거절된다 |
| 등록됐는지 모르겠다(응답을 잃었다) | `register`를 다시 돌려도 안전하다 — 같은 묶음은 아무것도 바꾸지 않고 지금 상태를 돌려준다 |
| 「같은 코드의 릴리스가 이미 있다」 | 이전 발행이 이미 등록됐다는 뜻이다. 그 id로 `rollout`한다 |
| 「이 스트림에 …보다 새로운 릴리스만」 | 옛 묶음 파일이다. `publish`를 다시 돌려 새 시각으로 만든다 |

## 멈추기 — 서명 키 없이

```bash
pnpm mobile:update pause <id> --reason "로그인 화면이 빈다"
```

- 새로 묻는 설치가 받지 않는다. **이미 받은 설치는 그대로다**(다음 콜드 스타트에도 B를 실행한다).
- 운영 컨테이너 안에서도 된다: `node dist/services/mobile-updates/cli.mjs pause <id> --reason "…"`.
- 다시 열기: `pnpm mobile:update resume <id>` — 멈춘 비율 그대로 다시 나간다(같은 설치가 같은 답을 받는다).

## 되돌리기 — 이미 받은 설치까지

```bash
pnpm mobile:update rollback <id> --reason "…"           # 이전 좋은 OTA로
pnpm mobile:update rollback <id> --reason "…" --to-embedded   # 스토어 번들로
```

순서(도구가 그대로 한다):

1. 나쁜 릴리스를 `rolled_back`으로 — **서명 키 없이** 곧바로 퍼짐이 멈춘다.
2. 이전 좋은 OTA(같은 스트림에서 더 오래된 활성 업데이트 중 가장 새 것)의 코드를 **새 id·새 시각으로
   다시 서명**한다. 자산은 이미 저장소에 있다. 그런 OTA가 없으면 `rollBackToEmbedded` 지시를 서명한다.
3. 100%로 등록한다.

- 나쁜 릴리스를 받은 설치는 **다음 콜드 스타트에** 되돌림을 내려받고 **그다음 콜드 스타트에** 실행한다.
- 이 릴리스보다 새로운 활성 릴리스가 있으면 도구가 거절한다(그 릴리스가 이미 덮고 있다 — 그것도 나쁘면
  그것부터 되돌린다).
- 플랫폼마다 따로다(iOS·Android 릴리스 id가 다르다).
- 1단계만 끝나고 2단계가 실패했으면(키가 없다, 저장소가 흔들렸다) **멈춘 상태로 안전하다** — 키가 있는
  자리에서 `rollback`을 다시 돌리면 된다. 이미 `rolled_back`인 릴리스에 다시 돌려도 1단계는 아무것도
  바꾸지 않는다.

### 무엇을 기대하지 말아야 하는가

- 실행 중인 앱이 그 자리에서 바뀌지 않는다.
- 롤아웃 비율을 내리는 것으로는 아무도 돌아오지 않는다.
- `rolled_back` 릴리스를 `resume`할 수 없다 — 같은 코드를 다시 내려면 새로 발행한다.

## 새 네이티브 런타임을 내는 날

네이티브 모듈·config plugin·Info.plist·매니페스트·**크리에이터 런타임 하네스/WASM**이 바뀌면
`pnpm check`가 먼저 깨진다(`mobile:runtime:check` — 지문이 기록과 다르다).

1. `apps/mobile/app.config.ts`의 `RUNTIME_VERSION`을 다음 숫자로(`rowcat-native-2`).
2. `pnpm mobile:update runtime:record` → `native-runtime.lock.json`을 커밋한다.
3. 세 채널의 바이너리를 짓고 스토어(·TestFlight·내부 배포)에 낸다.
4. 그 세대의 첫 OTA는 그 바이너리가 나간 **뒤에** 의미가 있다. 옛 세대(`rowcat-native-1`)의 바이너리는
   옛 세대의 OTA만 받는다 — 두 세대에 같은 수정을 내야 하면 각 세대의 커밋에서 따로 발행한다.
5. 옛 바이너리를 끊는 것은 이 체계가 아니라 최소 지원 판(`app_update`)의 절차다.

세대 번호를 재사용하지 않는다 — `runtime:record`가 이미 기록된 세대의 다른 지문을 거절한다.

## 서명 신뢰 교체

V1의 바이너리는 채널마다 인증서 하나를 믿는다. 키가 새거나 만료가 다가오면:

1. `pnpm mobile:update keys:generate <채널> --generation 2 --key-out …` → `rowcat-<채널>-2.pem` 커밋.
2. `app.config.ts`의 `OTA_SIGNING_KEY_ID[<채널>]`을 `rowcat-<채널>-2`로 — 그 뒤로 지은 바이너리가 새 키를
   믿고 요청에 그 키 id를 싣는다.
3. **교체 기간에는 두 키로 서명해야 한다**(옛 바이너리는 옛 키 id를 요청하고, 서버는 그 id의 서명이 있는
   릴리스만 준다). 묶음의 `signatures`는 배열이고 DB도 키 id별 서명을 담지만, **V1의 발행 도구는 한 키로만
   서명한다** — 교체가 필요해지는 날 발행 도구에 두 번째 키를 받는 줄을 더한다(계약과 서버는 이미 준비돼
   있다).
4. 키가 **새었다면**: 그 키로 서명된 릴리스는 이미 유효한 서명이다. 새 키의 바이너리를 내고, 옛 바이너리를
   최소 지원 판으로 끊는 것이 유일한 완전한 회복이다(인증서 폐기 목록은 expo-updates에 없다).

## 저장소 보고

```bash
pnpm mobile:update gc-report
```

도달 가능한 자산(draft·active·paused가 가리킴)과 되돌린 릴리스만 가리키는 자산을 센다. **지우지 않는다** —
지우는 절차는 아직 없다(`ARCHITECTURE.md`의 「가비지 수집」).

## 로컬에서 끝까지

```bash
# 저장소 밖에 시험용 키 — 고정된 /tmp 경로가 아니라 이 셸만 아는 0700 폴더에
keys="$(mktemp -d)" store="$(mktemp -d)"
pnpm mobile:update keys:generate preview --key-out "$keys"
export ROWCAT_OTA_SIGNING_KEY_FILE="$keys/rowcat-preview-1.private-key.pem"
export ROWCAT_OTA_STORAGE=file ROWCAT_OTA_STORAGE_DIR="$store"
export ROWCAT_OTA_ASSET_BASE_URL=http://127.0.0.1:8787
(cd "$store" && python3 -m http.server 8787 --bind 127.0.0.1) &
pnpm dev:api
pnpm mobile:update publish preview --api-origin http://localhost:3001 --skip-checks
```

시뮬레이터 Release 빌드(그 채널의 OTA가 켜진 바이너리):

```bash
cd apps/mobile
ROWCAT_OTA_CHANNEL=preview EXPO_PUBLIC_API_ORIGIN=http://localhost:3001 npx expo prebuild --platform ios --no-install
(cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)
(cd ios && ROWCAT_OTA_CHANNEL=preview EXPO_PUBLIC_API_ORIGIN=http://localhost:3001 xcodebuild \
  -workspace RowCat.xcworkspace -scheme RowCat -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/dd-ota)
```

바이너리를 지은 **뒤에** 발행한 OTA만 그 바이너리에게 새것이다(스토어 번들의 시각이 빌드 시각이다).
끝나면 시험용 인증서(`certs/rowcat-preview-1.pem`)와 `"$keys"` 폴더를 지우고 `prebuild`를 OTA 없이 다시
돌린다 — 그 인증서의 개인 키는 아무도 관리하지 않는다. 고정된 `/tmp` 경로에 두면 같은 기계의 다른 사용자가 그
키를 읽고, 그 인증서를 믿는 로컬 바이너리에 자기 업데이트를 서명해 내보낼 수 있다.

## 검증 기록

| 날짜 | 무엇 | 결과 |
| --- | --- | --- |
| 2026-10-03 | 로컬: 실제 `expo export` → 해시·업로드(파일 저장소) → 서명 → 등록 → `GET /manifest` | iOS 자산 29 · Android 33(21개 공유, 다시 올리지 않음) · 서명 유효 · 해시 전부 일치 · `extra.expoClient`에 EAS 프로젝트 id |
| 2026-10-03 | 로컬: pause → 이전 릴리스가 나감 · resume · 비율 감소 거절 · rollback → 재발행 A′(같은 자산) · `--to-embedded` → 서명된 directive | 전부 기대대로 |
| 2026-10-03 | 로컬: DB의 manifest 한 바이트 변조 → 서명 검증 실패 · 저장소 객체 변조 → 해시 불일치 | 클라이언트 쪽 검증 계산(같은 알고리즘)으로 확인 |
| 2026-10-03 | 로컬: 다른 런타임·운영·TestFlight 채널 요청 → 204 · 채널과 키 id가 어긋난 요청 → 400 | 기대대로 |
| 2026-10-03 | **iOS 시뮬레이터 Release 빌드**(preview 채널, expo-updates 57.0.24) — 빌드보다 오래된 manifest | 받지 않았다(스토어 번들 그대로) |
| 2026-10-03 | 같은 바이너리 — 빌드 뒤에 발행한 C | 콜드 스타트 1에 내려받고 `isVerified = 1`, `manifestFilters = {"channel":"preview"}` 저장 · 콜드 스타트 2에 C 실행(`successful_launch_count` 1) |
| 2026-10-03 | 같은 바이너리 — `rollback C` → 재발행 R을 DB에서 한 바이트 변조 | 네이티브 로그 `Code signing incorrect signature` · R 저장 안 됨 · C로 계속 실행 |
| 2026-10-03 | 같은 바이너리 — R 복원 | 콜드 스타트 1에 R 내려받음(C 실행 중) · 콜드 스타트 2에 R 실행 |
| 2026-10-03 | 같은 바이너리 — API 서버를 내림 | R로 정상 기동(`failed_launch_count` 0) |
| — | **아직 하지 않은 것** | 안드로이드 에뮬레이터·실기기 · TestFlight/운영 빌드 · 실제 R2/S3·CDN · 운영 키로 서명 |
