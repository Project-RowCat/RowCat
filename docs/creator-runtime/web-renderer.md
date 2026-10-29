# 크리에이터 런타임 — 웹 렌더러와 스튜디오 미리보기 (Phase 5A)

> 상태: **내부 엔지니어링 기록.** 2026-09-03. 첫 번째 눈에 보이는 런타임 출력이다.
>
> 권위는 코드다 — 렌더러는 `packages/runtime-renderer-web/src/*`, 미리보기는
> `apps/web/src/features/runtime-preview/*`. 이 문서는 그 둘이 함께 지키는 결정을 다음 렌더러
> (Phase 5B, React Native)를 만들 사람이 읽을 수 있게 적은 것이다 — **그 렌더러는 이제
> 있다**(`packages/runtime-renderer-native`, `native-vm-host.md` §11).

## 1. 한 문장

```text
제작자 TSX ─▶ 워커: 컴파일러 → 아티팩트 → QuickJS/WASM → 리컨사일러 → 패치 묶음
                                                                   │ postMessage(JSON)
메인 스레드: @rowcat/runtime-renderer-web ─▶ 섀도 DOM ◀─ 눌림 ─▶ 핸들러 번호 ─▶ 워커 ─▶ dispatchEvent
```

패치 프로토콜(`patch-protocol.md`)이 입력이고 DOM이 출력이다. 그 사이에 React가 없다.

## 2. 렌더러 — `@rowcat/runtime-renderer-web`

### 결정

| 결정 | 근거 |
| --- | --- |
| **명령형 DOM.** 묶음을 React 상태로 옮기지 않는다 | 리컨사일러는 VM 안의 하나다. 두 번째가 생기면 노드 신원·키 이동·핸들러 신원·원자적 커밋이 React의 판정 아래에서 한 번 더 결정된다 |
| **섀도 DOM.** 컨테이너에 `attachShadow`하고 그 안에 기본 시트 + 루트 | RowCat의 전역 CSS(preflight·계정 테마·컴포넌트 클래스)가 프리미티브에 닿지 않는다. 스타일 경계이지 **격리가 아니다** |
| **합성 루트(id 0)에 DOM 노드가 없다** | 섀도 루트 안의 `.rc-root` 컨테이너가 그 자리다. 최상위 노드는 거기 삽입된다 |
| **등록부는 `Map<id, record>` + `WeakMap<Node, record>`** | 패치마다 선택자로 DOM을 뒤지지 않는다. 역방향은 이벤트 위임이 쓴다 |
| **리비전은 엄격하다.** 1부터 차례로만 | 중복·건너뜀·되돌아감은 실패다. 되짚기(스냅샷) 프로토콜이 없어 추측으로 메우지 않는다 |
| **실패한 렌더러는 묶음도 이벤트도 받지 않는다** | 호스트와 화면이 같은 트리를 말하지 않는다. `reset()`이 빈 루트(리비전 0)로 되돌리고, 그것이 곧 새 세션이다 |
| **`move`는 `moveBefore`(있으면) 또는 `insertBefore` + 초점 복원** | `insertBefore`는 떼었다 붙이는 조작이라 브라우저가 초점을 거둔다. 키 재정렬마다 활성 버튼이 초점을 잃으면 키보드 사용자에게 그것은 매번 처음으로 돌아가는 일이다 |
| **프롭은 종류마다 표 하나, 이름마다 손 하나** | `setAttribute(name, value)`·`element[name] = value`가 없다. 표에 없는 프롭은 계약 오류이고 DOM에 가지 않는다 |
| **`{ "$asset": value }`는 해석기의 답만 `src`가 된다** | 값이 논리 경로든 원격 주소(`https://…`)든 그 문자열은 `src`에 앉지 않는다. 종류는 런타임과 같은 함수가 가르고(`classifyRuntimeAssetValue`) 호스트의 해석기가 원격 참조를 RowCat의 프록시 주소로 바꾼다 — 브라우저는 제작자의 호스트에 닿지 않는다. 해석기가 `null`이면(논리 참조 · 손상된 값) 자리표시자(`data-rc-missing`)이고, 불러오지 못한 그림도 `error`에서 같은 자리표시자로 접힌다(`docs/creator-runtime/remote-assets.md`) |
| **제작자 HTML 없음** | `innerHTML`·`outerHTML`·`insertAdjacentHTML`·`DOMParser`가 패키지에 없다(경계 검사). 글자는 `Text` 노드다 |

### DOM 대응

