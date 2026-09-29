import { toUrlList } from '../../../src/app/utils/cognito-oauth-urls';

describe('toUrlList', () => {
  it('returns an empty array for undefined', () => {
    expect(toUrlList(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(toUrlList('')).toEqual([]);
  });

  it('wraps a single URL with no comma', () => {
    expect(toUrlList('https://app.example.com/auth/callback')).toEqual(['https://app.example.com/auth/callback']);
  });

  it('splits comma-separated URLs', () => {
    expect(toUrlList('https://a.example/auth/callback,https://b.example/auth/callback')).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ]);
  });

  it('trims surrounding whitespace', () => {
    expect(toUrlList(' https://a.example/auth/callback , https://b.example/auth/callback ')).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ]);
  });

  it('drops a trailing comma', () => {
    expect(toUrlList('https://a.example/auth/callback,')).toEqual(['https://a.example/auth/callback']);
  });
});
