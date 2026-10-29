import type { Messages } from "../../types.ts";

export const chat: Messages["chat"] = {
	characters: {
		summary: {
			none: "이 대화에 등장할 인물 추가",
			added: "{{added}}명 추가함",
			story: "작품이 정한 {{fromStory}}명",
			both: "작품 {{fromStory}}명 · {{added}}명 추가함",
		},
		limit: "인물은 {{limit}}명까지 더할 수 있습니다.",
		edit: "{{name}} 편집",
		delete: "{{name}} 삭제",
		promptPlaceholder:
			"외모, 성격, 말투, {{user}}와의 관계처럼 이 인물에 대해 알려주고 싶은 것을 자유롭게 적으세요.",
		seedCount:
			"작품이 정한 인물 {{count}}명은 이 목록과 별개로 계속 등장합니다.",
		theseCharactersAppearOnlyIn:
			"이 대화에만 등장하는 인물입니다. 다른 대화나 원본 작품에는 영향을 주지 않습니다.",
		couldnTSaveTheCharacter: "인물을 저장하지 못했습니다. 다시 시도해 주세요.",
		ifLeftEmptyOnlyThe: "비워 두면 이름만 등장인물 목록에 들어갑니다.",
		noCharactersAddedYet: "아직 더한 인물이 없습니다.",
		addCharacter: "인물 추가",
		name: "이름",
		description: "설명",
		add: "추가",
	},
	userNote: {
		summary: {
			none: "이 대화의 진행 방식을 직접 지정",
			written: "{{count}}자 적음",
		},
		saveFailed: "유저 노트를 저장하지 못했습니다. 다시 시도해 주세요.",
		tooLong: "유저 노트는 {{max}}자까지 쓸 수 있습니다.",
		description:
			"이 대화의 진행 방식에 대해 모델에게 전할 요청을 적습니다. 매 응답마다 함께 전달되며, 다른 대화에는 영향을 주지 않습니다.",
		placeholder:
			"예) 묘사를 짧게 유지하고 대사 위주로 진행해 주세요. 장면이 바뀔 때는 한 줄 띄워 주세요.",
		savingItEmptyClearsThis:
			"비워 두고 저장하면 이 대화의 유저 노트가 지워집니다.",
		userNote: "유저 노트",
	},
	intensity: {
		notApplied: "{{label}} · 지금은 미적용",
		default: "기본",
		defaultDescription: "작품과 등급이 정한 그대로 씁니다.",
		label: {
			softened: "순화",
			intense: "강",
		},
		description: {
			softened:
				"성적인 장면과 잔혹한 묘사를 암시와 여운으로 처리합니다. 갈등·긴장·어두운 전개는 그대로입니다.",
			intense:
				"요청한 장면을 회피하거나 완곡하게 넘기지 않고 구체적으로 묘사합니다.",
		},
		allAgesNotice:
			"전체이용가 작품이라 «강»은 고를 수 없습니다. 이 등급에서도 갈등·전투·죽음 같은 어두운 전개는 그대로 다뤄집니다.",
		adultLockedNotice:
			"지금은 이 대화가 전체이용가로 진행돼 «강»이 적용되지 않습니다. 고른 값은 그대로 남아 있고, 성인 콘텐츠를 볼 수 있게 되면 다시 쓰입니다.",
		ratingNote: "표현 수위는 작품 등급이 허용하는 범위 안에서만 적용됩니다.",
		saveFailed: "표현 수위를 저장하지 못했습니다. 다시 시도해 주세요.",
		intensity: "표현 수위",
	},
	roomSettings: {
		back: "{{title}}으로 돌아가기",
		title: {
			home: "대화 설정",
			generation: "생성 설정",
			persona: "페르소나",
			narration: "서술 방식",
			intensity: "표현 수위",
			characters: "등장인물",
			userNote: "유저 노트",
			info: "대화 정보",
		},
	},
	narration: {
		scope: {
			strict: "내 인물은 나만",
			reactive: "기본",
			assisted: "대리 진행",
			auto: "오토플레이",
		},
		scopeDescription: {
			strict:
				"AI가 내 인물을 절대 대신 쓰지 않습니다. 내가 쓴 마지막 행동 이후부터 이어집니다.",
			reactive: "내가 쓴 행동 전체에 인물들이 반응합니다.",
			assisted: "AI가 내 인물의 행동과 대사도 이어서 씁니다.",
			auto: "생각과 감정까지 AI가 씁니다. 지켜보듯이 읽는 방식입니다.",
		},
		off: "사용 안 함",
		offDescription: "서술 지침을 넣지 않습니다. 지금과 같습니다.",
		density: {
			light: "간결",
			rich: "진하게",
		},
		densityDescription: {
			light: "문체를 가볍게 다듬습니다.",
			rich: "묘사를 촘촘하게 씁니다. 프롬프트가 길어져 요청마다 토큰을 더 씁니다.",
		},
		lockedHint: "켜면 묘사 밀도와 인물 카드를 여기서 고를 수 있습니다.",
		cast: "인물 카드",
		castDescription:
			"응답 아래에 인물들의 상태를 정리한 카드를 함께 붙입니다. 등장인물이 많은 이야기에 도움이 되고, 프롬프트가 길어져 요청마다 토큰을 더 씁니다.",
		unsupported:
			"지금 이 대화가 쓰는 모델에는 서술 지침이 적용되지 않습니다. 고른 값은 그대로 남아 있고, 적용되는 모델로 바꾸면 다시 쓰입니다.",
		catalogUnknown:
			"모델 목록을 불러오지 못해 지금 적용되는지 확인할 수 없습니다.",
		densityFolded: "이 모델에는 한 가지 밀도만 있어 그것으로 적용됩니다.",
		saveFailed: "서술 방식을 저장하지 못했습니다. 다시 시도해 주세요.",
		singleDensity: "이 모델에는 «{{label}}» 한 가지 밀도만 있습니다.",
		notApplied: "{{label}} · 이 모델에는 미적용",
		credit: {
			heading: "출처 및 라이선스 고지",
			line1: "원저작자: 작호 (치지직 방송인)",
			line2: "제공 형태: 원저작자의 허가 및 라이선스 제공",
			line3: "활용 범위: RowCat의 이야기 진행 및 대화 생성 관련 기능",
			body: "RowCat에 포함된 '고슴도치' 프로젝트 기반 구성 요소는 원저작자 작호님으로부터 정식으로 라이선스를 제공받아 이식되었습니다. 해당 구성 요소에 대한 권리는 원저작자에게 있으며, RowCat은 제공받은 라이선스의 범위 내에서 이를 활용합니다.",
			thanks: "귀중한 성과물을 공유해 주신 작호님께 깊이 감사드립니다.",
		},
		narrationScope: "서술 범위",
		descriptionDensity: "묘사 밀도",
	},
	persona: {
		edit: "{{title}} 페르소나 수정",
		thisConversationSPersona: "이 대화의 페르소나",
		saveAndApply: "저장하고 적용",
		managePersonas: "페르소나 관리",
		createAndApply: "만들고 적용",
		newPersona: "새 페르소나",
	},
	generation: {
		connect: "AI 설정에서 {{provider}} 연결하기",
		defaultsNote:
			"이 대화에서 따로 지정하지 않은 항목은 <link>기본 AI 설정</link>을 따릅니다. 여기서 고른 값은 이 기기에만 적용됩니다.",
		howDeeplyToThinkBefore:
			"이 대화에서 답변 전에 얼마나 깊게 생각할지 정합니다.",
		couldnTSaveTheSettings: "설정을 저장하지 못했습니다. 다시 시도해 주세요.",
		howLongTheRepliesIn: "이 대화에서 받을 응답의 분량입니다.",
		theModelThatGeneratesThis: "이 대화를 생성할 모델입니다.",
		defaults: "기본 설정",
	},
	info: {
		recentCount: "최근 응답 {{count}}개입니다.",
		unreported:
			" 그중 {{count}}개는 사용량을 알 수 없어 합계에 세지 않았습니다.",
		input: "입력",
		cachedInput: "캐시 입력",
		output: "출력",
		theCreatorProtectedThisStory:
			"제작자가 보호한 작품이라 창작 프롬프트는 표시되지 않습니다.",
		thisConversationDidnTStart: "작품에서 시작하지 않은 대화입니다.",
		thisConversationStartedFromAn: "성인향 작품에서 시작된 대화입니다.",
		viewTheOriginalStory: "원본 작품 보기",
		usageNotReported: "사용량 미보고",
		cutAtTheLimit: "상한에서 잘림",
		recentUsage: "최근 사용량",
		unknownModel: "모델 미상",
		prompt: "프롬프트",
		startedFrom: "시작",
		rating: "등급",
		interrupted: "끊김",
	},
	home: {
		notAvailableOnThisDevice: "이 기기에서 사용할 수 없음",
		manageWhatThisConversationRemembers: "이 대화가 기억할 내용 관리",
		originalStoryAndConversationDetails: "원본 작품 및 대화 속성",
		generationSettings: "생성 설정",
		narration: "서술 방식",
		intensity: "표현 수위",
		userNote: "유저 노트",
		conversationInfo: "대화 정보",
		rename: "이름 변경",
		deleteConversation: "대화 삭제",
		persona: "페르소나",
		characters: "등장인물",
		generation: "생성",
		conversation: "대화",
		memory: "기억",
		manage: "관리",
	},
	memory: {
		rejection: {
			empty: "기억할 내용을 입력해 주세요.",
			too_long: "기억은 {{max}}자까지 쓸 수 있습니다.",
		},
		limit:
			"기억은 대화당 {{max}}개까지 저장할 수 있습니다. 필요 없는 기억을 지워 주세요.",
		full: "기억이 대화당 상한({{max}}개)에 도달했습니다. 새로 추가하려면 기존 기억을 지워 주세요.",
		unpin: "{{label}} 기억 고정 해제",
		pin: "{{label}} 기억 고정",
		edit: "{{label}} 기억 수정",
		delete: "{{label}} 기억 삭제",
		saveFailed: "기억을 저장하지 못했습니다. 다시 시도해 주세요.",
		deleteFailed: "기억을 삭제하지 못했습니다. 다시 시도해 주세요.",
		roomGone: "이 대화가 더 이상 없어 기억을 저장할 수 없습니다.",
	},
	rename: {
		rejection: {
			empty: "대화 이름을 입력해 주세요.",
			too_long: "이름은 {{max}}자까지 쓸 수 있습니다.",
		},
		failed: "이름을 변경하지 못했습니다. 다시 시도해 주세요.",
		deleteFailed: "대화를 삭제하지 못했습니다. 다시 시도해 주세요.",
	},
	roomActions: {
		label: "{{title}} 대화 관리",
		action: {
			rename: "이름 변경",
			settings: "대화 설정",
			delete: "대화 삭제",
		},
	},
	messageActions: {
		deleteOne: "이 메시지가 삭제됩니다.",
		deleteMany: "이 메시지와 이후 대화 {{later}}개가 삭제됩니다.",
		regenerateWarning:
			"이 답변부터 다시 생성하면 이후 대화 {{later}}개가 삭제됩니다.",
		synced: "동기화가 설정되어 있다면 다음 동기화 후 다른 기기에도 반영됩니다.",
		editUser: "이 기기에 저장된 내 메시지를 고칩니다. {{synced}}",
		editAssistant:
			"이 기기에 저장된 답변의 글을 고칩니다. 답을 다시 만들지는 않습니다. {{synced}}",
		editWarning: "저장하면 이 메시지 이후의 대화 {{later}}개가 삭제됩니다.",
		empty: "메시지를 입력해 주세요.",
		editFailed: "메시지를 수정하지 못했습니다. 다시 시도해 주세요.",
		deleteFromFailed: "대화를 삭제하지 못했습니다. 다시 시도해 주세요.",
		regenerateFailed: "다시 생성하지 못했습니다. 다시 시도해 주세요.",
	},
	summary: {
		response: "{{model}} · 응답 {{length}}",
		reasoning: "추론 {{effort}}",
	},
	search: {
		me: "나",
		other: "상대",
		count: "{{count}}개 메시지",
	},
	deleteDialog: {
		description:
			"<title>{{title}}</title>과(와) 저장된 메시지·기억이 이 기기에서 삭제됩니다. 동기화가 설정되어 있다면 다음 동기화 후 다른 기기에도 삭제가 반영됩니다.",
		deleteThisConversation: "대화를 삭제할까요?",
		deleting: "삭제 중…",
	},
	suggestion: {
		malformed: "추천 문장을 만들지 못했습니다.",
	},
	trackingPanel: {
		cast: "인물 카드",
	},
	chatHeaderContext: {
		findInConversation: "대화에서 찾기",
		conversationSettings: "대화 설정",
		conversation: "대화",
	},
	dialog: {
		savedMemoriesAreSentAlong:
			"저장된 기억은 이 대화의 응답을 만들 때 함께 전달됩니다. 기억이 많으면 고정한 기억이 먼저 전달됩니다.",
		youCanAddInformationYou:
			"대화에서 계속 기억해 두고 싶은 정보를 직접 추가할 수 있습니다.",
		noMemoriesSavedYet: "아직 저장된 기억이 없습니다.",
		loadingMemories: "기억을 불러오는 중입니다…",
		deleteThisMemory: "이 기억을 삭제할까요?",
		rememberedByAi: "AI가 기억함",
		whatToRemember: "기억할 내용",
		savedMemories: "저장된 기억",
		addMemory: "기억 추가",
		pinMemory: "기억 고정",
		memoryContent: "기억 내용",
		savedByYou: "직접 저장",
		saving: "저장 중…",
		pinned: "고정됨",
		memory: "기억",
		add: "추가",
		other: "기타",
		searchesTheMessagesStoredIn:
			"이 대화에 저장된 메시지에서 찾습니다. 검색은 이 기기 안에서만 이루어집니다.",
		enterWhatToFindIn: "대화에서 찾을 내용을 입력하세요.",
		readingTheConversation: "대화를 읽는 중입니다.",
		noResults: "검색 결과가 없습니다.",
		findInConversation: "대화에서 찾기",
		searchTerms: "검색어 입력",
		showMore: "더 보기",
	},
	chatShell: {
		conversations: "← 대화 목록",
	},
	panel: {
		suggestedRepliesPickingOneFills: "답변 추천 · 고르면 입력창에 채워집니다",
		noReplyWasReceived: "응답을 받지 못했습니다",
		choosingASuggestion: "추천을 고르는 중",
		closeSuggestedReplies: "답변 추천 닫기",
		suggestedReplies: "답변 추천",
	},
	chatPage: {
		thisConversationIsnTIn:
			"이 기기의 현재 계정에 없는 대화입니다. 다른 계정으로 시작한 대화라면 그 계정으로 로그인해 주세요.",
		theConversationStartsWhenYou: "첫 메시지를 보내면 대화가 시작됩니다.",
		scrollingDownAlsoContinuesGenerating:
			"아래로 스크롤해도 이어서 생성됩니다.",
		theReplyWasCutOff: "응답이 길이 제한으로 끊겼습니다.",
		theReplyWasCutOff2: "응답이 중간에 끊겼습니다.",
		conversationNotFound: "대화를 찾을 수 없습니다",
		backToConversations: "대화 목록으로",
		discoverStories: "작품 발견하기",
		continueGenerating: "이어서 생성",
	},
	composer: {
		loadingTheConversation: "대화를 불러오는 중입니다",
		typeAMessage: "메시지를 입력하세요",
		insertActionMarker: "행동 표시 넣기",
		message: "메시지 입력",
		stopGenerating: "생성 중지",
		send: "보내기",
	},
	renameDialog: {
		theNameOfTheConversation:
			"이 기기에 저장된 대화의 이름입니다. 동기화가 설정되어 있다면 다음 동기화 후 다른 기기에도 반영됩니다.",
		rename: "이름 변경",
		conversationName: "대화 이름",
	},
	recentChats: {
		noConversations: "대화가 없습니다",
	},
	list: {
		generatingAReply: "응답을 생성하는 중입니다",
		loadEarlierMessages: "이전 대화 불러오기",
		jumpToLatest: "최신 메시지로",
	},
	editDialog: {
		editMessage: "메시지 수정",
		messageContent: "메시지 내용",
	},
	useActions: {
		regenerateFromThisReply: "이 답변부터 다시 생성할까요?",
		thisReplyIsGeneratedAgain: "이 답변을 다시 생성합니다.",
		deleteFromHere: "여기부터 삭제할까요?",
		regenerate: "다시 생성",
		cleaningUp: "정리 중…",
		aiReply: "AI 응답",
	},
	actionBar: {
		regenerateFromThisReply: "이 답변부터 다시 생성",
		myMessageMenu: "내 메시지 메뉴",
		reportThisReply: "이 답변 신고",
		deleteFromHere: "여기부터 삭제",
		editMessage: "메시지 수정",
		replyMenu: "답변 메뉴",
		regenerate: "다시 생성",
		report: "신고",
	},
	row: {
		theReplyWasCutOff: "응답이 중간에 끊겼습니다",
	},
	saving: "저장 중…",
	deleting: "삭제 중…",
	conversation: "대화",
};
