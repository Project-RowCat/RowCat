# 암호화 동기화(Sync) — 아키텍처 설계

> 상태: **설계 확정. 슬라이스 1a·1b·2·SSE 깨우기·기기 페어링 구현됨(2026-08-20).
> DEK 회전 이후는 미구현.**
>
> 1a는 동기화 없이 로컬 모델만 맞추는 선행 작업이었다(`Rev` 계약, 순수 HLC, 대화의 소프트
> 삭제, `dirty: 0|1`, 초안의 그룹 리비전, Dexie v3).
>
> **1b가 수직 절단을 끝냈다.** 로컬 → 코덱 → 압축 → AES-256-GCM → SDK → Hono → 불투명
> PostgreSQL → pull → 복호화 → 병합 → 로컬이 실제로 돈다. 계약·암호·키링·코덱·엔진·컨트롤러·
> 서버 테이블·`/v2/me/sync/*`·SDK·Dexie 어댑터·계정 UI·수동 동기화가 전부 들어갔고, 두 기기
> 왕복을 진짜 Postgres로 확인했다. 실제 파일 목록은 §35.2가 그대로 맞다.
>
> **슬라이스 2가 자동 동기화를 얹었다.** 프로토콜은 한 글자도 바뀌지 않았다 — 레코드 타입도,
> payload 스키마도, 봉투 버전도, 병합 규칙도, 서버 엔드포인트도 그대로다. 더해진 것은
> **언제 도는가** 하나이고, 그 판정은 `packages/sync/src/auto-sync.ts`(순수)와
> `apps/web/src/lib/local-sync/auto-sync.ts`(브라우저 신호)로 나뉘어 있다. 실제 파일 목록은
> §35.2b다.
>
> **SSE 깨우기가 지연을 줄였다.** 프로토콜은 여전히 한 글자도 바뀌지 않았다 — 레코드
> 타입도, payload 스키마도, 봉투 버전도, 병합 규칙도, 키링도, Dexie 판도, Postgres 스키마도
> 그대로다. 늘어난 것은 **알림 평면** 하나다: `GET /v2/me/sync/events`가 커밋된 소유자 커서를
> 흘리고, 웹 어댑터가 그것을 `requestSync("remote-wake")` 한 줄로 자동 동기화에 넘긴다.
> 복제는 여전히 `/v2/me/sync/records`가 전부 한다. 실제 파일 목록은 §35.2c다.
>
> **기기 페어링이 복구 코드 없는 새 기기 경로를 열었다.** 프로토콜은 또 한 번 그대로다 —
> 레코드 타입도, payload 스키마도, 레코드 봉투 버전도, 병합 규칙도, 키링도, Dexie 판도
> 그대로이고 `SYNC_PROTOCOL_VERSION`도 오르지 않았다. 늘어난 것은 **만료되는 중계** 하나다:
> 테이블 `sync_pairing`과 엔드포인트 넷(`POST /pairing` · `POST /pairing/status` ·
> `POST /pairing/approve` · `DELETE /pairing`). 서버는 그 중계에서 코드도, DEK도, 개인키도,
> 봉투의 내용도 배우지 못한다. 실제 설계는 §13이고 파일 목록은 §35.2d다.
>
> **미구현(의도적)**: 모바일 SQLite, 에셋 blob, 묘비 GC,
> DEK 회전, 원격 기기 취소(§29.5 — 페어링과 **다른 슬라이스**다).
>
> 1a를 구현하며 이 문서의 세 군데를 고쳤고(§19.1 · §21.1 · §35.1), 1b가 네 군데를 더
> 고쳤다(§16.3 · §19.3 · §19.4 · §22). 슬라이스 2는 §26 한 군데를 고쳤다(포그라운드 60초
> 타이머를 넣지 않았다) — 근거는 각 절의 정정 상자에 있다.
> 조사 대상: 레거시 `~/Desktop/Workspace/nextjs/RowCat`(전체 sync 경로) + 현재 기준선.
> 절 제목은 영어 그대로 둔다 — 다음 구현 과제의 프롬프트가 번호로 이 문서를 참조한다.

---

## 0. 읽는 법

절 번호는 요구된 산출물 구조 1–35와 **1:1로 맞춘다.** 그 골격에 없지만 조사 과정에서
결정이 필요했던 주제는 인접 절에 `b`를 붙여 둔다(§14b XSS, §24b 전체 재동기화,
§26b 파생 부모 갱신, §27b 레코드 단위).

본문에서 `§N`은 **이 문서의 절**이고, `조사 §N`은 조사 요청서의 항목 번호다.

| 산출물 절 | 이 문서 |
| --- | --- |
| 1–14 | 그대로 |
| 15 Server Schema · 16 Server API | §15 · §16 |
| 17–24 | 그대로 |
| 25 Multi-tab · 26 Auto-sync · 27 Cross-platform | §25 · §26 · §27 |
| 28 Assets Extension | §28 (참조 무결성과 함께) |
| 29–35 | 그대로 |
| 필수 다이어그램 | 부록 A |
| 최종 권고 | 부록 B |

---

## 1. Executive Recommendation

우리 동기화는 **레코드 단위 봉투 암호화 + 서버는 불투명 blob 저장소**다. 레거시의
암호 설계는 거의 그대로 살리고, 레거시가 로컬 정수 id 때문에 짊어졌던 부채와 시계 기반
충돌 판정, 커서 원자성 결함을 버린다.

한 페이지 요약:

| 축 | 결정 |
| --- | --- |
| 소유권 | `member.id` = `Viewer.id`. 요청 세션에서만 나온다. 클라이언트가 말할 수 없다 |
| 레코드 신원 | **로컬 `id`가 곧 동기화 id**. `syncId` 별도 필드 없음. 서버 PK = `(owner, id)` |
| 레코드 타입 | 네임스페이스 문자열(`chat.room`, `authoring.draft` …). 형식만 검증하는 열린 어휘 |
| 암호 | AES-256-GCM(DEK), HKDF-SHA256, HMAC-SHA256 소지증명, x25519 페어링 — 레거시와 동일 |
| AAD | `rowcat.sync.rec.v1\0owner\0id\0type\0envelopeVersion`. `version`은 넣지 않는다 |
| 봉투 | `{v, iv, ct}` — 레거시에 없던 **명시적 봉투 버전**을 추가 |
| 커서 | **회원별** 단조 시퀀스(`sync_state.seq`), push 트랜잭션 안에서 발급. 전역 카운터 폐기 |
| 로그 | append-only 변경 로그를 두지 않는다. 현재 행이 최신 seq를 기억한다(레거시와 동일) |
| push | 배치 원자적 + `baseVersion` 낙관적 동시성 + **Idempotency-Key**(레거시 계승) |
| 충돌 순서 | 벽시계 LWW 폐기. **HLC(Hybrid Logical Clock) `rev` 스탬프**가 전순서를 만든다 |
| 충돌 규칙 | 타입별로 다르다. 메시지=완결 우선, 방=불변 필드 보호, 초안=**필드 그룹 병합** |
| 삭제 | **소프트 삭제 일원화**. 별도 묘비 테이블 없음. 삭제가 편집을 항상 이긴다 |
| 대화 삭제 | **현재 없다.** 동기화 전에 만들어야 하는 선행 모델 변경(§23) |
| 원자성 | **커서 전진은 그 페이지의 적용과 같은 트랜잭션**. 레거시 최대 결함의 수정 |
| 아웃박스 | 두지 않는다. 인라인 `dirty`로 충분하되 **인덱스 가능한 0/1로 바꾼다** |
| 패키지 | `@rowcat/sync`(순수) + 도메인별 코덱(옵션 B). `contracts`가 와이어를 갖는다 |
| 서버 경로 | `/v2/me/sync/*` |
| 레거시 이관 | **하지 않는다.** 데이터 모델도 암호 포맷도 호환을 만들지 않는다 |
| 첫 슬라이스 | 선행 로컬 모델 변경 → 수동 동기화 왕복(웹 2기기) + 복구 코드 언락 |

핵심 문장 하나로: **레거시의 암호는 옳았고, 레거시의 신원·시계·트랜잭션 경계가 틀렸다.**

---

## 2. Legacy Architecture Map

경로는 전부 `~/Desktop/Workspace/nextjs/RowCat` 기준이다.

### 2.1 데이터 복제 경로

```text
로컬 행(Dexie / expo-sqlite)
  │  packages/lib/src/data/local/sync-store/serialize.ts      (web)
  │  apps/mobile/src/lib/db/sync/serialize.ts                 (mobile)
  │  ↳ packages/lib/src/sync/canonical.ts                     (공용 의미 매핑)
  ▼
payload (평문 JSON, FK는 전부 sync_id)                        packages/lib/src/sync/payload.ts
  │  encodeRecordPlaintext: [codec byte][raw DEFLATE?]        packages/lib/src/sync/codec.ts
  ▼
encryptRecord(dek, {owner, sync_id, type}, payload)           packages/lib/src/sync/crypto.ts
  │  AES-256-GCM, AAD = owner\0sync_id\0type\0protocolVersion
  ▼
EncryptedBlob {iv, ct} → JSON.stringify → PushItem.ciphertext packages/lib/src/sync/wire.ts
  │  engine.push(): 개수(500)·바이트(7MB) 이중 청킹                packages/lib/src/sync/engine.ts
  ▼
POST /api/sync  (Idempotency-Key, X-Sync-Origin)              apps/web/app/api/sync/route.ts
  │  pushSyncRecords(): 전건 base_version 검증 → 전부 적용 또는 전부 거부
  ▼
sync_record (owner, sync_id) — 불투명 ciphertext              packages/lib/src/db/tables/sync.ts
  │  server_seq = 전역 단일행 카운터 sync_seq(id=1) update-then-read
  ▼
notifySync(owner, origin) → Redis pub/sub + 로컬 디스패치      packages/lib/src/server/sync-notify.ts
  ▼
GET /api/sync/stream (SSE "bump")                             apps/web/app/api/sync/stream/route.ts
  ▼
다른 기기: GET /api/sync?since=<seq>&limit=500                 → PullResponse
  │  engine.pull(): decryptRecord → validateSyncPayload → applyInbound → setCursor
  ▼
SyncStore.applyInbound (위상정렬 → FK 리매핑 → LWW → 묘비)      sync-store/index.ts, apply.ts
```

### 2.2 키링 설정 / 복구 언락 / 기기 기억

```text
setup (첫 기기)            controller.setup()               packages/lib/src/sync/controller.ts
  createKeyring(owner)  →  DEK = randomBytes(32)            crypto.ts
                           recovery = randomBytes(16) → "RCAT-XXXX-…"(Crockford b32+checksum)
                           key = HKDF-SHA256(recovery, salt16, "rowcat-sync-recovery-v1", 32)
                           wrapped = AES-GCM(key, DEK, AAD="rowcat.sync-key.v2\0owner\0recovery")
  authKey = HKDF-SHA256(DEK, salt=owner, "rowcat-sync-auth-v1", 32)
  POST /api/sync/keys/setup {keyring, auth_key}   → onConflictDoNothing, 이미 있으면 409
  deviceKey.remember(DEK)                          (첫 기기 자동 신뢰)
  initialPush(all=true)                            (dirty 무시 전체 스캔)

unlock (새 기기)           controller.unlockRecovery(code)
  GET /api/sync/keys → keyring → unlockWithRecovery → deviceKey.remember(DEK)

remembered (재방문)        controller.tryAutoUnlock()
  web:    non-extractable AES-GCM CryptoKey가 DEK를 감싸 회원별 IndexedDB(sync_device)에
          apps/web/app/(app)/_sync/device-key.ts
  mobile: expo-secure-store, 키 이름 = "rowcat.sync.dek." + FNV(owner)
          apps/mobile/src/lib/db/sync/device-key.ts
  이후 verifyUnlock(): proveKeyringRewrap(authKey, keyringJson) → POST /api/sync/keys/verify
          403이면 캐시 폐기 + 잠금(교차계정/stale 안전망), 그 외는 fail-open

rotate recovery            controller.rotateRecoveryCode()
  DEK 불변, wrapped만 재래핑 → proof = HMAC-SHA256(authKey, 새 keyring 문자열)
  POST /api/sync/keys/rewrap  → replaceKeyring()이 상수시간 비교로 검증
```

### 2.3 기기 페어링(x25519 relay)

```text
새 기기 N                       서버(불투명 relay)                기존 기기 E
──────────                      ─────────────────                ──────────
keypair(N)                                                       (DEK 언락 상태)
code = base32(random 5B) "XXXX-XXXX"
POST /pair/start {code, N_pub} → sync_pairing(owner, code) TTL 5분
                                 GET /pair?code           ←──── 사용자가 코드 입력
                                 → {new_pub}
                                                                 eph = x25519 keypair
                                                                 shared = ECDH(eph, N_pub)
                                                                 K = HKDF(shared,
                                                                       salt=owner\0code,
                                                                       "rowcat-sync-pairing-v1")
                                                                 ct = AES-GCM(K, DEK,
                                                                       AAD="rowcat.sync-pair.v1\0owner\0code")
                                 POST /pair/approve       ←──── {eph_pub, iv, ct}
GET /pair?code (폴링) ────────→ {payload}
ECDH(N_priv, eph_pub) → 같은 K → DEK
deviceKey.remember(DEK)
```
`packages/lib/src/sync/pairing.ts`, `db/service/sync.ts`(`startPairing`/`getPairing`/`approvePairing`).

### 2.4 자동 동기화

`packages/lib/src/sync/auto-sync.ts`(순수 오케스트레이터) + `apps/web/app/(app)/_sync/auto-sync.ts`(웹 배선).
트리거: 로컬 쓰기(디바운스 1s) · `visibilitychange`/`focus` · SSE bump(합치기 창 500ms) ·
포그라운드 60s 폴링(SSE 안전망). 동시성은 `inFlight` + `queued` 1회 합산.

---

## 3. Legacy Invariants Worth Preserving

실제 보안·정확성 속성이라 반드시 계승한다.

1. **서버는 평문을 절대 모른다.** ciphertext는 라우트·서비스·DB 어디서도 해석되지 않는다.
2. **키링 setup은 first-writer-only.** `onConflictDoNothing` → 409. overwrite를 허용하면
   기존 전 기기의 데이터가 영구히 복호화 불가가 된다.
3. **키링 교체는 현재 키 소지 증명을 요구한다.** `authKey = HKDF(DEK, owner)`는 단방향이고
   서버는 그 값을 저장만 하되 **어떤 쿼리로도 돌려주지 않는다**. 세션만 탈취한 공격자는
   새 키링에 대한 유효한 MAC을 만들 수 없다. 검증은 상수시간이고 fail-closed다.
4. **레코드 AAD가 owner·id·type을 묶는다.** 다른 계정으로, 다른 id로, 다른 타입으로
   ciphertext를 옮겨 심으면 복호화가 실패한다. 레거시 테스트가 이 셋을 각각 검증한다
   (`crypto.test.ts`).
5. **페어링은 채널 바인딩된다.** 코드가 HKDF salt이자 AEAD AAD라, 코드가 틀리면 서버가
   중계에 성공해도 복호화가 실패한다. 서버는 relay일 뿐이다.
6. **복구 코드는 고엔트로피 랜덤이다.** 사용자가 정하는 암호가 아니므로 메모리하드 KDF가
   불필요하고, HKDF로 충분하다(1Password Secret Key 방식). 이건 편의가 아니라 근거 있는 선택이다.
7. **push 배치 안의 sync_id 중복은 거부한다.** 와이어와 서비스 양쪽에서 fail-closed로.
   중복은 seq를 중복 소비하고 마지막만 남겨 상태를 깨뜨린다.
8. **push 재시도는 멱등이다.** `Idempotency-Key` + `request_hash` + 캐시된 응답.
9. **복호화 성공 ≠ 적용 가능.** AEAD는 무결성만 보장한다. 같은 계정의 버그·구버전 클라가
   올린 잘못된 모양은 **적용 직전 스키마 검증**으로 떨군다(`validateSyncPayload`).
10. **markPushed는 수집 시점 리비전과 대조한다.** push가 나가 있는 동안 같은 행이 다시
    수정됐으면 `dirty`를 내리지 않는다. 안 그러면 그 수정분이 영원히 올라가지 않는다.
11. **평문·DEK·복구코드·ciphertext를 로그에 찍지 않는다.** 정적 스캔 회귀 테스트가 지킨다
    (`__tests__/no-plaintext-logging.test.ts`).
12. **DEK 기기 캐시는 회원별로 스코핑된다.** 레거시는 회원 무관 단일 저장소에서 시작해
    교차계정 언락 버그를 실제로 겪었고, 두 플랫폼 모두 레거시 키를 정리하는 코드가 남아 있다.
13. **자기 push의 알림은 자기에게 돌아오지 않는다.** `X-Sync-Origin`은 인가와 무관한
    프로세스 임의값이고 저장되지 않는다 — 방금 올린 것을 되받아 재적용하는 왕복을 없앤다.

## 4. Legacy Debt to Discard

근거가 있는 것만 적는다.

1. **로컬 정수 id + `sync_id` 이중 신원.**
   근거: `sync-store/tables.ts`의 `syncIdById`/`localIdBySyncId`, `apply.ts`의
   `applyRoom`/`applyPreset`/`applyChildWithRoom` 전부가 매 레코드마다 FK를 왕복 변환한다.
   그 변환이 실패하는 경로가 곧 "부모 미존재 격리 큐"(`reconcilePending`, 최대 1000건,
   시도 50회 후 폐기)라는 별도 서브시스템을 낳았다. 여기서는 로컬 PK가 이미 UUID다 —
   물려받을 이유가 없다.
2. **벽시계 LWW.**
   근거: `merge.ts`의 `incomingWins`는 `updatedAt`을 ms로 정규화해 비교한다. 파일 헤더가
   자백하듯 web은 ISO 문자열, mobile은 epoch ms로 비교하다 두 기기가 **영구히 다른 승자를
   확정하는** 버그를 겪었다. 정규화로 표현 차이는 고쳤지만 **시계 자체의 신뢰 문제는 그대로**다.
   조사 §35에서 구체적 실패 모드를 든다.
3. **전역 단일행 시퀀스(`sync_seq` id=1).**
   근거: `pushSyncRecords`가 모든 owner의 모든 push에서 같은 행을 update한다. 전 사용자
   쓰기의 직렬화 지점이고, 커서 값이 전역 쓰기량을 반영해 무의미하게 커진다.
   (역설적으로 이 직렬화가 커밋 순서 역전을 막아 주고 있었다 — §17에서 다룬다.)
4. **커서 전진이 적용과 다른 트랜잭션.**
   근거: `engine.pull()`이 `store.applyInbound(...)` 다음 줄에서 `store.setCursor(...)`를
   부른다. 웹 스토어의 `setCursor`는 별도 Dexie 쓰기이고, **모바일 스토어는 아예
   트랜잭션을 쓰지 않는다**(`store.ts` 헤더가 "멱등이니 재적용하면 된다"고 적어 놓았다).
   중간 실패 시 실제로 재적용으로 수렴하지만, 커서만 먼저 쓰이는 순서가 코드로 금지되어
   있지는 않다 — 경계가 계약이 아니라 관습이다.
5. **부모 미존재 격리 큐(`sync_pending`)를 `app_settings` KV에 JSON으로.**
   근거: `apply.ts`의 `reconcilePending`. 1000건 상한과 50회 시도 상한이 있어 **정말로
   유실될 수 있는** 경로다. 여기서는 FK 리매핑이 없으므로 이 큐 자체가 필요 없다(§28).
6. **부모 블롭에 자식을 통째로 임베드하고 적용 시 전량 재구축.**
   근거: `rebuildRoomChildren`은 `room_character`·`lore_entries`·`start_scenes`·
   `scene_images`를 **전부 delete 후 재삽입**한다. 자식에 안정 신원이 없어 부분 병합이
   불가능하고, 방 필드 하나만 고쳐도 전체 자식이 다시 쓰인다.
7. **레거시 payload 어휘.** `room`/`preset`/`folder`/`persona`/`memory`/`asset`,
   `opt_key`·`bgm`·`gallery_origin`·`summarized_upto_id`·`owner_hash`·`rental`.
   여기서는 `Preset`(네 역할 겸업)을 의도적으로 없앴고 폴더·페르소나 보관함도 없다.
8. **모듈 싱글턴 컨트롤러.**
   근거: `apps/web/app/(app)/_sync/controller.ts`가 모듈 로드 시점에
   `createSyncController(...)`를 호출하고 `owner: getInviteId`(localStorage 조회)를 넘긴다.
   `LocalDataScope`/`activation.ts`가 막으려고 만들어진 계정 전환 경합을
   구조적으로 다시 열어 준다.
9. **`auth_key` nullable.** 레거시 호환을 위한 것이었고, `"no-proof"` 분기가 그 대가다.
   여기에는 레거시 키링이 없으므로 NOT NULL로 두고 분기 자체를 없앤다.
10. **`asset` 타입의 특례가 push 경로 전체에 스며 있다.**
    근거: `pushSyncRecords` 안의 `if (it.type === ASSET_TYPE) continue`(낙관적 동시성 제외),
    `markPushed`의 asset 스킵, `PULL_TOPO_ORDER` 제외, 별도 `collectAssets`.
    도메인 특례를 프로토콜 코어에 심은 결과다 — 여기서는 확장점으로만 남긴다(§28 Assets).
11. **`X-Sync-Origin`의 이중 전달 축**(push는 헤더, SSE는 쿼리). `EventSource`가 헤더를
    못 붙여서 생긴 우회다. 우리가 SSE를 도입한다면 같은 문제를 만나므로 미리 안다.

---

## 5. Threat Model

### 5.1 제로지식의 정의

서버가 **평문으로 알지 못하는 것**:

```text
대화 내용 · 메시지 본문 · 방 제목 · 재생 스냅샷(시나리오·캐릭터·로어·도입부)
초안 본문 · 캐릭터 프롬프트 · 로어 · 시작 장면 · 제안 페르소나
DEK · 복구 코드 · 페어링 개인키 · 페어링 공유 비밀
```

서버가 **불가피하게 아는 것**(메타데이터). 이 목록을 숨긴다고 주장하지 않는다:

```text
owner(회원 id)                레코드 id(불투명 UUID)
레코드 타입(chat.message 등)   ciphertext 바이트 길이
version · seq · updated_at     deleted 여부
소유자별 레코드 수 · 총 바이트  요청 시각 · 빈도 · IP · User-Agent
어떤 기기가 언제 켜졌는지(요청 타이밍)
```

여기서 실제로 새는 행동 정보가 있다. `chat.message` 타입 레코드가 분당 몇 건씩 들어오면
그 사용자가 지금 대화 중이라는 뜻이고, ciphertext 길이는 메시지 길이의 근사다.
`authoring.draft` 하나가 커지는 추이는 원고가 길어지는 추이다. **이것을 감추지 않는다.**

### 5.2 위협 행위자 매트릭스

| 위협 | 막는다 | 근거 / 남는 노출 |
| --- | --- | --- |
| 수동적 DB 유출(덤프·백업 절도) | ✅ | ciphertext + wrapped DEK만. DEK는 서버에 없다. 메타데이터는 노출 |
| 악의적 DB 읽기 권한자(DBA) | ✅ | 위와 동일 |
| 침해된 서버 애플리케이션 | ⚠️ 부분 | 저장된 것은 못 읽는다. 그러나 웹 앱 번들을 바꿔 클라이언트에서 DEK를 유출시킬 수 있다. **웹 E2E의 근본 한계**이고 부정하지 않는다 |
| 탈취된 인증 세션 | ⚠️ 부분 | 데이터는 못 읽는다(DEK 없음). 키링 **교체는 막는다**(소지증명). 그러나 ciphertext 삭제·quota 소진은 가능 |
| 탈취된 복구 코드 | ❌ | 전 데이터 복호화. 코드가 곧 계정이다. 회전으로 무효화(§12) |
| 잠금 해제된 브라우저 세션 탈취(기기 절도) | ❌ | remembered device면 즉시 열린다. 로컬 IndexedDB에 이미 평문이 있으므로 암호화와 무관 |
| RowCat origin의 XSS | ❌ | §14 참조. 로컬 평문을 직접 읽을 수 있으므로 동기화 유무와 무관 |
| 악의적 페어링 기기 | ❌ | 페어링을 승인하면 DEK를 준다. 승인은 사용자의 명시적 행동이고, 승인 후 취소는 **암호적으로 불가능**(§29) |
| 물리적 기기 분실 | ⚠️ | 그 기기의 로컬 데이터는 그대로. 원격 소거 없음. 계정 삭제로 서버 사본만 파기 |
| 오래된 ciphertext 재생(replay) | ✅ 탐지 | 서버가 예전 blob을 되돌려도 payload 안 `rev`가 로컬보다 오래됐으면 클라가 거부(§10). 레거시에는 이 방어가 없었다 |
| 교차계정 ciphertext 이식 | ✅ | AAD에 owner |
| 레코드 타입 바꿔치기 | ✅ | AAD에 type + 서버가 type 변경을 충돌로 거부 |
| 페어링 중계 변조 | ✅ | ECDH + 코드 채널 바인딩(HKDF salt + AAD). 서버가 payload를 바꾸면 복호화 실패 |
| 시계 조작 | ⚠️ 완화 | HLC가 인과 순서를 보존하고 드리프트를 흡수한다. 한 번도 교신하지 않은 기기의 극단적 미래 시각은 여전히 이길 수 있다(§35) |
| 트래픽 분석 | ❌ | 패딩 없음. §5.1에 명시 |
| 서버가 레코드를 조용히 삭제 | ❌ 탐지 불가 | 제로지식 구조의 대가. 무결성 증명(Merkle 등)은 이번 범위 밖 |

### 5.3 비목표(명시)

- 침해된 웹 클라이언트로부터의 보호. 코드를 배포하는 주체가 곧 우리다.
- 서버의 **삭제·검열**로부터의 보호. 기밀성만 보장하고 가용성·완전성은 보장하지 않는다.
- 메타데이터 프라이버시.
- 원격 기기 소거.
- 승인 후 페어링 취소.

---

## 6. Identity Model

```text
Better Auth user            인증 신원. 이메일·비밀번호·OAuth account.
      │                     제품 코드에 절대 들어오지 않는다.
      │ 1:1 (member.user_id UNIQUE, ON DELETE CASCADE)
      ▼
RowCat member  =  Viewer.id      ◀── 동기화 소유권은 **오직 이것**
      │                             (apps/api/src/db/tables/member.ts)
      │                             32자 hex, apps/api/src/lib/id.ts
      │
      ├── Auth Session(s)         Better Auth 쿠키. 여러 개. 로그아웃으로 사라진다.
      │                           세션 수명은 동기화 수명과 **무관**하다.
      │
      ├── LocalDataScope          rowcat_chat_<Viewer.id>  (IndexedDB / 미래 SQLite)
      │     └── LocalDataStores { chat, authoring, (sync) }   ← 인스턴스 신원이 소유권 토큰
      │
      └── Sync Device(s)          클라이언트가 만드는 제3의 신원.
            deviceId              32자 hex, 한 번 만들면 그 로컬 DB의 수명 동안 불변.
            wrapped DEK           web: non-extractable CryptoKey로 감싼 blob(같은 로컬 DB)
                                  mobile: expo-secure-store(Keychain/Keystore), owner별 키
```

세 신원을 갈라 두는 이유를 각각 한 줄로:

- **user.id를 쓰면** 구글 계정 연결을 해제·재연결하는 일이 "내 대화가 사라지는 일"이 된다.
- **session.id를 쓰면** 로그아웃이 곧 기기 폐기가 된다. 두 행동은 다르다(§29).
- **deviceId가 없으면** HLC의 타이브레이커가 없고, `rev` 동률에서 두 기기가 서로 다른
  승자를 확정한다.

`deviceId`의 실제 용도는 딱 두 가지다: **HLC 타이브레이커**와 **진단**. 서버는 이 값을
보지 않는다(v1에는 `sync_device` 테이블이 없다). payload 안에 `rev.d`로만 존재하므로
서버는 암호문 안의 기기 신원을 알 수 없다 — 의도한 것이다.

---

## 7. Record Taxonomy

v1에 동기화되는 타입은 여섯이다. **레거시 어휘를 쓰지 않는다.**

| 타입 문자열 | 로컬 레코드 | 부모 참조 | 대략 크기 | 성격 |
| --- | --- | --- | --- | --- |
| `chat.room` | `ChatRoom` | — | 2–100 KB(`seed` 때문) | 생성 후 메타만 변한다 |
| `chat.message` | `ChatMessage` | `roomId` | 0.1–40 KB | append-mostly, 완결 후 사실상 불변 |
| `authoring.draft` | `StoryDraft` | — | 1–50 KB | 잦은 부분 수정 |
| `authoring.character` | `DraftCharacter` | `draftId` | 0.5–20 KB | 잦은 부분 수정 |
| `authoring.lore` | `DraftLoreEntry` | `draftId` | 0.2–10 KB | 잦은 부분 수정 |
| `authoring.scene` | `DraftStartScene` | `draftId` | 0.2–20 KB | 잦은 부분 수정 |

동기화하지 않는 것(조사 §80): 발행된 `Story` 서버 행, 갤러리 캐시, 즐겨찾기·팔로우·차단,
`Viewer`, `AccountDetails`. 전부 서버 권위 API이고 TanStack Query가 캐시한다.
다만 `StoryDraft.publishedStoryId`는 **초안 payload 안에 들어간다** — 그것은 서버 상태의
사본이 아니라 "이 원고를 어느 작품으로 올렸는가"라는 **작성자의 로컬 작업 상태**이고,
다른 기기에서 그 초안을 열었을 때 '갱신 발행'이 가능하려면 반드시 따라가야 한다.

타입 문자열 규칙: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,2}$`, 최대 32자. 네임스페이스가
있어야 미래 도메인(`library.character`, `chat.memory`)이 충돌 없이 들어온다.

---

## 8. Record Identity

### 결정: 로컬 `id`가 곧 동기화 id다. `syncId` 필드를 두지 않는다.

```text
서버 PK        (owner, id)
로컬 PK        id
자식 → 부모     ChatMessage.roomId  === 부모 ChatRoom.id  === 그 부모의 동기화 id
               DraftCharacter.draftId 등도 동일
