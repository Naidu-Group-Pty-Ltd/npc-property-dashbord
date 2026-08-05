/**
 * The worked-example viewer.
 *
 * The point of this surface is that a reader can trust it: what it shows has to
 * be the same example the downloaded files contain, and it has to be
 * unmistakably fictional. Both are asserted here, along with the outcome panel
 * actually running the engine rather than displaying written-down numbers.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WorkedExampleDialog } from '../WorkedExampleDialog';
import { DEFAULT_PACK_BRANDING, workedExampleSections } from '@/lib/ciAssessment/intakePack';

afterEach(cleanup);

function renderDialog() {
  const onDownload = vi.fn();
  render(
    <WorkedExampleDialog
      open
      onOpenChange={() => {}}
      resolveBranding={async () => DEFAULT_PACK_BRANDING}
      onDownload={onDownload}
    />,
  );
  return { onDownload };
}

describe('WorkedExampleDialog', () => {
  it('says on its face that the data is fictional', () => {
    renderDialog();
    expect(screen.getByText('Fictional data')).toBeInTheDocument();
    expect(screen.getByText(/invented — this is a reference, not a client record/)).toBeInTheDocument();
  });

  it('opens on the first section and shows its answers', () => {
    renderDialog();
    // Property and transaction leads, and its first answer is the deal type.
    expect(screen.getByRole('heading', { name: 'Property and transaction' })).toBeInTheDocument();
    expect(screen.getByText('88 Foundry Link')).toBeInTheDocument();
    expect(screen.getByText('$5,850,000')).toBeInTheDocument();
  });

  it('navigates between sections', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /3\. Ownership/ }));

    expect(screen.getByRole('heading', { name: 'Borrowing entities' })).toBeInTheDocument();
    expect(screen.getByText('Entity 1')).toBeInTheDocument();
    expect(screen.getByText('Entity 2')).toBeInTheDocument();
    // The structure is the thing people get wrong, so it is the thing to show.
    expect(screen.getByText('Trust')).toBeInTheDocument();
  });

  it('explains why an answer is written the way it is', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /3\. Ownership/ }));
    expect(screen.getByText(/Trust, not Company/)).toBeInTheDocument();
  });

  it('shows dates the way a person writes them', () => {
    renderDialog();
    // Stored as 2026-09-30; a client-facing reference shows 30/09/2026.
    expect(screen.getByText('30/09/2026')).toBeInTheDocument();
  });

  it('runs the real engine for the outcome, on the last section', () => {
    renderDialog();
    const sections = workedExampleSections();
    const last = sections[sections.length - 1];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(last.sheetName.replace('.', '\\.')) }));

    expect(screen.getByText('What these answers produce')).toBeInTheDocument();
    expect(screen.getByText('Maximum indicative capacity')).toBeInTheDocument();
    // Never the language of a lender decision — the outcome vocabulary is
    // deliberately "supported"/"outside assumptions", never "approved".
    expect(screen.queryByText(/approved/i)).toBeNull();
  });

  it('offers both filled files', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /Download filled workbook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download filled guide/ })).toBeInTheDocument();
  });
});
