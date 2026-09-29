import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, pluralCategory, resolveLocale } from './locale';
import { message } from './messages';

describe('local language selection', () => {
  it('uses an explicit choice before the first browser language', () => {
    expect(resolveLocale('pt-BR', ['en-US'])).toBe('pt-BR');
    expect(resolveLocale('en', ['pt-BR'])).toBe('en');
    expect(resolveLocale(null, ['en-GB', 'pt-BR'])).toBe('en');
    expect(resolveLocale(null, ['fr-FR', 'en-US'])).toBe('pt-BR');
    expect(resolveLocale(null, [])).toBe('pt-BR');
  });
  it('uses local formatters and complete catalog entries', () => {
    expect(formatNumber('pt-BR', 1234)).toBe('1.234');
    expect(formatNumber('en', 1234)).toBe('1,234');
    const date = new Date('2026-09-29T12:00:00Z');
    expect(formatDate('pt-BR', date, { timeZone: 'UTC', month: 'long' })).toBe('setembro');
    expect(formatDate('en', date, { timeZone: 'UTC', month: 'long' })).toBe('September');
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 2)).toBe('other');
    expect(pluralCategory('pt-BR', 0)).toBe('other');
    expect(message('en', 'settings')).toBe('Settings');
  });
});
