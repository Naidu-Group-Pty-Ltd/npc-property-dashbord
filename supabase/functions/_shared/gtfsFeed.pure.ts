/**
 * GTFS feeds, and reading one member out of a very large published archive.
 *
 * Audit §24 named `public-transport-service` as the last fabricator: eight
 * per-state "fetchers" that ignored the coordinate and returned a hard-coded
 * landmark, so every NSW property was 450m from Central Station. It has
 * answered `sourceUnavailable` since; this module is the real source.
 *
 * ## Why this reads a zip by range instead of downloading it
 *
 * Measured 2026-09-07, from the publishers themselves: NSW's bundle is
 * 292,247,414 bytes and VIC's 319,320,298. Inside NSW's, the members are
 *
 *     946.61 MB unc / 225.77 MB comp   shapes.txt      (route geometry)
 *     399.06 MB unc /  46.88 MB comp   stop_times.txt
 *      26.44 MB unc /   1.61 MB comp   trips.txt
 *      16.21 MB unc /   4.09 MB comp   stops.txt   <- the one that answers
 *       1.18 MB unc /   0.17 MB comp   routes.txt
 *
 * so `shapes.txt` alone is 77% of the download and is of no use to "what is
 * near this property". Every publisher measured honours HTTP range requests,
 * and a zip's central directory sits at the END — so the archive can be
 * addressed rather than downloaded: read the tail, find the member, fetch
 * only its compressed bytes. That is 4.26 MB instead of 278.7 MB for NSW, and
 * it is the difference between this fitting in an Edge Function and not.
 *
 * `crimeIngest.pure.ts`'s `zipSingleDeflateSpan` is deliberately NOT reused:
 * it refuses any archive with more than one entry (BOCSAR's holds exactly
 * one, and that refusal is a guarantee worth keeping) and it takes the whole
 * archive in memory, which is the thing that cannot happen here.
 *
 * ## The rules
 *
 * **A range request that is not honoured is refused, never silently
 * downloaded.** A server answering 200 to `Range:` is sending the whole
 * 279 MB, and accepting that would blow the function's memory rather than
 * report a source that changed its behaviour.
 *
 * **Mode is established by the feed or left null.** A stop's mode lives in
 * routes.txt and is reachable only through stop_times.txt, which is the
 * 399 MB member. Where a feed's own structure carries it, it is recorded;
 * otherwise the column stays NULL and the reading omits mode. Guessing a mode
 * from a stop's name is exactly the class this replaces.
 */

export interface GtfsFeed {
  /** Stable key. Also the `feed` column, so it must never be re-spelled. */
  readonly key: string;
  readonly label: string;
  readonly url: string;
  /** Attribution, carried onto every row as `source_label`. */
  readonly sourceLabel: string;
  /** Licence as published, recorded so a re-check has something to compare. */
  readonly licence: string;
  /**
   * A zip whose members are themselves zips (VIC publishes one per mode).
   * Null for an ordinary GTFS archive.
   */
  readonly nested: boolean;
}

/**
 * Feeds this platform loads. Reachability was probed from BOTH this repo's
 * sandbox and the Supabase egress before any was declared — the SALM lesson:
 * a parser cannot be written against a file nobody can reach.
 */
export const GTFS_FEEDS: readonly GtfsFeed[] = [
  {
    key: 'nsw_sydney',
    label: 'Greater Sydney (Transport for NSW)',
    url: 'https://opendata.transport.nsw.gov.au/data/dataset/d1f68d4f-b778-44df-9823-cf2fa922e47f/resource/67974f14-01bf-47b7-bfa5-c7f2f8a950ca/download/full_greater_sydney_gtfs_static_0.zip',
    sourceLabel: 'Transport for NSW Open Data (CC BY 4.0)',
    licence: 'Creative Commons Attribution',
    nested: false,
  },
  {
    key: 'vic_ptv',
    label: 'Victoria (Public Transport Victoria)',
    url: 'https://data.ptv.vic.gov.au/downloads/gtfs.zip',
    sourceLabel: 'Public Transport Victoria GTFS',
    licence: 'to be confirmed against the publisher',
    nested: true,
  },
  {
    key: 'nt_darwin',
    label: 'Darwin (NT Department of Infrastructure, Planning and Logistics)',
    url: 'https://dli.nt.gov.au/data-feeds/bus-gtfs/google-transit-darwin.zip?v=0.34.1',
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    licence: 'Creative Commons Attribution',
    nested: false,
  },
  {
    key: 'nt_alice',
    label: 'Alice Springs (NT Department of Infrastructure, Planning and Logistics)',
    url: 'https://dipl.nt.gov.au/data-feeds/bus-gtfs/gtfs-alice-new.zip',
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    licence: 'Creative Commons Attribution',
    nested: false,
  },
];

export function feedByKey(key: string): GtfsFeed | null {
  return GTFS_FEEDS.find((f) => f.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Zip central directory, read from a range-fetched tail
// ---------------------------------------------------------------------------

export interface ZipMember {
  readonly name: string;
  /** 0 = stored, 8 = deflate. Anything else is refused by the caller. */
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Offset of the LOCAL header, which is not where the data starts. */
  readonly localHeaderOffset: number;
}

/** The tail this needs: the EOCD plus the largest comment it may carry. */
export const ZIP_TAIL_BYTES = 66_000;

/**
 * Parse the central directory out of the last `ZIP_TAIL_BYTES` of an archive.
 *
 * `tail` must be the final bytes of the file and `totalSize` its full length,
 * because every offset in the directory is absolute and the tail's own
 * position has to be subtracted back out.
 */
export function readZipDirectoryFromTail(tail: Uint8Array, totalSize: number): ZipMember[] {
  const tailStart = totalSize - tail.length;
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('zip has no end-of-central-directory record in its tail');

  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const entryCount = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  // Zip64 marks these fields saturated. Refused rather than mis-read: a
  // truncated offset addresses the wrong bytes and would parse as garbage.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    throw new Error('zip64 archive — central directory offsets are saturated, refused');
  }
  if (cdOffset < tailStart) {
    throw new Error(
      `central directory at ${cdOffset} is before the fetched tail (${tailStart}); refetch a longer tail`,
    );
  }

  let p = cdOffset - tailStart;
  const members: ZipMember[] = [];
  for (let n = 0; n < entryCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error(`central directory entry ${n} has no signature`);
    }
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(tail.subarray(p + 46, p + 46 + nameLen));
    members.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

/**
 * Where a member's compressed bytes actually begin.
 *
 * The local header repeats the name and extra fields at its OWN lengths,
 * which routinely differ from the central directory's — reading the central
 * directory's lengths here is a real and silent off-by-n that decompresses to
 * rubbish. So the caller fetches the 30-byte fixed local header and passes it
 * in, and this returns the true data offset.
 */
export function memberDataStart(localHeader: Uint8Array, localHeaderOffset: number): number {
  const dv = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('local file header signature missing');
  const nameLen = dv.getUint16(26, true);
  const extraLen = dv.getUint16(28, true);
  return localHeaderOffset + 30 + nameLen + extraLen;
}

/** The members this loader ever reads. Everything else is left in the archive. */
export const WANTED_MEMBERS: readonly string[] = ['stops.txt', 'routes.txt'];

export function findMember(members: readonly ZipMember[], name: string): ZipMember | null {
  const lower = name.toLowerCase();
  return members.find((m) => m.name.toLowerCase() === lower)
    ?? members.find((m) => m.name.toLowerCase().endsWith('/' + lower))
    ?? null;
}
