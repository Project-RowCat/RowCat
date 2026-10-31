import {
	MEDIA_ERROR_CODE,
	RUNTIME_AUDIO_LIMITS,
	type RuntimeAudioMime,
} from "@rowcat/contracts";
import { ApiError } from "../errors.ts";

/**
 * Validation boundary for audio bytes; a `media` row can only be created after passing here.
 *
 * ```text
 * bytes -> container check (signature + structure) -> { mime, durationMs } -> stored as-is
 *          extension and the request's Content-Type are never read
 * ```
 *
 * Unlike images (`image.ts`), audio is inspected but not re-encoded. Transcoding would turn the
 * store into a media-processing platform (ffmpeg binary, job queue, partial-failure states) for the
 * sole gain of one stored format, which buys nothing because web and native both play both formats.
 * `mime` stays truthful because only the value read from the container is written.
 *
 * Cost of that choice: original bytes are stored, so container metadata tags (ID3 artist, album,
 * lyrics; MP4 `©nam`) survive. They come from a file the creator chose and are not location data
 * like EXIF GPS, but the image side's "normalization strips metadata" promise does not hold here.
 *
 * Why a hand-written parser: pulling in a decoder to learn one duration would make that decoder the
 * process's least-trusted input reader. A few dozen header bytes is small enough to check every
 * bound by eye: every read checks length first, box traversal is capped in count and depth, and
 * there is no recursion beyond that depth cap. An external binary (ffprobe) is avoided because the
 * repository has no strategy for managing server binaries, and one would make a deployment's
 * feature set depend on whether it is installed.
 *
 * Not accepted: OGG, FLAC, WAV, Opus. Browser playability is not a reason to accept a format (same
 * call as SVG/AVIF for images), and each format widens this parser. WAV is uncompressed, so 10MiB
 * cannot hold a minute.
 *
 * MP4 with a video track is rejected too. `.m4a` and `.mp4` are the same container, so the
 * extension cannot tell them apart, and a video stored as `runtime_audio` would carry video under a
 * name that says sound. The track handler type decides.
 */

/** Audio that passed validation; the original bytes are what gets stored. */
export interface ValidatedAudio {
	readonly bytes: Buffer;
	/** Format read from the container, not what the request claimed. */
	readonly mime: RuntimeAudioMime;
	readonly durationMs: number;
}

function rejectFormat(): never {
	throw new ApiError(
		400,
		MEDIA_ERROR_CODE.unsupportedType,
		"Only MP3 or M4A files can be uploaded.",
	);
}

function rejectBroken(): never {
	throw new ApiError(
		400,
		MEDIA_ERROR_CODE.invalidAudio,
		"Couldn't read the sound file. Please check that the file isn't damaged.",
	);
}

/**
 * Order is the rule: signature, then structure, then duration cap. Bytes that fail the first two
 * are never asked for a duration (it would be absent or false). The three failures use different
 * codes because the screen says different things: pick another file, check the file for damage,
 * pick a shorter one.
 */
export function validateAudio(raw: Buffer): ValidatedAudio {
	if (raw.byteLength === 0)
		throw new ApiError(400, MEDIA_ERROR_CODE.empty, "Please choose a file.");

	// Re-checked although the route's `bodyLimit` already caps it: other callers (tests, seeds) would
	// otherwise let this parser scan an arbitrarily large buffer.
	if (raw.byteLength > RUNTIME_AUDIO_LIMITS.maxBytes)
		throw new ApiError(
			413,
			MEDIA_ERROR_CODE.tooLarge,
			`Sound files can be up to ${Math.floor(RUNTIME_AUDIO_LIMITS.maxBytes / (1024 * 1024))}MB.`,
		);

	const parsed = readMp4(raw) ?? readMp3(raw);
	if (parsed === null) rejectFormat();

	if (!Number.isFinite(parsed.durationMs) || parsed.durationMs <= 0)
		rejectBroken();

	const durationMs = Math.round(parsed.durationMs);
	if (durationMs > RUNTIME_AUDIO_LIMITS.maxDurationMs)
		throw new ApiError(
			400,
			MEDIA_ERROR_CODE.audioTooLong,
			`Sounds can be up to ${Math.floor(RUNTIME_AUDIO_LIMITS.maxDurationMs / 60000)} minutes long.`,
		);

	return { bytes: raw, mime: parsed.mime, durationMs };
}

interface ParsedAudio {
	readonly mime: RuntimeAudioMime;
	readonly durationMs: number;
}

/** Accepted brands. `qt  ` (QuickTime) is absent because it is a video container. */
const MP4_BRANDS = new Set(["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2"]);

