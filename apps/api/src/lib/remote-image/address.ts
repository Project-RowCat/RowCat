import { isIPv4, isIPv6 } from "node:net";

/**
 * Whether an address is on the public internet: the destination decision of the remote-image proxy.
 *
 * `https:` guarantees nothing. A public hostname can resolve to a private address (DNS belongs to
 * the creator) and a public address can redirect to loopback. So this looks at the address the
 * connection will actually go to, not the name, and a socket is opened only to an address that
 * passed it (`fetch.ts`).
 *
 * ## Ranges, not string prefixes
 *
 * A `startsWith("10.")`-style list always misses one, and the miss is cloud metadata
 * (`169.254.169.254`) or shared address space (`100.64.0.0/10`). CIDR ranges are compared as
 * integers: one 32-bit number for IPv4, a 128-bit `BigInt` for IPv6.
 *
 * ## IPv4 inside IPv6
 *
 * `::ffff:10.0.0.1` (IPv4-mapped), `64:ff9b::a00:1` (NAT64) and `2002:0a00:0001::` (6to4) carry an
 * IPv4 address in IPv6 notation. Judged by IPv6 rules alone they all read as public while the real
 * connection goes to a private IPv4, so those three are re-judged by their embedded IPv4.
 *
 * ## What this file does not answer
 *
 * Hostname shape (`localhost`, IP literals) was already rejected by `@rowcat/runtime`'s `asset()`;
 * DNS resolution and connecting belong to `fetch.ts`. This is address to boolean only.
 */

interface Range4 {
	readonly base: number;
	readonly bits: number;
}

const ipv4ToInt = (address: string): number => {
	const parts = address.split(".").map(Number);
	return (
		(((parts[0] as number) << 24) >>> 0) +
		((parts[1] as number) << 16) +
		((parts[2] as number) << 8) +
		(parts[3] as number)
	);
};

const range4 = (cidr: string): Range4 => {
	const [base, bits] = cidr.split("/");
	return { base: ipv4ToInt(base as string), bits: Number(bits) };
};

/**
 * Non-public IPv4: every RFC 6890 special-purpose address plus multicast and reserved space.
 * `0.0.0.0/8` is listed because on Linux a connection to `0.0.0.0` goes to loopback.
 */
const PRIVATE_IPV4: readonly Range4[] = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.88.99.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
].map(range4);

const inRange4 = (value: number, range: Range4): boolean => {
	if (range.bits === 0) return true;
	const mask = (0xffffffff << (32 - range.bits)) >>> 0;
	return (value & mask) >>> 0 === (range.base & mask) >>> 0;
};

export function isPublicIpv4(address: string): boolean {
	if (!isIPv4(address)) return false;
	const value = ipv4ToInt(address);
	return !PRIVATE_IPV4.some((range) => inRange4(value, range));
}

/** IPv6 string to 128-bit integer; only values that passed `isIPv6` arrive. */
function ipv6ToBigInt(address: string): bigint {
	/** Zone ids like `%eth0` occur only on link-local, which is rejected anyway, but parsing still handles them. */
	const zoneAt = address.indexOf("%");
	const plain = zoneAt === -1 ? address : address.slice(0, zoneAt);
	/** A trailing dotted-quad IPv4 is expanded into two hex groups. */
	const lastColon = plain.lastIndexOf(":");
	const tail = plain.slice(lastColon + 1);
	let expanded = plain;
	if (tail.includes(".")) {
		const v4 = ipv4ToInt(tail);
		expanded = `${plain.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	const halves = expanded.split("::");
	const head = halves[0] ? halves[0].split(":") : [];
	const rest = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
	const missing = 8 - head.length - rest.length;
	const groups = [...head, ...Array(missing).fill("0"), ...rest];
	let value = 0n;
	for (const group of groups)
		value = (value << 16n) | BigInt(`0x${group || "0"}`);
	return value;
}

interface Range6 {
	readonly base: bigint;
	readonly bits: number;
}

const range6 = (cidr: string): Range6 => {
	const [base, bits] = cidr.split("/");
	return { base: ipv6ToBigInt(base as string), bits: Number(bits) };
};

const ALL_ONES_128 = (1n << 128n) - 1n;

const inRange6 = (value: bigint, range: Range6): boolean => {
	const mask = (ALL_ONES_128 << BigInt(128 - range.bits)) & ALL_ONES_128;
	return (value & mask) === (range.base & mask);
};

/**
 * Non-public IPv6. The three IPv4-carrying prefixes (`::ffff:0:0/96`, `64:ff9b::/96`, `2002::/16`)
 * are absent: they are re-judged by their embedded IPv4 (`embeddedIpv4`). Teredo (`2001::/32`)
 * stores its address inverted, so it is rejected whole instead of extracted.
 */
const PRIVATE_IPV6: readonly Range6[] = [
	"::/128",
	"::1/128",
	/**
	 * IPv4-compatible (deprecated; `::127.0.0.1`, `::a9fe:a9fe`). Rejected whole rather than extracted:
	 * nothing public lives there, and a stack that still routes it would reach the embedded IPv4.
	 */
	"::/96",
	/** SIIT IPv4-translated (`::ffff:0:a.b.c.d`), the other IPv4-carrying form beside the mapped one. */
	"::ffff:0:0:0/96",
	/** Local-use NAT64 (RFC 8215): an operator's own translator, whose embedded IPv4 may be internal. */
	"64:ff9b:1::/48",
	/** Documentation (RFC 9637), beside `2001:db8::/32`. */
	"3fff::/20",
	"fc00::/7",
	"fe80::/10",
	"fec0::/10",
	"ff00::/8",
	"2001:db8::/32",
	"2001::/32",
	"100::/64",
].map(range6);

const V4_MAPPED = range6("::ffff:0:0/96");
const NAT64 = range6("64:ff9b::/96");
const SIX_TO_FOUR = range6("2002::/16");

const embeddedIpv4 = (value: bigint): number | null => {
	if (inRange6(value, V4_MAPPED) || inRange6(value, NAT64))
		return Number(value & 0xffffffffn);
	if (inRange6(value, SIX_TO_FOUR)) return Number((value >> 80n) & 0xffffffffn);
	return null;
};

const intToIpv4 = (value: number): string =>
	`${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;

export function isPublicIpv6(address: string): boolean {
	if (!isIPv6(address)) return false;
	const value = ipv6ToBigInt(address);
	const embedded = embeddedIpv4(value);
	if (embedded !== null) return isPublicIpv4(intToIpv4(embedded));
	return !PRIVATE_IPV6.some((range) => inRange6(value, range));
}

/**
 * Whether the address the connection will go to is public. Unknown shapes are rejected: a string
 * that is neither IPv4 nor IPv6 (hostname, empty, corrupted) is `false`, since only resolver output
 * should arrive here.
 */
export function isPublicAddress(address: string): boolean {
	if (isIPv4(address)) return isPublicIpv4(address);
	if (isIPv6(address)) return isPublicIpv6(address);
	return false;
}
