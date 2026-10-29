# 저장 상태 — `useStoryState` · `usePersistentState`

크리에이터 런타임의 **상태 능력 둘**이다. 컴포넌트 하나의 기억(`useState`)이 아니라
**저장이 소유하는 값**이고, VM을 버리고 새로 세워도 이어진다.

이 문서는 그 **엔진**의 규칙과 근거를 적는다. 그 스냅샷이 어디에 저장되고 어떻게 기기
사이를 건너는지는 `docs/creator-runtime/persistence.md`가 갖는다. 코드의 근거는
`packages/runtime/src/internal/durable-state.ts`(코어)와 그 위의 두 수명
(`story-state.ts`·`persistent-state.ts`), 그리고 `packages/runtime-host/src/durable-snapshot.ts`
헤더에 있다.

## 1. 수명이 셋이다

```text
useState             이 런타임 세션 동안만        컴포넌트가 갖는다. 다시 시작하면 처음부터
useStoryState        이 플레이스루/저장 동안      플레이스루가 갖는다
usePersistentState   회원 + 작품의 긴 진행         **플레이 초기화를 넘어 산다**
```

셋째가 Phase 6B에서 왔다. 두 저장 수명은 같은 엔진을 쓰되 **등록부도 스냅샷도 저장
레코드도 둘**이라, 플레이 초기화가 긴 진행에 닿을 문법 자체가 없다.

```text
defineStoryState({ key: "progress", ... })        ┐ 열쇠 공간이 갈려 있다
definePersistentState({ key: "progress", ... })   ┘ 같은 이름이 다른 것을 뜻한다
```

두 정의는 **다른 형**이다(브랜드 심볼이 갈려 있다). `useStoryState(persistentDefinition)`도
그 반대도 형에서 막히고, 그 사실을 컴파일러 테스트가 진짜 프로그램으로 확인한다 — 섞이면
화면은 오류 없이 틀리고, 증상은 플레이 초기화가 몇 달치 진행을 지우는 날에야 드러난다.

`useStoryState`는 `useState`의 별칭이 **아니다.**

```text
컴포넌트 A   useStoryState(game)   ┐
                                  ├→ 같은 논리 값 하나
컴포넌트 B   useStoryState(game)   ┘
```

A의 갱신은 B의 다음 커밋된 렌더에 보인다. 그래서 값이 훅 슬롯이 아니라 VM 안의 저장 상태
등록부에 있고, 슬롯이 드는 것은 **열쇠와 설정자**뿐이다.

## 2. 정의

```ts
const game = defineStoryState({
  key: "game",        // 저장된 값의 신원. 변수 이름이 아니라 문자열이다
  version: 2,         // 제작자 스키마의 판. 런타임 API의 판이 아니다
  initial: { chapter: 1, trust: 0, evidence: [] },
  migrate: (stored, fromVersion) => {
    if (fromVersion === 1) {
      const old = stored as { chapter: number; trust: number };
      return { ...old, evidence: [] };
    }
    throw new Error(`Unsupported version ${fromVersion}`);
  },
});
```

- **모듈 최상단에서 한 번.** 등록은 제작자 모듈이 평가되는 동안 일어나고, 그 평가가 끝나면
  등록부가 **봉인된다**. 렌더 중의 정의는 `runtime_story_state_definition_late`다 — 화면이
  그려지는 동안 새 저장 스키마가 조용히 생기면 그 세션의 스냅샷이 무엇을 담고 있는지 답할
  수 없다.
- **열쇠는 유일하다.** 같은 열쇠의 두 정의는 초기값이 같아도 거절된다
  (`runtime_story_state_duplicate_key`) — 먼저 실행된 쪽을 고르면 남의 저장 데이터를 읽는
  코드가 조용히 성립한다.
- **ESM 싱글턴이 중복이 아니다.** 정의를 내보내는 모듈을 셋이 import해도 그 모듈은 한 번
  평가되고 등록도 한 번이다.
