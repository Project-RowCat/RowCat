---
title: 지원하지 않는 API
description: 흔히 있을 것으로 기대하지만 런타임에 없는 것들과, 대신 무엇을 쓰는가.
group: runtime-model
order: 3
---

# 지원하지 않는 API

웹이나 React Native에서 익숙한 것 중 런타임에 **없는 것**을 모았습니다. 대안이 있으면 함께
적고, 없으면 없다고 적습니다.

## 할 수 없는 것

```text
npm 패키지 설치
React · React 라이브러리
HTML 태그 · DOM 조작
fetch · WebSocket · 외부 API 호출 (이미지는 예외 — asset("https://…"))
파일 읽기·쓰기
localStorage · IndexedDB · 쿠키
setTimeout · setInterval · 애니메이션 프레임 (전이는 style + transition으로 적는다)
진동 · 카메라 · 위치
클립보드 · 공유 · 알림
링크 열기 · 다른 화면으로 이동
Web Audio(AudioContext) · <audio> · 플랫폼 재생 객체
DOM 요소 · React Native 참조 · 부품을 가리키는 ref
```

## 대신 쓰는 것

| 하고 싶은 일 | 쓰는 것 |
| --- | --- |
| 그림 | [`asset("https://…")`](/docs/runtime/concepts/assets) — HTTPS 주소의 이미지를 `Image`로 그립니다 |
| 소리 | [`Audio`](/docs/runtime/reference/components#audio) — RowCat에 올린 소리를 `asset("audio/…")`로 울립니다 |
| 목록을 최신으로 내리기 | [`useScrollController`](/docs/runtime/concepts/scroll-and-focus) — `scrollToStart`·`scrollToEnd`·`scrollTo({ offset })` |
| 입력 칸에 초점 주기 | [`useTextEntryController`](/docs/runtime/concepts/scroll-and-focus) — `focus`·`blur` |
| 진행 저장 | [`useStoryState`](/docs/runtime/concepts/state) — 플레이어의 계정에 저장되어 기기 사이를 건넙니다 |
| 회차를 넘는 기록 | [`usePersistentState`](/docs/runtime/concepts/state#회차를-넘는-상태-definepersistentstate-usepersistentstate) |
| 인물의 답·서술 | [`useGeneration`](/docs/runtime/concepts/generation) |
| 화면 | [`@rowcat/runtime`의 부품](/docs/runtime/reference/components) |
| 색 | [`color()`](/docs/runtime/concepts/styling#색) |
| 값이 바뀔 때 부드럽게 | [`transition`](/docs/runtime/concepts/styling#전이) — `opacity`·`translateX`·`translateY`·`scale` |
| 디버그 출력 | `console.log` — 미리보기의 콘솔에 옵니다 |

### 소리의 경계

소리는 **되는 것과 안 되는 것이 갈립니다.** 되는 쪽은 하나입니다.

```text
된다      <Audio source={asset("audio/bgm/main")} playing />
          RowCat에 올려 스튜디오에서 이름을 붙인 소리

안 된다   AudioContext · new Audio() · <audio> 태그 · 플랫폼의 재생 객체
          임의의 오디오 API · 직접 만드는 소리
          원격 HTTPS 주소의 소리(그림과 갈리는 지점입니다 — 재생은 흐르는 대화라
          프록시 하나로 접히지 않습니다)
```

재생·정지·반복·크기·되감기는 전부 `Audio`의 **프롭**입니다. 소리를 명령형으로 조작하는
손잡이(`play()`·`pause()`)는 없습니다. 자세한 것은 [자산](/docs/runtime/concepts/assets)에
있습니다.

### 부품을 가리키는 ref의 경계

`useRef`는 렌더 사이에 값을 담는 칸이고 **부품을 가리키지 않습니다.** 화면에 한 번 시키는
일(스크롤·초점)은 조종기로 합니다.

```text
된다      const scroll = useScrollController();
          <ScrollView controller={scroll}>…</ScrollView>
          scroll.scrollToEnd()

안 된다   ref.current.focus() · findNodeHandle · querySelector
          크기·좌표·부모·자식을 읽는 일
```

[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)이 규칙 전부를 적습니다.

## 대안이 없는 것

- **시간의 흐름.** 타이머가 없어 "3초 뒤에"를 만들 수 없습니다. 진행은 플레이어의 조작으로
  넘깁니다. `Date.now()`는 값을 주지만 기기마다 다른 값이라 진행의 근거로 쓰면 안 됩니다.
- **프레임 단위의 애니메이션.** 프레임을 직접 그리는 방법(`requestAnimationFrame`·타이머·
  명령형 애니메이션 객체)은 없습니다. **다만 상태가 바뀔 때의 전이는 있습니다** — `transition`
  프롭과 `opacity`·`translateX`·`translateY`·`scale`로 적습니다([스타일](/docs/runtime/concepts/styling#전이)).
  키프레임·반복·스프링·진입과 퇴장 애니메이션은 없고, 스크롤도 즉시 옮깁니다(부드러운
  스크롤이 없습니다).
- **화면 밖으로 나가기.** 링크·공유·다른 작품으로의 이동은 없습니다. 런타임은 자기 화면 하나를
  갖습니다.
- **플레이어의 신원.** 이름·아이디·아바타를 읽을 방법이 없습니다. 플레이어의 이름이 필요하면
  작품 안에서 물어 저장 상태에 둡니다.
- **뷰포트 크기.** 화면의 폭·높이를 읽는 API가 없습니다. 비율(`"100%"`)과 `grow`로 배치합니다.
  스크롤 위치를 **읽는** 방법도 없습니다 — 조종기는 옮기기만 합니다.
- **랜덤의 재현.** `Math.random()`은 있지만 저장되지 않습니다. 재현되어야 하는 무작위(같은 시드의
  같은 결과)는 시드를 저장 상태에 두고 직접 만듭니다.

## 있는 것처럼 보이지만 없는 것

| 이름 | 사실 |
| --- | --- |
| `useContext` · `createContext` | 없습니다. 같은 값을 여러 컴포넌트가 봐야 하면 `defineStoryState`의 정의를 가져다 쓰거나 프롭으로 넘깁니다 |
| `useLayoutEffect` · `useId` · `useTransition` | 없습니다 |
| `memo` · `forwardRef` · `lazy` · `Suspense` | 없습니다 |
| `useRef`에 담은 부품 · `ref` 프롭 | 없습니다. 스크롤과 초점은 [조종기](/docs/runtime/concepts/scroll-and-focus)로 합니다 |
| `<Fragment>` · `<></>` | 없습니다. 여러 노드는 **배열**로 돌려줍니다(각 항목에 `key`) |
| `className` · `style` 문자열 | 없습니다. `style`은 [정해진 속성의 객체](/docs/runtime/concepts/styling)입니다 |
| `onClick` · `onChange` · `onKeyDown` | 없습니다. `onPress`·`onChangeText`·`onSubmit`입니다 |
| `defaultValue` | 없습니다. 입력은 통제된 입력이라 `value`가 필수입니다 |
| `TextInput`의 `multiline` | 없습니다. 여러 줄은 `TextArea`입니다 |
| `Image`의 `src` · `uri` | 없습니다. `source={asset("https://…")}`입니다 — 문자열을 그대로 넣을 수 없습니다 |
| 실행 중에 만든 원격 이미지 주소 | 없습니다. 외부 주소는 소스에 고정되어야 하고, 조립한 주소는 자리표시자입니다. **RowCat 이미지의 이름은 실행 중에 만들어도 됩니다** |
