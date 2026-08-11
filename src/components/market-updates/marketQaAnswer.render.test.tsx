/**
 * Render tests for the Market Q&A answer repairs.
 *
 * These pin the production defects from the side-by-side browser trial:
 * a `## Risks and caveats` heading glued mid-paragraph rendering as literal
 * text, citation clusters like `[[8], [11]]` printing raw instead of
 * resolving to chips, and timelines whose order depended on the model.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketQAAnswer } from './MarketQAAnswer';
import type { MarketQARetrievedItem } from '@/types/marketUpdates';

const retrieved: MarketQARetrievedItem[] = [
  { id: 'id-rba', title: 'RBA holds cash rate', source_name: 'RBA', source_url: 'https://rba.gov.au/media', used: true },
  { id: 'id-abc', title: 'Rents at record highs', source_name: 'ABC News', source_url: 'https://www.abc.net.au/news/item', used: true },
];

describe('MarketQAAnswer repairs', () => {
  it('renders a glued heading as a real heading, never literal ##', () => {
    render(<MarketQAAnswer
      content={'Equity is falling [[id-rba]]. ## Risks and caveats The main risk is the wealth effect.'}
      retrieved={retrieved}
    />);
    expect(screen.getByText('Risks and caveats')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('##');
  });

  it('resolves clustered citations into one chip per source', () => {
    render(<MarketQAAnswer content={'Values are compressing [[1], [2]].'} retrieved={retrieved} />);
    const links = screen.getAllByRole('link');
    expect(links.map(l => l.getAttribute('href'))).toEqual(['https://rba.gov.au/media', 'https://www.abc.net.au/news/item']);
    expect(document.body.textContent).not.toContain('[[');
  });

  it('resolves legacy numeric markers persisted before the server repair', () => {
    render(<MarketQAAnswer content={'The rate held [[1]].'} retrieved={retrieved} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://rba.gov.au/media');
  });

  it('renders the timeline oldest-first regardless of prop order', () => {
    render(<MarketQAAnswer
      content={'Answer text.'}
      retrieved={retrieved}
      timeline={[
        { date: '2026-08-11', event: 'Rate held' },
        { date: '2026-06-30', event: 'Rents peak' },
      ]}
    />);
    const items = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    const rents = items.findIndex(t => t.includes('Rents peak'));
    const rate = items.findIndex(t => t.includes('Rate held'));
    expect(rents).toBeGreaterThanOrEqual(0);
    expect(rents).toBeLessThan(rate);
  });
});
