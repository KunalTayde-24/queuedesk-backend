import { createHash, timingSafeEqual } from 'crypto';

/** One-way hash of a code, tied to the mobile number, so a code is never stored in plain text. */
export function hashOtp(secret: string, mobile: string, code: string): string {
  return createHash('sha256').update(`${secret}:${mobile}:${code}`).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
