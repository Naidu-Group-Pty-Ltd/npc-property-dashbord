import { DOMParser } from 'npm:linkedom@0.18.12';
import type { MarketSourceAdapter, NormalisedSourceBatch, NormalisedSourceItem, SourceConfig, SourceValidationResult } from './types.ts';
import { boundedFetch, normaliseUrl, sourceDomains } from './security.ts';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const LD_ARTICLE_TYPES = new Set(['Article', 'NewsArticle', 'Report', 'BlogPosting', 'AnalysisNewsArticle', 'ReportageNewsArticle', 'OpinionNewsArticle']);

function readUA(): string {
  const env = Deno.env.get('MARKET_UPDATES_USER_AGENT');
  return env && env.trim().length ? env : DEFAULT_UA;
}

export class HtmlListingAdapter implements MarketSourceAdapter {
  async read(source: SourceConfig, url: string): Promise<NormalisedSourceBatch> {
    const allowed = sourceDomains(source);
    const { response, body, latency } = await boundedFetch(url, allowed, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-AU,en;q=0.9',
        'user-agent': readUA(),
      },
    });
    const doc = new DOMParser().parseFromString(body, 'text/html');
    const out: NormalisedSourceItem[] = [];

    // 1) JSON-LD Article / NewsArticle / BlogPosting / Report metadata
    for (const node of [...doc.querySelectorAll('script[type="application/ld+json"]')]) {
      try {
        const raw = JSON.parse(node.textContent || 'null');
        const items = (Array.isArray(raw) ? raw : [raw]).flatMap((v: any) => v?.['@graph'] || [v]);
        for (const x of items) {
          const t = x?.['@type'];
          const types = Array.isArray(t) ? t : [t];
          if (!types.some((tt: string) => LD_ARTICLE_TYPES.has(tt))) continue;
          const canonical = normaliseUrl(x.url || x.mainEntityOfPage?.['@id'] || x.mainEntityOfPage, url, allowed);
          out.push({
            externalId: x.identifier?.value || x.identifier || canonical,
            title: (x.headline || x.name || '').toString().trim(),
            canonicalUrl: canonical,
            originalUrl: x.url || canonical,
            publishedAt: x.datePublished && Date.parse(x.datePublished) ? new Date(x.datePublished).toISOString() : null,
            excerpt: x.description || null,
            author: x.author?.name || (typeof x.author === 'string' ? x.author : null),
            category: x.articleSection || null,
          });
        }
      } catch { /* malformed metadata */ }
    }

    // 2) Configured selector sweep
    const cfg = (source.adapter_config || {}) as {
      item_selector?: string;
      title_selector?: string;
      link_selector?: string;
      date_selector?: string;
      excerpt_selector?: string;
      anchor_patterns?: string[];
      title_min_length?: number;
    };
    for (const item of [...doc.querySelectorAll(cfg.item_selector || 'article')]) {
      try {
        const link = item.querySelector(cfg.link_selector || 'a[href]') as HTMLAnchorElement | null;
        const title = (item.querySelector(cfg.title_selector || 'h2,h3')?.textContent || link?.textContent || '').trim();
        if (!link || !title) continue;
        const canonical = normaliseUrl(link.href, url, allowed);
        const dt = (item.querySelector(cfg.date_selector || 'time') as HTMLTimeElement | null)?.dateTime;
        out.push({
          externalId: canonical,
          title,
          canonicalUrl: canonical,
          originalUrl: link.href,
          publishedAt: dt && Date.parse(dt) ? new Date(dt).toISOString() : null,
          excerpt: item.querySelector(cfg.excerpt_selector || 'p')?.textContent?.trim() || null,
          author: null,
          category: null,
        });
      } catch { /* bad item */ }
    }

    // 3) Anchor pattern fallback for JS-rendered listing pages
    if (!out.length && Array.isArray(cfg.anchor_patterns) && cfg.anchor_patterns.length) {
      const patterns = cfg.anchor_patterns
        .map((p) => { try { return new RegExp(p, 'i'); } catch { return null; } })
        .filter((r): r is RegExp => !!r);
      const minLen = Math.max(6, Number(cfg.title_min_length ?? 12));
      for (const a of [...doc.querySelectorAll('a[href]')] as HTMLAnchorElement[]) {
        const href = a.getAttribute('href') || '';
        if (!patterns.some((r) => r.test(href))) continue;
        const text = (a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (text.length < minLen) continue;
        let canonical: string;
        try { canonical = normaliseUrl(a.href || href, url, allowed); } catch { continue; }
        out.push({
          externalId: canonical,
          title: text.slice(0, 240),
          canonicalUrl: canonical,
          originalUrl: a.href || href,
          publishedAt: null,
          excerpt: null,
          author: null,
          category: null,
        });
      }
    }

    const unique = [...new Map(out.filter((x) => x.title && x.canonicalUrl).map((x) => [x.canonicalUrl, x])).values()]
      .slice(0, Number(Deno.env.get('MARKET_UPDATES_MAX_ITEMS_PER_SOURCE') || 40));
    if (!unique.length) throw new Error('Listing layout yielded no public article metadata');
    return {
      items: unique,
      validation: { valid: true, format: 'html_listing', itemCount: unique.length, endpoint: url, httpStatus: response.status, latencyMs: latency },
    };
  }

  async validate(s: SourceConfig): Promise<SourceValidationResult> {
    try { return (await this.read(s, s.listing_urls[0] || s.primary_url!)).validation; }
    catch (e) { return { valid: false, format: 'html_listing', itemCount: 0, safeError: String((e as Error).message).slice(0, 240) }; }
  }

  async fetch(s: SourceConfig): Promise<NormalisedSourceBatch> {
    let last: Error | undefined;
    for (const u of s.listing_urls.length ? s.listing_urls : [s.primary_url!]) {
      try { return await this.read(s, u); } catch (e) { last = e as Error; }
    }
    throw last || new Error('No listing configured');
  }
}