```

근거:

1. **레거시의 이중 신원은 로컬 PK가 자동증가 정수였기 때문에 생겼다.** 여기서는 이미
   `crypto.randomUUID()`를 PK로 쓴다(`lib/local-data/clock.ts`의 `newLocalId`).
   그 결정의 이유가 주석에 그대로 적혀 있다 — "미래의 동기화를 위해 처음부터 전역 안정 id".
2. **FK 리매핑이 통째로 사라진다.** 레거시 `apply.ts` 440줄의 절반, `tables.ts`의
   `syncIdById`/`localIdBySyncId`, 그리고 그 실패에서 파생된 `sync_pending` 격리 큐가
   전부 필요 없다. 이건 코드 감소가 아니라 **유실 경로의 제거**다(§4-5).
3. **충돌 가정.** UUIDv4는 122비트 랜덤이다. 한 회원의 레코드가 10⁶개일 때 내부 충돌
   확률은 10⁻²⁵ 수준이라 무시할 수 있다. 서로 다른 회원 사이의 충돌은 PK가
   `(owner, id)`라 애초에 문제가 되지 않는다.
4. **타입 네임스페이싱을 id에 넣지 않는다.** id는 이미 전역 유일하고, 타입은 별도 열이자
   AAD 성분이다. id에 접두사를 붙이면 로컬 PK와 동기화 id가 또 갈라진다.
5. **크로스 플랫폼 생성.** 웹은 `crypto.randomUUID()`, Expo/Hermes는 폴리필이 필요하다.
   `@rowcat/sync`가 `newRecordId()`를 노출하되 **레코드 생성은 여전히 도메인의
   `*Stamp` 주입 방식**을 그대로 쓴다(순수성 유지). 레거시 `newSyncId()`가 noble
   randomBytes로 UUIDv4를 직접 조립한 것과 같은 접근이다.

### id 형식과 서버 검증

- 우리 로컬 id: 하이픈 있는 UUIDv4 36자.
- 우리 서버 id(`newId()`): 하이픈 없는 32자 hex. **다른 계열이다.**
- 서버 동기화 검증 정규식: `^[A-Za-z0-9_-]{8,64}$`.
  하이픈 UUID·32자 hex·미래의 다른 형식을 모두 받되 거대 식별자로 인덱스를 부풀리는
  자기서비스 남용은 막는다. **UUID 형식으로 좁히지 않는 이유**는 레거시 데이터를
  클라이언트가 이관해 오는 경로(§30)에서 id를 재발급하지 않아도 되게 하기 위해서다.

### 이관 함의

지금 사용자 기기에 쌓인 레코드는 **이미 UUID PK를 갖고 있다.** id 관련 마이그레이션이
0이라는 뜻이고, 이것이 처음부터 UUID를 고른 값의 회수다.

---

## 9. Payload Schemas and Versioning

### 9.1 네 가지 버전 축을 분리한다

```text
① Sync protocol version     SYNC_PROTOCOL_VERSION = 1
   와이어 계약(PushRequest/PullResponse/Keyring)의 판.
   변경 시: /v2/me/sync/v2/* 를 나란히 열거나 요청에 명시한다.

② Encryption envelope version   EncryptedBlob.v = 1
   {v, iv, ct}의 판. 알고리즘·nonce 길이·AAD 조성이 바뀌면 올린다.
   AAD 안에도 들어가므로 봉투 버전 자체가 인증된다.

③ Domain payload schema version   payload.schemaVersion
   레코드 타입마다 독립. chat.room v1과 authoring.draft v3이 공존한다.
   기존 AUTHORING_SCHEMA_VERSION / CHAT_SEED_VERSION 축을 그대로 잇는다.

④ Server row version        sync_record.version
   낙관적 동시성 카운터. 스키마와 아무 관계 없다.
```

### 9.2 구버전 클라이언트의 판정 표

```text
알 수 없는 record type          → 무시하고 커서 전진. 절대 쓰지 않는다(§19).
알 수 없는 payload schema(더 큼) → 무시하고 커서 전진. 절대 쓰지 않는다.
알 수 없는 envelope version     → 무시하고 커서 전진. 절대 쓰지 않는다.
복호화 실패                     → 무시하고 커서 전진 + 진단 카운터.
스키마 파싱 실패(같은 버전)      → 무시하고 커서 전진(레거시와 동일 — 영구 무효).
알려진 타입·같거나 낮은 스키마    → 마이그레이션 후 적용.
```

**"무시"의 정확한 뜻**: 로컬에 아무것도 쓰지 않고, 그 id에 대한 dirty도 만들지 않고,
그 레코드에 대해 어떤 push도 발행하지 않는다. 커서는 전진한다 — 그래야 그 레코드
하나가 커서를 영원히 막지 않는다. 재시도해도 유효해지지 않는 종류의 실패이기 때문이다.

### 9.3 payload 모양

각 payload는 **로컬 레코드에서 신원·전송 메타를 뺀 나머지 + `rev`**다.

```text
공통 봉투 (@rowcat/contracts)
{
  schemaVersion: number
  rev: { t: number, c: number, d: string }   // HLC: ms, counter, deviceId
  deletedAt: string | null
  data: <타입별>
}
```

- `id`·`type`·`owner`는 **payload에 넣지 않는다.** 이미 AAD로 인증되고 있어 중복이며,
  중복된 값이 어긋나는 상태를 표현할 수 있게 된다.
- `serverVersion`·`dirty`는 **넣지 않는다.** 로컬 전송 메타이고 기기마다 다르다.
- `deletedAt`은 **넣는다.** 서버의 `deleted` 플래그와 중복 같지만 뜻이 다르다: 서버 플래그는
  "이 행에 ciphertext가 없다"이고, payload의 `deletedAt`은 "언제 지웠는가"다. 삭제 시각은
  로컬 휴지통 UX와 진단이 쓴다. 다만 묘비는 ciphertext가 null이므로 실제로는 **묘비에
  payload가 없다** — `deletedAt`은 소프트 삭제된 채 아직 push되지 않은 레코드가 자기
  상태를 나르는 자리이자, 미래에 "내용 보존 삭제"를 쓰게 될 때의 예약석이다.

타입별 `data`는 각 도메인의 코덱이 소유한다(§21 옵션 B). 예:

```text
chat.room.data      = { originStoryId, title, adult, promptProtected, seed, createdAt, updatedAt }
chat.message.data   = { roomId, role, speaker, content, createdAt, updatedAt,
                        model?, inputTokens?, outputTokens?, incomplete? }
authoring.draft.data= { title, tagline, description, tags, orientation, adult, visibility,
                        promptProtected, scenario, playGuide, suggestedPersona,
                        defaultStartSceneId, publishedStoryId, createdAt, updatedAt,
                        fieldRev: { meta, rating, body, persona, defaults, publication } }
```

`createdAt`/`updatedAt`은 payload에 남긴다 — 표시·정렬 축이라 다른 기기에도 같은 값이
필요하다. **다만 병합 판정은 절대 이 값으로 하지 않는다**(§19).

### 9.4 3-상태 필드 규칙(레거시에서 계승)

레거시 `canonical.ts`가 비싸게 배운 규칙 하나는 살린다: **미지정과 false는 다르다.**
`adult`·`temperature` 같은 값에서 `undefined`를 `false`/`0`으로 접으면 구버전 기기의
payload 한 번이 확정된 설정을 조용히 되돌린다. 우리 모델은 대부분 non-nullable이라
표면이 작지만, `orientation: Orientation | null`과 `suggestedPersona: DraftPersona | null`이
정확히 그 축이다 — 코덱은 `null`을 **명시적 초기화**로, 키 부재를 **미지정**으로 다룬다.

### 9.5 압축

레거시의 코덱 바이트 방식을 그대로 계승한다: 평문 선두 1바이트가 압축 방식을 자기기술하고
(`0x00` identity / `0x01` raw DEFLATE), 그 바이트가 **인증되는 평문 안에** 있어 변조가
불가능하다. 256바이트 미만은 압축하지 않고, 압축이 실제로 더 작을 때만 적용한다.
`fflate`를 쓴다(레거시와 동일, 순수 JS라 Hermes에서도 돈다).
이건 최적화가 아니라 실질이다 — 초안 시나리오와 방 `seed`는 반복이 많은 텍스트라 보통 3–5배 줄고,
그만큼 레코드당 상한과 계정 총량 상한에 여유가 생긴다.

---

## 10. Encryption Architecture

### 10.1 프리미티브 — 레거시 감사 결과와 우리 결정

| 용도 | 레거시 실제 | 라이브러리 | 지금 |
| --- | --- | --- | --- |
| 레코드 암호화 | AES-256-GCM, nonce 12B, tag 16B | `@noble/ciphers` / web은 `crypto.subtle` | **유지** |
| DEK 생성 | `randomBytes(32)` (CSPRNG) | `@noble/hashes/utils` | **유지** |
| 복구키 파생 | HKDF-SHA256(recovery16, salt16, "rowcat-sync-recovery-v1", 32) | `@noble/hashes/hkdf` | **유지** |
| 키 래핑 | AES-256-GCM(파생키, DEK, AAD) | 위와 동일 | **유지** |
| 인증키 파생 | HKDF-SHA256(DEK, salt=owner, "rowcat-sync-auth-v1", 32) | 동일 | **유지** |
| rewrap 증명 | HMAC-SHA256(authKey, keyringJson), 상수시간 비교 | `@noble/hashes/hmac` | **유지** |
| 페어링 | x25519 ECDH + HKDF-SHA256 + AES-GCM | `@noble/curves` | **유지** |
| 페어링 코드 | 40비트(5바이트) base32 8글자 | — | **80비트로 상향**(§13) |
| Argon2id 등 메모리하드 KDF | **쓰지 않음** | — | **쓰지 않음** |

Argon2를 쓰지 않는 것은 누락이 아니라 결정이다. 복구 코드가 사용자가 고른 암호가 아니라
**128비트 CSPRNG 랜덤**이므로 사전 공격 대상이 아니고, HKDF로 충분하다. 대신 그 대가로
**복구 코드는 절대 재입력 가능한 비밀번호가 아니며 잃으면 끝**이라는 제품 정직성이 따라온다(§12 · 조사 §83).

nonce는 매번 랜덤 12바이트다. AES-GCM의 랜덤 nonce 안전 한도는 같은 키로 약 2³²개
메시지이고, 한 회원의 레코드 쓰기가 그 수에 도달할 일은 실질적으로 없다. 다만 이 한도가
**DEK 회전을 언젠가 해야 하는 이유 목록의 한 줄**이라는 사실은 기록해 둔다(§28 Key Rotation).

### 10.2 AAD 조성 — 결정

```text
레코드:  "rowcat.sync.rec.v1" \0 owner \0 recordId \0 type \0 envelopeVersion
키 래핑: "rowcat.sync.key.v1" \0 owner \0 "recovery"
페어링:  "rowcat.sync.pair.v1" \0 owner \0 normalizedCode
```

레거시 대비 두 가지가 바뀐다.

1. **도메인 분리 접두사를 레코드 AAD에도 붙인다.** 레거시 레코드 AAD는
   `owner\0sync_id\0type\0protocolVersion`으로 접두사가 없었다. 접두사가 있으면 세 종류의
   ciphertext가 서로의 자리에 놓일 수 없음이 구조적으로 보장된다.
2. **protocolVersion 대신 envelopeVersion을 넣는다.** 프로토콜 판을 올리는 일과 봉투를
   바꾸는 일은 다른 사건이고(§18), AAD가 묶어야 하는 것은 후자다.

### 10.3 `version`을 AAD/암호문에 넣는가 — **넣지 않는다**

근거:

- 클라이언트는 암호화 시점에 서버가 부여할 `version`을 **모른다**. `baseVersion + 1`은
  추측이고, 배치가 충돌해 pull-후-재시도로 들어가는 순간 그 추측이 틀린다. 넣으면 재시도마다
  **재암호화**가 강제되고, ciphertext가 요청마다 달라져 Idempotency-Key의 `request_hash`가
  깨진다.
- `version`은 인증해야 할 **진정성**이 아니라 서버의 **부기(bookkeeping)**다.
- 그렇다고 롤백 공격을 방치하지 않는다. 대신 **`rev`(HLC)를 인증되는 평문 안에** 둔다.
  클라이언트는 **이미 적용한 `rev`보다 엄격히 오래된 inbound 레코드를 거부**한다.
  서버가 예전 blob을 되돌려도 로컬 상태가 뒤로 가지 않는다.
  **레거시에는 이 방어가 아예 없었다** — `version`만 올라오면 오래된 ciphertext도 적용됐다.

### 10.4 봉투

```text
EncryptedBlob = { v: 1, iv: base64(12B), ct: base64(ciphertext||tag) }
직렬화        = JSON.stringify → sync_record.ciphertext (text)
```

`v`를 명시적으로 싣는 것이 레거시와의 차이다. 레거시 blob은 `{iv, ct}`뿐이라, 봉투가
바뀌면 구버전 클라가 **복호화 실패로만** 그 사실을 알 수 있었다 — "키가 틀렸다"와
"이 봉투를 모른다"가 구분되지 않는다. 서버는 `v`를 **구문만** 검증한다(정수, 1..255).

### 10.5 AEAD 제공자 포트

```ts
interface AeadProvider {
  encrypt(key, plaintext, aad, nonce): Promise<Uint8Array>
  decrypt(key, ciphertext, aad, nonce): Promise<Uint8Array>
}
```
기본은 noble(순수 JS, 어디서나 동일). 웹은 `crypto.subtle` 어댑터를 주입한다(하드웨어 가속).
두 구현은 태그를 ciphertext 뒤에 붙이는 같은 규격이라 상호 복호화된다 — 레거시가 이미
증명한 배치이므로 그대로 계승한다. **HKDF/HMAC은 subtle이 아니라 noble로 통일한다**:
subtle에도 HKDF가 있지만 두 경로를 두면 파생값이 미묘하게 갈릴 여지가 생기고, KDF는
성능 병목이 아니다.

---

## 11. Key Hierarchy

```text
                     random DEK (256-bit, 불변, 서버가 절대 모름)
                            │
        ┌───────────────────┼───────────────────┬──────────────────────┐
        │                   │                   │                      │
        ▼                   ▼                   ▼                      ▼
  레코드 암호화        복구 래퍼             기억된 기기 래퍼         페어링 전송
                                                                   (일회성)
  AES-256-GCM       recovery(128b random)   web:                  x25519 ECDH
  per-record        └ HKDF-SHA256           non-extractable         └ HKDF-SHA256
  random nonce        salt=random16           AES-GCM CryptoKey        salt=owner\0code
  AAD=rec.v1|owner    info=recovery-v1        (generateKey,            info=pairing-v1
      |id|type|env    → wrapKey                extractable:false)    → K
                    └ AES-GCM(wrapKey, DEK)  └ AES-GCM(K, DEK)      AES-GCM(K, DEK)
                      AAD=key.v1|owner|        같은 로컬 DB의          AAD=pair.v1|owner|code
                          recovery             syncDevice 테이블      서버는 relay만
                    ── 서버 sync_keyring.keyring
                                        mobile:
                            ┌─────────  expo-secure-store
                            │           key = "rowcat.sync.dek." + hash(owner)
                            ▼
                    authKey = HKDF-SHA256(DEK, salt=owner, info=auth-v1, 32)
                            │  단방향. 서버가 보관하되 **어떤 응답으로도 돌려주지 않는다**
                            ▼
                    proof = HMAC-SHA256(authKey, keyringJson)   ← 키링 교체·소지 확인
```

서버에 존재하는 키 재료는 **`keyring`(wrapped DEK + salt)과 `auth_key`** 둘뿐이다.
둘 다 DEK를 복원할 수 없다.

`keyring` JSON:
```json
{ "v": 1, "recoverySalt": "<b64 16B>", "wrapped": { "iv": "<b64 12B>", "ct": "<b64>" } }
```
rewrap 증명은 **서버가 저장할 바로 그 문자열**에 대한 MAC이다. 정규화 모호성을 없애기
위해 클라이언트가 만든 문자열을 그대로 저장하고 그대로 검증한다(레거시의 정확한 선택).

---

## 12. Recovery State Machine

```text
                    ┌──────────────┐
                    │   disabled   │  동기화를 켠 적 없다(기본)
                    └──────┬───────┘
                     사용자가 "동기화 켜기"
                           ▼
                    GET /v2/me/sync/keyring
                    ┌──────┴───────┐
             null   │              │  존재
                    ▼              ▼
            ┌───────────────┐  ┌───────────────┐
            │  no-keyring   │  │    locked     │
            └───────┬───────┘  └───┬───────┬───┘
              setup()               │       │
              ├ createKeyring       │       └── (미래) 페어링 요청 → §13
              ├ POST keyring        │  복구 코드 입력
              │   409 ──────────────┘       │
              ├ remember(DEK)               ▼
              ├ 복구 코드 1회 표시    unlockWithRecovery(code)
              │                            ├ 실패 → locked 유지(코드 오류 표시)
              └──────────┬─────────────────┘ 성공
                         ▼
                  ┌──────────────┐
                  │   unlocked   │  DEK가 메모리에 있다
                  └──┬────┬───┬──┘
                     │    │   └── rotateRecoveryCode() → 새 코드 1회 표시, DEK 불변
                     │    └────── lock() / 로그아웃 → locked (기억된 기기면 다음에 자동 언락)
                     └─────────── sync 실행 → §24
```

### 결정

- **복구 코드는 1회만 표시한다.** 서버가 코드를 저장하지 않으므로 다시 보여줄 방법이 없다.
- **회전은 DEK를 바꾸지 않는다.** `wrapped`만 재래핑한다. 즉 재암호화가 0이고, **이전 코드는
  즉시 무효**가 된다(옛 salt·wrapped가 사라진다). 회전에는 잠금 해제 상태와 소지 증명이 필요하다.
- **코드를 잃고 신뢰 기기가 하나라도 남아 있으면**: 그 기기에서 잠금 해제 상태로 회전하면
  된다. 이것이 실질적인 복구 경로다.
- **코드를 잃고 신뢰 기기도 전부 잃으면**: 서버의 암호화 데이터는 **영구히 읽을 수 없다.**
  서버는 DEK를 모르고, 이것은 버그가 아니라 제품이 약속한 것이다. 유일한 진행 경로는
  기존 키링을 파기하고 처음부터 다시 설정하는 것이며 그 순간 서버 사본은 버려진다.
  (아직 데이터가 남아 있는 로컬 기기가 있다면 그 기기의 데이터로 다시 시작할 수 있다.)
  **이 파기 동작은 v1에 넣지 않는다** — 잘못 누르면 되돌릴 수 없는 버튼이라, 지원 경로가
  마련된 뒤에 넣는다.
- **용어**: "백업 코드"라 부르지 않는다. §33 참조.

---

## 13. Device Pairing

**구현됨(2026-08-20).** 레거시 프로토콜을 계승하되 다섯 곳을 고쳤다. 실제 코드는
`packages/sync/src/pairing.ts`(순수) · `apps/api/src/services/sync/pairing.ts`(중계) ·
`apps/web/src/features/sync/pair-device-dialog.tsx`·`approve-pairing-dialog.tsx`다.

```text
새 기기 N                          서버 relay                     신뢰 기기 T
──────────                         ──────────                     ──────────
priv/pub = x25519 keypair
code = base32(random 10B)          sync_pairing(owner, code_hash)
     = "XXXX-XXXX-XXXX-XXXX"       new_pub, payload=null
codeHash = SHA-256(prefix\0owner   TTL 5분
                   \0정규코드)
POST /v2/me/sync/pairing ────────►                    ◄──── 사용자가 코드를 옮겨 적는다
{ codeHash, newPublicKey }
                                   POST .../pairing/status
                                   → { newPublicKey, payload, expiresAt }
                                                                eph keypair
                                                                shared = ECDH(eph, newPub)
                                                                K = HKDF(shared,
                                                                      salt=owner\0code,
                                                                      info=pairing-v1)
                                   POST .../pairing/approve ◄── { codeHash, payload }
                                   payload = {v,epk,iv,ct}
POST .../pairing/status (폴링 2s)─►  { payload }
K' = HKDF(ECDH(priv, epk), …)
DEK = AES-GCM-open(K', ct, AAD=pair.v1\0owner\0code)
  ↓
POST .../keyring/verify   ◄── **기억하기 전에** 현재 키링에 대조한다
  ↓ 통과
deviceKey.remember(DEK) → DELETE .../pairing (소비 후 정리)
```

### 레거시에서 바꾼 것

1. **코드 엔트로피 40비트 → 80비트.** 코드는 서버 조회 키이자 채널 바인딩 재료다. 코드를
   맞히는 것은 세션 하나를 가로채는 일이 아니라 그 세션의 봉투를 **여는** 일이라, 5분
   창 안의 어떤 오프라인 시도도 의미가 없어야 한다. 10바이트 = base32 16글자(4글자 네
   묶음)이고 80 = 16 × 5라 패딩 비트가 없다 — "마지막 글자가 여럿으로 디코드되는" 비정규
   표기 문제 자체가 사라진다.
2. **서버에 코드 원문을 저장하지도 받지도 않는다.** `codeHash = SHA-256(prefix \0 owner
   \0 정규코드)`의 hex를 PK로 쓴다. 도메인 접두사를 붙인 것과 hex를 고른 것이 설계 초안과
   다르다 — 전자는 이 해시가 다른 용도의 같은 입력과 절대 같아지지 않게 하고, 후자는
   대소문자와 `+/=`가 없어 **DB 키·본문·로그 어디에 놓아도 같은 문자열**이기 때문이다.
   해시는 경로가 아니라 **본문**에 싣는다(경로 파라미터는 액세스 로그·리퍼러·프록시 캐시
   키에 자동으로 남는다).
3. **일회성을 강제한다.** 새 기기가 열쇠를 **기억한 뒤에** `DELETE`가 그 행을 지운다.
   조회는 아무것도 소비하지 않는다 — 처음 payload를 돌려준 시점에 지우면 그 응답이
   유실된 재시도에서 세션이 이미 사라져 있고, 사용자는 아무 잘못 없이 처음부터 다시 한다.
4. **기억하기 전에 검증한다.** 봉투가 열렸다는 것은 "코드와 개인키가 맞는 상대가
   봉인했다"까지만 말한다. 그 키가 이 계정의 키링을 여는지는 **이미 있는 소지 증명
   경로**가 판정하고(`POST /keyring/verify`), 실패하면 아무것도 기억하지 않고 잠긴 채로
   남는다. 잘못된 키를 기억하면 그 기기는 자기 데이터를 영영 못 여는 채로 "신뢰됨"이
   되고 그 상태는 스스로 낫지 않는다.
5. **승인 경합을 조건부 `UPDATE` 하나로 판정한다**(`payload IS NULL`). 먼저 온 승인이
   이기고 늦은 것은 409다. 덮어쓰면 새 기기가 이미 가져간 봉투와 서버의 봉투가 갈라져,
   다음 폴링 한 번이 열지 못하는 값을 가져간다.

### 유지한 것

- 서버는 relay다. `new_pub`도 `payload`도 서버에겐 불투명하고, 서버가 payload를 바꾸면
  복호화가 실패한다(AAD). `payload`를 **파싱조차 하지 않는다** — 그래서 일회용 공개키
  (`epk`)를 서버 열로 빼지 않고 봉투 안에 둔다.
- 코드가 HKDF salt이자 AAD라 **코드가 틀리면 복호화가 실패한다**. 서버가 다른 owner의
  요청과 섞어도 마찬가지다(owner도 AAD에 있다). 서버가 `new_pub`을 자기 키로 바꿔치기해
  신뢰 기기가 서버의 키로 DEK를 봉인하게 만들어도, 코드를 모르므로 K를 만들지 못한다 —
  서버가 얻는 것은 **페어링을 실패시키는 능력**뿐이고 그건 중계를 끊는 것으로도 얻는다.
- 승인은 신뢰 기기의 **명시적 사용자 행동**이다. 자동 승인 경로를 만들지 않는다. 그리고
  **열쇠를 가진 기기만** 승인할 수 있다 — 로그인만 한 브라우저가 승인할 수 있으면 세션
  탈취가 곧 데이터 탈취가 된다(`approvePairing`이 DEK 없으면 `sync_locked`로 거절한다).
- 동시 페어링 요청은 코드별로 독립적인 행이라 서로 간섭하지 않는다. owner당 진행 중
  페어링 수를 제한한다(5개, `SYNC_LIMITS.pairingMaxActive`).

### 이 슬라이스가 만들지 않은 것

- **페어링 개인키의 영속.** `PairingSession` 객체 안에만 살고 새로고침하면 페어링은
  처음부터다. 5분짜리 편의를 위해 DEK를 열 수 있는 재료를 디스크에 눕히지 않는다.
- **SSE 페어링 이벤트.** 알림 평면을 범용 실시간 버스로 넓히지 않는다. 화면이 열려 있는
  동안의 2초 폴링이 더 작고 격리돼 있고, 창이 닫히면 타이머도 사라진다.
- **서버의 기기 목록.** `sync_pairing`은 중계 상태이지 신뢰 기기 이력도 감사 로그도
  아니다 — 성공·취소·만료된 행은 사라진다. 목록을 그리면 그 옆에 반드시 `원격 해제`가
  생기고, 그 버튼은 지금 거짓말이다(아래).
- **QR.** 같은 코드의 다른 표기일 뿐이라 나중 UX 슬라이스로 둔다.

### 승인 후 취소는 불가능하다

DEK를 넘긴 뒤에는 서버 행을 지워도 그 기기가 아는 DEK를 되돌릴 수 없다. 진짜 취소는
새 DEK 발급 + 서버 전량 재암호화 + 남은 기기에만 새 DEK 배포 + 옛 DEK 폐기이고, 그건
**DEK 회전 + 기기 취소**라는 별도 슬라이스다(§29.5). 화면이 그것을 약속하지 않는다.

---

## 13b. Namespace Reset — 잠긴 채 열쇠가 없는 계정의 출구

### 왜 있어야 하는가

키링 등록은 first-writer-only다(§7). 그 규칙의 뒷면: 동기화를 켠 적 없는 계정의 세션을
잠깐 훔친 사람이 `POST /keyring`으로 **자기 DEK**의 키링을 등록하면, 세션이 폐기된 뒤에도
그 키링은 남는다. 주인이 나중에 동기화를 켜면 409 → `locked`이고, 복구 코드도 없고
`PUT /keyring`은 낼 수 없는 소지 증명을 요구한다. 그 상태는 스스로 낫지 않았고, 그 뒤에
올라가는 모든 암호문은 공격자가 읽을 수 있었다.

### 무엇을 하는가

```text
DELETE /v2/me/sync/keyring     requireActiveViewer + 최근 로그인(freshAge 24h) · 본문 없음 · 멱등
    └ 한 트랜잭션에서            키링 → 페어링 → push 멱등 기록 → sync_state → 레코드 전부
controller.reset()             서버 삭제 → 기기 열쇠 잊기 → forgetServerVersions → resetCursor → disabled
```

- **소지 증명을 요구하지 않는 유일한 키링 쓰기다.** 요구하면 위 상황에서 쓸 수 없다. 대신
  라우트가 최근 로그인을 요구하고, 삭제의 범위가 곧 안전장치다 — 이 조작으로 얻을 수 있는
  것은 **읽을 수 없는 암호문을 지우는 능력**뿐이고, 남의 데이터를 읽거나 자기 키로
  바꿔치기할 수는 없다(그 뒤에 등록되는 키링으로 올라가는 것은 그 기기의 로컬 데이터다).
- **로컬 데이터는 그대로다.** 지우는 것은 서버의 것과 이 기기의 열쇠뿐이고, 다음 `setup()`이
  로컬을 새 열쇠로 다시 올린다(부트스트랩은 PUSH ALL이 먼저다 — §19).
- **`serverVersion`을 되돌리는 것이 요점이다.** 서버에 아무것도 없는데 로컬이 옛 버전을
  들고 push하면 "없는 레코드는 baseVersion 0"으로 전부 거절되고, 그 충돌은 pull로 풀리지
  않는다(받을 것이 없다) — 수렴 시도가 전부 실패한 뒤 `sync_conflict_unresolved`다. 그래서
  `SyncStore.forgetServerVersions`가 생겼고, 그 메서드는 값을 한 글자도 바꾸지 않는다.
- **서버가 먼저다.** 로컬을 먼저 잊으면 서버 삭제가 거절됐을 때(다시 로그인 필요) 이 기기는
  열쇠를 잃었는데 서버는 그대로인 상태가 남는다 — 이 조작이 풀려던 바로 그 상태다.
- **다른 기기는 다음 `inspect()`에서 `disabled`가 된다**(키링이 없으면 기억된 열쇠를 버린다,
  §14). 그 기기의 로컬 데이터도 그대로이고, 주인이 그 기기에서 `setup()`하면 두 기기의
  데이터가 합집합으로 다시 올라간다.

---

## 14. Remembered Device

### 웹

레거시 방식을 유지한다. 이유는 그것이 **가능한 것 중 최선**이기 때문이지 안전해서가 아니다.

```ts
wrapKey = crypto.subtle.generateKey({name:"AES-GCM", length:256}, /* extractable */ false, [...])
blob    = { key: wrapKey /* CryptoKey 객체 그대로 */, iv, ct: AES-GCM(wrapKey, DEK) }
저장     = LocalDb.syncDevice.put({ key: "dek", ...blob })
```

- **회원별 로컬 DB 안에 둔다.** 별도 IndexedDB에 두면 "이 기기 데이터 지우기"가 신뢰를
  풀지 못해 stale 언락이 남는다. 레거시가 정확히 그 버그를 겪고 옮겼다.
- IndexedDB는 `CryptoKey` 객체를 구조화 복제로 저장할 수 있고, non-extractable 키는
  **바이트를 꺼낼 수 없는 채로** 되살아난다. 이게 이 설계가 성립하는 이유다.
- 얻는 것: 디스크에 평문 DEK가 없다. 다른 origin·다른 프로필·오프라인 디스크 분석이
  raw 키를 뽑지 못한다.
- 얻지 못하는 것: 같은 origin의 스크립트는 그 CryptoKey로 `decrypt`를 호출할 수 있다.
  **§14b 참조.**

### 미래 모바일

`expo-secure-store`(iOS Keychain / Android Keystore). owner 해시로 키 이름을 나누고,
전체 목록을 인덱스 키에 유지해 "로컬 데이터 초기화"가 전부 지울 수 있게 한다 —
시크릿 스토어는 앱 DB와 별개라 자동으로 지워지지 않기 때문이다(레거시가 배운 것).
가능하면 `requireAuthentication`(생체) 옵션을 검토하되 기본값은 아니다.

### 공용 포트

```ts
interface DeviceKeyStore {
  remember(dek: Uint8Array): Promise<void>
  load(): Promise<Uint8Array | null>
  forget(): Promise<void>
  has(): Promise<boolean>
}
```
`@rowcat/sync`는 이 인터페이스만 안다. WebCrypto도 Keychain도 모른다.

### 자동 언락 후 안전망

레거시의 `verifyUnlock()`을 계승한다: 캐시 DEK로 `authKey`를 파생해 서버 키링에 대한
증명을 만들고 `POST /v2/me/sync/keyring/verify`로 대조한다. 403(확정 불일치)이면 캐시를
버리고 잠근다. 네트워크 오류·키링 미설정은 **잠그지 않는다**(오프라인 가용성 우선).
회원별 스코핑이 1차 방어이고 이것은 2차다.

---

## 14b. XSS Reality — 실제 위협 경계

**WebCrypto의 non-extractable 키가 XSS를 막는다고 말하지 않는다.**

RowCat origin에서 실행되는 스크립트가 할 수 있는 일:

1. `crypto.subtle.decrypt`를 그 wrapKey로 호출해 **DEK 평문을 얻는다.** non-extractable은
   `exportKey`를 막을 뿐 `decrypt` 호출을 막지 않는다.
2. **애초에 그럴 필요도 없다.** 대화와 초안의 평문은 이미 IndexedDB에 그대로 있다.
   `rowcat_chat_<viewerId>`를 열어 읽으면 끝난다.
3. 세션 쿠키로 임의의 ciphertext를 push하거나 레코드를 삭제한다.

즉 **암호화 동기화는 XSS 노출을 늘리지도 줄이지도 않는다.** 늘리지 않는 이유는 로컬
평문이 동기화 이전부터 거기 있었기 때문이고, 줄이지 않는 이유는 origin 안의 코드가
사용자 자신과 구별되지 않기 때문이다.

**암호화가 실제로 막는 것은 서버 쪽이다**: DB 덤프, 백업 절도, 악의적 운영자,
저장 데이터에 대한 법적 요구, 인프라 침해 후의 과거 데이터 열람.
동기화 기능의 가치 제안을 이 문장으로만 적는다.

### "이 기기 기억"은 여전히 적절한 절충인가 — **그렇다, 조건부로**

- 대안은 매 세션 복구 코드 재입력이다. 그러면 사용자는 코드를 브라우저나 메모장에 붙여
  두고, 그건 non-extractable CryptoKey보다 명백히 나쁘다.
- 로컬 평문이 이미 있으므로 기억이 만드는 **추가** 노출은 "서버 사본까지 열 수 있다"뿐이고,
  그건 이미 로컬에 있는 것과 대개 같은 데이터다.
- 조건: **명시적 옵트인**, 계정 화면에서 **언제든 해제 가능**, 로컬 데이터 초기화가
  신뢰를 **함께** 푼다.

---

## 15. Server Schema

Drizzle 개념 스키마. 마이그레이션 SQL은 만들지 않는다.

```ts
// apps/api/src/db/tables/sync.ts (미래)