/**
 * Caps box count (and depth below) so hostile nesting cannot hold the walker. Reaching either cap
 * **rejects the file**: stopping quietly and judging what was walked let a sound track, four
 * thousand filler boxes and then a video track pass as audio, because the walker never reached the
 * `vide` handler.
 *
 * The same rule covers a box whose size cannot be right (smaller than its header, past its parent,
 * a 64-bit size beyond this file's cap). The walker cannot find the next sibling after it, so
 * everything that follows went unseen; those exits once returned quietly too, and a sound track
 * followed by such a box holding a video track passed as audio. Any part of the file this walker did
 * not see is a reason to reject, never a reason to judge the rest.
 */
const MP4_MAX_BOXES = 4096;

/**
 * Duration comes from `mvhd` (whole-movie length); per-track `tkhd` values differ and choosing one
 * would be another rule. Tracks are still walked for their kind: at least one `hdlr` handler must
 * be sound (`soun`), and any video (`vide`) track rejects the file.
 */
function readMp4(raw: Buffer): ParsedAudio | null {
	if (raw.byteLength < 12) return null;
	if (raw.toString("latin1", 4, 8) !== "ftyp") return null;
	const brand = raw.toString("latin1", 8, 12);
	if (!MP4_BRANDS.has(brand)) {
		// Encoders write different major brands; a known compatible brand is enough.
		const ftypEnd = Math.min(raw.byteLength, readU32(raw, 0) || 0);
		let found = false;
		for (let at = 16; at + 4 <= ftypEnd && at < 256; at += 4)
			if (MP4_BRANDS.has(raw.toString("latin1", at, at + 4))) found = true;
		if (!found) return null;
	}

	const state = {
		boxes: 0,
		timescale: 0,
		duration: 0,
		sound: false,
		video: false,
		movieHeaders: 0,
		exhausted: false,
	};
	walkMp4(raw, 0, raw.byteLength, 0, state);

	if (state.exhausted) rejectBroken();
	/**
	 * A movie has exactly one `mvhd`. With two, which one a player reads is the player's choice, and
	 * this walker once let the last one win: a long file with a short second header passed the
	 * duration cap. Two answers to "how long is this" is a file we cannot describe.
	 */
	if (state.movieHeaders > 1) rejectBroken();
	if (state.video) rejectFormat();
	if (!state.sound) rejectBroken();
	if (state.timescale <= 0 || state.duration <= 0) rejectBroken();

	return {
		mime: "audio/mp4",
		durationMs: (state.duration / state.timescale) * 1000,
	};
}

interface Mp4State {
	boxes: number;
	timescale: number;
	duration: number;
	sound: boolean;
	video: boolean;
	movieHeaders: number;
	/**
	 * A cap was reached or a box size was impossible, so part of the file went unseen; the file is not
	 * judged on the rest.
	 */
	exhausted: boolean;
}

/** Boxes that hold other boxes; only these are descended into. */
const MP4_CONTAINERS = new Set([
	"moov",
	"trak",
	"mdia",
	"minf",
	"stbl",
	"udta",
]);
const MP4_MAX_DEPTH = 6;

function walkMp4(
	raw: Buffer,
	from: number,
	to: number,
	depth: number,
	state: Mp4State,
): void {
	if (depth > MP4_MAX_DEPTH) {
		state.exhausted = true;
		return;
	}
	let at = from;
	while (at + 8 <= to) {
		if (++state.boxes > MP4_MAX_BOXES) {
			state.exhausted = true;
			return;
		}
		let size = readU32(raw, at);
		const type = raw.toString("latin1", at + 4, at + 8);
		let header = 8;
		if (size === 1) {
			// 64-bit size; nonzero high bits are corrupt at this size cap.
			if (at + 16 > to || readU32(raw, at + 8) !== 0) {
				state.exhausted = true;
				return;
			}
			size = readU32(raw, at + 12);
			header = 16;
		} else if (size === 0) {
			// Size 0 means "to end of file".
			size = to - at;
		}
		if (size < header || at + size > to) {
			state.exhausted = true;
			return;
		}

		if (type === "mvhd") {
			state.movieHeaders += 1;
			readMvhd(raw, at + header, at + size, state);
		} else if (type === "hdlr") readHdlr(raw, at + header, at + size, state);
		else if (MP4_CONTAINERS.has(type))
			walkMp4(raw, at + header, at + size, depth + 1, state);

		at += size;
	}
}

function readMvhd(
	raw: Buffer,
	from: number,
	to: number,
	state: Mp4State,
): void {
	if (from + 4 > to) return;
	const version = raw[from];
	if (version === 0) {
		if (from + 20 > to) return;
		state.timescale = readU32(raw, from + 12);
		state.duration = readU32(raw, from + 16);
		return;
	}
	if (version === 1) {
		if (from + 32 > to) return;
		state.timescale = readU32(raw, from + 20);
		// 64-bit duration: nonzero high bits reject rather than truncate, since truncating would show an
		// hours-long value as seconds.
		if (readU32(raw, from + 24) !== 0) return;
		state.duration = readU32(raw, from + 28);
	}
}

