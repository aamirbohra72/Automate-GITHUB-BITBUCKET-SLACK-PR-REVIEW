import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  return verifySignature(rawBody, signature, secret, 'sha256=');
}

export function verifyBitbucketSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  return verifySignature(rawBody, signature, secret, 'sha256=');
}

function verifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
  prefix: string
): boolean {
  if (!signature?.startsWith(prefix)) return false;
  const receivedHex = signature.slice(prefix.length);
  if (!/^[a-fA-F0-9]{64}$/.test(receivedHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