/** 불투명 암호문 저장소. 서버는 ciphertext를 절대 해석하지 않는다. */
sync_record = pgTable("sync_record", {
  owner:        text().notNull().references(() => member.id, { onDelete: "cascade" }),
  id:           text().notNull(),            // 클라 생성. (owner,id)가 신원
  type:         text().notNull(),            // "chat.room" 등. 서버는 형식만 안다
  ciphertext:   text(),                      // null = 묘비
  envelope:     integer().notNull(),         // EncryptedBlob.v — 구문 검증용
  version:      integer().notNull(),         // 낙관적 동시성
  seq:          bigint({mode:"number"}).notNull(),   // 회원별 단조 커서
  updated_at:   timestamp({withTimezone:true}).notNull().defaultNow(),
  deleted:      boolean().notNull().default(false),
  bytes:        integer().notNull(),         // ciphertext 길이(쿼터 집계용)
}, t => [
  primaryKey({ columns: [t.owner, t.id] }),
  index("sync_record_seq_idx").on(t.owner, t.seq),   // 증분 pull의 유일한 접근 경로
]);

/** 회원별 시퀀스 카운터 + 묘비 지평선. push 트랜잭션 안에서 update-then-read. */
sync_state = pgTable("sync_state", {
  owner:                 text().primaryKey().references(() => member.id, { onDelete: "cascade" }),
  seq:                   bigint({mode:"number"}).notNull().default(0),
  tombstone_horizon_seq: bigint({mode:"number"}).notNull().default(0),  // v1은 항상 0
  record_count:          integer().notNull().default(0),
  total_bytes:           bigint({mode:"number"}).notNull().default(0),
  created_at:            timestamp({withTimezone:true}).notNull().defaultNow(),
  updated_at:            timestamp({withTimezone:true}).notNull().defaultNow(),
});

/** 제로지식 키링. auth_key는 어떤 응답으로도 나가지 않는다. */
sync_keyring = pgTable("sync_keyring", {
  owner:      text().primaryKey().references(() => member.id, { onDelete: "cascade" }),
  keyring:    text().notNull(),   // 클라가 만든 문자열 그대로. 정규화하지 않는다
  auth_key:   text().notNull(),   // 레거시와 달리 NOT NULL
  created_at: timestamp({withTimezone:true}).notNull().defaultNow(),
  updated_at: timestamp({withTimezone:true}).notNull().defaultNow(),
});

/** push 재시도 멱등. TTL 만료분은 push 트랜잭션이 기회적으로 정리한다. */
sync_push_dedupe = pgTable("sync_push_dedupe", {
  owner:           text().notNull().references(() => member.id, { onDelete: "cascade" }),
  idempotency_key: text().notNull(),
  request_hash:    text().notNull(),
  response:        text().notNull(),   // "" = 진행 중
  created_at:      timestamp({withTimezone:true}).notNull().defaultNow(),
  expires_at:      timestamp({withTimezone:true}).notNull(),
}, t => [
  primaryKey({ columns: [t.owner, t.idempotency_key] }),
  index("sync_push_dedupe_expiry_idx").on(t.expires_at),
]);

/** 페어링 relay(구현됨). 코드는 해시로만 저장한다. 만료분은 다음 시작이 치운다. */
sync_pairing = pgTable("sync_pairing", {
  owner:      text().notNull().references(() => member.id, { onDelete: "cascade" }),
  code_hash:  text().notNull(),
  new_pub:    text().notNull(),
  payload:    text(),
  created_at: timestamp({withTimezone:true}).notNull().defaultNow(),
  expires_at: timestamp({withTimezone:true}).notNull(),
}, t => [
  primaryKey({ columns: [t.owner, t.code_hash] }),
  index("sync_pairing_expiry_idx").on(t.expires_at),
]);
```

### 각 열이 노출하는 평문 메타데이터

| 열 | 누가 쓰나 | 서버가 이해하나 | 민감도 | 여기에 필요한가 |
| --- | --- | --- | --- | --- |
| `owner` | 서버(세션) | ✅ | 낮음 — 인가의 근거 | 필수 |
| `id` | 클라 | ❌(불투명) | 낮음 — 랜덤 UUID | 필수 |
| `type` | 클라 | 형식만 | **중간** — 행동 추론 가능 | 필수(§20 등록 라우팅) |
| `ciphertext` | 클라 | ❌ | 높음(불투명이어도 사용자 데이터) | 필수 |
| `envelope` | 클라 | 정수로만 | 없음 | 필수(구문 검증) |
| `version` | 서버 | ✅ | 없음 | 필수(낙관적 동시성) |
| `seq` | 서버 | ✅ | 낮음 — 회원별이라 전역 볼륨 미노출 | 필수 |
| `updated_at` | 서버 | ✅ | **중간** — 활동 시각 | 진단·GC에 필요 |
| `deleted` | 클라→서버 | ✅ | 낮음 | 필수(§20) |
| `bytes` | 서버 | ✅ | 낮음(길이는 어차피 안다) | 쿼터에 필요 |

**`sync_device` 테이블을 v1에 두지 않는다.** 기기 목록은 UI에 보여줄 것이 생기기 전에는
메타데이터만 늘린다(어느 기기가 언제 동기화했는지를 서버가 알게 된다). 무엇보다 기기를
서버에서 지워도 그 기기가 아는 DEK가 사라지지 않으므로 **취소의 환상**을 만든다(§29).

### 인덱스 근거

`(owner, seq)` 하나로 끝난다. pull이 `owner = ? AND seq > ? ORDER BY seq LIMIT n`뿐이고,
push는 PK로 단건 조회한다. `type` 인덱스는 만들지 않는다 — 서버가 타입으로 조회할 이유가
없고, 있으면 언젠가 타입별 통계를 내려는 유혹이 생긴다.

### 보관

`sync_record`의 묘비 행(ciphertext null)은 **v1에서 영구 보존**한다. 행당 ~120바이트라
비용이 낮고, 이것이 §20의 부활 문제를 통째로 없앤다. `tombstone_horizon_seq`는 미래에
GC를 켤 때를 위한 예약석이고 v1에는 항상 0이다.

---

## 16. Server API

전부 `/v2/me/sync/*` 아래에 둔다. `me` 라우터에 `.route("/sync", sync)`로 붙이고,
`routes/index.ts`는 그대로 `.route("/me", me)` 하나만 안다 — 접두사가 한곳에 모여야
RPC 타입과 실제 URL이 어긋나지 않는다는 기존 규칙 그대로다.

### 16.1 인가 — 모든 라우트에 같은 문장

```ts
const viewer = requireActiveViewer(await getViewer(c))   // 401 / 403
const owner  = viewer.id                                  // ← 유일한 출처
```

`owner`·`viewerId`·`memberId`를 **요청 본문·쿼리·헤더 어디에서도 받지 않는다.**
계약 스키마에 그 필드가 없으므로 실수로 넘기는 코드가 타입에서 막힌다.

`requireActiveViewer`(정지·차단 회원의 쓰기 차단)를 쓰는가:
- 쓰기(push, keyring setup/rewrap, pairing) → **`requireActiveViewer`**. 정지 계정이
  서버 저장소를 계속 늘릴 이유가 없다.
- 읽기(pull, keyring 조회) → **`requireViewer`**. 정지된 회원도 자기 데이터를 다른
  기기로 가져갈 수 있어야 한다. 여기를 막으면 계정 제한이 데이터 인질이 된다.

### 16.2 엔드포인트

| 메서드 | 경로 | 의미 | 실패 |
| --- | --- | --- | --- |
| `GET` | `/v2/me/sync/keyring` | `{ keyring: string \| null }`. `auth_key`는 **절대 포함하지 않는다** | 401 |
| `POST` | `/v2/me/sync/keyring` | 최초 등록. `{ keyring, authKey }`. first-writer-only | 409 `sync_keyring_exists` |
| `PUT` | `/v2/me/sync/keyring` | 교체(복구 코드 재발급). `{ keyring, proof }` | 404 `sync_keyring_missing` · 403 `sync_keyring_proof_invalid` |
| `POST` | `/v2/me/sync/keyring/verify` | 소지 확인(읽기 전용). `{ keyring, proof }` → 200/403 | 403만 확정 불일치 |
| `GET` | `/v2/me/sync/records?since=&limit=` | 증분 pull | 400 `sync_cursor_invalid` · 410 `sync_cursor_expired` |
| `POST` | `/v2/me/sync/records` | 배치 push. 헤더 `Idempotency-Key` | 아래 |

페어링(구현됨) — **해시는 경로가 아니라 본문**이다(§13):

```text
POST   /v2/me/sync/pairing          { codeHash, newPublicKey } → SyncPairingDto
POST   /v2/me/sync/pairing/status   { codeHash }               → SyncPairingDto
POST   /v2/me/sync/pairing/approve  { codeHash, payload }      → 204
DELETE /v2/me/sync/pairing          { codeHash }               → 204(멱등)
```

게이트는 나머지와 같은 축이다: 시작·승인은 `requireActiveViewer`(상태를 만든다), 조회·
취소는 `requireViewer`(제한된 계정도 자기 중계를 닫을 수 있어야 한다).

슬라이스 6(에셋)에 예약:

```text
POST /v2/me/sync/blobs                GET /v2/me/sync/blobs/:hash
```

레거시(`/api/sync`, `/api/sync/keys/setup|rewrap|verify`) 대비 바꾼 것:
- `keys` → **`keyring`**(단수). 컬렉션이 아니라 회원당 하나다.
- `POST /keys/rewrap` → **`PUT /keyring`**. 교체는 PUT이 정직하다.
- 레코드가 `/records`라는 명사를 갖는다. 레거시는 `/api/sync` 하나가 GET/POST로 갈렸다.

### 16.3 요청·응답 형태

```text
GET /v2/me/sync/records?since=<int>&limit=<int>
200 {
  records: [{ id, type, ciphertext: string|null, envelope: number,
              version: number, seq: number, deleted: boolean,
              serverUpdatedAt: string }],   // ← 1b에서 추가. 아래 정정 참고
  cursor: number,        // 실제 반환한 마지막 행의 seq
  hasMore: boolean
}

POST /v2/me/sync/records
Idempotency-Key: <16..128 [A-Za-z0-9_-]>
{ items: [{ id, type, baseVersion, ciphertext: string|null,
            envelope: number, deleted: boolean }] }
200 { ok: true,  cursor: number, conflicts: [] }
200 { ok: false, cursor: number, conflicts: [{ id, serverVersion }] }   // 전부 미적용
200 { ok: true,  cursor: number, conflicts: [], deduplicated: true }    // 멱등 재시도
```

**충돌이 200인 이유는 §18.2에 있다** — 낙관적 동시성 충돌은 요청의 실패가 아니고,
응답이 `ApiErrorBody`가 담을 수 없는 데이터를 실어야 한다.

> **정정(1b 구현). `PullRecord`에 `serverUpdatedAt`을 더했다.**
>
> 이 문서의 초안에는 없던 필드다. 필요해진 이유는 묘비의 구조에 있다: 묘비는
> `deleted = true, ciphertext = null`이므로 **받는 기기가 복호화할 것이 아무것도 없다.**
> 원래 기기가 암호문 안에 실었을 `deletedAt`·`rev`가 존재하지 않는다.
>
> 그러면 받는 쪽은 "언제 지워졌는가"를 알 방법이 없어 자기 시각을 적게 되고, 기기마다 다른
> 삭제 시각이 남는다. 방 캐스케이드에서는 그 값이 그 방의 메시지 수천 건에 그대로 물려
> 내려간다(§20.4). 서버는 어차피 `sync_record.updated_at`을 갖고 있으므로 그것을 명시적으로
> 실어 주면 모든 기기가 **같은 값**을 쓴다.
>
> ```text
> 원격 묘비 수신  → 로컬 deletedAt = PullRecord.serverUpdatedAt
> 방 묘비 캐스케이드 → 그 방의 로컬 메시지도 같은 값 (dirty는 올리지 않는다)
> ```
>
> **이것은 서버의 부기이지 병합 축이 아니다.** 승자를 가르는 것은 여전히 암호화된 평문 안의
> `rev` 하나뿐이고, 살아 있는 레코드의 제품 `updatedAt`도 여전히 암호문에서 온다.
> 원래의 삭제 시각이 암호화를 넘어 살아남은 척하지 않는다 — 살아남지 않았다.

### 16.4 요청 상한과 레이트 리밋

```text
본문 크기        push 4 MB (SYNC_LIMITS.pushMaxTotalBytes) — 서버가 다시 검증
pull limit       기본 200, 최대 500. 초과 요청은 잘라서 처리(400이 아니다)
쓰기 리미터      기존 회원 쓰기 리미터를 push · keyring 쓰기 · pairing에 그대로 건다
읽기            pull은 리미터 대상이 아니다(정상 동기화가 페이지네이션으로 여러 번 부른다)
```

### 16.5 응답 캐시

전 라우트 `Cache-Control: no-store`. pull 응답은 커서에 따라 달라지고 개인 데이터이며,
중간 캐시에 남으면 그 자체가 유출 표면이다.

### 16.6 서버가 하지 않는 것

- ciphertext를 파싱하지 않는다(JSON 구문 검증은 봉투 껍데기까지만).
- 레코드 타입의 **의미**를 알지 않는다. 등록된 타입 목록을 서버에 두지 않는다(§16.7).
- 병합하지 않는다. 서버 측 충돌 해소는 존재하지 않는다.
- 알림에 내용을 싣지 않는다(슬라이스 4의 SSE는 "바뀌었다" 신호뿐).

### 16.7 타입 어휘 — 형식 제약 + 열린 목록

세 후보 중 **형식만 강제하는 열린 어휘**를 고른다.

| 후보 | 판정 | 이유 |
| --- | --- | --- |
| 임의 문자열 허용 | ❌ | 네임스페이스 무단 점유, 저장소 남용. 오타가 새 타입이 된다 |
| 서버 allowlist(고정 목록) | ❌ | 새 타입을 쓰려면 **서버 배포가 선행**돼야 한다. 앞선 클라이언트가 뒤처진 서버에 막힌다 — 전방 호환의 목적 자체를 없앤다 |
| **형식 제약 + owner당 distinct 상한** | ✅ | 채택 |

```text
정규식   /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,2}$/   최대 32자
상한     owner당 distinct type 32개 (SYNC_LIMITS.ownerMaxDistinctTypes)
```

새 클라이언트가 `chat.memory`를 올리면 서버는 배포 없이 받아 준다. 구 클라이언트는
그것을 모르는 타입으로 **무시하고 커서를 전진**시킨다(§9.2). 서버는 어휘를 몰라도
`(owner, id)` 신원과 낙관적 동시성만으로 정확하다.

---

## 17. Pull Cursor Model

### 결정: **회원별 단조 시퀀스**를 push 트랜잭션 안에서 발급한다.

```sql
-- push 트랜잭션 안에서, 충돌 검사를 통과한 뒤
INSERT INTO sync_state (owner) VALUES ($owner) ON CONFLICT DO NOTHING;
UPDATE sync_state SET seq = seq + $n WHERE owner = $owner RETURNING seq;
-- 반환값 - n 부터 순서대로 각 레코드에 부여
```

pull:
```sql
SELECT id, type, ciphertext, envelope, version, seq, deleted
  FROM sync_record
 WHERE owner = $owner AND seq > $since
 ORDER BY seq ASC
 LIMIT $limit + 1;          -- +1로 has_more 판정
-- cursor = 마지막으로 **실제 반환한** 행의 seq
```

### 요구 속성 점검

| 속성 | 성립하는가 | 근거 |
| --- | --- | --- |
| 단조 | ✅ | 카운터는 증가만 한다 |
| 안정 | ✅ | 한 번 부여된 seq는 그 행이 다시 갱신될 때까지 불변 |
| owner 안전 | ✅ | 카운터가 owner별이라 다른 회원의 값이 섞이지 않는다 |
| 페이지네이션 | ✅ | 아래 참조 |
| 페이지네이션 중 새 쓰기로 레코드가 **사라지지 않는다** | ✅ | 갱신은 seq를 **앞으로만** 민다 |
| 삭제가 참여한다 | ✅ | 묘비도 행이고 새 seq를 받는다 |

페이지네이션 정확성 증명 스케치: 커서 `s`로 스캔 중 레코드 A가 갱신되어 seq가 `a → a'`
(`a' > 현재 최대`)로 바뀐다고 하자. `a ≤ s`였다면 A는 이미 적용됐고 이제 `a' > s`이므로
다시 온다(중복 — 적용이 멱등이라 무해). `a > s`였다면 A는 아직 안 왔고 `a' > a > s`이므로
여전히 온다. **어느 경우에도 건너뛰지 않는다.** 갱신이 seq를 뒤로 미는 경로가 없다는 것이
유일한 전제다.

### 왜 Postgres `SEQUENCE`가 아닌가 — **이것이 이 절에서 가장 중요한 문장이다**

`nextval()`은 트랜잭션 밖에서 값을 발급한다. 그래서 다음이 실제로 가능하다:

```text
T1: nextval → 11, ... (느린 트랜잭션, 아직 커밋 안 됨)
T2: nextval → 12, 커밋
읽기: seq 12만 보인다. 커서를 12로 전진.
T1 커밋.  → seq 11은 since=12 조회에 **영원히 걸리지 않는다.**
```

**레코드 영구 유실이다.** 회원별 카운터 행을 트랜잭션 안에서 `UPDATE`하면 그 행에 대한
잠금이 커밋 순서를 seq 순서와 일치시켜 이 창이 사라진다. 레거시는 전역 단일 행을 써서
이 문제를 **우연히** 피하고 있었다(전 사용자 직렬화라는 대가를 치르면서). 여기서는 owner별로
좁혀 대가를 없애되 같은 보장을 유지한다. **"성능을 위해 SEQUENCE로 바꾸자"는 미래의 제안은
이 문단을 근거로 거절해야 한다.**

### 대안 비교

| 방식 | 판정 | 이유 |
| --- | --- | --- |
| 전역 단조 시퀀스(레거시) | ❌ | 전 사용자 쓰기 직렬화. 커서 값이 무의미하게 큼 |
| **회원별 시퀀스** | ✅ | 채택 |
| Postgres identity/SEQUENCE | ❌ | 위의 커밋 순서 역전 |
| 타임스탬프 커서 | ❌ | 동일 타임스탬프, 시계 조정, 같은 커밋 순서 문제 |
| UUID 커서 | ❌ | 전순서가 없다 |
| append-only 변경 로그 | ❌ | §18 참조 |

### 커서 소유

로컬 커서는 **Viewer 스코프 로컬 DB의 `syncState` 테이블**에 있다. localStorage도,
TanStack Query도, Better Auth 세션도 아니다. 이유는 §22의 원자성 — 커서 전진이 그 페이지의
레코드 적용과 **같은 트랜잭션**이어야 하고, IndexedDB의 트랜잭션은 한 DB 안에서만 원자적이다.

축은 **owner당 하나**다. 기기당이 아닌 이유는 DB 자체가 이미 회원별이고 그 DB가 곧 기기이기
때문이다(같은 기기의 다른 브라우저 프로필은 다른 DB다). 다만 행에 `protocolEpoch`를
함께 두어, 프로토콜 마이그레이션이나 강제 전체 재동기화가 커서를 무효화할 수 있게 한다.

```ts
syncState: { key: "state",
             cursor: number, protocolEpoch: number,
             initialSyncDone: boolean, deviceId: string,
             lastSyncedAt: string | null, lastError: string | null }
```

---

## 18. Push Model

### 18.1 배치 의미론 — 원자적 거부를 유지한다

```text
서버:
  1. 배치 안 id 중복 검사 → 있으면 400
  2. 전 항목의 baseVersion을 현재 행과 대조
       행 없음 + baseVersion ≠ 0        → 충돌
       행 있음 + version ≠ baseVersion  → 충돌
       행 있음 + type ≠ 요청 type        → 충돌(타입 바꿔치기 방어)
  3. 충돌이 하나라도 있으면 **아무것도 적용하지 않고** conflicts 반환
  4. 없으면 seq를 n개 발급하고 전부 upsert
```

유지하는 이유: 배치는 로컬에서 **하나의 사용자 행동**이었던 것들의 묶음이다(초안 + 자식들,
메시지 + 방). 부분 적용은 다른 기기에 "부모는 새 판, 자식은 옛 판"인 중간 상태를 보인다.
클라이언트의 버전 확인도 전부-또는-전무일 때 훨씬 단순하다.

비용 완화: **배치를 작게 잡는다.** 200건 / 4 MB(레거시 500 / 8 MB). 한 뜨거운 레코드가
막는 무관한 레코드의 수가 그만큼 줄고, 재전송량도 줄어든다. 클라이언트는 수집 순서를
보존해 청킹하므로 부모가 자식보다 먼저 나간다(레거시와 동일).

충돌 후: `pull()` → 병합 → 재수집 → 재시도. 최대 4회, 그 뒤엔 오류로 표면화한다.

### 18.2 응답 형태 — 충돌은 오류가 아니다

```text
200 { ok: true,  cursor: <최종 seq>, conflicts: [] }
200 { ok: false, cursor: <현재 최대 seq>, conflicts: [{ id, serverVersion }] }
```

`ApiErrorBody`(`{code, message, requestId}`)로 내보내지 않는다. 두 가지 이유:
낙관적 동시성 충돌은 **정상적이고 예상된 결과**이지 요청의 실패가 아니고, 응답이
`serverVersion` 목록이라는 **데이터**를 실어야 하는데 그 봉투에는 자리가 없다.
봉투를 한 호출자를 위해 넓히는 것보다 이쪽이 맞다.

진짜 실패(검증·쿼터·잠금)는 그대로 `ApiErrorBody`다.

### 18.3 Idempotency — 유지한다

시나리오 정밀 분석(조사 §32의 질문):

```text
기기가 baseVersion=4로 보낸다 → 서버가 version=5로 커밋 → 응답이 유실
기기가 baseVersion=4로 재시도
```

**멱등 키가 없다면**: 서버는 `version(5) ≠ baseVersion(4)`로 보고 충돌을 돌려준다.
기기는 pull하고, 자기가 방금 올린 ciphertext를 되받아 복호화하고, `rev`가 로컬과 같으므로
"내 것"임을 알아채고, `serverVersion`을 5로 갱신한 뒤 dirty를 내린다. **결과적으로는 옳다.**
하지만 (a) 방금 올린 것을 통째로 되받는 왕복이 생기고, (b) 유실과 재시도 사이에 그 레코드가
또 수정되었다면 pull이 더 오래된 서버 사본을 들고 오며 dirty 가드에만 의존해 살아남고,
(c) 배치 전체가 되돌아오므로 큰 배치에서 비용이 크다.

**멱등 키가 있으면**: 같은 키 + 같은 `request_hash`면 캐시된 응답을 그대로 준다.
진짜 재시도다. 표 하나와 컬럼 다섯의 비용으로 이 모든 걸 없앤다.

→ **`Idempotency-Key`를 유지한다.** 개선점:
- 형식 `^[A-Za-z0-9_-]{16,128}$`, TTL 7일.
- 같은 키 + 다른 `request_hash` → `409 sync_idempotency_mismatch`(레거시는 `Error` throw).
- `response == ""`(진행 중) → `409 sync_idempotency_in_progress` + `Retry-After`.
- 클라이언트는 **청크마다 하나의 키**를 만들고 그 청크의 재시도 전부에 같은 키를 쓴다.
  청크 내용이 바뀌면(재수집) 새 키를 만든다.

### 18.4 재시도 정책

| 상황 | 동작 |
| --- | --- |
| 오프라인 / 네트워크 오류 | 지수 백오프 + 지터, 250ms → 최대 30s, 무한(다음 트리거까지) |
| 5xx | 위와 동일, 최대 5회 후 다음 트리거로 미룸 |
| 429 | `Retry-After` 존중, 없으면 백오프 |
| 408 / 타임아웃 | 같은 멱등 키로 재시도 |
| abort(로그아웃·언마운트) | 재시도 없음. 조용히 끝난다 |
| 200 + `ok:false`(충돌) | pull → 병합 → 재수집 → 재시도(최대 4) |
| 400 검증 실패 | **재시도하지 않는다.** 그 레코드를 격리하고 로그. 영구 오류 |
| 403 잠김 / 401 | 재시도하지 않는다. 상태 머신을 locked로 |
| 복호화 실패(pull) | 재시도하지 않는다. 건너뛰고 커서 전진 |
| 로컬 payload 인코딩 실패 | 재시도하지 않는다. 그 레코드를 격리 + 진단 |

---

## 19. Conflict Resolution

이 절이 가장 길다. 레거시를 복사하지 않는다.

### 19.1 시계 — Hybrid Logical Clock

모든 로컬 레코드가 `rev`를 갖는다.

```ts
type Rev = { t: number; c: number; d: string }   // wallMs, counter, deviceId

// 로컬 쓰기 시각
function tick(state: {t:number; c:number}, wallMs: number): Rev {
  if (wallMs > state.t) { state.t = wallMs; state.c = 0 }
  else state.c += 1
  return { t: state.t, c: state.c, d: deviceId }
}

// inbound 흡수(적용 여부와 무관하게 항상 부른다)
function absorb(state, remote: Rev, wallMs: number): void {
  const t = Math.max(state.t, remote.t, wallMs)
  if (t === state.t && t === remote.t) state.c = Math.max(state.c, remote.c) + 1
  else if (t === remote.t)             state.c = remote.c + 1
  else if (t === state.t)              state.c = state.c + 1
  else                                 state.c = 0
  state.t = t
}

// 전순서
compare(a, b) = a.t - b.t  ||  a.c - b.c  ||  (a.d < b.d ? -1 : 1)
```

HLC 상태는 `syncState` 행에 영속한다(탭·앱 재시작을 넘어야 한다).
`nowIso()`의 단조 시각과는 별개 축이다 — 그쪽은 표시·정렬, 이쪽은 병합 판정.

> **정정(1a 구현).** 이 문서의 초안은 1a에서 HLC를 `apps/web/src/lib/local-data/clock.ts`에
> 넣고 1b에 `packages/sync/src/clock.ts`로 옮기는 순서를 적었다. **그렇게 하지 않았다.**
> HLC는 기기 사이의 합의라 웹과 모바일이 한 벌을 써야 하고, 옮기는 시점에는 이미 두 벌이
> 되어 있다(모바일이 자기 것을 갖는다). 그래서 1a에서 **`@rowcat/sync`를 HLC만 담아 먼저
> 세웠다**. 웹에 있는 것은 알고리즘이 아니라 **영속 어댑터**뿐이다:
>
> ```text
> packages/sync/src/clock.ts          tickHlc · absorbHlc · compareRev · maxRev (순수)
> apps/web/.../local-data/hlc.ts      syncState 읽기 → 위 함수 호출 → 상태 쓰기
> apps/web/.../local-data/clock.ts    newLocalId · nowIso · newDeviceId (브라우저 관심사)
> ```
>
> 순수 함수는 **벽시계를 인자로 받는다**. 저장소 트랜잭션 안에서 도는 코드가 시각을 스스로
> 읽으면 한 번의 논리적 쓰기가 두 밀리초에 걸친 것으로 기록되고, 무엇보다 시계가 뒤로 간
> 상황을 테스트로 재현할 수 없다.

**왜 HLC인가**(조사 §36 비교):

| 후보 | 판정 | 이유 |
| --- | --- | --- |
| 레코드 벽시계 LWW | ❌ | 조사 §35의 실패 모드를 무조건 겪는다. 레거시가 여기 있다 |
| 서버 도착 순서 LWW | ⚠️ | 인과성을 뒤집는다: 오프라인에서 먼저 쓴 편집이 나중에 접속했다는 이유로 진다. 오프라인 우선 제품에 부적합 |
| **HLC** | ✅ | 채택. 전순서 + 인과 보존 + 상수 크기(레코드당 ~24B) |
| Lamport clock | ⚠️ | 인과성은 같지만 사람이 읽을 시각이 없어 진단·UI가 불가능 |
| 버전 벡터 | ⚠️ | **진짜 동시성을 탐지**할 수 있지만 크기가 기기 수에 비례하고, 탐지한 뒤 무엇을 할지(다중값 보존 UI)가 필요하다. 우리에겐 이미 탐지 축이 있다(아래) |
| 다중값 보존 | ⚠️ | 정본은 여전히 단일값이다. 다만 **진 쪽 값이 로컬 사본으로 남는다**(§19.5) |
| 텍스트 CRDT | ❌ | §21의 복잡도 대비 이득 없음. 초안 필드 그룹 병합으로 충분 |
| 수동 충돌 사본 | ✅ | **구현됐다**(§19.5) — 초안 그룹 충돌에 한해, 동기화되지 않는 로컬 사본으로 |

**핵심 통찰**: 우리는 버전 벡터 없이도 **진짜 동시 편집을 탐지할 수 있다.**
`local.dirty && local.serverVersion < remote.version`이면 두 기기가 같은 서버 버전에서
갈라져 각자 썼다는 뜻이다. 즉 **탐지는 낙관적 동시성이 이미 준다.** HLC는 그것을
**해결**하는 데만 쓰인다. 그래서 나중에 다중값 보존이 필요해지면 시계를 갈아엎지 않고
그 분기점에서 사본을 만들면 된다.

**드리프트 가드**: `absorb`에서 `remote.t > wallMs + 5분`이면 그대로 흡수하되 진단
카운터를 올린다. **거부하지 않는다** — 거부하면 두 기기가 서로 다른 HLC 상태로 갈라져
같은 입력에 다른 승자를 낸다.

### 19.2 판정 순서(모든 타입 공통 골격)

inbound 레코드 R, 로컬 L에 대해:

```text
1. R.envelope / R.type / R.schemaVersion을 모르면 → 무시, 커서 전진             (§19)
2. L이 없으면 → 적용(신규 생성). serverVersion = R.version, dirty = false
3. R이 묘비면 → 삭제 적용(§20). 항상 이긴다
4. L.deletedAt != null 이면 → 삭제 유지. R은 적용하지 않는다. serverVersion만 갱신 (§20)
5. R.rev < L.appliedRev 이면 → 리플레이. 무시                                  (§10.3)
6. L.dirty == false 이면 → 서버가 권위. 적용
7. L.dirty == true 이면 → **타입별 충돌 규칙**(19.3)
8. 어느 경로든 마지막에 serverVersion = R.version 을 기록한다
```

7단계에서 로컬이 이기더라도 `serverVersion`은 반드시 갱신한다. 그래야 다음 push가 올바른
`baseVersion`으로 나가 서버를 덮어쓸 수 있다(레거시의 정확한 처리).

### 19.3 타입별 규칙

#### `chat.message` — 완결 우선, 그 다음 HLC

```text
if      (!L.incomplete &&  R.incomplete) → 로컬 유지        // 완결본이 미완본을 이긴다
else if ( L.incomplete && !R.incomplete) → 원격 적용
else                                     → compare(R.rev, L.rev) > 0 ? 원격 : 로컬
```

근거: 메시지는 **완결 후 사실상 불변**이다. 같은 메시지 id에 두 기기가 동시에 쓰는
현실적 경로는 딱 하나 — 한 기기에서 스트림이 끊겨 `incomplete: true`로 저장되고, 다른
기기(또는 같은 기기의 재시도)가 완결본을 만든 경우. 그때는 **길고 완결된 쪽이 옳다.**
그 밖의 동시 수정은 이상 신호이므로 HLC 전순서로 결정적으로 접는다.

> **정정(1b 구현). 병합 결과의 `rev`는 `max(local.rev, remote.rev)` 이상이어야 한다.**
>
> 이 문서는 "로컬 유지"라고만 적었고, 그대로 구현하니 **두 기기가 영원히 서로를 덮었다.**
> 실제로 관측한 경로:
>
> ```text
> A: 완결본 rev5          B: 같은 메시지를 미완결로 확정 rev9 → push
> A가 pull → 완결 우선 규칙으로 로컬 유지 → **rev5를 그대로 달고** 다시 push
> B가 pull → rev5 < rev9 → §19.2 5단계의 **리플레이로 판정** → 무시하고 rev9를 다시 push
> A가 pull → 다시 로컬 유지 → … 무한 왕복. 마지막에 push한 쪽이 서버에 남는다.
> ```
>
> 병합 결과는 두 입력 중 **어느 쪽도 아닌 새로운 판**이다. 그 판이 둘 다보다 나중이라고
> 말해야 상대가 그것을 최신으로 읽는다. 초안(§19.3 아래)은 이미 "채택된 그룹 rev들의
> 최대값"이라 이 성질을 갖고 있었고, 메시지에만 빠져 있었다.
>
> 규칙으로 적으면: **`merge()`가 무엇을 돌려주든 그 `rev`는 두 입력의 최댓값 이상이다.**
> `packages/chat/src/sync-codec.ts`의 `mergedRev`가 그 자리다.

텍스트 CRDT를 만들지 않는 이유: 메시지 본문을 두 사람이 협업 편집하는 제품이 아니다.

#### `chat.room` — 불변 필드 보호 + HLC

```text
불변(생성 시 1회 기록, 절대 덮어쓰지 않는다):
    id, originStoryId, createdAt, seed, adult, promptProtected
가변:
    title, updatedAt

규칙: 불변 필드는 로컬 값이 있으면 유지한다(첫 기록자 승).
      가변 필드는 compare(R.rev, L.rev) 로 레코드 단위 판정.
      updatedAt = max(L.updatedAt, R.updatedAt)   // 최근 활동 시각은 합집합이 옳다
```

근거: `seed`는 획득 시점에 박히는 자기완결 스냅샷이고 그 뒤 바뀌지 않는다
(`@rowcat/chat/model.ts`가 명시한다). 불변으로 다루면 방의 **가장 큰 필드가 충돌 표면에서
빠진다** — 그게 §26b의 노이즈 문제를 대부분 해결한다.
`updatedAt`을 max로 접는 것도 중요하다: 두 기기가 각각 대화를 이어 갔다면 목록 정렬은
둘 중 늦은 쪽을 따라야 한다.

#### `authoring.draft` — 필드 그룹 병합

**유일하게 필드 단위 병합을 하는 타입이다.** 근거는 조사 §39가 지적한 그대로: A는 폰에서
제목을, B는 노트북에서 시나리오를 오프라인 편집하는 일이 실제로 일어나고, 레코드 단위
LWW는 그중 하나를 **조용히 삭제**한다. 원고는 이 제품에서 가장 되돌리기 어려운 자산이다.

필드당 스탬프를 두지 않는다(조사 §40의 경고). **여섯 그룹**으로 묶는다 —
편집기의 실제 표면과 1:1이고, 같은 그룹의 필드는 사용자가 한 화면에서 함께 고친다.

```text
meta        title, tagline, description, tags, orientation
rating      adult, visibility, promptProtected
body        scenario, playGuide
persona     suggestedPersona
defaults    defaultStartSceneId
publication publishedStoryId
```

```ts
StoryDraft.fieldRev: Record<"meta"|"rating"|"body"|"persona"|"defaults"|"publication", Rev>
```

병합:
```text
각 그룹 g에 대해:  compare(R.fieldRev[g], L.fieldRev[g]) > 0 ? R의 g 필드 채택 : L 유지
단,  publication 그룹은 단조다:
     L.publishedStoryId != null 이면 절대 null로 되돌리지 않는다.
     둘 다 non-null이고 다르면 HLC 승자를 따르되 진단 경고를 남긴다(있어선 안 되는 상태).
레코드 rev = 채택된 그룹 rev들의 최대값
```

`updateDraft(patch)`는 patch가 건드린 그룹의 `fieldRev`만 tick한다. 저장 비용은
레코드당 6개 스탬프(≈150바이트)이고, payload에서는 압축이 잘 먹는다.

> **정정(1a 구현).** 위 "레코드 rev = 채택된 그룹 rev들의 최대값"은 **병합 결과에만**
> 해당한다. 로컬에서 `StoryDraft.rev`를 `max(fieldRev)`로 **파생시키지 않는다** — 그렇게
> 하면 지금 동작이 깨진다.
>
> ```text
> rev          이 레코드가 마지막으로 건드려진 판.
>              자식이 바뀌어 부모의 활동 시각만 오른 경우에도 오른다.
> fieldRev[g]  그룹 g의 저작 필드가 마지막으로 **실제로 바뀐** 판.
> ```
>
> 자식(등장인물·로어·장면)을 고치면 초안의 `updatedAt`이 함께 오른다. 초안 목록의 정렬 축이
> 그 값이라 그래야 하는데, 그 활동은 **어느 저작 그룹도 바꾸지 않는다.** 파생으로 두면 그
> 활동이 아무 그룹에나 붙거나 일곱 번째 `activity` 그룹이 필요해지고, 둘 다 "그룹은 편집기의
> 한 화면"이라는 정의를 깬다. 그래서 세 갈래다:
>
> ```text
> 루트 필드 편집   rev = 새 rev,  fieldRev[건드린 그룹] = 같은 rev
> 자식 활동 touch  rev = 새 rev,  fieldRev 그대로
> 발행             rev = 새 rev,  fieldRev.publication = 같은 rev
> ```
>
> 한 패치가 여러 그룹을 건드려도 **리비전은 하나**다(한 번의 저장은 한 번의 논리적 변경이다).
> 패치 필드 → 그룹 표는 `@rowcat/authoring`의 `draftPatchFieldGroups` 하나가 갖는다 —
> 화면이나 저장소가 각자 판단하면 그 판단들이 갈라지고, 갈라진 순간 어떤 편집은 그룹 리비전
> 없이 저장되어 다음 병합에서 조용히 덮인다.

`A가 prompt, B가 prompt` 같은 그룹 충돌은 HLC 승자 하나가 이긴다 — **정본에서는 한쪽
판이 사라진다.** 그 판정은 지금도 그대로다. 달라진 것은 사라지는 값이 **이 기기에
남는다**는 사실 하나이고, 규칙은 §19.5에 있다.

#### `authoring.character` / `.lore` / `.scene` — 레코드 단위 HLC

```text
compare(R.rev, L.rev) > 0 ? 원격 : 로컬
```
근거: 필드가 적고 한 카드 안에서 함께 편집된다. 그룹을 나눌 자연스러운 경계가 없고,
잃는 것도 카드 하나의 한 판이다. **여기서 그룹 병합까지 하면 복잡도가 이득을 넘는다.**

#### 순서 필드(`position` / `positionIndex`)

레코드를 따라 이동한다. 별도 규칙이 없다. 그러나 동시 재정렬이 뒤섞인 순서를 만들 수 있다:

```text
A: C A B      (A가 세 레코드의 position을 0,1,2로 씀)
B: A C B      (B가 다른 값으로 씀)
병합 후: 각 레코드가 자기 HLC 승자를 따라 → 예: A=1, B=2, C=0  또는 뒤섞인 중복 값
```

**대응: 적용 배치 끝에 형제 집합을 정규화한다.**
```text
같은 draftId의 살아 있는 형제를 (position, id) 로 정렬해 0..n-1을 다시 부여한다.
정규화 자체는 dirty를 만들지 않는다(순수 로컬 표현 정리).
```
같은 레코드 집합을 가진 두 기기는 같은 결과에 도달한다. **어느 사용자의 의도도 아닐 수
있지만 수렴하고 중복이 없다.** 시퀀스 CRDT(fractional indexing, RGA)를 도입하지 않는
이유: 등장인물·로어·장면은 보통 10개 미만이고, 동시 재정렬은 드물며, 틀렸을 때의 대가가
"순서가 예상과 다르다"(사용자가 다시 끌면 고쳐진다)이지 데이터 유실이 아니다.

정규화가 dirty를 만들지 않는 것이 중요하다 — 만들면 두 기기가 서로의 정규화를
push하며 무한 왕복한다.

> **정정(1b 구현). 정규화는 순서값이 실제로 겹칠 때만 돈다.**
>
> 무조건 0..n-1로 다시 매기면 **페이지 경계**에서 사고가 난다. 이 문서는 "적용 배치 끝"을
> 한 번의 전체 적용으로 가정했지만, 실제 pull은 페이지 단위이고 자식들이 여러 트랜잭션에
> 나뉘어 도착한다. 관측한 실패:
>
> ```text
> 자식 3(position 3)만 먼저 도착 → 살아 있는 형제가 그것뿐이라 position을 0으로 눌러 버린다
> 자식 0(position 0)이 나중에 도착 → 둘 다 0 → id 무작위 tie-break로 순서가 뒤집힌다
> ```
>
> 구멍(1, 4, 7)은 아무 해도 끼치지 않는다 — 조회가 `(position, id)` 전순서로 정렬하므로
> 표시 순서는 그대로다. 실제로 고쳐야 하는 것은 **중복**뿐이고, 중복이 없으면 손대지 않는다.
> 그러면 부분 집합은 건드려지지 않고, 동시 재정렬이 만든 겹침만 펴진다.

### 19.4 요약표

| 타입 | 규칙 | 잃을 수 있는 것 |
| --- | --- | --- |
| `chat.room` | 불변 필드 보호 + 레코드 HLC, `updatedAt`=max | 제목 한 판 |
| `chat.message` | 완결 우선 → 레코드 HLC | 사실상 없음 |
| `authoring.draft` | 5그룹 필드 병합 | 같은 그룹 동시 편집 시 한쪽 판 — **로컬 사본으로 남는다**(§19.5) |
| `authoring.character` | 레코드 HLC | 카드 하나의 한 판 |
| `authoring.lore` | 레코드 HLC | 항목 하나의 한 판 |
| `authoring.scene` | 레코드 HLC | 장면 하나의 한 판 |
| 순서 필드 | HLC + **중복이 있을 때만** 정규화 | 재정렬 의도 |
| 삭제 | **항상 이긴다** | 오프라인 편집 |

모든 타입에 걸리는 불변식 하나(1b에서 발견): **병합 결과의 `rev`는 두 입력의 최댓값
이상이다.** 어기면 상대가 그 결과를 리플레이로 판정해 두 기기가 수렴하지 않는다(§19.3 정정).

### 19.5 같은 그룹 충돌의 **로컬 복구**

정본의 수렴은 위 규칙 그대로다. 이 절이 더하는 것은 **그 수렴이 버린 값을 이 기기가 들고
있다가 사용자가 다시 쓸 수 있다**는 사실 하나다.

```text
같은 그룹 동시 편집
    → HLC가 여전히 정본 승자를 고른다            (§19.3 그대로)
    → 진 그룹의 값이 **로컬 사본**으로 남는다      동기화되지 않는다
    → 두 기기는 지금까지와 똑같이 수렴한다
    → 복원은 **새 편집**이다                     평범한 저작 쓰기 경로를 지난다
```

**채널이 둘이고, 나르는 것이 다르다.** 이것이 이 슬라이스에서 가장 중요한 경계다:

```text
MergeContext.note      분류와 건수만. SyncDiagnosticEvent로 나가고 로그·텔레메트리에 닿는다
MergeContext.recover   사라지는 **사용자 값**. 이 기기의 저장소에서 멈춘다
```

하나로 합치면 그 순간 `SyncDiagnosticEvent`가 평문 운반 수단이 된다. 그래서
`authoring_draft_group_conflict`는 지금도 **메타데이터 전용**이고, 값은 그 옆의 다른
통로로 간다.

**프로토콜은 이 층의 존재를 모른다.** 서버 라우트도, 새 레코드 타입도, 봉투 버전도,
`SYNC_PROTOCOL_VERSION`도 한 글자 바뀌지 않았다 — 사본이 동기화되면 그것이 **두 번째
충돌 도메인**이 되고, 충돌을 풀려고 만든 것이 충돌을 만든다.

#### 무엇이 남는가

| 축 | 값 | 근거 |
| --- | --- | --- |
| 범위 | 진 **그룹 하나**의 필드 값 | 초안 전체를 뜨면 복원이 다른 그룹의 정당한 최신 값까지 되돌린다 |
| 신원 | `(타입, 레코드, 그룹, 진 리비전)` | 결정적이라 pull 재시도·재연결·재시작이 사본을 하나로 접는다 |
| 시각 | **처음** 관찰한 시각 | 재관찰이 밀면 몇 주 전에 잃은 원고가 "방금 생긴 일"로 읽힌다 |
| 방향 | 이기든 지든 **사라지는 쪽** | 한 방향만 남기면 절반의 패배가 그냥 사라진다 |
| 제외 | `publication` | 단조 그룹이라 "진 판이 사라지는" 충돌이 아니고, 되돌릴 값도 아니다 |

#### 진단보다 좁다 — 그리고 그것이 규칙이다

`note`가 세는 것은 "그룹 리비전이 갈렸다"이고, 그 조건은 **아무것도 잃지 않은 병합에서도
참이다**(A가 제목만·B가 프롬프트만 고치면 두 그룹의 리비전이 둘 다 갈린다). 거기서 사본을
남기면 사용자는 잃은 적 없는 편집의 안내를 받고, 그 사본에는 자기가 이미 갱신한 옛 값이
들어 있다 — 되돌리면 **오히려 최신 값을 잃는다.**

그래서 사본은 **공통 조상의 증거**를 한 번 더 본다: 진 쪽의 그룹 리비전이 이긴 쪽의
`fieldRev` 어딘가에 그대로 있으면 두 레코드는 그 쓰기를 함께 물려받았다는 뜻이고(리비전은
쓰기 하나의 신원이다), 진 쪽은 그 뒤로 그 그룹을 손대지 않았으므로 사라지는 것이 없다.
반대 방향은 증명이 아니라 **안전한 쪽으로 트는 기본값**이다 — 쓸데없는 사본 하나는
사용자가 지우면 되지만, 남기지 않은 원고는 우리가 돌려줄 수 없다.

#### 원자성

사본은 **병합 결과와 같은 로컬 트랜잭션**에서 커밋된다(웹 Dexie·모바일 SQLite의
`applyPull`). 위험한 상태는 하나뿐이다:

```text
정본 병합 결과가 커밋됨 + 진 쪽 사본은 없음   ← 이 기능이 막으려던 바로 그 손실
```

코덱은 후보를 **말하기만** 한다(`merge`는 여전히 부수효과 없는 결정적 함수다). 쓰는 일은
그 커밋이 한다.

#### 복원은 새 편집이다

옛 `rev`·`fieldRev`·`dirty`·`serverVersion`·`updatedAt`을 되돌리지 않는다. 되돌리면 그
레코드는 서버가 아는 판보다 낮은 시계를 달고 나가 상대 기기에서 리플레이로 무시되고,
되살렸다고 믿은 원고가 이 기기에만 남는다. 사용자가 `복원`을 누른 것은 **그 값을 지금
쓰기로 했다**는 새 결정이므로 `AuthoringStore.updateDraft` 하나를 지나 새 리비전을 받고,
평범하게 dirty가 되어 자동 동기화가 평소처럼 깨어난다.

#### 남는 경계

- **`sync_stale_inbound` 경로는 사본을 만들지 않는다.** 그 판정은 도메인 코덱을 부르기
  전에 끝나므로(§19.2) 어느 그룹이 갈렸는지 알 수 없다. 그 경로에서 잃는 것은 상대 기기가
  이미 push한 판이고, 그 기기에서도 dirty가 내려간 뒤라 양쪽 어디에도 사본이 남지 않는다.
- **보존 기간이 없다.** 사본은 복원되거나 사용자가 버릴 때까지 남는다 — 며칠 뒤 지우는
  규칙을 발명하면 이 기능이 지키려던 원고를 이 기능이 지운다.
- **초안이 지워져도 사본은 남는다.** 되돌릴 곳이 없다는 사실을 화면이 말하고, 내용은 그대로
  읽힌다. 그룹 하나의 값으로 초안을 **다시 만들어 주지 않는다** — 사용자가 쓴 적 없는
  나머지가 전부 빈 문서는 복원이 아니다.

---

## 20. Deletion / Tombstones

### 20.1 결정: 소프트 삭제 일원화. 별도 묘비 테이블을 두지 않는다.

```text
로컬:   레코드 행이 남고 deletedAt != null
와이어: sync_record.deleted = true, ciphertext = null
```

레거시는 **별도 로컬 묘비 테이블**(`sync_tombstones`)을 썼는데, 그건 로컬이 hard-delete를
했기 때문이다. 우리 제작 도메인은 이미 소프트 삭제이고(`AuthoringSoftDelete`),
같은 규칙을 대화에도 넓히면 묘비 테이블 자체가 필요 없어진다.

세 후보 비교(조사 §43):

| 후보 | 판정 | 이유 |
| --- | --- | --- |
| 임베드 묘비(레코드 잔존 + `deletedAt`) | ✅ | 채택. 제작이 이미 이 모양. 스키마 추가 0 |
| 별도 묘비 테이블 | ❌ | 두 번째 진실원. 레코드와 묘비가 동시에 존재하는 상태 표현 가능 |
| 하이브리드 | ❌ | 두 도메인의 삭제 의미가 갈라진다. 한 규칙이 낫다 |

### 20.2 삭제가 편집을 항상 이긴다

```text
A가 삭제, B가 오프라인 편집:
  B가 pull → 묘비 도착 → B의 로컬 편집을 버리고 삭제 적용, dirty를 내린다
  B가 먼저 push → A가 pull → A는 이미 지웠으므로 §19.2 4단계에서 적용 거부
                → A의 묘비가 나중에 push되어 B의 편집을 서버에서도 덮는다
```

**부활은 구조적으로 불가능하다**: 로컬 행이 지워지지 않으므로 "이 id는 처음 보는 것"이라는
판정이 나올 수 없고, 삭제 상태의 로컬 레코드는 어떤 inbound도 되살리지 못한다.

**대가**: B의 오프라인 편집이 사라진다. 이것을 받아들이고 제품 문구로 정직하게 다룬다.
대안(삭제-편집 충돌 시 사본 보존)은 UI가 필요하고, 그 UI 없이 사본만 만들면 사용자는
지운 것이 안 지워졌다고 읽는다 — 더 나쁘다.

### 20.3 대화 삭제 — **1a에서 만들었다**

> **정정(1a 구현).** 아래 감사는 1a 이전의 상태다. 지금은 `ChatRoom`·`ChatMessage`가
> `deletedAt`을 갖고 `ChatStore`에 `deleteRoom`·`deleteMessage`가 있으며, 모든 조회가
> 묘비를 거른다. **UI는 여전히 없다**(그건 이 슬라이스의 범위가 아니다).

감사 결과(`packages/chat/src/model.ts`, `store.ts`, `apps/web/src/lib/local-chat/store.ts`):

```text
ChatRoom     deletedAt 필드 없음
ChatMessage  deletedAt 필드 없음
ChatStore    delete 계열 메서드 없음 (createRoom/getRoom/listRooms/
             listRecentMessages/appendMessage/updateMessage/touchRoom 뿐)
사용자 대면 삭제 UI  없음
물리 삭제 경로       없음 (로컬 DB 자체를 지우는 것 외에)
```

**동기화 전에 반드시 만들어야 한다.** 삭제 없이 동기화를 켜면 사용자가 방을 지울 방법이
생겼을 때 그 삭제를 전파할 표현이 없고, 그때 스키마를 바꾸는 일은 이미 동기화 중인
데이터를 이관하는 일이 된다.

필요한 것(모델과 저장소만, **UI는 만들지 않는다**):

```ts
ChatRoom    extends ChatSyncMeta, ChatSoftDelete   // deletedAt: string | null
ChatMessage extends ChatSyncMeta, ChatSoftDelete

ChatStore.deleteRoom(id): Promise<void>
ChatStore.deleteMessage(id): Promise<void>
// 모든 조회(getRoom/listRooms/listRecentMessages)가 deletedAt != null을 거른다
```

### 20.4 방 삭제와 메시지 — 와이어 비용 결정

방 하나에 메시지가 5,000개일 수 있다. 메시지마다 묘비를 push하면 5,000 레코드다.

**결정: 방 묘비 하나만 보낸다. 수신 기기가 캐스케이드한다.**

```text
삭제 기기:
  한 트랜잭션에서 방을 소프트 삭제하고, 그 방의 모든 메시지도 소프트 삭제한다.
  방만 dirty=true. **메시지는 dirty를 세우지 않는다** → push되지 않는다.

수신 기기 (chat.room 묘비 적용):
  로컬의 그 roomId 메시지를 전부 소프트 삭제한다(같은 트랜잭션).
  이들도 dirty를 세우지 않는다.

늦게 도착하는 고아 메시지 (그 방의 메시지가 서버에 남아 나중에 pull됨):
  로컬 방이 삭제 상태이므로 **삭제된 채로 기록한다**(deletedAt = 방의 deletedAt).
  적용하되 보이지 않는다. dirty 없음. 부활하지 않는다.
```

서버에는 그 방의 메시지 ciphertext가 남는다. **v1은 그것을 받아들인다** — 계정 삭제가
전부 지우고, 쿼터는 소유자 자신에게만 영향을 준다. 후속 슬라이스에서 **자식 묘비 스윕**
(삭제된 방의 메시지 묘비를 배치로 천천히 push)을 붙여 회수한다. 확장점만 남긴다.

제작은 반대다: `deleteDraft`가 이미 자식을 한 트랜잭션에서 소프트 삭제하고 각자
`dirty=true`가 되므로(§23 감사 참조) 자식 묘비가 자연스럽게 push된다. 자식이 수십 개
규모라 비용이 없다. **그대로 둔다.**

### 20.5 로컬 보존과 압축

소프트 삭제 행을 영원히 본문째 들고 있으면 저장소가 샌다.

```text
1단계 (즉시)   deletedAt 설정. 본문 보존. 로컬 "휴지통"이 가능한 창.
2단계 (압축)   push가 확인되고(dirty=false) 삭제 후 30일이 지나면 본문 필드를 비운다.
               남는 것: id, type, deletedAt, serverVersion, rev.  ≈200바이트.
               삭제된 방의 메시지는 즉시 2단계로 간다(본문 보존 이유가 없다).
```
압축은 dirty를 만들지 않는다(와이어 표현이 `deleted:true`로 이미 동일하다).
v1에는 압축 패스를 **구현만 하고 스케줄링은 켜지 않아도 된다** — 켜는 시점은 저장소
사용량이 문제가 될 때다.

### 20.6 서버 묘비 보존과 stale 기기

**v1: 영구 보존.** 이것이 조사 §44의 부활 문제를 완전히 없앤다.

미래에 GC가 필요해지면:
```text
GC:   sync_record 에서 deleted=true 이고 updated_at < now - 180일 인 행을 삭제하고
      sync_state.tombstone_horizon_seq 를 그 행들의 최대 seq 로 올린다.
pull: since > 0 이고 since < tombstone_horizon_seq 이면
      410 { code: "sync_cursor_expired" } 를 준다.
클라: 전체 재동기화(§24)로 전환한다.
```
`tombstone_horizon_seq` 열을 **지금** 만들어 두는 것이 요점이다. 나중에 추가하면
그 시점의 모든 기기가 지평선을 모르는 채 GC를 만나 부활을 일으킨다.

---

## 21. Local Store Architecture

### 21.1 패키지 경계

```text
packages/contracts/src/sync.ts
    와이어 zod 스키마(PushItem/PushRequest/PushResponse/PullRecord/PullResponse/
    Keyring*/Pairing*), 오류 코드, 상한 상수, Rev 스키마.
    의존: zod 뿐. 저장소 규칙에 따라 "선 위를 지나는 모양"은 전부 여기 산다.
    **1a 시점에는 `Rev` 하나뿐이다.**

