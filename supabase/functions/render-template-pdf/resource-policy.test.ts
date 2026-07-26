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

Deno.test('render resource policy blocks entity-obfuscated network URLs', () => {
  assertThrows(() => assertSafeRenderResources(
    '<img src="&#x68;ttp&colon;&sol;&sol;169.254.169.254/latest/meta-data/">',
    projectUrl,
  ));
});
