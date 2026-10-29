---
title: 타입
description: 값이 아니라 형만 내보내는 이름들. 프롭·훅·노드·상태 정의의 형.
group: reference
order: 9
symbols: RuntimeTransitionable, AudioProps, ButtonProps, ImageProps, PressableProps, ProgressProps, RowProps, ScreenProps, ScrollViewProps, StackProps, TextAreaProps, TextInputProps, TextProps, ViewProps, RuntimePressable, RuntimeTextEntry, RuntimeScrollController, RuntimeScrollTo, RuntimeTextEntryController, RuntimeCleanup, RuntimeRef, RuntimeSetState, RuntimeStateAction, RuntimeApp, RuntimeChildren, RuntimeComponent, RuntimeElement, RuntimeNode, RuntimePrimitive, StoryStateDefinition, StoryStateInput, StoryStateInputChecked, StoryStateMigration, PersistentStateDefinition, PersistentStateInput, PersistentStateInputChecked, PersistentStateMigration, Serializable, SerializableShape
---

# 타입

여기 있는 이름은 전부 **형**입니다. `import type { … } from "@rowcat/runtime"`으로 가져오고
실행 중에는 존재하지 않습니다. 자기 컴포넌트의 프롭을 적거나 상태의 형을 이름 붙일 때 씁니다.

## 부품의 프롭

| 이름 | 부품 |
| --- | --- |
| `ScreenProps` | `Screen` |
| `ViewProps` | `View` |
| `StackProps` | `Stack` |
| `RowProps` | `Row` |
| `ScrollViewProps` | `ScrollView` |
| `TextProps` | `Text` |
| `ImageProps` | `Image` |
| `ButtonProps` | `Button` |
| `PressableProps` | `Pressable` |
| `TextInputProps` | `TextInput` |
| `TextAreaProps` | `TextArea` |
| `ProgressProps` | `Progress` |
| `AudioProps` | `Audio` |

## `RuntimeTransitionable`

```ts
interface RuntimeTransitionable {
	transition?: RuntimeTransition;
}
```

`transition` 프롭을 받는 부품들의 공통 형. `ViewProps`·`StackProps`·`RowProps`·
`ScrollViewProps`·`ImageProps`·`PressableProps`·`RuntimeTextEntry`가 이것을 포함합니다 —
`style`이 `RuntimeStyle`인 부품 전부입니다.

`ScreenProps`·`TextProps`·`ButtonProps`·`ProgressProps`에는 **없습니다.** 그 넷은 상자
스타일을 받지 않으므로 움직일 축이 없습니다. 글자를 움직이려면 `View`로 감싸세요.

둘은 여러 부품이 공유하는 축입니다.

- `RuntimePressable` — `onPress`·`disabled`. `Button`과 `Pressable`이 확장합니다.
- `RuntimeTextEntry` — `value`·`placeholder`·`disabled`·`onChangeText`·`style`·`textStyle`·
  `controller`. `TextInput`과 `TextArea`가 확장합니다.

```tsx
import type { ButtonProps } from "@rowcat/runtime";

function DangerButton(props: Omit<ButtonProps, "tone">) {
	return <Button {...props} tone="ghost" />;
}
```

## 조종기

| 이름 | 형 |
| --- | --- |
| `RuntimeScrollController` | `scrollToStart()`·`scrollToEnd()`·`scrollTo({ offset })` |
| `RuntimeTextEntryController` | `focus()`·`blur()` |
| `RuntimeScrollTo` | `{ offset: number }` — `scrollTo()`가 받는 것 |

조종기는 `useScrollController()`·`useTextEntryController()`가 만듭니다. **DOM 요소도 네이티브
참조도 아니고**, `current`도 크기도 좌표도 없습니다 — 여는 것은 위의 메서드뿐입니다.
[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)

## 훅

| 이름 | 형 |
| --- | --- |
| `RuntimeSetState<S>` | `(action: RuntimeStateAction<S>) => void` — 설정 함수 |
| `RuntimeStateAction<S>` | `S \| ((previous: S) => S)` — 설정 함수가 받는 것 |
| `RuntimeRef<T>` | `{ current: T }` — `useRef`가 돌려주는 칸 |
| `RuntimeCleanup` | `() => void` — 효과의 정리 함수 |

## 노드와 컴포넌트

| 이름 | 뜻 |
| --- | --- |
| `RuntimeNode` | 컴포넌트가 돌려줄 수 있는 모든 것 — 원소·문자열·숫자·불리언·`null`·`undefined`·그것들의 배열 |
| `RuntimePrimitive` | 그중 원소가 아닌 것(`string \| number \| boolean \| null \| undefined`) |
| `RuntimeElement` | TSX 태그 하나가 만드는 값 |
| `RuntimeChildren` | `{ children?: RuntimeNode }` — 자식을 받는 프롭 형이 확장합니다 |
| `RuntimeComponent<TProps>` | `(props: TProps) => RuntimeNode` — 컴포넌트 함수의 형 |
| `RuntimeApp` | 프롭 없는 컴포넌트 — 진입 파일의 기본 내보내기가 이 형이어야 합니다 |

```tsx
import type { RuntimeChildren, RuntimeNode } from "@rowcat/runtime";

function Card({ title, children }: { title: string } & RuntimeChildren): RuntimeNode {
	return (
		<Stack gap={4}>
			<Text style={{ fontWeight: "bold" }}>{title}</Text>
			{children}
		</Stack>
	);
}
```

## 상태 정의

| 이름 | 뜻 |
| --- | --- |
| `StoryStateDefinition<T>` | `defineStoryState`가 돌려주는 정의 |
| `StoryStateInput<T>` | 그 함수가 받는 입력(`key`·`version`·`initial`·`migrate?`) |
| `StoryStateInputChecked<T>` | 입력에 직렬화 검사를 얹은 형 — 실제 매개변수 형입니다 |
| `StoryStateMigration<T>` | `(stored: Serializable, fromVersion: number) => T` |
| `PersistentStateDefinition<T>` | `definePersistentState`가 돌려주는 정의 |
| `PersistentStateInput<T>` | 그 입력 |
| `PersistentStateInputChecked<T>` | 검사를 얹은 입력 |
| `PersistentStateMigration<T>` | 영구 상태의 마이그레이션 함수 형 |

## 직렬화

| 이름 | 뜻 |
| --- | --- |
| `Serializable` | 저장할 수 있는 값 — `null`·불리언·숫자·문자열·그 배열·그 객체 |
| `SerializableShape<T>` | `T`를 직렬화 가능한 모양으로 다시 그린 형. 함수·`Date`가 섞이면 그 자리가 `never`가 됩니다 |

`Serializable`은 `migrate`의 첫 인자 형입니다. 옛 판의 값이 어떤 모양인지는 당신이 알고 있으므로
그 안에서 좁혀 씁니다.
