const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i;
export function normaliseUrl(value:string, base:string, allowed:string[]):string {
  const url = new URL(value, base);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Disallowed URL scheme');
  const host=url.hostname.toLowerCase();
  if (!allowed.some(d=>host===d||host.endsWith(`.${d}`))) throw new Error('Disallowed source domain');
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error('Private network targets are forbidden');
  url.hash=''; [...url.searchParams.keys()].forEach(k=>{if(TRACKING.test(k))url.searchParams.delete(k)}); return url.toString();
}
export const sourceDomains=(s:{primary_url?:string|null;feed_urls:string[];listing_urls:string[]})=>[s.primary_url,...s.feed_urls,...s.listing_urls].filter(Boolean).map(v=>new URL(v!).hostname.toLowerCase());
export async function boundedFetch(url:string, init:RequestInit={}, timeout=15000, maxBytes=3_000_000):Promise<{response:Response;body:string;latency:number}> { const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);const started=Date.now();try{const response=await fetch(url,{...init,redirect:'follow',signal:c.signal});if(!response.ok)throw new Error(`Source returned HTTP ${response.status}`);const length=Number(response.headers.get('content-length')||0);if(length>maxBytes)throw new Error('Source response exceeded maximum size');const body=await response.text();if(new TextEncoder().encode(body).byteLength>maxBytes)throw new Error('Source response exceeded maximum size');return{response,body,latency:Date.now()-started};}finally{clearTimeout(t)}}
