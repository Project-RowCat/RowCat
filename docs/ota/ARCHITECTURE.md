# 모바일 OTA 업데이트 — 자체 호스팅

설치된 앱에 **호환되는 JS와 Metro 자산**을 스토어를 거치지 않고 내보내는 체계. 클라이언트는
`expo-updates`이고, 프로토콜 서버·manifest·자산·롤아웃·발행 도구는 우리가 갖는다.

절차(발행·롤아웃·중지·되돌림·새 런타임·키 교체)는 [`OPERATIONS.md`](./OPERATIONS.md)에 있다.
이 문서는 **왜 그 모양인가**와 **무엇을 약속하지 않는가**를 적는다.

```text
발행 환경(CI · 릴리스 담당자)
  │  expo export (그 채널의 EXPO_PUBLIC_*만, 비밀 없이)
  ▼
apps/mobile/scripts/ota   해시 → 없는 자산만 올린다 → manifest → 서명 → 묶음
  ├──────────────▶ 오브젝트 저장소 / CDN    mobile-updates/assets/sha256/<hex>   불변
  └──────────────▶ apps/api CLI(프로세스)   mobile_update_release                 상태·비율만 움직인다

설치된 앱 ── expo-updates ──▶ GET /v2/mobile/updates/manifest   고르기만 한다(서명된 바이트 그대로)
                     └──────▶ CDN                                자산은 앱이 직접 받는다

운영 콘솔 ── /v2/admin/mobile-updates*   읽기 · 비율 · 중지 · 재개(서명 키 불필요)
         └─ /v2/admin/mobile-update-jobs ─▶ GitHub Actions(mobile-ota.yml) ─▶ 위 발행 환경 그대로
                                         ◀─ OIDC 보고(/v2/mobile/update-jobs/:id/reports)
```

`mobile-ota.yml`은 **이 저장소에 없다** — 호스팅 서비스의 계정과 비밀에 묶여 있어서 공개본에서 지웠고, 본보기는
[`example-workflows.md`](./example-workflows.md)에 있다. 그 파일을 두지 않은 배포는 CI 연결(`OTA_CI_*`)을 비워 두고,
그러면 콘솔은 읽기 · 비율 · 중지 · 재개만 하고 발행·되돌림은 CLI가 한다. API의 대조(파일 이름 · `main` · 환경 이름)는
그대로 남는다 — 포크가 본보기를 같은 자리에 옮기면 그대로 선다.

## 왜 자체 호스팅인가 — 그리고 왜 여전히 `expo-updates`인가

배포의 권위(무엇이 누구에게 언제 가는가)를 EAS Update의 채널·브랜치가 아니라 **우리 데이터베이스와
우리 서명 키**가 갖게 하려는 것이다. TestFlight 바이너리는 Sandbox 배포와, 운영 바이너리는 운영
배포와 이야기한다는 이 저장소의 규칙(`apps/mobile/src/lib/build-profile.ts`)이 OTA에서도 그대로
서야 하고, 그 판정을 바깥 서비스의 설정 화면에 두면 그 규칙이 우리 코드에서 보이지 않는다.

**클라이언트는 다시 쓰지 않는다.** 번들을 내려받고, 해시를 검증하고, 서명을 검증하고, 실행할
번들을 고르고, 실행 직후 죽는 업데이트를 되돌리는 일은 `expo-updates`의 네이티브 코드가 한다.
그 코드를 JS로 다시 쓰는 것은 기능 추가가 아니라 **원격 코드 실행 경로를 하나 더 만드는 일**이다.
이 앱의 JS는 `expo-updates`를 import하지도 않는다(`src/lib/updates-boundaries.test.ts`).

## 클라이언트가 실제로 하는 일 — `expo-updates` 57.0.24에서 확인한 것

규격(`docs.expo.dev/technical-specs/expo-updates-1`)만 읽고 서버를 짓지 않았다. 아래는 설치된
판의 네이티브 코드(`ios/EXUpdates`, `android/.../updates`)에서 읽은 동작이고, 이 체계의 모든 약속이
여기에 기댄다. **SDK가 오르면 이 표를 다시 읽는다.**