- **판에 상한이 없다**(양의 안전 정수). 마이그레이션이 없던 동안 `STORY_STATE_VERSION_MAX`는
  `1`이었고 그때 그 값의 뜻은 "이 런타임이 읽을 수 있는 판"이었다. 판이 제작자 스키마의
  것이 된 지금 그 뜻은 사라졌다 — `2`로 올리는 것은 같은 함정을 한 칸 뒤로 미루는 일이라,
  상한을 값의 **성질**로 바꿨다(심볼은 이미 내보내진 것이라 그대로 둔다).

### ⚠️ 초기값이 상태의 형을 좁히지 않는다

가장 자연스러운 선언은 `initial: T & SerializableShape<T>`이고 Phase 1이 실제로 그랬다.
그때는 아무도 그 값에 쓰지 않아 드러나지 않았는데, `useStoryState`가 오면서 드러났다:
그 교집합이 **추론의 출처**라 `{ trust: 40 }`이 리터럴 `40`으로 좁혀지고

```ts
setStory((c) => ({ ...c, trust: c.trust + 10 }))   // number는 40에 assignable하지 않다
```

이 타입에서 막힌다. 값을 바꿀 수 없는 상태 타입은 이 API의 뜻과 정반대다. 그래서 추론은
`initial: T` 하나에서 일어나고, 직렬화 검사는 **T가 정해진 뒤에 풀리는 조건부 교집합**이
한다(지연 조건부 타입은 추론의 출처가 아니다). 그 사실을 컴파일러의 테스트가 **값을 바꾸는
코드**로 확인한다(`packages/runtime-compiler/src/compile.test.ts`의 `저장 상태`).

## 3. 부팅

```text
VM 생성 → 내장 설치 → 제작자 모듈 그래프 평가
                        └ defineStoryState(...) → 등록부
      ↓ hydrateStoryState(스냅샷, 한도)     ← 호스트가 부른다. 여기서 등록부가 봉인된다
스냅샷 검증 · 판 대조 · 마이그레이션 · 값 소유
      ↓
mountRoot → 첫 렌더
```

**비동기 하이드레이션이 없다.** 첫 렌더가 `initial`을 잠깐 보고 저장된 값으로 바뀌는
프레임은 존재하지 않는다 — 그 프레임은 잘못된 화면이고, 그것을 본 사람은 자기 진행이
사라졌다고 읽는다. 그래서 하이드레이션은 세션이 호출부에 넘어가기 **전에** 끝나고, 반쯤
하이드레이션된 세션은 밖에서 관찰되지 않는다.

항목 하나의 판정:

```text
정의에 항목이 없다     initial의 **소유된 사본**
판이 같다             저장된 값(검증 뒤)
저장된 판이 낮다       migrate → 직렬화 검증 → 한도 → 새 판으로 굳는다
저장된 판이 높다       실패 — 옛 코드가 새 저장을 여는 일이다
정의가 없는 항목       VM에 오지 않는다. 호스트의 스냅샷이 그대로 들고 있다
```

초기값이 **사본**인 것이 요점이다. 정의는 얼어 있지만 그 안의 중첩 객체는 아니라, 그대로
상태로 쓰면 제작자가 손댄 객체에서 다음 초기화가 시작한다.

## 4. 갱신과 커밋

```text
setStoryState(값 | 함수)
   접는다 → Object.is 비교 → 직렬화 검증 → 항목 한도 → 보류값에 앉는다
   → 루트에 렌더 요청 하나
렌더            커밋된 값 위의 보류값을 읽는다 — 소비하지 않는다
성공한 루트 커밋  보류값이 커밋된 값이 되고, 바뀐 열쇠만 델타로 나간다
```

