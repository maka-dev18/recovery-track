import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { aiConfig, requireGoogleApiKey } from '$lib/server/config/ai';

let provider: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getProvider() {
	if (!provider) {
		provider = createGoogleGenerativeAI({
			apiKey: requireGoogleApiKey()
		});
	}

	return provider;
}

export function getTextModel() {
	return getProvider()(aiConfig.textModel);
}

export function getRiskModel() {
	return getProvider()(aiConfig.riskModel);
}
