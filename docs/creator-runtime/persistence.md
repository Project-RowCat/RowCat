# 플레이어 저장 — 스냅샷이 레코드가 되어 기기 사이를 건너는 자리

크리에이터 런타임의 저장 상태(`useStoryState`·`usePersistentState`)가 **어디에 남고 어떻게
다른 기기에 도착하는가.** 그 값의 **엔진**은 `story-state.md`가 갖고, 여기서는 그 스냅샷이
제품의 레코드가 되는 층만 적는다.

```text
제작자 TSX
    ↓  useStoryState · usePersistentState
QuickJS 안의 저장 상태 등록부 둘
    ↓  성공한 커밋의 델타(수명마다 다른 채널)
호스트의 스냅샷 둘                      플랫폼 중립 · 스코프가 없다
    ↓  onStoryStateCommit / onPersistentStateCommit
저장 조율자                             @rowcat/runtime-persistence
    ↓  합치기 · 직렬 쓰기
회원 스코프의 로컬 DB                    Dexie(웹) · SQLite(모바일)
    ↓  HLC · dirty
도메인 코덱                              runtime.playthrough · runtime.persistent
    ↓  기존 봉투 암호(AES-256-GCM)
POST /v2/me/sync/records
    ↓
불투명한 sync_record                    **서버는 내용을 읽지 못한다**
```

## 1. 레코드가 둘이다 — 그리고 그것이 이 층의 전부다

한 행에 두 수명을 담는 모양이 훨씬 짧다:

```json
{ "storyState": {}, "persistentState": {} }
```

만들지 않는다. 그 모양이면 동기화 레코드도 하나이고, 그러면 **A 기기의 챕터 진행과 B 기기의
엔딩 해금이 한 충돌 도메인에 들어간다.** 저장 스냅샷은 제작자가 정한 임의의 값이라 병합이
전체 레코드 LWW일 수밖에 없고(§5), 그 규칙 아래에서 둘 중 하나는 **반드시 사라진다.**

행이 둘이면 두 갱신이 각자의 HLC로 각자 이겨 함께 살아남는다. 플레이 초기화가 긴 진행에
닿지 않는 것도 같은 사실의 다른 면이다 — 초기화는 플레이스루 행 하나를 빈 스냅샷으로
전진시키는 일이고, 그 조작에 영구 행을 가리키는 문법이 없다.

## 2. 신원이 결정적이다

```text
runtime-playthrough:<작품 id>:<슬롯>
runtime-persistent:<작품 id>
```

무작위 id면 두 기기가 각자 만든 저장 레코드 둘이 살아남고, 동기화는 그 둘을 병합할 근거가
없다 — 어느 것이 이 작품의 진행인지 아무도 답할 수 없다.

**작품 id를 그대로 쓰지 않는다.** 서버의 레코드 기본키는 `(owner, id)`이고 타입이 그 열쇠에
들어가지 않으므로, 두 수명이 같은 id를 쓰면 같은 행을 놓고 다툰다. 접두사가 그 충돌을 막는
전부다(`authoring.runtimeProject`·`chat.summary`가 같은 이유로 같은 모양이다).

**슬롯은 V1에 하나뿐인데도 id에 있다.** 지금 빼면 슬롯이 여럿이 되는 날 id 규칙이 바뀌고,
그러면 이미 동기화된 저장이 새 규칙에서 다른 레코드가 된다. 저장 슬롯 UI는 이 판에 없다.

## 3. payload에 없는 것

```text
회원 id · 기기 id · 저장 시각의 벽시계 · rev · dirty · serverVersion · 동기화 상태
```

소유는 로컬 데이터베이스의 스코프와 서버의 세션이 이미 정한다. 값으로 한 번 더 적으면 그
값이 인가처럼 보이기 시작하고, 그 둘이 어긋나는 날 무엇이 권위인지 답할 수 없다.

**제작자 코드도 이 축을 보지 못한다.** `useStoryState()`가 돌려주는 것은 값과 설정자뿐이고,
`rev`·`dirty`·`lastSyncedAt` 어느 것도 VM 안에 들어가지 않는다.

## 4. 서버는 불투명하다

서버가 보는 것은 다른 동기화 도메인과 **똑같다**: 소유자(세션에서), 레코드 id, 타입,
암호문, 봉투 판, 시퀀스. `chapter`도 `endings`도 제작자의 열쇠도 그 행에 없다.

