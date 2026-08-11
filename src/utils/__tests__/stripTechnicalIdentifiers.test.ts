import { describe, expect, it } from 'vitest';
import { stripLabelledIdentifiers, stripTechnicalIdentifiers } from '../stripTechnicalIdentifiers';

describe('stripLabelledIdentifiers', () => {
  it('removes labelled uuid fragments', () => {
    expect(stripLabelledIdentifiers('Rates held (source_id: 123e4567-e89b-12d3-a456-426614174000) today.'))
      .toBe('Rates held today.');
  });

  it('preserves markdown paragraph breaks and heading lines', () => {
    // Regression: the whitespace collapse used \s{2,}, which flattened every
    // \n\n into a space — markdown answers rendered as one blob with literal
    // "## Risks and caveats" glued mid-sentence.
    const markdown = 'Opening paragraph.\n\n## Risks and caveats\n\nThe main risk is the wealth effect.';
    expect(stripLabelledIdentifiers(markdown)).toBe(markdown);
  });

  it('still collapses runs of spaces within a line', () => {
    expect(stripLabelledIdentifiers('too   many    spaces')).toBe('too many spaces');
  });
});

describe('stripTechnicalIdentifiers', () => {
  it('removes bare uuids from single-line prose', () => {
    expect(stripTechnicalIdentifiers('Update 123e4567-e89b-12d3-a456-426614174000 published.'))
      .toBe('Update published.');
  });
});
