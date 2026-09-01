/**
 * Builder Stock — the picture a builder hands over directly.
 *
 * WHY THIS EXISTS, MEASURED. Every image this product serves is READ out of
 * something: a column naming a URL, a brochure page naming a lot, a page
 * cover, a design brochure. That works until there is nothing to read — and on
 * the one live source, thirteen of twenty-six published properties attach no
 * document at all. The pipeline's own fallbacks then offered, for those rows,
 * a Simonds display home, an ABC Homes display home and the land developer's
 * estate marketing, and refused every one of them, correctly. Those cards were
 * blank because there was nothing to read, and no reader fixes that.
 *
 * The one party who certainly has the picture is the builder, and the product
 * gave them no way to hand it over.
 *
 * Two routes, one act. A render FOR A DESIGN serves every row of theirs
 * stating it — three uploads cover those thirteen properties and every future
 * one — and a picture FOR ONE PROPERTY is the exception and the guarantee.
 *
 * NEITHER INVENTS A LEVEL OR A STAGE, which is what these tests are mostly
 * about: a builder-supplied image is `uploaded_document` / `source_supplied`,
 * so it travels the existing ladder unchanged and is subject to every rule
 * that already governs a builder's own picture — including the promotional
 * overlay rule that refuses a facade with "$25,000 REBATE" set over it.
 */
import { describe, expect, it } from 'vitest';

import {
  designImageKey, designOfStoredRow, designsInStock, designImageStoragePath,
  isBuilderSuppliedPath, propertiesForDesign, propertyImageStoragePath,
} from '../../../supabase/functions/_shared/builderStock/builderSuppliedImage.pure';
import {
  DESIGN_EVIDENCE_LEVEL, PRIMARY_ROLE, comparePrimaryEvidence,
  roleFromBuilderDesign, roleFromBuilderProperty, roleFromPropertyCover,
} from '../../../supabase/functions/_shared/builderStock/sourceImageRole.pure';
import {
  builderImageReference,
} from '../../../supabase/functions/_shared/builderStock/attachBuilderImage';

const ORG = '11111111-2222-3333-4444-555555555555';

describe('a design key is exact, and never clever', () => {
  it('reads one design however the builder types it', () => {
    const key = designImageKey('DK 22B');
    expect(key).toBeTruthy();
    for (const spelling of ['dk 22b', 'DK-22B', '  DK  22B  ', 'DK_22b']) {
      expect(designImageKey(spelling)).toBe(key);
    }
  });

  it('NEVER REACHES A NEIGHBOURING DESIGN — one character apart is a different house', () => {
    expect(designImageKey('DK 22B')).not.toBe(designImageKey('DK 23B'));
    expect(designImageKey('DK 22B')).not.toBe(designImageKey('DK 22A'));
    expect(designImageKey('Elara 18')).not.toBe(designImageKey('Elara 21'));
  });

  it('accepts a short design name, because nothing here is inferred', () => {
    /*
     * `designIdentityIsDistinctive` refuses `DK 22B` — two tokens, neither of
     * them three letters — and it is right to, because it asks whether a name
     * can identify a DOCUMENT from somebody's prose. There is no prose here:
     * the builder picks a design their own stock states and the render reaches
     * a property only on exact key equality inside one organisation. Applying
     * a text-matching rule to that would refuse the eleven live properties
     * this feature exists for.
     */
    expect(designImageKey('DK 22B')).toBe('dk22b');
    expect(designImageKey('  ')).toBeNull();
    expect(designImageKey(null)).toBeNull();
    expect(designImageKey('!!!')).toBeNull();
  });

  it('serves exactly the properties stating it, and no others', () => {
    const rows = [
      { id: 'a', house_design: 'DK 22B' },
      { id: 'b', house_design: 'dk-22b' },
      { id: 'c', house_design: 'DK 23B' },
      { id: 'd', house_design: 'Urban 19' },
      { id: 'e', house_design: null },
    ];
    expect(propertiesForDesign(rows, 'DK 22B').map((row) => row.id)).toEqual(['a', 'b']);
    expect(propertiesForDesign(rows, 'DK 23B').map((row) => row.id)).toEqual(['c']);
    expect(propertiesForDesign(rows, '').map((row) => row.id)).toEqual([]);
  });
});

