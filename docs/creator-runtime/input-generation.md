# 입력과 생성 — 플레이어가 치고, 신뢰된 스택이 답한다

크리에이터 런타임의 **상호작용 고리**가 실제로 도는 층. 플레이어가 글을 치고, 제작자 코드가
그 글을 자기 상태로 받고, 이용자가 확정하면 제작자가 `useGeneration()`을 부르고, 신뢰된
RowCat 생성 스택이 답한 글이 다시 런타임 상태가 되어 화면이 갱신된다.

```text
플랫폼 입력(브라우저의 <input> · RN의 TextInput)
    ↓  렌더러가 만든 문자열 하나        ← DOM/RN 이벤트 객체는 여기서 끝난다
dispatchEvent(handlerId, "안녕")
    ↓  스케줄러의 userBlocking 실행
QuickJS 안의 onChangeText → setState → 커밋 → 패치 묶음 → 화면
    ↓  이용자가 확정(Enter · 완료 · 버튼)
useGeneration().generate({ messages, instructions, maxOutputCharacters })
    ↓  rowcat:internal/generation → 능력 이름 "generation.generate"
호스트의 생성 능력                  인가 · 검증 · 동시 실행 · 예산 · 취소
    ↓  RuntimeGenerationPort        주입된다. 호스트는 그 반대편을 모른다
신뢰된 RowCat 생성 스택             대상 해석 · 관리형 문 · BYO 라우팅 · 전송
    ↓  글 하나
호스트 완료 큐 → 다음 VM 턴 → 약속의 이어짐
    ↓  제작자가 **직접** 상태에 넣는다
커밋 → 패치 묶음 → 화면
```

이 문서가 답하는 것은 그 고리의 계약이다. 저장 상태는 `story-state.md`·`persistence.md`가,
패치 프로토콜은 `patch-protocol.md`가, 웹 렌더러의 나머지는 `web-renderer.md`가 갖는다.

## 1. 입력 계약은 플랫폼 중립이다

제작자가 쓰는 것은 둘이고 공통 축은 하나다.

```text
TextInput   한 줄. 확정(Enter · 완료)이 있다        onSubmit
TextArea    여러 줄. Enter는 줄바꿈이다             onSubmit이 **없다**
```

```tsx
const [draft, setDraft] = useState("");

<TextInput
	value={draft}
	placeholder="메시지 입력…"
	onChangeText={setDraft}
	onSubmit={send}
/>
```

`RuntimeTextEntry`가 나르는 것은 여섯이다 — `value`·`placeholder`·`disabled`·
`onChangeText`·`style`·`textStyle`. 그 밖의 이름은 렌더러의 프롭 표가 **계약 오류**로
거절하고, 두 플랫폼 모두 종류마다 표 하나를 갖는다.

**여기 없는 것**: `HTMLInputElement` · `HTMLTextAreaElement` · `KeyboardEvent` ·
`InputEvent` · `React.ChangeEvent` · `NativeSyntheticEvent` ·
`TextInputSubmitEditingEventData` · 선택 영역 API · 네이티브 뷰 참조. 어느 것도 이 경계를
넘지 않고, 그 부재를 컴파일러 테스트(`compile.test.ts`의 `글 입력`)와 선언 자산 검사
(`runtime.test.ts`)가 함께 잠근다.

## 2. 통제된 입력 — 값의 주인은 제작자의 상태다

`value`가 **필수**다. `defaultValue`도 비통제 입력도 없다.

```text
플랫폼의 편집
    ↓  onChangeText(바뀐 뒤의 전체 글)
제작자의 상태 갱신
    ↓  렌더 → 커밋
value 프롭
    ↓  렌더러가 요소의 값을 맞춘다
화면
```

옵션을 하나 더 두면 "지금 무엇이 적혀 있는가"의 주인이 둘이 되고(제작자의 상태와 플랫폼
위젯의 내부 값), 그 어긋남은 **저장하려는 순간에만** 드러난다.

**렌더러가 두 번째 상태 기계를 만들지 않는다.** 웹 렌더러가 노드 레코드에 들고 있는 것은
넷뿐이고 전부 그 프레임의 사실이다 — 조합 중인가(`composing`), 마지막으로 보낸 글
(`sentText`), 답이 오지 않은 send의 수(`pendingSends`), 비활성인가(`disabled`). 어느 것도
저장되지 않고 어느 것도 제작자 상태의 사본이 아니다.

