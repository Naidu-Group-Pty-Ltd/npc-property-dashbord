import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredListingImage } from '@/lib/listingImages';
import { looksLikeFloorplanUrl } from '../../supabase/functions/_shared/listingImageOrder.pure';
import { selectListingGallery } from '../../supabase/functions/_shared/listingImageSelection.pure';
import { inspectImageUrl, type ImageInspection, type ImageKind } from '@/lib/imageKind';

/**
 * A listing's photographs as the reader should see them: each picture once,
 * photographs before floor plans, page furniture last.
 *
 * The first tier of the imagery cascade decides all three of those, and most of
 * the deciding happens on the server — `listing-images` de-duplicates before it
 * signs, so what arrives here is already one row per photograph and the card
 * draws correctly on its first paint. This hook adds the part only a browser
 * can contribute, from pixels it decodes itself:
 *
 * - **a plan verdict** for the hashed CDN paths whose URLs say nothing, which
 *   is most of this corpus (`phimg.reapit.website/<sha1>`);
 * - **the natural dimensions**, which no stored row carries — `width`/`height`
 *   are null on all 4,807 of them — and which are how a 150×150 agent headshot
 *   is told from a room;
 * - **a perceptual signature**, the last de-duplication layer: the only one that
 *   catches one photograph re-encoded into two files that share neither bytes
 *   nor URL shape.
 *
 * All three arrive after the frame has already drawn, so the rule the previous
 * version set still holds: the order may only *improve*. Nothing here reorders
 * two plausible photographs relative to each other, so a carousel the reader is
 * already paging through never shuffles under their thumb — it can only move a
 * plan, a duplicate or a headshot they had not reached yet further back.
 *
 * `kindOf` is exposed so the frame can label a plan slide as what it is: a
 * reader flicking through should never wonder whether the beige rectangle is a
 * badly lit bedroom.
 */
export function useListingGallery(images: StoredListingImage[] | undefined): {
  images: StoredListingImage[];
  kindOf: (url: string) => ImageKind;
} {
  const [inspections, setInspections] = useState<Record<string, ImageInspection>>({});
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const signature = useMemo(() => (images ?? []).map((i) => i.url).join('|'), [images]);

  useEffect(() => {
    const list = images ?? [];
    if (list.length === 0) return;
    let cancelled = false;
    // Bounded per listing: twelve decodes is what a card can justify on a page
    // of 148 of them, and anything past that keeps the place the server gave
    // it. Every image inside the bound is read, not only the anonymous ones —
    // a URL-labelled plan still needs its signature, or two copies of one plan
    // survive as two slides.
    for (const image of list.slice(0, 12)) {
      void inspectImageUrl(image.url).then((inspection) => {
        if (cancelled || unmountedRef.current) return;
        // A decode that learned nothing — tainted canvas, network failure —
        // must not be recorded: it would re-render the gallery to say the same
        // thing. Dimensions alone count as learning something; they are the
        // only evidence that separates an agent's headshot from a room.
        const learned =
          inspection.kind !== 'unknown' || Boolean(inspection.signature) || Boolean(inspection.width);
        if (!learned) return;
        setInspections((prior) =>
          prior[image.url] === inspection ? prior : { ...prior, [image.url]: inspection },
        );
      });
    }
    return () => {
      cancelled = true;
    };
    // `signature` is the dependency, not `images`: the parent rebuilds that
    // array on most renders and a pass restarted on each one never finishes.
  }, [signature]);

  const kindOf = useMemo(() => {
    return (url: string): ImageKind => {
      if (looksLikeFloorplanUrl(url)) return 'floorplan';
      return inspections[url]?.kind ?? 'unknown';
    };
  }, [inspections]);

  const ordered = useMemo(() => {
    const list = images ?? [];
    if (list.length === 0) return list;
    const measured = list.map((image) => {
      const inspection = inspections[image.url];
      return {
        ...image,
        kind: kindOf(image.url),
        signature: inspection?.signature ?? null,
        // The stored row wins where it has an answer; the decode fills the gap.
        width: image.width ?? inspection?.width ?? null,
        height: image.height ?? inspection?.height ?? null,
      };
    });
    return selectListingGallery(measured).images.map(({ kind: _kind, signature: _signature, ...image }) => image);
  }, [images, inspections, kindOf]);

  return { images: ordered, kindOf };
}

export default useListingGallery;
