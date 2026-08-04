import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useOrderedImages } from './useOrderedImages';
import type { StoredListingImage } from '@/lib/listingImages';

const verdicts = new Map<string, string>();
vi.mock('@/lib/imageKind', async () => {
  const actual = await vi.importActual<typeof import('@/lib/imageKind')>('@/lib/imageKind');
  return {
    ...actual,
    classifyImageUrl: (url: string) => Promise.resolve(verdicts.get(url) ?? 'unknown'),
  };
});

const image = (url: string): StoredListingImage =>
  ({ url, position: 0, origin: 'scraped' }) as StoredListingImage;

function Probe({ images }: { images: StoredListingImage[] }) {
  const { images: ordered, kindOf } = useOrderedImages(images);
  return (
    <ol>
      {ordered.map((entry) => (
        <li key={entry.url}>
          {entry.url}:{kindOf(entry.url)}
        </li>
      ))}
    </ol>
  );
}

const order = () => screen.getAllByRole('listitem').map((li) => li.textContent);

describe('useOrderedImages', () => {
  beforeEach(() => verdicts.clear());
  afterEach(cleanup);

  it('demotes URL-labelled floor plans immediately, before any pixels load', async () => {
    await act(async () => {
      render(<Probe images={[image('https://x.com/floorplan.jpg'), image('https://x.com/a.jpg')]} />);
    });
    expect(order()).toEqual([
      'https://x.com/a.jpg:unknown',
      'https://x.com/floorplan.jpg:floorplan',
    ]);
  });

  it('reorders when the visual classifier recognises an anonymous plan', async () => {
    // Hashed CDN paths carry no hint; the verdict arrives from the pixels a
    // moment later and the plan quietly steps to the back.
    verdicts.set('https://cdn.example/1a2b3c', 'floorplan');
    verdicts.set('https://cdn.example/9f8e7d', 'photo');
    await act(async () => {
      render(<Probe images={[image('https://cdn.example/1a2b3c'), image('https://cdn.example/9f8e7d')]} />);
    });
    expect(order()).toEqual([
      'https://cdn.example/9f8e7d:photo',
      'https://cdn.example/1a2b3c:floorplan',
    ]);
  });

  it('keeps the original order when nothing is recognisably a plan', async () => {
    await act(async () => {
      render(<Probe images={[image('https://x.com/b.jpg'), image('https://x.com/a.jpg')]} />);
    });
    expect(order()).toEqual(['https://x.com/b.jpg:unknown', 'https://x.com/a.jpg:unknown']);
  });
});
