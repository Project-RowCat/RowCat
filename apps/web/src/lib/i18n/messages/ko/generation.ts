import type { Messages } from "../../types.ts";

export const generation: Messages["generation"] = {
	providerError: {
		invalid_credential: "API 키를 확인해 주세요.",
		rate_limited:
			"제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
		quota_exceeded:
			"제공자 계정의 사용 한도를 초과했습니다. 제공자 계정을 확인해 주세요.",
		model_unavailable:
			"이 계정에서 사용할 수 없는 모델입니다. 다른 모델을 선택해 주세요.",
		network: "제공자에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
		content_blocked:
			"제공자의 콘텐츠 정책이 이 응답을 막았습니다. 장면을 바꾸거나 다른 모델을 선택해 주세요.",
		browser_blocked:
			"브라우저에서 제공자에 직접 연결하지 못했습니다. 확장 프로그램이나 네트워크 정책이 요청을 막고 있을 수 있습니다.",
		provider_error: "제공자가 요청을 처리하지 못했습니다.",
	},
	blocked: {
		managedOnly:
			"이 작품은 프롬프트를 보호하고 있어 {{app}} 제공 모델로만 대화할 수 있습니다. 대화 설정에서 {{app}} 제공 모델을 선택해 주세요.",
		byoNotPermitted:
			"만 14세 미만 회원은 개인 API 키({{provider}})로 대화를 생성할 수 없습니다. 대화 설정에서 {{app}} 제공 모델을 선택해 주세요.",
		providerNotConnected:
			"이 대화에서 선택한 AI 제공자({{provider}})가 이 기기에 연결되어 있지 않습니다.",
		modelUnavailable:
			"선택한 모델을 더 이상 사용할 수 없습니다. 다른 모델을 선택해 주세요.",
	},
	responseLength: {
		label: "응답 길이",
		short: "짧게",
		standard: "표준",
		long: "길게",
	},
	reasoning: {
		label: "추론 정도",
		description: "답변 전에 얼마나 깊게 생각할지 정합니다.",
		minimal: "최소",
		low: "낮게",
		medium: "표준",
		high: "높게",
	},
	inherit: "기본 설정 사용 ({{value}})",
	target: {
		label: "생성 대상",
		provider: "제공자",
		model: "모델",
		catalogFailed: "모델 목록을 불러오지 못했습니다.",
		loading: "불러오는 중…",
		byoNotPermitted: " · 만 14세 미만 이용 불가",
		providerNotConnected: " · 먼저 제공자 연결",
		missingFromCatalog: " · 목록에 없음",
		managedOnly:
			"이 작품은 {{app}} 제공 모델로만 대화할 수 있습니다. 제공자에서 {{app}}을 선택해 주세요.",
		byoNotPermittedMessage:
			"만 14세 미만 회원은 개인 API 키({{provider}})를 사용할 수 없습니다. 제공자에서 {{app}}을 선택해 주세요.",
		providerNotConnectedMessage:
			"현재 이 기기에서 사용할 수 없음 · {{provider}} 연결이 필요합니다.",
		missingMessage: "이 모델은 현재 목록에서 사용할 수 없습니다.",
	},
};