```text
요청 머리       Expo-Protocol-Version: 1 · Expo-Platform · Expo-Runtime-Version
                EAS-Client-ID(설치 난수) · Accept: multipart/mixed,application/expo+json,...
                expo-expect-signature: sig, keyid="…", alg="rsa-v1_5-sha256"
                + 설정의 requestHeaders(rowcat-update-channel)
업데이트 없음   204 + expo-protocol-version > 0 → 성공·아무것도 없음(본문이 필요 없다)
서명 검증       manifest/directive 부분의 바이트 그대로 · keyid가 설정과 다르면 거절
                서명이 없으면 거절(codeSigningAllowUnsignedManifests를 켜지 않는다)
런타임          실행 선택이 runtimeVersion으로 거른다 — 다른 런타임의 manifest는
                내려받혀도 **실행되지 않는다**
새로움          지금 실행 중인 것보다 commitTime(manifest의 createdAt)이 새로울 때만 받는다
되돌림 지시     rollBackToEmbedded는 commitTime이 실행 중인 것보다 새로울 때만 따른다
manifest 필터   expo-manifest-filters의 channel과 다른 metadata.channel은 고르지 않는다
적용 시점       checkAutomatically: ON_LOAD + fallbackToCacheTimeout: 0
                → 콜드 스타트에 묻고, 기다리지 않고, 내려받은 것은 **다음 콜드 스타트에** 실행한다
오류 복구       실행 직후(첫 화면 전에) 죽는 업데이트는 이전 업데이트로 되돌리고, 다음 요청에
                Expo-Fatal-Error를 싣는다
```

## 신뢰 모델

**OTA는 설계상 원격 코드 실행이다.** 그래서 서명이 선택이 아니고, 서명할 권한이 어디에 있는가가
이 체계의 전부다.

```text
발행 환경   개인 키(채널마다 하나)                    apps/mobile/scripts/ota/signing.ts만 읽는다
바이너리    그 채널의 인증서(공개)                    apps/mobile/certs/<keyId>.pem → Expo.plist
API · Postgres · CDN · 오브젝트 저장소   서명할 권한이 없다
```

마지막 줄의 뜻: 그 넷 중 하나가 뚫려도 **새 실행 코드를 만들 수 없다.** 몸통을 한 바이트 고치면
서명이 맞지 않고, 자산을 바꾸면 해시가 맞지 않는다. 남는 공격과 그 방어는 이것이다:

| 공격(서버·DB·CDN을 쥔 쪽) | 막는 것 |
| --- | --- |
| 다른 채널의 서명된 manifest를 내보낸다 | **채널마다 다른 키** — 바이너리는 자기 채널의 인증서로만 검증한다 |
| 다른 런타임의 manifest를 내보낸다 | 런타임은 서명된 몸통 안에 있고, 클라이언트의 실행 선택이 거른다 |
| 옛 manifest를 다시 내보낸다(되감기) | 클라이언트는 실행 중인 것보다 오래된 것을 받지 않는다 |
| 서명된 되돌림 지시를 다시 내보낸다 | 스토어 번들로 돌아갈 뿐이다(서명된 시각보다 새 업데이트에는 무효) — 가용성 공격이지 코드 실행이 아니다 |
| 자산 바이트를 바꾼다 | 해시 검증 실패 — 그 업데이트 전체가 버려진다 |
| 업데이트를 주지 않는다 | 앱은 지금 가진 번들로 뜬다 |

**채널 키를 셋으로 둔 이유가 둘째 줄의 위 칸이다.** 키가 하나면 DB를 쥔 쪽이 preview 릴리스(그
번들은 어느 API든 향할 수 있다)를 TestFlight 바이너리에 내보낼 수 있고, 그 조합이 바로 빌드 프로필
검사가 막아 둔 사고(Sandbox 바이너리가 운영 백엔드와 이야기하는 것)다. 키 id에 채널이 들어 있는
것(`rowcat-<채널>-<세대>`)은 서버가 세 값을 서로 견주게 하려는 것이고, 권위는 키 쪽에 있다.

