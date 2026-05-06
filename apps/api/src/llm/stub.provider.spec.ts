import { describe, expect, it } from 'vitest';
import {
  StubProvider,
  extractDeadline,
  extractEmail,
  extractKeyword,
  extractMoney,
} from './stub.provider';

describe('stub extractor helpers', () => {
  describe('extractMoney', () => {
    it('returns the last dollar amount when the user revises budget', () => {
      // Tech-debt A1 regression: turn 1 = $5,000, turn 2 = $10,000. The
      // "Lead captured" pill must reflect the newest value, not the first.
      const transcript =
        'USER: I want a website for $5,000\nASSISTANT: got it\nUSER: actually make it $10,000';
      expect(extractMoney(transcript)).toBe('$10,000');
    });

    it('returns the last "Nk" match when the user revises budget', () => {
      const transcript = 'I was thinking 5k at first, bumping up to 12k now.';
      expect(extractMoney(transcript)).toBe('12k');
    });

    it('returns null when no money is mentioned', () => {
      expect(extractMoney('no numbers here')).toBeNull();
    });

    // Regression for Devin Review finding on PR #8: a prior revision of
    // the regex used `(?:,\d{3})*` (zero-or-more), which caused the
    // comma-formatted alternative to succeed on `$1000` as just `$100`
    // and stop before trying the plain-digit fallback. `+` (one-or-more)
    // forces a real comma group before the first alternative fires.
    it.each([
      ['$1000', '$1000'],
      ['$5000', '$5000'],
      ['$10000', '$10000'],
      ['$5', '$5'],
      ['$99.99', '$99.99'],
    ])('returns the full plain-digit amount for %s', (input, expected) => {
      expect(extractMoney(input)).toBe(expected);
    });

    it('still matches comma-formatted amounts without swallowing trailing commas', () => {
      expect(extractMoney('budget $10,000, deadline soon')).toBe('$10,000');
      expect(extractMoney('paid $1,234,567.89 total')).toBe('$1,234,567.89');
    });
  });

  describe('extractDeadline', () => {
    it('returns the last deadline when the user revises timeline', () => {
      const transcript =
        'USER: in 6 weeks\nASSISTANT: ok\nUSER: actually we need it in 3 weeks';
      expect(extractDeadline(transcript)).toBe('in 3 weeks');
    });

    it('prefers the newest qualitative deadline', () => {
      expect(extractDeadline('Originally Q1, but now ASAP please')).toMatch(/asap/i);
    });

    it('returns null when no deadline is mentioned', () => {
      expect(extractDeadline('no dates here')).toBeNull();
    });
  });

  describe('extractKeyword', () => {
    it('returns the word whose last occurrence is latest in the text', () => {
      // User first mentions "website", then pivots to "mobile app". The
      // latest keyword is "app" (after "mobile") — either word captures
      // the pivot away from "website", which is the regression being fixed.
      const transcript = 'Started wanting a website. Changed my mind — mobile app please.';
      expect(extractKeyword(transcript, ['website', 'app', 'mobile', 'crm', 'ai'])).toBe('app');
    });

    it('is case-insensitive', () => {
      expect(extractKeyword('Need a CRM', ['crm'])).toBe('crm');
    });

    it('returns null when none of the words appear', () => {
      expect(extractKeyword('hello world', ['crm', 'ai'])).toBeNull();
    });
  });

  describe('extractEmail', () => {
    it('returns the first email (single-turn field, no revision case)', () => {
      expect(extractEmail('reach me at foo@bar.com')).toBe('foo@bar.com');
    });
  });
});

describe('StubProvider.complete — lead extractor path', () => {
  it('returns newest budget + deadline when called with a multi-turn transcript', async () => {
    const provider = new StubProvider();
    const raw = await provider.complete({
      json: true,
      messages: [
        { role: 'system', content: 'lead extractor' },
        {
          role: 'user',
          content:
            'USER: website for $5,000 in 6 weeks\nASSISTANT: ok\nUSER: budget is now $10,000, deadline in 3 weeks',
        },
      ],
    });
    const parsed = JSON.parse(raw) as {
      budget: string | null;
      deadline: string | null;
      service: string | null;
    };
    expect(parsed.budget).toBe('$10,000');
    expect(parsed.deadline).toBe('in 3 weeks');
    expect(parsed.service).toBe('website');
  });
});