- **큐가 없고 보류값 하나다.** `useState`는 갱신 함수를 큐에 쌓고 렌더가 접지만, 저장되는
  값은 **큐에 들어가기 전에** 직렬화 검사와 한도를 지나야 한다. 함수형 갱신의 순서
  (`x => x + 1` 셋이 `+3`)는 접는 시점이 앞당겨져도 그대로다 — 각 호출이 지금 보류값 위에서
  접는다.
- **배치는 스케줄러 작업 단위다.** 한 이벤트 핸들러 안의 갱신 셋은 렌더 하나·커밋 하나다.
- **`Object.is`로 같은 값은 아무것도 하지 않는다.** 렌더 요청도 델타도 없다.
- **렌더 중의 갱신은 거절된다**(`runtime_state_update_during_render`).
- **사라진 컴포넌트의 설정자는 경고 하나를 남기고 무시된다.** 언마운트가 저장 값을 지우지
  않는다 — 값은 플레이스루의 것이고, 끝난 것은 그 훅의 구독뿐이다.
- **훅 슬롯 하나는 정의 하나를 뜻한다.** 같은 자리에서 다른 정의를 넘기면
  `runtime_story_state_hook_changed`다.

## 5. 원자성

이 판에서 가장 조심한 자리다.

```text
렌더가 던졌다              보류값 그대로 · UI 그대로 · 스냅샷 그대로 · 재시도가 같은 값을 읽는다
호스트가 패치를 거절했다     같다 — 저장 상태도 전진하지 않는다
패치가 하나도 없는 렌더      **저장 상태는 커밋된다** — 상태 커밋과 패치 수는 다른 축이다
```

순서가 그 약속의 구조다:

```text
델타를 **미리 본다**(소비하지 않는다)
  → 패치가 있으면 commit 채널로 내보내고 승낙을 받는다   ← 거절되면 여기서 전부 되돌린다
  → 저장 상태 델타를 story-state 채널로 내보낸다
  → 트리를 적용하고, 보류값을 커밋한다
```

저장 상태가 UI **뒤**에 나가는 것이 "패치가 거절되면 저장 상태도 전진하지 않는다"의 표현이다.
반대 순서로 두면 UI가 거절된 렌더의 값이 이미 호스트의 스냅샷에 앉는다. `story-state` 채널의
거절은 **호스트의 버그다** — VM이 같은 규칙으로 먼저 검증하고 보낸다.

**커밋 묶음은 설정자마다가 아니라 논리 커밋마다 하나다.** UI 패치 프로토콜
(`RuntimePatchBatch`)은 한 글자도 바뀌지 않았다 — 웹·네이티브 렌더러는 저장 상태가 무엇인지
알지 않는다.

## 6. 스냅샷

```ts
interface RuntimeStoryStateSnapshot {
  formatVersion: 1;
  entries: readonly { key: string; version: number; value: Serializable }[];
}
```

- **스코프가 없다.** `storyId`·`draftId`·`userId`·`saveSlotId`·`deviceId` 어느 것도 없다.
  그 값들은 스냅샷을 **어디에 두는가**를 정하는 저장 조율자의 어휘다. 그 무지 덕분에 같은
  엔진이 스튜디오 미리보기·웹 재생·네이티브 재생·테스트·나중의 저장 슬롯에서 그대로 쓰인다.
- **정본 표현은 열쇠 순이다.** 같은 논리 상태는 정의 모듈의 순서·import 순회·갱신 순서와
  무관하게 같은 바이트다. 객체의 삽입 순서를 저장 계약으로 삼지 않는다.
- **호스트가 검증한다.** 우리가 예전에 썼다는 사실이 그 JSON을 믿을 근거가 아니다 — 형식
  판·항목 모양·열쇠 문법·양의 정수 판·중복 열쇠·직렬화 가능성·유한한 수·한도.
