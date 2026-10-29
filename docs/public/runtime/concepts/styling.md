---
title: 스타일
description: 런타임 스타일은 CSS도 React Native 스타일시트도 아닌 자기 체계입니다. 쓸 수 있는 속성, 색을 적는 방법, 값이 바뀔 때의 전이.
group: concepts
order: 2
---

# 스타일

런타임의 스타일은 **자기 체계**입니다. CSS 문자열도, 클래스 이름도, React Native의
`StyleSheet`도 아닙니다. 같은 코드가 웹과 앱에서 같은 모양으로 그려져야 하기 때문에, 두 플랫폼
모두에서 똑같이 표현할 수 있는 속성만 열려 있습니다.

```tsx
<Stack
	gap={12}
	style={{
		padding: 16,
		backgroundColor: color("#111827"),
		borderRadius: 12,
	}}
>
```

## 상자의 스타일

`View`·`Stack`·`Row`·`ScrollView`·`Pressable`·`Image`·`TextInput`·`TextArea`가 받는 `style`은
`RuntimeStyle`입니다.

| 속성 | 값 | 뜻 |
| --- | --- | --- |
| `width` · `height` | 숫자 또는 `"50%"` | 크기. 숫자는 밀도 독립 단위입니다 |
| `padding` | 숫자 | 안쪽 여백. 네 방향이 같습니다 |
| `gap` | 숫자 | 자식 사이의 간격 |
| `opacity` | 0~1 | 투명도 |
| `backgroundColor` | `color(…)` | 바탕색 |
| `borderRadius` | 숫자 | 모서리 둥글기 |
| `justify` | `"start"` · `"center"` · `"end"` · `"between"` · `"around"` | 주축 정렬 |
| `align` | `"start"` · `"center"` · `"end"` · `"stretch"` | 교차축 정렬 |
| `grow` | 숫자 | 남는 공간을 나눠 갖는 비율 |

**여기 없는 속성은 없는 것입니다.** `margin`·`position`·`zIndex`·`border`·`flexDirection`·
`display`는 받지 않고, 적으면 검사에서 막힙니다. 방향은 속성이 아니라 부품이 정합니다 — 세로는
`Stack`, 가로는 `Row`입니다.

`Stack`과 `Row`의 `gap`은 프롭으로도 줄 수 있습니다(`<Stack gap={8}>`). 프롭과 `style.gap`을
둘 다 주면 **프롭이 이깁니다.**

## 글자의 스타일

`Text`가 받는 `style`은 `RuntimeTextStyle`이고, 상자의 스타일과 **다른 목록**입니다. 글자에는
`gap`도 `justify`도 없습니다.

| 속성 | 값 |
| --- | --- |
| `color` | `color(…)` |
| `fontSize` | 숫자 |
| `fontWeight` | `"regular"` · `"medium"` · `"bold"` |
| `align` | `"start"` · `"center"` · `"end"` |
| `lines` | 숫자 — 몇 줄에서 자를 것인가. 없으면 자르지 않습니다 |
| `opacity` | 0~1 |

`TextInput`·`TextArea`의 글자 모양은 `textStyle`로 따로 줍니다.

## 색

색은 문자열이 아니라 **`color()`가 만든 값**입니다.

```tsx
import { color } from "@rowcat/runtime";

const ink = color("#f5f7fa");
const faint = color("#8b93a7cc"); // #rrggbbaa
```

받는 형식은 `#rgb`·`#rrggbb`·`#rrggbbaa` 셋뿐입니다. `"red"`·`rgb(…)`·`hsl(…)`은 없습니다.
글자 그대로 적은 값은 타입 검사에서 잘못된 형식을 잡고, 실행 중에는 한 번 더 확인합니다.

계산해서 만든 문자열은 `color()`에 넣을 수 없습니다(타입이 막습니다). 그런 값은 `isRuntimeColor`로
먼저 확인합니다.

```tsx
import { isRuntimeColor } from "@rowcat/runtime";

function tint(hex: string) {
	return isRuntimeColor(hex) ? hex : color("#000000");
}
```

## 화면의 바탕

`Screen`의 `background`는 화면 전체(안전 영역 바깥까지)의 바탕색입니다. 다른 부품의
`backgroundColor`와 달리 `style` 밖의 프롭입니다.

```tsx
<Screen background={color("#0b0d12")}>
```

## 전이