**그 왕복은 비동기다 — 그리고 그 사실이 넷째 칸의 이유다.** 위 그림의 화살표 넷은 워커
(미리보기·재생)나 네이티브 다리를 건너므로, 답은 빨라야 한 턴 뒤에 온다. 그동안 사용자는
계속 치고 있어서 도착한 커밋은 **지금 화면보다 옛 글자**이고, 그것을 대입하면 방금 친 글자가
되돌아간다. 그래서 통제된 값은 **가장 최근 send의 답이 도착한 뒤에만** 화면을 쓴다. 답에
순번을 싣지 않는 이유는 패치 프로토콜에 그 축을 더하는 일이기 때문이고, 세는 쪽으로 틀리면
**사용자가 친 글을 지우지 않는 쪽**으로 틀린다.

정산은 둘이다. 도착한 값이 **가장 최근에 보낸 글과 같으면** 기다릴 답이 남아 있지 않으므로
그 자리에서 전부 정산된다(통제된 입력의 압도적 다수가 이 길이다). 그렇지 않으면 하나씩
센다 — 제작자가 글을 다듬어 돌려주는 경우(상한·필터) 답이 보낸 값과 영영 같지 않아서, 같음
하나에만 기대면 그 입력칸은 다시는 갱신되지 않는다. 제작자가 그 글자를 **삼켜** 커밋 자체가
오지 않는 갈래는 `focusout`이 정산한다 — 초점을 잃은 뒤에는 조합도 없고 사용자가 치고 있지도
않아서, 지우지 않는 쪽으로 틀 이유가 사라진다.

**`onChangeText`가 없으면 친 글을 되돌린다.** 그러지 않으면 화면에는 친 글이 있는데 제작자의
상태에는 없다.

## 3. IME — 조합 중의 Enter는 제출이 아니다 (P0)

한국어·일본어·중국어 입력은 확정 전에도 Enter를 쓴다. 그 키를 제출로 읽으면 조합 중인
글자가 그대로 나가고, 사용자는 **자기가 보낸 적 없는 문장**을 보낸 것이 된다.

```text
compositionstart
    ↓  ㅎ → 하 → 한        각 단계가 onChangeText로 나간다
Enter (후보 확정)          ← 제출이 **아니다**
compositionend             확정된 글을 먼저 보내고, 그다음 통제된 값을 맞춘다
    ↓
Enter                      ← 이제 제출이다
```

웹은 **두 사실을 함께 본다**: 우리가 추적하는 조합 상태(`compositionstart`/`end`)와 이벤트
자신의 `isComposing`. 어느 하나만으로는 브라우저 전부를 덮지 못한다(Safari의 `keyCode 229`도
뒤의 것이 덮는다).

순서도 규칙이다. `compositionend`에서 **확정된 글을 먼저 보내고** 그다음 통제된 값을 맞춘다 —
반대면 조합이 끝난 순간 아직 낡은 통제 값이 DOM에 쓰이고 방금 확정한 글자가 사라진다.
조합이 도는 동안에는 통제된 값을 **다시 쓰지 않는다**(쓰면 그 자리에서 조합이 끊긴다).

**⚠️ 그 순서만으로는 부족하다 — 한동안 이 자리가 자모를 뒤섞었다.** `compositionend`의
맞추기는 **보낸 글의 답이 이미 와 있을 때에만** 실제로 쓴다(§2의 `pendingSends`). 순서를
지켜도 그 시점의 통제된 값은 여전히 한 글자 옛것일 수 있고, 한국어에서 조합이 끝나는 순간은
**다음 조합이 시작되는 순간**이기도 해서(`한` 확정 → `녀` 조합 시작) 그 사이의 대입 하나가
IME의 조합 구간을 지워진 글자 위에 다시 그리게 만든다. 화면에 나타나는 것은 사라진 자모이거나
중복된 자모다(`안녕` → `아녀`·`안녀녕`). 조합 중의 커밋이 무해한 이유는 그때 아예 쓰지 않기
때문이지 순서 때문이 아니다.

