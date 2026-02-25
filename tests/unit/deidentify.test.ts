import { describe, expect, it } from 'vitest';
import { deidentifyText } from '../../src/lib/server/ai/deidentify';

describe('deidentifyText', () => {
	it('redacts common PHI-like fields', () => {
		const raw = 'Contact me at person@example.com or 555-123-4567. DOB: 01/02/1990.';
		const sanitized = deidentifyText(raw);
		expect(sanitized).not.toContain('person@example.com');
		expect(sanitized).not.toContain('555-123-4567');
		expect(sanitized).not.toContain('01/02/1990');
		expect(sanitized).toContain('[REDACTED_EMAIL]');
		expect(sanitized).toContain('[REDACTED_PHONE]');
	});

	it('redacts provided patient name when present', () => {
		const raw = 'John Doe said cravings increased today.';
		const sanitized = deidentifyText(raw, { patientName: 'John Doe' });
		expect(sanitized).toContain('[REDACTED_NAME]');
		expect(sanitized).not.toContain('John Doe');
	});
});