상태가 바뀌어 `opacity`·`translateX`·`translateY`·`scale`이 달라질 때, 그 값까지 **부드럽게
가도록** 할 수 있습니다. `transition` 프롭 하나면 됩니다.

```tsx
import { Text, View, useState } from "@rowcat/runtime";

export default function App() {
	const [open, setOpen] = useState(false);

	return (
		<View
			transition={{ duration: 180, easing: "ease-out" }}
			style={{
				opacity: open ? 1 : 0,
				translateY: open ? 0 : 8,
				scale: open ? 1 : 0.98,
			}}
		>
			<Text>안녕하세요</Text>
		</View>
	);
}
```

적는 것은 **바라는 값**뿐입니다. 중간 값도, 프레임도, 시작과 끝을 알리는 콜백도 작품 코드에
오지 않습니다 — 상태를 바꾸면 화면이 거기까지 갑니다.

### 움직이는 축은 넷입니다

`opacity` · `translateX` · `translateY` · `scale`.

`width`·`padding`·`backgroundColor`는 전이하지 않습니다(값은 즉시 바뀝니다). 그 축들은 배치를
다시 계산하게 만들고, 배치의 중간 값은 웹과 앱이 서로 다른 시점에 재기 때문입니다.

### 처음 그려질 때는 움직이지 않습니다

`transition`을 적었다고 **등장 애니메이션**이 되지 않습니다.

```tsx
<View transition={{ duration: 200 }} style={{ opacity: 1 }} />
```

이 부품은 나타나는 순간부터 `opacity: 1`입니다. 움직이는 것은 **이미 그려진 부품의 값이
바뀔 때**뿐입니다.

### 사라지는 것은 즉시입니다

```tsx
{open && <View transition={{ duration: 200 }}>…</View>}
```

`open`이 거짓이 되면 이 부품은 **그 자리에서 사라집니다.** `transition`은 트리에서 빠지는
부품을 붙잡아 두지 않습니다. 사라지는 모습을 만들고 싶다면 부품을 남겨 둔 채 `opacity`를
`0`으로 두세요.

### 되돌리면 지금 있는 자리에서 되돌아갑니다

전이가 끝나기 전에 목표가 다시 바뀌면, 화면은 **지금 그려지고 있는 값**에서 새 목표로
갑니다. 끝까지 갔다가 되돌아오지 않습니다.

### 움직임 줄이기

RowCat은 보는 사람의 **움직임 줄이기** 설정을 자동으로 따릅니다. 그 설정이 켜져 있으면
전이는 즉시 적용됩니다 — 값은 똑같이 바뀌고 가는 과정만 없습니다.

작품 코드는 그 설정을 읽을 수 없습니다(`useReducedMotion()` 같은 이름이 없습니다). 접근성
설정이 작품의 진행을 바꾸는 일은 없어야 하기 때문입니다.

### 전이에 없는 것

- **`delay`·키프레임·반복·시퀀스.**
- **스프링**(`stiffness`·`damping`)·`cubic-bezier(...)`. 이징은 다섯 개뿐입니다.
- **완료 콜백**(`onTransitionEnd`). 전이는 화면의 일이지 진행의 일이 아닙니다 — 완료를
  기다려 다음 상태로 넘어가는 코드는 움직임 줄이기가 켜진 기기에서 다르게 돕니다.
- **진입·퇴장 애니메이션**(`Presence`). 위의 두 규칙이 그것입니다.
- **회전·기울이기**(`rotate`·`skew`), 레이아웃 애니메이션, 제스처·스크롤에 연동된 움직임.

## 없는 것

- **CSS 문자열·클래스 이름·선택자.** 웹에서만 뜻이 있습니다.
- **단위 문자열**(`"12px"`·`"1rem"`). 숫자 하나가 밀도 독립 단위이고, 그 해석은 플랫폼의
  몫입니다.
- **`position: "fixed"`·`zIndex`.** 떠 있는 층은 런타임이 나중에 제공할 부품이지 좌표로 만들
  것이 아닙니다.
- **테마 변수.** 런타임 코드는 RowCat의 테마 색을 읽을 수 없습니다. 작품의 색은 작품이 정합니다.
- **글꼴 선택·자간·행간.** 지금 열려 있는 글자 축은 위 표가 전부입니다.

전체 목록은 [스타일 레퍼런스](/docs/runtime/reference/styling)에 있습니다.
