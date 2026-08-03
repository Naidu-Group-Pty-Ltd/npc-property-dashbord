import { describe, expect, it } from 'vitest';
import {
  cleanContactEmail,
  cleanContactPhone,
  describeContactSource,
  resolveContact,
} from '@/lib/listingContact';

describe('cleanContactEmail', () => {
  it('accepts a real address', () => {
    expect(cleanContactEmail('Leanne.Pearman@jelliscraig.com.au')).toBe(
      'leanne.pearman@jelliscraig.com.au',
    );
  });

  it('refuses an address that exists to receive nothing', () => {
    // Worse than offering no action: the user believes they have contacted the
    // agent and nobody has.
    for (const email of [
      'noreply@agency.com.au',
      'no-reply@agency.com.au',
      'donotreply@agency.com.au',
      'bounces@agency.com.au',
      'postmaster@agency.com.au',
      'unsubscribe@agency.com.au',
      'notifications@agency.com.au',
    ]) {
      expect(cleanContactEmail(email), email).toBeNull();
    }
  });

  it('refuses a bulk-send envelope address', () => {
    // A quarter of these listings arrive relayed. The envelope reaches the mail
    // platform, not the agency.
    for (const email of [
      'bounce@u80386.ct.sendgrid.net',
      'reply@mail.mailchimpapp.net',
      'x@socketlabs.vaultre.com.au',
      'noreply@em1234.hubspot.com',
    ]) {
      expect(cleanContactEmail(email), email).toBeNull();
    }
  });

  it('refuses anything that is not an address', () => {
    for (const value of ['', '  ', 'not an email', 'a@b', null, undefined, 42]) {
      expect(cleanContactEmail(value)).toBeNull();
    }
  });
});

describe('cleanContactPhone', () => {
  it('formats the numbers these listings carry', () => {
    expect(cleanContactPhone('0400947799')).toBe('0400 947 799');
    expect(cleanContactPhone('+61 400 947 799')).toBe('0400 947 799');
    expect(cleanContactPhone('(03) 5472 1000')).toBe('(03) 5472 1000');
  });

  it('returns null for junk', () => {
    for (const value of ['', 'call us', '12', null, undefined]) {
      expect(cleanContactPhone(value)).toBeNull();
    }
  });
});

/**
 * The fallback chain is what makes this action available at all. Only 416
 * records carry `Agent Email`; folding in the agency inbox and the envelope the
 * listing arrived in takes it to 451.
 */
describe('resolveContact', () => {
  it('prefers the agent’s own address', () => {
    const contact = resolveContact({
      agentEmail: 'agent@agency.com.au',
      agencyEmail: 'info@agency.com.au',
      senderEmail: 'sender@agency.com.au',
      agentName: 'A. Agent',
    });
    expect(contact.email).toBe('agent@agency.com.au');
    expect(contact.emailSource).toBe('agent');
    expect(contact.direct).toBe(true);
  });

  it('falls back to the agency inbox', () => {
    const contact = resolveContact({
      agencyEmail: 'info@agency.com.au',
      senderEmail: 'sender@agency.com.au',
    });
    expect(contact.email).toBe('info@agency.com.au');
    expect(contact.emailSource).toBe('agency');
    expect(contact.direct).toBe(false);
  });

  it('falls back to whoever emailed the listing in', () => {
    // Not an "agent" field, but for an agent's own broadcast the sender is the
    // agent — which is why the source is reported alongside it.
    const contact = resolveContact({
      senderEmail: 'leanne@jelliscraig.com.au',
      senderName: 'Leanne Pearman',
    });
    expect(contact.email).toBe('leanne@jelliscraig.com.au');
    expect(contact.emailSource).toBe('sender');
    expect(contact.name).toBe('Leanne Pearman');
    expect(contact.direct).toBe(false);
  });

  it('skips an unreachable candidate rather than stopping at it', () => {
    const contact = resolveContact({
      agentEmail: 'noreply@agency.com.au',
      agencyEmail: 'sales@agency.com.au',
    });
    expect(contact.email).toBe('sales@agency.com.au');
    expect(contact.emailSource).toBe('agency');
  });

  it('does not attach the sender’s name to the agency inbox', () => {
    // The envelope name describes whoever pressed send, which is not who
    // answers a general inbox.
    const contact = resolveContact({
      agencyEmail: 'info@agency.com.au',
      senderName: 'Marketing Robot',
    });
    expect(contact.name).toBeNull();
  });

  it('prefers a mobile over a landline', () => {
    const contact = resolveContact({
      agentMobile: '0400 947 799',
      agentPhone: '03 5472 1000',
      agencyPhone: '1300 000 000',
    });
    expect(contact.phone).toBe('0400 947 799');
    expect(contact.phoneSource).toBe('agent');
  });

  it('reports nothing when there is nothing', () => {
    // 990 of 1,441 records are in this state, so it is the common path and the
    // UI has to handle it without pretending otherwise.
    expect(resolveContact({})).toMatchObject({
      email: null,
      emailSource: null,
      phone: null,
      direct: false,
    });
  });

  it('resolves an email and a phone independently', () => {
    const contact = resolveContact({ senderEmail: 'x@agency.com.au', agentMobile: '0400947799' });
    expect(contact.emailSource).toBe('sender');
    expect(contact.phoneSource).toBe('agent');
  });
});

describe('describeContactSource', () => {
  it('explains an inferred address and stays quiet about a direct one', () => {
    expect(describeContactSource('agent')).toBeNull();
    expect(describeContactSource('agency')).toContain('Agency inbox');
    expect(describeContactSource('sender')).toContain('emailed from');
    expect(describeContactSource(null)).toBeNull();
  });
});
