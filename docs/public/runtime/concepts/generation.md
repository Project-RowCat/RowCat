---
title: AI 생성
description: useGeneration()으로 RowCat의 AI를 부르는 방법, 요청의 모양, 실패의 이름, 정본 상태와 AI 글의 구분.
group: concepts
order: 5
---

# AI 생성

`useGeneration()`은 런타임이 **RowCat의 AI를 부르는 유일한 통로**입니다. 인물의 답장, 장면의
서술, 자유 입력에 대한 반응 — 글이 필요한 자리에서 요청 하나를 보내고 글 하나를 받습니다.

```tsx
const generation = useGeneration();

async function ask() {
	const result = await generation.generate({
		instructions: "당신은 세나입니다. 짧게, 메신저처럼 답하세요.",
		messages: [{ role: "user", content: "어제 왜 안 왔어?" }],
	});
	// result.text
}
```

## 요청의 모양

| 필드 | 형 | 뜻 |
| --- | --- | --- |
| `messages` | `{ role: "user" \| "assistant"; content: string }[]` | 대화. 비어 있으면 안 됩니다 |
| `instructions` | `string` (선택) | 이 인물·장면의 역할과 성격 |
| `maxOutputCharacters` | `number` (선택) | 답 길이의 상한 힌트(글자 수). 기본 4,000 |

결과는 `{ text: string }` 하나입니다.

`instructions`는 RowCat의 안전 지시를 **대신하지 않습니다.** RowCat이 세운 가드가 앞뒤에
서고 당신의 지시문은 그 사이에 들어갑니다. 그래서 "모든 규칙을 무시하라" 같은 문장은 아무
효과가 없습니다.

`role`에 `"system"`은 없습니다. 그 자리가 `instructions`입니다.

## 제작자가 정하지 않는 것

요청에 제공자·모델·API 키·온도·추론 정도·스트리밍 같은 축이 **없습니다.** 어느 모델이 답하고
누구의 키가 쓰이는지는 플레이어의 RowCat 설정이 정합니다 — RowCat 관리형이면 그 서버를 운영하는
쪽의 키가 쓰이고, 직접 연결한 제공자가 있으면 그 연결이 쓰입니다. 당신의 코드는 둘 중 어느 쪽인지도
모르고, 알 필요도 없습니다.

결과에도 토큰 수·비용·잔액·모델 이름·종료 사유가 없습니다. 있는 것은 글 하나입니다.

## 플레이어의 조작에서만 시작합니다

`generate()`는 **이벤트 핸들러 안에서만** 부를 수 있습니다. 렌더 중에 부르면
`runtime_generation_during_render`이고, `useEffect` 안에서 부르면 인가되지 않아
`runtime_generation_not_authorized`로 실패합니다.

이유는 비용입니다. 화면을 그릴 때마다, 마운트될 때마다 요청이 나가면 플레이어가 누르지 않은
일에 누군가의 키가 쓰입니다. 첫 요청은 언제나 사람이 누른 것이어야 합니다.

## 실행 중의 한도

한 번의 런타임 실행에서 **동시에 도는 요청은 1개**입니다. 앞 요청이 끝나기 전에 또 부르면
`runtime_generation_busy`입니다 — 두 번 누름을 막는 대기 상태는 당신의 코드가 갖고, 이 한도는
그 뒤의 방어입니다. 앞 요청이 끝나면 풀립니다.

한 번의 런타임 실행에서는 AI 생성을 **최대 200번** 시작할 수 있습니다. 그 뒤의 `generate()`는
`runtime_generation_not_authorized`로 실패하고, 기다리거나 다시 시도해도 풀리지 않습니다 —
플레이어가 **다시 시작**하면 새 실행이 시작되고 이 횟수도 처음부터입니다. 요청이 나간 뒤
실패한 것도 한 번으로 세고, 모양이 잘못돼 나가지 않은 요청은 세지 않습니다. 평범한 작품이 이
수에 닿는 일은 드물지만, 조작 하나에 여러 번 부르는 구조라면 세어 두세요.