**네이티브에는 손댈 것이 없다.** RN의 `onChangeText`는 조합 중에도 지금 글을 주고, 통제된
`value`를 다시 대입해도 그 자리에서 조합이 끊기지 않는다. 확정은 `onSubmitEditing`이고 그
콜백은 조합 중에 오지 않는다. 그 차이가 두 렌더러에서 **의도한 유일한 비대칭**이다.

회귀 검사는 넷이다 — 렌더러 단위(`renderer.test.ts`의 `IME`), **늦게 답하는 제작자**
(같은 파일의 `비동기 왕복`), 진짜 VM을 지나는 브라우저 경로(`pipeline.test.ts`의
`ㅎ → 하 → 한`), 그리고 템플릿의 한국어 왕복(`runtime-template-runtime.test.ts`).

둘째가 나중에 붙었다. 그전까지 시험의 제작자는 `onChangeText`가 나가는 **그 자리에서** 값을
되돌려 주었고, 그 동기 echo 아래에서는 답이 화면보다 뒤에 있는 상태가 한 번도 나타나지
않는다 — 이 결함이 모든 검사를 통과한 이유가 그것이다.

## 4. 확정의 순서

한 줄 입력의 Enter는 **마지막 글을 보낸 뒤** 확정을 낸다.

```text
지금 요소에 적힌 글
    ↓  아직 보내지 않았으면 onChangeText(그 글)
onSubmit()
```

같은 값은 두 번 보내지 않는다(`compositionend` 뒤에 `input`이 한 번 더 오는 브라우저가
있고, 그 둘이 두 번의 VM 턴이 되면 안 된다). Enter의 기본 동작을 막는 것은 폼 제출을 막기
위해서가 아니라 **같은 Enter가 두 경로로 읽히는 것**을 막기 위해서다.

**보장의 단위는 발송 순서다.** 확정 핸들러 자신은 그 핸들러가 만들어진 렌더의 상태를 본다 —
React가 그렇듯이. 실제 브라우저에서 글자 하나는 언제나 `input`을 먼저 내므로 확정 시점의
제작자 상태에는 그 글자가 이미 있고, 그 사실을 파이프라인 테스트가 값으로 본다.

**비활성 입력은 아무것도 내보내지 않는다.** 두 플랫폼 모두 배선 자체가 서지 않는다 —
브라우저의 `disabled`와 RN의 `editable={false}`가 이미 막지만, 그 프롭이 시각 효과로만
쓰이는 실수가 흔하다.

## 5. 이벤트는 스케줄러를 지난다

플랫폼 콜백이 VM에 **직접** 들어가지 않는다.

```text
플랫폼 이벤트
    ↓
렌더러 dispatchEvent(handlerId, payload)
    ↓  워커/다리(웹은 postMessage, 네이티브는 WebMessagePort · WebView)
RuntimeVmSession.dispatchEvent(...)
    ↓  userBlocking 큐 — 이 호출 스택에서 VM에 들어가지 않는다
QuickJS
```

핸들러의 신원은 **번호**이고 함수는 VM 안에 남는다. 놓인 번호의 이벤트는 실패가 아니라
`{ handled: false, reason: "stale" }`이다 — 네이티브 큐는 커밋보다 늦게 도착할 수 있다.

## 6. `useGeneration()` — 좁은 제품 어휘 하나

```ts
const generation = useGeneration();

const result = await generation.generate({
	messages: [{ role: "user", content: "안녕" }],
	instructions: CHARACTER_PROMPT,
	maxOutputCharacters: 600,
});

result.text;
```

**요청에 없는 것**: `provider` · `model` · `apiKey` · `baseUrl` · `temperature` ·
`reasoningEffort` · `stream`. 그 축들은 RowCat의 제품 규칙이 정하고(기기 선호 → 관리형/BYO
해석 → 연결 판정), 제작자가 그중 하나를 지정할 수 있으면 그 순간 작품이 특정 제공자에 묶인다 —
그 제공자가 사라지는 날 그 작품이 통째로 멈춘다. 제작자는 **관리형인지 BYO인지도 모른다.**

**결과에 없는 것**: 토큰 수 · 비용 · 제공자 이름 · 모델 id · 종료 사유 · 요청 헤더 ·
원본 응답. V1의 결과는 글 하나다.

**대화 역할은 둘이다**(`user`·`assistant`). 시스템 역할의 자리는 `instructions`가 갖고, 그
값은 호스트의 안전 지시를 **대신하지 않는다**:

