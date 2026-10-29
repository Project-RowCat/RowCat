---
title: 훅
description: 컴포넌트 안에서 부르는 열한 훅의 시그니처와 규칙.
group: reference
order: 3
symbols: useState, useReducer, useMemo, useCallback, useRef, useEffect, useStoryState, usePersistentState, useGeneration, useScrollController, useTextEntryController
---

# 훅

훅은 컴포넌트의 최상단에서 매번 같은 순서로 부릅니다([규칙](/docs/runtime/concepts/components#훅의-규칙)).
렌더 밖에서 부르면 `runtime_hook_outside_render`입니다.

## `useState`

```ts
function useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>];
```

컴포넌트가 기억하는 값. 이 실행 동안만 살고 다시 시작하면 처음부터입니다. 초기값으로 함수를
주면 첫 렌더에서만 돕니다.

```tsx
const [open, setOpen] = useState(false);
setOpen((current) => !current);
```

## `useReducer`

```ts
function useReducer<S, A>(
	reducer: (state: S, action: A) => S,
	initial: S,
): [S, (action: A) => void];
```

전이 함수가 상태를 소유합니다. 값이 여러 갈래로 바뀌는 화면에 씁니다. 초기값 함수·세 번째
인자는 없습니다.

## `useMemo`

```ts
function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
```

`deps`가 그대로면 같은 값. 계산을 건너뛴다는 **보장이 아니라 힌트**입니다.

## `useCallback`

```ts
function useCallback<T extends (...args: never[]) => unknown>(
	callback: T,
	deps?: readonly unknown[],
): T;
```

`deps`가 그대로면 같은 함수.

## `useRef`

```ts
function useRef<T>(initial: T): RuntimeRef<T>;
```

렌더 사이에 살아남는 칸 하나(`{ current: T }`). 값을 바꿔도 다시 그리지 않습니다 — 화면에
보이는 값을 여기 두면 화면이 낡습니다. **부품을 가리키는 ref는 없습니다.** 이 값은 순수한
저장 칸입니다.

## `useEffect`

```ts
function useEffect(effect: () => void | RuntimeCleanup, deps?: readonly unknown[]): void;
```

렌더가 끝나고 화면이 그려진 뒤에 돕니다. 반환값은 정리 함수입니다.

- `deps`를 **생략하면 매 렌더마다** 돕니다. 빈 배열은 한 번만입니다. 둘은 다른 뜻입니다.
- 프로미스를 돌려주면(`async` 효과) 경고이고 정리 함수로 읽지 않습니다.
- 효과가 던지면 그 효과만 잃고(`runtime_effect_failed`) 런타임은 계속 돕니다.
- 효과 안에서 `generate()`를 부를 수 없습니다 — 생성은 [플레이어의 조작에서만](/docs/runtime/concepts/generation#플레이어의-조작에서만-시작합니다)
  시작합니다.
- 효과 안의 상태 갱신이 매 커밋마다 다음 렌더를 만드는 사슬은 런타임이 세지 않습니다. 그
  사슬은 세션의 실행 예산이 끊습니다 — 조건 없는 `setState`를 효과에 두지 마세요.

타이머(`setTimeout`·`setInterval`)는 없습니다. 효과로 시간을 재는 방법이 없습니다.

## `useStoryState`

```ts
function useStoryState<T>(definition: StoryStateDefinition<T>): [T, RuntimeSetState<T>];
```

`defineStoryState`로 만든 정의를 읽고 씁니다. 같은 정의를 읽는 모든 컴포넌트가 같은 값을
봅니다. 마운트된 동안 같은 자리에 다른 정의를 넘기면 `runtime_story_state_hook_changed`입니다.
[상태](/docs/runtime/concepts/state#플레이스루의-상태-definestorystate-usestorystate)

## `usePersistentState`

```ts
function usePersistentState<T>(definition: PersistentStateDefinition<T>): [T, RuntimeSetState<T>];
```

`definePersistentState`로 만든 정의를 읽고 씁니다. `defineStoryState`의 정의는 타입에서
막힙니다. [상태](/docs/runtime/concepts/state#회차를-넘는-상태-definepersistentstate-usepersistentstate)

## `useGeneration`

```ts
function useGeneration(): RuntimeGeneration;
```

AI 생성 능력을 돌려줍니다. 돌려주는 객체는 마운트된 동안 같은 객체입니다. `generate()`는
이벤트 핸들러에서만 부릅니다. [AI 생성](/docs/runtime/concepts/generation)

## `useScrollController`

```ts
function useScrollController(): RuntimeScrollController;
```

`ScrollView` 하나를 옮길 손잡이를 돌려줍니다. `controller` 프롭으로 붙이고, 이벤트 핸들러나
효과에서 부릅니다.

```tsx
const scroll = useScrollController();

<ScrollView controller={scroll}>{rows}</ScrollView>
<Button onPress={() => scroll.scrollToEnd()}>최신</Button>
```

돌려주는 객체는 마운트된 동안 같은 객체입니다. [스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)

## `useTextEntryController`

```ts
function useTextEntryController(): RuntimeTextEntryController;
```

`TextInput`·`TextArea` 하나의 초점을 옮길 손잡이를 돌려줍니다.

```tsx
const reply = useTextEntryController();

<TextInput controller={reply} value={draft} onChangeText={setDraft} />
<Button onPress={() => reply.focus()}>답장</Button>
```

[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)

## 설정 함수의 모양

세 상태 훅의 설정 함수는 `RuntimeSetState<S>`입니다.

```ts
type RuntimeSetState<S> = (action: S | ((previous: S) => S)) => void;
```

새 값이나, 이전 값을 받아 새 값을 돌려주는 함수를 줍니다. 같은 값(`Object.is`)이면 다시 그리지
않습니다.
