/** Derived snapshots contain source text. Only authenticated AES-GCM ciphertext
 * reaches disk; the key comes from Electron's OS-backed safeStorage in main.
 * Temp files contain ciphertext too. A mutation invalidates the previous snapshot
 * before proceeding, so a crash cannot restore an acknowledged deletion. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";

export const MAX_SNAPSHOT_BYTES = 513 * 1024 * 1024;
const MAGIC = Buffer.from("rowcat-afterstate-encrypted/1\n");

export class AfterstateSnapshot {
	constructor(
		private readonly file: string,
		private readonly key: Buffer,
		private readonly identity: string,
	) {
		if (key.length !== 32) throw new Error("afterstate: invalid key");
		// An interrupted atomic write has no authority, even if it is decryptable.
		rmSync(`${file}.pending`, { force: true });
	}

	load(): Buffer | null {
		let fd: number | undefined;
		let plaintext: Buffer | undefined;
		try {
			const size = statSync(this.file).size;
			const headerSize = MAGIC.length + 28;
			if (size <= headerSize || size > MAX_SNAPSHOT_BYTES + headerSize)
				throw new Error("invalid snapshot size");
			fd = openSync(this.file, "r");
			const header = Buffer.alloc(headerSize);
			readAll(fd, header, 0);
			if (!header.subarray(0, MAGIC.length).equals(MAGIC))
				throw new Error("invalid snapshot");
			const decipher = createDecipheriv(
				"aes-256-gcm",
				this.key,
				header.subarray(MAGIC.length, MAGIC.length + 12),
			);
			decipher.setAAD(Buffer.from(this.identity));
			decipher.setAuthTag(header.subarray(MAGIC.length + 12));
			plaintext = Buffer.allocUnsafe(size - headerSize);
			const chunk = Buffer.allocUnsafe(256 * 1024);
			let offset = 0;
			while (offset < plaintext.length) {
				const length = Math.min(chunk.length, plaintext.length - offset);
				readAll(fd, chunk.subarray(0, length), headerSize + offset);
				decipher.update(chunk.subarray(0, length)).copy(plaintext, offset);
				offset += length;
			}
			decipher.final();
			return plaintext;
		} catch (error) {
			plaintext?.fill(0);
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			if (fd !== undefined) {
				closeSync(fd);
				fd = undefined;
			}
			this.invalidate();
			throw new Error("afterstate: corrupt snapshot");
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	}

	invalidate(): void {
		rmSync(this.file, { force: true });
		rmSync(`${this.file}.pending`, { force: true });
	}

	save(bytes: Uint8Array): void {
		if (bytes.byteLength > MAX_SNAPSHOT_BYTES)
			throw new Error("afterstate: snapshot too large");
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
		cipher.setAAD(Buffer.from(this.identity));
		const pending = `${this.file}.pending`;
		const fd = openSync(pending, "w", 0o600);
		try {
			// Reserve the authentication tag and stream ciphertext. Concatenating
			// entire images multiplied JS memory during large-history checkpoints.
			writeAll(fd, Buffer.concat([MAGIC, nonce, Buffer.alloc(16)]));
			for (let offset = 0; offset < bytes.length; offset += 256 * 1024)
				writeAll(
					fd,
					cipher.update(bytes.subarray(offset, offset + 256 * 1024)),
				);
			writeAll(fd, cipher.final());
			writeAll(fd, cipher.getAuthTag(), MAGIC.length + 12);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}

		renameSync(pending, this.file);
	}
}

function writeAll(fd: number, bytes: Uint8Array, position?: number): void {
	let offset = 0;
	while (offset < bytes.length) {
		const written = writeSync(
			fd,
			bytes,
			offset,
			bytes.length - offset,
			position === undefined ? undefined : position + offset,
		);
		if (written <= 0) throw new Error("afterstate: snapshot write failed");
		offset += written;
	}
}
function readAll(fd: number, bytes: Uint8Array, position: number): void {
	let offset = 0;
	while (offset < bytes.length) {
		const read = readSync(
			fd,
			bytes,
			offset,
			bytes.length - offset,
			position + offset,
		);
		if (read <= 0) throw new Error("afterstate: truncated snapshot");
		offset += read;
	}
}