```text
screen      div.rc-screen     flex column · 100% × 100% · overflow hidden · background → background-color
view        div.rc-view       flex column
stack       div.rc-stack      flex column · gap
row         div.rc-row        flex row · gap
scroll      div.rc-scroll     flex column · overflow-y auto  /  horizontal → flex row · overflow-x auto
text        span.rc-text      display block · pre-wrap
image       img.rc-image      decoding async · loading lazy · referrerpolicy no-referrer · 없으면 data-rc-missing
button      button.rc-button  type=button · data-rc-tone
pressable   button.rc-pressable  type=button · 리셋(테두리·배경·패딩 0 · font/color inherit)
progress    progress.rc-progress  max=1 · value 0~1 · 없으면 끝을 모르는 진행
#text       Text
```

상자 프리미티브가 전부 `display: flex; flex-direction: column`인 것은 RN의 `View` 기본값과
같게 두려는 것이다 — `grow`·`justify`·`align`이 두 렌더러에서 같은 부모 안에서 같은 뜻이어야
한다. **네이티브 렌더러는 이 표를 그대로 옮긴다.**

### 스타일 대응

```text
RuntimeLength     number → px · "N%" → N%          그 밖의 단위 문자열은 계약 오류
padding · gap · borderRadius   number → px
opacity           0~1로 접는다
backgroundColor · color        #rgb · #rrggbb · #rrggbbaa 만 — isRuntimeColor를 다시 본다
justify           start/center/end/between/around → flex-start/center/flex-end/space-between/space-around
align             start/center/end/stretch → flex-start/center/flex-end/stretch
grow              → flex-grow
fontSize          → px         fontWeight  regular/medium/bold → 400/500/700
text.align        → text-align start/center/end
lines             → -webkit-line-clamp N (양의 정수만)
```

**`gap`의 우선순위 — 명시적 프롭이 `style.gap`을 이긴다.** `Stack`·`Row`는 둘 다 가질 수
있고, 브라우저의 대입 순서에 맡기지 않고 렌더러가 하나로 정한다(`styles.ts`의 `boxStyleCss`).
Phase 5B의 네이티브 렌더러는 **같은 규칙**을 쓴다.

### 이벤트

루트에 `click` 리스너 하나. 눌린 노드에서 위로 올라가며 첫 프레서블 레코드를 찾고, 비활성이면
아무것도 하지 않고, 핸들러 번호가 있으면 그 번호 하나를 `dispatchEvent`로 넘긴다. 핸들러
없는 프레서블은 투명하다(바깥이 받는다). DOM 이벤트 객체는 이 함수 밖으로 나가지 않는다 —
Phase 4B의 `onPress`는 인자 없이 불린다.

`<button type="button">`이라 키보드 활성화·초점·비활성 의미는 브라우저의 것이고,
`:focus-visible`이 기본 시트에 있다. `outline`을 전역으로 끄지 않는다.

### 테마 변수

```text
--rowcat-runtime-bg · -fg · -primary · -primary-fg · -secondary · -secondary-fg · -border · -muted · -font
```

앱이 미리보기 호스트 요소에 얹는 값이고(`runtime-preview-surface.tsx`가 RowCat 토큰을 옮겨
적는다) 제작자 코드가 읽거나 바꿀 방법이 없다. `@rowcat/ui-web`의 토큰 이름을 쓰지 않는 이유는
이 패키지가 그 패키지를 모르기 때문이다 — 재생 표면이 다른 껍데기 안에 설 때 같은 이름을
다른 값으로 채운다.

## 3. 미리보기 — `apps/web/src/features/runtime-preview`

### 워커

```text
start(gen, entry, files)   현재 세션 정리 → 전체 컴파일(portable 환경) → 세션 → mountRoot → started
event(gen, handlerId)      dispatchEvent — 실패는 root-error(회복 가능) 또는 failed(치명)
stop(gen)                  unmountRoot(정리 함수) → settle → dispose → stopped
```

- **워커는 응답성 경계다.** 격리는 워커 안의 QuickJS/WASM이다. 무한 루프는 VM의 실행 예산이
  끊고, 그동안 워커는 응답하지 않지만 메인은 살아 있다.
- **컴파일은 워커가 권위다.** 스튜디오의 검사 상태(Monaco 마커 + 분석 패스)는 버튼을 켜는
  이른 게이트이고, 워커가 `compileRuntimeProject`를 다시 돈다. 실패하면 VM을 만들지 않는다.