```text
서버 테이블 없음        runtime_save · runtime_story_state 같은 JSONB 열을 만들지 않는다
서버 라우트 없음        POST /stories/:id/runtime-save 를 만들지 않는다
서버 타입 어휘 없음      SyncRecordType은 정규식이고 허용 목록이 아니다
```

그래서 이 슬라이스는 **API 서버를 한 글자도 고치지 않았다.** 늘어난 것은 클라이언트가 보내는
타입 이름 둘이고, 그 둘은 이미 있는 술어를 지난다.

## 5. 충돌 — 전체 레코드 HLC LWW

깊은 병합이 **금지**다. 저장 스냅샷은 제작자가 정한 임의의 값이라 일반 동기화 계층이 안전하게
섞을 방법이 없다:

```text
A: { inventory: ["칼"],  chapter: 5 }
B: { inventory: ["방패"], chapter: 3 }
     ↓ 열쇠별 병합
   { inventory: ["방패"], chapter: 5 }   ← 아무도 만든 적 없는 상태
```

배열은 더 나쁘다(합치면 없던 아이템이 생기고, 고르면 있던 것이 사라진다). 그래서 승자는
레코드 통째이고, 그 대가는 §1의 분리로 줄인다.

**초기화는 삭제가 아니라 더 새로운 상태다.** 묘비를 쓰지 않고 빈 스냅샷을 더 높은 리비전으로
올린다 — 로컬에서 행을 지우는 방식은 전파되지 않아, 아직 옛 진행을 들고 있는 기기가 다음
동기화에 그것을 되살린다.

## 6. 두 원자성은 다른 경계다

```text
런타임의 원자성    UI 패치와 저장 상태가 **함께** 전진한다     VM과 호스트 사이
저장의 내구성      언젠가 디스크에 있다                      조율자와 로컬 DB 사이
```

커밋 경로에서 IndexedDB를 `await`하지 않는다. 프레임 하나가 저장소의 지연에 묶이고, 무엇보다
저장이 실패했을 때 **이미 그려진 렌더를 되돌려야** 하는데 그건 불가능하다. 그래서 저장 실패는
런타임의 실패가 아니라 조율자의 상태(`failed`)이고, 원하는 최신 값은 그대로 남는다.

그 사이에 **창이 하나 있다.** 런타임이 커밋한 뒤 로컬 DB가 커밋하기 전에 프로세스가 죽으면 그
마지막 커밋은 내구적이지 않다. 좁히되 없애지 않는다 — 없애려면 커밋이 디스크를 기다려야 하고,
그건 위 문단이 거절한 바로 그것이다.

## 7. 큐가 아니라 "지금 원하는 값" 하나

```text
쓰는 중: 10   도착: 11 · 12   →   실제 쓰기: 10, 12
```

스냅샷은 **전체 상태**라 마지막 것 하나면 앞의 전부를 담는다. 전부 큐에 쌓으면 그 큐에 상한이
없고, 중간 값은 아무도 필요로 하지 않는다.

**뒤로 가지 않는다.** 스코프마다 쓰기가 하나이고 다음 쓰기는 앞의 것이 끝난 뒤에 시작한다 —
그 직렬화가 곧 순서 보장이다. 실패한 쓰기는 되풀이되지 않고, 재시도는 **최신 값 하나**를 쓴다.

## 8. "저장이 없다"를 세 갈래로 가른다

```text
ready          로컬에 유효한 저장이 있다(비어 있을 수도 있다 — 그것이 새 게임이다)
sync-required  로컬에 없고 첫 동기화가 아직 끝나지 않았다 — **새 게임이 아니다**
failed         저장소가 죽었거나 저장된 값이 손상되었다 — **덮지 않는다**
```

가운데 갈래가 이 계약의 이유다. 갓 페어링한 기기에서 "행이 없다"를 `ready`로 접으면 몇 달치
진행이 있는 계정에서 새 게임이 시작되고, 그 첫 커밋이 진짜 저장을 덮는다.

**로컬 우선이다.** 유효한 로컬 저장이 있으면 첫 동기화를 묻지 않는다 — 순서가 뒤집히면
오프라인의 정상 실행이 매번 `sync-required`가 되어 아무도 게임을 이어 갈 수 없다.

**손상된 값을 덮지 않는다.** 검증에 실패한 행은 그대로 두고 실패를 알린다. 검증 하나 때문에
진행이 사라지면 안 되고, 나중의 복구 도구가 읽을 원본이 아직 거기 있어야 한다.

## 9. 마이그레이션의 내구화