**서버가 서명 검증을 한 번 더 한다** — 등록 때 커밋된 인증서로 묶음의 서명을 검증하고, 몸통에서
채널·플랫폼·런타임·시각·자산을 다시 읽어 컬럼과 견준다(`services/mobile-updates/registration.ts`).
이것은 클라이언트 검증의 대체가 아니라, 어긋난 묶음이 **틀린 스트림에서 선택되는 것**을 막는 한 겹이다.

## 네이티브 런타임 세대

OTA가 그 바이너리에서 돌아도 되는가는 **JS 판이 아니라 네이티브 계약의 판**이 정한다.

```text
앱 판(version)       2.0.0             스토어가 읽는다 — 제출 때 사람이 올린다
빌드 번호             EAS가 올린다
런타임 세대           rowcat-native-N   OTA의 호환성 — 네이티브가 바뀔 때만 오른다
```

- **출처는 `app.config.ts`의 `RUNTIME_VERSION` 하나다.** 발행 도구·등록·선택·테스트가 전부 평가된
  설정에서 읽는다.
- **"네이티브가 바뀌었는가"는 지문이 답한다**(`@expo/fingerprint`). 세대마다 지문을
  `apps/mobile/native-runtime.lock.json`에 기록하고, 지금의 지문이 그 세대의 기록과 다르면 발행이
  멈추고 `pnpm check`가 실패한다. 범위는 `apps/mobile/fingerprint.config.js`가 정한다 — 자동 링크되는
  네이티브 모듈(판과 소스), config plugin, 앱 설정의 네이티브 칸, 그리고 **로컬 모듈
  `modules/rowcat-runtime-webview`**(런타임 하네스 HTML과 QuickJS WASM이 거기 산다). 판·빌드 번호·
  아이콘·`updates` 칸·`android/`·`ios/`·`eas.json`·`certs/`는 세지 않는다.
- **⚠︎ 크리에이터 런타임의 하네스가 네이티브 자산이다.** `pnpm runtime-vm:harness`가 다시 만드는
  `modules/rowcat-runtime-webview/assets/runtime/*`는 바이너리에 패키징되고 OTA로 바뀌지 않는다.
  그래서 `@rowcat/runtime-host`나 하네스 진입점을 고치면 지문이 바뀌고 **새 런타임 세대와 새
  바이너리가 필요하다** — JS 쪽 다리 코드(`lib/runtime-native/`)만 OTA로 가면 옛 하네스와 새 다리가
  만나기 때문이다. 그 사실을 지문이 기계적으로 잡는다.
- **세대 번호를 재사용하지 않는다.** 기록은 덧붙이기만 하고(`runtime:record`), 이미 있는 세대의
  지문을 바꾸는 명령이 없다.
- **iOS와 Android가 같은 세대를 쓴다.** 한쪽만 네이티브가 바뀌어도 세대가 오른다 — 플랫폼별
  세대는 두 바이너리의 출시 일정을 갈라야 할 때 고려한다(지금은 그 비용이 없다).

## 채널과 배포

```text
채널(EAS 프로필)   키           API(바이너리 = 번들)                       DB
preview            preview-N    --api-origin로 명시(eas.json에 없다)        그 API의 배포
testflight         testflight-N eas.json — production과 다른 오리진(예: staging-api.example.com)  스테이징 배포
production         production-N eas.json — 반드시 적는다(기본값 없음, 자리표시면 빌드가 멈춘다)  운영 배포
development        OTA 없음 — Metro가 번들을 준다
```

- **채널은 바이너리가 정한다.** `EAS_BUILD_PROFILE`이 채널이고, 그 채널의 인증서와 채널 헤더가
  바이너리에 박힌다. 요청 헤더의 채널은 라우팅이지 권위가 아니다 — 사칭한 클라이언트가 받는 것은
  자기 인증서로 검증되지 않는 manifest다.
