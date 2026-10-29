# 크리에이터 런타임 — 패치 프로토콜 (Phase 4B)

> 상태: **내부 엔지니어링 계약.** 2026-09-03. Phase 5 렌더러의 **입력 계약**이다.
>
> 권위는 코드다 — 모양과 검증은 `packages/runtime-host/src/patches.ts`, 만드는 쪽은
> `packages/runtime/src/internal/reconciler.ts`. 이 문서는 그 둘이 함께 지키는 약속을 렌더러를
> 쓸 사람이 읽을 수 있게 적은 것이다. 둘이 갈리면 코드가 맞고 이 문서가 낡은 것이다.

## 1. 한 문장

VM 안의 리컨사일러가 **커밋 하나마다 패치 묶음 하나**를 내고, 렌더러는 그 묶음을 **앞을
내다보지 않고 한 줄씩** 적용해 호스트 중립 트리를 유지한다. 첫 렌더도 같은 프로토콜이다 —
빈 루트에서 시작하는 리비전 1의 묶음이고, 별도의 "초기 트리" 형식은 없다.

```text
제작자 TSX → 함수 컴포넌트 → 훅 → 런타임 원소 → 리컨사일러 → 호스트 중립 트리 → 증분 패치
             └──────────────── 전부 VM 안 ────────────────┘   └── 와이어(JSON) ──┘
```

## 2. 노드

```text
id      0은 합성 루트 컨테이너 — 렌더러 프리미티브가 아니고 create로 오지 않는다
        1부터 단조 증가. 세션 안에서 재사용하지 않는다(루트를 폐기하고 다시 마운트해도)
kind    screen · view · stack · row · scroll · text · image · button · pressable · progress   프리미티브
        #text                                                                            글자 노드
```

- **함수 컴포넌트는 노드가 아니다.** `App → Layout → Counter`가 `Stack → Text`로 내려온다.
  컴포넌트 인스턴스의 신원은 VM 안의 것이고 호스트 id 공간과 겹치지 않는다.
- **글자는 `#text` 노드다.** `<Text>Count: {n}</Text>`의 자식은 `#text` 하나이고 값은
  `"Count: 0"`이다 — 이웃한 글자·수 조각은 VM이 **하나로 합친다.** 렌더러가 조각을 이어
  붙일 일이 없다.
- **`null`·`undefined`·불리언은 노드를 만들지 않는다.** 배열과 Fragment는 자리에 펼쳐진다.

## 3. 조작

```text
create      { op, id, kind }                     노드가 생겼다 — 아직 아무 데도 붙어 있지 않다
set-prop    { op, id, name, value }              프롭 하나. 값의 어휘는 §4
remove-prop { op, id, name }                     프롭 하나를 지운다
set-text    { op, id, value }                    #text 노드의 글자
insert      { op, parent, child, index }         부모의 자식 목록 index 자리에 넣는다
move        { op, parent, child, index }         이미 자식인 노드를 빼서 index 자리에 넣는다
remove      { op, id }                           노드와 서브트리를 뗀다 — 자식마다 따로 오지 않는다
```

`index`는 **그 조작이 적용되는 시점의 목록** 기준이다. 렌더러는 목록을 그대로 고치면서 다음
조작을 읽으면 된다 — VM이 같은 목록을 흉내 내며 조작을 만들었다.

`children`은 프롭이 아니다. `set-prop`에 `children`이라는 이름은 오지 않고, 오면 검증이
거절한다.

## 4. 값

프롭 값은 JSON이 표현하는 것과 표식 둘이다.

```text
null · boolean · number(유한) · string · 배열 · 평범한 객체     그대로 (스타일 객체가 이 모양이다)
{ "$handler": n }     VM 안의 함수 — 렌더러는 그 번호로 dispatchEvent를 부른다
{ "$asset": value }   자산 참조 — 논리 경로이거나 원격 HTTPS 주소. 종류는 값에서 파생되고 와이어에 적지 않는다(`docs/creator-runtime/remote-assets.md`). 해석은 신뢰된 호스트가 한다
```

- 함수의 소스도, 자산의 바이트도, 제작자 객체(클래스 인스턴스·`Map`·원소)도 오지 않는다.
  VM 쪽 정규화가 거절하고(`runtime_invalid_host_prop`) 호스트 쪽 검증이 다시 거절한다.
- `undefined` 프롭은 **키가 없는 것**이다 — `remove-prop`으로 온다.
- 스타일 객체는 **값으로** 견준다. 렌더마다 새 객체가 만들어져도 같은 모양이면 `set-prop`이
  나가지 않는다. 핸들러만 **함수의 신원**으로 견준다.

## 5. 묶음과 리비전

```json
{ "revision": 2, "patches": [{ "op": "set-text", "id": 3, "value": "Count: 1" }] }
```

- `revision`은 1부터 **단조 증가**하고 빠지지 않는다. 벽시계가 아니다. 호스트는 기대한 다음
  번호가 아닌 묶음을 거절한다(`validatePatchBatch`의 `expectedRevision`).
