import { describe, expect, it } from 'vitest';
import { getInlineGlyph, OpenAIGlyph } from '@/components/integrations/brandGlyphs';
import { getBrandProfile } from './brandProfiles';

describe('brand registry lookups', () => {
  it('returns registered brand assets', () => {
    expect(getBrandProfile('openai')).toMatchObject({ slug: 'openai', color: '10A37F' });
    expect(getInlineGlyph('openai')).toBe(OpenAIGlyph);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'rejects inherited object property %s',
    (id) => {
      expect(getBrandProfile(id)).toBeUndefined();
      expect(getInlineGlyph(id)).toBeUndefined();
    },
  );
});
