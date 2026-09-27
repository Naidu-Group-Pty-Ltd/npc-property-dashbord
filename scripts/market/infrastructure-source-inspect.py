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

# Round 3 (27 Sep 2026). Round 2 found the federal iPAMS layers answer by
# LOCATION — 1,134 point projects, 61,762 line segments, 65,220 derived points
# — and that most of what lies near a property is completed minor works (Roads
# to Recovery, Black Spot). This round reads the layers' own vocabulary
# (status, sub-programme, field list) and what a LIVE-project query returns
# around five real report addresses in four states. Earlier rounds' lists are
# in this file's history.
IPAMS = 'https://spatial.infrastructure.gov.au/server/rest/services/iPAMS-DB'
LAYERS = ['AuslinkGIS_Line_web', 'AuslinkGIS_Point_web', 'AuslinkGIS_Poly_web']
SITES = {
  'Tallawong NSW (37 Bolin St)': (-33.6903115, 150.8816157),
  'Kellyville NSW (97 Poole Rd)': (-33.7065, 150.9530),
  'Golden Square VIC (9 Hollow St)': (-36.7727, 144.2519),
  'Maryborough QLD (262 Pallas St)': (-25.5405, 152.7040),
  'Geraldton WA (Spalding)': (-28.7430, 114.6290),
}
FIELDS = 'Project_ID,ProjectName,ProjectStatus,SubProgram,TransportMode,EstimatedProjectCost,AGC,ExpectedStartDate,ExpectedEndDate,State,URL'

def stats(layer, field):
  q = urllib.parse.urlencode({
    'where': '1=1', 'groupByFieldsForStatistics': field,
    'outStatistics': json.dumps([{'statisticType': 'count', 'onStatisticField': 'OBJECTID', 'outStatisticFieldName': 'n'}]),
    'f': 'json',
  })
  return f'{IPAMS}/{layer}/MapServer/0/query?{q}'

def live_near(layer, lat, lon, km=15):
  q = urllib.parse.urlencode({
    'where': "ProjectStatus <> 'Completed'",
    'geometry': f'{lon},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': '4326',
    'spatialRel': 'esriSpatialRelIntersects', 'distance': str(km * 1000), 'units': 'esriSRUnit_Meter',
    'outFields': FIELDS, 'returnGeometry': 'false', 'returnDistinctValues': 'true', 'f': 'json',
  })
  return f'{IPAMS}/{layer}/MapServer/0/query?{q}'

PAGES = []
REGISTERS = [f'{IPAMS}/AuslinkGIS_Line_web/MapServer/0?f=json']
for layer in LAYERS:
  REGISTERS += [stats(layer, 'ProjectStatus'), stats(layer, 'SubProgram')]
for label, (lat, lon) in SITES.items():
  for layer in LAYERS:
    REGISTERS.append(live_near(layer, lat, lon))
GEOCODE = []


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
  print(text[:1500])
  raw = body.decode('utf-8', 'replace')
  print('  map links:', sorted(set(re.findall(r'href="([^"]*(?:maps\.google|google\.com/maps|maps\.apple|openstreetmap|/maps\?|[-]3[0-9]\.[0-9]{3,}[^"]*)[^"]*)"', raw)))[:20])
  print('  coordinates in page:', sorted(set(re.findall(r'-3[0-9]\.[0-9]{4,},\s*1[45][0-9]\.[0-9]{4,}', raw)))[:20])

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
      if isinstance(data, dict) and 'fields' in data and 'features' not in data:
        print('  fields:', [(f.get('name'), f.get('type')) for f in data['fields']])
      if isinstance(data, dict) and 'features' in data:
        feats = data['features']
        print(f'  features={len(feats)} exceededTransferLimit={data.get("exceededTransferLimit")}')
        for ft in feats[:80]:
          print('   ', json.dumps(ft.get('attributes'), ensure_ascii=False)[:600])
        continue
      s = json.dumps(data)
      urls = sorted(set(re.findall(r'https?://[^"\\ ]+(?:FeatureServer|MapServer)[^"\\ ]*', s)))
      print('  service urls:', urls[:40])
      print('  keys:', list(data.keys())[:40] if isinstance(data, dict) else type(data))
      print('  head:', s[:12000])
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