function readHdlr(
	raw: Buffer,
	from: number,
	to: number,
	state: Mp4State,
): void {
	// version(1) + flags(3) + pre_defined(4) + handler_type(4)
	if (from + 12 > to) return;
	const handler = raw.toString("latin1", from + 8, from + 12);
	if (handler === "soun") state.sound = true;
	else if (handler === "vide") state.video = true;
}

/** Max scan distance for the first frame; later than this is not treated as audio. */
const MP3_SYNC_WINDOW = 256 * 1024;

const MP3_BITRATES: Readonly<Record<string, readonly number[]>> = {
	// Keyed [MPEG version][layer]; indexes 0 (free) and 15 (bad) are placeholders.
	"1-1": [
		0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0,
	],
	"1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
	"1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
	"2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
	"2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
	"2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

const MP3_SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
	3: [44100, 48000, 32000], // MPEG 1
	2: [22050, 24000, 16000], // MPEG 2
	0: [11025, 12000, 8000], // MPEG 2.5
};

interface Mp3Frame {
	readonly offset: number;
	readonly length: number;
	readonly layer: number;
	readonly bitrate: number;
	readonly sampleRate: number;
	readonly samplesPerFrame: number;
	readonly mono: boolean;
	readonly mpeg1: boolean;
}

/**
 * Skips ID3v2, finds the first MPEG frame, and trusts a VBR header when present. Computing from the
 * first frame's bitrate on a VBR file can be off several-fold; Xing/Info and VBRI carry the
 * encoder's frame count. Without them CBR is assumed; that error is unpredictable but far smaller
 * than the 10-minute cap's margin.
 *
 * The frame count is trusted only as far as the bytes allow. No frame of this version, layer and
 * sample rate is longer than one at the highest bitrate, so a count whose frames could not fill the
 * audio bytes is false, and the byte estimate stands instead. Trusted as written, a header claiming
 * a hundred frames made 10MB of 8kbps audio (hours) read as seconds and pass the duration cap.
 * Overcounting is left alone: it errs toward rejecting, which the cap has room for.
 *
 * ⚠️ This is a header reader, and it stays one. A file whose first frame claims a higher bitrate
 * than the frames after it still reads short; only walking every frame would close that, and the
 * module header says why this parser does not decode.
 */
function readMp3(raw: Buffer): ParsedAudio | null {
	const start = skipId3v2(raw);
	const frame = findMp3Frame(raw, start);
	if (frame === null) return null;

	const end = trimTrailingTags(raw);
	if (end <= frame.offset) rejectBroken();

	const audioBytes = end - frame.offset;
	const cbrMs = (audioBytes * 8 * 1000) / (frame.bitrate * 1000);
	const vbrFrames = readVbrFrameCount(raw, frame);
	// +1: encoders differ on whether the count includes the frame carrying the header.
	const possible =
		vbrFrames !== null &&
		(vbrFrames + 1) * maxMp3FrameLength(frame) >= audioBytes;
	const durationMs =
		vbrFrames !== null && possible
			? (vbrFrames * frame.samplesPerFrame * 1000) / frame.sampleRate
			: cbrMs;

	return { mime: "audio/mpeg", durationMs };
}

/** The longest frame this version, layer and sample rate can have: highest bitrate, padded. */
function maxMp3FrameLength(frame: Mp3Frame): number {
	const bitrates = MP3_BITRATES[`${frame.mpeg1 ? 1 : 2}-${frame.layer}`] ?? [];
	return mp3FrameLength(
		frame.layer,
		frame.samplesPerFrame,
		Math.max(...bitrates),
		frame.sampleRate,
		1,
	);
}

/** Bytes in one frame; the length the header implies and the bound above use the same arithmetic. */
function mp3FrameLength(
	layer: number,
	samplesPerFrame: number,
	bitrate: number,
	sampleRate: number,
	padding: number,
): number {
	return layer === 1
		? (Math.floor((12 * bitrate * 1000) / sampleRate) + padding) * 4
		: Math.floor((samplesPerFrame / 8) * ((bitrate * 1000) / sampleRate)) +
				padding;
}

/**
 * End of the ID3v2 tag, or 0 if absent. The size is a syncsafe integer (7 bits per byte); read as
 * plain big-endian it overshoots and the first-frame search would start mid-audio.
 */
