import { createHash } from 'node:crypto';

export function computeETag(payload: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `"${digest.slice(0, 32)}"`;
}

export function matchesETag(incomingEtag: string | null, payload: unknown): boolean {
  return incomingEtag !== null && incomingEtag === computeETag(payload);
}
