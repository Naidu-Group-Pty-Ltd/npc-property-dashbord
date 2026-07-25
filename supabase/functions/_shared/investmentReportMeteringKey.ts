function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForStableJson(nested)]),
    );
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fingerprint the immutable inputs for one report-generation version.
 * Chunk/resume calls share the fingerprint, while changed inputs or a later
 * report version receive a new Mission Control reservation.
 */
export async function buildInvestmentReportMeteringParts(
  body: Record<string, unknown> | null | undefined,
  reportVersion: number | string | null | undefined,
): Promise<Array<string | number>> {
  const inputFingerprint = await sha256Hex(JSON.stringify(sortForStableJson({
    propertyAddress: body?.propertyAddress ?? null,
    propertyDetails: body?.propertyDetails ?? null,
    tier: body?.tier ?? null,
  })));

  return body?.reportId
    ? [String(body.reportId), reportVersion ?? 'unknown-version', inputFingerprint]
    : [inputFingerprint];
}
