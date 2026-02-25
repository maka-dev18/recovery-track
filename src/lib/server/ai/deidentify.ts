import { aiConfig } from '$lib/server/config/ai';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*\d{3}\s*\)|\d{3})\s*(?:[.-]\s*)?)\d{3}\s*(?:[.-]\s*)?\d{4}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const DATE_OF_BIRTH_PATTERN = /\b(?:dob|date of birth)\s*[:=-]?\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/gi;

export function deidentifyText(input: string, options?: { patientName?: string | null }): string {
	if (!aiConfig.deidentifyMode) {
		return input;
	}

	let sanitized = input
		.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
		.replace(PHONE_PATTERN, '[REDACTED_PHONE]')
		.replace(SSN_PATTERN, '[REDACTED_SSN]')
		.replace(DATE_OF_BIRTH_PATTERN, '[REDACTED_DOB]');

	const patientName = options?.patientName?.trim();
	if (patientName && patientName.length >= 2) {
		const escaped = patientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const namePattern = new RegExp(`\\b${escaped}\\b`, 'gi');
		sanitized = sanitized.replace(namePattern, '[REDACTED_NAME]');
	}

	return sanitized;
}
