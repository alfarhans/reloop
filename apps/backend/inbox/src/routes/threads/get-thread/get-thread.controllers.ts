import { db } from "@reloop/db/client";
import {
	emailLog,
	emailThread,
	inboundEmail,
	threadMessage,
} from "@reloop/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { createError } from "evlog";

function asIso(value: Date | string | null | undefined): string {
	if (!value) return new Date(0).toISOString();
	return typeof value === "string" ? value : value.toISOString();
}

function uniqueAddresses(
	...groups: Array<string[] | null | undefined>
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const group of groups) {
		for (const raw of group ?? []) {
			const addr = String(raw ?? "").trim();
			if (!addr) continue;
			const key = addr.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(addr);
		}
	}
	return out;
}

async function loadOrgThread(threadId: string, organizationId: string) {
	return db.query.emailThread.findFirst({
		where: and(
			eq(emailThread.id, threadId),
			eq(emailThread.organizationId, organizationId),
		),
		with: {
			messages: {
				orderBy: [desc(threadMessage.messageAt)],
			},
		},
	});
}

export async function getThreadController(id: string, organizationId: string) {
	// 1. Try finding directly by emailThread.id
	let thread = await loadOrgThread(id, organizationId);

	// 2. If not found by emailThread.id, check if id is an inboundEmail.id
	//    in this organization, then load that thread (also org-scoped).
	if (!thread) {
		const inb = await db.query.inboundEmail.findFirst({
			where: and(
				eq(inboundEmail.id, id),
				eq(inboundEmail.organizationId, organizationId),
			),
		});
		if (inb?.threadId) {
			thread = await loadOrgThread(inb.threadId, organizationId);
		}
	}

	// 3. Check threadMessage table by inboundEmailId, emailLogId, or message ID.
	//    The thread itself must belong to the caller organization.
	if (!thread) {
		const tm = await db.query.threadMessage.findFirst({
			where: or(
				eq(threadMessage.inboundEmailId, id),
				eq(threadMessage.emailLogId, id),
				eq(threadMessage.id, id),
			),
		});

		if (tm?.threadId) {
			thread = await loadOrgThread(tm.threadId, organizationId);
		}
	}

	// 4. If a thread record was found, hydrate messages
	if (thread) {
		const hydratedMessages = await Promise.all(
			thread.messages.map(async (msg) => {
				if (msg.direction === "inbound" && msg.inboundEmailId) {
					const email = await db.query.inboundEmail.findFirst({
						where: and(
							eq(inboundEmail.id, msg.inboundEmailId),
							eq(inboundEmail.organizationId, organizationId),
						),
						with: { attachments: true },
					});
					return {
						...msg,
						email: email
							? {
									id: email.id,
									fromEmail: email.fromEmail,
									fromName: email.fromName,
									toEmails: email.toEmails,
									ccEmails: email.ccEmails ?? [],
									replyTo: email.replyTo,
									subject: email.subject,
									textBody: email.textBody,
									htmlBody: email.htmlBody,
									isRead: email.isRead,
									isStarred: email.isStarred,
									attachments: email.attachments,
									createdAt: email.createdAt,
								}
							: null,
					};
				}

				if (msg.direction === "outbound" && msg.emailLogId) {
					const email = await db.query.emailLog.findFirst({
						where: and(
							eq(emailLog.id, msg.emailLogId),
							eq(emailLog.organizationId, organizationId),
						),
					});
					return {
						...msg,
						email: email
							? {
									id: email.id,
									fromEmail: email.fromEmail,
									fromName: email.fromName,
									toEmails: email.toEmails,
									ccEmails: email.ccEmails ?? [],
									bccEmails: email.bccEmails ?? [],
									subject: email.subject,
									textBody: email.textBody,
									htmlBody: email.htmlBody,
									status: email.status,
									sentAt: email.sentAt,
									createdAt: email.createdAt,
								}
							: null,
					};
				}

				return { ...msg, email: null };
			}),
		);

		return {
			...thread,
			participants: thread.participants || [],
			messages: hydratedMessages,
		};
	}

	// 5. Fallback: Check if id is a standalone inbound email
	const standaloneInbound = await db.query.inboundEmail.findFirst({
		where: and(
			eq(inboundEmail.id, id),
			eq(inboundEmail.organizationId, organizationId),
		),
		with: { attachments: true },
	});

	if (standaloneInbound) {
		const createdAt = asIso(standaloneInbound.createdAt);
		return {
			id: standaloneInbound.id,
			mailboxId: standaloneInbound.mailboxId,
			organizationId: standaloneInbound.organizationId,
			subject: standaloneInbound.subject ?? "(no subject)",
			lastMessagePreview: (
				standaloneInbound.snippet ||
				standaloneInbound.textBody ||
				""
			)
				.toString()
				.slice(0, 200),
			lastMessageAt: createdAt,
			status: "active",
			messageCount: 1,
			participants: uniqueAddresses(
				[standaloneInbound.fromEmail],
				standaloneInbound.toEmails,
				standaloneInbound.ccEmails,
			),
			isRead: Boolean(standaloneInbound.isRead),
			isStarred: Boolean(standaloneInbound.isStarred),
			createdAt,
			updatedAt: createdAt,
			messages: [
				{
					id: `msg_${standaloneInbound.id}`,
					threadId: standaloneInbound.id,
					direction: "inbound",
					inboundEmailId: standaloneInbound.id,
					emailLogId: null,
					fromEmail: standaloneInbound.fromEmail,
					fromName: standaloneInbound.fromName,
					subject: standaloneInbound.subject,
					preview: (
						standaloneInbound.snippet ||
						standaloneInbound.textBody ||
						""
					)
						.toString()
						.slice(0, 200),
					messageAt: createdAt,
					rfc822MessageId: standaloneInbound.messageId ?? null,
					inReplyTo: null,
					createdAt,
					email: {
						id: standaloneInbound.id,
						fromEmail: standaloneInbound.fromEmail,
						fromName: standaloneInbound.fromName,
						toEmails: standaloneInbound.toEmails ?? [],
						ccEmails: standaloneInbound.ccEmails ?? [],
						replyTo: standaloneInbound.replyTo,
						subject: standaloneInbound.subject,
						textBody: standaloneInbound.textBody,
						htmlBody: standaloneInbound.htmlBody,
						isRead: Boolean(standaloneInbound.isRead),
						isStarred: Boolean(standaloneInbound.isStarred),
						attachments: standaloneInbound.attachments ?? [],
						createdAt,
					},
				},
			],
		};
	}

	// 6. Fallback: Check if id is a standalone email log (outbound / Sent)
	const standaloneLog = await db.query.emailLog.findFirst({
		where: and(
			eq(emailLog.id, id),
			eq(emailLog.organizationId, organizationId),
		),
	});

	if (standaloneLog) {
		const createdAt = asIso(standaloneLog.createdAt);
		const ccEmails = standaloneLog.ccEmails ?? [];
		const bccEmails = standaloneLog.bccEmails ?? [];
		return {
			id: standaloneLog.id,
			mailboxId: null,
			organizationId: standaloneLog.organizationId,
			subject: standaloneLog.subject ?? "(no subject)",
			lastMessagePreview: (standaloneLog.textBody || "")
				.toString()
				.slice(0, 200),
			lastMessageAt: createdAt,
			status: "active",
			messageCount: 1,
			participants: uniqueAddresses(
				[standaloneLog.fromEmail],
				standaloneLog.toEmails,
				ccEmails,
			),
			isRead: true,
			isStarred: false,
			createdAt,
			updatedAt: createdAt,
			messages: [
				{
					id: `msg_${standaloneLog.id}`,
					threadId: standaloneLog.id,
					direction: "outbound",
					inboundEmailId: null,
					emailLogId: standaloneLog.id,
					fromEmail: standaloneLog.fromEmail,
					fromName: standaloneLog.fromName,
					subject: standaloneLog.subject,
					preview: (standaloneLog.textBody || "").toString().slice(0, 200),
					messageAt: createdAt,
					rfc822MessageId: standaloneLog.messageId ?? null,
					inReplyTo: null,
					createdAt,
					email: {
						id: standaloneLog.id,
						fromEmail: standaloneLog.fromEmail,
						fromName: standaloneLog.fromName,
						toEmails: standaloneLog.toEmails ?? [],
						ccEmails,
						bccEmails,
						subject: standaloneLog.subject,
						textBody: standaloneLog.textBody,
						htmlBody: standaloneLog.htmlBody,
						status: standaloneLog.status,
						sentAt: standaloneLog.sentAt ? asIso(standaloneLog.sentAt) : null,
						createdAt,
					},
				},
			],
		};
	}

	throw createError({
		status: 404,
		message: "Thread not found",
		why: `Thread ${id} was not found in your organization`,
		fix: "Verify the thread ID and ensure it belongs to your organization",
	});
}
