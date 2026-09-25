/**
 * AGENCY MESSAGING — WHAT THE COMMAND CENTRE PAGE READS AND WRITES.
 *
 * The rows are proved by builderStockAgencyMessaging.spec.ts. This pins what
 * stands in front of them: the conversation a property page reads is the one
 * its builder's authorised connection derives, it serves only what a person
 * may see (never a user id, the client key, or anything about the client),
 * writing needs Listings edit, and the sender is the session's user — never a
 * value in the request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agencyMessageRefusal,
  projectConversationMessages,
} from '../../../supabase/functions/_shared/builderStock/agencyMessages.pure';
import { readBuilderConversation } from '../../../supabase/functions/_shared/builderStock/agencyMessages';
import { agencyMessageRouteHeld } from '../../../supabase/functions/_shared/builderStock/agencyMessages.pure';
import {
  BUILDER_CONVERSATION_CLOSED_POLL_MS, BUILDER_CONVERSATION_POLL_MS, builderConversationPollInterval,
} from '../marketplaceBuilderStock';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const readCode = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

type Row = Record<string, any>;
function standIn(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const from = (table: string) => {
    const entry = { table, filters: [] as Array<[string, string, unknown]> };
    log.push(entry);
    let orders: Array<[string, boolean]> = [];
    let cap = Infinity;
    const builder: any = {
      select() { return builder; },
      eq(col: string, v: unknown) { entry.filters.push(['eq', col, v]); return builder; },
      neq(col: string, v: unknown) { entry.filters.push(['neq', col, v]); return builder; },
      contains(col: string, v: unknown[]) { entry.filters.push(['contains', col, v]); return builder; },
      order(col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) { orders = [...orders, [col, o?.ascending !== false]]; return builder; },
      limit(n: number) { cap = n; return builder; },
      maybeSingle() { return builder.then((r: any) => ({ data: r.data[0] ?? null, error: null })); },
      then(resolve: (v: unknown) => unknown) {
        let rows = (tables[table] ?? []).filter((row) => entry.filters.every(([op, col, v]) =>
          op === 'eq' ? row[col] === v : op === 'neq' ? row[col] !== v
            : (v as unknown[]).every((x) => (row[col] ?? []).includes(x))));
        for (const [col, asc] of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return Promise.resolve({ data: rows.slice(0, cap), error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { client: { from }, log };
}

const ORG = 'org-a';
const ITEM = '00000000-0000-4000-8000-0000000000a1';
const NET = '00000000-0000-4000-8000-0000000000c1';
const ME = 'user-me';

function fixture() {
  const conversation = 'conv-a';
  return {
    conversation,
    tables: {
      builder_network_conversations: [
        { id: conversation, connection_id: 'conn-a', stock_item_id: ITEM, builder_organisation_id: ORG },
        { id: 'conv-old', connection_id: 'conn-revoked', stock_item_id: ITEM, builder_organisation_id: ORG },
      ],
      builder_network_connections: [
        { id: 'conn-a', network_connection_id: NET, builder_organisation_id: ORG, state: 'active', scopes: ['stock:publish'], accepted_at: '2026-09-01' },
        { id: 'conn-revoked', network_connection_id: 'net-old', builder_organisation_id: ORG, state: 'revoked', scopes: ['stock:publish'], accepted_at: '2026-10-01' },
      ],
      builder_stock_selections: [
        { id: 's1', stock_item_id: ITEM, organisation_id: ORG, status: 'selected', client_id: 'private-client', internal_notes: 'private' },
      ],
      builder_network_messages: [
        { id: 'm2', conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: 'Reply',
          sent_at: '2026-09-25T11:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null },
        { id: 'm1', conversation_id: conversation, side: 'command_centre', sender_display_name: 'Olive Owner', body: 'Question',
          sent_at: '2026-09-25T10:00:00Z', delivery_state: 'failed', delivered_at: null, failure_reason: 'not_delivered', sender_user_id: ME, client_message_id: 'client-1' },
        { id: 'm3', conversation_id: conversation, side: 'command_centre', sender_display_name: 'Casey Colleague', body: 'Follow-up',
          sent_at: '2026-09-25T12:00:00Z', delivery_state: 'delivered', delivered_at: '2026-09-25T12:00:04Z', failure_reason: null, sender_user_id: 'user-colleague', client_message_id: 'client-2' },
        { id: 'other', conversation_id: 'another-conversation', side: 'builder', sender_display_name: 'X', body: 'Not this one',
          sent_at: '2026-09-25T09:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null },
      ],
    } as Record<string, Row[]>,
  };
}

describe('reading a property\'s conversation', () => {
  it('reads the conversation on the builder\'s active connection, in the order it was written', async () => {
    const { tables } = fixture();
    const read = await readBuilderConversation(standIn(tables).client, {
      stockItemId: ITEM, organisationId: ORG, viewerUserId: ME,
    });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
    expect(read.open).toBe(true);
    expect(JSON.stringify(read)).not.toContain('Not this one');
  });

  it('past the cap, the thread shows the NEWEST messages, still in reading order', async () => {
    const { tables, conversation } = fixture();
    tables.builder_network_messages = Array.from({ length: 501 }, (_, i) => ({
      id: `m${String(i).padStart(4, '0')}`, conversation_id: conversation, side: 'builder',
      sender_display_name: 'Avery Builder', body: `Message ${i}`,
      sent_at: new Date(Date.UTC(2026, 8, 25, 0, 0, i)).toISOString(), delivery_state: null,
      delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    }));
    const read = await readBuilderConversation(standIn(tables).client, {
      stockItemId: ITEM, organisationId: ORG, viewerUserId: ME,
    });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages).toHaveLength(500);
    expect(read.messages[0].body).toBe('Message 1');
    expect(read.messages[499].body).toBe('Message 500');
  });

  it('a property with no live activation is closed, and one with no connection has no conversation', async () => {
    const { tables } = fixture();
    tables.builder_stock_selections[0].status = 'withdrawn';
    const closed = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    expect(closed).toMatchObject({ ok: true, open: false });
    tables.builder_network_connections = [];
    const none = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    expect(none).toEqual({ ok: true, open: false, conversation_id: null, messages: [] });
  });

  it('18. polling refresh gets new messages: the next read carries what was written since the last', async () => {
    const { tables, conversation } = fixture();
    const first = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    if (!first.ok) throw new Error('read failed');
    expect(first.messages.map((m) => m.id)).not.toContain('m-new');
    tables.builder_network_messages.push({
      id: 'm-new', conversation_id: conversation, side: 'builder', sender_display_name: 'Avery Builder', body: 'Just arrived',
      sent_at: '2026-09-25T13:00:00Z', delivery_state: null, delivered_at: null, failure_reason: null, sender_user_id: null, client_message_id: null,
    });
    const next = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    if (!next.ok) throw new Error('read failed');
    expect(next.messages.at(-1)?.body).toBe('Just arrived');
    expect(readCode('src/lib/marketplaceBuilderStock.ts'))
      .toMatch(/refetchInterval:\s*\(query\)\s*=>\s*builderConversationPollInterval\(query\.state\.data\)/);
  });

  it('polls an open conversation, and a closed one only slowly, so a re-activation elsewhere still reopens it', () => {
    expect(builderConversationPollInterval(undefined)).toBe(BUILDER_CONVERSATION_POLL_MS);
    expect(builderConversationPollInterval({ open: true })).toBe(BUILDER_CONVERSATION_POLL_MS);
    expect(builderConversationPollInterval({ open: false })).toBe(BUILDER_CONVERSATION_CLOSED_POLL_MS);
    expect(BUILDER_CONVERSATION_CLOSED_POLL_MS).toBeGreaterThanOrEqual(6 * BUILDER_CONVERSATION_POLL_MS);
    // Activating from this page invalidates the conversation, so a closed one
    // opens without having to be polled for.
    expect(readCode('src/lib/marketplaceBuilderStock.ts'))
      .toMatch(/useSelectBuilderStockForClient[\s\S]*?invalidateQueries\(\{ queryKey: marketplaceStockKeys\.root\(\) \}\)/);
  });

  it('a connection that has lost stock:publish keeps its history readable, and is closed to writing', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].scopes = [];
    const read = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages.map((m) => m.body)).toEqual(['Question', 'Reply', 'Follow-up']);
    expect(read.open).toBe(false);
  });

  it('a disputed connection keeps its history readable, and is closed to writing', async () => {
    const { tables } = fixture();
    tables.builder_network_connections[0].identity_mismatch_since = '2026-09-25T00:00:00Z';
    const read = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    if (!read.ok) throw new Error('read failed');
    expect(read.messages).toHaveLength(3);
    expect(read.open).toBe(false);
  });

  it('20. a cross-organisation read returns nothing', async () => {
    const { tables } = fixture();
    const read = await readBuilderConversation(standIn(tables).client, {
      stockItemId: ITEM, organisationId: 'another-builder-org', viewerUserId: ME,
    });
    expect(read.ok ? read.messages : []).toEqual([]);
  });

  it('never carries a user id, the client key, or anything about the client', async () => {
    const { tables } = fixture();
    const read = await readBuilderConversation(standIn(tables).client, { stockItemId: ITEM, organisationId: ORG, viewerUserId: ME });
    const text = JSON.stringify(read);
    for (const secret of [ME, 'user-colleague', 'client-1', 'private-client', 'private']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('what a message tells the reader', () => {
  const { tables, conversation } = fixture();
  const projected = projectConversationMessages(
    tables.builder_network_messages.filter((m) => m.conversation_id === conversation), ME);

  it('names the actual sender on every message', () => {
    expect(projected.map((m) => m.sender_display_name)).toEqual(['Olive Owner', 'Avery Builder', 'Casey Colleague']);
  });
  it('shows a delivery state only for what the Command Centre sent', () => {
    expect(projected.map((m) => m.delivery_state)).toEqual(['failed', null, 'delivered']);
  });
  it('offers a retry only to the writer of a failed message', () => {
    expect(projected.map((m) => [m.mine, m.can_retry])).toEqual([[true, true], [false, false], [false, false]]);
  });
});

describe('refusals', () => {
  it.each([
    ['AGENCY_CONVERSATION_NOT_FOUND', 404],
    ['AGENCY_CONVERSATION_NOT_OPEN', 409],
    ['AGENCY_MESSAGE_INVALID', 400],
    ['AGENCY_MESSAGE_NOT_RETRYABLE', 409],
    ['AGENCY_SENDER_NOT_A_MEMBER', 403],
    ['AGENCY_NETWORK_DISABLED', 409],
    ['AGENCY_CONNECTION_HALTED', 409],
  ])('%s → %i', (raw, status) => {
    expect(agencyMessageRefusal(`ERROR: ${raw}`)?.status).toBe(status);
  });
});

describe('the edge operations', () => {
  const market = readCode('supabase/functions/builder-stock-marketplace/index.ts');
  const op = (name: string) => {
    const start = market.indexOf(`operation === '${name}'`);
    const next = market.indexOf('operation ===', start + 20);
    return market.slice(start, next > 0 ? next : undefined);
  };

  it('7. reading sits behind the Listings view gate every operation passes through', () => {
    const gate = market.indexOf("requireModulePermission(supabase, actor, 'listings', 'can_view')");
    expect(gate).toBeGreaterThan(-1);
    for (const name of ['get_builder_conversation', 'send_builder_message', 'retry_builder_message']) {
      expect(market.indexOf(`operation === '${name}'`), name).toBeGreaterThan(gate);
    }
  });

  it('7. writing needs Listings edit', () => {
    for (const name of ['send_builder_message', 'retry_builder_message']) {
      expect(op(name)).toContain("requireModulePermission(supabase, actor, 'listings', 'can_edit')");
    }
  });

  it('the sender is the session\'s user; the request names no user or organisation', () => {
    expect(op('send_builder_message')).toContain('_sender_user_id: userId');
    expect(op('retry_builder_message')).toContain('_sender_user_id: userId');
    for (const name of ['get_builder_conversation', 'send_builder_message', 'retry_builder_message']) {
      expect(op(name), name).not.toMatch(/body\.(user_id|userId|sender|organisation_id|connection_id)/);
    }
  });

  it('no model and no email', () => {
    for (const name of ['send_builder_message', 'retry_builder_message', 'get_builder_conversation']) {
      expect(op(name)).not.toMatch(/openrouter|anthropic|openai|resend|sendEmail/i);
    }
  });
});

describe('the worker holds a message whose route stopped being deliverable', () => {
  it('holds agency messages on a disputed connection or one without stock:publish, and nothing else', () => {
    const healthy = { identity_mismatch_since: null, scopes: ['stock:publish'] };
    expect(agencyMessageRouteHeld(healthy, 'agency.message.posted')).toBe(false);
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'agency.message.posted')).toBe(true);
    expect(agencyMessageRouteHeld({ ...healthy, scopes: [] }, 'agency.message.posted')).toBe(true);
    expect(agencyMessageRouteHeld({ ...healthy, scopes: null }, 'agency.message.posted')).toBe(true);
    // A withdrawn scope holds new CONTENT, not a receipt: the refusal that
    // tells the builder why must reach it.
    expect(agencyMessageRouteHeld({ ...healthy, scopes: [] }, 'agency.message.receipt')).toBe(false);
    // An identity dispute holds everything.
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'agency.message.receipt')).toBe(true);
    // Stock events are not this module's to hold.
    expect(agencyMessageRouteHeld({ ...healthy, identity_mismatch_since: '2026-09-25T00:00:00Z' }, 'stock.selection.announced')).toBe(false);
  });

  it('the worker asks before it sends, and a hold spends no delivery attempt', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    const drain = worker.slice(worker.indexOf('async function drainBuilderNetworkOutbox'));
    expect(drain.indexOf('agencyMessageRouteHeld(')).toBeGreaterThan(-1);
    expect(drain.indexOf('agencyMessageRouteHeld(')).toBeLessThan(drain.indexOf('fetch('));
    expect(drain).toMatch(/available_at:\s*'infinity'/);
    expect(drain).toMatch(/attempts:\s*Math\.max\(0,\s*event\.attempts\s*-\s*1\)/);
  });
});

describe('a reader who may not write', () => {
  it('is never offered a button the server would refuse: send and retry follow edit, the activation and the network switch', () => {
    const market = readCode('supabase/functions/builder-stock-marketplace/index.ts');
    const start = market.indexOf("operation === 'get_builder_conversation'");
    const op = market.slice(start, market.indexOf('operation ===', start + 20));
    expect(op).toMatch(/const canSend = read\.open && listingsEdit\.ok && networkOn/);
    expect(op).toMatch(/can_send:\s*canSend/);
    expect(op).toMatch(/can_retry:\s*message\.can_retry\s*&&\s*canSend/);
  });
});
