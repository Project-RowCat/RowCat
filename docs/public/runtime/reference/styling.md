---
title: 스타일
description: color()와 스타일 형의 전체 목록.
group: reference
order: 6
symbols: color, isRuntimeColor, RuntimeColor, RuntimeStyle, RuntimeTextStyle, RuntimeLength, RuntimeAlign, RuntimeJustify, RuntimeTransition, RuntimeEasing, RUNTIME_EASINGS, RUNTIME_TRANSITION_DEFAULT_DURATION_MS, RUNTIME_TRANSITION_DEFAULT_EASING, RUNTIME_TRANSITION_MAX_DURATION_MS
---

# 스타일

개념은 [스타일](/docs/runtime/concepts/styling)에 있습니다.

## `color`

```ts
function color(value: "#rgb" | "#rrggbb" | "#rrggbbaa"): RuntimeColor;
```

글자 그대로 적은 16진수 색을 `RuntimeColor`로 만듭니다. 형식이 틀리면 **타입 검사에서** 막히고,
실행 중에는 `runtime_invalid_color`로 던집니다. 변수에 담긴 문자열은 이 함수에 넣을 수 없습니다 —
`isRuntimeColor`를 쓰세요.

```ts
const ink = color("#f5f7fa");
const glass = color("#ffffff22");
```

## `isRuntimeColor`

```ts
function isRuntimeColor(value: string): value is RuntimeColor;
```

문자열이 색 형식인지 판정합니다. 계산해서 만든 값을 스타일에 넣기 전에 씁니다.

## `RuntimeColor`

`color()`가 만든 값의 형. 문자열이지만 아무 문자열이나 대입할 수 없습니다.

## `RuntimeStyle`

상자(`View`·`Stack`·`Row`·`ScrollView`·`Pressable`·`Image`·`TextInput`·`TextArea`)의 스타일.

```ts
interface RuntimeStyle {
	width?: RuntimeLength;
	height?: RuntimeLength;
	minWidth?: RuntimeLength;
	maxWidth?: RuntimeLength;
	minHeight?: RuntimeLength;
	maxHeight?: RuntimeLength;
	padding?: number;
	gap?: number;
	opacity?: number; // 0~1
	backgroundColor?: RuntimeColor;
	borderRadius?: number;
	justify?: RuntimeJustify;
	align?: RuntimeAlign;
	grow?: number;
	shrink?: number; // 0 이상
	translateX?: number;
	translateY?: number;
	scale?: number; // 0 이상
}
```

없는 속성은 타입에서 막힙니다. `margin`·`position`·`zIndex`·`border`·방향(`flexDirection`)은
없습니다.

`maxWidth`는 *내용만큼 넓되 어느 선을 넘지 않는* 상자를 만들 때 씁니다 — 대화 말풍선이
그 모양입니다. `width`로 고정하면 짧은 한 마디도 그 너비를 다 차지합니다.

```tsx
<View style={{ maxWidth: "86%", padding: 12, borderRadius: 16 }}>
	<Text>네.</Text>
</View>
```

`grow`가 남는 공간을 나눠 갖는 비율이라면 `shrink`는 **모자란 공간을 양보하는** 비율입니다.
적지 않으면 부모가 정합니다 — 세로로 쌓는 상자(`View`·`Stack`·`ScrollView`)의 자식은
줄어들지 않고, `Row`의 자식은 줄어듭니다(그래야 긴 문장이 줄바꿈됩니다). 그 기본값을 덮고
싶을 때만 적습니다. 음수는 거절됩니다.

`translateX`·`translateY`·`scale`은 **그리는 자리만** 옮깁니다 — 이웃이 밀려나지 않고 배치가
다시 계산되지 않습니다. `scale`의 중심은 언제나 부품의 가운데입니다. 적지 않은 축의 값은
이동이 `0`, 배율이 `1`입니다.

## `RuntimeTextStyle`

`Text`의 `style`과 입력 부품의 `textStyle`.

```ts
interface RuntimeTextStyle {
	color?: RuntimeColor;
	fontSize?: number;
	fontWeight?: "regular" | "medium" | "bold";
	align?: "start" | "center" | "end";
	lines?: number;
	opacity?: number;
}
```

## `RuntimeTransition`

값이 바뀔 때 **어떻게 갈 것인가**. `transition` 프롭에 넣습니다.

```ts
interface RuntimeTransition {
	duration?: number; // 밀리초. 없으면 200, 최대 10000
	easing?: RuntimeEasing; // 없으면 "ease"
}
```

개념과 예제는 [스타일](/docs/runtime/concepts/styling#전이)에 있습니다.

`duration`이 `0`이면 전이가 없는 것과 같습니다. 음수·`NaN`·`Infinity`·10000 초과, 그리고
표에 없는 키(`delay` 등)는 `runtime_invalid_host_prop`으로 거절됩니다 — 조용히 무시하지
않습니다.

## `RuntimeEasing`

```ts
type RuntimeEasing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
```

다섯 개뿐입니다. `cubic-bezier(...)`·스프링·`steps(...)`는 없습니다.

## 전이 상수

| 이름 | 값 |
| --- | --- |
| `RUNTIME_EASINGS` | 위 다섯을 담은 배열 |
| `RUNTIME_TRANSITION_DEFAULT_DURATION_MS` | `200` |
| `RUNTIME_TRANSITION_DEFAULT_EASING` | `"ease"` |
| `RUNTIME_TRANSITION_MAX_DURATION_MS` | `10000` |

## `RuntimeLength`

```ts
type RuntimeLength = number | `${number}%`;
```

숫자는 밀도 독립 단위, 문자열은 부모에 대한 비율(`"50%"`). `"12px"`·`"1rem"`은 없습니다.

## `RuntimeJustify`

```ts
type RuntimeJustify = "start" | "center" | "end" | "between" | "around";
```

주축 정렬 — `Stack`이면 세로, `Row`면 가로.

## `RuntimeAlign`

```ts
type RuntimeAlign = "start" | "center" | "end" | "stretch";
```

교차축 정렬.
