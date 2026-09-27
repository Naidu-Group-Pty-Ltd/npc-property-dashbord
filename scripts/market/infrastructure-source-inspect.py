"""
Read the publishers of the infrastructure pipeline, from a GitHub runner.

The development container cannot reach any .gov.au host, and the edge
functions' egress is not a place to explore from. A runner can, so this prints
what each candidate source ANSWERS — status, type, size and the text a reader
would see — into the job log. It writes nothing anywhere and holds no secret.

Two kinds of candidate, and they answer different questions:
  - PAGES: a responsible authority's own dated page about one project. What a
    `PublishedProject` row is recorded from (publishedProjectRegister.pure.ts).
  - REGISTERS: a catalogue or spatial service that might list projects by
    location, which is the only way every locality gets a pipeline.
Geocodes for the pages' stated sites come from OpenStreetMap's Nominatim, one
request a second, under the same rule the product's own geocoder keeps.
"""
import html, json, re, sys, time, urllib.parse, urllib.request, urllib.error

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

PAGES = [
  'https://www.nsw.gov.au/departments-and-agencies/health-infrastructure/news/construction-starts-for-new-rouse-hill-hospital',
  'https://www.nsw.gov.au/departments-and-agencies/health-infrastructure/news/rouse-hill-hospital-construction-works-notices',
  'https://www.nsw.gov.au/ministerial-releases/new-rouse-hill-hospital-moves-from-planning-to-delivery',
  'https://www.nsw.gov.au/ministerial-releases/construction-underway-under-minns-labor-government-on-long-promised-rouse-hill-hospital',
  'https://www.rousehillhospital.health.nsw.gov.au/',
  'https://www.schoolinfrastructure.nsw.gov.au/projects/new-schools/new-high-school-for-schofields-and-tallawong.html',
  'https://www.nsw.gov.au/ministerial-releases/construction-officially-underway-on-first-new-high-school-tallawong',
  'https://www.schoolinfrastructure.nsw.gov.au/projects/new-schools/new-primary-and-high-school-in-box-hill-terry-road.html',
  'https://www.transport.nsw.gov.au/projects/current-projects/richmond-road-upgrade-between-m7-motorway-and-townson-road-marsden-park',
  'https://www.nsw.gov.au/ministerial-releases/major-construction-begins-on-720-million-richmond-road-upgrade',
  'https://www.transport.nsw.gov.au/projects/current-projects/north-west-sydney',
]

REGISTERS = [
  'https://spatial.infrastructure.gov.au/portal/sharing/rest/content/items/25824e38421a4385a74a6937f6610988/data?f=json',
  'https://spatial.infrastructure.gov.au/portal/sharing/rest/content/items/25824e38421a4385a74a6937f6610988?f=json',
  'https://spatial.infrastructure.gov.au/server/rest/services?f=json',
  'https://catalogue.data.infrastructure.gov.au/api/3/action/package_search?q=infrastructure%20investment&rows=40',
  'https://data.gov.au/data/api/3/action/package_search?q=infrastructure%20investment%20program&rows=20',
  'https://data.nsw.gov.au/data/api/3/action/package_search?q=major%20projects&rows=25',
  'https://data.nsw.gov.au/data/api/3/action/package_search?q=infrastructure%20pipeline&rows=25',
  'https://www.planningportal.nsw.gov.au/major-projects/projects?lga=Blacktown',
  'https://investment.infrastructure.gov.au/projects',
]

GEOCODE = [
  'Rouse Hill Hospital, Commercial Road, Rouse Hill NSW',
  'corner Commercial Road and Windsor Road, Rouse Hill NSW 2155',
  '201 Guntawong Road, Tallawong NSW 2762',
  'Terry Road, Box Hill NSW 2765',
  'Richmond Road, Marsden Park NSW 2765',
  '37 Bolin Street, Tallawong NSW 2762',
]