packages/sync/            ← 신규 @rowcat/sync
    봉투 암호화(crypto.ts) · 코덱 바이트(codec.ts) · 키링(keyring.ts) ·
    페어링(pairing.ts) · HLC(clock.ts) · 엔진(engine.ts: pull/push/bootstrap) ·
    포트(store.ts / transport.ts / device-key.ts / aead.ts) ·
    충돌 규칙 골격(merge.ts) · 코덱 레지스트리(registry.ts) · 상태 머신(controller.ts)
    의존: @rowcat/contracts, @noble/*, fflate
    금지: React, Dexie, IndexedDB, SQLite, fetch, DOM, Node API,
          **@rowcat/chat, @rowcat/authoring**

packages/chat/src/sync-codec.ts        ChatRoom·ChatMessage ↔ payload + 충돌 규칙
packages/authoring/src/sync-codec.ts   StoryDraft·자식 ↔ payload + 필드 그룹 병합
    의존: @rowcat/contracts (타입 선언만). @rowcat/sync를 import하지 않는다.

apps/web/src/lib/local-sync/           Dexie SyncStore 어댑터, device-key, subtle AEAD,
                                       스코프가 소유하는 컨트롤러
apps/api/src/services/sync/index.ts          불투명 저장 규칙
apps/api/src/routes/me/sync.ts            /v2/me/sync/*
packages/sdk/src/sync.ts               전송
```

> **정정(1a 구현).** 두 가지를 위 배치와 다르게 넣었다.
>
> 1. **`SyncCodec`은 `contracts`에 두지 않는다.** 그건 모양이 아니라 **행동**
>    (`encode`·`decode`·`merge`)이고, 계약 패키지는 서버가 요청을 파싱하려고 지고 다니는
>    짐이다. 코덱이 실제로 생기는 1b에 **`@rowcat/sync`**가 그 인터페이스를 갖는다. 순환은
>    그래도 없다: 도메인 패키지는 코덱을 자기 파일에 두되 `@rowcat/sync`를 import하지 않고,
>    앱이 조립한다(§21.2의 옵션 B는 그대로다).
> 2. **`DraftFieldGroup`은 `@rowcat/authoring`이 갖는다.** 어느 필드들이 한 화면에서 함께
>    고쳐지는가는 제작의 병합 어휘이고 편집기가 바뀌면 같이 바뀐다 — 계약에 두면 그 그룹을
>    영원히 모를 서버가 그 어휘를 지고 다닌다.
>
> 1a가 실제로 만든 것은 이것뿐이다:
>
> ```text
> packages/sync/
>   package.json · tsconfig.json
>   src/index.ts        헤더 주석: 이 패키지가 **갖지 않는 것**과 이유
>   src/clock.ts        HLC tick · absorb · compare · max (순수, 벽시계 주입)
>   src/clock.test.ts
> ```
>
> 나머지(암호화·키링·엔진·컨트롤러·코덱·서버·SDK·`local-sync` 어댑터)는 전부 1b다.

계층표 추가:

| 패키지 | 의존해도 되는 것 | 들어오면 안 되는 것 |
| --- | --- | --- |
| `sync` | `contracts` | React, Dexie/IndexedDB, SQLite, fetch, DOM, Node API, `chat`, `authoring`, `sdk` |

### 21.2 Payload Ownership — **옵션 B**를 고른다

**각 도메인이 자기 버전 코덱을 export하고, `@rowcat/sync`는 일반 코덱 인터페이스만 안다.**

> **정정(1a 구현).** 아래 인터페이스의 자리는 `contracts`가 아니라 **`@rowcat/sync`**다
> (§21.1의 정정). 옵션 B의 논리는 그대로다 — 도메인은 자기 코덱을 갖고 `sync`를 import하지
> 않으며, 조립은 앱이 한다. 1a에는 코덱이 없으므로 이 인터페이스도 아직 없다.

```ts
// 자리: packages/sync/src/registry.ts (1b) — 아래 주석의 "contracts"는 정정 전 표기다
export interface SyncCodec<TRecord> {
  readonly type: string                 // "chat.room"
  readonly schemaVersion: number
  encode(record: TRecord): unknown      // payload.data
  decode(data: unknown, schemaVersion: number): TRecord | null   // null = 적용 불가
  merge(local: TRecord, remote: TRecord): TRecord                // 타입별 충돌 규칙
  revOf(record: TRecord): Rev
  withRev(record: TRecord, rev: Rev): TRecord
}

// 앱이 조립한다
createSyncEngine({ codecs: [...chatCodecs, ...authoringCodecs], store, transport, ... })
```

| 후보 | 판정 | 근거 |
| --- | --- | --- |
| A: `@rowcat/sync`가 `chat`+`authoring`을 import하고 payload를 소유 | ❌ | 동기화 패키지가 모든 도메인을 아는 허브가 된다. 도메인이 필드를 하나 늘릴 때마다 프로토콜 패키지를 고쳐야 하고, "제작이 대화 규칙에 묶일 이유가 없다"는 기존 경계가 깨진다 |
| **B: 도메인별 버전 코덱 + 일반 인터페이스** | ✅ | **채택.** 순환 없음(인터페이스가 `contracts`에 있어 도메인은 `sync`를 모른다). 새 도메인이 늘어도 `sync`는 불변. 코덱 단위 테스트가 도메인 테스트 옆에 산다 |
| C: 별도 local-data contracts 패키지 | ❌ | 다섯 번째 패키지의 유일한 일이 "모델 옆에 있으면 될 스키마를 들고 있는 것". 저장소 규칙상 그 자리는 이미 `contracts`다 |

평가 축별로:
- **결합도**: B가 가장 낮다. `sync`는 여섯 타입의 존재를 모른다.
- **크로스 플랫폼 재사용**: 코덱은 순수 TS라 Expo가 그대로 쓴다. A도 같지만 A는
  `sync`가 도메인 패키지를 끌고 들어간다.
- **스키마 마이그레이션**: 코덱의 `decode(data, schemaVersion)`이 자기 마이그레이션을
  소유한다. 레거시의 `migrateLegacyPayload`가 `payload.ts` 한 파일에 뭉쳐 있던 것과 반대.
- **미래 도메인 추가**: B는 새 파일 하나 + 레지스트리 등록 한 줄.
- **순환**: B는 0. A는 `sync → chat`, 그리고 언젠가 `chat`이 sync 타입을 참조하고 싶어지면 순환.
- **테스트 용이성**: B는 코덱을 도메인 테스트에서 단독으로, 엔진을 가짜 코덱으로 테스트한다.

### 21.3 SyncStore 포트

```ts
interface SyncStore {
  /** 커서·에폭·deviceId·HLC 상태·initialSyncDone. 한 번의 읽기. */
  readState(): Promise<SyncLocalState>

  /** deviceId·HLC 상태 초기화(최초 1회). 트랜잭션 하나. */
  initState(seed: { deviceId: string }): Promise<SyncLocalState>

  /**
   * push 후보 수집. all=true면 dirty 무시 전체 스캔(부트스트랩).
   * 개수·바이트 상한을 받아 스토어가 커서로 훑는다(전량 메모리 적재 금지).
   */
  collectOutbound(opts: {
    limit: number; all?: boolean
  }): Promise<Array<{ id: string; type: string; baseVersion: number
                      deleted: boolean; payload: unknown; rev: Rev }>>

  /** push 성공 반영. **트랜잭션 하나.** rev가 수집 시점과 같을 때만 dirty를 내린다. */
  commitPush(acks: Array<{ id: string; type: string
                           version: number; rev: Rev }>): Promise<void>

  /**
   * pull 한 페이지 적용. **트랜잭션 하나 안에서 레코드 적용 + 커서 기록 + HLC 흡수.**
   * 이것이 이 포트의 존재 이유다.
   */
  applyPull(page: {
    records: Array<{ id: string; type: string; version: number
                     deleted: boolean; payload: unknown | null; rev: Rev | null }>
    cursor: number
  }): Promise<{ applied: number; ignored: number }>

  /** 전체 재동기화 준비: 커서 0, 에폭 +1. 로컬 데이터는 건드리지 않는다. */
  resetCursor(): Promise<void>
}
```

**포트에 드러나지 않는 것**: Dexie `Table`, `Collection`, `liveQuery`, IndexedDB 트랜잭션,
SQLite 문. **포트가 보장하는 것**: `applyPull`과 `commitPush`가 각각 원자적이라는 계약.
추상화가 원자성을 흐리지 않게 하려면 트랜잭션 경계를 **메서드 경계와 일치**시켜야 하고,
그래서 이 인터페이스의 메서드가 "연산"이 아니라 "커밋 단위"다.

`applyPull`이 코덱 디코드·병합까지 하는가? **아니다.** 엔진이 복호화·디코드·병합 판정을
하고 스토어에는 **적용할 최종 레코드**를 준다... 로 하면 스토어가 로컬 현재 값을 읽어야
하는 병합 판정을 엔진이 할 수 없다(엔진은 로컬을 모른다).
**해결**: 엔진이 복호화 + 디코드까지 하고, `applyPull`에 `codec.merge`를 콜백으로 넘긴다.
스토어는 트랜잭션 안에서 로컬을 읽고, 콜백으로 병합하고, 쓴다. 순수 규칙은 여전히
도메인 코덱에 있고 트랜잭션 경계는 스토어에 남는다.

### 21.4 웹 Dexie 어댑터

```text
apps/web/src/lib/local-sync/store.ts   createDexieSyncStore(db: LocalDb): SyncStore
```
`LocalDataStores`에 세 번째 항목으로 합류한다:
```ts
interface LocalDataStores { chat: ChatStore; authoring: AuthoringStore; sync: SyncStore }
```
`activation.ts`의 `defaultLoader`가 같은 `db` 인스턴스로 셋을 만든다. 이것이 §4의
"한 회원 → 연결 하나 → 저장소 여럿"이 동기화를 위해 설계됐다는 사실의 회수 지점이다.

---

## 22. Atomicity Matrix

| # | 연산 | 반드시 한 트랜잭션인 것 | Dexie | SQLite |
| --- | --- | --- | --- | --- |
| 1 | 로컬 레코드 편집 | 필드 쓰기 + `updatedAt` + `dirty=1` + `rev` tick + HLC 상태 저장 | `rw [table, syncState]` | `BEGIN IMMEDIATE` |
| 2 | 메시지 추가 | 메시지 add + 방 `updatedAt`/`dirty` + 두 `rev` + HLC | `rw [messages, rooms, syncState]` | 동일 |
| 3 | 방 삭제 | 방 `deletedAt`+`dirty` + 그 방 메시지 전부 `deletedAt`(dirty 없음) + `rev` | `rw [rooms, messages, syncState]` | 동일 |
| 4 | 초안 삭제 | 초안 + 세 자식 테이블 `deletedAt`+`dirty` + `rev` | `rw [drafts, chars, lore, scenes, syncState]` | 동일 |
| 5 | 자식 재정렬 | 형제 전원의 position + `dirty` + `rev` + 부모 touch | `rw [table, drafts, syncState]` | 동일 |
| 6 | **pull 페이지 적용** | **그 페이지의 모든 레코드 적용 + 커서 기록 + HLC 흡수** | `rw [모든 레코드 테이블, syncState]` | 동일 |
| 7 | push 확인 | 각 레코드 `serverVersion` + 조건부 `dirty=0` + 묘비 압축 | `rw [테이블들, syncState]` | 동일 |
| 8 | 부트스트랩 완료 | 마지막 커서 + `initialSyncDone=true` | `rw [syncState]` | 동일 |
| 9 | 전체 재동기화 준비 | 커서 0 + 에폭 +1 | `rw [syncState]` | 동일 |
| 10 | 순서 정규화 | 형제 position 재부여(**dirty 없음**) — 6번 트랜잭션 안에서 | 6과 동일 | 동일 |

### 6번이 가장 중요하다

```text
금지: applyInbound(...) ; await setCursor(...)      ← 레거시 웹
금지: 트랜잭션 없이 적용 후 커서                       ← 레거시 모바일
필수: db.transaction("rw", [...], async () => { 적용...; 커서 쓰기 })
```

이유: 커서가 먼저 커밋되고 적용이 실패하면 **그 페이지의 레코드가 영원히 오지 않는다.**
반대 순서(적용 후 커서)라면 재적용은 멱등하니 안전하지만, 그 순서를 코드가 아니라
**트랜잭션이 강제**해야 한다. 리팩터링 한 번이 순서를 뒤집을 수 있기 때문이다.

`ignored`(알 수 없는 타입·복호화 실패)도 **같은 트랜잭션 안에서 "의도적으로 무시됨"으로
간주**되어 커서가 전진한다. 이건 유실이 아니라 §19의 설계다.

### SQLite 매핑

전부 1:1이다. `expo-sqlite`의 `withExclusiveTransactionAsync`(또는
`BEGIN IMMEDIATE … COMMIT`)가 Dexie의 `rw` 트랜잭션과 같은 보장을 준다.
**IndexedDB에서만 편한 추상은 만들지 않았다**: 위 어느 연산도 Dexie 고유 기능
(`Collection.modify`, 자동 커밋, `liveQuery`)에 의존하지 않는다. 반대로 SQLite에서만
편한 것(중첩 SQL, FK 제약)도 쓰지 않는다 — 참조 무결성은 §28처럼 애플리케이션이 다룬다.

한 가지 실제 차이: Dexie 트랜잭션은 **비동기 콜백 안에서 트랜잭션 밖 await를 만나면
자동 커밋**된다. 그래서 `applyPull` 구현은 트랜잭션 콜백 안에서 네트워크·크립토를
절대 부르지 않는다 — 복호화와 디코드는 **트랜잭션 진입 전에** 끝난다. 이건 설계 제약으로
문서화한다.

> **정정(1b 구현). 아웃바운드 수집을 위해 Dexie v4가 필요했다.**
>
> `dirty` 단일 인덱스로는 "이 id 다음부터"를 표현할 수 없어, 창 단위로 이어서 훑는 것이
> 불가능하다. 오프셋으로 건너뛰는 우회는 더 나쁘다 — 훑는 도중 push가 확정되어 dirty가
> 내려가면 오프셋이 밀려 **레코드 하나를 조용히 건너뛴다.**
>
> 그래서 v4에서 `dirty`를 `[dirty+id]` 복합 인덱스로 **갈아 끼웠다**(개수는 그대로다).
> 복합 인덱스의 선행 컬럼이 `dirty`라 기존 동등 조회는 그대로 타고, 그 위에 id 하한을
> 얹을 수 있다. 데이터가 바뀌지 않으므로 upgrade 함수는 없다.
>
> 부트스트랩(`all: true`)은 기본키를 훑는다 — dirty와 무관해야 하기 때문이다.

---

## 23. Current Mutation Audit

기준: `apps/web/src/lib/local-chat/store.ts`, `apps/web/src/lib/local-authoring/store.ts`,
`packages/chat/src/model.ts`, `packages/authoring/src/model.ts`.

판정 축: ① 안정 id를 쓰는가 ② `dirty`를 세우는가 ③ `serverVersion`을 보존하는가
④ 필요한 다중 레코드 트랜잭션이 있는가 ⑤ (동기화 도입 시) `rev` tick이 필요한가

### ChatStore

| 메서드 | ① | ② | ③ | ④ | 판정 |
| --- | --- | --- | --- | --- | --- |
| `createRoom` | ✅ UUID, `add` | ✅ `freshSyncMeta` | ✅ 0 | 단일 | **안전**. `rev` 추가만 |
| `getRoom` / `listRooms` | — | — | — | — | 읽기. **삭제 필터 추가 필요** |
| `listRecentMessages` | ✅ 커서=id | — | — | — | 읽기. **삭제 필터 추가 필요** |
| `appendMessage` | ✅ | ✅ 메시지 + 방(`markLocalUpdate`) | ✅ | ✅ `rw [messages, rooms]` | **안전**. §26b 참조 |
| `updateMessage` | ✅ | ✅ 메시지 + 방 | ✅ | ✅ | **안전** |
| `touchRoom` | ✅ | ✅ | ✅ | ✅ | **안전** |
| `deleteRoom` | — | — | — | — | **없다. 만들어야 한다**(§20.3) |
| `deleteMessage` | — | — | — | — | **없다. 만들어야 한다** |

### AuthoringStore

| 메서드 | ① | ② | ③ | ④ | 판정 |
| --- | --- | --- | --- | --- | --- |
| `createDraft` | ✅ `add` | ✅ | ✅ 0 | 단일 | 안전 |
| `updateDraft` | ✅ | ✅ `markAuthoringUpdate` | ✅ | ✅ | 안전. **`fieldRev` tick 추가**(§19.3) |
| `deleteDraft` | ✅ | ✅ 부모+세 자식 | ✅ | ✅ 4테이블 | 안전 |
| `createCharacter/Lore/StartScene` | ✅ | ✅ 자식 + 부모 touch | ✅ | ✅ | 안전 |
| `updateCharacter/Lore/StartScene` | ✅ | ✅ 자식 + 부모 touch | ✅ | ✅ | 안전 |
| `deleteCharacter/Lore` | ✅ | ✅ | ✅ | ✅ | 안전 |
| `deleteStartScene` | ✅ | ✅ 장면 + 초안(기본 도입부 이동) | ✅ | ✅ | 안전 |
| `reorder*` | ✅ | ✅ 형제 전원 + 부모 | ✅ | ✅ `bulkPut` | 안전. §19.3 정규화와 상호작용 |
| `setDefaultStartScene` | ✅ | ✅ | ✅ | ✅ | 안전 |
| `markPublished` | ✅ | ✅ (`markDraftPublished`가 `dirty`를 끄지 않는다 — 의도된 것) | ✅ | ✅ | 안전 |
| `loadPublicationSource` | — | — | — | ✅ `r` 4테이블 | 읽기. 안전 |

### 결론: 현재 mutation 중 **동기화 불변식을 깨는 것은 하나도 없다.**

이건 우연이 아니라 `ChatSyncMeta`·`AuthoringSyncMeta`·`markLocalUpdate`·
`markAuthoringUpdate`를 미리 넣어 둔 결과다. 남은 문제는 **모델에 없는 것**이지
있는 것이 틀린 게 아니다.

### 동기화 전에 필요한 변경(마이그레이션 5종)

| # | 변경 | 이유 | 비용 |
| --- | --- | --- | --- |
| M1 | `dirty: boolean` → `dirty: 0 \| 1` **+ 인덱스** | **IndexedDB는 boolean을 키로 쓸 수 없다.** 인덱스가 없으면 push마다 전 테이블 스캔이고, 메시지가 10만 건이면 실사용 불가. 레거시가 같은 이유로 숫자를 썼다 | Dexie v3 upgrade에서 전 행 재작성(1회) |
| M2 | 모든 레코드에 `rev: Rev` | HLC 병합 축(§19.1) | upgrade에서 `{t: Date.parse(updatedAt), c: 0, d: deviceId}`로 백필 |
| M3 | `ChatRoom`/`ChatMessage`에 `deletedAt: string \| null` | §20.3 | upgrade에서 `null` 백필 |
| M4 | `StoryDraft`에 `fieldRev` 6그룹 | §19.3 | upgrade에서 전부 `rev`와 같은 값으로 백필 |
| M5 | `syncState` 테이블 신설 | 커서·에폭·deviceId·HLC 상태 | 새 테이블(기존 행 무영향) |

M1이 유일하게 **기존 행을 다시 쓰는** 변경이다. 지금 하면 몇 MB 규모이고, 동기화를
켠 뒤에 하면 그 마이그레이션이 다른 기기와의 정합성 문제까지 안게 된다.
**M1을 뒤로 미루지 않는 것이 이 문서의 실행 권고 중 가장 시간 민감한 항목이다.**

> **정정(1a 구현).** M1–M5는 전부 들어갔다(Dexie v3, §35.1). M2의 백필에는 문서가 적지
> 않은 조건이 하나 더 붙었다: **`syncState.hlcT`를 백필된 `rev.t`의 최댓값에서 시작한다.**
> 0에서 시작하면 벽시계가 뒤로 가 있는 기기의 첫 편집이 자기 옛 판보다 오래된 리비전을
> 받는다.

M2에서 `d: deviceId`를 백필하려면 upgrade 시점에 deviceId가 있어야 한다. upgrade 함수가
그 자리에서 발급하고 `syncState`에 함께 쓴다(M5와 같은 버전).

---

## 24. First-enable / Bootstrap Algorithm

```text
enableSync():
  ① 스코프 확인             viewerId 확정 + LocalDataStores 인스턴스 캡처(소유권 토큰)
  ② GET /v2/me/sync/keyring
     ├ null    → setup()      DEK 생성 → POST keyring(409면 ③으로) → remember → 복구코드 1회 표시
     └ 존재    → unlock()     ├ 기억된 기기 → tryAutoUnlock + verifyUnlock
                              ├ 복구 코드 입력
                              └ (슬라이스3) 페어링
  ③ 소유권 재확인            ownsStore(stores.sync)가 false면 여기서 끝낸다
  ④ state = store.readState()
  ⑤ if (!state.initialSyncDone)  → bootstrap()
     else                        → normalSync()
