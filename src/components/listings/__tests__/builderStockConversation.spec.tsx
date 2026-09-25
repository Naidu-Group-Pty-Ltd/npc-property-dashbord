import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE BUILDER CONVERSATION ON A PROPERTY PAGE.
 *
 * Data is mocked at the hook; what is asserted is what the card does with it:
 * the thread in the order it was written with the actual sender on every
 * message, the delivery state of what the Command Centre sent, a failed
 * message kept visible with "Send again" for its writer, one idempotency key
 * per message, a composer only for someone who may write, and a property that
 * is not activated saying how to open the conversation rather than hiding it.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const code = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const state: { conversation: any; error: unknown } = { conversation: null, error: null };
const sent: Array<{ clientMessageId: string; body: string }> = [];
const retried: string[] = [];

vi.mock('@/lib/marketplaceBuilderStock', () => ({
  useBuilderConversation: () => ({
    data: state.conversation ?? undefined, error: state.error, isLoading: false, isFetching: false,
  }),
  useSendBuilderMessage: () => ({
    isPending: false,
    mutateAsync: vi.fn(async (input: { clientMessageId: string; body: string }) => { sent.push(input); return {}; }),
  }),
  useRetryBuilderMessage: () => ({
    isPending: false,
    mutateAsync: vi.fn(async (id: string) => { retried.push(id); return {}; }),
  }),
}));

import { BuilderStockConversation } from '../BuilderStockConversation';

const MESSAGE = (overrides: Record<string, unknown>) => ({
  id: 'm', side: 'command_centre', sender_display_name: 'Olive Owner', body: 'Hello',
  sent_at: '2026-09-25T10:00:00Z', delivery_state: 'delivered', delivered_at: '2026-09-25T10:00:05Z',
  failure_reason: null, mine: true, can_retry: false, ...overrides,
});

beforeEach(() => {
  state.conversation = null;
  state.error = null;
  sent.length = 0;
  retried.length = 0;
});

const renderCard = () => render(<BuilderStockConversation stockItemId="item-1" builderName="Proof Homes" />);

describe('the builder conversation card', () => {
  it('names the builder it is with', () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    expect(screen.getByRole('heading', { name: /messages with proof homes/i })).toBeInTheDocument();
  });

  it('an activated property with no messages invites the first one', () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message/i })).not.toBeDisabled();
  });

  it('shows the thread in order, with the actual sender, and delivery only for ours', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [
        MESSAGE({ id: 'a', body: 'Question?', delivery_state: 'delivered' }),
        MESSAGE({ id: 'b', side: 'builder', sender_display_name: 'Avery Builder', body: 'Answer.', delivery_state: null, mine: false }),
        MESSAGE({ id: 'c', sender_display_name: 'Casey Colleague', body: 'Thanks.', delivery_state: 'queued', mine: false }),
      ],
    };
    renderCard();
    const items = within(screen.getByRole('log')).getAllByRole('article');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Olive Owner'), expect.stringContaining('Avery Builder'), expect.stringContaining('Casey Colleague'),
    ]);
    expect(within(items[0]).getByText('Delivered')).toBeInTheDocument();
    expect(within(items[1]).queryByText(/delivered|sending/i)).toBeNull();
    expect(within(items[2]).getByText('Sending')).toBeInTheDocument();
  });

  it('a failed message stays visible, and its writer can send it again', () => {
    state.conversation = {
      conversation_id: 'c', open: true, can_send: true,
      messages: [MESSAGE({ id: 'failed-1', body: 'Did this arrive?', delivery_state: 'failed', failure_reason: 'not_delivered', can_retry: true })],
    };
    renderCard();
    expect(screen.getByText('Did this arrive?')).toBeInTheDocument();
    expect(screen.getByText('Not delivered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send again/i }));
    expect(retried).toEqual(['failed-1']);
  });

  it('sends the trimmed text under one fresh idempotency key', async () => {
    state.conversation = { conversation_id: null, open: true, can_send: true, messages: [] };
    renderCard();
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: '  Is it available?  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await screen.findByRole('textbox', { name: /message/i });
    expect(sent).toEqual([{ clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/), body: 'Is it available?' }]);
  });

  it('someone without Listings edit reads the thread but has no composer', () => {
    state.conversation = { conversation_id: 'c', open: true, can_send: false, messages: [MESSAGE({})] };
    renderCard();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
  });

  it('a property that is not activated says how the conversation opens', () => {
    state.conversation = { conversation_id: null, open: false, can_send: false, messages: [] };
    renderCard();
    expect(screen.getByText(/activate this property to message/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).toBeNull();
  });

  it('no model and no email: a message is text between people', () => {
    const source = code('src/components/listings/BuilderStockConversation.tsx');
    expect(source).not.toMatch(/openrouter|anthropic|openai|claude|resend|sendEmail/i);
  });
});