```text
저장된 판 v1
    ↓  세션 부팅 — QuickJS 안에서 migrate가 돈다
정본 v2 스냅샷
    ↓  sessionHydrated()  ← 세션이 **성공적으로 선 뒤에만** 부른다
로컬 쓰기 · 새 HLC · dirty
    ↓
동기화
```

값이 그대로면 아무것도 쓰지 않는다. 쓰면 세션을 여는 일마다 리비전이 오르고, 그 레코드는
매번 dirty가 되어 아무것도 바뀌지 않은 push가 계속 나간다.

**실패한 마이그레이션은 저장된 값을 한 글자도 바꾸지 못한다.** 세션이 서지 못하므로 그 호출이
일어날 자리가 없다 — 조용히 `initial`로 떨어뜨리면 제작자의 마이그레이션 버그가 플레이어의
진행 삭제가 된다.

## 10. 한도 — 내구 쓰기 **앞**이다

```text
런타임 호스트의 스냅샷 상한    1 MiB          제작자가 한 번에 얼마나 들 수 있는가
동기화 레코드의 암호문 상한    512,000 바이트  우리가 한 레코드로 얼마를 나를 수 있는가
제품 저장의 상한              256 KiB        **그 둘 사이에 우리가 긋는 선**
```

최대 크기의 스냅샷은 압축이 듣지 않으면 레코드 하나에 들어가지 않는다. 그 실패를 push까지
미루면 사용자에게는 "며칠 전부터 동기화가 멈췄다"로만 보이고, 그때 로컬에는 이미 올릴 수 없는
값이 앉아 있다. 그래서 한도를 쓰기 앞으로 당긴다.

**런타임의 한도를 여기에 맞춰 낮추지 않는다.** 두 질문의 답이 같아야 할 이유가 없다.

## 11. 판의 축이 다섯이다 — 섞지 않는다

```text
RUNTIME_API_VERSION                  제작자가 쓸 수 있는 이름의 집합. 어휘가 늘거나 줄면 오른다
스냅샷의 formatVersion               호스트 중립 스냅샷의 모양. 지금 1이다
제작자 정의의 version                 제작자 스키마의 판. migrate가 읽는 값이다
코덱의 schemaVersion                  저장 payload의 모양. 지금 1이다
SYNC_PROTOCOL_VERSION · 봉투 버전     프로토콜. **이 슬라이스가 건드리지 않았다**
```

## 12. 스튜디오 미리보기는 이 층에 닿지 않는다

제작자의 시험이 자기 플레이어 진행을 고치면 안 된다. 미리보기의 스냅샷은 **워커의 메모리**이고
스튜디오가 열려 있는 동안 산다 — 새로고침하면 사라지고, 화면이 그 사실을 적는다. 그 폴더가
저장 도메인이나 로컬 저장소를 들이지 않는다는 사실을 정적 스캔이 지킨다.

미리보기의 세 조작:

```text
다시 시작        VM만 새로 세운다 — 두 수명 다 이어받는다
플레이 초기화     플레이스루만 비운다
긴 진행 초기화    그 반대. 제작자·디버그 전용이다
```

## 12A. 조율자 사이의 순서 — 재생 수명주기

§7의 직렬화는 조율자 **하나** 안의 것이다. 세션이 바뀌면 조율자도 바뀌고, 그 둘 사이의
순서(옛 조율자의 마지막 쓰기 → 새 조율자의 `load()` 또는 초기화 쓰기)는 이 패키지의
`RuntimePlayerLifecycle`이 갖는다(`lifecycle.ts`). 옛 주인의 정지·흘려보내기·폐기가 끝난
뒤에만 다음 조율자가 만들어지고, 명시적 다시 시작·초기화의 흘려보내기에는 시한이 없다 —
끝나지 않으면 세우지 않는다. 전체 규칙은 `player.md` §12에 있다.

## 13. 이 판이 만들지 않은 것

```text
발행된 작품의 재생 화면(웹 · 네이티브)      Phase 7
저장 슬롯 UI · 수동 저장/불러오기
서버가 읽는 저장 · 클라우드 저장 표시
usePersistentState 밖의 능력 가족
```

**게스트의 저장은 열려 있지 않다.** 동기화되는 레코드에는 소유자가 필요하고 그 소유자는
세션에서만 나온다 — 게스트를 위해 가짜 소유자를 지어내지 않는다. 게스트의 런타임은 세션
메모리로 돌고, 앱·기기를 넘는 내구 저장은 그에게 없다. 그 사실을 재생 표면이 적는 것은
Phase 7의 일이다.

## 15. 셋째 레코드 — `runtime.conversation`은 저장 상태가 아니다

