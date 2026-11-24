import {
	CHAT_ATTACHMENT_FILE_MAX_BYTES,
	type ChatAttachment,
	ChatAttachmentContentError,
	ChatAttachmentLimitError,
	type CreateAttachmentInput,
} from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_ACCEPT,
	type AttachmentSourceFile,
	attachFiles,
	readAttachmentFile,
} from "./attach-files.ts";

/** The browser half of attaching: reading a picked file, and attaching a batch one by one. */

const file = (
	name: string,
	bytes: Uint8Array | string,
	type = "",
): AttachmentSourceFile => {
	const data =
		typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	return {
		name,
		type,
		size: data.byteLength,
		arrayBuffer: async () => new Uint8Array(data).buffer,
	};
};

describe("reading a file", () => {
	it("decodes UTF-8 text", async () => {
		expect(await readAttachmentFile(file("a.md", "# 제목"))).toEqual({
			name: "a.md",
			content: "# 제목",
		});
	});

	it("refuses a non-text kind before reading", async () => {
		await expect(
			readAttachmentFile(file("a.png", "x", "image/png")),
		).rejects.toMatchObject({ reason: "unsupported" });
	});

	it("refuses a file too big to fit, by its size alone", async () => {
		const big: AttachmentSourceFile = {
			name: "big.txt",
			type: "text/plain",
			size: CHAT_ATTACHMENT_FILE_MAX_BYTES + 1,
			arrayBuffer: () => {
				throw new Error("must not be read");
			},
		};
		await expect(readAttachmentFile(big)).rejects.toMatchObject({
			reason: "too_long",
		});
	});

	it("decodes strictly: a non-UTF-8 file is refused, not filled with U+FFFD", async () => {
		// "한" in CP949.
		await expect(
			readAttachmentFile(file("old.txt", new Uint8Array([0xc7, 0xd1]))),
		).rejects.toBeInstanceOf(ChatAttachmentContentError);
	});

	it("the picker hint lists the extensions and text/*", () => {
		expect(ATTACHMENT_ACCEPT).toContain(".md");
		expect(ATTACHMENT_ACCEPT).toContain("text/*");
	});
});

describe("attaching a batch", () => {
	it("goes one by one and a refusal does not stop the rest", async () => {
		const written: CreateAttachmentInput[] = [];
		const store = {
			createAttachment: async (input: CreateAttachmentInput) => {
				if (input.name === "full.txt")
					throw new ChatAttachmentLimitError("count");
				written.push(input);
				return { ...input, id: input.name } as unknown as ChatAttachment;
			},
		};
		const result = await attachFiles(store, "room-1", [
			file("a.txt", "a"),
			file("b.png", "b", "image/png"),
			file("full.txt", "c"),
			file("d.md", "d"),
		]);
		expect(written.map((w) => w.name)).toEqual(["a.txt", "d.md"]);
		expect(result.attached).toHaveLength(2);
		expect(result.failures).toHaveLength(2);
		expect(result.failures[0]).toContain("b.png");
	});
});
