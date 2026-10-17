/**
 * How a one-time code actually gets sent and checked. The OTP rules (expiry,
 * resend limits, attempt limits, single use) live in OtpService and apply to
 * every provider; a provider only knows how to deliver and verify a code.
 */
export interface OtpProvider {
  /** Starts a verification for `to` (E.164 number such as +919876543210). */
  start(
    to: string,
    mobile: string,
  ): Promise<{ codeHash?: string; devCode?: string }>;
  /** True when `code` is correct for the verification started for `to`. */
  check(
    to: string,
    mobile: string,
    code: string,
    stored: { codeHash: string | null },
  ): Promise<boolean>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