- **바이너리의 환경과 번들의 환경이 같아야 한다.** `EXPO_PUBLIC_*`는 번들에 박히므로, OTA 하나가
  TestFlight 바이너리를 운영 백엔드의 클라이언트로 바꿀 수 있다. 발행 도구는 그 채널의 `eas.json`
  `env`를 출처로 쓰고, 셸의 값이 다르면 멈추며, 빌드 프로필 규칙(`checkEasBuildEnvironment`)을
  **그대로** 다시 돌린다. 평가된 설정의 업데이트 주소 오리진도 번들의 API 오리진과 견준다. 등록은
  번들의 API 오리진이 **그 배포의 `API_ORIGIN`**과 같을 때만 받는다 — TestFlight 번들은 운영 DB에
  들어갈 수 없다.
- ⚠️ **EAS 서버에만 둔 환경변수는 이 검사가 보지 못한다.** 바이너리를 그 값으로 지었다면 그 값을
  `eas.json`이나 `--api-origin`으로 옮겨야 같음이 검사된다.

## 선택

```text
후보 = 같은 플랫폼 · 같은 채널 · 같은 런타임 · 요청한 키 id의 서명이 있는 · active
       → 서명된 시각의 최신순으로 훑는다
       → 이 설치가 그 릴리스의 롤아웃 칸 안이면 그것이 답이다
       → 없으면 204
```

- 선택이 실패하면 **503**이다. "가장 새 것이라도" 주는 폴백이 없다 — 앱은 응답을 못 받으면 지금
  가진 번들로 뜨고, 그것이 안전한 바닥이다.
- 서명을 기대하지 않는 요청(`expo-expect-signature` 없음)에는 아무것도 주지 않는다.
- 이 라우트는 세션을 읽지 않는다. 다른 계정으로 로그인했다고 다른 코드를 받지 않는다.
- 응답은 `cache-control: private, max-age=0`이다(설치마다 답이 다르고, 중지가 곧바로 보여야 한다).

## 롤아웃

```text
bucket = sha256("rowcat-ota-rollout" ‖ releaseId ‖ EAS-Client-ID)의 앞 4바이트 mod 10000
포함   ⇔  bucket < 비율 × 100
```

- 같은 설치는 같은 릴리스에 대해 **언제나 같은 칸**이다. 비율을 10 → 25로 올리면 앞의 10%가 그대로
  남고 15%가 **더해진다.** 릴리스마다 모집단이 다르다(같은 설치가 매번 카나리아가 되지 않는다).
- **설치 식별자는 `expo-updates`가 이미 싣는 `EAS-Client-ID`다** — 설치마다 앱 저장소에 만드는 난수
  UUID(`expo-eas-client`). 회원·이메일·광고 식별자와 무관하고, **저장하지 않는다**(판정은 요청 안에서
  끝난다).

  ```text
  앱 재시작 · 로그아웃 · 계정 전환   유지된다
  앱 삭제 후 재설치                  바뀐다 — 새 칸을 받는다
  ```

- 식별자가 없는 요청은 부분 롤아웃에 들지 않는다(100%는 받는다).
- **비율은 줄지 않는다.** 이미 받은 설치를 되돌리지 못하므로, 줄이는 것의 효과는 새 설치 일부를
  막는 것뿐이고 그 의도는 `pause`가 정확히 말한다.
- **운영 릴리스는 비율을 적지 않으면 draft로 등록된다.** 넓게 내보내는 것은 언제나 사람이 숫자를
  적는 행위다.

## 상태와 되돌림 — 클라이언트가 할 수 있는 것만 약속한다

```text
draft        등록됐고 아무에게도 가지 않는다
active       롤아웃 비율만큼 간다
paused       새로 묻는 설치가 받지 않는다 — 이미 받은 설치는 그대로다(되살릴 수 있다)
rolled_back  다시는 선택되지 않는다(종착)
```

**이미 받은 설치를 움직이는 상태는 없다.** 클라이언트는 실행 중인 것보다 **새로운** 응답만 받으므로,
나쁜 B를 받은 설치를 돌려놓는 방법은 A를 다시 켜는 것이 아니라 **B보다 새로운 서명된 응답**이다.
그래서 되돌림은 서버 조작이 아니라 발행 환경의 조작이다:

```text
1  B → rolled_back                       서명 없이 곧바로 — 새로 묻는 설치는 받지 않는다
2a 이전 좋은 OTA A가 있으면  A의 코드를 새 id·새 시각으로 다시 서명(재발행 A′, 자산 업로드 없음)
2b 없으면                   rollBackToEmbedded 지시를 서명 — 스토어 바이너리의 번들로
3  100%로 등록
```

- B를 받은 설치는 **다음 콜드 스타트에** A′(또는 지시)를 받고, **그다음 콜드 스타트에** 그것을
  실행한다. 실행 중인 앱을 바꾸지 않는다.
- 실행 직후 죽는 B는 `expo-updates`의 오류 복구가 이전 업데이트로 먼저 되돌린다. 그 밖의 결함(화면
  하나가 틀렸다)은 위 절차만 고친다.
- B보다 새로운 활성 릴리스가 있으면 되돌림을 거절한다 — 클라이언트는 이미 그것을 받고, 재발행은
  그것까지 덮어 버린다.
- **스토어 바이너리의 번들이 언제나 회복의 바닥이다.** 업데이트 서버가 죽어도, 모든 OTA가 나빠도
  앱은 뜬다. `useEmbeddedUpdate`를 끄지 않는다.

## 자산 저장소

```text
mobile-updates/assets/sha256/<hex>                         자산 하나. 여러 릴리스가 나눠 쓴다
mobile-updates/releases/<channel>/<platform>/<id>.json      서명된 묶음의 보관본
```

- **주소가 해시다.** 같은 주소의 바이트는 영원히 같다 — 쓰기는 "없으면 쓴다"(`If-None-Match: *`)이고,
  이미 있으면 그 바이트를 내려받아 해시를 견준 뒤 다르면 멈춘다. 등록도 자산 주소의 마지막 토막이
  manifest의 해시인지 본다.
- 응답 캐시는 `public, max-age=31536000, immutable`이다(객체 메타데이터로 싣는다).
- **회원 미디어 포트를 쓰지 않는다.** 그쪽은 소유자·교체·탈퇴 정리가 있고 바이트를 API가 흘린다.
  이쪽은 소유자가 없고, 지워지지 않으며, API가 한 바이트도 흘리지 않는다.
- API는 자산을 흘리지 않는다 — manifest(수 KB)만 내보낸다.
- 압축: 규격은 gzip/brotli를 권한다(SHOULD). 저장소는 원본을 두고, 압축은 CDN 앞단의 몫이다 — CDN이
  `Accept-Encoding`에 따라 압축하도록 설정한다(`OPERATIONS.md`).

### 가비지 수집 — 지금은 세기만 한다

`gc-report`가 도달성을 센다: draft·active·paused 릴리스가 가리키는 자산(지우면 안 된다)과 되돌린
릴리스**만** 가리키는 자산(후보). 지우는 명령은 없다 — 되돌리기 직전에 manifest를 받은 설치가 그
자산을 아직 내려받는 중일 수 있고, 그 창이 닫혔다는 것을 서버가 관찰하지 못한다. 스토어 바이너리의
번들은 이 저장소를 가리키지 않는다.

## 업데이트 노트 · `app_update` 와의 관계

이 저장소에서 "업데이트"라는 낱말을 쓰는 것이 **셋**이고, 섞지 않는다.

```text
OTA 릴리스     호환되는 JS·자산의 배포            이 문서 · mobile_update_release
업데이트 노트   무엇이 바뀌었는가(사람이 쓴 글)     packages/domain/src/update-notes/ — 저장소가 소유
app_update     최소 지원 네이티브 판이 올랐다      ops_app_version_floor · 알림 평면
```

- **업데이트 노트는 JS 번들에 실려 있다** — 그래서 OTA 하나가 새 노트를 기기에 데려온다. 발행 도구는
  운영 릴리스에 어느 노트가 해당하는지 묻고(`--note <날짜>` 또는 `--no-note`) 그 노트가 생성된
  레지스트리에 있는지 **읽기만** 한다. OTA 메타데이터는 노트의 두 번째 원본이 되지 않는다.