- **패치가 없는 렌더는 묶음을 내지 않는다**(리비전도 오르지 않는다). 그래도 그 렌더는 성공한
  커밋이라 효과는 돈다 — `useEffect(fn)`(의존 없음)은 화면이 바뀌지 않아도 렌더마다 돈다.
- 루트 폐기(`unmountRoot`)는 최상위 노드 전부에 `remove`를 낸 묶음 하나로 끝난다. 렌더러의
  트리는 빈 루트로 돌아간다.

## 6. 순서의 불변식

렌더러가 기댈 수 있는 것:

1. **어떤 조작도 아직 만들어지지 않은 노드를 가리키지 않는다.** `create`가 그 노드의
   `set-prop`·`set-text`·`insert`보다 앞이다.
2. **서브트리는 부모에 삽입되기 전에 완성된다.** 새 노드의 자식들은 그 노드에 먼저 삽입되고,
   그다음 그 노드가 자기 부모에 삽입된다(안쪽에서 바깥으로).
3. **같은 부모 안에서 제거는 삽입·이동보다 앞이다.** 그래서 `index`가 제거 뒤의 목록을
   기준으로 한다.
4. **노드는 부모를 바꾸지 않는다.** 이동은 언제나 같은 부모 안이다 — 부모가 달라지면 그것은
   `remove` + `create`다.
5. **`remove`는 서브트리 전체를 뜻한다.** 자식의 `remove`가 따로 오지 않고, 그 서브트리의
   핸들러 번호는 VM이 놓는다.

## 7. 핸들러

```text
프롭에 함수가 오면            커밋이 등록부에서 번호를 얻는다 — 같은 함수(신원)는 같은 번호
프롭의 함수가 바뀌면          새 번호를 얻고 옛 번호를 놓는다
노드가 사라지면              그 노드의 번호를 전부 놓는다
호스트 → dispatchEvent(n)   userBlocking 작업으로 큐에 선다. 이 호출 스택에서 VM에 들어가지 않는다
놓인 번호의 이벤트           { handled: false, reason: "stale" } — 실패가 아니다
```

- 번호는 재사용하지 않는다(단조 증가). 낡은 이벤트가 **다른** 핸들러를 부를 수 없다.
- `useCallback`으로 신원을 지킨 콜백은 리렌더에서 번호가 그대로다. 렌더마다 새로 만든 화살표
  함수는 커밋마다 새 번호를 받는다(`set-prop`이 하나 더 나간다) — 이것은 결함이 아니라 신원의
  규칙이고, 번호가 새면 안 되는 자리는 `useCallback`이다.
- 페이로드: Phase 4B의 `onPress`는 인자 없이 불린다. 호스트가 `dispatchEvent(n, payload)`로
  와이어 값을 넘기면 첫 인자로 간다 — DOM 이벤트도 RN 이벤트도 아니다.

## 8. 원자성

```text
렌더가 던진다                 묶음이 나가지 않는다. 이전 커밋 트리가 그대로 권위다
호스트가 묶음을 거절한다       VM이 계획을 버린다. 트리·인스턴스·핸들러·리비전 어느 것도 바뀌지 않는다
첫 렌더가 던진다              커밋된 트리가 비어 있다. 렌더러는 아무것도 받지 않았다
```

VM 쪽 순서: 렌더(이전 트리를 읽기만 한다) → 계획(패치를 만들되 적용하지 않는다) → 호스트에
묻는다(동기) → 받았으면 적용(인스턴스 커밋 · 핸들러 해제 · 언마운트 · 효과 작업 등록). 그
사이의 부분 상태는 표현되지 않는다.

## 9. 한도

```text
maxTreeDepth          64        VM이 렌더 중에 센다 — runtime_tree_depth_exceeded
maxHostNodes          5,000     VM이 렌더 중에 세고 호스트가 묶음에서 다시 센다
maxPatchesPerCommit   50,000    VM이 계획 중에 세고 호스트가 다시 센다
maxCommitBytes        4 MiB     호스트만 안다 — 파싱하기 전에 문자열 길이로 본다
```

숫자는 운영 값이 아니다(`DEFAULT_ROOT_LIMITS`, `mountRoot`의 옵션으로 바꾼다). 한도는 **그
커밋**을 끝내지 세션을 끝내지 않는다 — 거절된 렌더 뒤에도 이전 트리가 남고 다음 이벤트가
다시 시도한다. 세션을 끝내는 것은 호스트의 예산·메모리·엔진 실패뿐이다.

### ⚠️ `maxHostNodes`는 수 하나로 셀 수 없다

`remove`는 **서브트리 하나를 뗀다**(§패치의 표). 그래서 호스트가 `create`에 +1, `remove`에
-1을 더하는 방식으로 살아 있는 수를 세면 그 값은 화면을 갈아 끼울 때마다 **위로만 흐른다.**

```text
화면 하나 교체   create 150 · remove 1   →  세는 값 +149, 실제 트리는 그대로
스물세 번쯤      실제 101개 · 세는 값 5,216   →  한도를 넘겨 이후 모든 커밋이 거절된다
```

