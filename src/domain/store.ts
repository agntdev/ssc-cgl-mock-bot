import { resolveSessionStorage } from "../toolkit/index.js";

/**
 * Domain records use a dedicated, namespaced persistent adapter. In production
 * the toolkit selects Redis from REDIS_URL; the harness receives its isolated
 * toolkit adapter, so dialog replays stay deterministic. Collections are always
 * reached through the explicit index records below—never through key scans.
 */
const storage = resolveSessionStorage<Record<string, never>>(undefined);
const prefix = "ssc-cgl:domain:";

function key(name: string): string {
  return prefix + name;
}

export async function readRecord<T>(name: string): Promise<T | undefined> {
  return (await storage.read(key(name))) as T | undefined;
}

export async function writeRecord<T>(name: string, value: T): Promise<void> {
  await storage.write(key(name), value as Record<string, never>);
}