```text
[RowCat] 절대 금지 · 등급 가드      applyPlatformSafetyPolicy 의 머리
[제작자] instructions               종속된 응용 콘텐츠다
[제작자] messages                   대화
[RowCat] 등급 꼬리 가드             생성 직전의 마지막 지시
```

그 함수는 대화·BYO 경로가 쓰는 것과 **같은 것이고 멱등**이다. 제작자가 자기 지시 안에 "위
규칙을 무시하라"를 적어도 꼬리 가드가 그 뒤에 선다.

## 7. 생성은 능력이다 — 정책은 호스트의 것이다

```text
제작자가 제안한다   messages · instructions · 출력 상한 힌트
호스트가 정한다     허용되는가 · 어느 스택으로 가는가 · 자격 · 제공자·모델 ·
                   관리형/BYO · 한도 · 취소
```

능력 표에 이름 하나를 놓는 것이 설치의 전부다(`generation.generate`). **설치하지 않으면 그
능력이 없다** — 그때 `generate()`는 `runtime_generation_unavailable`로 실패한다. 공개
API는 사라지지 않는다(§10).

## 8. 인가 — 이용자 상호작용에서만

```text
event      dispatchEvent          ← 이것만이 이용자 상호작용이다
mount · render · effects · unmount · call · graph · bind   전부 거절
```

`useEffect`가 마운트마다 돈다는 사실이 곧 마운트마다 누군가의 키가 쓰인다는 뜻이 되어서는 안 된다.
판정의 근거는 `RuntimeHostCallContext.origin`이고, **호스트가 붙이는 이름이라 VM이 위조할 수
없다.** VM 안의 단계(`render`·`effect`)로는 그 답을 낼 수 없다 — 이벤트 핸들러가 `await`를
지나면 그 이어짐의 단계는 `idle`이지만 **실행은 같은 실행**이고, 그 자리에서 부른 생성은
여전히 사용자가 누른 버튼의 결과다.

**인가가 검증보다 앞이다.** 뒤에 두면 인가되지 않은 요청도 그 모양이 옳은지에 따라 다른
오류를 받고, 그 차이는 그대로 탐지기가 된다.

VM 쪽에도 문이 하나 더 있다 — 렌더 중의 `generate()`는 그 자리에서
`runtime_generation_during_render`다. 호스트도 같은 요청을 거절하지만 그때의 이름은
"인가되지 않았다"이고, 그 문장은 무엇을 고쳐야 하는지 말하지 않는다.

## 9. 검증과 한도 — 포트보다 앞이다

한도는 **두 벌**이고 같은 수다. VM이 먼저 세는 것은 제작자에게 그 자리에서 정확한 오류를
주기 위한 것이고, 호스트가 다시 세는 것은 그 코드가 우회되었을 때의 마지막 방어선이다.

```text
maxMessages              100
maxMessageCharacters     32,768
maxInstructionsCharacters 32,768
maxTotalCharacters       262,144
maxOutputCharacters      16,000        요청의 값은 이 상한으로 잘린다
maxConcurrent            1             세션 하나에 도는 생성 하나
maxPerSession            200           예산이지 요금이 아니다
```

단위가 **문자(UTF-16 코드 단위)** 인 것도 두 realm이 같은 문자열에 다른 수를 내지 않게 하는
선택이다. 토큰이라는 낱말이 계약에 없는 이유는 토크나이저가 제공자의 것이기 때문이다 —
글자 상한을 토큰 상한으로 옮기는 일은 어댑터가 한다.

**허용 목록이다.** 모르는 키는 조용히 떨어지고, 포트에 도착하는 요청의 키는 언제나 셋이다.
거절된 요청은 **포트에 닿지 않는다** — 그 사실을 `generation.test.ts`가 값으로 본다.

**동시 실행은 하나다.** 두 번째 요청은 `runtime_generation_busy`로 거절되고 제공자에게
가지 않는다. 그 규칙이 두 번 누름의 결과를 결정적으로 만든다. UX의 대기 방어는 제작자
코드가 갖고(템플릿의 `pending`), 이 한도는 그 뒤의 자원 방어다.

## 10. 오류 — 제작자가 받는 것은 안정된 코드다

