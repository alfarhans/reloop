import { describe, expect, test } from "bun:test";
import {
	decodeTrackingToken,
	encodeTrackingToken,
} from "@reloop/be-mail/lib/crypto";

const secret = "test-tracking-secret";

describe("tracking tokens", () => {
	test("accepts an HMAC-signed click token", () => {
		const token = encodeTrackingToken(
			{ id: "log_1", url: "https://example.com/next" },
			secret,
		);
		expect(decodeTrackingToken(token, secret)).toEqual({
			id: "log_1",
			url: "https://example.com/next",
		});
	});

	test("rejects an unsigned base64url JSON token", () => {
		const token = Buffer.from(
			JSON.stringify({ url: "https://evil.example/phish" }),
		).toString("base64url");
		expect(decodeTrackingToken(token, secret)).toBeNull();
	});

	test("rejects a tampered destination URL", () => {
		const token = encodeTrackingToken(
			{ id: "log_1", url: "https://example.com/next" },
			secret,
		);
		const obj = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
		obj.url = "https://evil.example/phish";
		const tampered = Buffer.from(JSON.stringify(obj)).toString("base64url");
		expect(decodeTrackingToken(tampered, secret)).toBeNull();
	});
});