```text
런타임 저장 상태        runtime.playthrough · runtime.persistent     §1–§13 그대로
런타임 서재의 줄        runtime.conversation                        이 절 — **제품 메타데이터**
```

Phase 7의 대화 표면 통합이 하나를 더했다: 이 회원이 이 런타임 플레이스루를 열었고 이어 갈 수
있다는 **사실**. `/chats`와 최근 대화가 그 줄을 그린다(`player.md` §14). 저장 상태의 세 번째
수명이 **아니다** — 스냅샷도 없고, 재생 수명주기의 소유권 절차(§12A) 밖에서, 자격이 확인된
재생 응답 하나가 적는다.

```text
runtime-conversation:<작품 id>:<슬롯>     신원은 플레이스루의 신원을 따른다
{ storyId, slot, title, createdAt, updatedAt, removedAt }
```

**저장 행에서 투영하지 않는 이유가 넷이다.** 첫 열기에 커밋이 없을 수 있다(화면만 그린
세션). `useStoryState`를 하나도 정의하지 않는 런타임이 있다. 목록에서 치우는 일은 플레이
초기화가 아니다. 저장 스냅샷의 `updatedAt`(마지막 커밋)은 서재의 활동(마지막으로 연 시각)과
다른 값이다.

**치우기가 묘비가 아니다 — 알고 정한 것이다.** 이 엔진에서 묘비는 최종이라(`decideInbound`의
`keep-deleted`) 원격의 살아 있는 판이 와도 로컬 묘비가 이긴다. 그런데 서재에서 치운 작품을
다시 열면 같은 신원의 줄이 **양쪽 기기에서** 되살아나야 한다. 그래서 치우기는 `removedAt`을
세우는 **더 새로운 상태**이고(§5의 초기화와 같은 모양) 전체 레코드 LWW 위에서 치움과 다시
열기가 결정적으로 수렴한다. 이 도메인이 `deletedAt`을 세우는 경로는 없다.

**서버는 §4 그대로다.** 늘어난 것은 타입 이름 하나이고 그 행의 제목은 암호문 안에 있다.
**게스트의 줄은 없다**(§13) — 소유자가 없는 서재는 없다.

## 14. 잠그는 자리

```text
packages/runtime-persistence/src/boundaries.test.ts        계층 · 전송 · UI · 생성/결제의 부재
packages/runtime-persistence/src/sync-codec.test.ts        신원 · 왕복 · 전체 레코드 LWW · 깊은 병합의 부재
packages/runtime-persistence/src/coordinator.test.ts       합치기 · 순서 · 실패 · 세 갈래의 불러오기
packages/runtime-persistence/src/lifecycle.test.ts         조율자 사이의 순서 — 다시 시작·초기화 경합 · 전이 중 저장 실패
packages/runtime-persistence/src/store-contract.ts         두 어댑터가 지나는 **같은** 행동 스위트
apps/web/.../local-runtime-save/store.test.ts              Dexie 어댑터 · 계정 격리 · 내구 재개방
apps/web/.../local-runtime-save/runtime-session.test.ts    TSX → QuickJS → Dexie → 다시 QuickJS
apps/web/.../local-sync/runtime-save-roundtrip.test.ts     두 기기 수렴 · 초기화 전파 · 서버의 불투명함
apps/web/.../local-sync/runtime-conversation-roundtrip.test.ts  서재 줄의 수렴 · 치움의 전파 · 되살림 · 진행의 불변
packages/runtime-persistence/src/conversation.test.ts      서재 줄의 신원 · 만들기와 갱신의 규칙 · 코덱 · 서는 조건
apps/web/.../local-runtime-save/conversation-store.test.ts Dexie 어댑터 · 계정 격리 · 저장 상태의 불변
apps/mobile/.../local-data/runtime-conversation-store.test.ts SQLite 어댑터 · 같은 스위트 · v13 → v14
apps/mobile/.../local-data/runtime-conversation-sync.test.ts 수집 · 적용 · 계정 격리
apps/web/.../local-sync/codec-wire.test.ts                 레지스트리와 저장소 표가 같다
apps/mobile/.../local-data/runtime-save-store.test.ts      SQLite 어댑터 · 같은 스위트 · v12 → v13
apps/mobile/.../local-data/runtime-save-sync.test.ts       수집 · 적용 · 계정 격리
apps/mobile/.../local-data/table-wire.test.ts              레지스트리와 저장소 표가 같다
apps/web/.../runtime-preview-boundaries.test.ts            미리보기가 제품 저장에 닿지 않는다
```
