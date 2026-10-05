import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP's recommended minimums (19 MiB, 2 passes).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns the same time as a real check, so unknown emails cannot be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('twynn-timing-equaliser');
  await verifyPassword(await dummyHash, password);
  return false;
}