describe('the designs a builder is offered are their own stock\'s', () => {
  it('lists what the rows state, with the one that fixes most cards first', () => {
    const designs = designsInStock([
      ...Array.from({ length: 11 }, () => ({ house_design: 'DK 22B', hasImage: false })),
      { house_design: 'DK 22A', hasImage: false },
      { house_design: 'Urban 19', hasImage: true },
      { house_design: 'Urban 19', hasImage: true },
      { house_design: null, hasImage: false },
    ]);
    expect(designs.map((design) => [design.label, design.properties, design.withoutImage]))
      .toEqual([['DK 22B', 11, 11], ['DK 22A', 1, 1], ['Urban 19', 2, 0]]);
  });

  it('reads the design from the canonical field, or from where an older import left it', () => {
    expect(designOfStoredRow({ house_design: 'Urban 19' })).toBe('Urban 19');
    // Imported before the `HOUSE` column was mappable — which is every row
    // this feature was built for.
    expect(designOfStoredRow({ house_design: null, unmapped: { HOUSE: 'DK 22B' } })).toBe('DK 22B');
    // The canonical field wins where both are present.
    expect(designOfStoredRow({ house_design: 'Urban 19', unmapped: { HOUSE: 'DK 22B' } }))
      .toBe('Urban 19');
    expect(designOfStoredRow({ unmapped: { HOUSE: '   ' } })).toBeNull();
    expect(designOfStoredRow(null)).toBeNull();
  });
});

describe('what a builder supplies carries the evidence it deserves — no more', () => {
  it('a picture for THIS property is level 1: the builder said so directly', () => {
    const role = roleFromBuilderProperty({ suppliedBy: 'builder', property: 'Lot 231' });
    expect(role.role).toBe(PRIMARY_ROLE);
    expect(role.evidenceLevel).toBe(1);
    expect(role.reason).toContain('directly');
  });

  it('a render for a DESIGN sits on the design rung, and a document outranks it', () => {
    const design = roleFromBuilderDesign({ suppliedBy: 'builder', design: 'DK 22B' });
    expect(design.role).toBe(PRIMARY_ROLE);
    expect(design.evidenceLevel).toBe(DESIGN_EVIDENCE_LEVEL);

    // A brochure page naming this lot takes the card back the moment one is
    // read. That is what a builder means by supplying a stand-in, and it is
    // why this is not a new level.
    const cover = roleFromPropertyCover({
      where: 'visible page 2', identity: 'Lot 231', packageFacts: ['a package price'],
    });
    expect(comparePrimaryEvidence(cover.evidenceLevel, design.evidenceLevel)).toBeLessThan(0);

    // And a picture the builder attached to THIS property outranks both.
    const direct = roleFromBuilderProperty({ suppliedBy: 'builder', property: 'Lot 231' });
    expect(comparePrimaryEvidence(direct.evidenceLevel, cover.evidenceLevel)).toBeLessThan(0);
  });

  it('records who supplied it, because staff acting for a builder is a different act', () => {
    expect(roleFromBuilderProperty({ suppliedBy: 'staff', property: 'Lot 231' }).evidence)
      .toContain('on the builder\'s behalf');
    expect(roleFromBuilderDesign({ suppliedBy: 'builder', design: 'DK 22B' }).evidence)
      .toContain('supplied by the builder');
  });
});

describe('a supplied image replaces its predecessor rather than joining it', () => {
  it('one reference per design, and one per property picture', () => {
    // A corrected render must REPLACE the one before it. Left beside it, the
    // old picture is still eligible and still competing for the card.
    const first = builderImageReference({ designImageId: 'design-1', storagePath: 'a/b/c.jpg' });
    const second = builderImageReference({ designImageId: 'design-1', storagePath: 'a/b/d.jpg' });
    expect(second).toBe(first);

    // A per-property picture is keyed by its own object, so two different
    // pictures for one property are two rows — which is a gallery, correctly.
    expect(builderImageReference({ storagePath: 'x/y/1.jpg' }))
      .not.toBe(builderImageReference({ storagePath: 'x/y/2.jpg' }));
  });
});

describe('a storage path is written by this product, or it is not read', () => {
  it('names each object under a prefix this product owns', () => {
    const design = designImageStoragePath({
      organisationId: ORG, designKey: 'dk22b', filename: 'render.jpg',
    });
    const property = propertyImageStoragePath({
      organisationId: ORG, stockItemId: ORG, filename: 'facade.jpg',
    });
    expect(design.startsWith(`builder-designs/${ORG}/`)).toBe(true);
    expect(property.startsWith(`builder-supplied/${ORG}/`)).toBe(true);
    expect(isBuilderSuppliedPath(design)).toBe(true);
    expect(isBuilderSuppliedPath(property)).toBe(true);
  });

  it('REFUSES ANYTHING ELSE — a path in a request body is a lookup key, never authority', () => {
    for (const refused of [
      '',
      null,
      '/etc/passwd',
      `builder-designs/${ORG}/../../secrets/key.jpg`,
      'stock-lists/other-org/list.xlsx',
      `builder-designs/${ORG}/dk22b`,
      'builder-designs/not-a-uuid/dk22b/render.jpg',
      'https://example.invalid/render.jpg',
    ]) {
      expect(isBuilderSuppliedPath(refused), String(refused)).toBe(false);
    }
  });
});
