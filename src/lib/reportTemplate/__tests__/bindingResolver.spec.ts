import { describe, it, expect } from 'vitest';
import { resolveBindable, resolveBindableColor, resolveBindableNumber } from '../bindingResolver';

const ctx = (data: any, tokens: any = { colors: {}, fonts: {}, spacing: {} }) => ({ data, tokens });

describe('bindingResolver — basic paths', () => {
  it('resolves literal strings unchanged', () => {
    expect(resolveBindable('hello', ctx({}))).toBe('hello');
  });
  it('resolves a simple path', () => {
    expect(resolveBindable('{{a.b}}', ctx({ a: { b: 'x' } }))).toBe('x');
  });
  it('resolves array index syntax', () => {
    expect(resolveBindable('{{items[1].name}}', ctx({ items: [{ name: 'a' }, { name: 'b' }] }))).toBe('b');
  });
  it('returns empty string for missing path', () => {
    expect(resolveBindable('{{nope.here}}', ctx({}))).toBe('');
  });
});

describe('bindingResolver — filters', () => {
  it('applies currency filter (locale-independent shape)', () => {
    const out = resolveBindable('{{n | currency}}', ctx({ n: 1234 }));
    expect(out).toMatch(/1[\s,.\u00A0]?234/);
  });
  it('chains filters', () => {
    expect(resolveBindable('{{n | round | currency}}', ctx({ n: 1234.789 }))).toMatch(/1[\s,.\u00A0]?235/);
  });
  it('upper / lower / truncate', () => {
    expect(resolveBindable('{{s | upper}}', ctx({ s: 'hi' }))).toBe('HI');
    expect(resolveBindable('{{s | lower}}', ctx({ s: 'HI' }))).toBe('hi');
    expect(resolveBindable('{{s | truncate:3}}', ctx({ s: 'hello' }))).toMatch(/^hel/);
  });
  it('fallback filter falls back when empty', () => {
    expect(resolveBindable('{{missing | fallback:"n/a"}}', ctx({}))).toBe('n/a');
  });
  it.each([
    ['currency', '999999'],
    ['number', '-1'],
    ['percent', '101'],
    ['fixed', '101'],
    ['fixed', 'Infinity'],
    ['fixed', 'not-a-number'],
  ])('uses the default precision for an invalid %s argument', (filter, decimals) => {
    const context = ctx({ n: 12.345 });
    expect(resolveBindable(`{{n | ${filter}:${decimals}}}`, context)).toBe(
      resolveBindable(`{{n | ${filter}}}`, context),
    );
  });
});

describe('bindingResolver — numbers', () => {
  it('resolves numbers when present', () => {
    expect(resolveBindableNumber('{{n}}', ctx({ n: 42 }), 0)).toBe(42);
  });
  it('passes literal numbers through', () => {
    expect(resolveBindableNumber(15, ctx({}))).toBe(15);
  });
});

describe('bindingResolver — expressions safety', () => {
  it('returns empty string when expression cannot be evaluated', () => {
    // The evaluator is sandboxed by a character whitelist; anything rejected
    // must not throw and must not leak globals.
    expect(resolveBindable('{{= window.location }}', ctx({}))).toBe('');
  });
});


describe('bindingResolver — colours', () => {
  it('normalises CSS colour forms emitted by image/code reconstruction', () => {
    expect(resolveBindableColor('rgb(20, 40, 60)', ctx({}))).toBe('#14283c');
    expect(resolveBindableColor('rgba(255, 128, 0, 0.5)', ctx({}))).toBe('#ff8000');
    expect(resolveBindableColor('hsl(210, 50%, 40%)', ctx({}))).toBe('#336699');
    expect(resolveBindableColor('white', ctx({}))).toBe('#ffffff');
  });

  it('keeps transparent explicit for renderer skip logic', () => {
    expect(resolveBindableColor('transparent', ctx({}), 'transparent')).toBe('transparent');
  });
});
