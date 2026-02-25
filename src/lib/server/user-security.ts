import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { userCredentialPolicy } from '$lib/server/db/schema';

export async function userMustChangePassword(userId: string): Promise<boolean> {
	const policy = await db.query.userCredentialPolicy.findFirst({
		where: eq(userCredentialPolicy.userId, userId)
	});

	return policy?.mustChangePassword ?? false;
}

export async function setUserMustChangePassword(userId: string, mustChangePassword: boolean): Promise<void> {
	await db
		.insert(userCredentialPolicy)
		.values({ userId, mustChangePassword })
		.onConflictDoUpdate({
			target: userCredentialPolicy.userId,
			set: { mustChangePassword }
		});
}
