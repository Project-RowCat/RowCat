import type { Messages } from "../../types.ts";

export const playtest: Messages["playtest"] = {
	copy: {
		disclosure:
			"테스트를 실행하면 지금 초안의 설정과 이 대화의 내용이 선택한 AI 제공자에게 전송됩니다. 테스트 대화는 저장되지 않고, 대화 목록에도 남지 않습니다.",
		ephemeral:
			"이 대화는 이 화면에서만 유지됩니다. 새로고침하거나 화면을 떠나면 사라집니다.",
		emptyConversation:
			"메시지를 보내 이 초안이 어떻게 반응하는지 확인해 보세요.",
		emptyPrompt:
			"작품 설정이 비어 있습니다. 이대로도 테스트할 수 있지만, 모델이 참고할 내용이 없습니다.",
		reloadFailure:
			"최신 초안을 읽지 못했습니다. 지금 테스트는 그대로 유지됩니다.",
		runtimeNote:
			"이 초안의 런타임 코드를 격리된 VM에서 돌립니다. 여기서 쌓인 진행은 이 화면에서만 유지되고, 새로고침하거나 화면을 떠나면 사라집니다.",
		runtimeEmpty:
			"아직 런타임 파일이 없습니다. 코드를 작성하면 여기서 돌려 볼 수 있습니다.",
		runtimeStudioLink: "런타임 스튜디오 열기",
		runtimeRun: "실행",
		runtimeRestart: "테스트 다시 시작",
		resetConfirm: {
			title: "테스트를 초기화할까요?",
			description:
				"지금까지 주고받은 테스트 대화가 사라집니다. 초안과 선택한 조건(시작 장면·모델·응답 길이)은 그대로입니다.",
			confirmLabel: "초기화",
		},
		reloadConfirm: {
			title: "최신 초안으로 새 테스트를 시작할까요?",
			description:
				"지금까지 주고받은 테스트 대화가 사라지고, 저장된 최신 초안으로 다시 시작합니다. 초안은 변경되지 않습니다.",
			confirmLabel: "새 테스트",
		},
		sceneConfirm: {
			title: "다른 시작 장면으로 바꿀까요?",
			description:
				"지금까지 주고받은 테스트 대화가 사라지고 고른 장면으로 다시 시작합니다. 초안의 기본 도입부 설정은 변경되지 않습니다.",
			confirmLabel: "바꾸기",
		},
	},
	unavailable: {
		conversation: {
			state: {
				title: "이 테스트에는 런타임 상태가 없습니다",
				body: "useStoryState·usePersistentState는 런타임을 켠 초안에서만 섭니다. 대화 작품의 상태는 대화 그 자체이고, 그 내용은 Prompt 칸의 히스토리에 있습니다.",
			},
		},
		runtime: {
			prompt: {
				title: "런타임 작품은 대화 프롬프트를 조립하지 않습니다",
				body: "재생이 방을 세우지 않으므로 프롬프트·로어·시작 장면이 실릴 자리가 없습니다. 코드가 useGeneration()으로 만드는 요청은 Timeline 칸에 사건으로 남습니다.",
			},
			lore: {
				title: "런타임 작품에는 로어가 실리지 않습니다",
				body: "로어는 키워드에 걸려 프롬프트에 주입되는 값이라, 조립되는 프롬프트가 없는 작품에는 들어갈 자리가 없습니다.",
			},
			generation: {
				title: "이 갈래의 생성은 코드가 부릅니다",
				body: "모델·대상·응답 길이는 재생 표면의 생성 설정이 정하고, 요청 하나하나는 Timeline 칸에 남습니다 — 이 칸이 그리는 대화 턴은 여기에 없습니다.",
			},
		},
	},
	debug: {
		block: {
			"absolute-guard": "절대 금지",
			"rating-guard": "등급 가드",
			"minor-guard": "미성년 인물 가드",
			"house-rules": "운영 규칙",
			"lore-system-top": "로어 (상단)",
			"roleplay-rules": "진행 규칙",
			"narration-pack": "서술 팩",
			"gm-preamble": "진행자 선언",
			scenario: "세계관 / 상황",
			characters: "등장인물",
			persona: "유저 (상대역)",
			"play-guide": "진행 지침",
			"lore-system-bottom": "로어 (하단)",
			"lore-before-history": "로어 (생성 직전)",
			summary: "요약",
			memory: "기억",
			"user-note": "유저 노트",
			intensity: "표현 수위",
			"tail-guard": "꼬리 가드",
		},
		status: {
			running: "진행 중",
			committed: "저장됨",
			discarded: "저장되지 않음",
			failed: "실패",
			stopped: "중지됨",
		},
		discard: {
			ownership:
				"이 대화가 더 이상 활성이 아니었습니다(초기화·장면 전환·최신 초안·계정 전환).",
			empty: "저장할 본문이 없었습니다(빈 응답이거나 추적 블록만 남았습니다).",
			precondition:
				"이어쓰기의 전제가 무너졌습니다(그 사이 대화가 이어졌습니다).",
		},
		noPrompt: {
			title: "이 턴은 프롬프트를 조립하지 않았습니다",
			body: "입력이 저장되지 않았거나, 대상이 막혀 요청 전에 끝난 턴입니다. Timeline 칸이 어디서 멈췄는지 적고 있습니다.",
		},
		noTurn: {
			title: "아직 생성한 턴이 없습니다",
			body: "메시지를 하나 보내면 그 턴의 프롬프트·로어 판정·실행 정보가 여기 섭니다. 이 기록은 메모리에만 있고 화면을 떠나면 사라집니다.",
		},
		noEvent: {
			title: "아직 기록된 사건이 없습니다",
			body: "테스트를 시작하면 입력·조립·요청·응답·확정이 여기 순서대로 남습니다.",
		},
		source: {
			creator: "작품",
			viewer: "이 대화",
			narration: "서술 팩",
		},
		reason: {
			constant: "상시",
			"key-match": "키 일치",
			"no-key-match": "키가 걸리지 않음",
			"no-keys": "키가 없음 (영원히 걸리지 않는다)",
			"empty-content": "본문이 비어 있음",
		},
		position: {
			system_top: "상단",
			system_bottom: "하단",
			before_history: "생성 직전",
		},
		blocks: "블록 {{count}}개 · {{chars}}자",
		messages: "{{count}}줄 · 히스토리 창 {{window}}",
		matchedKey: "걸린 키: {{key}}",
		chars: "{{count}}자",
		injectedOrder: "주입 순서 {{n}}",
		matchedOf: "{{count}}개 중 {{active}}개가 걸렸다",
		managed: "{{app}} 관리형",
		tokens: "{{count}} 토큰",
		stateCount: "{{count}}개",
		dropped:
			"상한 때문에 오래된 사건 {{count}}개를 버렸습니다. 아래는 최근 것부터입니다.",
	},
	inspector: {
		connect: "AI 설정에서 {{provider}} 연결하기",
	},
	summary: {
		defaultScene: "기본 도입부",
		untitledScene: "이름 없는 도입부",
		model: "모델",
		responseLength: "응답 길이",
		reasoning: "추론 정도",
		startScene: "시작 장면",
	},
	startButton: {
		failure: {
			autosave:
				"방금 편집한 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			storage: "초안을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
			unknown: "테스트를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		},
	},
	runtimePlaytest: {
		storyTest: "작품 테스트",
		closeDebugger: "디버거 닫기",
		debugger: "디버거",
	},
	playtestShell: {
		storyTest: "작품 테스트",
	},
	playtestPage: {
		ifYouMadeItIn:
			"다른 계정에서 만든 초안이라면 그 계정으로 로그인해 주세요. 초안은 기기에 계정별로 저장됩니다.",
		thisDraftIsnTIn: "이 계정에 없는 초안입니다.",
		openThisReplySDebug: "이 응답의 디버그 기록 열기",
		loadingTheDraft: "초안을 불러오는 중…",
		backToDrafts: "초안 목록으로",
	},
	playtestInspector: {
		anOpeningUsedOnlyIn:
			"이 테스트에서만 쓰는 도입부입니다. 초안의 기본 도입부 설정은 바뀌지 않습니다.",
		aModelUsedOnlyIn:
			"이 테스트에서만 쓰는 모델입니다. 기본 설정은 바뀌지 않습니다.",
		appliesOnlyInThisTest: "이 테스트에서만 적용됩니다.",
		newTestWithTheLatest: "최신 초안으로 새 테스트",
		draftSDefaultOpening: "초안의 기본 도입부",
		resetTest: "테스트 초기화",
		testConditions: "테스트 조건",
		openingScene: "시작 장면",
		model: "모델",
		session: "세션",
	},
	conversationTabs: {
		loreEntriesAreInjectedInto:
			"로어는 키워드에 걸리거나 상시일 때 프롬프트에 주입되는 항목입니다. 초안의 로어 구획에서 추가할 수 있습니다.",
		providerNeutralRequestCredentialsHave:
			"provider-neutral request (자격증명은 이 모양에 자리가 없다)",
		someTextWasCutBecause:
			"상한 때문에 일부 글이 잘렸습니다. 아래에 보이는 것이 전부가 아닙니다.",
		thisTurnNeverReachedA: "이 턴은 제공자 요청에 이르지 못했습니다.",
		theProviderDidnTReport: "제공자가 사용량을 알려주지 않았다",
		providerFinishReason: "제공자 finish reason",
		thisStoryHasNoLore: "이 작품에는 로어가 없습니다",
		rawTheAssembledRequest: "Raw — 조립된 요청",
		estimatedFromCharacterCount: "추정 · 문자 수 기반",
		whyItWasnTSaved: "저장되지 않은 이유",
		systemPrompt: "시스템 프롬프트",
		empty: "(비어 있음)",
		committedMessage: "확정된 메시지",
		readFromCache: "캐시에서 읽음",
		notIncluded: "실리지 않음",
		providerReported: "제공자 보고",
		scannedText: "스캔한 글",
		duration: "걸린 시간",
		endReason: "종료 사유",
		billingPath: "과금 경로",
		directConnection: "직접 연결",
		reasoningEffort: "추론 정도",
		responseLength: "응답 길이",
		outputCap: "출력 상한",
		ratingDecision: "등급 판정",
		allAges: "전체이용가",
		notApplied: "서지 않음",
		inputCharacters: "입력 문자",
		replyCharacters: "응답 문자",
		inputTokens: "입력 토큰",
		outputTokens: "출력 토큰",
		writtenToCache: "캐시에 씀",
		exceptionName: "예외 이름",
		noKeys: "키 없음",
		narrationPack: "서술 팩",
		messages: "메시지",
		provider: "제공자",
		applied: "적용됨",
		included: "실림",
		decision: "판정",
		status: "상태",
		start: "시작",
		execution: "실행",
		model: "모델",
		adult: "성인",
		size: "크기",
		failure: "실패",
		code: "코드",
		turn: "턴",
		end: "끝",
	},
	playtestToolbar: {
		notAvailableOnThisDevice: "이 기기에서 사용할 수 없음",
		backToEditing: "← 편집으로",
		testSettings: "테스트 설정",
		testing: "테스트 중",
		closeSettings: "설정 닫기",
		closeDebugger: "디버거 닫기",
		debugger: "디버거",
	},
	conversationDebugger: {
		theChosenTurnWasPushed: "고른 턴이 상한 밖으로 밀려 최신 턴을 그립니다.",
	},
	debugPrimitives: {
		providerReported: "제공자 보고",
		expand: "펼치기",
		estimated: "추정",
		collapse: "접기",
	},
	startPlaytestButton: {
		storyTest: "작품 테스트",
		opening: "여는 중…",
	},
	runtimeDebugger: {
		pressRunAndFromThe:
			"실행을 누르면 세션이 서는 순간부터 커밋·저장·진단·생성 요청이 여기 순서대로 남습니다.",
		noEventsRecordedYet: "아직 기록된 사건이 없습니다",
	},
	playtestDebugger: {
		testDebugger: "테스트 디버거",
		debuggerPanes: "디버거 칸",
	},
	stateTab: {
		onceHydrationFinishesItemsDefined:
			"하이드레이션이 끝나면 defineStoryState·definePersistentState로 정의된 항목이 여기 섭니다. 정의가 하나도 없는 작품은 계속 비어 있습니다.",
		pressRunAndThisSession:
			"실행을 누르면 이 세션의 플레이스루와 긴 진행이 여기 섭니다. 값은 커밋될 때마다 갱신되고, 커밋되지 않은 변경은 호스트가 관찰할 수 없습니다.",
		theValuesHereAreCommitted:
			"여기 있는 값은 **커밋된 것**입니다. 커밋 전의 변경은 VM 밖으로 나온 적이 없어 호스트가 관찰할 수 없고, 그래서 그리지 않습니다.",
		usepersistentstateItSurvivesResetPlay:
			"usePersistentState. 플레이 초기화를 **넘어 남습니다** — 이 목록을 비우는 것은 긴 진행 초기화뿐입니다.",
		thisStoryDoesnTDefine:
			"이 작품은 usePersistentState를 정의하지 않았습니다.",
		usestorystateResetPlayEmptiesThis:
			"useStoryState. 플레이 초기화가 이 목록을 비웁니다.",
		thisStoryDoesnTDefine2: "이 작품은 useStoryState를 정의하지 않았습니다.",
		persistentStateLongTermProgress: "Persistent state — 긴 진행",
		noSavedStateHasArrived: "아직 저장 상태가 도착하지 않았습니다",
		storyStateThisPlaythrough: "Story state — 이 회차",
		notRunning: "실행 중이 아닙니다",
		valueAtThePreviousCommit: "직전 커밋의 값",
		justChanged: "방금 바뀜",
		noneYet: "아직 없음",
		currentValue: "지금 값",
	},
};
