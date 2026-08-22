import { describe, expect, test } from "bun:test";
import {
	type MembershipLookup,
	resolveTrustedOrganizationId,
} from "@reloop/auth/organization-membership";

function lookupFor(members: Record<string, string[]>): MembershipLookup {
	return {
		async findMembership(userId, organizationId) {
			const orgs = members[userId] ?? [];
			return orgs.includes(organizationId) ? { organizationId } : null;
		},
	};
}

describe("resolveTrustedOrganizationId", () => {
	test("accepts a session org the user belongs to", async () => {
		const organizationId = await resolveTrustedOrganizationId({
			userId: "u1",
			sessionOrganizationId: "org-a",
			userOrganizationId: "org-poisoned",
			lookup: lookupFor({ u1: ["org-a"] }),
		});
		expect(organizationId).toBe("org-a");
	});

	test("rejects a session org the user is not a member of and falls back to a valid user preference", async () => {
		const organizationId = await resolveTrustedOrganizationId({
			userId: "u1",
			sessionOrganizationId: "org-victim",
			userOrganizationId: "org-own",
			lookup: lookupFor({ u1: ["org-own"] }),
		});
		expect(organizationId).toBe("org-own");
	});

	test("rejects a client-set user preference that is not a membership", async () => {
		const organizationId = await resolveTrustedOrganizationId({
			userId: "u1",
			sessionOrganizationId: null,
			userOrganizationId: "org-victim",
			lookup: lookupFor({ u1: ["org-own"] }),
		});
		expect(organizationId).toBeNull();
	});

	test("returns null when neither candidate is a membership", async () => {
		const organizationId = await resolveTrustedOrganizationId({
			userId: "u1",
			sessionOrganizationId: "org-x",
			userOrganizationId: "org-y",
			lookup: lookupFor({ u1: [] }),
		});
		expect(organizationId).toBeNull();
	});
});