```

### bootstrap() — 첫 활성화

```text
1. PUSH ALL   collectOutbound({ all: true })
                 dirty와 무관하게 전 레코드. baseVersion = 각 행의 serverVersion(대개 0).
                 청크(200건/4MB)마다 멱등 키.
                 충돌이 나면 → PULL 후 병합 → 재수집 → 재시도(최대 4).
2. PULL ALL   since = state.cursor (부트스트랩이면 0), has_more 동안 반복.
                 각 페이지는 applyPull 한 트랜잭션.
3. COMMIT     마지막 페이지의 커서와 initialSyncDone=true를 **같은 트랜잭션**에서 쓴다.
```

**왜 push가 먼저인가**: 레거시 `runSyncNow`가 배운 것이다. 동기화 도입 전 데이터를 가진
기기가 키링을 **다른 기기가 먼저 만든** 상황에서 unlock 경로로 들어오면, pull-먼저는
그 기기의 데이터를 영영 올리지 않는다(dirty만 보므로). 빈 새 기기는 0건이라 push가
공짜이고, 데이터를 가진 기기는 여기서 전부 올린다.

**PUSH ALL이 위험하지 않은 이유**: 로컬 레코드 id는 UUID다. 서버에 같은 id가 이미 있다면
그건 **이 기기가 전에 올린 것**이거나(재부트스트랩) 이 기기의 DB가 복제된 것뿐이다.
전자면 `baseVersion` 불일치로 충돌 → pull → HLC 병합이 옳게 처리한다.
서로 다른 기기가 서로 다른 데이터에 같은 id를 붙이는 경로는 없다.

### 네 가지 케이스

| 케이스 | 진행 |
| --- | --- |
| 첫 기기, 로컬 데이터 있음, 서버 비어 있음 | setup → PUSH ALL(전부 신규, 충돌 0) → PULL(0건) → done |
| 첫 기기, 로컬 비어 있음 | setup → PUSH ALL(0건) → PULL(0건) → done |
| 두 번째 기기, 로컬 비어 있음, 서버에 데이터 | unlock → PUSH ALL(0건) → PULL 전량 → done |
| **두 번째 기기, 로컬·서버 둘 다 데이터** | unlock → PUSH ALL(로컬 전부, id가 겹치지 않으므로 전부 신규) → PULL 전량(서버 데이터가 로컬에 없으므로 전부 신규 적용) → **양쪽 다 살아남는다** |

마지막이 조사 §46이 걱정하는 케이스다. **어느 쪽도 덮어쓰지 않는다** — id가 서로 다르기
때문이다. 사용자는 두 기기의 대화·초안을 **합집합**으로 보게 되고, 그것이 옳다.
(중복처럼 보이는 초안이 둘 생길 수는 있다. 그건 실제로 두 개였다.)

### normalSync() — 이후 매 실행

```text
PULL → PUSH.
pull 먼저인 이유: baseVersion을 최신으로 만들어 push 충돌률을 낮춘다.
push가 충돌하면 그 안에서 다시 pull한다(엔진 재시도 루프).
```

### `dirty=true` 백필로 충분한가 — **아니다**

현재 모든 레코드가 `dirty: true`로 생성되고 내려가는 경로가 없으므로 **오늘 시점에는**
전부 dirty다. 그러나:

- M1 마이그레이션이 `dirty`를 재작성하는 과정에 버그가 있으면 조용히 데이터가 안 올라간다.
- 미래에 어떤 경로가 dirty를 내리기 시작하면(예: 실패한 동기화 이후 복구) 그 가정이 깨진다.
- 전체 재동기화(§24b)는 dirty 여부와 무관하게 전량을 다시 올려야 한다.

→ **`collectOutbound({ all: true })` 전체 스캔 경로를 반드시 갖는다**(레거시 `initialPush`와
같은 결론). dirty 인덱스는 일상 동기화의 최적화이고, 부트스트랩과 전체 재동기화의
**정확성은 전체 스캔이 보장**한다.

---

## 24b. Full Resync

발동 조건:

```text
로컬 커서 유실 / syncState 손상
410 sync_cursor_expired  (묘비 지평선 초과 — v1에서는 발생하지 않음)
프로토콜 에폭 변경
사용자가 "동기화 다시 맞추기"를 누름
```

절차:

```text
1. store.resetCursor()      커서 0, protocolEpoch += 1.  **로컬 데이터는 지우지 않는다.**
2. bootstrap()과 동일       PUSH ALL → PULL ALL → initialSyncDone 재확정
```

**로컬 미동기 변경이 보호되는 이유**: PUSH ALL이 먼저 돌아 로컬 상태를 서버에 올린다.
그 다음 PULL이 서버 사본을 들고 오는데, 방금 올린 것들은 `rev`가 로컬과 같으므로
§19.2의 5단계·7단계에서 로컬을 덮지 않는다. 서버가 더 새로운 판(다른 기기가 올린 것)을
갖고 있으면 HLC가 정상적으로 판정한다.

절대 하지 않는 것: **로컬을 비우고 서버에서 다시 받는 방식.** 그건 "전체 재동기화"가
아니라 "로컬 데이터 파기"이고, 서버에 없는 로컬 변경을 전부 잃는다.

---

## 25. Multi-tab / Multi-process Semantics

같은 회원의 여러 탭이 같은 IndexedDB를 연다. 셋 다 물어야 한다:
둘 다 동기화를 돌려도 되는가, 리더가 필요한가, 낙관적 버전이 경합하는가.

### 정확성부터 — **동시 실행은 이미 안전하다**

두 탭이 동시에 동기화해도 데이터가 깨지지 않는다:

```text
두 탭이 같은 레코드를 push       → 하나가 이기고 다른 하나는 conflicts를 받는다.
                                  진 쪽은 pull → 병합 → 재시도한다(엔진 루프).
두 탭이 같은 페이지를 pull        → applyPull이 멱등이다. 병합 규칙이 결정적이라
                                  같은 최종 상태에 도달한다.
커서 경합                        → 두 탭이 같은 트랜잭션 축(syncState)을 쓰므로
                                  IndexedDB가 직렬화한다. 뒤진 쪽이 앞선 커서를
                                  되돌릴 수는 있으나(재적용 → 멱등) 건너뛰지는 않는다.
```

즉 **문제는 정확성이 아니라 낭비**다: 같은 레코드를 두 번 암호화하고, 두 번 올리고,
충돌 재시도로 왕복이 늘어난다.

### 결정: Web Locks API. 리더 선출을 만들지 않는다.

```ts
const result = await navigator.locks.request(
  `rowcat.sync.${viewerId}`,
  { ifAvailable: true },
  async (lock) => (lock ? runSyncNow() : "skipped"),
)
```

- 한 줄이다. 상태 기계가 없다.
- 탭이 죽으면 **브라우저가 락을 자동 해제**한다. 리더 사망 감지·인수인계가 필요 없다.
- 이름에 `viewerId`가 들어가 계정 전환이 자연히 다른 락이 된다.
- 지원하지 않는 환경이면 **그냥 동시 실행한다**(위 분석대로 정확하다).

> **슬라이스 2 기준.** 이 락은 이제 수동 버튼만이 아니라 **모든 실행**을 감싼다
> (`apps/web/src/lib/local-sync/auto-sync.ts`의 `run()`). 자동 동기화가 붙은 뒤로 낭비의
> 규모가 달라졌기 때문이다: 예전에는 사용자가 탭 두 개에서 각각 버튼을 눌러야 겹쳤지만,
> 이제는 탭 세 개가 열려 있으면 포그라운드 복귀 한 번이 왕복 세 번이 된다.
>
> **여전히 정확성 장치가 아니다.** 락을 못 잡은 실행은 실패가 아니라 `skipped`로 끝나고,
> 백오프를 만들지 않으며, 그 탭의 dirty는 락을 쥔 탭이 같은 데이터베이스를 훑어 함께
> 올린다(같은 IndexedDB다). 지원하지 않는 브라우저에서는 그냥 셋 다 돈다.

| 대안 | 판정 |
| --- | --- |
| **Web Locks** | ✅ 채택 |
| 동시 실행 허용 + 충돌 복구만 | ⚠️ 폴백으로만. 정확하지만 낭비 |
| BroadcastChannel 리더 선출 | ❌ 사망 감지·인수인계·재선출 상태 기계를 직접 짜야 한다. 해결하는 문제는 "중복 요청"뿐 |
| IndexedDB lease(만료 시각 행) | ❌ 위와 같은 문제 + 시계 의존 |

### 로컬 쓰기의 관찰

다른 탭의 쓰기는 이미 `liveQuery`가 본다(`dexie-react-hooks`). 동기화가 적용한 레코드도
같은 경로로 화면에 반영된다 — **알림 코드를 따로 쓰지 않는다.** 이것이 `local-chat/hooks.ts`
헤더가 미리 적어 둔 이득의 회수 지점이다.

자동 동기화 트리거(§26)의 "로컬 변경" 신호는 `liveQuery`가 아니라 스토어 쓰기 경로에서
직접 낸다 — `liveQuery`는 **자기 자신이 적용한 변경에도** 반응하므로 그것으로 트리거를
만들면 동기화가 자기를 다시 부른다.

---

## 26. Auto-sync Strategy

**슬라이스 2다 — 구현됐다.** 슬라이스 1이 버튼 하나로 프로토콜을 증명했고, 여기서는
그 버튼을 언제 대신 눌러 줄지만 정한다.

> **정정(슬라이스 2 구현). 포그라운드 60초 타이머를 넣지 않았다.**
>
> 아래 표의 초안에는 "SSE가 없거나 조용히 죽었을 때의 안전망"으로 60초 주기 타이머가 있었다.
> 구현에서 뺐고, 이유가 셋이다.
>
> 1. **그것이 폴링이다.** 앱을 열어 둔 채 아무것도 하지 않는 사용자가 시간당 60번 요청을
>    보낸다. 대부분은 0건을 받아 오고, 그 비용은 배터리와 데이터와 서버 모두에서 실제다.
> 2. **다음 슬라이스가 해결할 문제를 미리 가린다.** 60초 폴링이 있으면 SSE 깨우기의 이득이
>    "1분 → 즉시"로 줄어들어 그 슬라이스를 정당화하기 어려워지고, 그동안 폴링은 남는다.
> 3. **안전망이 필요한 대상이 아직 없다.** 안전망은 SSE가 조용히 죽는 경우를 위한 것인데
>    SSE가 없다. 없는 것의 안전망을 먼저 만들 이유가 없다.
>
> 대가는 정직하게 적는다: **다른 기기의 변경이 이 기기에 도착하는 지연이 무한정 길어질 수
> 있다.** 앱을 열어 둔 채 며칠을 두면 그동안 아무것도 당겨 오지 않는다. 그 창을 닫는 것은
> 폴링이 아니라 SSE 깨우기이고(슬라이스 4), 접합점은 이미 있다 —
> `requestSync("remote-wake")` 한 줄이면 되고 일정 관리자는 고치지 않는다.

### 트리거 — 실제로 구현된 것

| 신호 | 지연 | 이유 |
| --- | --- | --- |
| 로컬 durable write | 1초 디바운스(**뒤쪽 끝**) | 메시지는 확정 커밋이라 길게 모을 이유가 없다. 초안 자동 저장의 연속은 한 번으로 접힌다 |
| 앱 시작(스코프가 열리고 잠금이 풀린 직후) | 200ms | 지난 세션에서 남은 dirty를 올리고, 그동안의 원격 변경을 당긴다 |
| `visibilitychange` → visible | 200ms 흡수 창 | 돌아온 순간이 원격 변경을 당길 가장 좋은 때다 |
| `window.focus` | 200ms 흡수 창 | 위와 같음. visible과 **함께 떨어지므로** 창이 둘을 하나로 만든다 |
| `online` | 200ms 흡수 창 | 오프라인 동안 쌓인 것을 곧바로 내보낸다 |
| 잠금 해제·토글 켜기 | 200ms 흡수 창 | "이제 돌 수 있다"가 된 순간. 없으면 사용자가 잠금을 푼 뒤 화면이 그대로다 |
| 수동 버튼 | 즉시 | 사용자가 확인하고 싶을 때 |
| SSE 깨우기(**구현됨**) | 흡수 창 | `requestSync("remote-wake")`. 예고대로 이 표에 줄 하나가 늘었을 뿐이고, `auto-sync.ts`는 한 글자도 고치지 않았다 |
| ~~포그라운드 60초 타이머~~ | — | **넣지 않았다**(위 정정) |

백그라운드 탭에서는 아무 타이머도 돌지 않는다 — 정확히는 **어느 탭에서도 주기 타이머가
돌지 않는다.** 숨은 탭에서 로컬 쓰기가 커밋되면 그 디바운스는 그대로 돈다(이벤트 구동이라
비용이 그 한 번뿐이다).

### 디바운스의 두 축

로컬 편집과 수명 신호는 **반대로 움직인다.** 이것이 구현에서 가장 미묘한 부분이다.

```text
local   뒤쪽 끝. 편집이 이어지는 동안 실행 시각을 계속 **뒤로 민다**.
signal  더 이른 쪽이 이긴다. 잡혀 있는 예약을 **앞당긴다**.
```

그래서 로컬 디바운스가 걸린 채로 포그라운드 복귀가 들어오면 실행은 **한 번**이고(신호가
앞당기고, 그 실행이 밀린 편집까지 함께 가져간다), 뒤늦게 옛 디바운스가 또 도는 일이 없다.
반대로 신호가 잡아 둔 예약을 로컬 편집이 뒤로 밀지도 않는다 — 밀면 사용자가 돌아온 순간의
동기화가 타이핑 때문에 계속 미뤄진다.

### 직렬화

```text
running   현재 실행 중인가 — **이 불리언 하나가 단일 실행 불변식의 전부다**
queued    실행 중에 들어온 요청 — 횟수가 아니라 **이유 하나**. 여러 번 들어와도 1회로 합산
```

실행이 끝났을 때 `queued`가 서 있으면 한 번 더 돈다. 큐로 만들지 않는 이유: 트리거 20개가
실행 20번이 되는데, 후속 실행 한 번이 그 사이 쌓인 dirty를 **전부** 수집한다(수집은 큐가
아니라 저장소를 훑는다).

후속 실행은 반드시 **비동기 경계를 건넌다**(`setTimeout(…, 0)`). 완료 핸들러에서 곧바로
다음 실행을 부르면 신호가 계속 들어오는 동안 스택이 자라고 그 사이 아무것도 돌지 않는다.

**수동과 자동이 같은 게이트를 지난다.** 계정 화면의 `지금 동기화`는 컨트롤러를 직접 부르지
않고 같은 코디네이터의 `runNow()`를 부른다. 진행 중이면 거절하지 않고 그 실행이 끝난 뒤의
후속 1회를 기다린다 — 사용자의 평범한 행동에 "이미 동기화 중입니다"를 돌려주지 않는다.

### 실행 중에 들어온 편집이 사라지지 않는다

```text
push 수집(rev 10) → 요청 나감 → 사용자가 같은 레코드를 고침(rev 11) → 응답 도착
```

여기서 `dirty`를 무조건 내리면 rev 11은 **영원히** 올라가지 않는다. 그 방어는 이미 1b에
있고(`commitPush`가 수집 시점 리비전이 그대로일 때만 dirty를 내린다), 자동 동기화는 그
경합의 **빈도만** 올린다 — 그래서 이 경로에 회귀 테스트가 두 곳에 있다
(`local-sync/store.test.ts`의 `commitPush 경합`, `local-sync/auto-sync.test.ts`의
`실행 중의 변경`).

### 되먹임 루프를 만들지 않는다

가장 값비싼 규칙이다. `applyPull`이 쓰는 것도 결국 같은 IndexedDB이므로, **로컬 변경 신호를
`liveQuery`로 만들면** pull → 쓰기 → 신호 → pull의 무한 왕복이 된다.

그래서 신호는 관찰이 아니라 **쓰기 경로**에서 낸다:

```text
사용자의 조작   ChatStore·AuthoringStore의 쓰기 메서드 → notify()
원격 적용       SyncStore.applyPull                     → 아무것도 내지 않는다
```

감싸는 자리는 조립 지점 하나다(`apps/web/src/lib/local-data/stores.ts`). 저장소 구현이
직접 알리게 하면 제품 저장소가 동기화의 존재를 알게 되고, 새 쓰기 메서드마다 그 한 줄을
기억해야 한다. 목록의 방향도 그래서 **읽기 전용 메서드를 열거하고 나머지를 전부 쓰기로
본다** — 빠뜨렸을 때 읽기 쪽은 헛도는 실행 한 번으로 끝나지만, 쓰기 쪽은 사용자의 변경이
다음 수명 신호까지 이 기기에만 남는다.

신호에는 **아무것도 실리지 않는다.** 인자가 없는 함수다 — 방 제목도 메시지 본문도 초안 id도
일정 관리 계층을 지날 이유가 없다.

### 재시도의 층

각 층이 다른 것을 재시도한다. 곱해지지 않게 하는 것이 요점이다.

```text
전송 요청 하나   엔진의 withRetry — 최대 4회, 250ms→8s, Retry-After 존중
충돌            엔진의 pushConverging — 최대 4회(pull → 병합 → 재수집 → 재시도)
실행 전체       자동 동기화의 백오프 — 5s → 15s → 30s → 60s, 상한에서 멈춘다
```

자동 백오프는 **실행 하나가 통째로 실패한 뒤에만** 선다. 엔진이 이미 한 요청을 네 번
시도했으므로 그 안에서 다시 세지 않는다.

재시도로 나아지지 않는 실패는 물러나지 않고 **막힌다**: 401·403, 암호(`sync_locked`·
키링 증명 불일치), 잘못된 페이로드. 같은 요청을 다시 보내도 같은 답이 오고, 백오프에
태우면 배터리만 태우면서 진짜 문제(다시 로그인해야 한다)는 사용자에게 닿지 않는다.

오프라인이면 **타이머를 이어 가지 않는다.** `navigator.onLine === false`는 도달 가능성이
아니라 힌트지만, 그 힌트가 참일 때 재시도를 세우면 비행기 모드의 세 시간이 재시도 수백
번이 된다. 다음 실행은 `online` 이벤트가 부른다.

### 잠긴 기기·미설정 계정에서의 동작

```text
설정됨 + 기억된 기기   시작 시 inspect()가 잠금을 풀고 → 동기화
설정됨 + 미신뢰 기기   **조용히 통과한다.** 백그라운드에서 복구 코드를 묻지 않는다
설정된 적 없음         **조용히 통과한다.** 키를 만들지도, 데이터를 올리지도 않는다
자동 동기화 꺼짐       자동 트리거만 멈춘다. 수동 버튼은 그대로 돈다
오프라인               위 참고. 로컬 작업에 아무 영향이 없다
```

`inspect()`는 런타임이 시작할 때 **한 번** 부른다. 계정 화면이 또 부르지 않는 이유가
그것이다 — 화면마다 부르면 계정 화면을 여는 것만으로 왕복이 하나 더 나간다.

### 이 기기 토글

`계정 → 데이터`에 `자동 동기화` 스위치가 있다. **회원 + 기기** 범위이고 동기화되지 않는다 —
저장 자리는 로컬 `syncState` 행의 `autoSyncEnabled` 필드 하나이고, 그 필드에는 `dirty`도
`rev`도 묘비도 없어 프로토콜은 존재를 모른다. `localStorage`를 쓰지 않는 이유는 그것이
origin 하나에 값 하나여서 공용 브라우저에서 Alice가 끈 것이 Bob의 기본값이 되기 때문이다.

기록이 없으면 **켜짐**이다. 동기화를 설정했다는 것 자체가 "기기 사이를 이어 달라"는 요청이고,
그 뒤에 다시 "자동으로도 이어 달라"를 묻는 것은 같은 질문을 두 번 하는 것이다.

끄면 걸려 있던 타이머까지 사라진다(코디네이터 인스턴스를 통째로 버린다). 잠그지도, 열쇠를
지우지도, `dirty`를 비우지도 않는다 — 끄는 것은 **일정**이지 동기화 자체가 아니다.

### 수명

```text
로그인 시     LocalDataScope가 열리면 컨트롤러 + 자동 동기화 인스턴스를 **새로** 만든다
로그아웃 시   stop() → 타이머 해제, 브라우저 리스너 제거, 후속 실행 금지, DEK 폐기
재로그인 시   **새 인스턴스**. stop()된 것은 영구 stopped라 재사용할 수 없다
```

모듈 싱글턴을 만들지 않는다. 인스턴스를 만드는 것은 렌더(`useMemo`)이지만 **시작·정지는
효과**다 — 만들기가 순수해야 React StrictMode의 이중 마운트가 살아 있는 인스턴스를 정지시키는
사고가 나지 않는다(1b에서 `AbortController`로 정확히 그 사고를 겪었다).

계정 격리의 방어선은 두 겹이다. `canRun()`이 실행 **직전에** `ownsStore()`를 묻고,
완료 핸들러가 정지 여부를 다시 물은 뒤에만 후속 실행을 예약한다. 그래서 Alice의 남은
디바운스가 Bob의 로그인 뒤에 깨어나도 그 실행은 시작되지 않는다.

### 실패가 로컬 작업을 해치지 않는다

동기화 실패는 로컬 쓰기를 되돌리지 않는다. `dirty`가 그대로 남아 다음 시도에 다시 잡히고,
화면에는 상태 한 줄만 바뀐다. **동기화가 편집을 막는 경로를 만들지 않는다.**

자동 동기화의 실패에는 **토스트를 띄우지 않는다.** 사용자가 한 일이 아니고, 와이파이가 끊긴
동안 같은 문구를 반복해 알리는 것은 정보가 아니라 소음이다. 대신 계정 화면의 상태 줄이
지금 무엇을 기다리는지 말한다(`오프라인에서 대기 중입니다` 등). 수동 버튼의 실패는 그대로
즉시 표면화된다 — 그건 사용자가 한 일이다.

---

## 26b. Derived Parent Updates

`appendMessage`가 `ChatRoom.updatedAt`을 함께 올린다. 두 레코드가 dirty가 된다.

### 둘 다 동기화해야 하는가 — **그렇다.**

`ChatRoom.updatedAt`은 대화 목록의 **정렬 축**이다. 방을 보내지 않으면 다른 기기의
목록에서 방금 대화한 방이 몇 달 전 자리에 남는다. 사용자에게 그건 "동기화가 안 됐다"로 읽힌다.

### 노이즈 문제와 해결

`ChatRoom` payload에는 `seed`가 들어 있고, 그건 수 KB~수십 KB다. 메시지 한 건마다 방
전체를 재암호화·재전송하면 **메시지보다 방이 더 비싸진다.**

세 가지로 푼다:

1. **`seed`는 불변이다**(§19.3). 그래서 방 payload는 매번 같은 바이트를 다시 보내지만
   충돌 표면에서는 빠진다.
2. **압축**이 반복 텍스트를 크게 줄인다(§9.5).
3. **디바운스가 방 push를 흡수한다.** auto-sync가 로컬 변경 후 1초를 모으므로, 연속된
   메시지 N건에 대해 방은 **한 번** 올라간다. `dirty`가 불리언이라 N번 세워도 한 번 수집된다.
   push 사이의 사용자 타이핑 간격(수 초~수십 초)이 실질적 상한이다.

이것으로도 큰 방(seed 50KB)에서 메시지당 오버헤드가 남는다면, 그때의 해법은
**방을 두 레코드로 쪼개는 것**이다: `chat.room`(메타 + updatedAt, 작다)과
`chat.room.seed`(불변 스냅샷, 한 번만 올라간다). 지금 하지 않는 이유는 (a) 실측 없이
레코드를 나누면 부모-자식 도착 순서 문제만 늘고, (b) `seed`가 불변이라 서버가 **같은
version에서 바뀌지 않아** 실제 재전송이 없는지부터 확인해야 하기 때문이다.
**확장점으로만 기록한다.**

순서 함의: 방과 메시지는 같은 배치에 들어가고 수집 순서상 방이 먼저다(§18.1).
서버 seq도 그 순서라 수신 기기가 방을 먼저 본다. 다만 §28에 따라 **순서에 의존하지 않는다.**

---

## 27. Cross-platform Architecture

### 책임 분할

| 계층 | 웹 | 미래 Expo | 공용 |
| --- | --- | --- | --- |
| 프로토콜·엔진·상태 머신 | — | — | `@rowcat/sync` |
| 봉투 암호(오케스트레이션) | — | — | `@rowcat/sync` |
| AEAD 구현 | `crypto.subtle` 어댑터 | noble(기본) 또는 네이티브 어댑터 | `AeadProvider` 포트 |
| KDF/HMAC/ECDH | — | — | noble(양쪽 동일) |
| 도메인 코덱·병합 규칙 | — | — | `@rowcat/chat`, `@rowcat/authoring` |
| `SyncStore` | Dexie 어댑터 | expo-sqlite 어댑터 | `SyncStore` 포트 |
| `DeviceKeyStore` | non-extractable CryptoKey + LocalDb | expo-secure-store | 포트 |
| `SyncTransport` | `RowCatClient` | 같은 SDK | `SyncTransport` 포트 |
| 수명 배선 | `LocalDataScope` | Expo의 세션 컨텍스트 | — |
| 트리거 소스 | `visibilitychange`·`focus`·`online` | `AppState`·`NetInfo`·푸시 | 오케스트레이터는 공용 |

### 브라우저 전용 의미론을 프로토콜에 넣지 않는다

점검한 것들:

- **AEAD**: 의미 계층은 `AeadProvider` 포트만 안다. `crypto.subtle`은 웹 어댑터에만 등장한다.
  기본 구현이 noble(순수 JS)이라 **Expo·Node·테스트가 어댑터 없이도 돈다.**
- **KDF**: `crypto.subtle`에도 HKDF가 있지만 쓰지 않는다. 양쪽을 두면 파생값이 갈릴
  여지가 생기고 성능 병목도 아니다. noble 하나로 통일한다.
- **난수**: `@noble/hashes/utils`의 `randomBytes`. Hermes에는 `crypto.randomUUID`가
  보장되지 않으므로 UUID도 randomBytes로 조립한다(레거시가 같은 결론에 도달했다).
- **압축**: `fflate`. 순수 JS라 양쪽 동일.
- **트랜잭션**: §22가 모든 원자 연산의 SQLite 대응을 명시한다. Dexie 고유 기능
  (`Collection.modify`, `liveQuery`, 암묵 커밋)에 의존하는 연산이 하나도 없다.
- **저장소 키 순서**: 웹 어댑터는 IndexedDB의 복합 키 순서 규칙에 기대지만,
  그건 **어댑터 안**의 이야기다. 포트는 "정렬된 목록"만 약속한다.
- **`liveQuery`**: 포트에 없다. 구독은 각 플랫폼의 앱 계층이 한다.
- **깨우기 스트림**: 웹 전용 세부다(**구현됨**, §35.2c). `@rowcat/sync`에는 그 흔적이
  없고 — 파서도 브로커도 연결 코드도 들어가지 않았다 — 늘어난 것은 이미 예약돼 있던
  `SyncReason`의 `"remote-wake"` 하나뿐이다. 모바일은 푸시 알림이나 `AppState`로 같은
  신호를 만들어 같은 한 줄(`requestSync("remote-wake")`)을 부르면 된다.
  네이티브 `EventSource`는 **쓰지 않았다**: 200이 아닌 응답이 전부 같은 `error` 이벤트라
  401(멈춰야 한다)과 503(재시도해야 한다)이 구분되지 않는다. `fetch` + `ReadableStream`은
  그 분기를 그냥 준다(§35.2c).

### 바이트 수준 상호운용 증명

모바일 UI가 없어도 슬라이스 1b에서 증명한다:

```text
packages/sync/src/__fixtures__/vectors.json
  고정 DEK · 고정 nonce · 고정 payload로 만든 골든 벡터
  ├ 레코드 봉투(압축 on / off 각각)
  ├ 키링(setup 결과 + 복구 언락)
  └ 페어링(고정 키쌍)

