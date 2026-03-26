export const virtualTherapistProfile = {
	name: 'Amani',
	roleLabel: 'Recovery therapist',
	tagline: 'Knows your recovery history, goals, and recent check-ins.'
} as const;

export function getPreferredName(name: string | null | undefined) {
	const normalized = name?.trim() ?? '';
	if (!normalized) {
		return 'there';
	}

	const [firstName] = normalized.split(/\s+/);
	return firstName || normalized;
}