- **OTA 발행은 `app_update`를 보내지 않는다.** 그 알림은 "이 바이너리는 더 이상 지원되지 않는다"이고,
  OTA는 정의상 지원되는 바이너리에게 가는 것이다. 정적 검사가 발행 도구와 서버 쪽 OTA 코드에서 알림
  어휘를 막는다.
- 새 런타임 세대가 스토어에 나가고 옛 바이너리를 끊기로 하는 날, 그때 쓰는 것이 `app_update`다(하한을
  올리는 기존 절차) — OTA 체계는 그 판정을 하지 않는다.

## 운영 제어면 — 의도는 콘솔이, 코드는 CI가

SSH 없이 운영 콘솔(`apps/admin`의 `/mobile-updates`)에서 릴리스를 읽고, 비율을 올리고, 멈추고, 새 발행과
서명된 되돌림을 **요청**한다. 서명 권한의 자리는 한 칸도 움직이지 않았다.

```text
운영 콘솔(브라우저)   의도              릴리스 · 이력 · 계획을 읽는다 · 전이를 누른다 · 작업을 요청한다
API                  인가 · 안전한 전이 · 작업 조율
                     ├─ 비율 · 중지 · 재개   같은 전이 표(transitionRelease) + 세션의 운영자 + 감사 한 줄
                     └─ 발행 · 되돌림        mobile_update_job 행 + CI 워크플로 시작(Actions 쓰기 토큰 하나)
CI(발행 환경)         코드              체크아웃 · 소스 확인 · 설치 · pnpm mobile:update publish|rollback
                                        (내보내기 · 자산 · **서명** · 등록) · OIDC 보고
OTA 전달 평면         선택              GET /manifest · CDN 자산 · expo-updates
```

```text
운영 콘솔 브라우저   서명 키 없음
RowCat API          서명 키 없음 — Actions 쓰기 토큰(워크플로를 시작하는 권한)만
Postgres · CDN      서명 키 없음
CI 환경 ota-<채널>   그 채널의 개인 키 — 발행 단계의 env에만
```

### 왜 콘솔도 API도 서명하지 않는가

OTA는 원격 코드 실행이고, 서명할 권한이 있는 자리가 곧 코드를 만들 수 있는 자리다. 콘솔이나 API에 키를
두면 세션 하나(또는 API 프로세스 하나)가 뚫리는 것으로 모든 설치에 새 코드를 낼 수 있다. 지금 API가 뚫리면
할 수 있는 것은 **허용된 브랜치에 이미 있는 코드로 발행 도구를 다시 돌리는 것**이다 — CI가 소스 커밋이
`main`의 조상인지 확인하고, 운영 채널은 draft로만 등록되며, 그 결과는 기존 등록 경로가 서명을 다시 검증한다.

### 전이와 발행은 다른 문이다

- **비율 · 중지 · 재개는 API가 직접 한다.** 서명 키가 필요 없고, 이미 서명된 릴리스의 퍼짐만 움직이며, 표가
  줄이기(`rollout_decrease`)와 되살리기를 막는다. CLI와 **같은 함수**를 부르고, 이력 줄에 `operator_id`
  (세션의 회원)를, `admin_audit_log`에 그 이력 줄의 id를 가리키는 한 줄을 **같은 트랜잭션**에 남긴다. 감사
  줄은 전이의 값을 다시 적지 않는다 — 두 이력이 서로 다른 값을 말할 수 없다. CLI·CI의 전이는 `actor`만
  있고 `operator_id`가 없다.
- **발행과 되돌림은 요청이다.** `mobile_update_job` 행이 의도(채널 · 플랫폼 · 소스 · 처음 비율 · 노트 · 사유)를
  적고, API가 `mobile-ota.yml`(포크가 [본보기](./example-workflows.md)에서 옮겨 둔다)을 시작한다. 그 워크플로가 하는 일은 사람이 셸에서 하던 일 그대로다 — 두 번째
  발행 구현이 없다. 브라우저가 고를 칸에 런타임 세대 · API 오리진 · manifest · 자산 주소 · 서명이 **없다**
  (계약이 `.strict()`, 정적 검사가 콘솔에서 그 어휘를 막는다).
