type LogLevel = 'info' | 'warn' | 'error';

function serializePayload(payload: unknown): string {
	try {
		return JSON.stringify(payload);
	} catch {
		return JSON.stringify({ error: 'Unable to serialize payload' });
	}
}

function write(level: LogLevel, message: string, payload?: Record<string, unknown>) {
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...payload
	};

	const serialized = serializePayload(entry);
	if (level === 'info') {
		console.info(serialized);
		return;
	}

	if (level === 'warn') {
		console.warn(serialized);
		return;
	}

	console.error(serialized);
}

export function logInfo(message: string, payload?: Record<string, unknown>) {
	write('info', message, payload);
}

export function logWarn(message: string, payload?: Record<string, unknown>) {
	write('warn', message, payload);
}

export function logError(message: string, payload?: Record<string, unknown>) {
	write('error', message, payload);
}
