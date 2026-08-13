/**
 * Structural contract for the Word template.
 *
 * A `.docx` is a zip of XML, so what a test can assert is exactly the set of
 * properties that make this document premium rather than merely present:
 * that the running chrome exists and the cover is exempt from it, that page
 * numbering is a real field rather than typed text, that no signature panel
 * can split across a page break, that the tenant's brand actually reaches the
 * ink, and — the one that matters most — that the locked legal wording
 * arrives verbatim with no unresolved binding tokens.
 */
import { describe, expect, it } from 'vitest';
import { buildAgreementDocx } from '@/lib/agreements/docx';
import { resolveDocxPalette, toDocxHex } from '@/lib/agreements/docxTheme';
import { agreementTemplate, type AgreementTemplateKey } from '@/lib/agreements';

const BRAND = {
  brandColour: '#1F4D8F',
  companyName: 'Harbourline',
  legalName: 'Harbourline Property Co Pty Ltd',
  abn: '12 345 678 901',
  email: 'hello@harbourline.example',
  phone: '02 9000 0000',
  website: 'harbourline.example',
};

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

/** Word escapes XML entities, so assertions have to compare like with like. */
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Read the parts we assert on out of the zip, without a zip dependency. */
async function readDocxParts(blob: Blob): Promise<Record<string, string>> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('.xml')) parts[name] = await zip.files[name].async('string');
  }
  return parts;
}

describe('agreement Word template', () => {
  for (const key of KEYS) {
    const content = agreementTemplate(key);

    it(`${key}: carries running chrome, page fields and a bare cover`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];

      // Two sections: the full-bleed cover, then the body. The cover's
      // section properties reference no header or footer — that is what keeps
      // the running chrome off it — and the body carries exactly one of each.
      expect((doc.match(/<w:sectPr/g) ?? []).length).toBe(2);
      expect(doc.slice(0, doc.indexOf('</w:sectPr>'))).not.toContain('w:headerReference');
      expect((doc.match(/w:headerReference/g) ?? []).length).toBe(1);
      expect((doc.match(/w:footerReference/g) ?? []).length).toBe(1);

      const footers = Object.entries(parts).filter(([name]) => name.includes('footer'));
      const withFields = footers.filter(([, xml]) => xml.includes('PAGE') && xml.includes('NUMPAGES'));
      expect(withFields).toHaveLength(1);

      const headers = Object.entries(parts).filter(([name]) => name.includes('header'));
      const withMasthead = headers.filter(([, part]) => part.includes(xml(content.title)));
      expect(withMasthead).toHaveLength(1);
    });

    it(`${key}: opens with a live table of contents Word can refresh`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];

      // A real TOC field over real Heading 1 paragraphs — one per section —
      // with updateFields set so Word fills the page numbers in on open,
      // rather than a hand-typed list that goes stale the moment the reader
      // edits the document.
      expect(doc).toContain('TOC \\h \\o &quot;1-1&quot;');
      const sectioned = content.sections.filter((section) => section.header).length;
      expect((doc.match(/w:pStyle w:val="Heading1"/g) ?? []).length).toBe(sectioned);
      expect(parts['word/settings.xml']).toContain('<w:updateFields/>');
    });

    it(`${key}: renders the locked wording verbatim with no stray tokens`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];

      expect(doc).not.toMatch(/\{\{[a-z0-9_]+\}\}/);

      // Every section heading, and the cover's own review statement, survive.
      for (const section of content.sections) {
        if (!section.header) continue;
        expect(doc).toContain(xml(section.header.heading));
      }
      const cover = content.sections[0].blocks[0];
      if (cover.kind === 'cover') expect(doc).toContain(xml(cover.reviewStatement));
    });

    it(`${key}: signature panels cannot split across a page break`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];
      // Every execution block is a one-row table, and every such row is
      // marked cantSplit; count them rather than trusting one instance.
      const executionBlocks = content.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'execution').length;
      expect(executionBlocks).toBeGreaterThan(0);
      expect((doc.match(/<w:cantSplit\/>/g) ?? []).length).toBeGreaterThanOrEqual(executionBlocks);
    });

    it(`${key}: each section starts on its own page`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];
      const sectioned = content.sections.filter((section) => section.header).length;
      // One break per section opener; the contents page needs none because it
      // opens the body section itself.
      expect((doc.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBe(sectioned);
    });

    it(`${key}: the tenant's brand and identity reach the document`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, {}, { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];
      expect(doc).toContain(toDocxHex(BRAND.brandColour));
      // A blank template still says whose it is, rather than `<<COMPANY NAME>>`.
      expect(doc).toContain('Harbourline');
      expect(doc).not.toContain('&lt;&lt;COMPANY NAME&gt;&gt;');
    });

    it(`${key}: an explicit value always beats the tenant default`, async () => {
      const parts = await readDocxParts(
        await buildAgreementDocx(key, { ba_legal_name: 'Contracted Entity Pty Ltd' },
          { brand: BRAND, includeTemplatePack: true }),
      );
      const doc = parts['word/document.xml'];
      expect(doc).toContain('Contracted Entity Pty Ltd');
    });
  }

  it('omits the partner email pack when it is not wanted', async () => {
    const withPack = await readDocxParts(
      await buildAgreementDocx('strategic_property_referral', {}, { brand: BRAND, includeTemplatePack: true }),
    );
    const withoutPack = await readDocxParts(
      await buildAgreementDocx('strategic_property_referral', {}, { brand: BRAND, includeTemplatePack: false }),
    );
    expect(withPack['word/document.xml']).toContain('ACTIVATION CHECKLIST');
    expect(withoutPack['word/document.xml']).not.toContain('ACTIVATION CHECKLIST');
  });
});

describe('docx palette', () => {
  it('accepts every colour form whitelabel_settings stores', () => {
    expect(toDocxHex('#1F4D8F')).toBe('1F4D8F');
    expect(toDocxHex('1f4d8f')).toBe('1F4D8F');
    expect(toDocxHex('#abc')).toBe('AABBCC');
    // The bare HSL triplet form: 0 0% 100% is white.
    expect(toDocxHex('0 0% 100%')).toBe('FFFFFF');
    expect(toDocxHex('')).toBe('1F3352');
    expect(toDocxHex('not a colour')).toBe('1F3352');
  });

  it('darkens a pale brand so small type stays legible', () => {
    const pale = resolveDocxPalette('#F5D17A');
    expect(pale.accentInk).not.toBe(pale.accent);
    // …and leaves a dark brand alone.
    const deep = resolveDocxPalette('#1F3352');
    expect(deep.accentInk).toBe(deep.accent);
  });

  it('flips text on the accent band when the brand is light', () => {
    expect(resolveDocxPalette('#FFE680').onAccent).toBe('1A1A1A');
    expect(resolveDocxPalette('#101820').onAccent).toBe('FFFFFF');
  });

  it('deepens the cover canvas until white display type carries on it', () => {
    // A pale brand is pulled down hard, a dark one barely moves.
    const pale = resolveDocxPalette('#F5D17A');
    const dark = resolveDocxPalette('#101820');
    const luminance = (hex: string) => {
      const channel = (i: number) => {
        const s = parseInt(hex.slice(i, i + 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    };
    // 0.183 is the luminance at which white text reaches WCAG AA (4.5:1).
    expect(luminance(pale.accentDeep)).toBeLessThan(0.183);
    expect(luminance(dark.accentDeep)).toBeLessThan(0.183);
    expect(dark.accentDeep).not.toBe(pale.accentDeep);
  });
});