검증:
  ① noble 경로가 벡터를 재현한다
  ② subtle 경로가 noble 벡터를 복호화한다(그 역도)
  ③ 코덱이 벡터 payload를 도메인 레코드로 디코드한다
  ④ (슬라이스 5) SQLite SyncStore가 같은 벡터를 적용해 같은 로컬 상태에 도달한다
```

이 벡터가 **회귀 잠금**이다. 봉투·AAD·코덱 바이트를 무심코 바꾸면 여기서 깨진다 —
그게 §33의 1순위 위험(암호 봉투)을 실제로 막는 장치다.

### 모바일 어댑터가 나중에 해야 할 일(구현하지 않는다)

```text
SQLite 스키마      로컬 레코드 + syncState. 논리 스키마는 웹과 동일
트랜잭션           withExclusiveTransactionAsync / BEGIN IMMEDIATE
보안 저장소        expo-secure-store, owner별 키 + 전체 삭제용 인덱스 키
전송               같은 @rowcat/sdk(베이스 URL만 다르다)
백그라운드 제약    iOS는 백그라운드 실행이 제한된다 — 포그라운드 복귀 동기화가 기본이고
                   백그라운드 fetch는 최선 노력이다. 프로토콜은 이를 이미 견딘다
                   (커서 기반 증분 + 멱등 재시도)
앱 수명            AppState active → requestSync, background → 타이머 정지
오프라인           기본값이다. 실패해도 로컬 작업이 온전하다(§26)
```

---

## 27b. Record Granularity

현재 경계(방·메시지·초안·캐릭터·로어·장면)를 **그대로 유지한다.**

| 후보 | 충돌 범위 | 암호 오버헤드 | 증분 전송 | 삭제 전파 | 오프라인 편집 | 스키마 진화 |
| --- | --- | --- | --- | --- | --- | --- |
| **현재 레코드 단위** | 좁다 | 레코드당 28B + base64 33% | ✅ 바뀐 것만 | ✅ 레코드별 묘비 | ✅ 독립 | ✅ 타입별 독립 버전 |
| 방+메시지 통 blob | 방 전체 | 낮다 | ❌ 메시지 하나에 전체 재전송 | 방 단위만 | ❌ 모든 편집이 충돌 | 통째로 |
| 초안 그래프 통 blob | 초안 전체 | 낮다 | ❌ | 초안 단위만 | ❌ | 통째로 |
| 필드 단위 레코드 | 매우 좁다 | **매우 높다**(필드당 봉투) | ✅ | 복잡 | ✅ | 폭발 |

통 blob이 치명적인 이유는 조사 §35의 예시가 그대로 적용되기 때문이다: 방 blob이면 A가
메시지를 붙이고 B가 제목을 고친 순간 통째로 한쪽이 사라진다. 그리고 5,000 메시지 방의
blob은 레코드 상한(512KB)을 즉시 넘긴다.

필드 단위가 비싼 이유: AES-GCM 봉투는 nonce 12 + tag 16 = 28바이트 + base64 33% 팽창이다.
`DraftLoreEntry.order`(정수 하나)를 레코드로 만들면 페이로드보다 봉투가 크다. 대신
**초안 루트에 한해 필드 그룹 병합**으로 같은 이득의 대부분을 얻는다(§19.3) — 레코드를
나누지 않고 병합만 세분화하는 것이 이 설계의 요점이다.

`ChatRoom.seed` 분리는 §26b의 확장점으로만 남긴다.

---

## 28. Assets Extension & Referential Integrity

### 28.1 참조 무결성 — 순서에 의존하지 않는다

암호화된 독립 레코드는 `roomId`·`draftId`·`defaultStartSceneId`를 담는다. 서버는 payload를
못 읽으므로 **PostgreSQL FK를 걸 수 없다.** 도착 순서도 보장할 수 없다(서로 다른 배치,
서로 다른 페이지).

레거시는 위상정렬(`PULL_TOPO_ORDER`) + 격리 큐(`sync_pending`)로 풀었고, 그 큐가
1000건/50회 상한 때문에 **유실 가능한 경로**였다. 여기서는 그럴 필요가 없다.

**결정: 자식은 부모 없이도 저장된다. 조회가 거른다.**

```text
자식 도착, 부모 없음        → 그대로 저장한다. `roomId`/`draftId`는 그냥 문자열이다.
                              화면 조회가 부모 기준이므로 보이지 않을 뿐이다.
                              부모가 나중에 도착하면 **아무 조치 없이** 보이기 시작한다.
부모가 나중에 도착           → 자동 해소. 큐도 재시도도 없다.
부모가 삭제된 뒤 자식 도착   → §20.4: 삭제된 채로 기록한다(deletedAt = 부모의 값).
자식 묘비만 오고 부모 없음   → 그 id로 묘비 레코드를 만든다(내용 없는 행).
defaultStartSceneId가
아직 없는 장면을 가리킴      → 이미 처리된다. `resolveDefaultStartScene`이 없으면 첫 장면으로
                              떨어뜨린다(@rowcat/authoring/model.ts). 설계가 이미 옳다.
```

이것이 가능한 유일한 이유는 **로컬 id = 동기화 id**여서 리매핑이 없기 때문이다.
레거시는 `localIdBySyncId`가 null을 돌려주면 **쓸 수 있는 값이 없어서** 미룰 수밖에 없었다.

읽기 경로가 이미 부모 기준으로 거른다는 사실을 확인했다:
`liveChildren`은 부모가 살아 있지 않으면 빈 목록을 준다(`local-authoring/store.ts`),
`useLocalMessages`는 `roomId`로 조회한다. **추가 작업이 거의 없다.**

한 가지 필요한 보강: 초안 목록·대화 목록이 **고아 자식을 세지 않도록** 한다(이미 그렇다).
그리고 진단용으로 "부모 없는 자식 수"를 카운트해 둔다 — 0이 아니면 무언가 잘못된 신호다.

### 28.2 Assets — 확장점만

현재 Create는 이미지·에셋을 의도적으로 미룬 상태다. 레거시는 **내용주소 asset 레코드**로
풀었다(`sync_id = sha256(dataUrl)`, 불변, `create-if-absent`, 낙관적 동시성 제외,
700KB dataUrl 상한, 위상정렬 밖의 별도 채널).

레거시 방식의 문제:
- 프로토콜 코어에 도메인 특례가 스며들었다(§4-10).
- 1MB 레코드 상한 때문에 700KB에서 잘렸고, 초과 이미지는 **조용히 동기화되지 않았다.**
- base64 dataUrl을 다시 base64 암호문으로 감싸 실제 바이트가 ~1.8배로 부풀었다.

**권고: 별도 blob 엔드포인트. 레코드 프로토콜에 넣지 않는다.**

```text
POST   /v2/me/sync/blobs           멀티파트 또는 octet-stream, 암호화된 바이트
       요청 헤더에 내용주소(암호문 해시), 이미 있으면 204
GET    /v2/me/sync/blobs/:hash     암호문 바이트
레코드는 { blobHash, mime, bytes } 참조만 담는다.
```

이유:
- 큰 불변 바이트는 **버전도 충돌도 없다.** 낙관적 동시성 기계를 태울 이유가 전혀 없다.
- 별도 엔드포인트라야 청크 업로드·재개·S3 계열 오브젝트 스토리지로 이전이 가능하다.
- 레코드 상한(512KB)을 에셋 때문에 올리지 않아도 된다.
- 삭제는 참조 카운팅이 아니라 **미참조 GC**로 별도 수명주기를 갖는다.

**v1에서는 아무것도 만들지 않는다.** 남기는 확장점은 둘뿐이다:
① 레코드 payload에 blob 참조를 담을 자리를 코덱이 나중에 추가할 수 있다(스키마 버전).
② 서버 라우트 네임스페이스 `/v2/me/sync/blobs`를 예약한다.

---

## 29. Account Lifecycle Implications

### 29.1 네 가지를 갈라 둔다

| 행동 | 로컬 평문 | 로컬 DEK 캐시 | 서버 암호문 | 서버 키링 |
| --- | --- | --- | --- | --- |
| **로그아웃** | 남는다 | **남는다**(신뢰 유지) | 남는다 | 남는다 |
| **이 기기 신뢰 해제** | 남는다 | **지운다** | 남는다 | 남는다 |
| **이 기기 데이터 삭제** | **지운다** | **지운다** | 남는다 | 남는다 |
| **계정 삭제** | **지운다**(탈퇴한 기기) / 남는다(오프라인 기기) | 같음 | **지운다** | **먼저 지운다** |

### 29.2 로그아웃

현재 불변식(`local-data/db.ts`, `scope.tsx`)을 유지한다: **바이트를 지우지 않는다.**
동기화가 더하는 것:

```text
로그아웃 →  메모리의 DEK를 버린다(controller.lock())
            진행 중인 동기화를 abort한다
            auto-sync 인스턴스를 stop한다
            LocalDataScope를 release한다
            **기억된 기기 신뢰는 건드리지 않는다** — 사용자가 옵트인한 별개 축이다
```

로그아웃을 "이 기기 신뢰 해제"와 같게 만들지 않는다. 그러면 같은 브라우저에서 로그아웃할
때마다 복구 코드를 다시 요구하게 되고, 사용자는 코드를 어딘가에 붙여 둔다(§14b).

### 29.3 이 기기 데이터 삭제(미래)

```text
지운다:  rowcat_chat_<viewerId> 데이터베이스 전체
           = 대화 · 초안 · syncState(커서·deviceId·HLC) · 기억된 DEK(같은 DB 안)
남긴다:  서버 암호문 · 서버 키링 · 다른 기기
```
DEK 캐시가 **같은 DB 안에** 있는 것이 이 동작을 한 줄로 만든다(레거시가 배운 것).
모바일은 secure-store가 별개라 인덱스 키로 함께 지워야 한다(§14).

이 동작 후 같은 계정으로 다시 동기화를 켜면: 복구 코드로 언락 → 부트스트랩 → 서버의
전부를 다시 받는다. 즉 **이 기기 데이터 삭제는 파괴적이지 않다**(동기화가 켜져 있었다면).
그 사실을 UI 문구가 말해야 한다.

### 29.4 계정 삭제 — 동기화 쪽 요구사항만

```text
순서 (한 트랜잭션):
  1. DELETE sync_keyring WHERE owner = ?     ← **가장 먼저**
  2. DELETE sync_pairing WHERE owner = ?     ← 진행 중이던 키 재료 중계도 함께 닫는다
  3. DELETE sync_push_dedupe WHERE owner = ?
  4. DELETE sync_state    WHERE owner = ?
  5. DELETE sync_record   WHERE owner = ?    ← 실패해도 1이 이미 파기를 완성했다
```

**순서가 보장의 본질이다.** 암호적 파기의 프리미티브는 **키 재료의 파기**다.

```text
암호문 삭제 성공 + 키 삭제 실패  →  키가 남아 있다. 백업에 있던 암호문이 여전히 복호화 가능.
키 삭제 성공 + 암호문 정리 실패  →  남은 암호문은 **아무도 읽을 수 없는 바이트**다.
```
후자가 명백히 강하다. 그래서 키링을 먼저 지우고, 암호문 정리는 실패해도 재시도로 미룬다.
(여기서는 `member.id` FK `ON DELETE CASCADE`라 실제로는 한 번에 사라지지만, **삭제
순서를 명시적으로 적는 것**이 미래에 소프트 삭제 회원 묘비가 생겨도 규칙이 남게 한다.)

**정직하게 말해야 하는 것**: 서버 삭제가 오프라인 노트북의 로컬 평문을 지우지 않는다.
그 기기에는 대화와 초안이 그대로 있고, 우리에겐 원격 소거 수단이 없다.
계정 삭제 문구가 "이 기기 데이터는 각 기기에서 따로 지워야 합니다"를 말해야 한다.

**구현됨**(`apps/api/src/services/account/deletion.ts`). 위 순서를 그대로 따르고, 같은
트랜잭션이 회원 행과 인증 계정 행까지 지운다. 페어링만 해당 테이블이 없어 빠진다.

프로토콜은 **한 글자도 바뀌지 않았다.** 탈퇴는 계정 수명의 사건이지 동기화 레코드가
아니라서, `account.deleted` 같은 타입을 만들지 않고 방·메시지마다 묘비를 올리지도 않는다
(그건 지우기 직전에 사적인 내용을 전부 올리는 일이다). 소유자 네임스페이스를 통째로 지운다.

로컬 쪽도 §29.3의 "이 기기 데이터 삭제"와 **같은 한 줄**을 쓴다
(`apps/web/src/lib/local-data/db.ts`의 `deleteLocalDbForViewer`). 다른 점은 그 뒤다:
데이터 삭제는 다시 동기화하면 서버에서 전부 돌아오지만, 탈퇴는 서버 쪽도 함께 사라져
돌아올 것이 없다.

### 29.5 기기 취소 — 있는 것보다 없는 게 낫다

모든 기기가 **같은 DEK**를 공유한다. 서버에서 기기 행을 지워도 그 기기가 이미 아는 DEK는
사라지지 않는다. 그 기기가 세션을 유지하면 계속 pull할 수 있고, 세션을 잃어도 이미 받은
데이터는 로컬에 있다.

```text
진짜 암호적 취소 = DEK 회전 + 전 레코드 재암호화
                   (서버의 모든 레코드를 새 DEK로 다시 올려야 한다)
```

**따라서 v1에 기기 관리 UI를 만들지 않는다.** "기기 해제" 버튼이 있는데 실제로는
전송만 막는다면, 그건 사용자에게 거짓말을 하는 UI다. `sync_device` 테이블을 v1에 두지
않는 이유도 같다(§15).

지금 제공할 수 있는 정직한 것: **"이 기기에서 신뢰 해제"**(자기 기기에 대해서만) 와
**복구 코드 회전**(옛 코드 무효화).

---

## 30. Legacy Migration Policy

### 결정: **데이터 모델 호환 없음. 암호 포맷 호환 없음. 이관 없음.**

#### 데이터 모델(조사 §91)

증거:

| 레거시 | 지금 | 판정 |
| --- | --- | --- |
| `preset` (편집 문서 + 대화 템플릿 + 갤러리 사본 + DRM 컨테이너) | 없음. 네 역할을 의도적으로 해체 | 매핑 불가 |
| `folder`, `persona`, `character`(보관함), `memory` | 없음 | 대응 없음 |
| `room` (opt_key, bgm, provider, model, thinking, history_win, temperature, summary, summarized_upto_id, content_level, gallery_origin, favorite, parent_room …) | `ChatRoom`(seed 기반, 8필드) | 정보의 대부분이 여기에 자리가 없다 |
| `message` (speaker, token_count, cost_usd, cache_*_tok …) | `ChatMessage` | 부분 매핑 |
| 로컬 정수 id + `sync_id` | UUID 단일 | id 재발급 필요 |
| owner = invite id(레거시 member.code 계열) | `member.id` | 다른 신원 공간 |
| `SYNC_PAYLOAD_VERSION = 5` + v1 keywords→lore 읽기 호환 | 새 스키마 | — |

레거시 payload를 우리 도메인 모델로 옮기는 것은 변환이 아니라 **제품 재해석**이다.
"이 preset은 초안인가 방인가"를 코드가 결정할 수 없다.

#### 암호 포맷(조사 §92)

암호 호환만 유지하면 "클라이언트가 레거시 DEK로 복호화 → 변환 → 우리 형식으로 재암호화"가
가능해 보인다. **그래도 하지 않는다.**

- 얻는 것: 레거시 키링·복구 코드를 재사용해 사용자가 코드를 한 번 덜 입력한다. **그뿐이다.**
- 잃는 것: 우리 AAD 조성이 레거시 형태(`owner\0sync_id\0type\0protocolVersion`)에
  영구히 묶인다. 봉투 버전 필드도 넣을 수 없다(레거시 blob에 없다). `auth_key` nullable
  분기가 따라온다. 레거시 keyring `v:2`를 우리가 알아야 한다.
- 그리고 **owner가 다르다.** 레거시 AAD의 owner는 레거시 member 신원이고 여기서는
  `member.id`다. AAD가 다르면 어차피 레코드 복호화가 실패한다 — 키링만 호환돼도
  레코드는 호환되지 않는다. **암호 호환의 실익이 구조적으로 거의 0이다.**

#### 이관이 필요해지면(설계상 열려 있는 경로)

**클라이언트 사이드 임포터만.** 서버-대-서버는 제로지식이라 구조적으로 불가능하다.

```text
레거시 웹 앱(또는 일회성 임포트 페이지)
  → 레거시 DEK로 로컬 복호화 (또는 이미 로컬에 있는 평문 사용)
  → 우리 도메인 모델로 변환 (사람이 정한 매핑: preset → StoryDraft, room → ChatRoom …)
  → LocalDb에 **새 dirty 레코드**로 write
  → 평범한 부트스트랩이 서버로 올린다
```
이를 위해 지켜야 하는 유일한 제약: **레코드 id가 우리 쪽에서 발급됐다고 가정하지
않는다.** §8의 id 형식(`^[A-Za-z0-9_-]{8,64}$`)이 이미 그 여지를 준다.

---

## 31. Security Test Matrix

`@rowcat/sync` 단위 테스트 + `apps/api` 통합 테스트(진짜 Postgres, `describe.skipIf`).

| # | 검증 | 위치 |
| --- | --- | --- |
| S1 | 서버 응답 어디에도 `auth_key`가 없다(모든 키링 라우트의 JSON 스캔) | api |
| S2 | 서버가 DEK를 받는 경로가 없다(요청 스키마에 그 자리가 없음을 타입·런타임으로) | api |
| S3 | 키링 setup 두 번째 호출은 409, 저장값 불변 | api |
| S4 | rewrap이 유효한 proof 없이는 403(없음/틀림/다른 키링에 묶인 proof) | api + sync |
| S5 | rewrap proof가 **정확히 그 keyring 문자열**에 묶인다(공백 하나 달라도 실패) | sync |
| S6 | `authKey`가 owner에 묶인다(같은 DEK, 다른 owner → 다른 키) | sync |
| S7 | AAD owner 바꿔치기 → 복호화 실패 | sync |
| S8 | AAD recordId 바꿔치기 → 복호화 실패 | sync |
| S9 | AAD type 바꿔치기 → 복호화 실패 | sync |
| S10 | AAD envelopeVersion 바꿔치기 → 복호화 실패 | sync |
| S11 | 서버가 type 변경을 충돌로 거부(같은 id, 다른 type) | api |
| S12 | 페어링 코드 불일치 → 복호화 실패(채널 바인딩) | sync |
| S13 | 페어링 owner 불일치 → 복호화 실패 | sync |
| S14 | 페어링 공격자 키쌍(등록된 pub를 만들지 않은) → 실패 | sync |
| S15 | 페어링 payload는 1회만 소비된다(두 번째 폴링은 없음) | api |
| S16 | 복구 코드 1글자 오타 → 체크섬 거부(복호화 시도 전) | sync |
| S17 | 틀린 복구 코드 → 검증자 없이 AEAD 태그로만 실패 | sync |
| S18 | 회전이 DEK를 바꾸지 않는다(회전 후 기존 레코드가 그대로 복호화됨) | sync |
| S19 | 회전 후 옛 복구 코드는 실패한다 | sync |
| S20 | nonce가 매 암호화마다 다르다 | sync |
| S21 | **비밀 로깅 정적 스캔**(dek/plaintext/ciphertext/recoveryCode/payload/priv) | sync |
| S22 | 다른 owner의 레코드를 pull/push할 수 없다(세션 A로 B의 데이터 요청) | api |
| S23 | 요청 본문의 `owner`/`viewerId` 필드는 **무시된다**(스키마에 없어 거부) | api |
| S24 | 리플레이: 오래된 `rev`의 inbound는 적용되지 않는다 | sync |
| S25 | 쿼터 초과 시 거부되고 부분 적용이 없다 | api |
| S26 | 멱등 키 재사용 + 다른 본문 → 409, 상태 불변 | api |
| S27 | 잘못된 봉투 구문(`v` 없음, iv 길이 이상) → 400, 저장 안 됨 | api |

---

## 32. Data-consistency Test Matrix

두 개의 인프로세스 "기기"(각자 fake-indexeddb LocalDb + SyncStore)를 하나의 인메모리
가짜 서버에 붙여 돌린다. 웹 테스트가 React 없이 도는 기존 성격을 그대로 따른다.

### 기본 전파
| # | 시나리오 | 기대 |
| --- | --- | --- |
| D1 | A가 방 생성 → B가 pull | B에 같은 방(복호화 동일) |
| D2 | A가 메시지 추가 → B가 pull | 메시지 + 방 `updatedAt` 갱신 |
| D3 | A가 초안 + 자식 3종 생성 → B가 pull | 그래프 전체 |
| D4 | A가 편집 → B가 pull | 갱신 반영, `dirty=false` |
| D5 | A가 삭제 → B가 pull | B에서 사라짐(목록·조회 모두) |
| D6 | clean 레코드는 다시 push되지 않는다 | push 0건 |

### 충돌
| # | 시나리오 | 기대 |
| --- | --- | --- |
| D7 | A·B가 **다른** 레코드 편집 | 둘 다 살아남는다 |
| D8 | A·B가 **같은** 메시지 편집(둘 다 완결) | HLC 승자, 양쪽 동일 결론 |
| D9 | A는 미완결 저장, B는 완결 저장 | **완결본이 이긴다**(HLC와 무관) |
| D10 | A가 초안 title, B가 초안 scenario(오프라인) | **둘 다 살아남는다**(필드 그룹) |
| D11 | A·B가 같은 그룹(scenario) 편집 | HLC 승자 하나, 양쪽 동일, 진단 이벤트 발생 |
| D12 | A가 삭제, B가 편집 | **삭제가 이긴다**, 부활 없음 |
| D13 | A·B가 동시 삭제 | 멱등, 오류 없음 |
| D14 | A·B가 동시 재정렬 | 두 기기가 **같은** 최종 순서, 중복 position 없음 |
| D15 | 방 삭제 후 그 방의 메시지가 늦게 도착 | 삭제된 채로 기록, 화면에 안 보임 |
| D16 | 자식이 부모보다 먼저 도착 | 저장됨, 안 보임 → 부모 도착 후 보임 |
| D17 | `publishedStoryId` 단조성(한쪽이 null) | null로 되돌지 않는다 |

### 프로토콜 견고성
| # | 시나리오 | 기대 |
| --- | --- | --- |
| D18 | push 응답 유실 후 같은 멱등 키로 재시도 | 캐시된 응답, 서버 version 불변 |
| D19 | 멱등 키 없이 lost-ack 재시도 | 충돌 → pull → 자기 `rev` 인식 → 수렴(느리지만 옳다) |
| D20 | pull 페이지 적용 중 크래시(트랜잭션 abort) | 커서 미전진, 재시도로 같은 페이지 재적용 |
| D21 | 같은 pull 요청 반복 | 멱등, 상태 동일 |
| D22 | 알 수 없는 record type이 pull에 섞임 | 무시 + **커서 전진**, 그 id로 어떤 write도 없음 |
| D23 | 알 수 없는 payload schemaVersion(더 높음) | 위와 동일 |
| D24 | 알 수 없는 envelope version | 위와 동일 |
| D25 | 손상된 ciphertext | 무시 + 커서 전진 + 진단 카운터 |
| D26 | 페이지 경계에 걸친 부모/자식 | 최종 상태 동일 |

### 부트스트랩·시계·계정
| # | 시나리오 | 기대 |
| --- | --- | --- |
| D27 | 두 기기가 동시에 keyring setup | 하나만 성공(409), 진 쪽은 unlock 경로로 |
| D28 | 로컬·서버 둘 다 데이터 있는 상태로 첫 활성화 | **합집합**, 어느 쪽도 유실 없음 |
| D29 | 전체 재동기화 후 로컬 dirty 변경이 보존된다 | 보존 |
| D30 | B의 시계가 +2시간, A가 실시간으로 나중에 편집 | 두 기기 **교신 후**에는 인과 순서 보존(조사 §35) |
| D31 | 동기화 중 계정 전환 | 늦은 응답이 새 스코프에 쓰지 않는다 |
| D32 | 같은 계정 로그아웃→재로그인 중 동기화 | 옛 저장소 인스턴스로 쓰지 않는다 |
| D33 | 두 탭 동시 동기화 | 데이터 손상 없음(락이 있으면 한쪽만 실행) |
| D34 | 틀린 복구 코드 | 잠금 유지, 로컬 데이터 무손상 |

### 크로스 플랫폼 왕복(조사 §94)

모바일 UI가 없어도 **바이트 수준 상호운용**을 증명할 수 있다:

```text
1. @rowcat/sync 테스트가 고정 DEK·고정 nonce·고정 payload로 **골든 벡터**를 만든다.
   (packages/sync/src/__fixtures__/vectors.json — 봉투·키링·페어링 각각)
