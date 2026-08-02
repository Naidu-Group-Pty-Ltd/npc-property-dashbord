import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';

const projectUrl = 'https://project.supabase.co';

Deno.test('render resource policy permits embedded and project storage assets', () => {
  assertSafeRenderResources('<img src="data:image/png;base64,AA==">', projectUrl);
  assertSafeRenderResources('<img src="https://project.supabase.co/storage/v1/object/sign/private/a.png?token=x&amp;y=1">', projectUrl);
  assertEquals(true, true);
});

Deno.test('render resource policy blocks metadata, private, and arbitrary public hosts', () => {
  for (const src of [
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/image.png',
    'https://attacker.example/image.png',
    '//attacker.example/image.png',
    'file:///etc/passwd',
    'https://project.supabase.co/rest/v1/private_table',
  ]) {
    assertThrows(() => assertSafeRenderResources(`<img src="${src}">`, projectUrl));
  }
});

/**
 * The regression this file exists to catch from now on.
 *
 * Every inline SVG the report system emits opens with the SVG namespace, and
 * rejecting it rejected the whole document — the Borrowing Capacity Snapshot
 * never rendered once, and any template with a QR code failed the same way.
 */
Deno.test('render resource policy permits XML namespace declarations', () => {
  assertSafeRenderResources('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', projectUrl);
  assertSafeRenderResources(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>`,
    projectUrl,
  );
  assertSafeRenderResources("<svg xmlns='http://www.w3.org/2000/svg'></svg>", projectUrl);
  assertEquals(true, true);
});

/** Exempting the declaration must not exempt the element that carries it. */
Deno.test('render resource policy still blocks resources beside a namespace declaration', () => {
  assertThrows(() => assertSafeRenderResources(
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/a.png"/></svg>',
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://169.254.169.254/latest/meta-data/"/></svg>',
    projectUrl,
  ));
  // An attribute that merely starts with the same letters is not a declaration.
  assertThrows(() => assertSafeRenderResources(
    '<img data-xmlns="https://attacker.example/a.png">',
    projectUrl,
  ));
});

/**
 * The other half of the same regression.
 *
 * The base64 alphabet contains `/`, so any inlined image big enough eventually
 * contains `//` — read as a scheme-relative URL, and the document was rejected.
 * Inlining brand assets is what `assets.pure.ts` requires, so this made the
 * required shape the unrenderable one.
 */
Deno.test('render resource policy ignores base64 data URI payloads', () => {
  assertSafeRenderResources('<img src="data:image/png;base64,AAAA//n1DaHZA6vzhqh0YG==">', projectUrl);
  assertSafeRenderResources('<div style="background:url(data:image/png;base64,QQ//BB=)"></div>', projectUrl);
  assertEquals(true, true);
});

Deno.test('render resource policy still reads non-base64 data URIs and what follows one', () => {
  // Percent-encoded text can name a host; only the opaque base64 form is skipped.
  assertThrows(() => assertSafeRenderResources(
    `<img src="data:image/svg+xml,%3Csvg%3E%3Cimage href='http://169.254.169.254/x'/%3E%3C/svg%3E">`,
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<img src="data:image/png;base64,QQ//BB="><img src="https://attacker.example/a.png">',
    projectUrl,
  ));
});

Deno.test('render resource policy blocks entity-obfuscated network URLs', () => {
  assertThrows(() => assertSafeRenderResources(
    '<img src="&#x68;ttp&colon;&sol;&sol;169.254.169.254/latest/meta-data/">',
    projectUrl,
  ));
});
