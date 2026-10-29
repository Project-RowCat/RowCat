# @rowcat/mcp

크리에이터 런타임 저작을 **코딩 에이전트가 조종할 수 있게** 하는 MCP 서버.

```text
Claude Code · Codex · Cursor …          MCP 클라이언트
        │ stdio JSON-RPC
rowcat-mcp serve                        이 실행 파일 — 전송 · 인증 · 기기
        │
@rowcat/runtime-mcp                     도구의 의미 · 검증 · 한도 · 미리보기
        │
@rowcat/authoring · runtime-compiler · runtime-host · runtime-ai-docs
```

아래 두 줄의 `@rowcat/*`는 **이 패키지 안에 접혀 있습니다.** 따로 배포되지 않으므로
레지스트리에서 그 이름을 받으려 하면 찾지 못합니다 — 설치하는 것은 `@rowcat/mcp` 하나입니다.

## 왜 로컬에서 도는가

RowCat의 초안은 **기기의 것이고 서버에는 암호문만 있다.** 서버에 저작 API를 열어 원격
MCP로 만들면 이 실행 파일은 필요 없어지지만, 그때 사라지는 것은 제품의 영지식 주장이다.
그래서 이 프로세스가 **계정의 기기 하나가 된다** — 로그인해서 세션을 얻고, 이미 연결된
기기에서 봉투 키를 건네받고, 동기화 프로토콜로 저작 레코드를 받아 온다.

**기기가 되는 방법은 웹·앱과 같다.** 새 프로토콜도, MCP 전용 키링도, 두 번째 키 전달 수단도
없다 — 웹·앱이 쓰는 그 기기 페어링을 그대로 지난다.

```text
새 기기(이 프로세스)              서버(불투명 중계)        신뢰 기기(웹·앱)
코드·일회용 키쌍을 만든다   ───►  codeHash · 공개키
                                                    ◄──  사람이 코드를 옮겨 적고 승인한다
봉투를 열고 → **키링에 대조하고** → 그제서야 0600 파일에 남긴다
```

서버는 봉투를 열지 못하고, 페어링 코드 원문도 받지 않으며, 일회용 개인키는 **이 프로세스의
메모리 밖으로 나가지 않는다.** 도중에 프로세스가 죽으면 남아 있던 봉투는 누구도 열지 못한다.

레코드는 **메모리에만** 있다. 시작할 때 한 번 내려받고, **쓰기 앞에 한 번 더 받고**, 쓰기는
그 자리에서 올린다(그래서 `write_file`은 push가 끝난 뒤에 성공을 돌려준다 — 이 프로세스에서
내구성을 만드는 것은 서버다).

## 남의 편집을 덮지 않는다

에이전트가 파일을 읽은 뒤 스튜디오나 다른 기기가 같은 파일을 고치는 일은 실제로 일어난다.

```text
refresh   쓰기 앞에 pull만 돈다 — 판정할 대상을 최신 판으로 맞춘다
판정      expectedHash를 지금 값과 대조한다 → 어긋나면 file_conflict
push      **수렴하지 않는다** — 서버가 거절하면 그 사실이 그대로 올라온다
되돌리기  충돌이면 방금 한 쓰기를 무르고 최신 판을 받는다
```

`file_conflict`의 응답에는 **지금 값의 지문**이 실린다. 에이전트가 할 일은 다시 읽고, 병합하고,
그 지문으로 다시 쓰는 것이다. `expectedHash`는 선택이지만 **넣지 않은 쓰기에는 그 보호가
없다** — 도구 설명이 언제나 넣기를 권하는 이유다. 지우기와 이름 바꾸기도 같은 칸을 받는다.

일상 동기화(웹·모바일)의 수렴 동작은 **한 글자도 바뀌지 않았다.** 갈래를 고르는 것은 부르는
쪽이다(`SyncEngine.push`의 `conflictMode`).

## 준비

### 필요한 것

| | |
| --- | --- |
| Node.js | **22.12 이상** — `node -v`로 확인합니다 |
| RowCat 계정 | 이메일·비밀번호로 로그인할 수 있는 계정 |
| 이미 연결된 RowCat 기기 | 웹이나 앱에서 **동기화를 한 번 켠** 기기 하나. 그 기기가 이 도구를 승인합니다 |

