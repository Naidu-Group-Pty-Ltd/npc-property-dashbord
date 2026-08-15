/**
 * Builder stock — reading the package a stock row links to.
 *
 * A row of the live Notion list carries one link of its own: "Complete Package
 * Pack", a Google Drive folder. Forty-four of the forty-five rows without a
 * cover point at the SAME folder, so the link alone attributes nothing — it is
 * an estate's document library, not a property's photograph.
 *
 * What makes attribution deterministic is that the library NAMES its contents:
 *
 *     Tweed Heads/Tweed Heads Packages/Lot 43/Lot 43 - Stradbroke 180 - Property Package.pdf
 *
 * and the stock row is "Lot 43 — Tringa Street, Sandpiper Estate … [Stradbroke
 * 180]". The folder names the lot and the file names the lot AND the house
 * design, which together are exactly one stock row. That is the source stating
 * the relationship, not us inferring one from a resemblance.
 *
 * THE RULES THIS MODULE ENFORCES:
 *   • EXACTLY ONE, or nothing. One folder named for the lot, one file naming
 *     that lot and that design. Two candidates is not a near miss — it is the
 *     source declining to say, and the answer is no image.
 *   • NOTHING OUTSIDE THE LINKED FOLDER. Descent is bounded and downward only;
 *     no id is ever constructed, guessed or followed out of the tree the row
 *     itself pointed at.
 *
 * Pure: no imports, no IO, no clock.
 */

/** One entry of a public Drive folder listing. */
export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
}

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive's public surfaces, and nothing else may be fetched as a package. */
export function isGoogleDriveHost(host: string): boolean {
  const clean = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return clean === 'drive.google.com' || clean === 'docs.google.com'
    || clean === 'drive.usercontent.google.com';
}

/** The folder a link points at, when it points at one. */
export function driveFolderId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isGoogleDriveHost(url.hostname)) return null;
    const match = /\/(?:drive\/(?:u\/\d+\/)?folders|drive\/folders)\/([A-Za-z0-9_-]{10,})/
      .exec(url.pathname);
    if (match) return match[1];
    if (/\/(?:drive|open)\/?$/.test(url.pathname)) {
      const id = url.searchParams.get('id');
      return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The single file a link points at, for a row that links a document directly. */
export function driveFileId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isGoogleDriveHost(url.hostname)) return null;
    const match = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
    if (match) return match[1];
    if (url.pathname === '/uc' || url.pathname === '/open') {
      const id = url.searchParams.get('id');
      return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export const driveFolderUrl = (id: string): string =>
  `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

/**
 * The public download address for a file.
 *
 * `uc?export=download` is what a logged-out browser follows from a shared
 * link. Nothing authenticated is involved, and a file that is not actually
 * shared answers with a sign-in page — which the byte check downstream refuses
 * as "not an image", rather than storing somebody's login screen.
 */
export const driveDownloadUrl = (id: string): string =>
  `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;

/**
 * Decode the listing a public folder page carries.
 *
 * A shared Drive folder renders client-side, but the response embeds the
 * listing as `window['_DRIVE_ivd']` — a hex-escaped JSON array, which is what
 * the page's own script parses. This reads that JSON. NO SCRIPT IS EXECUTED
 * and nothing is fetched here; a folder that is not public carries no listing
 * and yields an empty array, which is the correct answer for it.
 */
export function parseDriveFolderListing(html: string): DriveEntry[] {
  const match = /window\['_DRIVE_ivd'\]\s*=\s*'((?:[^'\\]|\\.)*)'/.exec(String(html ?? ''));
  if (!match) return [];

  const decoded = match[1]
    .replace(/\\x([0-9a-fA-F]{2})/g, (_whole, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, '/');

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : [];

  const out: DriveEntry[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const id = typeof row[0] === 'string' ? row[0] : '';
    const name = typeof row[2] === 'string' ? row[2] : '';
    const mimeType = typeof row[3] === 'string' ? row[3] : '';
    if (!id || !name || !mimeType) continue;
    // `&` and friends survive the hex unescaping above.
    out.push({ id, name: name.replace(/\\u0026/g, '&'), mimeType });
  }
  return out;
}

/** Punctuation, case and spacing removed to one space, so "LOT 43" = "Lot 43". */
export function normaliseDriveName(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The lot and the house design a stock row names.
 *
 * Both come from the row's own label — "Lot 43 - Tringa Street, Sandpiper
 * Estate, Tweed Heads South NSW 2486 [Stradbroke 180]". The bracketed design
 * is what distinguishes seven rows that share one lot, so a row without one is
 * identified by its lot alone and will only match a folder holding a single
 * document.
 *
 * "Dual Occ" / "Dual Key" are dropped: the source writes them on the row and
 * not on the file ("Lot 43 - Echo 236 - Property Package.pdf"), and the model
 * name plus its number is the part both sides state.
 */
export function lotAndDesignFrom(label: string): { lot: string | null; design: string | null } {
  const text = String(label ?? '');
  const lot = /(?:^|[^a-z0-9])lot\s*([0-9]{1,6}[a-z]?)\b/i.exec(text)?.[1] ?? null;

  const bracketed = /\[([^\]]{1,60})\]/.exec(text)?.[1] ?? '';
  const cleaned = bracketed.replace(/\b(dual\s*occ(?:upancy)?|dual\s*key)\b/gi, ' ');
  const design = /([a-z][a-z' -]{2,24}\s+\d{2,4})/i.exec(cleaned)?.[1] ?? null;

  return {
    lot: lot ? lot.toLowerCase() : null,
    design: design ? normaliseDriveName(design) : null,
  };
}

/**
 * The one folder in this listing that is named for this lot.
 *
 * Equality on the normalised name, never containment: "Lot 5" must not match
 * "Lot 51". Two folders with the same name — the live library has three called
 * "Lot 53" — is an ambiguity the source has to resolve, not us.
 */
export function selectLotFolder(entries: DriveEntry[], lot: string): string | null {
  const wanted = `lot ${normaliseDriveName(lot)}`;
  const hits = entries.filter((entry) =>
    entry.mimeType === DRIVE_FOLDER_MIME && normaliseDriveName(entry.name) === wanted);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The one document in this listing that names this lot AND this design.
 *
 * Both halves are required when the row states both, because a lot folder
 * holds one package per design and picking any of them for a row that named
 * one would be a guess. A row with no design matches only when the folder
 * holds exactly one document naming the lot.
 */
export function selectPackageDocument(
  entries: DriveEntry[],
  key: { lot: string; design: string | null },
): DriveEntry | null {
  const lotToken = `lot ${normaliseDriveName(key.lot)}`;
  const documents = entries.filter((entry) =>
    entry.mimeType !== DRIVE_FOLDER_MIME && entry.mimeType === 'application/pdf');

  const named = documents.filter((entry) => {
    const name = ` ${normaliseDriveName(entry.name)} `;
    if (!name.includes(` ${lotToken} `)) return false;
    return key.design ? name.includes(` ${key.design} `) : true;
  });
  return named.length === 1 ? named[0] : null;
}
