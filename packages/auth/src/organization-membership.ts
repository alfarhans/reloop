export type MembershipLookup = {
	findMembership(
		userId: string,
		organizationId: string,
	): Promise<{ organizationId: string } | null>;
};

const defaultLookup: MembershipLookup = {
	async findMembership(userId, organizationId) {
		const { db } = await import("@reloop/db/client");
		const { member } = await import("@reloop/db/schema");
		const { and, eq } = await import("drizzle-orm");
		const row = await db.query.member.findFirst({
			where: and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
			),
			columns: { organizationId: true },
		});
		return row ?? null;
	},
};

/**
 * Return organizationId only when the user is a current member.
 * Used to stop client-set / stale activeOrganizationId values from
 * becoming AuthContext.organizationId.
 */
export async function resolveTrustedOrganizationId({
	userId,
	sessionOrganizationId,
	userOrganizationId,
	lookup = defaultLookup,
}: {
	userId: string;
	sessionOrganizationId?: string | null;
	userOrganizationId?: string | null;
	lookup?: MembershipLookup;
}): Promise<string | null> {
	const candidates = [sessionOrganizationId, userOrganizationId].filter(
		(id): id is string => Boolean(id),
	);

	const seen = new Set<string>();
	for (const organizationId of candidates) {
		if (seen.has(organizationId)) continue;
		seen.add(organizationId);
		const row = await lookup.findMembership(userId, organizationId);
		if (row?.organizationId) return row.organizationId;
	}

	return null;
}

export async function isOrganizationMember(
	userId: string,
	organizationId: string,
	lookup: MembershipLookup = defaultLookup,
): Promise<boolean> {
	const row = await lookup.findMembership(userId, organizationId);
	return Boolean(row?.organizationId);
}