승인할 기기가 하나도 없다면 복구 코드로 여는 길이 따로 있습니다(아래 [복구 코드는 어디로
갔나](#복구-코드는-어디로-갔나)).

### 이름이 둘이다

**설치하는 것과 실행하는 것의 이름이 다릅니다.** 아래 모든 예시가 이 구분을 따릅니다.

```text
npm 패키지 이름   @rowcat/mcp    npm·pnpm에 넘기는 값(install · add · dlx · npx)
설치 뒤의 명령    rowcat-mcp     터미널과 MCP 클라이언트 설정에 적는 값
```

두 자리를 바꿔 적으면 **레지스트리에 없는 이름을 받으러 갑니다** — `install`·`add`·`dlx`·
`npx`의 인자로 명령 이름을 넘기는 것이 그 오류이고, 실패는 설치가 끝난 뒤가 아니라 그
자리에서 납니다. 패키지 자리에는 `@rowcat/mcp`가, 명령 자리에는 `rowcat-mcp`가 섭니다.

### 설치

나가 있는 것은 **`next` 채널의 프리릴리스**뿐입니다. `latest`(안정판)는 카나리아가 저장소
밖에서 검증된 뒤의 별도 결정이라 아직 없습니다. MCP 클라이언트는 **같은 명령을 반복해서
띄우므로** 권하는 것은 전역 설치입니다 — 클라이언트 설정에 `rowcat-mcp` 한 낱말만 적으면
됩니다.

```bash
npm install -g @rowcat/mcp@next
```

```bash
pnpm add -g @rowcat/mcp@next
```

한 번만 써 보려면 설치 없이도 됩니다(매번 패키지를 받아 오므로 시작이 느립니다).

```bash
npx @rowcat/mcp@next setup
```

```bash
pnpm dlx @rowcat/mcp@next setup
```

> `@next`는 **프리릴리스 채널**입니다. 첫 외부 판은 카나리아로 나가고 `latest`는 두지
> 않습니다 — 판을 올릴 때 무엇이 바뀌는지 알고 올려야 하는 단계입니다. 판을 박아
> (`@rowcat/mcp@0.1.0-alpha.1`) 받는 것은 재현이 필요할 때의 이야기이고, 평소에는
> dist-tag 쪽이 낡지 않습니다.

### 처음 한 번

```bash
rowcat-mcp setup
```

```text
RowCat MCP 설정

✓ 세나로 로그인했습니다.

페어링 코드:
  J7FK-W2MR-9QXP-4B1D

이미 연결된 RowCat 기기에서 열어 주세요:
  계정 → 데이터 → 새 기기 연결

승인을 기다리는 중…

✓ 기기가 승인되었습니다
✓ 동기화 키를 받아 확인했습니다
✓ RowCat MCP를 쓸 준비가 됐습니다.
```

| 명령 | 하는 일 |
| --- | --- |
| `setup` | **처음 한 번.** 로그인 → 페어링 → 준비 완료까지 순서를 끌고 간다 |
| `serve` | stdio MCP 서버(기본 명령). 에이전트가 이것을 띄운다 |
| `login` | 세션 쿠키만 다시 얻는다. **비밀번호는 저장하지 않는다** |
| `pair` | 이미 연결된 RowCat 기기에서 봉투 키를 받는다 |
| `unlock` | **승인할 기기가 없을 때** — 복구 코드로 연다. 코드는 서버로 가지 않는다 |
| `doctor` | 지금 무엇이 되고 무엇이 안 되는가 — 런타임·세션·초안 수까지 확인한다 |

`--help`와 `--version`도 있습니다. **이 도구의 사람 대상 출력은 전부 stderr로 갑니다** —
`serve`가 도는 동안 stdout은 JSON-RPC의 것이고, 예외를 하나 두면 다음 사람이 `serve`에도
같은 예외를 둡니다. `rowcat-mcp --version > 파일`이 빈 파일을 만드는 것은 그 규칙의 결과입니다.

`setup`은 **판정을 다시 적지 않습니다**(`planSetup` 하나가 갖고, 그 술어는 `serve`·`doctor`가
지나는 바로 그 소유권 판정입니다). 이미 이 계정의 키가 있으면 페어링을 **시작하지 않습니다.**

### 복구 코드는 어디로 갔나

없어지지 않았다. **정상 경로에서 빠졌을 뿐**이다.

```text
승인할 기기가 있다   pair    코드 하나를 옮겨 적으면 끝난다        ← 기본
승인할 기기가 없다   unlock  복구 코드를 직접 넣는다              ← 그때의 유일한 길
```

가르는 것은 사람이다 — 페어링 절차가 도중에 복구 코드를 묻지 않고, 실패했을 때 그 길이
있다는 사실만 말한다. 어느 길로 열었든 **같은 봉투 키**이므로 그 뒤의 모든 것은 출처를
모른다.

계정이 동기화를 한 번도 켠 적이 없으면 둘 다 답이 아니다(건네줄 열쇠도 복구할 열쇠도 없다).
그 실패만 갈래를 갈라 두었고, 그때는 복구 코드를 권하지 않는다.

### 설정 파일과 소유권

설정은 `~/.rowcat/mcp.json`(0600)에 저장된다. 환경변수 `ROWCAT_API_BASE_URL`·
`ROWCAT_SESSION_COOKIE`·`ROWCAT_SYNC_KEY`가 있으면 그쪽이 이긴다.

**봉투 키는 그것을 연 계정의 것이다.** 다른 계정으로 `login`하면 앞 계정의 키는 지워지고
`pair`를 다시 해야 한다(같은 계정으로 다시 로그인하는 경우에만 남는다). `serve`와 `doctor`는
열람자를 확정한 **뒤에** 그 키의 주인을 묻는다 — 파일에 키가 있다는 사실은 근거가 아니다.
주인이 적히지 않은 키(옛 설정)도 지금 계정의 것으로 가정하지 않는다. 환경변수로 넣을 때는
쿠키와 키를 **함께** 넣는다(둘이 한 계정의 짝이라는 선언이 그것뿐이다).

페어링에도 같은 규칙이 선다. 절차는 5분 살고 그 사이에 다른 터미널이 `login`을 부를 수 있어서,
**승인이 온 순간 `/me`를 다시 묻고** 파일에 쓰기 직전에 설정의 주인을 한 번 더 본다. 계정이
바뀌었으면 받은 열쇠를 **버린다** — 중단된 자리에서 이어 가지 않는다.

> ⚠️ 이 파일을 읽을 수 있는 사람은 그 계정의 초안을 열 수 있다. 파일 권한이 막는 것은 같은
> 기계의 다른 사용자이고 그 이상은 아니다 — 여럿이 쓰는 기계에서는 쓰지 않는다.

## 클라이언트 설정

**설정 파일에 자격증명을 적지 않습니다.** 아래 파일은 대개 저장소에 커밋되고, `setup`이 이미
비밀을 홈 디렉터리에 두었습니다.

### Claude Code

```bash
claude mcp add rowcat-runtime -- rowcat-mcp serve
```

또는 `.mcp.json`(프로젝트) · 사용자 설정에 직접:

```json
{
	"mcpServers": {
		"rowcat-runtime": {
			"command": "rowcat-mcp",
			"args": ["serve"]
		}
	}
}
```

### Codex

```bash
codex mcp add rowcat-runtime -- rowcat-mcp serve
```

또는 `~/.codex/config.toml`에:

```toml
[mcp_servers.rowcat-runtime]
command = "rowcat-mcp"
args = ["serve"]
```

### 전역 설치를 하지 않았다면

```json
{
	"mcpServers": {
		"rowcat-runtime": {
			"command": "npx",
			"args": ["-y", "@rowcat/mcp@next", "serve"]
		}
	}
}
```

돕니다만 **연결마다 패키지 해석이 한 번 더 일어납니다.** 클라이언트가 서버를 여러 번 띄우는
구조라 전역 설치 쪽이 눈에 띄게 빠릅니다. `pnpm dlx @rowcat/mcp@next serve`도 같은 자리에
섭니다.

### 배포 주소가 다르면

**기본 주소는 없습니다.** `setup`(또는 `login`)이 처음에 RowCat API 주소를 묻고
(`https://api.example.com/v2`처럼 `/v2`까지), 그 값을 설정 파일에 남깁니다. MCP 클라이언트
설정에서 정하려면 `env`에 `ROWCAT_API_BASE_URL`을 넣습니다(그 값은 비밀이 아닙니다). 주소가
없으면 `serve`·`doctor`는 그 사실을 stderr에 적고 나갑니다 — 어느 서버로든 짐작해 붙지
않습니다.

`serve`는 **사람과 대화하지 않습니다.** 연결이 끝나지 않은 상태로 뜨면 stderr에 할 일을 적고
나갑니다 — 이메일이나 페어링 코드를 여기서 물으면 그 프롬프트가 JSON-RPC 스트림 한가운데에
서고, 클라이언트에는 "응답하지 않는 서버"로 보입니다.

## 도구

이름에 점이 없다. 여러 클라이언트가 도구 이름을 `[A-Za-z0-9_-]`로 제한하고, 점 하나가 그
검증에 걸리면 **이 서버의 도구 전부가 그 클라이언트에서 사라진다.**

```text
runtime_list_projects · runtime_get_project
runtime_list_files · runtime_read_file
runtime_write_file · runtime_create_file · runtime_rename_file · runtime_delete_file
runtime_compile · runtime_get_diagnostics
runtime_search_docs · runtime_read_doc · runtime_get_api_reference · runtime_get_example
runtime_preview_start · runtime_preview_restart · runtime_preview_stop · runtime_preview_status
runtime_preview_get_tree · runtime_preview_press · runtime_preview_input · runtime_preview_submit
runtime_preview_get_console · runtime_preview_get_state
```

### 여기 **없는 도구**

```text
임의 SQL · 파일 시스템 · 셸 · HTTP 프록시 · eval · 아티팩트 주입 · 검증 건너뛰기
발행                       되돌릴 수 없고, 확인 절차는 이 채널의 것이 아니다
런타임 켜기·끄기            제작자의 결정이다
초안 본문·로어·시작 장면 편집  런타임이 켜진 초안에서 그 넷은 잠긴다
대화·개인정보·결제           이 기기는 그 도메인의 코덱을 등록하지 않는다 — 담지도 올리지도 않는다
```

마지막 줄이 코드의 사실이다. `device/device.ts`가 등록하는 코덱은 저작 넷뿐이고, 나머지
타입은 동기화 엔진이 `ignored`로 넘긴다.

## 에이전트가 도는 한 바퀴

```text
runtime_list_projects → runtime_read_file → runtime_search_docs
  → runtime_write_file → runtime_compile
  → runtime_preview_start → runtime_preview_get_tree
  → runtime_preview_press · runtime_preview_input → runtime_preview_get_tree
  → runtime_preview_get_console · runtime_preview_get_state
  → runtime_write_file → runtime_preview_restart → 확인 → runtime_preview_stop
```

이 순환이 실제로 닫히는지는 `packages/runtime-mcp/src/agent-scenario.test.ts`가 **진짜
컴파일러와 진짜 QuickJS로** 돌려 확인한다(브라우저 자동화가 없다).

## 한도

| 축 | 값 | 왜 |
| --- | --- | --- |
| 미리보기 세션 | 연결당 1 | 세션 하나가 WASM 인스턴스 하나다 |
| 유휴 정리 | 10분 | **예약된 타이머**가 정리한다 — 도구 호출이 없어도 사라진다 |
| 콘솔 버퍼 | 500줄 | 넘치면 앞에서 버리고 몇 줄 버렸는지 말한다 |
| 트리 응답 | 400노드 · 깊이 32 | 넘치면 자르고 **잘렸다고 말한다** |
| 응답 크기 | 512KiB | 넘치면 자르고 더 좁은 인자를 권한다 |

수명을 늘리는 것은 세션을 **쓰는** 조작이다(시작·정지, 트리, 누르기·글 넣기·제출, 콘솔·저장
상태). `runtime_preview_status`는 관찰이라 늘리지 않는다 — 폴링만으로 잊고 놓아둔 VM이 살아
있으면 이 상한이 막으려던 상태가 그대로 남는다.

파일 수·경로 길이·내용 길이는 여기 없다 — 그건 `@rowcat/authoring`의 프로젝트 상한이고,
사본을 두면 MCP로 만든 파일과 스튜디오로 만든 파일이 다른 규칙을 받는다.

## 안 될 때

| 증상 | 무엇이 일어난 것인가 |
| --- | --- |
| `rowcat-mcp: command not found` | 전역 설치의 `bin` 디렉터리가 `PATH`에 없다. `npm bin -g`(또는 `pnpm bin -g`)가 말하는 경로를 `PATH`에 넣거나, 클라이언트 설정을 `npx @rowcat/mcp@next` 쪽으로 바꾼다 |
| `Unsupported engine` · 문법 오류로 즉사 | Node가 22.12보다 낮다. `node -v` |
| `doctor`가 `런타임 ✗` | **설치가 온전하지 않다** — QuickJS의 WASM이나 컴파일러의 `lib.*.d.ts`를 찾지 못했다. 다시 설치한다 |
| `doctor`가 `로그인 ✗` | `rowcat-mcp setup` |
| `doctor`가 `동기화 키 ✗` | `rowcat-mcp pair`(승인할 기기가 없으면 `unlock`) |
| 페어링 코드가 만료됐다 | 5분이다. `rowcat-mcp pair`를 다시 실행하면 새 코드가 난다 |
| 클라이언트가 "서버가 응답하지 않는다" | `rowcat-mcp serve`를 터미널에서 직접 돌려 본다 — 연결되지 않은 상태면 할 일을 stderr에 적고 나간다 |
| 도구가 하나도 안 보인다 | 클라이언트가 서버를 띄우지 못한 것이다. `command`가 `rowcat-mcp`로 해석되는지(위 첫 줄) 확인한다 |

`doctor`가 이 표의 절반을 대신합니다 — 막히면 그것부터 돌립니다.

```bash
rowcat-mcp doctor
```

## 보안 모델 한 문단

RowCat의 런타임 초안은 **종단 간 암호화**되어 있고 서버는 그것을 열지 못합니다. 그래서 이
도구는 원격 서비스가 아니라 **당신의 기계에서 도는 또 하나의 RowCat 기기**입니다. 페어링은
이미 신뢰된 기기에서 동기화 키를 건네받는 절차이고, 그 키와 세션 쿠키는 `~/.rowcat/mcp.json`
(0600)에 남습니다. 그 파일을 읽을 수 있는 사람은 이 계정의 초안을 열 수 있습니다 — 파일
권한이 막는 것은 같은 기계의 다른 사용자이고, 그 이상은 아닙니다. **여럿이 쓰는 기계에서는
쓰지 않습니다.**

**이 문단이 설치한 사람이 알아야 할 전부입니다.** 더 자세한 근거는 이 패키지의 소스가
있는 RowCat 저장소의 설계 문서에 있습니다 — 아래 [라이선스와 문의](#라이선스와-문의).

## 아직 없는 것

- **원격 MCP.** 위의 이유로 서버가 초안을 열 수 없다. 열려면 페어링 기반의 원격 기기가
  필요하고 그건 별개의 슬라이스다.
- **브라우저 인증 인계.** `setup`이 브라우저를 열고 계정 화면에서 이 도구를 승인하는 흐름.
  지금 인증은 여전히 이메일·비밀번호다.
- **단일 실행 파일·Homebrew·Scoop·Docker.** 배포 경로는 npm 패키지 하나로 간다.
- **레코드의 영속.** 시작할 때마다 다시 내려받는다. 계정이 커지면 SQLite 어댑터를 둔다 —
  포트(`SyncStore`)가 그것을 위해 있다.
- **관리 이미지 업로드·발행·런타임 켜기.** 전부 제품 화면의 조작이다.

## 라이선스와 문의

RowCat MCP는 **GNU Affero General Public License v3.0**(`AGPL-3.0-only`)으로 배포되는 자유
소프트웨어입니다. 조건은 패키지에 함께 들어 있는 [`LICENSE`](./LICENSE) 파일이 전부이고,
아래는 그 요약입니다 — **요약이 원문을 대신하지 않습니다.**

```text
할 수 있는 것   어떤 목적으로든 실행하고 · 들여다보고 · 고치고 · 다시 배포한다
다시 배포할 때  같은 라이선스로, 대응하는 소스와 함께 낸다
                저작권·라이선스 표시를 지우지 않는다
고친 판을       네트워크 너머의 사용자가 쓰게 하면 그 사용자에게도 소스를 내놓는다(제13조)
보증            없다(제15조·제16조)
```

**당신이 만든 것은 당신의 것입니다.** 이 라이선스가 다루는 것은 이 소프트웨어 자체이고,
이 도구로 쓰고 고치고 주고받은 것 — 런타임 소스, 프로젝트 파일, 에셋, 프롬프트 — 의
소유권을 주장하지 않습니다.

**소스는 RowCat 저장소에 공개되어 있습니다.** 이 패키지는 그 저장소의 `apps/mcp`를 빌드한
것이고, 번들에는 같은 저장소의 다른 패키지들이 접혀 있습니다. 그중 크리에이터 런타임
쪽(`@rowcat/runtime` · `runtime-compiler` · `runtime-host` · `runtime-ai-docs` ·
`contracts`)은 같은 저작권자가 저장소에서 Apache License 2.0으로도 내놓은 것입니다 — 그
패키지들을 따로 쓰려면 저장소의 그 판을 가져가면 됩니다. 물을 것이 있으면 그 저장소의
이슈로 오시면 됩니다.

**함께 설치되는 서드파티 패키지는 각자의 라이선스를 따릅니다.** 이 번들에는 서드파티
코드가 들어 있지 않습니다(의존은 패키지 관리자가 따로 받아 옵니다). 그래서 이 라이선스는
그 패키지들의 조건을 바꾸지도, 덮어쓰지도 않습니다.

이 도구가 붙는 RowCat 배포의 이용 자체는 **그 배포가 게시한** 이용약관과
개인정보처리방침이 따로 정합니다 — 이 패키지는 어느 한 배포의 클라이언트가 아닙니다.