- **모르는 항목은 보존된다.** 지금 소스가 정의하지 않는 열쇠는 그대로 남아 다음 내보내기에
  실린다. 제작자가 모듈 하나를 잠깐 뗐다가 다시 붙이는 일은 흔하고, 그 사이의 실행이
  플레이어의 진행을 지우면 안 된다. 지우는 것은 **명시적인 플레이 초기화** 하나다.
- **내보낸 스냅샷은 얼어 있다.** 호출부가 `snapshot.entries[0].value`를 고쳐 호스트의 상태를
  바꿀 수 없다.

한도(호스트 기본값):

```text
maxEntries                    128
maxEntrySerializedLength      64 KiB
maxSnapshotSerializedLength   1 MiB
```

운영 값이 아니다 — **한도가 있다는 사실**이 구조다.

## 7. 마이그레이션

**제작자 코드이고 QuickJS 안에서 돈다.** 호스트가 제작자의 TypeScript 형을 알 방법이
없으므로(런타임에 스키마가 없다) 이 변환은 제작자만 쓸 수 있고, 신뢰된 호스트에는 저장
스키마를 되짚는 반사가 없다.

- **하이드레이션마다 한 번**이지 렌더마다가 아니다. 성공한 마이그레이션의 결과가 곧 지금
  스냅샷이고, 그 스냅샷은 새 판을 달고 있어 다음 세션이 다시 옮기지 않는다.
- **결과를 검증한다.** 직렬화되지 않는 값·한도 초과는 `runtime_story_state_migration_invalid`.
- **던지면 세션이 서지 않는다**(`runtime_story_state_migration_failed`). 조용히 저장을 버리고
  `initial`로 떨어뜨리지 않는다 — 그러면 제작자의 마이그레이션 버그가 플레이어의 진행 삭제가
  된다.
- **옛 판인데 `migrate`가 없으면** 같은 실패다.
- **저장된 판이 더 높으면** `runtime_story_state_version_newer`다. 자동으로 낮추지도, 자동으로
  초기화하지도 않는다.
- **능력이 없다.** 마이그레이션은 첫 렌더보다 앞에서 도는 순수 변환이고, 호스트 생성·네트워크·
  이동·오디오에 닿는 공개 API가 이 런타임에 아직 없다.
- **예산과 메모리 안에 있다.** `for (;;) {}`는 세션의 실행 예산이 끊는다 — 호스트가 얼지 않는다.

## 8. 실패의 자리

부팅에서 나는 것과 도는 중에 나는 것이 갈린다.

```text
runtime_story_state_snapshot_invalid    부팅 — 호스트가 VM을 만들기 전에도 난다
runtime_story_state_version_newer       부팅 — 첫 렌더 없이 실패한다
runtime_story_state_migration_failed    부팅
runtime_story_state_migration_invalid   부팅
runtime_story_state_duplicate_key       부팅(모듈 평가)
runtime_story_state_definition_late     실행 — 그 렌더만 잃는다
runtime_story_state_hook_changed        실행 — 그 렌더만 잃는다
runtime_story_state_value_invalid       실행 — 그 이벤트만 잃는다
runtime_story_state_limit_exceeded      실행(한도)
```

부팅 실패는 **엔진 실패로 분류하지 않는다.** 호스트는 그것을
`runtime_story_state_bootstrap_failed`로 감싸고 원인을 `cause`에 둔다 — 대개
`CreatorExecutionError`이고 그 `runtimeCode`가 무엇이 잘못됐는지 말한다.

## 9. 스튜디오 미리보기

```text
다시 시작        VM을 새로 세운다 — useState는 처음부터, 저장 상태 **둘 다** 이어진다
플레이 초기화     플레이스루만 비우고 VM을 새로 세운다 — 긴 진행은 남는다
긴 진행 초기화    그 반대. **제작자·디버그 전용**이고 제품의 재생 표면에는 없다
```