- **작업은 릴리스가 아니다.** 실패한 발행은 작업 행이고, 선택 질의가 훑는 릴리스 표에 들어오지 않는다.

### 운영 발행은 두 단계다

```text
콘솔: 새 OTA 릴리스(production · iOS · main) ─▶ CI: 내보내기 · 서명 · 등록 ─▶ draft 0%
콘솔: 그 릴리스를 확인 ─▶ 5% · 10% · 25% · 50% · 100%로 확대(되돌릴 수 없는 각 단계마다 확인 창)
```

운영 채널의 처음 비율은 draft 하나다(계약 · 서비스 · 워크플로가 각각 거절한다). preview·TestFlight는
draft · 5 · 10 · 100 중에서 고른다.

### 비율 · 중지 · 되돌림 — 무엇이 누구를 움직이는가

```text
비율 올리기   새로 묻는 설치가 더해진다. 줄지 않는다 — 콘솔에 줄이는 칸이 없다
중지          새로 묻는 설치가 받지 않는다. 이미 받은 기기는 그대로다(되살릴 수 있다)
되돌리기      이미 받은 기기까지 — 더 새로운 서명된 응답(재발행 또는 rollBackToEmbedded)을 CI가 만든다
```

콘솔의 되돌림 요청은 릴리스를 **먼저 `rolled_back`으로 적지 않는다.** 그 순서(1 표시 → 2 서명 → 3 등록)는
CI의 발행 도구가 갖고, CI를 시작하지 못하면 요청은 502이고 아무것도 바뀌지 않았다 — 화면은 "되돌림이
시작되지 않았다"를 그리고, 지금 퍼짐을 멈추는 조작은 중지다. 확인 창은 서버의 되돌림 계획을 먼저 그리고,
더 새로운 활성 릴리스가 있으면 확인 버튼이 잠긴다(서버도 409로 거절한다).

### CI의 보고 — 오케스트레이션 상태이지 서명 권한이 아니다

```text
started     소스 커밋 · 런타임 세대 — 응답 proceed=false면 CI는 설치 전에 멈춘다(취소·실패한 작업)
succeeded   결과 릴리스 id — API가 등록 표에서 채널 · 플랫폼 · 커밋 · 런타임 · 등록 시각을 다시 본다
failed      멈춘 단계(닫힌 어휘) — 사유 문장은 API가 고른다. CI 로그는 실행 링크 뒤에 있다
```

- 인증은 GitHub Actions의 **OIDC 토큰**이다. `aud`는 그 배포의 보고 주소, `repository`, `workflow_ref`
  (`mobile-ota.yml@refs/heads/main`), `event_name`(`workflow_dispatch`)을 대조하고, `environment`가 작업의
  채널(`ota-<채널>`)과 같아야 하며, 첫 보고가 실행 id를 작업에 묶는다. 공유 비밀을 워크플로 입력으로 넘기지
  않는 이유: 입력은 실행 화면에 남고, 어느 실행이 보냈는지를 말하지 못한다.
- 보고는 멱등이다. 같은 결과를 두 번 보내면 아무것도 바뀌지 않는다.
- **유실된 보고는 재조정이 찾는다**(`mobile-updates.reconcile-jobs`, 5분). 실행이 없는 채 30분이 지나면
  `ci_never_started`, 실행이 보고 없이 끝났으면 `ci_result_missing`·`ci_run_failed`·`ci_run_cancelled`.
  결과를 지어내지 않는다 — "그 스트림의 최신 릴리스가 결과일 것"은 추측이다. 스트림마다 살아 있는 작업은
  하나라서(부분 유일 인덱스) 재조정이 없는 배포는 보고 하나를 잃는 순간 그 채널의 발행이 막힌다 — 그래서
  CI 연결을 켠 프로덕션 배포는 주기 작업 없이 뜨지 못한다.