```text
runtime_generation_unavailable          이 세션에 능력이 없다
runtime_generation_not_authorized       상호작용이 아니거나 세션 예산을 넘었다
runtime_generation_insufficient_balance 예약됨 — 지금은 아무 경로도 내지 않는다(아래)
runtime_generation_busy                 이미 도는 생성이 있다
runtime_generation_cancelled            폐기·정지로 취소되었다
runtime_generation_invalid_request      모양·한도를 벗어났다
runtime_generation_during_render        렌더 중에 불렀다
runtime_generation_failed               그 밖의 실패
```

```ts
try {
	const result = await generation.generate(request);
} catch (error) {
	if (error instanceof RuntimeError) {
		// error.code — 위 어휘 하나
	}
}
```

**`insufficient_balance`는 남아 있되 나오지 않는다.** 그 사유를 내던 것은 관리형 생성의 잔액
판정이었고 결제와 함께 사라졌다. 코드를 어휘에서 지우는 것은 공개 언어 계약을 **좁히는** 변경이라
(`RUNTIME_API_VERSION`과 호환 창의 판단이 따른다) 지금은 예약어로 둔다 — 공개 문서도 그렇게 적는다.

**호스트의 코드 문자열이 `@rowcat/runtime`의 것과 한 글자도 다르지 않다.** 갈리면 그 지점에
번역표가 하나 생기고 그 표는 언젠가 한쪽만 고쳐진다. 같게 두면 매핑이 항등이다.

**제공자의 내부가 제작자에게 가지 않는다.** 사유를 말하지 않은 실패는 전부 `failed`이고
문장도 우리 것이다 — HTTP 상태·응답 본문·API 주소·스택·파일 경로·SDK 클래스 이름·서버
내부 어느 것도 그 문장에 실리지 않는다.

**생성 실패는 세션의 실패가 아니다.** 제작자가 잡아서 이어 갈 수 있는 회복 가능한 거절이고,
치명적 실패(예산·메모리·엔진)는 그대로 세션을 끝낸다. 그 둘을 흐리지 않는다.

### 10.1 ⚠️ 이름 있는 사유가 원본 문장의 통행증이 아니다

정화가 **두 겹**이고, 그 둘이 답하는 질문이 다르다.

```text
① 신뢰된 어댑터   제공자·전송·SDK·내부 서비스의 예외 → 사유 하나 + RowCat의 문장 하나
                 워커로 넘기기 **전에** 접는다
② 호스트          RuntimeGenerationPort 의 **사유 없는** 예외 → runtime_generation_failed
                 + 호스트가 소유한 문장
```

②만 있던 동안 실제로 새는 경로가 있었다. 어댑터가 모르는 예외를
`{ reason: "failed", message: error.message }`로 접어 워커에 보내면 워커는 그것을 **이름
있는** `RuntimeGenerationError`로 만들고, ②는 사유를 말하지 않은 예외만 접으므로 그 문장은
정화기를 그대로 지나쳐 QuickJS의 `RuntimeError.message`가 되었다 —
`401 … Authorization: Bearer sk-live-…` 한 줄이 제작자 코드의 손에 닿는다.

그래서 규칙이 하나 더 있다: **사유에 이름을 붙이는 바로 그 자리에서 문장도 우리 것으로
바꾼다.** 이름 있는 사유는 우리가 의도적으로 공개하는 **어휘**이지 원본 문장의 통행증이
아니다. 신뢰된 어댑터 자신이 신뢰 경계이고, ②는 그 뒤의 방어선이지 대체재가 아니다 — 어느
한 겹이 실수로 우회되어도 다른 한 겹이 제작자를 지킨다.

미리보기에서 그 판정을 갖는 자리는 하나다
(`apps/web/src/features/runtime-preview/runtime-preview-generation-failure.ts`). 어댑터의
`catch`와 라우터의 거절 경로가 **같은 함수**를 지나므로 한쪽만 안전해지는 상태가 표현되지
않고, 다섯 사유의 문장은 전부 **정적**이다 — 잡은 예외의 문장도, 제공자의 이름도, 모델
id도, HTTP 상태도 끼워 넣을 자리가 없다.

