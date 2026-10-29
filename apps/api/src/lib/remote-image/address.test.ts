import { describe, expect, test } from "vitest";
import { isPublicAddress, isPublicIpv4, isPublicIpv6 } from "./address.ts";

/**
 * Pins by value that address decisions use ranges, not string prefixes. Each private address here
 * is a real SSRF destination (cloud metadata, shared address space, IPv4-mapped IPv6); a commit
 * adding a new range adds a line here too.
 */

describe("IPv4", () => {
	test.each([
		"8.8.8.8",
		"1.1.1.1",
		"93.184.216.34",
		"104.16.0.1",
		"9.255.255.255",
		"11.0.0.0",
		"172.15.255.255",
		"172.32.0.0",
		"192.167.255.255",
		"192.169.0.0",
		"100.63.255.255",
		"100.128.0.0",
		"169.253.255.255",
		"223.255.255.255",
	])("public: %s", (address) => {
		expect(isPublicIpv4(address)).toBe(true);
		expect(isPublicAddress(address)).toBe(true);
	});

	test.each([
		["0.0.0.0", "unspecified"],
		["0.1.2.3", "0.0.0.0/8"],
		["10.0.0.5", "private"],
		["10.255.255.255", "end of private"],
		["100.64.0.1", "shared address space"],
		["100.127.255.255", "end of shared address space"],
		["127.0.0.1", "loopback"],
		["127.255.255.254", "end of loopback"],
		["169.254.169.254", "cloud metadata"],
		["169.254.0.1", "link-local"],
		["172.16.0.1", "private"],
		["172.31.255.255", "end of private"],
		["192.0.0.1", "IETF protocol assignments"],
		["192.0.2.1", "documentation"],
		["192.88.99.1", "6to4 relay"],
		["192.168.1.1", "private"],
		["198.18.0.1", "benchmarking"],
		["198.19.255.255", "end of benchmarking"],
		["198.51.100.1", "documentation"],
		["203.0.113.1", "documentation"],
		["224.0.0.1", "multicast"],
		["239.255.255.255", "end of multicast"],
		["240.0.0.1", "reserved"],
		["255.255.255.255", "broadcast"],
	])("rejected: %s (%s)", (address) => {
		expect(isPublicIpv4(address)).toBe(false);
		expect(isPublicAddress(address)).toBe(false);
	});
});

describe("IPv6", () => {
	test.each([
		"2606:4700::6810:1",
		"2a00:1450:4001:82a::200e",
		"2001:4860:4860::8888",
		"2001:0db7:ffff:ffff:ffff:ffff:ffff:ffff",
		"2001:1::1",
	])("public: %s", (address) => {
		expect(isPublicIpv6(address)).toBe(true);
		expect(isPublicAddress(address)).toBe(true);
	});

	test.each([
		["::", "unspecified"],
		["::1", "loopback"],
		["0:0:0:0:0:0:0:1", "loopback, expanded form"],
		["fc00::1", "unique local"],
		["fd12:3456:789a::1", "unique local"],
		["fe80::1", "link-local"],
		["fe80::1%eth0", "link-local + zone"],
		["febf::1", "end of link-local"],
		["fec0::1", "site-local"],
		["ff02::1", "multicast"],
		["2001:db8::1", "documentation"],
		["2001::1", "Teredo"],
		["100::1", "deprecated range"],
	])("rejected: %s (%s)", (address) => {
		expect(isPublicIpv6(address)).toBe(false);
		expect(isPublicAddress(address)).toBe(false);
	});

	/** IPv4 inside IPv6 notation is re-judged by the inner address; by IPv6 rules alone all of these would read as public. */
	test.each([
		["::ffff:10.0.0.1", false],
		["::ffff:127.0.0.1", false],
		["::ffff:169.254.169.254", false],
		["::ffff:a00:1", false],
		["::ffff:8.8.8.8", true],
		["::ffff:808:808", true],
		["64:ff9b::7f00:1", false],
		["64:ff9b::8.8.8.8", true],
		["2002:0a00:0001::", false],
		["2002:c0a8:0101::1", false],
		["2002:0808:0808::1", true],
	])("%s → %s", (address, expected) => {
		expect(isPublicIpv6(address)).toBe(expected);
		expect(isPublicAddress(address)).toBe(expected);
	});
});

describe("not an address", () => {
	test.each([
		"",
		"example.com",
		"localhost",
		"8.8.8",
		"::g",
		"10.0.0.1/8",
	])("rejected: %s", (value) => {
		expect(isPublicAddress(value)).toBe(false);
	});
});
