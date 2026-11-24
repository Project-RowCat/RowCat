import type { Messages } from "../../types.ts";

/**
 * The user's own chat tools: the settings library, its editor, tool files, and the room settings
 * view that turns them on per conversation (features/tools, features/chat/room-settings/tools.tsx).
 */
export const tools: Messages["tools"] = {
	page: {
		title: "도구",
		description:
			"대화 중에 모델이 호출할 수 있는 도구입니다. 도구 설명은 응답마다 함께 전달되므로, 쓰는 도구만 켜 두세요.",
	},
	library: {
		loading: "도구를 불러오는 중",
		unavailableTitle: "도구를 열 수 없습니다",
		unavailableBody:
			"도구는 이 기기에 계정별로 저장됩니다. 다시 로그인하면 그대로 있습니다.",
		signIn: "로그인",
		create: "새 도구",
		createFirst: "첫 도구 만들기",
		emptyTitle: "아직 도구가 없습니다",
		emptyBody:
			"도구는 모델이 응답 도중에 쓸 수 있는 기능입니다. 템플릿 채우기, 랜덤 표 뽑기, 서브 에이전트에게 묻기, 직접 운영하는 웹 주소 호출을 만들 수 있습니다.",
		manage: "{{name}} 도구 관리",
		edit: "편집",
		export: "내보내기",
		import: "가져오기",
		onByDefault: "모든 대화에서 사용",
		offByDefault: "대화에서 켜야 사용",
		reaches: "{{origin}}(으)로 전송",
	},
	kind: {
		label: {
			template: "템플릿",
			table: "랜덤 표",
			agent: "서브 에이전트",
			http: "웹 요청",
		},
		description: {
			template:
				"작성한 글의 {{placeholder}} 자리를 호출 인자로 채워 돌려줍니다.",
			table: "작성한 목록에서 무작위로 줄을 뽑습니다.",
			agent:
				"별도의 지시문으로 모델을 한 번 더 호출하고 그 답을 돌려줍니다. 대화 내용은 보지 못하고, 모델이 넘겨준 인자만 봅니다.",
			http: "직접 운영하는 웹 주소로 호출을 보내고, 응답 텍스트를 돌려줍니다.",
		},
	},
	parameterType: {
		string: "텍스트",
		number: "숫자",
		boolean: "예/아니요",
	},
	editor: {
		newTitle: "새 도구",
		editTitle: "도구 편집",
		description:
			"모델은 이름과 설명만 보고 도구를 쓸지 정합니다. 언제 쓰면 좋은지 적어 주세요.",
		name: "이름",
		nameHint:
			"영문 소문자, 숫자, 밑줄(_)만 쓸 수 있고 영문자로 시작해야 합니다. 모델은 이 이름으로 도구를 부릅니다.",
		toolDescription: "설명",
		toolDescriptionPlaceholder:
			"예) 주사위를 굴립니다. 장면에 운에 맡길 결과가 필요할 때마다 사용하세요.",
		parameters: "매개변수",
		parametersHint:
			"모델이 도구를 호출할 때 채우는 값입니다. 도구 하나에 {{max}}개까지 둘 수 있습니다.",
		noParameters: "매개변수가 없습니다. 모델은 도구를 그대로 호출합니다.",
		addParameter: "매개변수 추가",
		removeParameter: "{{name}} 매개변수 삭제",
		parameterName: "매개변수 이름",
		parameterType: "형식",
		parameterDescription: "모델에게 보여 줄 설명",
		parameterRequired: "필수",
		parameterChoices: "허용 값",
		parameterChoicesHint:
			"한 줄에 하나씩 적습니다. 비워 두면 어떤 텍스트든 받습니다.",
		kind: "동작",
		template: "템플릿",
		templateHint: "{{example}}처럼 쓰면 그 매개변수의 값으로 바뀝니다.",
		entries: "목록",
		entriesHint: "한 줄에 하나씩, {{max}}줄까지 적을 수 있습니다.",
		draws: "호출당 뽑는 줄 수",
		system: "서브 에이전트 지시문",
		systemPlaceholder:
			"예) 너는 깐깐한 편집자야. 받은 문장의 약점을 하나만 짚어 줘.",
		maxOutputTokens: "최대 답변 길이(토큰)",
		agentNote:
			"서브 에이전트는 호출한 대화와 같은 모델, 같은 연결로 실행되며 그 연결의 토큰을 사용합니다. 서브 에이전트는 다른 도구를 호출할 수 없습니다.",
		url: "주소",
		urlPlaceholder: "https://example.com/tool",
		method: "방식",
		methodHint: {
			GET: "인자를 쿼리 매개변수로 보냅니다.",
			POST: 'JSON으로 보냅니다: { "tool": 이름, "arguments": { … } }',
		},
		headers: "헤더",
		headersHint:
			"호출할 때마다 함께 보냅니다. Authorization 키 같은 값을 넣을 수 있습니다. 계정 데이터와 함께 암호화되어 저장되며, 내보낸 파일에는 담기지 않습니다.",
		addHeader: "헤더 추가",
		removeHeader: "{{name}} 헤더 삭제",
		headerName: "헤더 이름",
		headerValue: "값",
		httpWarning:
			"모델이 작성하는 인자는 대화 내용을 바탕으로 만들어지며, 호출할 때마다 이 주소로 전송됩니다. 믿을 수 있는 주소만 사용하세요.",
		httpCors:
			"호출은 이 브라우저에서 바로 나갑니다. 서버가 이 사이트의 교차 출처 요청(CORS)을 허용해야 합니다.",
		enabledByDefault: "모든 대화에서 사용",
		enabledByDefaultHint: "끄면 대화 설정 → 도구에서 대화별로 켤 수 있습니다.",
		save: "저장",
		create: "만들기",
		saving: "저장 중…",
		delete: "삭제",
		saveFailed: "도구를 저장하지 못했습니다. 다시 시도해 주세요.",
		fixIssues: "표시된 항목을 고쳐야 저장할 수 있습니다.",
	},
	issue: {
		name: "영문 소문자, 숫자, 밑줄(_)로 48자까지 쓰고, 영문자로 시작해야 합니다.",
		nameReserved: "기본 제공 도구의 이름입니다. 다른 이름을 골라 주세요.",
		nameTaken: "이미 같은 이름의 도구가 있습니다.",
		description: "설명을 {{max}}자 이내로 적어 주세요.",
		parameterNamesRepeat: "매개변수 이름은 겹칠 수 없습니다.",
		tooManyParameters: "매개변수는 {{max}}개까지 둘 수 있습니다.",
		parameterName:
			"매개변수 {{index}}: 영문 소문자, 숫자, 밑줄(_)만 쓰고 영문자로 시작해야 합니다.",
		parameterDescription: "매개변수 {{index}}: 설명은 {{max}}자까지입니다.",
		parameterChoices:
			"매개변수 {{index}}: 허용 값은 {{max}}개까지이며, 빈 값은 쓸 수 없습니다.",
		template: "템플릿을 {{max}}자 이내로 적어 주세요.",
		entries: "목록은 1~{{max}}줄, 한 줄에 {{chars}}자까지입니다.",
		draws: "1~{{max}}줄 사이로 정해 주세요.",
		system: "지시문을 {{max}}자 이내로 적어 주세요.",
		maxOutputTokens: "1~{{max}} 사이의 정수를 입력해 주세요.",
		url: "주소는 http:// 또는 https://로 시작해야 합니다.",
		tooManyHeaders: "헤더는 {{max}}개까지 둘 수 있습니다.",
		headerName: "헤더 {{index}}: 영문자, 숫자, 하이픈(-)만 쓸 수 있습니다.",
		headerValue: "헤더 {{index}}: 값은 {{max}}자까지입니다.",
		other: "도구 설정을 확인해 주세요: {{detail}}",
	},
	delete: {
		title: "이 도구를 삭제할까요?",
		body: "<name>{{name}}</name> 도구가 라이브러리와 모든 대화에서 사라집니다. 이미 작성된 응답은 그대로 남습니다.",
		deleting: "삭제 중…",
		failed: "도구를 삭제하지 못했습니다. 다시 시도해 주세요.",
	},
	exportDialog: {
		title: "도구 내보내기",
		description:
			"고른 도구를 다른 사람에게 건넬 수 있는 파일로 저장합니다. 어느 대화에서 켜 두었는지는 담기지 않습니다.",
		selectAll: "모두 선택",
		strippedHeaders:
			"헤더 값은 파일에 담기지 않습니다: {{list}}. 가져가는 사람이 직접 채워야 합니다.",
		download: "다운로드",
		nothingSelected: "도구를 하나 이상 골라 주세요.",
		failed: "파일을 만들지 못했습니다. 다시 시도해 주세요.",
	},
	importDialog: {
		title: "도구 가져오기",
		description:
			"가져온 도구는 모든 대화에서 꺼진 상태로 시작합니다. 하는 일을 확인한 뒤 여기서나 대화별로 켜 주세요.",
		choose: "파일 선택",
		reading: "파일을 읽는 중…",
		failure: {
			not_tool_file: "RowCat 도구 파일이 아닙니다.",
			newer_version:
				"더 새로운 버전의 RowCat에서 만든 파일입니다. 앱을 업데이트한 뒤 다시 시도해 주세요.",
			too_large: "도구 파일로 보기에는 너무 큽니다.",
			invalid: "손상된 도구 파일이라 읽을 수 없습니다.",
		},
		readFailed: "파일을 읽지 못했습니다. 다시 시도해 주세요.",
		status: {
			new: "새 도구",
			name_taken: "같은 이름의 도구가 이미 있습니다",
			duplicate_in_file: "파일 안에 같은 이름이 앞에 있어 건너뜁니다",
			invalid: "가져올 수 없습니다",
		},
		choice: {
			import: "가져오기",
			replace: "내 도구 덮어쓰기",
			skip: "건너뛰기",
		},
		choiceLabel: "{{name}} 처리 방법",
		unnamed: "이름 없는 도구",
		sendsTo: "{{origin}}(으)로 호출을 보냅니다",
		headersToFill: "가져온 뒤 채울 헤더: {{headers}}",
		apply_one: "도구 {{count}}개 가져오기",
		apply_other: "도구 {{count}}개 가져오기",
		applyNone: "가져올 도구가 없습니다",
		applying: "가져오는 중…",
		applyFailed:
			"일부 도구를 저장하지 못했습니다. 라이브러리를 확인한 뒤 다시 시도해 주세요.",
	},
	room: {
		summary: {
			none: "아직 만든 도구 없음",
			off: "사용 중인 도구 없음",
			on: "{{count}}개 사용 중",
		},
		description:
			"이 대화에서만 도구를 켜거나 끕니다. 여기서 바꾸지 않은 도구는 기본 설정을 따릅니다.",
		followsDefault: "기본 설정 따름",
		changedHere: "이 대화에서 변경함",
		reset: "기본값으로",
		resetLabel: "{{name}}을(를) 기본 설정으로 되돌리기",
		toggleLabel: "이 대화에서 {{name}} 사용",
		empty: "아직 만든 도구가 없습니다.",
		manage: "도구 관리",
		limit:
			"대화 하나에서 모델에게 줄 수 있는 도구는 기본 제공 도구와 작품 도구를 포함해 {{max}}개까지입니다. 넘치는 도구는 빠집니다.",
		saveFailed: "도구 설정을 바꾸지 못했습니다. 다시 시도해 주세요.",
	},
};