**공개하는 사유에도 원본 문장을 싣지 않는다.** `not-authorized`가 그 예다: 생성이 막힌
이유를 아는 것은 신뢰된 화면(설정)이고, 이 경계를 넘는 것은 "쓸 수 없다"까지다 — 제공자의
이름을 실으면 같은 계약이 나중에 **플레이어의 기기**에서 돌 때 그 낱말이 남의 기기 설정을
제작자 코드에 말해 주는 값이 된다.

## 11. 신뢰된 어댑터 — 두 번째 AI 스택을 만들지 않는다

스튜디오 미리보기의 반대편은 이렇다.

```text
QuickJS(워커)
    ↓  능력 → RuntimeGenerationPort
워커의 포트                      요청 id 하나를 발급하고 메시지를 낸다
    ↓  generation-request { generation, requestId, request }
메인 스레드의 라우터              세대 확인 · AbortController · 어댑터 부재의 답
    ↓
RuntimePreviewGenerationAdapter  resolveEffectiveGeneration → resolveGenerationExecution
                                 → applyPlatformSafetyPolicy → createGenerationTransport
    ↓  스트림을 끝까지 모은다
generation-result { ok, text } 또는 이름 있는 사유
    ↓
워커 → 호스트 완료 큐 → VM 약속의 이어짐
```

대상 해석·관리형 문(허용 목록·속도 제한)·BYO 라우팅·전송이 전부 **대화가 쓰는 바로 그 함수들**이다. 어댑터에
있는 것은 그 앞뒤의 배선뿐이고, 제공자를 하나 더 붙이는 일이 그 파일을 고치는 일이 되면
경계가 잘못 그어진 것이다.

**워커에는 자격증명이 오지 않는다.** SDK·질의 계층·BYO 키 어느 것도 제작자 코드와
같은 프로세스에 없고, 그 부재를 `runtime-preview-boundaries.test.ts`가 이름으로 잠근다.
생성 스택을 들이는 자리는 어댑터 **하나**다.

**스트리밍을 VM에 흘리지 않는다.** 전송은 여전히 스트리밍이고(중지가 값을 하려면 그래야
한다) 델타를 모아 완성된 글 하나로 돌려주는 것이 어댑터의 마지막 줄이다.

## 12. 취소 — 다시 시작 · 정지 · 떠남

생성은 돈이 든다. 그래서 취소가 두 겹이다.

```text
세대 번호   늦게 온 답이 새 세션에 닿지 않는다
AbortSignal 이미 나간 요청이 실제로 끊긴다
```

**세대 확인만으로는 부족하다** — 버려질 답을 만들려고 유료 요청이 끝까지 돈다. **신호만으로도
부족하다** — 중단이 늦게 도착하거나 전송이 이미 끝났을 수 있고, 그때 돌아온 답은 세대가
달라 아무 데도 닿지 않아야 한다.

```text
다시 시작   세대 + 1 → 라우터가 도는 요청을 중단 → 새 세션
정지        라우터가 중단 → 워커의 stop → 열려 있는 약속을 cancelled로 거절
떠남        세대 + 1 → 라우터가 중단 → stop → 유예 뒤 워커 종료
세션 폐기   호스트의 AbortSignal이 오르고, 열린 호출의 완료는 pending에 없어 버려진다
```

**어댑터가 없어도 요청은 답을 받는다.** 조용히 버리면 VM의 약속이 영영 확정되지 않고, 그
세션의 제작자 코드는 `await`에서 멈춘 채로 남는다.

## 13. 완료는 스케줄러를 지나 돌아온다

제공자의 약속 콜백에서 VM으로 **동기로 들어가지 않는다.**

```text
VM 이벤트 → 호스트 능력 → 비동기 생성 → 호스트 완료 큐 → 스케줄러 → VM 약속의 이어짐
```

Phase 3/4가 세운 "네이티브 스택 위에서 재귀하지 않는다"가 그대로 걸린다. 완료가 도착하면 그
실행은 큐에 다시 서고, 그 다음 턴에서 약속이 확정된다.

## 14. 결과는 제안이다 — 저장의 저자는 제작자다

`useGeneration()`은 저장 상태를 **한 글자도** 바꾸지 않는다.

```ts
const result = await generation.generate(request);
setProgress((current) => appendMessage(current, "assistant", result.text));
```

호스트가 몰래 메시지를 덧붙이면 저장의 저자가 둘이 된다. 실패한 생성이 가짜 답장을 남기지도
않는다 — 무엇을 그릴지는 제작자의 오류 UX가 정한다.