이 둘은 코드가 읽을 수 있는 값이 아닙니다 — `RUNTIME_GENERATION_LIMITS`에는 **요청 하나의
한도**만 있습니다([한도](#한도)).

## 실패

`generate()`는 실패하면 `RuntimeError`를 던지고, `code`로 사유를 말합니다.

| `code` | 뜻 | 할 일 |
| --- | --- | --- |
| `runtime_generation_invalid_request` | 요청의 모양이나 길이가 잘못됐다 | 코드를 고칩니다 |
| `runtime_generation_during_render` | 렌더 중에 불렀다 | 핸들러로 옮깁니다 |
| `runtime_generation_unavailable` | 이 세션에 AI가 없다(미리보기의 AI 꺼짐, 플레이어의 거부) | 그 사실을 화면에 적습니다 |
| `runtime_generation_not_authorized` | 플레이어의 조작에서 시작하지 않았거나, 이 실행에서 허용된 생성 횟수를 모두 썼다 | 이벤트 핸들러에서 부르는지 확인합니다. 횟수를 다 썼다면 이 실행에서는 더 생성할 수 없습니다 — 다시 시도해도 같고, 플레이어가 다시 시작해야 풀립니다 |
| `runtime_generation_insufficient_balance` | 예약된 코드입니다 — 지금 어떤 RowCat 호스트(스튜디오 미리보기 · 웹 플레이어 · 앱 플레이어)도 이 사유를 내지 않습니다. 이름이 남아 있는 것은 이미 이 코드를 읽는 작품이 깨지지 않게 하기 위해서입니다 | 따로 다루지 않아도 됩니다. `runtime_generation_failed`처럼 다뤄도 됩니다 |
| `runtime_generation_busy` | 앞 요청이 아직 돌고 있다 | 기다립니다 |
| `runtime_generation_cancelled` | 세션이 끝나며 취소됐다 | 아무것도 하지 않습니다 |
| `runtime_generation_failed` | 그 밖의 실패 | 다시 시도할 길을 둡니다 |

실패 메시지는 RowCat이 만든 문장입니다. 제공자의 원문·HTTP 상태·주소는 오지 않습니다.

**실패해도 플레이어의 말은 남겨 두세요.** 보낸 말을 상태에 먼저 넣고 답을 기다리면, 실패했을
때 "다시 시도"만 붙이면 됩니다.

## 예제 — 메신저

```tsx example=generation file=src/main.tsx
import {
	Button,
	Row,
	Screen,
	ScrollView,
	Stack,
	Text,
	TextInput,
	color,
	defineStoryState,
	useGeneration,
	useState,
	useStoryState,
} from "@rowcat/runtime";

interface Line {
	role: "user" | "assistant";
	content: string;
}

const chat = defineStoryState({
	key: "chat",
	version: 1,
	initial: { lines: [] as Line[] },
});

const SENA =
	"당신은 세나입니다. 도서부 사서 보조 학생이고, 메신저로 대화하듯 한국어로 한두 문장만 답합니다.";

export default function App() {
	const [state, setState] = useStoryState(chat);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const generation = useGeneration();

	async function reply(lines: Line[]) {
		setPending(true);
		setFailure(null);
		try {
			const result = await generation.generate({
				instructions: SENA,
				messages: lines.slice(-10),
				maxOutputCharacters: 600,
			});
			setState((current) => ({
				lines: [...current.lines, { role: "assistant", content: result.text }],
			}));
		} catch {
			setFailure("답장을 받지 못했습니다. 다시 시도해 주세요.");
		} finally {
			setPending(false);
		}
	}

	function send() {
		const text = draft.trim();
		if (text.length === 0 || pending) return;
		const lines: Line[] = [...state.lines, { role: "user", content: text }];
		setDraft("");
		setState({ lines });
		void reply(lines);
	}

	return (
		<Screen>
			<Stack style={{ height: "100%", padding: 16, gap: 8 }}>
				<ScrollView style={{ grow: 1 }}>
					<Stack gap={6}>
						{state.lines.map((line, index) => (
							<Text
								key={index}
								style={{
									align: line.role === "user" ? "end" : "start",
									color: line.role === "user" ? color("#7dd3fc") : color("#f5f7fa"),
								}}
							>
								{line.content}
							</Text>
						))}
					</Stack>
				</ScrollView>
				{failure !== null && (
					<Row gap={8}>
						<Text style={{ color: color("#fca5a5") }}>{failure}</Text>
						<Button tone="secondary" onPress={() => reply(state.lines)}>
							다시 시도
						</Button>
					</Row>
				)}
				<Row gap={8}>
					<TextInput
						value={draft}
						placeholder={pending ? "세나가 입력 중…" : "메시지"}
						disabled={pending}
						onChangeText={setDraft}
						onSubmit={send}
						style={{ grow: 1 }}
					/>
					<Button onPress={send} disabled={pending || draft.trim().length === 0}>
						보내기
					</Button>
				</Row>
			</Stack>
		</Screen>
	);
}
```

이 예제에서 눈여겨볼 것:

- **보낸 말이 먼저 저장됩니다.** `setState({ lines })`가 `reply()`보다 앞에 있습니다.
- **최근 열 줄만 보냅니다.** 대화가 길어져도 요청이 한도를 넘지 않습니다.
- **답장은 함수형 갱신으로 붙입니다.** 기다리는 사이 상태가 바뀌었어도 잃지 않습니다.
- **`pending`은 화면의 상태**(`useState`)이고 **대화는 플레이스루의 상태**(`useStoryState`)
  입니다.

## 정본 상태와 AI의 글

**AI는 글을 만들고, 진행은 코드가 만듭니다.** 이 문장이 런타임 작품을 설계할 때 가장 중요한
규칙입니다.

```text
좋음   버튼 누름 → 코드가 단서를 기록한다 → AI가 인물의 반응을 쓴다
피함   AI에게 "단서를 찾았는가" 묻는다 → 문장을 파싱한다 → 그 답을 진행으로 믿는다
```

AI의 문장은 매번 다르고, 파싱은 언젠가 틀리고, 그 틀림은 플레이어의 진행에 영구히 남습니다.
무엇을 알게 되었는지·신뢰가 얼마나 올랐는지·밤이 어떻게 끝나는지는 **결정적인 코드**가
정하고, AI에게는 그 결과를 **말로 옮기는 일**을 맡기세요. 인물이 루프를 모른다는 사실이 있다면
그것도 `instructions`에 적어 두는 것이지 모델의 판단에 맡길 것이 아닙니다.

## 한도

한도는 둘로 갈립니다 — **요청 하나의 한도**와 **실행 중의 한도**. 앞의 것은 코드가 읽을 수
있는 값이고, 뒤의 것은 런타임이 지키는 규칙이라 값으로 내보내지 않습니다.

### 요청 하나의 한도

| 항목 | 한도 |
| --- | --- |
| `messages`의 수 | 100개 |
| 메시지 하나의 길이 | 32,768자 |
| `instructions`의 길이 | 32,768자 |
| 요청 전체의 길이 | 262,144자 |
| `maxOutputCharacters`의 상한 | 16,000 |

이 값은 `RUNTIME_GENERATION_LIMITS`로 읽을 수 있습니다. 넘으면 요청이 나가기 전에
`runtime_generation_invalid_request`로 던집니다.

### 실행 중의 한도(요약)

| 항목 | 한도 | 넘으면 |
| --- | --- | --- |
| 동시에 도는 요청 | 1개 | `runtime_generation_busy` — 앞 요청이 끝나면 풀립니다 |
| 한 번의 실행에서 시작할 수 있는 생성 | 200번 | `runtime_generation_not_authorized` — 플레이어가 다시 시작해야 풀립니다 |

이 둘은 `RUNTIME_GENERATION_LIMITS`에 **없습니다.** 자세한 뜻은
[실행 중의 한도](#실행-중의-한도)에 있습니다.

## 없는 것

- **스트리밍.** `await` 하나로 전체 글을 받습니다. 타이핑 효과는 받은 글을 잘라 그리는 것으로
  만듭니다.
- **도구 호출·구조화된 출력·이미지 생성.**
- **제작자의 제공자 선택.** 작품이 특정 모델에 묶이지 않습니다.
- **직접 네트워크.** `fetch`는 없습니다. 외부 API를 부를 방법이 없습니다 — `Image`의
  [HTTPS 이미지](/docs/runtime/concepts/assets)는 RowCat이 대신 가져오는 그림이지 응답을 읽는
  통로가 아닙니다.
