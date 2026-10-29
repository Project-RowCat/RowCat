import { describe, expect, test } from "vitest";
import type { SmtpConfig } from "../../lib/mail-config.ts";
import {
	ehloNameFrom,
	smtpFailureScope,
	smtpTransportOptions,
} from "./smtp.ts";

const FROM = "RowCat <noreply@example.com>";

const config = (secure: boolean): SmtpConfig => ({
	host: "smtp.example.test",
	port: secure ? 465 : 587,
	secure,
	auth: { user: "mailer", pass: "secret" },
});

describe("SMTP TLS connection invariants", () => {
	test("port 587 mode requires STARTTLS", () => {
		expect(smtpTransportOptions(config(false), FROM)).toMatchObject({
			port: 587,
			secure: false,
			requireTLS: true,
		});
	});

	test("port 465 implicit TLS doesn't require STARTTLS again", () => {
		expect(smtpTransportOptions(config(true), FROM)).toMatchObject({
			port: 465,
			secure: true,
			requireTLS: false,
		});
	});

	test("an internal relay without auth keeps the same TLS policy and has no auth field", () => {
		const options = smtpTransportOptions(
			{ ...config(false), auth: null },
			FROM,
		);
		expect(options.requireTLS).toBe(true);
		expect(options).not.toHaveProperty("auth");
	});
});

describe("connection reuse and the EHLO name", () => {
	// With the pool off, every send opens a new connection and logs in; one notice means dozens of
	// auth attempts that the provider reads as a flood.
	test("pool mode", () => {
		expect(smtpTransportOptions(config(false), FROM)).toMatchObject({
			pool: true,
		});
	});

	// Without it the container id goes out as EHLO, which fails only in production containers (Gmail's
	// `421 4.7.0 Try again later (EHLO)`).
	test("the EHLO name is the sender address's domain", () => {
		expect(smtpTransportOptions(config(false), FROM)).toMatchObject({
			name: "example.com",
		});
	});

	test.each([
		["RowCat <noreply@example.com>", "example.com"],
		["noreply@Mail.Example.com", "mail.example.com"],
		["  RowCat Notifications <no-reply@example.co.kr>  ", "example.co.kr"],
	])("reads the domain from the sender address: %s", (from, expected) => {
		expect(ehloNameFrom(from)).toBe(expected);
	});

	// Unreadable domains are not invented; the library default stays.
	test.each([
		"noreply@localhost",
		"RowCat",
		"noreply@-bad.com",
		"noreply@bad_.com",
	])("null with no name field when it isn't a domain: %s", (from) => {
		expect(ehloNameFrom(from)).toBeNull();
		expect(smtpTransportOptions(config(false), from)).not.toHaveProperty(
			"name",
		);
	});
});

describe("the scope of a failure", () => {
	test.each([
		"ECONNECTION",
		"ETIMEDOUT",
		"ESOCKET",
		"EDNS",
		"ETLS",
		"EAUTH",
	])("%s is a failure of the whole transport", (code) => {
		expect(smtpFailureScope(code, null)).toBe("transport");
	});

	// 421 on any command means the connection is closing.
	test("421 is a transport failure regardless of the code", () => {
		expect(smtpFailureScope("EENVELOPE", 421)).toBe("transport");
	});

	test("a per-recipient rejection is a failure of that one mail", () => {
		expect(smtpFailureScope("EENVELOPE", 550)).toBe("message");
		expect(smtpFailureScope("EMESSAGE", 552)).toBe("message");
	});

	// Folding unknown codes to `transport` would let a failure on one row stand at the front of every
	// run and block everyone else.
	test("an unknown code folds into a single-mail failure", () => {
		expect(smtpFailureScope("unknown", null)).toBe("message");
	});
});