### 권한

```text
read      staff · admin   릴리스 · 이력 · 되돌림 계획 · 작업
operate   admin           비율 · 중지 · 재개
publish   admin           발행 요청 · 되돌림 요청 · 작업 취소
```

표는 `@rowcat/domain`의 `MOBILE_UPDATE_CAPABILITY_ROLES` 하나이고, 서버 게이트(`requireMobileUpdateCapability`)
와 콘솔의 버튼이 같은 표를 읽는다. 별도의 ACL 저장소가 없다 — 권한은 여전히 `member.role` 하나다. 정지된
운영자는 아무 능력도 없다.

### CI 시작 토큰의 범위

`OTA_CI_GITHUB_TOKEN`은 **이 저장소 하나의 `Actions: read and write`**만 가진 fine-grained 토큰(또는 GitHub App
설치 토큰)이다. 그 권한으로는 워크플로를 시작·조회할 수 있을 뿐 코드를 쓰거나 비밀을 읽을 수 없다.
GitHub의 토큰 범위는 워크플로 단위가 아니라서 그 토큰은 이 저장소의 **다른** `workflow_dispatch` 워크플로도
시작할 수 있다 — 그 위험을 닫는 것은 환경 보호다: 서명 키는 `ota-<채널>` 환경에만 있고, 그 환경은 `main`
브랜치에서만 열리게 둔다(배포 브랜치 규칙). 원하면 `ota-production`에 필수 검토자를 걸어 사람의 승인을 한
겹 더 얹는다.

### 콘솔이 없을 때 · CI가 없을 때

- **CI가 없다(GitHub 장애 · 토큰 만료).** 발행·되돌림 요청은 502이고 작업이 `ci_trigger_unavailable`로
  남는다. 퍼짐을 멈추는 것은 콘솔의 **중지**로 된다(서명 키 불필요). 이미 받은 기기까지 돌려놓아야 하면 키가
  있는 자리에서 CLI로 되돌린다(`OPERATIONS.md`).
- **콘솔이 없다(배포 장애 · 운영자 세션 문제).** CLI가 그대로 비상구다 — `pnpm mobile:update pause|rollback`,
  또는 운영 컨테이너 안의 `node dist/services/mobile-updates/cli.mjs pause`. CLI는 지워지지 않는다: 콘솔이 평상시의
  면이고, CLI가 사고 대응의 면이다.

## 이 체계가 하지 않는 것

- 네이티브 코드·네이티브 모듈·바이너리를 바꾸지 않는다(그건 스토어 릴리스다).
- 운영 콘솔에서 코드를 올리거나 manifest·자산 주소·런타임을 고치지 않는다 — 발행은 CI 조작이다.
- 앱이 업데이트를 받자마자 다시 뜨지 않는다. `reloadAsync()`를 부르는 자리가 없다.
- 차분 패치(bsdiff · `226 IM Used`)를 만들지 않는다(`enableBsdiffPatchSupport: false`).
- 업데이트 서버의 실패로 앱을 막지 않는다.

## 아직 검증되지 않은 것

- **안드로이드 실기기·에뮬레이터에서 이 서버로 OTA를 받은 적이 없다.** iOS 시뮬레이터 Release
  빌드에서는 실제 `expo-updates`가 이 서버의 응답을 받아 서명을 검증하고(`isVerified`), 다음 콜드
  스타트에 실행하고, 변조된 manifest를 거절하고(`Code signing incorrect signature`), 재발행으로 되돌아가고,
  서버가 내려가도 뜨는 것을 확인했다 — 범위는 `OPERATIONS.md`의 「검증 기록」에 있다.
- **운영 CDN·버킷이 아직 없다.** S3 호환 어댑터는 조건부 쓰기와 캐시 머리를 가짜 전송으로 검증했고,
  실제 R2/S3에 쓴 적은 없다.
- **서명 키가 아직 없다.** 세 채널의 인증서가 커밋되기 전까지 그 채널의 EAS 빌드는 멈춘다
  (의도한 실패다 — `OPERATIONS.md`의 「처음 한 번」).