def fetch(url, accept='*/*'):
  req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
  try:
    with urllib.request.urlopen(req, timeout=60) as r:
      return r.status, r.headers.get('content-type', ''), r.read()
  except urllib.error.HTTPError as e:
    return e.code, e.headers.get('content-type', ''), e.read()[:4000]
  except Exception as e:  # noqa: BLE001 — the log is the product
    return None, '', repr(e).encode()


def readable(body):
  text = body.decode('utf-8', 'replace')
  text = re.sub(r'(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>', ' ', text)
  text = re.sub(r'(?i)<br\s*/?>|</p>|</li>|</h[1-6]>|</tr>', '\n', text)
  text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
  lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in text.split('\n')]
  return '\n'.join(l for l in lines if len(l) > 2)


def dates_of(body):
  raw = body.decode('utf-8', 'replace')
  out = set()
  for pat in (r'"datePublished"\s*:\s*"([^"]+)"', r'"dateModified"\s*:\s*"([^"]+)"',
              r'<meta[^>]+(?:property|name)="(?:article:published_time|article:modified_time|dcterms\.[a-z]+|DC\.Date[^"]*)"[^>]+content="([^"]+)"',
              r'<time[^>]*datetime="([^"]+)"'):
    out.update(re.findall(pat, raw, re.I))
  return sorted(out)


print('=' * 100)
print('PAGES')
for url in PAGES:
  st, ct, body = fetch(url)
  print('\n' + '-' * 100)
  print(f'{url}\n  status={st} type={ct} bytes={len(body)} dates={dates_of(body)}')
  text = readable(body)
  i = text.find('Rouse Hill') if 'Rouse Hill' in text else 0
  # The article body sits after the site chrome; print a generous window.
  print(text[:9000])

print('\n' + '=' * 100)
print('REGISTERS')
for url in REGISTERS:
  st, ct, body = fetch(url, accept='application/json, text/html;q=0.9, */*;q=0.8')
  print('\n' + '-' * 100)
  print(f'{url}\n  status={st} type={ct} bytes={len(body)}')
  if 'json' in ct or body[:1] in (b'{', b'['):
    try:
      data = json.loads(body)
    except Exception as e:  # noqa: BLE001
      print('  unparseable json', e, body[:300])
      continue
    if isinstance(data, dict) and 'result' in data and isinstance(data['result'], dict) and 'results' in data['result']:
      print(f"  CKAN count={data['result'].get('count')}")
      for p in data['result']['results']:
        org = (p.get('organization') or {}).get('title')
        print(f"  - {p.get('name')} | {p.get('title')} | org={org} | licence={p.get('license_id')} | modified={p.get('metadata_modified')}")
        for r in p.get('resources', [])[:8]:
          print(f"      {r.get('format')} {r.get('url')}")
    else:
      s = json.dumps(data)
      urls = sorted(set(re.findall(r'https?://[^"\\ ]+(?:FeatureServer|MapServer)[^"\\ ]*', s)))
      print('  service urls:', urls[:40])
      print('  keys:', list(data.keys())[:40] if isinstance(data, dict) else type(data))
      print('  head:', s[:3000])
  else:
    text = readable(body)
    print(text[:6000])
    links = sorted(set(re.findall(r'href="([^"]*(?:\.csv|\.json|\.xlsx|api|FeatureServer|MapServer|download)[^"]*)"', body.decode('utf-8', 'replace'), re.I)))
    print('  data-looking links:', links[:40])

print('\n' + '=' * 100)
print('GEOCODES (OpenStreetMap Nominatim)')
for q in GEOCODE:
  time.sleep(1.2)
  url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'jsonv2', 'limit': 3, 'countrycodes': 'au'})
  st, ct, body = fetch(url, accept='application/json')
  try:
    hits = json.loads(body)
  except Exception:  # noqa: BLE001
    hits = []
  print(f'{q}\n  status={st}')
  for h in hits:
    print(f"   {h.get('lat')}, {h.get('lon')} | {h.get('type')} | {h.get('display_name')}")
