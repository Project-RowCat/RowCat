import type { Messages } from "../../types.ts";

export const deviceApproval: Messages["deviceApproval"] = {
	title: "RowCat MCP 연결",
	checking: "요청을 확인하는 중…",
	review: {
		lead: "어느 컴퓨터의 RowCat MCP가 이 계정으로 로그인하려고 합니다.",
		codeLabel: "터미널에 보이는 코드와 같은지 확인해 주세요.",
		grants:
			"승인하면 그 컴퓨터가 이 계정으로 로그인합니다. 로그인한 내가 RowCat에서 할 수 있는 일을 그 도구도 할 수 있습니다.",
		drafts:
			"초안은 암호화된 채로 남습니다. 동기화 열쇠는 연결된 기기에서, 또는 복구 코드로 따로 건네집니다.",
		disconnect:
			"나중에 연결을 끊으려면 계정 → 보안 → 활성 세션에서 로그아웃시키면 됩니다.",
		warning:
			"방금 직접 rowcat-mcp setup을 실행했을 때만 승인하세요. 누군가 이 링크를 보내왔다면 거절하세요.",
		approve: "승인",
		approving: "승인하는 중…",
		deny: "거절",
		denying: "거절하는 중…",
	},
	approved: {
		title: "승인했습니다",
		body: "터미널로 돌아가세요. 몇 초 안에 RowCat MCP가 로그인을 마칩니다.",
	},
	denied: {
		title: "거절했습니다",
		body: "아무것도 로그인되지 않았습니다. 이 페이지를 닫아도 됩니다.",
	},
	answered:
		"이미 답한 요청입니다. 다시 연결하려면 터미널에서 rowcat-mcp setup을 실행해 주세요.",
	otherAccount:
		"다른 계정이 이 요청을 먼저 열었습니다. rowcat-mcp setup을 다시 실행하고, 연결할 계정으로 로그인한 상태에서 새 링크를 열어 주세요.",
	invalid:
		"알 수 없거나 만료된 코드입니다. 터미널에서 rowcat-mcp setup을 다시 실행하면 새 코드가 나옵니다.",
	recentLogin: {
		body: "보안을 위해 승인하려면 최근 로그인이 필요합니다. 다시 로그인하면 같은 코드로 이 페이지에 돌아옵니다.",
		action: "로그아웃하고 다시 로그인",
		working: "로그아웃하는 중…",
	},
	failed: {
		network:
			"RowCat에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
		rateLimited: "시도가 너무 많습니다. 몇 분 뒤에 다시 시도해 주세요.",
		unknown: "문제가 생겼습니다. 다시 시도해 주세요.",
		retry: "다시 시도",
	},
	enterCode: {
		body: "rowcat-mcp setup을 실행한 터미널에 보이는 코드를 입력해 주세요.",
		label: "코드",
		invalid: "터미널에 보이는 8자리 코드를 입력해 주세요.",
		continue: "계속",
	},
};
