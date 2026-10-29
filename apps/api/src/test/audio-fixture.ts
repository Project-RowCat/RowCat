/**
 * Builds test audio bytes in code instead of committing binary fixtures: every field is visible and
 * the test sets the exact values the parser reads ("42 frames" is an argument, not a comment). Only
 * the container is built and audio data is zero-filled; our parser reads headers only, and real
 * encoded sound would tie tests to an encoder's choices.
 */

/**
 * Length of one MPEG1 Layer3 / 44100Hz / 128kbps / mono frame: `floor(144 * 128000 / 44100)` =
 * 417. It must match what the frame header claims so the next frame lands in place; the parser
 *      confirms sync by finding another header there.
 */
export const MP3_FRAME_BYTES = 417;
/** Duration of one frame: `1152 / 44100` seconds. */
export const MP3_FRAME_MS = (1152 / 44100) * 1000;

const MP3_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0xc0]);

export interface Mp3Options {
	frames?: number;
	/** Prepends an ID3v2 tag; exercises syncsafe size reading. */
	id3?: number;
	/** Plants a Xing header (VBR frame count) in the first frame. */
	xingFrames?: number;
	/** Appends an ID3v1 tag (128 bytes). */
	id3v1?: boolean;
}

export function buildMp3(options: Mp3Options = {}): Buffer {
	const frames = options.frames ?? 100;
	const parts: Buffer[] = [];

	if (options.id3 !== undefined) {
		const size = options.id3;
		const header = Buffer.alloc(10);
		header.write("ID3", 0, "latin1");
		header[3] = 4;
		// Syncsafe: 7 bits per byte.
		header[6] = (size >> 21) & 0x7f;
		header[7] = (size >> 14) & 0x7f;
		header[8] = (size >> 7) & 0x7f;
		header[9] = size & 0x7f;
		parts.push(header, Buffer.alloc(size));
	}

	for (let index = 0; index < frames; index++) {
		const frame = Buffer.alloc(MP3_FRAME_BYTES);
		MP3_HEADER.copy(frame, 0);
		if (index === 0 && options.xingFrames !== undefined) {
			// Side info is 17 bytes for mono MPEG1.
			const at = 4 + 17;
			frame.write("Xing", at, "latin1");
			frame.writeUInt32BE(0x01, at + 4); // frames flag
			frame.writeUInt32BE(options.xingFrames, at + 8);
		}
		parts.push(frame);
	}

	if (options.id3v1) {
		const tag = Buffer.alloc(128);
		tag.write("TAG", 0, "latin1");
		parts.push(tag);
	}

	return Buffer.concat(parts);
}

const box = (type: string, payload: Buffer): Buffer => {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(payload.byteLength + 8, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, payload]);
};

const hdlr = (handler: string): Buffer => {
	const payload = Buffer.alloc(25);
	payload.write(handler, 8, "latin1");
	return box("hdlr", payload);
};

const mvhd = (timescale: number, duration: number): Buffer => {
	const payload = Buffer.alloc(100);
	payload.writeUInt32BE(timescale, 12);
	payload.writeUInt32BE(duration, 16);
	return box("mvhd", payload);
};

export interface Mp4Options {
	timescale?: number;
	duration?: number;
	brand?: string;
	/** Adds a video track; input that must be rejected. */
	video?: boolean;
	/** Drops the audio track; must read as corrupt. */
	silent?: boolean;
}

export function buildM4a(options: Mp4Options = {}): Buffer {
	const timescale = options.timescale ?? 44100;
	const duration = options.duration ?? 44100 * 30;

	const ftyp = box(
		"ftyp",
		Buffer.concat([
			Buffer.from(options.brand ?? "M4A ", "latin1"),
			Buffer.alloc(4),
			Buffer.from("M4A mp42", "latin1"),
		]),
	);

	const tracks: Buffer[] = [];
	if (!options.silent) tracks.push(box("trak", box("mdia", hdlr("soun"))));
	if (options.video) tracks.push(box("trak", box("mdia", hdlr("vide"))));

	const moov = box(
		"moov",
		Buffer.concat([mvhd(timescale, duration), ...tracks]),
	);
	/** Where the real audio bytes sit; the parser skips it. */
	const mdat = box("mdat", Buffer.alloc(1024));
	return Buffer.concat([ftyp, moov, mdat]);
}