- **기본 라이브러리는 번들의 자산이다**(`runtime-preview-libs.ts`, Vite `?raw`). ES2022의 참조
  사슬 전부(`es5` … `es2022`, `decorators`)이고 DOM·Node·ESNext는 없다. 다이제스트는 순수
  SHA-256(`@rowcat/runtime-compiler/environment/portable`)이라 Node와 같은 `sourceHash`다.
- **요청은 직렬이다**(`start`·`stop` 사슬 하나). B의 시작이 A의 정리를 기다린다.
- **오류의 투영**(`PreviewErrorInfo`): 이름·문장·런타임 코드·컴포넌트 사슬. 호스트 경로·워커
  스택·엔진 내부는 실리지 않는다.

### 소스의 권위 — 편집기이지 저장소가 아니다

```text
편집기 모델(Monaco) ──┬──▶ 미리보기 스냅샷      즉시   runtime-source-snapshot.ts
                     └──▶ 자동 저장(500ms) ──▶ AuthoringStore ──▶ liveQuery
```

**미리보기가 돌리는 소스는 런타임 스튜디오의 편집기 상태이지 자동 저장된 `AuthoringStore`
레코드가 아니다.** 한동안 `useRuntimePreview`는 `liveQuery`가 주는 `DraftRuntimeFile[]`을
받았고, 그 목록은 자동 저장의 디바운스만큼 편집기보다 늦었다 — `Count: 0`을 `999`로 고치고
곧바로 `실행`을 누르면 워커는 `0`을 돌렸고, 500ms 뒤 저장이 도착하면 화면이 그것을
`변경사항 있음`으로 적었다. 제작자가 부탁한 것은 지금 보이는 코드다.

- **스냅샷 경계는 하나다** — `apps/web/src/features/runtime-studio/compile/source-snapshot.ts`의
  `currentRuntimeProjectSnapshot(레코드 목록, 진입 경로, 편집된 값 표)`. 경로는 지금 레코드에서,
  내용은 편집기가 들고 있는 값이 있으면 그것에서 온다(없으면 레코드). 열려 있지 않은 파일도
  같은 목록에 선다 — 프로젝트는 여러 파일이고 컴파일은 열린 탭만으로 되지 않는다.
- **편집된 값의 열쇠는 파일 id다.** 경로로 두면 이름 변경이 저장되지 않은 편집을 고아로
  만든다. 판정은 편집기 입력 칸들이 이미 쓰는 `reconcileEditedValue`이고(우리가 내보낸 값이
  되돌아올 때까지 레코드를 듣지 않는다), `useRuntimeSources`가 그것을 파일마다 붙인다.
- **미리보기는 자동 저장을 흘려보내지 않는다.** 저장 실패가 실행 실패가 되면 안 되고, 로컬
  쓰기의 지연이 실행의 지연이 되면 안 되며, 실행 한 번이 쓰기 한 번이 되면 안 된다. 편집기와
  자동 저장은 같은 편집의 **독립된 두 소비자**다. 미리보기는 여전히 아무것도 쓰지 않는다.
- **`run`은 스냅샷 하나를 잡는다.** 실행 신호(`runtimeCompileSignature`)와 워커에 보내는
  `{ path, content }` 목록이 같은 객체에서 나온다. 그 뒤의 타이핑은 새 스냅샷을 만들 뿐
  이미 나간 입력을 바꾸지 않는다 — 워커는 제작자가 누른 순간의 코드를 돌린다.
- **낡음은 같은 표현의 비교다.** 지금 스냅샷의 신호가 실행 스냅샷의 신호와 다르면 낡은 것이고,
  소스를 실행 시점의 값으로 되돌리면 낡음도 사라진다. 컴파일·시작 동안 편집했다면
  `started`가 그 순간의 신호를 함께 나르므로 세션은 **첫 프레임부터** 낡은 채 선다 —
  조용히 새 코드로 다시 시작하지 않는다.
- **분석 패스도 같은 스냅샷을 읽는다**(`useRuntimeCompile`). 자격을 판정하는 진단과 실제로
  도는 코드가 같은 판이다. Monaco의 마커는 처음부터 모델의 것이었다.
- **워커의 권위는 그대로다.** 스냅샷은 평범한 데이터이고(Monaco 모델·레코드 메타·콜백이
  건너지 않는다) 워커가 `compileRuntimeProject`를 다시 돈다.

### 세대

메인이 단조 증가하는 번호를 발급하고 워커는 모든 메시지에 되돌려 준다. 번호가 다른 메시지는
상태에도 렌더러에도 닿지 않는다 — 다시 시작 A · 편집 · 다시 시작 B에서 A의 늦은 커밋이 B의
화면에 도착하지 않는 이유가 그것이다.

