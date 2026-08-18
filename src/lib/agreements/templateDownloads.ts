/**
 * Getting a blank template into somebody's hands.
 *
 * The Word file is built ENTIRELY IN THE BROWSER from the locked content
 * module. That is not an optimisation — it is the architecture the neutral
 * position asks for: no request is made, so there is no server-side record
 * that a template was taken, by whom, or for which partner. The platform
 * cannot report on something it never observed.
 *
 * It is also what lets the Finance Portal offer the same downloads as the
 * Command Centre without a partner-facing render endpoint, and therefore
 * without the two sides diverging in what they can get.
 */
import {
  agreementTemplate,
  type AgreementTemplateKey,
} from '@/lib/agreements';
import {
  buildAgreementDocx,
  agreementDocxFileName,
  loadDocxLogo,
  type AgreementDocxBrand,
} from '@/lib/agreements/docx';

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface TemplateBrandInput {
  brandColour?: string | null;
  logoSource?: string | null;
}

/**
 * The downloader's own mark on their own copy.
 *
 * Only colour and logo — deliberately not an identity block. A blank template
 * pre-filled with one side's legal entity reads as that side's offer rather
 * than a neutral starting point, and whoever downloads it should be making
 * that choice themselves in Word.
 *
 * A missing or slow logo costs the document its cover image and nothing else;
 * the download itself never fails on it.
 */
export async function templateBrand(input: TemplateBrandInput = {}): Promise<AgreementDocxBrand> {
  let logo: AgreementDocxBrand['logo'] = null;
  try {
    logo = input.logoSource ? await loadDocxLogo(input.logoSource) : null;
  } catch {
    logo = null;
  }
  return { brandColour: input.brandColour ?? null, logo };
}

/**
 * The blank template as Word.
 *
 * `includeTemplatePack` keeps the guidance pages and prints every negotiable
 * field as its original bracket text, so the recipient can see exactly what is
 * theirs to complete. Values are empty by design: this is a starting point,
 * not a prepared offer.
 */
export async function downloadAgreementTemplateDocx(
  templateKey: AgreementTemplateKey,
  brand: AgreementDocxBrand = {},
): Promise<void> {
  const blob = await buildAgreementDocx(templateKey, {}, { brand, includeTemplatePack: true });
  saveBlob(blob, agreementDocxFileName(agreementTemplate(templateKey).title, null, 'template'));
}