2. 웹 subtle AEAD 경로와 noble 경로가 **같은 벡터를 서로 복호화**한다.
3. 코덱은 순수 TS라 플랫폼 무관이지만, 미래 SQLite SyncStore가 붙으면
   같은 벡터를 적용해 같은 로컬 상태에 도달하는지 대조한다(parity 테스트).
   레거시가 apps/mobile/src/lib/db/sync/__tests__/parity.test.ts 로 하던 것과 같은 축.
4. 골든 벡터는 **회귀 잠금**이다 — 봉투나 AAD를 무심코 바꾸면 이 테스트가 깨진다.
```

---

## 33. Migration Risks

되돌리는 비용 순으로 정렬한다. 위쪽일수록 지금 틀리면 나중에 고치기 어렵다.

| 순위 | 결정 | 되돌리는 비용 | 왜 그만큼 비싼가 | 완화 |
| --- | --- | --- | --- | --- |
| 1 | **암호 봉투/AAD 조성** | **최악** | 이미 올라간 모든 암호문을 클라이언트가 복호화→재암호화해야 한다. 오프라인 기기는 그 사이 참여할 수 없다 | 봉투 `v` 필드로 두 판 공존 가능하게 설계(v1에 이미 있음). 골든 벡터로 잠근다 |
| 2 | **키링 포맷 / 소지 증명** | **최악** | 키링은 하나뿐이고 교체에 소지 증명이 필요하다. 포맷을 바꾸려면 전 사용자가 복구 코드를 다시 발급받아야 한다 | `keyring.v` 필드. `auth_key` NOT NULL로 분기 축소 |
| 3 | **레코드 신원(id 체계)** | 매우 높음 | 서버 PK이자 AAD 성분이자 자식 FK. 바꾸면 전 레코드 재암호화 + 전 참조 재작성 | 로컬 PK를 그대로 쓰므로 이미 최소 결합. 형식 검증을 관대하게 |
| 4 | **묘비 보존 정책** | 매우 높음 | 지평선 열 없이 GC를 시작하면 stale 기기가 삭제를 부활시킨다. 그 시점엔 어느 기기가 stale인지 알 수 없다 | `tombstone_horizon_seq`를 **v1에 지금** 만든다(값은 0) |
| 5 | **커서 모델** | 높음 | 커서 의미가 바뀌면 전 기기가 전체 재동기화. 잘못된 시퀀스(§17의 SEQUENCE)는 조용한 유실이라 탐지도 늦다 | `protocolEpoch`로 강제 재동기화 경로 확보. §17을 주석으로 코드에 박는다 |
| 6 | **충돌 의미론** | 높음 | 바꾸는 순간 옛 클라와 새 클라가 서로 다른 승자를 확정해 **영구 분기**한다(레거시가 실제로 겪음) | 병합 규칙을 `@rowcat/sync`+코덱 한곳에 모은다. 규칙 변경은 프로토콜 판을 올린다 |
| 7 | **`rev`(HLC) 필드 존재 자체** | 높음 | 없이 출시하면 나중에 백필할 근거가 `updatedAt`뿐이고, 그건 정확히 신뢰할 수 없는 값이다 | v1에 반드시 포함 |
| 8 | **`dirty` 표현(0/1 + 인덱스)** | 중간 | 동기화 후에 바꾸면 마이그레이션이 다른 기기와의 정합성까지 안는다 | **첫 슬라이스 전에** M1을 끝낸다 |
| 9 | **대화 삭제 모델** | 중간 | 동기화 켠 뒤 추가하면 이미 동기화 중인 레코드의 스키마 변경 | 첫 슬라이스 전에 M3 |
| 10 | **레코드 단위(granularity)** | 중간 | 나누거나 합치면 id가 바뀐다 = 3번과 같은 비용 | `chat.room.seed` 분리를 확장점으로만 |
| 11 | **타입 어휘** | 낮음 | 네임스페이스가 있어 새 타입 추가는 무비용. 기존 타입 **이름 변경**만 비싸다 | 이름을 처음부터 도메인 어휘로(레거시 어휘 배제) |
| 12 | **기기 신원(`deviceId`)** | 낮음 | 서버가 모른다. HLC 타이브레이커일 뿐이라 재발급해도 순서만 살짝 흔들린다 | — |
| 13 | **서버 엔드포인트 경로** | 낮음 | `/v2` 안이라 나란히 열고 걷어내면 된다 | — |
| 14 | **쿼터 수치** | 매우 낮음 | 환경변수/상수 | `contracts`에 상수로 |
| 15 | **UI 표면** | 매우 낮음 | — | — |

---

## 34. Deferred Work

첫 구현에 **필요 없다.** 각각 왜 미뤄도 안전한지 적는다.

| 항목 | 왜 미뤄도 되는가 |
| --- | --- |
| ~~자동 동기화(auto-sync)~~ | **슬라이스 2에서 구현됐다**(§26 · §35.2b) |
| ~~SSE/WebSocket 깨우기~~ | **구현됐다**(SSE만, §35.2c). 예상대로 보안 모델은 바뀌지 않았고, 예상과 달리 Redis는 필요하지 않았다 — API 프로세스가 하나라 프로세스 지역 브로커로 끝났다 |
| ~~기기 페어링~~ | **구현됐다**(§13 · §35.2d). 예상대로 UX 개선이었고 프로토콜은 바뀌지 않았다 — 늘어난 것은 만료되는 중계 하나다. 예상과 달리 **초안보다 검증이 한 겹 늘었다**: 봉투를 열었다고 그 키를 믿지 않고, 기억하기 전에 기존 소지 증명 경로로 키링에 대조한다(§13의 4번) |
| 모바일 SQLite 어댑터 | `apps/mobile`이 비어 있다. 포트와 골든 벡터가 있으면 나중에 붙는다 |
| 기기 관리 UI | §29.5 — 암호가 제공하지 않는 취소를 UI가 약속하면 안 된다 |
| 에셋 blob | §28.2 — Create에 에셋 자체가 없다 |
| DEK 회전 + 전량 재암호화 | 회전이 필요한 사건(기기 취소, nonce 한도)이 아직 없다 |
| 묘비 GC | 지평선 열만 있으면 언제든 켤 수 있다 |
| 삭제된 방의 자식 묘비 스윕 | 서버 저장소 회수일 뿐, 정확성과 무관 |
| ~~충돌 사본 UI~~ | **구현됐다**(§19.5). 예상과 달리 프로토콜은 한 글자도 바뀌지 않았고, 예상대로 진단 채널과는 갈라 두어야 했다 |
| 계정 삭제 | 별도 슬라이스. §29.4가 요구사항을 이미 적어 뒀다 |
| 로컬 묘비 압축 스케줄링 | 구현은 하되 저장소가 문제가 될 때 켠다 |
| 텔레메트리 | 아래 로깅·텔레메트리 규칙 참조. 없어도 동작한다 |
| ciphertext 패딩 | §5.1에서 하지 않기로 명시 |

### 로깅·텔레메트리 규칙(조사 §84, 조사 §85) — 미루지 않는다

**절대 로그에 넣지 않는다**: 평문 payload, DEK, 복구 코드, 페어링 개인키/공유 비밀,
ciphertext(불투명해도 사용자 데이터다), `wrapKey`, `authKey`, `proof`.
정적 스캔 회귀 테스트(S21)를 첫 슬라이스에 포함한다 — 레거시의
`no-plaintext-logging.test.ts`와 같은 형태로, `packages/sync/src/**`와
`apps/api/src/services/sync/index.ts`·`routes/me/sync.ts`를 대상으로 한다.

**허용하는 진단 메타데이터**: 지속시간, 레코드 건수, 바이트 합, 오류 코드,
프로토콜/봉투 버전, 무시된 레코드 수와 그 사유 분류, 충돌 건수, 재시도 횟수.
`recordId`는 **기본적으로 넣지 않는다** — 필요한 진단은 건수와 타입으로 충분하고,
id는 사용자별 활동을 로그에서 상관시킬 수 있게 한다.

---

## 35. First Implementation Slice

### 35.1 슬라이스 1a — 선행 로컬 모델(동기화 코드 없음) — **구현됨**

동기화 없이도 그 자체로 리뷰 가능하고, 되돌리기 쉬운 순서로 먼저 넣는다.
아래는 실제로 들어간 모양이다(초안과 다른 세 곳은 §19.1 · §19.3 · §21.1의 정정에 근거가 있다).

```text
packages/contracts/src/sync.ts        ← 신규. **`Rev` 하나뿐**이다.
  + Rev = { t, c, d }  (zod, t·c는 비음수 정수, d는 비어 있지 않은 문자열)
  - SyncCodec        → 행동이라 1b의 @rowcat/sync로 간다
  - DraftFieldGroup  → 제작의 병합 어휘라 @rowcat/authoring으로 간다

packages/sync/                        ← 신규 워크스페이스. 지금은 시계만.
  src/clock.ts   tickHlc · absorbHlc · compareRev · maxRev  (순수, 벽시계 주입)
  src/clock.test.ts
  금지: React·Dexie·IndexedDB·SQLite·DOM·fetch·Node·@rowcat/chat·@rowcat/authoring

packages/chat/src/model.ts
  + ChatSoftDelete { deletedAt: string | null } — ChatRoom / ChatMessage 가 extend
  + ChatSyncMeta.dirty: boolean → 0 | 1        (IndexedDB 인덱스 가능)
  + ChatSyncMeta.rev: Rev
  + ChatStamp.rev — 순수 모델은 리비전을 **받는다**(발급하지 않는다)
  + markLocalDelete(record, now, rev)     단건 삭제: dirty·rev 오른다
  + markCascadeDeleted(record, now)       방 삭제에 딸려 감: dirty도 rev도 그대로
  + isLiveChatRecord

packages/chat/src/store.ts
  + ChatStore.deleteRoom(id) / deleteMessage(id)
  + 모든 조회가 deletedAt != null 을 거르고, 어떤 연산도 묘비를 되살리지 않는다는 계약

packages/authoring/src/model.ts
  + AuthoringSyncMeta.dirty: 0 | 1,  + .rev: Rev,  + AuthoringStamp.rev
  + DRAFT_FIELD_GROUPS / DraftFieldGroup / DraftFieldRev
  + StoryDraft.fieldRev: Record<DraftFieldGroup, Rev>
  + draftPatchFieldGroups(patch)   패치 필드 → 그룹의 **유일한 정본**
  + markDraftFieldUpdate(draft, patch, now, rev)   건드린 그룹만 tick
  + touchDraftActivity(draft, now, rev)            rev만, fieldRev는 그대로
  + markAuthoringUpdate / markAuthoringDeleted / markDraftPublished 가 rev 를 받는다

apps/web/src/lib/local-data/db.ts
  + Dexie v3:  (v1·v2 선언은 **그대로 둔다** — 그게 이관 경로다)
      rooms:        "id, updatedAt, originStoryId, dirty"
      messages:     "id, roomId, [roomId+createdAt+id], dirty"
      storyDrafts:  "id, updatedAt, publishedStoryId, dirty"
      draftCharacters:  "id, draftId, [draftId+position], dirty"
      draftLoreEntries: "id, draftId, [draftId+positionIndex], dirty"
      draftStartScenes: "id, draftId, [draftId+position], dirty"
      syncState:    "key"
  + upgrade(tx):  dirty boolean→0|1(false·0만 깨끗한 것으로 본다),
                  rev = { t: Date.parse(updatedAt) || 0, c: 0, d: deviceId } 백필,
                  대화의 deletedAt=null 백필, 초안의 fieldRev 여섯 그룹 백필,
                  syncState 초기 행(deviceId 발급 + **hlcT = 백필된 rev.t의 최댓값**)
  + on("populate"): 새 데이터베이스는 업그레이드를 타지 않으므로 여기서 상태 행을 만든다

apps/web/src/lib/local-data/sync-state.ts  LocalSyncState 행(키 "state", 에폭 1에서 시작)
apps/web/src/lib/local-data/hlc.ts         nextRev / nextRevs — **열린 트랜잭션 안에서만**
apps/web/src/lib/local-data/clock.ts       + newDeviceId (무작위 UUID, 회원 id가 아니다)
apps/web/src/lib/local-chat/store.ts       deleteRoom/deleteMessage + 조회 필터 + rev
apps/web/src/lib/local-authoring/store.ts  모든 mutation이 rev 발급, tx에 syncState 포함

테스트: packages/sync/clock · packages/chat/model · packages/authoring/model ·
        두 저장소 테스트 확장(삭제·리비전) · local-data/migration(v1·v2 → v3) ·
        local-data/hlc(영속·트랜잭션 경계·두 연결의 유일성)
UI: 없음. 삭제 버튼을 만들지 않는다.
```

**`hlcT`를 백필된 리비전의 최댓값에서 시작하는 것**이 이 이관에서 가장 조용한 결정이다.
0에서 시작하면 벽시계가 뒤로 가 있는 기기에서 이관 직후의 첫 편집이 **자기 옛 판보다 오래된**
리비전을 받고, 그 상태로 1b가 켜지면 오늘 쓴 글이 어제 판으로 돌아간다. 회귀 테스트가 그
상황을 미래 시각 픽스처로 재현한다(`local-data/migration.test.ts`).

### 35.2 슬라이스 1b — 동기화 수직 절단

```text
packages/contracts/src/sync.ts
  SYNC_PROTOCOL_VERSION, SYNC_ENVELOPE_VERSION
  EncryptedBlob, PushItem, PushRequest, PushResponse, PushConflict,
  PullRecord, PullResponse, KeyringDto, KeyringSetupRequest, KeyringRewrapRequest
  SYNC_ERROR_CODE (§아래), SYNC_LIMITS (§아래)

packages/sync/                       ← 신규 워크스페이스
  src/index.ts        (헤더 주석: 이 패키지가 **갖지 않는 것**과 이유)
  src/aead.ts         AeadProvider 포트 + nobleAead
  src/codec.ts        base64 · base32 · 압축 코덱 바이트
  src/crypto.ts       encryptRecord / decryptRecord / AAD 조성
  src/keyring.ts      createKeyring / unlockWithRecovery / rotateRecovery /
                      deriveAuthKey / proveRewrap / verifyRewrap
  src/clock.ts        HLC tick / absorb / compare
  src/registry.ts     SyncCodec 레지스트리
  src/store.ts        SyncStore 포트
  src/transport.ts    SyncTransport 포트
  src/device-key.ts   DeviceKeyStore 포트
  src/engine.ts       pull / push / bootstrap / normalSync / 청킹 / 재시도
  src/controller.ts   상태 머신(§12) — React 없음
  src/__fixtures__/vectors.json   골든 벡터

packages/chat/src/sync-codec.ts        chat.room · chat.message 코덱 + 병합 규칙
packages/authoring/src/sync-codec.ts   authoring.* 코덱 + 필드 그룹 병합

apps/api/src/db/tables/sync.ts         §15 스키마
apps/api/src/db/schema.ts              export 추가
apps/api/src/services/sync/index.ts          getKeyring/setupKeyring/replaceKeyring/verifyKeyring
                                       pullRecords/pushRecords(멱등·쿼터·검증)
apps/api/src/routes/me/sync.ts            /v2/me/sync/*
apps/api/src/routes/me/index.ts              .route("/sync", sync)  ← me 아래에 붙인다
apps/api/src/routes/me/sync.test.ts       진짜 Postgres 통합 테스트

packages/sdk/src/sync.ts               createSyncApi(transport) → client.sync.*
packages/sdk/src/client.ts             sync 리소스 등록

apps/web/src/lib/local-sync/store.ts       createDexieSyncStore(db)
apps/web/src/lib/local-sync/device-key.ts  non-extractable wrapKey + LocalDb.syncState
apps/web/src/lib/local-sync/aead.ts        subtleAead
(local-sync/scope.ts는 없다 — 동기화 런타임은 좁은 어댑터가 아니라 전체 스코프를 본다.
 하나의 `applyPull`이 모든 도메인의 저장소를 한 트랜잭션에서 쓰기 때문이다.)
apps/web/src/lib/local-data/activation.ts  LocalDataStores 에 sync 추가
apps/web/src/features/sync/                컨트롤러 배선(스코프 소유) + 설정/언락 다이얼로그
apps/web/src/features/account/data-section.tsx   문구 교체 + "동기화" 진입점
```

> **정정(1b 구현). 실제로 들어간 파일과 초안이 다른 곳.**
>
> ```text
> packages/sync/src/server.ts         신규. **서버가 import해도 되는 유일한 표면**이다
>                                     (소지 증명 검증 + 봉투 구문 검증). 그 밖의 경로가
>                                     apps/api에 나타나면 경계를 넘은 것이다.
> packages/sync/src/pairing.ts        1b 시점에는 없었다. 페어링 슬라이스가 만들었고
>                                     그때 @noble/curves가 들어왔다 — 쓰기 시작하는
>                                     슬라이스가 그 의존성을 데려온다는 규칙 그대로다.
> packages/sync/src/merge.ts          §19.2의 판정 순서(순수)와 `SYNC_MERGE_NOTE`.
>                                     타입별 규칙은 여전히 도메인 코덱이 갖는다.
> packages/sync/src/engine.ts         `SyncClock`을 주입받는다. 이 패키지는 `Date.now()`를
>                                     부르지 않는다 — 진단용 경과 시간까지 인자다.
> apps/web/src/lib/local-sync/
>   registry.ts                       코덱 조립 지점. 여기서의 타입 대입이 곧 옵션 B의 검사다.
>   transport.ts                      RowCatClient → SyncTransport 어댑터(취소 신호 타입만 옮긴다).
> apps/web/src/features/sync/
>   use-sync-controller.ts            스코프가 컨트롤러를 소유한다. **취소 신호는 넘기지
>                                     않는다** — 렌더에서 만든 AbortController를 마운트 효과의
>                                     정리에서 끊으면 StrictMode 이중 마운트가 살아 있는
>                                     컨트롤러를 끊는다. 정확성은 `ownsStore`가 갖는다.
>   sync-section.tsx                  계정 → 데이터의 한 구획.
>   recovery-code-dialog.tsx          복구 코드 1회 표시 + 확인 체크박스.
>   unlock-dialog.tsx                 복구 코드 입력. 체크섬 실패와 AEAD 실패를 다른 문구로 가른다.
> apps/web/src/test/sync-devices.ts   인프로세스 2기기 하네스 + 인메모리 서버.
> apps/api/src/lib/no-secret-logging.test.ts
>                                     정적 스캔. `packages/sync/src/**`까지 훑는다 —
>                                     그 패키지는 Node API를 알지 않기로 했으므로 스캔이
>                                     여기 산다.
> apps/api/src/app.ts                 CORS에 `Idempotency-Key`(요청)와 `Retry-After`(응답)를
>                                     더했다. 인프로세스 테스트는 CORS를 타지 않아 이 결함이
>                                     **진짜 브라우저에서만** 드러난다.
> ```

### 35.2b 슬라이스 2 — 자동 동기화 — **구현됨**

프로토콜이 한 글자도 바뀌지 않은 슬라이스다. 새 레코드 타입도, payload 스키마 변경도,
봉투 버전 상승도, 병합 규칙 변경도, 새 서버 엔드포인트도 **없다.** 서버는 요청이 버튼에서
왔는지 타이머에서 왔는지 구분할 방법이 없고, 구분할 이유도 없다.

```text
packages/sync/src/auto-sync.ts        ← 신규. 일정 관리자(순수).
  createAutoSyncCoordinator({ target, timers, localDebounceMs, lifecycleWindowMs, backoffMs })
    notifyLocalChange()  로컬 편집 — 1초 디바운스, 뒤쪽 끝
    requestSync(reason)  수명 신호 — 200ms 흡수 창, 더 이른 쪽이 이긴다
    runNow()             수동 — 즉시. 진행 중이면 후속 1회의 결과를 준다
    stop()               영구 정지. 재사용 없음
    status() / subscribe()
  classifyAutoSyncFailure(error) → network|server|unauthorized|crypto|invalid_payload|unknown
  금지: window·document·navigator·React·Dexie·setInterval·Date.now
packages/sync/src/auto-sync.test.ts   26개. 주입된 시계로 디바운스·단일 실행·후속 1회·
                                      백오프·정지를 **실제 시간 없이** 검증한다.

apps/web/src/lib/local-data/mutation-signal.ts   ← 신규.
  createLocalMutationSignal()   인자 없는 notify + subscribe
  withMutationSignal(store, reads, signal)
                                읽기 목록을 받고 **나머지를 전부 쓰기로 본다** —
                                새 메서드가 늘 때 안전한 쪽으로 틀린다
apps/web/src/lib/local-data/stores.ts            ← 신규(활성화에서 떼어 냄).
                                조립을 한 곳에 모은다. 하네스와 테스트가 **같은 함수**로
                                같은 저장소를 세우기 위해서다 — 감싸이지 않은 저장소로는
                                "로컬 변경이 자동 동기화를 깨우는가"를 검증할 수 없다.
apps/web/src/lib/local-data/sync-state.ts        + autoSyncEnabled?: boolean
                                인덱스가 아니라 Dexie 판을 올리지 않는다(`deviceKey`와 같다).
                                `undefined`가 켜짐이다.
apps/web/src/lib/local-sync/preference.ts        ← 신규. 값 하나짜리 기기 선호 포트.
apps/web/src/lib/local-sync/auto-sync.ts         ← 신규. 브라우저 어댑터.
                                visibilitychange·focus·online·로컬 신호 → 코디네이터.
                                withSyncLock이 여기로 옮겨 왔고 이제 **모든 실행**을 감싼다.
apps/web/src/lib/local-sync/provider.tsx         ← 신규(features/sync/use-sync-controller.ts를
                                대체). 컨트롤러 + 자동 동기화의 수명을 루트에서 하나만 갖는다.
                                컨텍스트는 **인스턴스만** 나른다 — 위상을 담으면 백그라운드
                                동기화마다 앱 전체가 다시 렌더된다. 구독은
                                useSyncExternalStore가 한다.
apps/web/src/lib/local-sync/auto-sync.test.ts    23개. 진짜 Dexie 위에서:
                                쓰기 → 신호, 조회 → 무신호, **원격 적용 → 무신호**,
                                실행 중 편집의 후속 1회, 삭제 경합, 계정 격리,
                                두 기기 왕복, 오프라인 축적 → 재연결.
apps/web/src/routes/__root.tsx                   SyncRuntimeProvider를 스코프 안쪽에 마운트.
apps/web/src/features/sync/sync-section.tsx      자동 동기화 토글 + 상태 두 번째 줄.
                                수동 버튼이 컨트롤러가 아니라 코디네이터를 부른다(같은 게이트).
apps/web/src/test/sync-devices.ts                제품과 같은 조립을 쓰도록 바꿨다.

건드리지 않은 것: packages/contracts, apps/api 전부, 엔진, 코덱, 병합, 골든 벡터.
```

### 35.2c SSE 깨우기 — **구현됨**

**알림 평면만 늘었다.** 데이터 평면(`/me/sync/records`)은 그대로이고, 이 슬라이스가 더한
것은 "네 네임스페이스가 전진했을 수 있다"를 열려 있는 기기에 알리는 스트림 하나다.
프로토콜은 여전히 한 글자도 바뀌지 않았다 — 레코드 타입도, payload 스키마도, 봉투 버전도,
병합 규칙도, 키링도, Dexie 판도, Postgres 스키마도 없다.

```text
━━ 계약 ━━
packages/contracts/src/sync.ts        + SYNC_WAKE_EVENT("sync") · SYNC_WAKE_CONTENT_TYPE
                                      + SYNC_WAKE_HEARTBEAT_MS(20초)
                                      + SyncWakeEvent { cursor: nonneg int }   ← **필드 하나**
                                      없는 것: 레코드 id·타입·암호문·방/작품/초안/메시지 id·
                                      HLC·기기 식별자·"충돌 있었음". 필드가 하나뿐인 것은
                                      절약이 아니라 경계다.

━━ 서버 ━━
apps/api/src/services/sync/wake.ts    ← 신규.
  createSyncWakeBroker()              프로세스 지역 구독 장부. Map<owner, Set<listener>>.
    subscribe(owner, listener) → 해지  해지는 멱등. 빈 집합은 남기지 않는다
    publish(owner, cursor)            **절대 던지지 않는다**(리스너 예외를 삼킨다)
    subscriberCount(owner?)           테스트의 관찰창. 진단 엔드포인트로 내보내지 않는다
  openSyncWakeStream({owner, signal, broker?, readCursor?, heartbeatMs?})
    ① 구독을 먼저 설치하고 ② 그 다음 durable seq를 읽는다 — 이 순서가 경합 방어의 전부다
    보낼 커서는 **가장 큰 것 하나**만 남는다(큐를 만들지 않는 것이 백프레셔 대책이다)
    이미 내보낸 커서보다 작은 값은 버린다(스트림이 뒤로 가지 않는다)
    하트비트 타이머는 **대기 안에서만** 산다 — 고아 setInterval이 없다
  SYNC_WAKE_HEADERS                   text/event-stream · private,no-store · X-Accel-Buffering:no
  금지: 레코드 읽기·복호화·도메인 어휘·영속 상태

apps/api/src/services/sync/index.ts         pushRecords가 `{response, advanced}`를 커밋하고,
                                      **트랜잭션 밖에서** advanced일 때만 publish한다.
                                      advanced = 성공 경로 하나뿐 — 충돌·멱등 재시도·
                                      롤백(쿼터·타입 예산)은 전부 false다.
                                      publish는 try로 감싼다: 이 경계는 나중에 프로세스를
                                      넘는 구현으로 갈릴 자리이고, 그때 네트워크 실패가
                                      새면 이미 커밋된 push가 실패로 보고된다.
apps/api/src/routes/me/sync.ts           + GET /events. 게이트는 pull과 같다(requireViewer) —
                                      정지·차단 계정도 연다. 키링 소지 증명은 요구하지 않는다
                                      (암호문이 나가지 않으므로 열쇠를 물을 이유가 없다).
                                      쿼리·헤더·본문에서 owner를 읽는 코드가 없다.

━━ SDK ━━
packages/sdk/src/sse.ts               ← 신규. text/event-stream 프레임 리더.
  readSse(body) → AsyncGenerator<SseFrame>
    TextDecoder{stream:true}가 멀티바이트 경계를, 줄 버퍼가 프레임 경계를 잇는다
    주석(`:`)은 버린다 · 빈 줄이 디스패치 · data 없는 프레임은 버린다
    CRLF/LF/CR 전부 · 청크 끝의 홀로 선 CR은 다음 청크를 기다린다
    구현하지 않은 것: 자동 재연결·retry 반영·Last-Event-ID 재생(전부 호출부의 수명 관리다)
packages/sdk/src/sync.ts              + wakeStream(options?) → AsyncGenerator<SyncWakeEvent>
                                      requestStream(GET /me/sync/events, accept: SSE)
                                      **네이티브 EventSource를 쓰지 않는다**: 200이 아닌
                                      응답이 전부 같은 `error` 이벤트라 401(멈춰야 한다)과
                                      503(재시도해야 한다)이 구분되지 않고, 규격상 둘 다
                                      영구 종료라 5xx에서 다시 붙지 않는다.

━━ 웹 ━━
apps/web/src/lib/local-sync/wake.ts   ← 신규. 연결의 **수명**만 갖는다.
  createWebSyncWake({controller, autoSync, open, readLocalCursor, ownsStore, isOnline?, ...})
    start() / stop() / connected()
    연결 조건 넷: 스코프 소유 + controller.trusted + autoSync.enabled + online
      **state가 아니라 trusted를 본다** — syncing을 조건에 넣으면 동기화마다 끊었다 붙는다
    깨우면 하는 일: autoSync.requestSync("remote-wake") **하나뿐**
      controller.syncNow()·engine.pull()·transport.pull()을 부르지 않는다
    로컬 커서는 **읽기만** 한다(remote <= local이면 넘어간다). 읽지 못하면 깨운다
    재연결 1·2·5·10·30초 + 지터 ±25%. 401·403은 멈춘다.
      하트비트 간격을 넘겨 산 연결만 "건강했다"로 세어 카운터를 되돌린다
apps/web/src/lib/local-sync/transport.ts  + createSyncWakeStream(client)
                                      기능 코드가 엔드포인트를 모르게 남기는 한 겹
apps/web/src/lib/local-sync/provider.tsx  런타임에 wake 하나를 더한다. 만들기는 렌더,
                                      시작·정지는 효과 — 자동 동기화와 같은 규칙이다.
                                      정리는 wake를 **먼저** 끊는다.

━━ 테스트 ━━
apps/api/src/services/sync/wake.test.ts    17개. 소유자 격리·구독/읽기 경합·합치기·
                                           단조성·하트비트·구독 누수·durable 읽기 실패.
apps/api/src/routes/me/sync.test.ts           +13개(진짜 Postgres). 401 · 헤더 · Alice/Bob 격리 ·
                                           쿼리 owner 무시 · 알린 커서를 즉시 pull ·
                                           50건→프레임 하나 · 연속 커밋 · 멱등 재시도 무알림 ·
                                           충돌 무알림 · **롤백 무알림** · 재연결 초기 프레임 ·
                                           장부 누수 · 프레임 바이트에 커서 말고 없음.
packages/sdk/src/sse.test.ts               18개. 줄 중간·UTF-8 중간·CRLF 경계 분할,
                                           한 청크 다중 이벤트, 주석, 다중 data, 미완결 프레임.
packages/sdk/src/sync.test.ts              +10개. 경로·Accept·계약 검증·모르는 이벤트 무시·
                                           깨진 JSON·스트림 이전 HTTP 오류·취소.
apps/web/src/lib/local-sync/wake.test.ts   32개. 연결 조건 · 잠금/토글/오프라인 전이 ·
                                           StrictMode · 다리가 하나뿐임 · 로컬 커서 불변 ·
                                           중복/폭주 · 백오프 상한 · 401 정지 · 계정 격리.
apps/web/src/lib/local-sync/wake-devices.test.ts  ← 신규. 7개. 진짜 Dexie 두 벌 + 인메모리
                                           서버로 **B가 아무것도 하지 않고** 수렴하는 것을
                                           본다(방 생성·이름 변경·삭제·초안). 핵심 단언은
                                           B의 코디네이터에 들어간 이유가 `remote-wake`
                                           **하나뿐**이라는 것이다 — startup·visible이 섞이면
                                           그 테스트는 기존 안전망을 검증한 것이 된다.

건드리지 않은 것: @rowcat/sync 전부(엔진·코덱·병합·컨트롤러·auto-sync·골든 벡터),
Dexie 스키마, Postgres 스키마, 키링, 봉투, SYNC_PROTOCOL_VERSION.
```

**배포 전제**: API 프로세스 하나. 브로커는 프로세스 안에서만 퍼지고, 복제본이 둘 이상이
되면 고칠 곳은 `publish` 하나다(Redis pub/sub 또는 Postgres `LISTEN/NOTIFY`) — 라우트·계약·
클라이언트는 바뀌지 않는다. 그때까지 복제본이 늘어도 증상은 오류가 아니라 **지연**이다:
다른 프로세스에 붙은 기기는 깨우기를 놓치고 시작·포그라운드·재연결로 따라잡는다.

### 35.2d 기기 페어링 — **구현됨**

**만료되는 중계 하나만 늘었다.** 프로토콜은 또 한 번 그대로다 — 레코드 타입도, payload
스키마도, 레코드 봉투 버전도, 병합 규칙도, 키링도, Dexie 판도, `SYNC_PROTOCOL_VERSION`도
바뀌지 않았다.

```text
━━ 계약 ━━
packages/contracts/src/sync.ts        + SYNC_PAIRING_VERSION(1)  ← 레코드 봉투와 **다른 축**
                                      + SyncPairingCodeHash(hex 64) · SyncPairingPublicKey
                                      + SyncPairingPayload(≤1KiB, 서버는 파싱하지 않는다)
                                      + SyncPairingDto { newPublicKey, payload, expiresAt }
                                      + Start/Lookup/Approve 요청 셋
                                      + SYNC_LIMITS.pairingTtlMinutes/MaxActive/PayloadMaxBytes
                                      + 오류 코드 다섯(§35.4)
                                      없는 것: 코드 원문·DEK·개인키·공유 비밀·owner·
                                      기기 이름/플랫폼/위치. 자리 자체가 없다.

━━ 순수 프로토콜 ━━
packages/sync/src/pairing.ts          ← 신규. @noble/curves(x25519)가 여기서 들어왔다.
  generatePairingCode()               10바이트 → Crockford base32 16글자, 4글자 네 묶음
  normalizePairingCode()              **정규화의 유일한 주인**. 파생·AAD·해시가 이것을 쓴다
  pairingCodeHash(owner, code)        SHA-256(prefix\0owner\0정규코드)의 hex
  generatePairingKeyPair()            개인키는 반환 객체 밖으로 나가지 않는다
  sealPairingDek() / openPairingDek() ECDH → HKDF(salt=owner\0code) → AES-256-GCM
  parsePairingEnvelope()              **서버는 이 함수를 모른다**(/server에 없다)
packages/sync/src/crypto.ts           + PAIRING_AAD_PREFIX · pairingAad()  ← 세 번째 도메인
packages/sync/src/codec.ts            + bytesToHex()  ← DB 키·본문·로그에 놓이는 값의 표기
packages/sync/src/transport.ts        + start/read/approve/cancel 네 연산
packages/sync/src/pairing-runner.ts   ← 받는 쪽의 **순서**. startPairingRun() → PairingRun
                                        { code, expiresAt, poll(), cancel() }
                                      + PairingKeyRejectedError · PAIRING_POLL_INTERVAL_MS
                                      poll()이 **한 호출 안에서** 열고→키링에 대조하고→
                                      검증된 DEK를 돌려준다. 저장은 하지 않는다.
                                      갈라 둔 이유: 이 순서를 지켜야 하는 기기가 셋이다
                                      (웹·모바일·rowcat-mcp). 컨트롤러 안에 두면 저장소·
                                      기기 키·상태 발행이 함께 딸려 오는데 MCP에는 셋 다 없다.
packages/sync/src/controller.ts       + startPairing() → PairingSession { code, expiresAt,
                                        poll(), cancel() } · approvePairing(code)
                                      러너 위에 **앱의 것 둘**만 얹는다:
                                      스코프 판정(ownsStore) · 기기 키 기억 · 소비 후 중계 정리

━━ 서버 ━━
apps/api/src/db/tables/sync.ts        + sync_pairing(owner, code_hash, new_pub, payload,
                                        created_at, expires_at) PK(owner, code_hash)
apps/api/src/services/sync/pairing.ts ← 신규. 시작(만료분 청소 + 상한 + onConflictDoNothing)·
                                        조회(만료를 같은 문장에서)·승인(조건부 UPDATE)·
                                        취소(멱등 DELETE). **payload를 파싱하지 않는다.**
apps/api/src/routes/me/sync.ts           + 네 라우트. 해시는 경로가 아니라 본문이다.
apps/api/src/services/account/deletion.ts  + 진행 중 페어링도 같은 트랜잭션에서 지운다
apps/api/drizzle/0008_oval_shotgun.sql     CREATE TABLE sync_pairing + 인덱스

━━ SDK · 웹 ━━
packages/sdk/src/sync.ts              + 네 메서드. 응답을 계약으로 읽는다(필드가 늘면 떨어진다)
apps/web/src/lib/local-sync/transport.ts   + 네 줄
apps/web/src/features/sync/pair-device-dialog.tsx      ← 신규. 코드 표시 + 2초 폴링 + 만료
apps/web/src/features/sync/approve-pairing-dialog.tsx  ← 신규. 코드 입력 + 되돌릴 수 없음 고지
apps/web/src/features/sync/sync-section.tsx  잠김 → [다른 기기로 연결][복구 코드 사용]
                                             신뢰 → [새 기기 연결] …

━━ 헤드리스 기기(rowcat-mcp) ━━
apps/mcp/src/pairing.ts               러너 위의 CLI 어댑터 — 폴링 일정 · 화면 · **승인이 온
                                      순간 /me를 다시 물어 계정이 그대로인지 본다**.
                                      복구 코드를 묻는 자리가 없다(`unlock`이 그쪽이다).
apps/mcp/src/setup.ts                 planSetup(config, viewer) → login | pair | ready.
                                      소유권 판정은 `dekForViewer` 하나를 그대로 쓴다.

━━ 테스트 ━━
packages/sync/src/pairing.test.ts                    21건. 채널 바인딩·변조·저차 위수·정규화
apps/api/src/routes/me/sync-pairing.test.ts             19건. 진짜 Postgres. 경합·격리·제로지식
apps/web/src/lib/local-sync/pairing-devices.test.ts  10건. 두 기기 E2E·거절·계정 전환
apps/api/src/lib/no-secret-logging.test.ts           + sync-pairing.ts와 네 이름을 스캔에 더했다

건드리지 않은 것: 엔진·코덱·병합·auto-sync·wake·골든 벡터·키링 형식·Dexie 스키마·
레코드 봉투·SYNC_PROTOCOL_VERSION.
```

### 35.3 최소 제품 표면(조사 §82)

계정 → 데이터 구획에 **이것만** 둔다:

```text
상태 한 줄:   "동기화 꺼짐" / "잠김" / "마지막 동기화: 3분 전" / "오류: <코드>"
[동기화 설정]  → 다이얼로그: DEK 생성 → 복구 코드 1회 표시(복사/확인 체크박스)
[잠금 해제]    → 다이얼로그: 복구 코드 입력
[지금 동기화]  → 수동 1회 실행, 진행 표시
[이 기기 신뢰 해제]
[복구 코드 재발급]
```

만들지 않는 것: 기기 목록, 충돌 목록, 동기화 이력, 진행률 바, 자동 동기화 토글
(자동이 없으므로 토글할 것이 없다).

### 35.4 오류 코드 분류(조사 §89)

```ts
// packages/contracts/src/sync.ts
export const SYNC_ERROR_CODE = {
  // 상태
  notConfigured:       "sync_not_configured",      // 404 — 키링 없음
  locked:              "sync_locked",              // 403 — 서버는 이 상태를 모른다. 클라 전용
  // 커서·레코드
  cursorInvalid:       "sync_cursor_invalid",      // 400 — 음수·NaN
  cursorExpired:       "sync_cursor_expired",      // 410 — 묘비 지평선 초과(v1 미발생)
  recordInvalid:       "sync_record_invalid",      // 400 — id/type/봉투 구문
  payloadTooLarge:     "sync_payload_too_large",   // 413 — 레코드·배치 상한
  quotaExceeded:       "sync_quota_exceeded",      // 507 — 계정 총량
  // 멱등
  idempotencyMismatch:   "sync_idempotency_mismatch",   // 409
  idempotencyInProgress: "sync_idempotency_in_progress",// 409 + Retry-After
  // 키링
  keyringExists:       "sync_keyring_exists",      // 409
  keyringMissing:      "sync_keyring_missing",     // 404
  keyringProofInvalid: "sync_keyring_proof_invalid",// 403
  // 페어링(구현됨 — 초안과 어휘가 다르다, 아래)
  pairingNotFound:        "sync_pairing_not_found",        // 404 — 만료·취소도 같은 코드다
  pairingExists:          "sync_pairing_exists",           // 409 — 같은 해시가 이미 열려 있다
  pairingAlreadyApproved: "sync_pairing_already_approved", // 409 — 먼저 온 승인이 이겼다
  pairingTooMany:         "sync_pairing_too_many",         // 429 — 동시 세션 상한
  pairingKeyRejected:     "sync_pairing_key_rejected",     // **클라이언트 전용**
} as const
```
충돌은 **오류 코드가 아니다**(§18.2) — 200 + `{ok:false, conflicts}`다.

> **정정(페어링 구현).** 초안의 `pairingExpired`(410)를 **만들지 않았다.** 만료된 세션은
> 없는 세션과 같아야 하는데(§8), 두 코드를 가르면 그 분기가 만료분 청소의 타이밍에 따라
> 뒤집혀 같은 상황이 어떤 날은 404고 어떤 날은 410이 된다. 만료 문구는 클라이언트가 자기가
> 받은 `expiresAt`으로 만든다. `pairingAlreadyUsed` → `pairingAlreadyApproved`로 이름을
> 좁혔고(소비가 아니라 **승인**의 경합이다), 상한과 클라이언트 전용 거절 코드가 늘었다.

### 35.5 상한(조사 §55)

```ts
export const SYNC_LIMITS = {
  recordIdMaxLength:      64,
  typeMaxLength:          32,
  ciphertextMaxBytes:     512_000,      // 레코드 1건
  pushMaxItems:           200,
  pushMaxTotalBytes:      4_000_000,
  pullDefaultLimit:       200,
  pullMaxLimit:           500,
  ownerMaxRecords:        200_000,
  ownerMaxTotalBytes:     536_870_912,  // 512 MiB
  ownerMaxDistinctTypes:  32,
  keyringMaxBytes:        4_096,
  idempotencyTtlDays:     7,
  pairingTtlMinutes:      5,
  pairingMaxActive:       5,
  pairingPayloadMaxBytes: 1_024,        // 실제 봉투는 300바이트 남짓이다
} as const
```
서버는 이 상수를 **다시** 검증한다(클라이언트 값을 믿지 않는다). 쓰기 라우트에는 기존
회원 쓰기 리미터를 그대로 건다.

### 35.6 서버 검증(조사 §54)

복호화하지 못해도 검증할 수 있는 것 전부:

```text
id       /^[A-Za-z0-9_-]{8,64}$/
type     /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,2}$/  ,  ≤32자
ciphertext  deleted=false 면 필수·비어 있지 않음 / deleted=true 면 null 이어야 한다
            (레거시는 "null 또는 빈 문자열"을 허용했다 — 여기서는 null만)
envelope    1..255 정수
ciphertext  JSON.parse 가능 + { v:number, iv:string, ct:string } 구문
            **iv 는 base64 12바이트여야 한다**(복호화 없이 확인 가능)
baseVersion 0 이상 정수
배치        id 중복 금지, 건수·총 바이트 상한
쿼터        record_count·total_bytes 를 sync_state 에서 원자적으로 갱신·검사
```

### 35.7 멀티탭

§25 그대로. Web Locks API 한 줄이고(`navigator.locks.request`, 락 이름은 viewerId 스코프),
미지원 환경은 동시 실행을 허용한다 — 정확하되 낭비일 뿐이다.

### 35.8 계정 전환 안전(조사 §73)

동기화 컨트롤러는 **`LocalDataStores` 인스턴스가 소유**한다. 모듈 싱글턴을 만들지 않는다.
`startStoryChat`의 패턴을 그대로 따른다:

```text
1. ensureStore()로 sync 저장소를 받는다        (스코프가 열릴 때까지 기다림)
2. 그 인스턴스를 소유권 토큰으로 캡처
3. 네트워크 왕복
4. **로컬에 쓰기 직전** ownsStore(sync, captured) 재확인 — false면 조용히 끝낸다
5. 다음 페이지마다 4를 반복한다
```
`viewerId`만으로는 부족하다 — `Alice → 로그아웃 → Alice`가 같은 id로 새 인스턴스를 연다.
`activation.ts`의 세대(generation) 규칙이 이미 그 축을 갖고 있다.

### 35.9 자동 동기화

**슬라이스 2에서 구현됐다.** 설계와 실제로 배선된 모양은 §26에, 파일 목록은 §35.2b에 있다.
슬라이스 1의 유일한 트리거였던 `지금 동기화` 버튼은 **그대로 남아 있고**, 이제 자동 실행과
같은 게이트를 지난다 — 진단·복구·QA·명시적 재시도의 자리라 자동이 생겼다고 없앨 이유가 없다.

### 35.10 슬라이스 순서(조사 §97)

```text
1a  선행 로컬 모델 + Dexie v3          — 동기화 코드 0. 되돌리기 쉬움   — **구현됨**
     ↓ (필수 선행: 1b의 모든 것이 이 필드들을 읽는다)
1b  @rowcat/sync + 서버 + SDK + 웹 어댑터 + 수동 동기화 + 복구 코드   — **구현됨**
     ↓ (프로토콜이 증명된다)
2   자동 동기화 + 오류 표면 + 진단                                  — **구현됨**
     ↓ (일상 사용이 가능해진다)
4   SSE 깨우기                                                    — **구현됨**
     ↓ (지연이 줄어든다. 순수 최적화라 3보다 먼저 왔다)
3   기기 페어링 + "이 기기 신뢰" 관리 UI                            — **구현됨**
     ↓ (새 기기 UX가 완성된다 — 복구 코드 없이 기기를 늘릴 수 있다)
5   모바일 SQLite SyncStore + 골든 벡터 parity 테스트
     ↓ (웹 ↔ 모바일 왕복)
6   에셋 blob 엔드포인트
7   묘비 GC + 자식 스윕 + 계정 삭제
8   (필요해지면) DEK 회전 + 재암호화 + 진짜 기기 취소
```

의존 관계:
- **1a → 1b**: `rev`·`dirty` 인덱스·`deletedAt`이 없으면 1b가 성립하지 않는다.
- **1b → 2**: 자동은 수동 위에 얹는 층이다.
- **1b → 3**: 페어링은 DEK 전송이고, DEK 상태 머신이 먼저 있어야 한다.
- **1b → 5**: 골든 벡터가 1b에서 만들어져야 모바일이 대조할 기준을 갖는다.
- **4는 어디든**: 순수 최적화. 실제로 3보다 먼저 왔고, 그래도 아무것도 막히지 않았다 —
  Redis pub/sub도 필요하지 않았다(API 프로세스가 하나라 프로세스 지역 브로커로 충분하다).
  복제본이 둘 이상이 되는 날 고칠 곳은 `publish` 하나다.
- **7 → 8**: 회전은 재암호화이고, 그건 묘비·GC가 안정된 뒤에 한다.

---

## 부록 A. Final Diagrams

### 데이터 복제

```text
        Web LocalDb (IndexedDB)                        Mobile SQLite (미래)
     rooms · messages · storyDrafts                  같은 논리 스키마
     draftCharacters · draftLoreEntries
     draftStartScenes · syncState
                │ 평문                                          ▲ 평문
                ▼                                               │
        SyncCodec (도메인 소유)                            SyncCodec (같은 코드)
      encode: record → payload{schemaVersion, rev, data}         │
                │                                               │
                ▼                                        merge(local, remote)
      encodeRecordPlaintext  [codec byte][DEFLATE?]              ▲
                │                                               │
                ▼                                        decodeRecordPlaintext
      encrypt(DEK, AAD=rec.v1|owner|id|type|env)                 ▲
                │ ciphertext                                     │
                ▼                                        decrypt(DEK, 같은 AAD)
      {v:1, iv, ct} → JSON                                       ▲
                │                                               │
                ▼                                               │
      POST /v2/me/sync/records                    GET /v2/me/sync/records?since=
      (Idempotency-Key)                                          ▲
                │                                               │
                ▼                                               │
   ┌─────────────────────────────────────────────────────────────────────┐
   │  PostgreSQL — 불투명 저장소 (서버는 ciphertext를 절대 해석하지 않는다)  │
   │  sync_record(owner, id, type, ciphertext, envelope, version, seq,   │
   │              updated_at, deleted, bytes)                            │
   │  sync_state(owner, seq, tombstone_horizon_seq, record_count, bytes) │
   │  sync_keyring(owner, keyring, auth_key)                             │
   └─────────────────────────────────────────────────────────────────────┘
```

### 신원

```text
                    Better Auth user
                    (email · password · OAuth account)
                            │  1:1, member.user_id UNIQUE, ON DELETE CASCADE
                            ▼
                    RowCat member
                    Viewer.id            ◀── 동기화 소유권. 서버는 세션에서만 읽는다.
                            │                클라이언트가 말할 수 있는 자리가 없다.
        ┌───────────────────┼───────────────────────────┐
        │                   │                           │
        ▼                   ▼                           ▼
  Auth Session(s)     LocalDataScope              Sync Device(s)
  쿠키. 여러 개.        rowcat_chat_<id>      deviceId (32 hex)
  로그아웃으로 사라짐.   ├ ChatStore                 wrapped DEK
  **동기화 수명과 무관** ├ AuthoringStore            ├ web: non-extractable CryptoKey
                       ├ SyncStore                 │       + 같은 LocalDb
                       └ syncState                 └ mobile: Keychain/Keystore
                         cursor · epoch                    (owner별 키)
                         deviceId · HLC             서버는 이 신원을 모른다.
                         initialSyncDone            (payload 안 rev.d 로만 존재)
```

### 키

```text
                    random DEK (256-bit, 불변)
                    서버가 절대 모른다
                            │
   ┌────────────────┬───────┴────────┬──────────────────────┬─────────────────┐
   │                │                │                      │                 │
   ▼                ▼                ▼                      ▼                 ▼
레코드 암호화     복구 래퍼      기억된 기기 래퍼        페어링 전송        인증키 파생
                                                        (슬라이스 3)
AES-256-GCM   recovery 128b     web:                  x25519 ECDH        HKDF-SHA256
레코드마다     ↓HKDF-SHA256      non-extractable         ↓HKDF             (DEK,
랜덤 nonce     salt=random16     AES-GCM CryptoKey      salt=owner\0code    salt=owner,
              info=recovery-v1  (extractable:false)     info=pairing-v1     info=auth-v1)
AAD=          ↓                 ↓                       ↓                  ↓
 rec.v1       AES-GCM(k,DEK)    AES-GCM(k,DEK)         AES-GCM(K,DEK)     authKey
 |owner       AAD=key.v1        LocalDb.syncState      AAD=pair.v1         ↓
 |recordId       |owner                                   |owner|code    HMAC-SHA256
 |type           |recovery      mobile:                                  (authKey,
 |envelopeVer    ↓              expo-secure-store       서버는 relay만     keyringJson)
              서버 sync_keyring  (owner별 키)            평문 DEK 모름       ↓
              .keyring                                                    proof
                                                                          → 서버가
   sync_record.ciphertext                                                   sync_keyring
                                                                            .auth_key로
                                                                            상수시간 검증
                                                                          (auth_key는
                                                                           **응답에
                                                                           절대 안 나감**)
```

---

## 부록 B. 최종 권고

```text
RECOMMENDED SYNC ARCHITECTURE:

  레코드 단위 봉투 암호화 + 서버는 불투명 blob 저장소.

  신원    소유권 = member.id = Viewer.id. 세션에서만 나온다.
          로컬 레코드 id가 곧 동기화 id다(syncId 이중 신원 없음).
          Sync Device는 클라이언트가 만드는 제3의 신원이고 서버는 그것을 모른다.

  암호    AES-256-GCM(레코드마다 랜덤 12B nonce) + 불변 랜덤 256비트 DEK.
          AAD = rowcat.sync.rec.v1\0owner\0recordId\0type\0envelopeVersion.
          version은 AAD에 넣지 않는다 — 대신 인증되는 평문 안의 rev가 롤백을 막는다.
          봉투에 명시적 v 필드(레거시에 없던 것).
          복구 코드 128비트 랜덤 → HKDF-SHA256 → DEK 래핑.
          authKey = HKDF(DEK, owner) → HMAC 소지 증명이 키링 교체를 지킨다.
          setup은 first-writer-only. 기기 기억은 non-extractable CryptoKey / Keychain.

  전송    /v2/me/sync/{keyring,records}.
          pull: 회원별 단조 시퀀스 커서(전역 카운터도, Postgres SEQUENCE도 아니다).
          push: 배치 원자적 + baseVersion 낙관적 동시성 + Idempotency-Key.
          충돌은 오류가 아니라 200 + {ok:false, conflicts}.

  충돌    벽시계 LWW를 쓰지 않는다. HLC(Hybrid Logical Clock) rev가 전순서를 만들고,
          타이브레이커는 deviceId다.
          chat.message  = 완결본 우선 → HLC
          chat.room     = 불변 필드(seed 등) 보호 + HLC, updatedAt은 max
          authoring.draft = 6개 필드 그룹 병합(제목과 시나리오를 동시에 잃지 않는다)
          그 밖의 초안 자식 = 레코드 HLC
          순서 필드 = HLC + 적용 후 형제 정규화
          삭제 = 항상 이긴다

  삭제    소프트 삭제 일원화. 별도 묘비 테이블 없음. 부활이 구조적으로 불가능하다.
          방 삭제는 묘비 하나 + 수신 측 캐스케이드.
          서버 묘비는 v1에서 영구 보존하되 tombstone_horizon_seq 열을 지금 만든다.

  원자성  pull 페이지의 적용과 커서 전진이 **같은 트랜잭션**이다(레거시 최대 결함의 수정).
          Dexie rw 트랜잭션과 SQLite BEGIN IMMEDIATE에 1:1로 매핑된다.

  패키지  @rowcat/contracts가 와이어와 코덱 인터페이스를 갖는다.
          @rowcat/sync(신규, 순수)가 암호·엔진·포트·상태 머신을 갖는다.
          payload 스키마는 각 도메인이 소유한다(옵션 B) — @rowcat/sync는
          chat도 authoring도 import하지 않는다.

  레거시  데이터 모델도 암호 포맷도 호환을 만들지 않는다. 필요해지면
          클라이언트 사이드 임포터만이 가능한 경로다.
```

```text
RECOMMENDED NEXT IMPLEMENTATION SLICE:

  1a. 선행 로컬 모델 (동기화 코드 0줄)
      · ChatRoom/ChatMessage 에 deletedAt + ChatStore.deleteRoom/deleteMessage (UI 없음)
      · dirty: boolean → 0|1 + 여섯 테이블 전부에 dirty 인덱스
      · 모든 레코드에 rev(HLC), StoryDraft 에 fieldRev 6그룹
      · Dexie v3 (v1·v2 선언 유지) + upgrade 백필 + syncState 테이블/deviceId 발급
      · @rowcat/contracts 에 Rev·DraftFieldGroup·SyncCodec 타입

  1b. 동기화 수직 절단
      · @rowcat/contracts/sync.ts   와이어 스키마 · 오류 코드 · 상한
      · packages/sync/              봉투 암호 · 키링 · HLC · 엔진 · 포트 · 컨트롤러
                                    + 골든 벡터 픽스처
      · chat/authoring 의 sync-codec.ts   payload 코덱 + 타입별 병합 규칙
      · apps/api  sync_record · sync_state · sync_keyring · sync_push_dedupe
                  services/sync/index.ts · routes/me/sync.ts (me 아래) · 진짜 PG 통합 테스트
      · packages/sdk/src/sync.ts
      · apps/web  Dexie SyncStore · device-key · subtle AEAD · 스코프 소유 컨트롤러
      · UI 최소:  계정 → 데이터에 상태 한 줄 + [설정] [잠금 해제] [지금 동기화]
                  [신뢰 해제] [복구 코드 재발급]
      · 테스트:   인프로세스 2기기 + 가짜 서버로 §32 매트릭스 전부

  이후 순서: 자동 동기화(**완료**) → SSE 깨우기(**완료**) → 페어링 → 모바일 SQLite
            → 에셋 → GC
```

```text
ARCHITECTURAL BLOCKERS BEFORE IMPLEMENTATION:

- 대화 삭제 모델이 존재하지 않는다.
  ChatRoom·ChatMessage 에 deletedAt 이 없고 ChatStore 에 삭제 연산이 없다.
  삭제 표현 없이 동기화를 켜면 삭제를 전파할 방법이 영영 생기지 않는다.
  → 해결책은 정해져 있다(§20.3). 슬라이스 1a에서 UI 없이 모델·저장소만 만든다.

- dirty 가 IndexedDB 로 인덱싱할 수 없는 boolean 이다.
  push 후보 수집이 전 테이블 스캔이 되고, 메시지가 수만 건인 계정에서 실사용이 불가능하다.
  동기화를 켠 뒤에 바꾸면 그 마이그레이션이 다른 기기와의 정합성까지 안게 된다.
  → 0|1 로 바꾸고 인덱스를 건다(§23 M1). 지금이 가장 싼 시점이다.

- 병합 축(rev/HLC)이 레코드에 없다.
  지금 있는 시간 축은 updatedAt 뿐이고, 그것으로 병합하면 레거시의 벽시계 LWW를
  그대로 재현한다(조사 §35의 실패 모드).
  → Rev 를 모델에 넣고 upgrade 에서 백필한다(§23 M2, M4).

  셋 다 **미해결 질문이 아니라 선행 작업**이다. 설계상 남은 결정은 없다.
```

### 확정 기본값으로 닫은 제품 결정

"open question"으로 남기지 않는다. 각각 권고·이유·나중에 바꾸는 비용을 적는다.

| 결정 | 권고 기본값 | 이유 | 바꾸는 비용 |
| --- | --- | --- | --- |
| 복구 코드를 잃고 신뢰 기기도 없을 때 | **서버 데이터는 영구히 읽을 수 없다.** 파기 후 재설정 버튼은 v1에 만들지 않는다 | 서버가 DEK를 모른다는 약속의 필연적 귀결. 되돌릴 수 없는 버튼은 지원 경로가 생긴 뒤에 | 낮음 — 나중에 버튼만 추가 |
| 기기 취소 | **제공하지 않는다.** "이 기기 신뢰 해제"(자기 기기)만 준다 | 같은 DEK를 공유하므로 취소는 회전+재암호화 없이는 환상이다(§29.5) | 높음 — 진짜 취소는 DEK 회전 슬라이스 |
| 삭제 vs 오프라인 편집 | **삭제가 이긴다.** 편집을 잃는다 | 결정적이고 부활이 없다. 사본 보존은 UI 없이는 "안 지워졌다"로 읽힌다 | 중간 — 사본 보존은 병합 규칙 + UI |
| 초안 같은 그룹 동시 편집 | **HLC 승자 하나.** 진 쪽 판은 사라진다 | 필드 그룹이 이미 대부분의 실제 케이스를 살린다. 남은 것은 드물다 | 중간 — 진단 이벤트를 먼저 관찰한 뒤 결정 |
| 동시 재정렬 | **수렴하되 어느 쪽 의도도 아닐 수 있다** | 시퀀스 CRDT 비용 대비 이득이 없다. 사용자가 다시 끌면 고쳐진다 | 중간 |
| 메타데이터 패딩 | **하지 않는다** | 트래픽 분석 방어를 주장하지 않기로 했다(§5.1) | 낮음 — 봉투에 패딩 필드 추가 |
| 서버 타입 어휘 | **형식 제약 + owner당 32종 상한** | 고정 allowlist는 앞선 클라이언트를 뒤처진 서버가 막는다(§16.7) | 낮음 |
| 묘비 보존 | **영구(v1)** | 행당 ~120B. 부활 문제를 통째로 없앤다 | 낮음 — 지평선 열이 이미 있다 |
| 자동 동기화 기본값 | **슬라이스 2에서 기본 ON** | 켜지지 않는 동기화는 없는 동기화다. 수동은 프로토콜 증명용 | 낮음 |
| 삭제된 방의 서버 메시지 | **남긴다(v1)** | 방 삭제를 O(1)로 유지한다. 자식 스윕은 후속 | 낮음 |
| 정지·차단 회원의 pull | **허용한다**(쓰기만 막는다) | 계정 제한이 데이터 인질이 되면 안 된다 | 낮음 |