### 상태 기계 (`runtime-preview-state.ts`)

```text
idle ─run→ compiling ─status→ starting ─started→ running ─stop→ stopping ─stopped→ idle
                                                   │ sourceChanged → running(stale)
                                                   │ rootError     → running(rootError) — 이전 DOM 그대로
                                                   │ committed     → rootError 지움
             어느 단계에서든 failed(gen) → failed ─run→ compiling
```

- **낡음은 사실이다.** 소스가 바뀌어도 VM은 그대로 돌고(Fast Refresh 없음), 화면은
  `변경사항 있음`을 적으며 `다시 시작`이 주 조작이 된다. 다시 시작은 새 세션이라 `useState`가
  처음부터이고, **새 편집기 스냅샷**을 잡는다(옛 워커 세션이 있다는 이유로 옛 스냅샷을
  다시 돌리지 않는다).
- **스스로 돌지 않는다.** 초안을 여는 일이 실행이 되지 않는다. 실행은 버튼이다.
- **자격이 없으면 버튼이 서지 않는다**(막는 오류가 있는 프로젝트).
- **제작자의 렌더 실패는 이전 화면 위에 선다.** VM이 새 커밋을 내지 않았으므로 지난 트리가
  화면이다. 렌더러·워커·VM의 치명적 실패는 화면을 멈추고 다시 시작을 요구한다 — 둘은 다른
  문장이다.
- **떠나면 멈춘다.** 언마운트에서 `stop`을 보내 정리 함수가 돌게 하고, 답이 없으면 워커를
  죽인다(3초).

### 콘솔

`console.log/warn/error`와 런타임 진단(`runtime_duplicate_key` …)이 바닥 패널의 `Console`
칸에 온다. 상한 500줄이고 앞을 버리며 버린 수를 적는다. Monaco의 컴파일 진단과 섞지 않는다.

## 4. 격리에 대한 문장

**제작자 JavaScript는 QuickJS/WASM 안에서만 돈다.** 워커는 응답성 경계, 섀도 DOM은 스타일
경계다. 경계를 건너는 것:

```text
메인 → 워커   소스 스냅샷(편집기 상태의 `{ path, content }`) · 핸들러 번호 · 세대 번호
워커 → 메인   패치 묶음(JSON) · console 인자(와이어 값) · 진단 · 오류 투영 · 상태
워커 → VM     아티팩트 · 핸들러 번호 · 와이어 값
VM → 워커     패치 묶음 · 작업 요청 · 진단 · console 인자
```

제작자 함수·객체·DOM 이벤트·URL은 어느 방향으로도 건너지 않는다. 정적 스캔 셋이 그것을 지킨다
(`runtime-renderer-web/src/boundaries.test.ts` · `runtime-preview/runtime-preview-boundaries.test.ts`
· `runtime-studio/runtime-boundaries.test.ts`).

## 5. 하지 않은 것

- **React Native 렌더러.** **Phase 5B가 만들었다**(`@rowcat/runtime-renderer-native`) —
  이 문서의 대응 표(§2)와 `gap` 우선순위(§3)를 그대로 쓰고, 갈리는 것은 글자 노드의 자리와
  `lines`의 표현뿐이다(RN의 제약이지 프로토콜의 축이 아니다). 네이티브 후속 셋 중 둘이
  닫혔고(WASM 자산 이동 · 안드로이드 `WebMessagePort` 다리) **실기기 32ms 게이트는 여전히
  열려 있다**(`native-vm-host.md` §11).
- **자산 호스트.** 논리 참조(`characters/…`)의 해석기는 여전히 `null`이다 — 업로드·DB·발행·CDN
  어느 것도 없다. **원격 HTTPS 이미지는 그 뒤에 열렸다**(`asset("https://…")`, RowCat의 프록시가
  대신 가져온다 — `docs/creator-runtime/remote-assets.md`). 그 슬라이스가 패치 프로토콜을 바꾸지
  않은 것도 이 표의 규칙 그대로다.
- **네트워크·이동·저장 상태.** VM에 `fetch`가 없고 `useNavigation`·`useStoryState`가 없다.
- **Fast Refresh.** 소스 교체가 훅 상태를 지키지 않는다.
- **기기 시뮬레이터.** 미리보기는 칸을 채우는 반응형 뷰포트 하나다.
- **패치 프로토콜 변경.** 한 글자도 바뀌지 않았다 — 렌더러가 요구한 불변식이 전부 이미 있었다.
