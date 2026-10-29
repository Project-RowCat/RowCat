import {
	setMailTransport,
	type TransactionalMessage,
} from "../services/mail/index.ts";

/**
 * A transport that collects sent mail in an array so tests never touch the network. It only
 * captures and parses; what must go out and when stays in each test.
 */
export interface MailCapture {
	readonly messages: TransactionalMessage[];
	/** The last message sent to that address; throws when none, which beats a silent `undefined`. */
	lastTo(email: string): TransactionalMessage;
	/** First link in the plaintext body; verification mail links are always in plaintext too (`mail/types.ts`). */
	linkIn(message: TransactionalMessage): string;
	reset(): void;
	/** Restores resolution from configuration; call from `afterAll`. */
	restore(): void;
}

export function captureMail(): MailCapture {
	const messages: TransactionalMessage[] = [];
	setMailTransport({
		send: async (message) => {
			messages.push(message);
		},
	});

	return {
		messages,
		lastTo(email) {
			const found = messages.filter((message) => message.to === email).at(-1);
			if (!found) throw new Error(`no mail arrived: ${email}`);
			return found;
		},
		linkIn(message) {
			const link = message.text.match(/https?:\/\/\S+/)?.[0];
			if (!link) throw new Error("the body has no link");
			return link;
		},
		reset() {
			messages.length = 0;
		},
		restore() {
			setMailTransport(undefined);
		},
	};
}
