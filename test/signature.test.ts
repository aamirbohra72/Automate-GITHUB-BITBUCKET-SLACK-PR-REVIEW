import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyBitbucketSignature, verifyGitHubSignature } from '../src/security/signature.js';

const secret = 'test-secret';
const body = Buffer.from('{"action":"opened"}');
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('webhook signatures', () => {
  it('verifies GitHub signatures against the raw body', () => {
    expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
    expect(verifyGitHubSignature(Buffer.from('{}'), signature, secret)).toBe(false);
  });

  it('rejects absent, malformed, and invalid signatures for Bitbucket', () => {
    expect(verifyBitbucketSignature(body, undefined, secret)).toBe(false);
    expect(verifyBitbucketSignature(body, 'sha256=abc', secret)).toBe(false);
    expect(verifyBitbucketSignature(body, signature, 'wrong-secret')).toBe(false);
  });
});
