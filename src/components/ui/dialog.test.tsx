import { describe, expect, it } from 'vitest';
import { declaresOwnWidth } from './dialog';

/**
 * The rule these pin: a width the caller states must win over the default.
 * 135 call sites were rendering at 512px because it did not.
 */
describe('declaresOwnWidth', () => {
  it('sees an unprefixed width, wherever it sits in the class list', () => {
    expect(declaresOwnWidth('max-w-5xl')).toBe(true);
    expect(declaresOwnWidth('flex flex-col max-w-2xl overflow-hidden')).toBe(true);
    expect(declaresOwnWidth('h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl p-4')).toBe(true);
  });

  it('counts max-w-none — a full-bleed dialog is stating a width too', () => {
    expect(declaresOwnWidth('max-w-none')).toBe(true);
  });

  it('does not see a breakpoint-only width, so the default still covers below it', () => {
    // The one shape that already worked: it opts into the default deliberately.
    expect(declaresOwnWidth('lg:max-w-4xl xl:max-w-5xl')).toBe(false);
    expect(declaresOwnWidth('sm:max-w-lg')).toBe(false);
  });

  it('is not fooled by a class that merely ends in something similar', () => {
    expect(declaresOwnWidth('group-hover:max-w-xl')).toBe(false);
    expect(declaresOwnWidth('data-[state=open]:max-w-xl')).toBe(false);
  });

  it('treats no className as no stated width', () => {
    expect(declaresOwnWidth(undefined)).toBe(false);
    expect(declaresOwnWidth('')).toBe(false);
    expect(declaresOwnWidth('flex flex-col gap-4')).toBe(false);
  });
});