어느 수명에 넣을지도 제작자가 고른다:

```text
useState             이 세션 동안만            다시 시작하면 사라진다
useStoryState        이 플레이스루 동안        플레이 초기화가 지운다
usePersistentState   회원 + 작품의 긴 진행     플레이 초기화를 넘어 산다
```

## 15. 미리보기의 AI 토글 — 세션이 설 때 굳는다

```text
generationSupported   어댑터가 있는가          토글을 그릴 수 있는가
generationEnabled     다음 실행에서 켤 것인가   도는 세션에는 영향이 없다
generationActive      지금 도는 세션이 그 능력을 갖고 섰는가
```

**도는 VM의 능력 표를 갈아 끼우지 않는다.** 세션의 능력은 생성 시점에 정해지고, 토글을
바꾸면 다음 `실행`·`다시 시작`부터 적용된다.

**기본은 꺼짐이다.** 미리보기를 켜는 일이 곧 키(운영자의 것이든 제작자의 것이든)를 쓰는 상태를
만드는 일이 되어서는 안 된다 — 코드를 고치고 다시 실행하는 것이 저작의 정상 상태이고, 그 반복이 비용이 되면
제작자는 실행 버튼을 두려워하게 된다.

## 16. 계측

호스트가 세는 것은 세션이 살아 있는 동안의 수뿐이다(`session.metrics()`).

```text
generation.issued              포트로 실제로 나간 요청
generation.completed           글 하나를 돌려받았다
generation.failed              제공자·전송이 실패했다
generation.cancelled           폐기·정지로 끝났다
generation.rejectedByPolicy    인가·동시 실행·예산이 막았다   ← 포트에 닿지 않았다
generation.rejectedByLimits    모양·한도가 막았다             ← 역시 닿지 않았다
generation.maxConcurrent       동시에 돌았던 최대 수
root.eventsDispatched          다리를 건넌 이벤트 수
```

능력이 설치되지 않은 세션의 `generation`은 **`null`이다** — 0으로 채운 표를 돌려주면 *켜져
있는데 한 번도 부르지 않았다*와 *애초에 부를 수 없다*가 한 값이 된다.

텔레메트리 파이프라인도 저장소도 만들지 않는다. 제작자 코드는 이 수를 읽을 수 없다.

## 17. 보안 경계

```text
제작자 JavaScript   QuickJS/WASM 안에서만 돈다
워커                응답성 경계다 — **격리가 아니다**
섀도 DOM            스타일 경계다 — **격리가 아니다**
프롭                종류마다 표 하나, 이름마다 손 하나. setAttribute(name, value)도
                    element[name] = value도 {...props}도 렌더러에 없다
글자                입력 값도 생성된 글도 **글자**다. 마크업이 되는 통로가 없다
                    (innerHTML · dangerouslySetInnerHTML · rehype-raw 어느 것도 없다)
```

모델이 `<img src=x onerror=alert(1)>`을 답해도 제작자가 `<Text>` 안에 넣으면 그 문장은
글자로 그려진다.

**오류도 그 표의 한 줄이다.** 제작자에게 건너가는 실패는 사유 하나와 RowCat이 소유한 문장
하나뿐이고, 그 문장을 만드는 자리는 신뢰된 어댑터와 호스트 둘이다(§10.1). API 키·인증
헤더·제공자 주소·응답 본문·HTTP 상태·파일 경로·SDK 이름·모델 id·스택 어느 것도 그 경계를
넘지 않는다.

## 18. 이 판이 하지 않는 것

```text
스트리밍            generate()는 약속 하나다. AsyncIterable도 토큰 콜백도 없다
도구 호출           함수 호출·구조화 출력 프레임워크가 없다
채팅 전용 API       useChat()·sendMessage()·<Chat/>을 만들지 않는다 — 런타임은 장르 중립이다
제작자의 제공자 선택 키·엔드포인트·모델을 고르는 통로가 없다
제작자의 네트워크    fetch·WebSocket이 VM에도 계약에도 없다
백그라운드 생성      상호작용에서만 시작한다. 예약·자율 에이전트가 없다
발행 재생 표면       Phase 7의 것이다 — 이 층의 소비자는 스튜디오 미리보기다
```
