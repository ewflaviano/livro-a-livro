// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockPwaUpdate, getPwaState } from './register';

describe('update guards', () => {
  it('stays blocked until all drafts and operations release their own locks', () => {
    const finishDraft = blockPwaUpdate(); const finishOperation = blockPwaUpdate();
    finishDraft(); expect(getPwaState().blocked).toBe(true);
    finishOperation(); expect(getPwaState().blocked).toBe(false);
    finishOperation(); expect(getPwaState().blocked).toBe(false);
  });
});
