#!/usr/bin/env python3
"""
Rebuild `npc-email-1-new.upgraded.json` with the address pipeline repaired.

Two defects, and together they are why the marketplace map pins properties at
suburb centroids while the record holds the street.

## D1 — the geocoder is asked for a fraction of the address

Modules 124 and 81 both map

    address  <-  {{123.address}},{{123.suburb}}

and that is the whole question they ask. The extraction model has already
produced `street_number`, `street_name`, `street_type`, `state` and `postcode`
for the same listing, and none of them are sent. Worse, `address` is often
empty precisely when the parts are populated -- a source that writes
"Mortlock Street, Cobblebank" gives the model a street name and no number, and
the model puts the street in `street_name`/`street_type` rather than in
`address`. The query then degenerates to ",Cobblebank" and Google answers with
the suburb centroid, which is the best answer available to the question it was
actually asked.

Measured on 7 September 2026 across 139 live listings: 202 of the 1,019 cached
geocodes are `APPROXIMATE` and they collapse onto 95 distinct coordinates.

*Fixed:* both modules compose the full address from the parts the model already
extracted, including the state and postcode -- which is also what stops
`Donnybrook` resolving to Western Australia, since the name exists in three
states.

## D2 — the geocoder's answer is written back over the extraction

Modules 129 and the module 81 branch's writer re-parse Google's
`formatted_address` (modules 125/126 -> feeder 127, and 84/85 -> feeder 89) and
then write EIGHT address columns from that re-parse:

    Full Address, Normalized Address, Street Number, Street Name,
    Street Type, Suburb, State, Postcode

When the geocode was coarse, that re-parse is a re-parse of a suburb. So the
pipeline overwrites what it correctly extracted from the email with a strictly
smaller fact derived from its own failed lookup -- and `Full Address` ends up
reading "Cobblebank VIC 3338, Australia" on a record whose email named
Mortlock Street. It is a feedback loop that degrades the record every run.

*Fixed:* the geocoder's own outputs are still written, because they are new
information the record did not have -- `Latitude`, `Longitude`,
`Geocoded Full Address`, `Geocoding Raw Response`, `Google Maps Link`,
`Geocoding Status`. The eight extracted columns are no longer touched on the
geocode branch. `Geocoded Full Address` already exists as the place for the
provider's own string, which is exactly why nothing is lost by leaving
`Full Address` alone.

## What this does NOT do

It does not invent precision. A source that never stated a street number still
has none afterwards, and roughly a quarter of live listings are in that state
legitimately. The dashboard reports those as street- or locality-precise rather
than pretending -- see `supabase/functions/_shared/listingAddress.pure.ts`.

It is also NOT required for the map to be correct. The dashboard composes the
address from the same parts itself before geocoding, so the map is fixed with
or without this. This fix stops the SOURCE RECORD being degraded, which matters
for every other consumer of Airtable and for anyone reading the base directly.

Run:  python3 docs/integrations/blueprints/apply-address-fix.py
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
ORIGINAL = HERE / "npc-email-1-new.original.json"
UPGRADED = HERE / "npc-email-1-new.upgraded.json"
SENDER_FIX = HERE / "apply-sender-fix.py"

# The two Google Maps geocode modules, and the feeder each one reads its
# listing from.
GEOCODE_MODULES = {124: 123, 81: 115}

# Airtable field ids on Property Intake Master (tblWIg5cs85O30pcY) that the
# EXTRACTION owns. The geocode branch must never write these.
EXTRACTION_OWNED = {
    "fld8yUQUPeOsr5vpv": "Full Address",
    "fldu3SzJNBeUHfKDx": "Normalized Address",
    "fldiC8RFqaYlcOttb": "Street Number",
    "fldoqzJOOLAWwozck": "Street Name",
    "fldFckGyo0jEKmrBO": "Street Type",
    "fldjjq8ESyEoWoXbl": "Suburb",
    "fldwMT1KcTMJLV3WZ": "State",
    "fldX5jSbzuiIK9y4x": "Postcode",
}


def geocode_query(feeder: int) -> str:
    """
    The full address, composed from the parts the model already extracted.

    Written with Make's own array helpers rather than string concatenation so
    an absent part contributes nothing instead of a stray space or comma:
    `add` appends, `compact` drops the empties, `join` glues what is left.

    `Unknown` is spelled out by the extraction schema for `street_type` and
    `state`, and it is a sentinel rather than a value -- passed through it
    would be a literal word in the geocoder's query.
    """
    # Make has no nested mustaches: inside one `{{ }}` everything is already
    # an expression, so the inner joins carry no braces of their own.
    street = (
        f"join(compact(add(emptyarray; {feeder}.street_number; {feeder}.street_name; "
        f'if({feeder}.street_type = "Unknown"; emptystring; {feeder}.street_type))); " ")'
    )
    locality = (
        f"join(compact(add(emptyarray; {feeder}.suburb; "
        f'if({feeder}.state = "Unknown"; emptystring; {feeder}.state); '
        f'{feeder}.postcode)); " ")'
    )
    # `ifempty` keeps the source's own line usable where the parts produced
    # nothing, which is the case the old mapping handled and must keep handling.
    return (
        f"{{{{join(compact(add(emptyarray; ifempty({street}; {feeder}.address); "
        f'{locality})); ", ")}}}}'
    )


def walk(node, on_module) -> None:
    if isinstance(node, dict):
        if "id" in node and "module" in node:
            on_module(node)
        for value in node.values():
            walk(value, on_module)
    elif isinstance(node, list):
        for value in node:
            walk(value, on_module)


def main() -> int:
    if not ORIGINAL.exists():
        print(f"missing {ORIGINAL}", file=sys.stderr)
        return 1

    # CHAINED, not standalone. `apply-sender-fix.py` also rebuilds
    # `npc-email-1-new.upgraded.json` from the original, so running this on its
    # own would silently drop the forwarded-sender repair that file carries.
    # Rebuild that first, then patch its output.
    result = subprocess.run(
        [sys.executable, str(SENDER_FIX)], capture_output=True, text=True
    )
    if result.returncode != 0:
        print(result.stdout + result.stderr, file=sys.stderr)
        print("apply-sender-fix.py failed; not patching", file=sys.stderr)
        return 1
    print("re-applied the forwarded-sender fix first (it writes the same file)\n")

    blueprint = json.loads(UPGRADED.read_text())
    changes: list[str] = []

    def patch(module: dict) -> None:
        mid = module.get("id")
        mapper = module.get("mapper")
        if not isinstance(mapper, dict):
            return

        # D1 — ask for the whole address.
        if mid in GEOCODE_MODULES and module.get("module", "").startswith("google-maps:"):
            before = mapper.get("address")
            mapper["address"] = geocode_query(GEOCODE_MODULES[mid])
            changes.append(f"D1 module {mid}: geocode query\n     was: {before}\n     now: {mapper['address']}")

        # D2 — stop writing the extraction's own columns from the re-parse.
        record = mapper.get("record")
        if isinstance(record, dict):
            stripped = [
                EXTRACTION_OWNED[fid] for fid in list(record) if fid in EXTRACTION_OWNED
            ]
            # Only the GEOCODE branch writers carry the provider's own outputs
            # beside them; an extraction writer legitimately sets these columns
            # and must be left alone.
            writes_geocoder_output = any(
                isinstance(v, str) and ("geometry.location" in v or "formatted_address" in v)
                for v in record.values()
            )
            if stripped and writes_geocoder_output:
                for fid in list(record):
                    if fid in EXTRACTION_OWNED:
                        del record[fid]
                changes.append(
                    f"D2 module {mid}: no longer overwrites {', '.join(sorted(stripped))}"
                )

    walk(blueprint, patch)

    if not changes:
        print("nothing matched — the blueprint may already be patched", file=sys.stderr)
        return 1

    # Same compact encoding the other patch scripts write, so the two do not
    # produce a whole-file diff against each other.
    UPGRADED.write_text(json.dumps(blueprint, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {UPGRADED.name}\n")
    for change in changes:
        print(f"  - {change}")
    print(
        "\nImport it over scenario 9618493 (NPC Email 1 New), then run one message\n"
        "through and check that Latitude/Longitude move while Street Name and\n"
        "Full Address are left as the extraction wrote them."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
