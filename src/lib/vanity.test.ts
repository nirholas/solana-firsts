import { describe, expect, it } from 'vitest';
import { MAX_VANITY_CHARACTERS, expectedAttempts, formatDuration, validateVanity } from './vanity';

const request = (prefix: string, suffix = '', caseSensitive = false) => ({ prefix, suffix, caseSensitive });

describe('vanity search inputs', () => {
  it('rejects patterns Base58 can never produce', () => {
    expect(() => validateVanity(request(''))).toThrow('prefix, a suffix, or both');
    expect(() => validateVanity(request('h0llo'))).toThrow('0, O, I, and l');
    expect(() => validateVanity(request('a'.repeat(MAX_VANITY_CHARACTERS + 1)))).toThrow('at most');
    expect(() => validateVanity(request('art', 'fun'))).not.toThrow();
  });
});

describe('search difficulty', () => {
  it('counts a case-insensitive letter as roughly half the work of an exact one', () => {
    expect(expectedAttempts(request('a'))).toBe(29);
    expect(expectedAttempts(request('a', '', true))).toBe(58);
    expect(expectedAttempts(request('ab'))).toBe(29 * 29);
  });

  it('charges full price for digits, which have no case twin', () => {
    expect(expectedAttempts(request('7'))).toBe(58);
  });

  it('grows exponentially with pattern length', () => {
    expect(expectedAttempts(request('art', 'fun'))).toBe(29 ** 6);
  });
});

describe('duration formatting', () => {
  it('scales the unit to the wait', () => {
    expect(formatDuration(0.2)).toBe('1s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(7_200)).toBe('2.0h');
    expect(formatDuration(172_800)).toBe('2d');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('unknown');
  });
});
