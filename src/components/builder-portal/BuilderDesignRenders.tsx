/**
 * The renders a builder supplies for their own designs.
 *
 * WHY THIS PANEL EXISTS, MEASURED. Every image this product serves is READ out
 * of something — a column naming a URL, a brochure page naming a lot. On the
 * one live source, thirteen of twenty-six published properties attach no
 * document at all, so there was nothing to read and the cards were blank. The
 * pipeline's own fallbacks offered a Simonds display home, an ABC Homes
 * display home and the land developer's estate marketing for those rows, and
 * refused all three, correctly.
 *
 * Those thirteen are THREE DESIGNS. A project builder sells a catalogue — the
 * same house on many lots — so one render per design is the picture for every
 * one of them, and three uploads fix thirteen cards and every future lot of
 * those designs for ever.
 *
 * THE LIST IS THEIR OWN STOCK'S. A builder should not have to know that eleven
 * of their properties are `DK 22B`, and must not have to type it: every design
 * here is read from their own rows, and the one whose render would fix the
 * most blank cards is first. That ordering is the whole ergonomics of this
 * panel.
 *
 * WHAT IT DOES NOT DO. It does not choose which picture a card draws. A render
 * is stored on the design rung of the evidence ladder, so a brochure page
 * naming the lot takes the card back the moment one is read — which is what a
 * builder means by supplying a stand-in.
 */
import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  type BuilderStockDesign,
  useBuilderStockDesigns,
  useRemoveBuilderDesignImage,
  useSupplyBuilderImage,
} from '@/lib/builderStockQueries';

/** What one design's row says about itself, in one sentence a person reads. */
function coverage(design: BuilderStockDesign): string {
  const properties = `${design.properties} ${design.properties === 1 ? 'property' : 'properties'}`;
  if (!design.withoutImage) return `${properties} · all have a picture`;
  return `${properties} · ${design.withoutImage} with no picture`;
}

export function BuilderDesignRenders({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const designsQuery = useBuilderStockDesigns();
  const supply = useSupplyBuilderImage();
  const remove = useRemoveBuilderDesignImage();
  const [active, setActive] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement | null>());

  const choose = useCallback((design: BuilderStockDesign, file: File | null) => {
    if (!file) return;
    setActive(design.key);
    supply.mutate({ file, design: design.label }, {
      onSuccess: (result) => {
        setActive(null);
        toast({
          title: `Render saved for ${design.label}`,
          description: result.properties === 1
            ? 'It is now the picture for 1 property.'
            : `It is now the picture for ${result.properties} properties.`,
        });
      },
      onError: (error) => {
        setActive(null);
        toast({
          title: 'That render could not be saved',
          description: error instanceof Error ? error.message : 'Please try again shortly.',
          variant: 'destructive',
        });
      },
    });
  }, [supply, toast]);

  const withdraw = useCallback((design: BuilderStockDesign) => {
    setActive(design.key);
    remove.mutate(design.label, {
      onSuccess: (result) => {
        setActive(null);
        toast({
          title: `Render removed from ${design.label}`,
          description: result.properties === 1
            ? '1 property no longer shows it.'
            : `${result.properties} properties no longer show it.`,
        });
      },
      onError: (error) => {
        setActive(null);
        toast({
          title: 'That render could not be removed',
          description: error instanceof Error ? error.message : 'Please try again shortly.',
          variant: 'destructive',
        });
      },
    });
  }, [remove, toast]);

  const designs = designsQuery.data ?? [];
  if (designsQuery.isLoading || !designs.length) return null;

  const missing = designs.filter((design) => !design.render && design.withoutImage > 0);
  const coverable = missing.reduce((total, design) => total + design.withoutImage, 0);

  return (
    <Card className="glass-panel">
      <CardHeader>
        <CardTitle className="text-base">Design renders</CardTitle>
        <CardDescription>
          {coverable > 0
            ? `Add one render per design and it becomes the picture for every property `
              + `that has it — ${coverable} ${coverable === 1 ? 'property is' : 'properties are'} `
              + 'waiting on one. A brochure naming the lot still takes precedence.'
            : 'One render per design, used by every property that has it. A brochure '
              + 'naming the lot still takes precedence.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y divide-border/60">
          {designs.map((design) => {
            const busy = active === design.key && (supply.isPending || remove.isPending);
            return (
              <li
                key={design.key}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 basis-56 grow">
                  <p className="truncate text-sm font-medium">{design.label}</p>
                  <p className="text-xs text-muted-foreground">{coverage(design)}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {design.render ? (
                    <Badge
                      variant="outline"
                      className="gap-1 px-1.5 py-0 text-[11px] font-medium"
                    >
                      Render supplied
                    </Badge>
                  ) : null}

                  {canEdit ? (
                    <>
                      <input
                        ref={(node) => { inputs.current.set(design.key, node); }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(event) => {
                          choose(design, event.target.files?.[0] ?? null);
                          // Cleared so choosing the same file twice still fires.
                          event.target.value = '';
                        }}
                      />
                      <Button
                        variant={design.render ? 'ghost' : 'outline'}
                        size="sm"
                        disabled={busy}
                        onClick={() => inputs.current.get(design.key)?.click()}
                        aria-label={design.render
                          ? `Replace the render for ${design.label}`
                          : `Add a render for ${design.label}`}
                      >
                        {busy && supply.isPending
                          ? <Loader2 className={cn('h-4 w-4 animate-spin')} aria-hidden />
                          : <ImagePlus className="h-4 w-4" aria-hidden />}
                        <span className="ml-2">{design.render ? 'Replace' : 'Add render'}</span>
                      </Button>
                      {design.render ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => withdraw(design)}
                          aria-label={`Remove the render for ${design.label}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Remove</span>
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Hand over a picture for ONE property.
 *
 * The exception and the guarantee. The design route covers a catalogue in
 * three uploads; this covers everything else — a lot whose render differs, a
 * brochure that turned out to hold the wrong picture, a one-off. Whatever went
 * wrong, somebody can fix one card.
 *
 * It carries LEVEL 1: the builder said "this is that property's picture", and
 * nothing was read, inferred or matched to arrive at it. So it outranks
 * anything taken out of a document, which is what makes it an override rather
 * than a suggestion.
 */
export function BuilderPropertyImageButton({
  stockItemId,
  propertyLabel,
  hasImage,
}: {
  stockItemId: string;
  propertyLabel: string;
  hasImage: boolean;
}) {
  const { toast } = useToast();
  const supply = useSupplyBuilderImage();
  const input = useRef<HTMLInputElement | null>(null);

  const choose = useCallback((file: File | null) => {
    if (!file) return;
    supply.mutate({ file, stockItemId }, {
      onSuccess: () => {
        toast({
          title: 'Picture saved',
          description: `${propertyLabel} now shows the picture you supplied.`,
        });
      },
      onError: (error) => {
        toast({
          title: 'That picture could not be saved',
          description: error instanceof Error ? error.message : 'Please try again shortly.',
          variant: 'destructive',
        });
      },
    });
  }, [propertyLabel, stockItemId, supply, toast]);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          choose(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px]"
        disabled={supply.isPending}
        onClick={() => input.current?.click()}
        aria-label={hasImage
          ? `Replace the picture for ${propertyLabel}`
          : `Add a picture for ${propertyLabel}`}
      >
        {supply.isPending
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          : <ImagePlus className="h-3 w-3" aria-hidden />}
        <span className="ml-1">{hasImage ? 'Replace' : 'Add picture'}</span>
      </Button>
    </>
  );
}
