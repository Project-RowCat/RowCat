import type { Messages } from "../../types.ts";

export const create: Messages["create"] = {
	coverFile: {
		inputHint: "{{formats}} · 최대 {{max}}MB(GIF는 {{maxAnimated}}MB)",
		empty: "빈 파일입니다. 다른 이미지를 골라 주세요.",
		tooLarge:
			"표지는 최대 {{max}}MB(GIF는 {{maxAnimated}}MB)까지 올릴 수 있습니다. 더 작은 파일을 골라 주세요.",
		unsupported: "{{formats}} 파일만 올릴 수 있습니다.",
		restricted:
			"이용이 제한된 계정은 표지를 바꿀 수 없습니다. 계정 화면에서 제한 내용을 확인해 주세요.",
		generic: "표지를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
		invalidImage: "이미지를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.",
		tooManyFrames:
			"움직이는 표지는 {{max}}프레임까지 쓸 수 있습니다. 더 짧은 이미지를 골라 주세요.",
		dimensionsTooLarge:
			"해상도가 너무 큽니다. 한 변 {{side}}px, 전체 {{megapixels}}메가픽셀 이내로 줄여서 올려 주세요.",
		loginRequired: "로그인이 필요합니다.",
		notFound: "작품을 찾을 수 없습니다.",
	},
	manageDialog: {
		description:
			"<title>{{title}}</title>의 표지를 올리거나 지웁니다. 올릴 수 있는 형식과 크기는 {{hint}}입니다.",
		theCoverIsStillThere:
			"표지는 그대로 있지만 지금은 작품을 볼 수 없어 미리보기가 나오지 않습니다. 바꾸거나 지우는 것은 그대로 됩니다.",
		notUploadedYetTheCover:
			"아직 올리지 않았습니다. 올리기를 눌러야 표지가 바뀝니다.",
		deleteTheCoverTheStory: "표지를 삭제할까요? 작품은 그대로 남습니다.",
		thisIsTheStoryS: "지금 이 작품에 걸려 있는 표지입니다.",
		noCoverYet: "아직 표지가 없습니다.",
		selectedImage: "선택한 이미지",
		coverImage: "표지 이미지",
		uploading: "올리는 중…",
		uploadCover: "표지 올리기",
		manageCover: "표지 관리",
		deleting: "삭제 중…",
		deleteCover: "표지 삭제",
		replaceCover: "표지 교체",
	},
	coverField: {
		stagedHint: "{{hint}}. 발행할 때 함께 올라갑니다.",
	},
	field: {
		thisCoverIsUploadedWhen:
			"발행할 때 이 표지가 함께 올라갑니다. 그때까지는 이 기기에만 있습니다.",
		choosingAFileUpdatesThe: "고르면 바로 작품에 반영됩니다.",
		uploadingTheCover: "표지를 올리는 중입니다…",
		removeChosenCover: "고른 표지 지우기",
		pendingPublish: "발행 대기",
		cover: "표지",
	},
	visibility: {
		hint: {
			private: "나만 볼 수 있습니다. 나중에 언제든 공개로 바꿀 수 있습니다.",
			unlisted:
				"목록과 검색에는 표시되지 않으며 링크를 아는 사람만 이용할 수 있습니다. 링크를 받은 사람은 누구나 열 수 있습니다.",
			public: "발행하는 즉시 갤러리에 올라가고 누구나 볼 수 있습니다.",
		},
		button: {
			private: "비공개로 발행",
			unlisted: "링크 공개로 발행",
			public: "공개로 발행",
		},
	},
	lifecycle: {
		label: {
			publish: "공개",
			unlist: "링크 공개로 전환",
			unpublish: "비공개로 전환",
			archive: "보관",
			restore: "복원",
		},
		pending: {
			publish: "공개하는 중…",
			unlist: "전환하는 중…",
			unpublish: "전환하는 중…",
			archive: "보관하는 중…",
			restore: "복원하는 중…",
		},
		failed: {
			publish: "공개하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			unlist: "링크 공개로 전환하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			unpublish: "비공개로 전환하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			archive: "보관하지 못했습니다. 잠시 후 다시 시도해 주세요.",
			restore: "복원하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		},
		publish: {
			title: '"{{title}}"을(를) 공개할까요?',
			line1: "공개하면 갤러리에 올라가고 누구나 볼 수 있습니다.",
			line2: "심사 절차는 없습니다 — 누르는 즉시 공개됩니다.",
			line3: "언제든 다시 비공개로 바꿀 수 있습니다.",
			confirm: "공개",
		},
		unlist: {
			title: '"{{title}}"을(를) 링크 공개로 바꿀까요?',
			line1: "갤러리와 검색, 제작자 프로필에는 표시되지 않습니다.",
			line2:
				"링크를 아는 사람은 누구나 열고 대화를 시작할 수 있습니다 — 비밀번호도 만료도 없습니다.",
			line3: "언제든 다시 공개하거나 비공개로 바꿀 수 있습니다.",
			confirm: "링크 공개",
		},
		archive: {
			title: '"{{title}}"을(를) 보관할까요?',
			line1:
				"작품은 삭제되지 않습니다. 표지와 지금까지의 조회수·즐겨찾기도 그대로 남습니다.",
			line2:
				"보관하면 갤러리와 작품 주소에서 사라지고, 새 댓글도 받지 않습니다.",
			line3:
				"나중에 비공개 상태로 복원할 수 있습니다. 복원이 다시 공개하지는 않습니다.",
			confirm: "보관",
		},
		error: {
			archived: "이미 보관된 작품입니다. 복원한 뒤에 다시 시도해 주세요.",
			notArchived: "보관된 작품이 아닙니다. 목록을 새로고침해 주세요.",
			adult: "성인향 작품은 성인인증을 마친 회원만 밖으로 내보낼 수 있습니다.",
			notFound: "작품을 찾을 수 없습니다.",
			cannotExpose: "지금은 작품을 내보낼 수 없습니다.",
			cannotAct: "지금은 이 조작을 할 수 없습니다.",
		},
	},
	publishPanel: {
		failure: {
			archived_unavailable:
				"보관 상태로는 발행할 수 없습니다. 발행한 뒤 보관할 수 있습니다.",
			story_archived:
				"보관된 작품입니다. 만들기 화면의 발행한 작품 목록에서 복원한 뒤 다시 발행해 주세요.",
			adult_not_permitted:
				"성인향 작품은 성인인증을 마친 회원만 발행할 수 있습니다.",
			origin_mismatch:
				"이 작품은 다른 기기의 초안에서 발행됐습니다. 그 초안에서 수정해 주세요.",
			scene_image_invalid:
				"상황 이미지를 찾을 수 없습니다. 상황 이미지 구획에서 그림을 다시 올려 주세요.",
			runtime_invalid:
				"런타임 코드를 발행하지 못했습니다. 스튜디오에서 문제를 확인해 주세요.",
			runtime_asset_invalid:
				"런타임 자산을 발행하지 못했습니다. 스튜디오의 자산 목록에서 이미지와 소리를 다시 올려 주세요.",
			restricted:
				"이용이 제한된 계정은 작품을 발행할 수 없습니다. 계정 화면에서 제한 내용을 확인해 주세요.",
			generic: "발행하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		},
		alreadyPublished:
			"이미 발행된 초안입니다. 다시 발행하면 <link>이 작품</link>이 지금 내용으로 갱신됩니다.",
		uploadsToTheServerYou:
			"서버에 올립니다. 노출 상태는 발행한 뒤에도 언제든 바꿀 수 있습니다.",
		someThingsNeedFixingBefore: "발행하기 전에 고쳐야 할 것이 있습니다",
		couldnTPublish: "발행하지 못했습니다",
		publishing: "발행하는 중…",
		visibility: "노출 상태",
		publishAgain: "다시 발행",
		manageCover: "표지 관리",
		runtime: "런타임",
		publish: "발행",
	},
	workCard: {
		updated: "{{at}} 갱신",
		manage: "{{title}} 관리",
		hiddenNote: "운영자가 숨긴 작품입니다. <link>이용 제한 확인</link>",
		theOriginalDraftIsnT: "원본 초안을 이 기기에서 찾을 수 없습니다.",
		protectedPrompt: "프롬프트 보호",
		hiddenByOperators: "운영 숨김",
		manageCover: "표지 관리",
		viewStory: "작품 보기",
		editDraft: "초안 편집",
		adult: "성인",
	},
	analyticsWorkList: {
		count: "작품 {{count}}개",
	},
	workList: {
		stale: "마지막 갱신에 실패해 이전에 받은 목록을 보여 주고 있습니다.",
		couldnTLoadMoreStories:
			"다음 작품을 불러오지 못했습니다. 다시 시도해 주세요.",
		performanceByStory: "작품별 성과",
		hiddenByOperators: "운영 숨김",
		showMore: "더 보기",
		story: "작품",
		finishADraftAndPublish:
			"초안을 완성한 뒤 발행하면 여기에 표시됩니다. 공개·비공개는 발행한 뒤에도 언제든 바꿀 수 있습니다.",
		yourPublishedStoriesReloadOnce:
			"연결되면 발행한 작품을 다시 불러옵니다. 초안은 이 기기에 그대로 있습니다.",
		couldnTLoadYourPublished: "발행한 작품을 불러오지 못했습니다.",
		yourDraftsStayOnThis: "초안은 이 기기에 그대로 있습니다.",
		youReNotConnectedRight: "지금은 연결되어 있지 않습니다.",
		loadingYourPublishedStories: "발행한 작품을 불러오는 중입니다",
		noPublishedStoriesYet: "아직 발행한 작품이 없습니다",
	},
	analytics: {
		metric: {
			views: "조회",
			playStarts: "플레이 시작",
			favorites: "즐겨찾기",
			comments: "댓글",
		},
		windowed: "{{label}} · {{window}}",
		updated: "{{at}} 갱신",
		captionAll:
			"발행한 작품 전체의 누적 조회·플레이 시작 수와 지금의 즐겨찾기·댓글 수입니다.",
		captionWindow:
			"조회와 플레이 시작은 {{window}} 동안의 수이고, 즐겨찾기·댓글은 지금의 수입니다. 누적 조회 {{views}} · 누적 플레이 시작 {{playStarts}}.",
		playStartConversionNote:
			"조회는 열람자와 날짜로 접고, 플레이 시작은 대화는 방마다·런타임 작품은 계정마다 셉니다. 그래서 이 비율은 100%를 넘을 수 있고, 재생 방식이 다른 작품끼리는 견줄 수 없습니다.",
	},
	overview: {
		playStartsPerView: "조회 대비 플레이 시작",
		overallPerformance: "전체 성과",
	},
	panel: {
		onceYouPublishAStory:
			"작품을 발행하면 조회, 즐겨찾기, 댓글 현황을 여기에서 볼 수 있습니다.",
		analyticsReloadOnceYouRe:
			"연결되면 분석을 다시 불러옵니다. 초안은 이 기기에 그대로 있습니다.",
		theLastRefreshFailedSo:
			"마지막 갱신에 실패해 이전에 받은 값을 보여 주고 있습니다.",
		yourDraftsAndPublishedStories: "초안과 발행한 작품은 그대로 있습니다.",
		couldnTLoadAnalytics: "분석 정보를 불러오지 못했습니다.",
		youReNotConnectedRight: "지금은 연결되어 있지 않습니다.",
		noStoriesToAnalyzeYet: "아직 분석할 작품이 없습니다",
		loadingAnalytics: "분석을 불러오는 중입니다",
		analyticsPeriod: "분석 기간",
		yourSignInExpiredSo:
			"로그인이 만료되어 받은 댓글을 불러올 수 없습니다. 초안은 이 기기에 그대로 있습니다.",
		whenOthersCommentOnOr:
			"발행한 작품에 다른 사람이 댓글이나 답글을 남기면 여기에 최근 순으로 모입니다.",
		receivedCommentsReloadOnceYou:
			"연결되면 받은 댓글을 다시 불러옵니다. 초안은 이 기기에 그대로 있습니다.",
		theLastRefreshFailedSo2:
			"마지막 갱신에 실패해 이전에 받은 댓글을 보여 주고 있습니다.",
		couldnTLoadMoreComments:
			"다음 댓글을 불러오지 못했습니다. 다시 시도해 주세요.",
		couldnTLoadReceivedComments: "받은 댓글을 불러오지 못했습니다.",
		loadingReceivedComments: "받은 댓글을 불러오는 중입니다",
		noCommentsReceivedYet: "아직 받은 댓글이 없습니다",
		youNeedToSignIn: "다시 로그인해야 합니다.",
		receivedComments: "받은 댓글",
		showMore: "더 보기",
		signIn: "로그인",
		report: "신고",
	},
	comments: {
		kind: {
			comment: "댓글",
			reply: "답글",
		},
		unreachable: {
			hidden: "운영 정책으로 숨겨진 작품",
			archived: "보관한 작품",
			private: "비공개 작품",
		},
		unnamed: "이름 없음",
		menu: "{{name}}의 {{kind}} 메뉴",
		untitled: "제목 없음",
	},
	nav: {
		drafts: "초안",
		published: "발행한 작품",
		analytics: "분석",
		comments: "댓글",
		label: "작업 공간",
	},
	drafts: {
		deleteNotice: "초안만 삭제됩니다. 이미 발행한 작품은 그대로 남습니다.",
	},
	failure: {
		structure: "변경 사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		create: "초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
		delete: "초안을 지우지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	list: {
		deleteDraft: "{{title}} 초안 삭제",
		modifiedSuffix: "수정",
		draftsAreSavedOnThis:
			"초안은 이 기기에 저장됩니다. 제목을 정하지 않아도, 발행하지 않아도 그대로 남습니다.",
		noDraftsYet: "아직 초안이 없습니다",
		createANewStory: "새 작품 만들기",
		published: "발행됨",
		unpublished: "미발행",
		story: "작품",
		status: "상태",
		modified: "수정",
	},
	createHomePage: {
		draftsAreSavedOnThis:
			"초안은 계정별로 이 기기에 저장됩니다. 다시 로그인하면 그대로 있습니다.",
		createCanTBeOpened: "만들기를 열 수 없습니다",
		creating: "만드는 중…",
		newStory: "새 작품",
		create: "만들기",
		signIn: "로그인",
	},
	createSkeleton: {
		theFullStorySetupThe: "모델이 매 턴 읽는 작품 설정 전체입니다.",
		loadingTheWorkspace: "작업 공간을 불러오는 중입니다",
		thisIsWhatShowsIn: "갤러리에 보이는 부분입니다.",
		loadingTheDraft: "초안을 불러오는 중입니다",
		basics: "기본 정보",
		prompt: "프롬프트",
	},
	useActions: {
		addLore: "로어 추가",
	},
	useAutosave: {
		couldnTSave: "저장하지 못했습니다",
	},
	leave: {
		title: "변경 사항을 아직 저장하지 못했습니다",
		description:
			"이 기기에 저장하지 못한 편집이 남아 있습니다. 이대로 나가면 그 내용은 사라집니다.",
		retryFailed:
			"다시 저장하지 못했습니다. 잠시 뒤 다시 시도하거나, 저장하지 않고 나갈 수 있습니다.",
		stay: "이 화면에 머무르기",
		retry: "다시 시도",
		retrying: "저장 중…",
		discard: "저장하지 않고 나가기",
	},
	promptExpand: {
		open: "전체 화면 편집",
		title: "전체 화면 편집",
		description:
			"같은 본문을 넓은 자리에서 고칩니다. 자동 저장은 그대로 돕니다.",
		close: "완료",
	},
	promptRuntimeLock: {
		title: "런타임이 켜진 작품은 이 프롬프트를 쓰지 않습니다.",
		body: "AI 요청은 런타임 코드 안에서 만들어집니다. 작성해 둔 프롬프트는 그대로 보관되고, 런타임을 끄면 다시 편집할 수 있습니다.",
	},
	lorePosition: {
		system_top: "시스템 프롬프트 앞",
		system_bottom: "시스템 프롬프트 뒤",
		before_history: "대화 기록 앞",
	},
	loreSection: {
		title: "로어",
		description:
			"키워드가 대화에 나오면 프롬프트에 끼워 넣는 설정. '항상 포함'을 켜면 언제나 실립니다.",
	},
	loreRuntimeLock: {
		title: "런타임이 켜진 작품은 로어를 쓰지 않습니다.",
		body: "로어는 대화 프롬프트에 끼워 넣는 설정인데, 런타임 작품의 AI 요청은 런타임 코드 안에서 만들어집니다. 적어 둔 로어는 그대로 보관되고, 런타임을 끄면 다시 편집할 수 있습니다.",
	},
	sceneImageSection: {
		title: "상황 이미지",
		description:
			"대화 중에 장면을 그림으로 보여 줍니다. 응답에 트리거가 나오면 그림이 붙고, 본문에 [img:트리거]를 직접 적어도 됩니다.",
	},
	sceneImageRuntimeLock: {
		title: "런타임이 켜진 작품은 상황 이미지를 쓰지 않습니다.",
		body: "상황 이미지는 대화 응답에 붙는 그림인데, 런타임 작품은 대화방을 열지 않습니다. 화면에 그림을 그리는 일은 런타임 코드가 합니다. 올려 둔 그림은 그대로 보관되고, 런타임을 끄면 다시 편집할 수 있습니다.",
	},
	startSceneSection: {
		title: "시작 장면",
		description:
			"대화가 시작될 때의 도입부. 기본으로 고른 장면이 발행에 실립니다.",
	},
	startSceneRuntimeLock: {
		title: "런타임이 켜진 작품은 시작 장면을 쓰지 않습니다.",
		body: "런타임 작품은 대화방을 열지 않아 도입부가 실릴 자리가 없습니다. 첫 화면은 런타임 코드가 그립니다. 적어 둔 장면은 그대로 보관되고, 런타임을 끄면 다시 편집할 수 있습니다.",
	},
	lore: {
		noKeywords: "키워드 없음",
		alwaysInclude: "항상 포함",
		priority: "우선순위 {{order}}",
		nth: "{{n}}번째",
		manage: "{{n}}번째 로어 관리",
	},
	startScene: {
		nth: "{{n}}번째 장면",
		manage: "{{n}}번째 장면 관리",
		untitled: "제목 없는 장면",
	},
	runtimePending: "런타임 설정을 확인하는 중…",
	sceneImage: {
		inputHint: "{{formats}} · 최대 {{max}}MB",
		empty: "빈 파일입니다. 다른 이미지를 골라 주세요.",
		tooLarge:
			"상황 이미지는 최대 {{max}}MB까지 올릴 수 있습니다. 더 작은 파일을 골라 주세요.",
		unsupported: "{{formats}} 파일만 올릴 수 있습니다.",
		generic: "상황 이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.",
		invalidImage: "이미지를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.",
		invalidDimensions: "이미지 크기가 너무 큽니다. 해상도를 줄여 주세요.",
		storageFailed: "이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		triggerHint:
			"응답에 '{{trigger}}'가 나오면 이 그림이 붙습니다. 본문에 {{token}}를 직접 적어도 됩니다.",
		deleteNamed: "'{{trigger}}' 상황 이미지 삭제",
		deleteNth: "{{n}}번째 상황 이미지 삭제",
		empty_list: "아직 상황 이미지가 없습니다. {{hint}}",
	},
	tagInput: {
		remove: "{{tag}} 태그 제거",
		noMoreTagsCanBe: "태그를 더 넣을 수 없습니다",
		typeAndPressEnter: "입력 후 Enter",
		tags: "태그",
	},
	fields: {
		overflow: "{{count}}자를 줄여야 발행할 수 있습니다.",
	},
	page: {
		orientationUnset: "미지정",
		ifYouMadeItIn:
			"다른 계정에서 만든 초안이라면 그 계정으로 로그인해 주세요. 초안은 기기에 계정별로 저장됩니다.",
		withoutAdultVerificationThisCan:
			"성인인증이 없어 이대로는 발행할 수 없습니다. 표시를 끄면 발행할 수 있습니다.",
		onlyMembersWhoCompletedAdult:
			"성인인증을 마친 회원만 성인향으로 표시할 수 있습니다. 서버가 최종 판정합니다.",
		thisTextIsSentAs:
			"이 본문이 작품 설정으로 그대로 실립니다. 로어와 시작 장면은 따로 실립니다.",
		writeTheWorldCharactersCounterpart:
			"세계관, 등장인물, 상대역, 진행 규칙을 원하는 형식으로 한 번에 적습니다.",
		marksTheCreativePromptAs:
			"창작 프롬프트를 화면에 노출하지 않는다는 표시입니다. 암호화가 아닙니다.",
		onlyMembersWhoCompletedAdult2:
			"성인인증을 마친 회원만 발행할 수 있습니다. 서버가 최종 판정합니다.",
		theFullStorySetupThe: "모델이 매 턴 읽는 작품 설정 전체입니다.",
		sentAlongWhenAConversation: "대화를 시작할 때 함께 실립니다.",
		thisDraftIsnTIn: "이 계정에 없는 초안입니다.",
		thisIsWhatShowsIn: "갤러리에 보이는 부분입니다.",
		thisIsWhatShowsIn2: "갤러리에 보이는 부분입니다",
		backToDrafts: "초안 목록으로",
		protectPrompt: "프롬프트 보호",
		theNightLibrary: "밤의 도서관",
		oneLineIntro: "한 줄 소개",
		drafts: "초안 목록",
		basics: "기본 정보",
		prompt: "프롬프트",
		published: "발행됨",
		adult: "성인향",
		title: "제목",
		description: "설명",
		orientation: "성향",
	},
	autosave: {
		idle: "",
		pending: "저장 대기 중…",
		saving: "저장 중…",
		saved: "저장됨",
		error: "저장하지 못했습니다",
	},
	previewSection: {
		drawnWithACoverThat:
			"아직 올리지 않은 표지로 그렸습니다. 발행할 때 이 표지가 함께 올라갑니다.",
		thisIsHowItAppears: "발행하면 갤러리 목록에 이렇게 걸립니다.",
		enterATitleToSee: "제목을 입력하면 카드에 함께 보입니다.",
		preview: "미리보기",
	},
	headerContext: {
		draft: "초안",
	},
	promptField: {
		storySetup: "작품 설정",
	},
	sceneImageList: {
		enterTheWordThatCalls:
			"이 그림을 부를 낱말을 적어 주세요. 비어 있으면 발행에 실리지 않습니다.",
		theSameTriggerAlreadyExists:
			"같은 트리거가 위에 이미 있습니다. 대화에는 위의 그림만 나타납니다.",
		darkHallway: "어두운 복도",
		addImage: "이미지 추가",
		trigger: "트리거",
	},
	startSceneList: {
		noOpeningScenesYetYou:
			"아직 시작 장면이 없습니다. 없이도 발행할 수 있지만, 도입부가 있으면 대화의 문체와 시점이 훨씬 안정적입니다.",
		add: "추가",
	},
	loreList: {
		noLoreYetYouCan: "아직 로어가 없습니다. 로어 없이도 발행할 수 있습니다.",
	},
	loreEditorCard: {
		separateWithCommasCaseDoesn:
			"쉼표로 구분합니다. 대소문자는 구분하지 않습니다.",
		whenOnItSSent: "켜면 키워드와 상관없이 매 턴 실립니다.",
		withinTheSamePositionHigher: "같은 위치 안에서 클수록 먼저 실립니다.",
		libraryLibrarian: "도서관, 사서",
		deleteLore: "로어 삭제",
		alwaysInclude: "항상 포함",
		insertionPosition: "주입 위치",
		priority: "우선순위",
		down: "아래로",
		keywords: "키워드",
		up: "위로",
		content: "내용",
	},
	startSceneEditorCard: {
		setAsDefaultOpening: "기본 도입부로 지정",
		theLibraryAtDawn: "새벽의 도서관",
		defaultOpening: "기본 도입부",
		deleteScene: "장면 삭제",
		sceneTitle: "장면 제목",
		down: "아래로",
		up: "위로",
		body: "본문",
	},
	recovery: {
		notice:
			"다른 기기에서 같은 부분을 동시에 수정해, 반영되지 못한 편집을 따로 보관했습니다.",
		open: "확인",
		title: "보관된 편집",
		description:
			"같은 부분을 두 기기에서 동시에 고치면 한쪽 내용만 남습니다. 남지 못한 쪽을 여기에 보관해 두었습니다.",
		empty: "보관된 편집이 없습니다.",
		orphaned:
			"이 편집이 속한 초안이 더 이상 없습니다. 내용은 그대로 볼 수 있지만 되돌릴 곳이 없습니다.",
		restore: "이 내용으로 되돌리기",
		discard: "보관 내용 삭제",
		cancel: "취소",
		discardConfirm:
			"보관된 내용을 영구히 삭제합니다. 지금 초안은 바뀌지 않습니다.",
		restoreFailed: "되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.",
		discardFailed: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		restoreMissing: "이 편집이 속한 초안이 더 이상 없어 되돌릴 수 없습니다.",
		preservedColumn: "보관된 내용",
		currentColumn: "지금 내용",
		emptyValue: "(비어 있음)",
		summaryLabel: "복구 가능한 편집",
		restoreConfirm:
			"지금 저장된 「{{group}}」 내용이 보관된 내용으로 바뀝니다. 다른 부분은 그대로 남습니다.",
		orientationUnset: "미지정",
		defaultSceneUnset: "지정 안 함",
		on: "켬",
		off: "끔",
		group: {
			meta: "기본 정보",
			rating: "공개 설정",
			body: "프롬프트",
			defaults: "기본 시작 장면",
		},
		field: {
			title: "제목",
			tagline: "한 줄 소개",
			description: "설명",
			tags: "태그",
			orientation: "성향",
			adult: "성인향",
			visibility: "공개 범위",
			promptProtected: "프롬프트 보호",
			prompt: "프롬프트",
			defaultStartSceneId: "기본 시작 장면",
		},
	},
};