function skipId3v2(raw: Buffer): number {
	if (raw.byteLength < 10) return 0;
	if (raw.toString("latin1", 0, 3) !== "ID3") return 0;
	const flags = raw[6] ?? 0;
	let size = 0;
	for (let at = 6; at <= 9; at++) {
		const byte = raw[at] ?? 0;
		// Syncsafe bytes never use the top bit; set means a corrupt tag.
		if (byte & 0x80) return 0;
		size = (size << 7) | byte;
	}
	const footer = flags & 0x10 ? 10 : 0;
	const end = 10 + size + footer;
	return end > 0 && end < raw.byteLength ? end : 0;
}

/**
 * First frame, confirmed by a valid header at the position the length points to. The 11-bit sync
 * word alone matches arbitrary byte runs too often.
 */
function findMp3Frame(raw: Buffer, from: number): Mp3Frame | null {
	const limit = Math.min(raw.byteLength - 4, from + MP3_SYNC_WINDOW);
	for (let at = from; at <= limit; at++) {
		if (raw[at] !== 0xff) continue;
		if (((raw[at + 1] ?? 0) & 0xe0) !== 0xe0) continue;
		const frame = decodeMp3Header(raw, at);
		if (frame === null) continue;
		const next = at + frame.length;
		if (next + 4 > raw.byteLength) return frame; // last frame in the file
		if (decodeMp3Header(raw, next) === null) continue;
		return frame;
	}
	return null;
}

function decodeMp3Header(raw: Buffer, at: number): Mp3Frame | null {
	if (at + 4 > raw.byteLength) return null;
	const b1 = raw[at + 1] ?? 0;
	const b2 = raw[at + 2] ?? 0;
	const b3 = raw[at + 3] ?? 0;
	if ((raw[at] ?? 0) !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

	const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
	const layerBits = (b1 >> 1) & 0x03; // 3 = Layer1, 2 = Layer2, 1 = Layer3, 0 = reserved
	if (versionBits === 1 || layerBits === 0) return null;

	const layer = 4 - layerBits;
	const mpeg1 = versionBits === 3;
	const rates = MP3_SAMPLE_RATES[versionBits];
	const bitrates = MP3_BITRATES[`${mpeg1 ? 1 : 2}-${layer}`];
	if (rates === undefined || bitrates === undefined) return null;

	const bitrate = bitrates[(b2 >> 4) & 0x0f] ?? 0;
	const sampleRate = rates[(b2 >> 2) & 0x03] ?? 0;
	// Free format (0) and bad (15) have no computable length, so they are not frames.
	if (bitrate === 0 || sampleRate === 0) return null;

	const padding = (b2 >> 1) & 0x01;
	const samplesPerFrame = layer === 1 ? 384 : mpeg1 || layer === 2 ? 1152 : 576;
	const length = mp3FrameLength(
		layer,
		samplesPerFrame,
		bitrate,
		sampleRate,
		padding,
	);
	if (length <= 4) return null;

	return {
		offset: at,
		length,
		layer,
		bitrate,
		sampleRate,
		samplesPerFrame,
		mono: ((b3 >> 6) & 0x03) === 3,
		mpeg1,
	};
}

/** Frame count from Xing/Info/VBRI, or `null` (CBR assumed). */
function readVbrFrameCount(raw: Buffer, frame: Mp3Frame): number | null {
	const sideInfo = frame.mpeg1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;

	const xingAt = frame.offset + 4 + sideInfo;
	if (xingAt + 12 <= raw.byteLength) {
		const tag = raw.toString("latin1", xingAt, xingAt + 4);
		if (tag === "Xing" || tag === "Info") {
			const flags = readU32(raw, xingAt + 4);
			if (flags & 0x01) {
				const frames = readU32(raw, xingAt + 8);
				return frames > 0 ? frames : null;
			}
			return null;
		}
	}

	const vbriAt = frame.offset + 4 + 32;
	if (vbriAt + 26 <= raw.byteLength) {
		if (raw.toString("latin1", vbriAt, vbriAt + 4) === "VBRI") {
			const frames = readU32(raw, vbriAt + 14);
			return frames > 0 ? frames : null;
		}
	}
	return null;
}

/**
 * Excludes a trailing ID3v1 tag (128 bytes) from the audio bytes; only matters for the CBR
 * calculation but is significant for very short effects. APEv2 and Lyrics3 are ignored; that error
 * overestimates duration, which the cap has room for.
 */
function trimTrailingTags(raw: Buffer): number {
	const end = raw.byteLength;
	if (end >= 128 && raw.toString("latin1", end - 128, end - 125) === "TAG")
		return end - 128;
	return end;
}

/** Returns 0 out of range; every read in this parser goes through here. */
function readU32(raw: Buffer, at: number): number {
	if (at < 0 || at + 4 > raw.byteLength) return 0;
	return raw.readUInt32BE(at);
}
