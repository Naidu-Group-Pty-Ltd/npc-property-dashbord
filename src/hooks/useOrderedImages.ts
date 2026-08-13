import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredListingImage } from '@/lib/listingImages';
import { looksLikeFloorplanUrl } from '../../supabase/functions/_shared/listingImageOrder.pure';
import { classifyImageUrl, type ImageKind } from '@/lib/imageKind';

/**
 * A listing's images in display order: photographs first, floor plans last.
 *
 * Two classifiers feed the same ordering. The URL heuristic answers instantly
 * and covers honestly-named assets; the visual classifier answers a moment
 * later for the hashed CDN paths that say nothing, and the order quietly
 * improves when it lands. Stability matters more than perfection here — the
 * relative order within each group never changes, so a carousel the reader is
 * already paging through does not shuffle under their thumb, it only moves a
 * plan they had not reached yet further back.
 *
 * `kindOf` is exposed so the frame can label a plan slide as what it is —
 * a reader flicking through should never wonder whether the beige rectangle
 * is a badly lit bedroom.
 */
export function useOrderedImages(images: StoredListingImage[] | undefined): {
  images: StoredListingImage[];
  kindOf: (url: string) => ImageKind;
} {
  const [visualKinds, setVisualKinds] = useState<Record<string, ImageKind>>({});
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
    // The URL-labelled ones need no pixels; only the anonymous ones are drawn.
    const anonymous = list.filter((image) => image.url && !looksLikeFloorplanUrl(image.url));
    for (const image of anonymous.slice(0, 12)) {
      void classifyImageUrl(image.url).then((kind) => {
        if (cancelled || unmountedRef.current || kind === 'unknown') return;
        setVisualKinds((prior) =>
          prior[image.url] === kind ? prior : { ...prior, [image.url]: kind },
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [signature]);

  const kindOf = useMemo(() => {
    return (url: string): ImageKind => {
      if (looksLikeFloorplanUrl(url)) return 'floorplan';
      return visualKinds[url] ?? 'unknown';
    };
  }, [visualKinds]);

  const ordered = useMemo(() => {
    const list = images ?? [];
    if (list.length < 2) return list;
    const photos: StoredListingImage[] = [];
    const plans: StoredListingImage[] = [];
    for (const image of list) {
      (kindOf(image.url) === 'floorplan' ? plans : photos).push(image);
    }
    return photos.concat(plans);
  }, [images, kindOf]);

  return { images: ordered, kindOf };
}

export default useOrderedImages;
