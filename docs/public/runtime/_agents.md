# 에이전트를 위한 안내

이 문서는 **RowCat 크리에이터 런타임 코드를 대신 쓰는 도구**(Claude Code · Codex · Cursor 같은
코딩 에이전트)를 위한 것입니다. 사람이 읽는 공개 문서 목록에는 없습니다 — 여기 적힌 것은
제품의 설명이 아니라 **작업 절차와 규칙**이기 때문입니다.

## 30초 모델

```text
크리에이터 런타임 = TypeScript/TSX로 쓴 작품 화면
공개 API        = @rowcat/runtime 하나. 그 밖의 import는 컴파일에서 막힌다
실행            = 격리된 QuickJS/WASM. 브라우저도 Node도 아니다
화면            = RowCat의 호스트 렌더러가 그린다. DOM이 아니다
저장            = 세 가지 수명(useState · useStoryState · usePersistentState)
```

React를 닮았지만 **React가 아닙니다.** 이름과 시그니처가 익숙하다는 이유로 React의 다른
API가 있을 것이라고 가정하면 안 됩니다 — `useContext`, `useLayoutEffect`, `Suspense`,
`createPortal`, `React.FC`는 이 언어에 없습니다.

## 절대 하지 않는 것

```text
import "react" · "react-dom" · "react-native" · npm 패키지        컴파일 거절
<div> · <span> · 그 밖의 HTML 태그                                 컴파일 거절
fetch · XMLHttpRequest · WebSocket                                 없다
setTimeout · setInterval · requestAnimationFrame                   없다 (전이는 transition 프롭)
localStorage · IndexedDB · document · window · process             없다
eval · new Function · 동적 import()                                컴파일 거절
상대 import에 확장자 붙이기 (`./game.ts`)                          `game.ts.ts`를 찾는다 — 확장자를 뺀다
```

마지막 줄은 이 저장소의 다른 코드와 **반대**입니다. 런타임 프로젝트 안에서는 `./game`처럼
확장자 없이 적습니다.

전체 목록과 대안은 [지원하지 않는 API](/docs/runtime/runtime-model/unsupported-apis)와
[지원하는 import](/docs/runtime/runtime-model/supported-imports)에 있습니다.

## 세 가지 상태 수명을 섞지 않습니다

```text
useState             이 세션 안. 다시 시작하면 사라진다        열린 패널 · 입력 중인 글 · 로딩 표시
useStoryState        이 회차. `플레이 초기화`가 지운다          현재 장면 · 호감도 · 이번에 알아낸 것
usePersistentState   계정에 남는다. 초기화가 닿지 않는다        해금한 결말 · 회차를 넘는 기억
```

가장 자주 나오는 실수는 **일시적인 UI 상태를 `usePersistentState`에 넣는 것**입니다. 그
값은 플레이어의 계정에 저장되어 기기 사이를 건너므로, 열린 패널 같은 것을 거기 두면 다른
기기에서 그 패널이 열린 채로 시작합니다. 자세한 것은
[상태](/docs/runtime/concepts/state)에 있습니다.

## 이름을 지어내지 않습니다

이 언어의 이름은 `@rowcat/runtime`이 내보내는 것이 **전부**입니다. React·DOM·React Native를
닮았다는 이유로 있을 것 같은 이름을 쓰지 마십시오. 확실하지 않으면 코드를 쓰기 전에 찾습니다:

```text
MCP          runtime_get_api_reference · runtime_search_docs
문서         /docs/runtime/reference
기계용 목록   /runtime-api.json · /llms-full.txt
```

## 고쳤으면 확인합니다

MCP로 붙어 있다면 이 순환이 이 도구 모음의 존재 이유입니다.

```text
1. runtime_get_project · runtime_list_files      무엇이 있는지 본다
2. runtime_read_file                             고칠 파일만 읽는다
3. runtime_search_docs                           모르는 API는 지어내지 말고 찾는다
4. runtime_write_file                            가장 작은 변경 하나
5. runtime_compile                               막는 진단이 없을 때까지
6. runtime_preview_start | runtime_preview_restart
7. runtime_preview_get_tree                      실제로 무엇이 그려졌는가
8. runtime_preview_press · runtime_preview_input 그 경로를 눌러 본다
9. runtime_preview_get_tree                      눌린 뒤에 무엇이 바뀌었는가
10. runtime_preview_get_console · _get_state     설명되지 않는 결과가 있을 때만
```

**컴파일이 통과했다는 것은 화면이 옳다는 뜻이 아닙니다.** 조건부 렌더, 상태 갱신, 이벤트
배선은 전부 컴파일을 통과하면서 틀릴 수 있습니다. 트리를 읽고 눌러 보는 단계를 건너뛰지
마십시오.

## 미리보기 트리의 노드 번호는 리비전에 매입니다

`runtime_preview_get_tree`가 준 `nodeId`는 **그 리비전의 트리**에 대한 것입니다. 누르거나
글을 넣으면 리비전이 오르고, 사라진 노드를 가리킨 조작은 `stale_node`로 거절됩니다. 그때
할 일은 **트리를 다시 읽는 것**이고, 글자나 순서로 대체 노드를 추측하면 안 됩니다.

## 작게 고칩니다

한 번에 파일 하나, 변경 하나입니다. 프로젝트를 통째로 다시 쓰는 것은 거의 언제나 잘못된
선택입니다 — 제작자가 쓴 코드에는 문서에 없는 의도가 들어 있고, 되돌릴 방법이 없습니다.
