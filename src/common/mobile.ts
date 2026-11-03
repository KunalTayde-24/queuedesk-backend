import { registerDecorator, ValidationOptions } from 'class-validator';

/** International format: "+" then 8-15 digits, first digit not 0 (e.g. +6591234567). */
const E164 = /^\+[1-9]\d{7,14}$/;
const SINGAPORE = /^\+65[3689]\d{7}$/;

export function isValidMobile(value: unknown): value is string {
  if (typeof value !== 'string' || !E164.test(value)) return false;
  // Singapore numbers are 8 digits and start with 3, 6, 8 or 9.
  return value.startsWith('+65') ? SINGAPORE.test(value) : true;
}

/**
 * Numbers are stored with their country code ("+6591234567"). Older records hold
 * only the national digits, so those get the default country code added.
 */
export function toE164(mobile: string, defaultCode: string): string {
  return mobile.startsWith('+') ? mobile : `${defaultCode}${mobile}`;
}

/** class-validator decorator: a mobile number in international format. */
export function IsMobile(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMobile',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Enter a valid mobile number with its country code, e.g. +65 9123 4567',
        ...options,
      },
      validator: { validate: (value: unknown) => isValidMobile(value) },
    });
  };
}
