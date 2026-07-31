import { describe, it, expect } from 'vitest';
import { resolveTemplateLibraryFlag } from '../featureFlag';

describe('resolveTemplateLibraryFlag', () => {
  it('defaults to OFF — the library is not released yet', () => {
    expect(resolveTemplateLibraryFlag({})).toBe(false);
  });

  it('stays OFF for absent/empty inputs rather than guessing', () => {
    expect(resolveTemplateLibraryFlag({ searchParams: '' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ storageValue: null })).toBe(false);
    expect(resolveTemplateLibraryFlag({ envValue: undefined })).toBe(false);
    expect(resolveTemplateLibraryFlag({ searchParams: '?other=1' })).toBe(false);
  });

  it('enables via any of URL param, storage or build env', () => {
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=1' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=true' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ storageValue: '1' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ storageValue: 'true' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ envValue: '1' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ envValue: true })).toBe(true);
    expect(resolveTemplateLibraryFlag({ envValue: 'true' })).toBe(true);
  });

  it('kill-switches force OFF even when a lower-precedence source enables it', () => {
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=0', storageValue: '1' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=false', envValue: true })).toBe(false);
    expect(resolveTemplateLibraryFlag({ storageValue: '0', envValue: '1' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ envValue: false })).toBe(false);
    expect(resolveTemplateLibraryFlag({ envValue: '0' })).toBe(false);
  });

  it('applies URL > storage > env precedence in both directions', () => {
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=1', storageValue: '0', envValue: '0' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=0', storageValue: '1', envValue: '1' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ storageValue: '1', envValue: '0' })).toBe(true);
    expect(resolveTemplateLibraryFlag({ storageValue: '0', envValue: '1' })).toBe(false);
  });

  it('ignores unrecognised values instead of treating them as truthy', () => {
    expect(resolveTemplateLibraryFlag({ searchParams: '?templateLibrary=yes' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ storageValue: 'on' })).toBe(false);
    expect(resolveTemplateLibraryFlag({ envValue: 'enabled' })).toBe(false);
  });
});