**셋이 몰래 같아지지 않는다.** 판정은 순수 함수 하나가 갖고
(`runtimePreviewResetPlan`) 테스트가 그 차이를 값으로 잠근다 — 초기화가 스냅샷을 비우지
않거나 다시 시작이 비우는 변경은 화면에서 구분되지 않고, 그 대가는 응답이 마음에 들지 않아
다시 시작한 사람의 진행이다.

다시 시작의 순서:

```text
옛 VM  → 지금 스냅샷을 들고 있다(워커의 상태다)
       → unmountRoot · dispose
새 VM  → 같은 스냅샷으로 하이드레이션
       → 첫 렌더
```

**QuickJS 힙을 스냅샷으로 뜨지 않는다.** 건너는 것은 명시적인 저장 상태뿐이고, 훅 슬롯·
클로저·컴포넌트 인스턴스·약속·모듈 객체는 어느 것도 저장 형식이 아니다.

`State` 칸이 지금 스냅샷을 그린다. 신뢰된 스튜디오 UI이고 제작자의 포매팅 코드를 돌리지
않는다 — 값은 이미 두 번 검증된 JSON이라 `toString`·`toJSON`·`inspect`를 부를 일이 없고,
접는 일은 깊이·항목 수·길이에 상한이 있는 포매터 하나가 한다.

**저작 경로**가 이 화면의 값이다: 값을 만들고 → 소스의 판을 올리고 `migrate`를 적고 →
다시 시작하면, 첫 프레임이 이미 옮겨진 값이다.

### 미리보기의 수명 — 넓게 약속하지 않는다

이 진행은 **워커의 메모리**이고 스튜디오가 열려 있는 동안 산다. 브라우저 새로고침·스튜디오
닫기·다른 브라우저·다른 기기에는 남지 않고, 화면이 그 사실을 적는다. 미리보기의 메모리를
클라우드 저장이라고 부르지 않는다.

## 10. 이 엔진이 만들지 않는 것

```text
서버 저장 · 평문 REST 엔드포인트 · Postgres 테이블
발행된 작품의 재생 통합 · 저장 슬롯 UI
useNavigation · useAudio · useAsset · useNetwork
```

**런타임과 호스트는 저장 위치를 여전히 모른다.** Dexie·SQLite·동기화 레코드는 Phase 6B가
더했지만 그 셋은 `@rowcat/runtime-persistence`와 두 앱의 어댑터에 있고, 이 엔진이 아는
것은 `key`·`version`·`value` 셋뿐이다 — 그 무지 덕분에 같은 엔진이 스튜디오 미리보기·웹
재생·네이티브 재생·테스트에서 같은 뜻을 갖는다.

저장 위치의 규칙은 `docs/creator-runtime/persistence.md`가 갖는다.

## 11. 잠그는 자리

```text
packages/runtime/src/runtime.test.ts                 능력의 존재와 부재 · 정의 규칙
packages/runtime/src/internal/runtime-root.test.ts   루트의 커밋 규칙
packages/runtime-host/src/story-state.test.ts        TSX → 컴파일러 → QuickJS → 스냅샷(중심 불변식)
packages/runtime-host/src/persistent-state.test.ts   두 수명이 갈려 있다 · 초기화가 긴 진행에 닿지 않는다
packages/runtime-host/src/boundaries.test.ts         저장 매체·네트워크의 부재
packages/runtime-compiler/src/compile.test.ts        형 계약(넓힘 · 인터페이스 · 거절 · 내부 모듈)
apps/web/.../runtime-preview-boundaries.test.ts      미리보기가 아무 데도 쓰지 않는다
apps/web/.../runtime-preview-state.test.ts           다시 시작 ≠ 플레이 초기화
apps/web/.../runtime-preview-story-state.test.ts     포매터의 안정성과 상한
e2e/journeys/19-runtime-story-state.spec.ts          브라우저에서의 두 조작과 저작 경로
packages/runtime-compiler/src/compile.test.ts        두 수명의 정의를 서로의 훅에 넘길 수 없다
```
