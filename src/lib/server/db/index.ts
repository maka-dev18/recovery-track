import { env } from '$env/dynamic/private';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = createClient(
	env.DATABASE_AUTH_TOKEN
		? { url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN }
		: { url: env.DATABASE_URL }
);

export const db = drizzle(client, { schema });
