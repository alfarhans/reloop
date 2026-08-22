import { db } from "@reloop/db/client";
import {
	emailThread,
	inboundAttachment,
	inboundEmail,
	threadMessage,
} from "@reloop/db/schema";
import { and, eq } from "drizzle-orm";
import { createError } from "evlog";

export async function getThreadAttachmentController(
	threadId: string,
	attachmentId: string,
	organizationId: string,
) {
	// Verify thread access
	const thread = await db.query.emailThread.findFirst({
		where: and(
			eq(emailThread.id, threadId),
			eq(emailThread.organizationId, organizationId),
		),
	});

	if (!thread) {
		throw createError({
			status: 404,
			message: "Thread not found",
			why: `Thread ${threadId} was not found in your organization`,
			fix: "Verify the thread ID and ensure it belongs to your organization",
		});
	}

	const attachment = await db.query.inboundAttachment.findFirst({
		where: eq(inboundAttachment.id, attachmentId),
	});

	if (!attachment) {
		throw createError({
			status: 404,
			message: "Attachment not found",
			why: `Attachment ${attachmentId} was not found`,
			fix: "Verify the attachment ID",
		});
	}

	const email = await db.query.inboundEmail.findFirst({
		where: and(
			eq(inboundEmail.id, attachment.inboundEmailId),
			eq(inboundEmail.organizationId, organizationId),
		),
		columns: { id: true },
	});

	const onThread = email
		? await db.query.threadMessage.findFirst({
				where: and(
					eq(threadMessage.threadId, threadId),
					eq(threadMessage.inboundEmailId, email.id),
				),
				columns: { id: true },
			})
		: null;

	if (!email || !onThread) {
		throw createError({
			status: 404,
			message: "Attachment not found",
			why: `Attachment ${attachmentId} was not found on this thread`,
			fix: "Verify the attachment ID and thread ID",
		});
	}

	return {
		id: attachment.id,
		filename: attachment.filename,
		contentType: attachment.contentType,
		size: attachment.size,
		storagePath: attachment.storagePath,
		contentDisposition: attachment.contentDisposition,
		contentId: attachment.contentId,
		createdAt: attachment.createdAt,
	};
}
