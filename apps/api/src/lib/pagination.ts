/** Opaque keyset cursor over (created_at, id), newest first. */
export const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
