import { readRecord, writeRecord } from "./store.js";
import type { AdminCredentials, Attempt, Candidate, MockTest } from "./types.js";

const userKey = (id: string) => `user:${id}`;
const attemptKey = (id: string) => `attempt:${id}`;
const testKey = (id: string) => `test:${id}`;

async function appendIndex(name: string, value: string): Promise<void> {
  const current = (await readRecord<string[]>(name)) ?? [];
  if (!current.includes(value)) await writeRecord(name, [...current, value]);
}

export async function getUser(id: string): Promise<Candidate | undefined> {
  return readRecord<Candidate>(userKey(id));
}
export async function saveUser(user: Candidate): Promise<void> {
  await writeRecord(userKey(user.userId), user);
  await appendIndex("users", user.userId);
}
export async function getTest(id: string): Promise<MockTest | undefined> {
  return readRecord<MockTest>(testKey(id));
}
export async function saveTest(test: MockTest): Promise<void> {
  await writeRecord(testKey(test.id), test);
  await appendIndex("tests", test.id);
}
export async function listTests(): Promise<MockTest[]> {
  const ids = (await readRecord<string[]>("tests")) ?? [];
  return (await Promise.all(ids.map(getTest))).filter((test): test is MockTest => Boolean(test));
}
export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return readRecord<Attempt>(attemptKey(id));
}
export async function saveAttempt(attempt: Attempt): Promise<void> {
  await writeRecord(attemptKey(attempt.id), attempt);
  await appendIndex("attempts", attempt.id);
  await appendIndex(`attempts:user:${attempt.userId}`, attempt.id);
  await appendIndex(`attempts:test:${attempt.testId}`, attempt.id);
}
export async function listAttempts(): Promise<Attempt[]> {
  const ids = (await readRecord<string[]>("attempts")) ?? [];
  return (await Promise.all(ids.map(getAttempt))).filter((attempt): attempt is Attempt => Boolean(attempt));
}
export async function listAttemptsForUser(userId: string): Promise<Attempt[]> {
  const ids = (await readRecord<string[]>(`attempts:user:${userId}`)) ?? [];
  return (await Promise.all(ids.map(getAttempt))).filter((attempt): attempt is Attempt => Boolean(attempt));
}
export async function getAdmin(): Promise<AdminCredentials | undefined> {
  return readRecord<AdminCredentials>("admin");
}
export async function saveAdmin(credentials: AdminCredentials): Promise<void> {
  await writeRecord("admin", credentials);
}
