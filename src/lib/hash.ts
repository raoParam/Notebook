import type { AttachmentEntry } from './db';

/**
 * Compute a SHA-256 hash of note content + serialized attachments.
 * Uses the native browser SubtleCrypto API — no external dependency.
 */
export async function computeContentHash(
  content: string,
  attachments: Record<string, AttachmentEntry>
): Promise<string> {
  // Stable serialization: sort attachment keys
  const attString = JSON.stringify(
    Object.fromEntries(
      Object.entries(attachments)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, v.data])
    )
  );
  const raw = content + '\x00' + attString;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a cryptographically random 12-char alphanumeric room code */
export function generateRoomCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
}