그리고 그 상태는 **회복되지 않는다** — 세는 값이 내려갈 길이 없으므로 작품이 영구히 멈춘다.
짧은 시나리오에서는 재현되지 않아 한동안 조용히 서 있었다(플래그십이 여덟 주를 지나면서
드러났다).

그래서 호스트는 **부모–자식을 들고 자기 눈으로 센다**(`RuntimeHostNodeLedger`). 두 렌더러가
이미 하는 일이고, 여기서도 같은 이유로 필요하다 — 서브트리의 크기를 아는 쪽이 세야 한다.
두 대안은 모두 이 한도가 있는 이유를 지운다: VM이 지운 개수를 패치에 실어 보내면 호스트가
자기 한도를 **VM이 준 숫자로** 집행하게 되고, 노드마다 `remove`를 내면 화면 한 번 바꾸는 데
패치가 백 개가 된다. **장부는 받아들여진 묶음에만 움직인다** — 거절된 묶음이 장부를 움직이면
다음 계산이 이미 틀린 값 위에 선다.

## 10. 스케줄링과 배치

```text
mountRoot         normal          첫 렌더 + 첫 커밋
setState/dispatch → "render" 요청  VM이 한 번만 요청한다(플래그) → 호스트가 normal 작업으로 flushRender
커밋 뒤 효과      → "effects" 요청 → background 작업으로 flushEffects
dispatchEvent     userBlocking
unmountRoot       immediate
```

**배치 규칙**: 같은 스케줄러 실행 안의 갱신은 렌더 하나로 접힌다 — 이벤트 핸들러의 동기 구간과
그 실행의 작업 펌프가 돌리는 VM 마이크로태스크의 이어짐(`await Promise.resolve()`)까지. 다른
실행이 되는 것은 **호스트 능력 호출을 기다린 뒤**의 이어짐(완료 큐를 지나 다음 턴)과 효과 안의
갱신(다음 "render" 작업)이다.

효과는 커밋 **뒤** 다른 작업에서 돈다. 커밋 안에서 재귀하지 않는다. 효과 안의 `setState`는
다음 렌더·다음 커밋이고, 그 사슬이 끝나지 않으면(`useEffect(() => setN(n + 1))`) 호스트의
세션 예산이 끊는다 — 리컨사일러에 "50번 제한" 같은 임의의 수는 없다.

## 11. 진단

VM은 `diagnostic` 채널로 다음을 낸다. 코드는 `@rowcat/runtime`의 `RUNTIME_ERROR_CODE`이고
무게는 `RUNTIME_ERROR_KIND`가 정한다.

```text
runtime_duplicate_key            warning   같은 형제 목록의 중복 key — 뒤의 것은 자리로 판정한다
runtime_update_after_unmount     warning   사라진 컴포넌트의 setState — 무시된다
runtime_effect_returned_promise  warning   효과가 약속을 돌려줬다 — 정리로 읽지 않는다
runtime_effect_failed            creator   효과·정리가 던졌다 — 그 효과만 잃는다
```

렌더가 던진 것은 진단이 아니라 **실행의 실패**다(`mountRoot`의 결과 · `onRootError`).
`CreatorExecutionError`가 `runtimeCode`(`runtime_hook_order_changed` …)와
`componentStack`(`["App", "Panel", "Leaf"]`)을 함께 나른다.

## 12. 수명주기

```text
세션 생성              VM · 프렐류드 · 생성된 런타임 · 포트 설치 · 제작자 그래프
mountRoot              루트 하나. 다시 부르면 교체(리컨사일)
dispatchEvent / 렌더 / 효과
unmountRoot            정리 함수(정확히 한 번) → 등록부 비움 → remove 묶음
session.dispose        VM 파괴. 루트를 따로 정리하지 않는다 — 정리 함수를 원하면 먼저 unmountRoot
```

훅 상태는 세션의 것이다. 어디에도 저장되지 않고(`AuthoringStore`·SQLite·Dexie·서버 어느
것도) 세션이 새로 서면 처음부터다. VM 힙은 저장 형식이 아니다 — 저장 상태는 나중의 명시적
RowCat 상태 API의 것이다.

## 13. 소비자

`@rowcat/runtime-host/testing/host-tree`의 `TestHostTree`가 이 프로토콜의 **참조 소비자**다.
엄격하다 — 없는 노드·중복 id·재사용된 id·건너뛴 리비전·부모에 없는 이동에 던진다. 렌더러가
아니고, 제품 UI에 오지 않는다.

**첫 실제 렌더러는 `@rowcat/runtime-renderer-web`이다**(Phase 5A, `web-renderer.md`). 같은
규칙으로 묶음을 적용하되 노드 대신 DOM을 만들고, 합성 루트(0)는 섀도 루트 안의 컨테이너에
대응한다. 이 프로토콜은 그 렌더러를 세우면서 **한 글자도 바뀌지 않았다** — 렌더러가 요구한
불변식(§6)이 전부 이미 있었다. Phase 5B의 네이티브 렌더러도 같은 입력을 받는다.
