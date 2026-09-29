import { expect, it } from 'vitest';
import { message } from './messages';

it('requires named values and keeps user text as plain message content', () => {
  expect(() => message('en', 'noCover')).toThrow('Missing message value: title');
  expect(message('en', 'noCover', { title: '<img src=x onerror=alert(1)>' }))
    .toBe('No cover · <img src=x onerror=alert(1)>');
});
