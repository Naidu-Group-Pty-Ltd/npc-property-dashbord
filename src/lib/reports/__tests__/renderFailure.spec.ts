import { describe, expect, it } from 'vitest';
import {
  classifyServiceStatus,
  describeRenderFailure,
  functionStatusFor,
  readRenderFailure,
  renderFailureIsRetriable,
  summariseServiceBody,
} from '@/lib/reports/renderFailure.pure';

/**
 * The 503 of 15 Sep 2026, classified once and said the same way at both ends:
 * the Investment page swallowed it and said "could not produce the document";
 * the cash-flow page printed 400 characters of Cloud Run's HTML.
 */
// eslint-disable-next-line no-restricted-syntax -- the verbatim page Cloud Run served; its colours are the evidence, not a style
const CLOUD_RUN_503 = '<html><head><meta http-equiv="content-type" content="text/html;charset=utf-8"><title>503 Server Error</title></head><body text=#000000 bgcolor=#ffffff><h1>Error: Server Error</h1><h2>The service you requested is not available yet.<p>Please try again in 30 seconds.</h2><h2></h2></body></html>';

describe('renderFailure', () => {
  it('classifies the status band', () => {
    expect(classifyServiceStatus(503)).toBe('engine_unavailable');
    expect(classifyServiceStatus(502)).toBe('engine_unavailable');
    expect(classifyServiceStatus(504)).toBe('engine_unavailable');
    expect(classifyServiceStatus(401)).toBe('engine_refused');
    expect(classifyServiceStatus(413)).toBe('engine_refused');
    expect(classifyServiceStatus(500)).toBe('engine_failed');
    expect(renderFailureIsRetriable('engine_unavailable')).toBe(true);
    expect(renderFailureIsRetriable('engine_refused')).toBe(false);
    expect(functionStatusFor('engine_unavailable')).toBe(503);
    expect(functionStatusFor('engine_failed')).toBe(502);
  });

  it('reduces the Cloud Run error page to one sentence — no markup reaches a person', () => {
    const s = summariseServiceBody(CLOUD_RUN_503);
    expect(s).toBe('503 Server Error — Error: Server Error — The service you requested is not available yet. Please try again in 30 seconds.');
    expect(s).not.toMatch(/</);
  });

  it('reads a JSON error and trims plain text', () => {
    expect(summariseServiceBody('{"error":"invalid pdf_variant"}')).toBe('invalid pdf_variant');
    expect(summariseServiceBody('{"error":{"message":"nested"}}')).toBe('nested');
    expect(summariseServiceBody('  boom   bang  ')).toBe('boom bang');
    expect(summariseServiceBody('x'.repeat(300), 40)).toHaveLength(40);
    expect(summariseServiceBody('')).toBe('');
  });

  it('composes the operator sentence with the status, the service\'s words and what to do', () => {
    const text = describeRenderFailure({ kind: 'engine_unavailable', upstreamStatus: 503, summary: summariseServiceBody(CLOUD_RUN_503) });
    expect(text).toMatch(/^The print engine did not answer \(HTTP 503 from the render service\)\./);
    expect(text).toMatch(/not available yet/);
    expect(text).toMatch(/try again in a minute/);
    expect(describeRenderFailure({ kind: 'engine_refused', upstreamStatus: 401 })).toMatch(/refused the request \(HTTP 401/);
    expect(describeRenderFailure({ kind: 'engine_failed' })).toBe('The print engine failed to draw the document.');
  });

  it('reads a failure back off a function answer, and nothing off anything else', () => {
    expect(readRenderFailure({ error: 'x', code: 'engine_unavailable', upstreamStatus: 503, retriable: true }))
      .toEqual({ error: 'x', code: 'engine_unavailable', upstreamStatus: 503, retriable: true });
    expect(readRenderFailure({ error: 'plain' })).toBeNull();
    expect(readRenderFailure(null)).toBeNull();
  });
});
