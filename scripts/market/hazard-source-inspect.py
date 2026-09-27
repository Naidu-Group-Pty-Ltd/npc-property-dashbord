"""
Read the publishers of bushfire and flood mapping, from a GitHub runner.

The development container cannot reach any .gov.au host. A runner can, so
this prints what each candidate ANSWERS into the job log: the services a
publisher lists, the layers inside them, and what each hazard layer says at
real report addresses. It writes nothing anywhere and holds no secret.

The question it exists to settle (27 Sep 2026): the 37 Bolin Street Compass
printed bushfire and flood as "Not assessed" although the NSW hazard map was
asked at the lot and answered nothing. Whether "nothing mapped" is a finding
depends on what the map COVERS: a statewide statutory designation that shows
nothing over a lot says the lot is not designated; a map only some councils
publish says nothing about the councils that did not. So for each layer this
reads its own description, and counts features by council where it can.

Three kinds of read:
  - DIRECTORY: an ArcGIS services directory, filtered to hazard-shaped names.
  - LAYER: a layer's own metadata (name, description, copyright).
  - POINT: an identify or query at a real report address.
"""
import json, re, sys, urllib.parse, urllib.request, urllib.error

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
HAZARD = re.compile(r'flood|bush|fire|hazard|inund|storm|coastal|overland|riverine|prone', re.I)

# Real report addresses, one per jurisdiction, as (label, lng, lat).
POINTS = {
  'NSW': ('37 Bolin Street, Tallawong', 150.882147, -33.690695),
  'NSW2': ('Cowra (48 Redfern Street)', 148.6948, -33.8345),
  'VIC': ('Golden Square (9 Hollow Street)', 144.2482, -36.7768),
  'QLD': ('Maryborough (262 Pallas Street)', 152.7003, -25.5395),
  'SA': ('Prospect', 138.5947, -34.8840),
  'WA': ('Spalding, Geraldton (60 Lawley Street)', 114.6310, -28.7470),
  'TAS': ('Hobart', 147.3272, -42.8821),
  'ACT': ('Canberra (Braddon)', 149.1334, -35.2750),
  'NT': ('Darwin (Parap)', 130.8410, -12.4330),
}

NSW = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services'
DIRECTORIES = [
  f'{NSW}/ePlanning',
  f'{NSW}/Hazards',
  f'{NSW}',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/FloodCheck',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre',
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public',
  'https://portal.spatial.nsw.gov.au/server/rest/services',
  'https://services.ga.gov.au/gis/rest/services',
  'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services',
  'https://services.thelist.tas.gov.au/arcgis/rest/services/Public',
  'https://dpti.geohub.sa.gov.au/server/rest/services/Hosted',
  'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services',
]
LAYERS = [
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/229',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/230',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/231',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/232',
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Bushfire_Prone_Land/MapServer',
  'https://services.ga.gov.au/gis/services/NFRAG_Floodplain_Risk_Information/MapServer/WFSServer?service=WFS&request=GetCapabilities',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/BushfireProneAreas/MapServer',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/FloodCheck/RapidHazardAssessment/MapServer',
]


def fetch(url, accept='application/json,*/*'):
  req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
  try:
    with urllib.request.urlopen(req, timeout=60) as r:
      return r.status, r.headers.get('content-type', ''), r.read()
  except urllib.error.HTTPError as e:
    return e.code, e.headers.get('content-type', ''), e.read()[:4000]
  except Exception as e:  # noqa: BLE001 — the log is the product
    return None, '', repr(e).encode()


def as_json(body):
  try:
    return json.loads(body.decode('utf-8', 'replace'))
  except Exception:  # noqa: BLE001
    return None


def clip(s, n=600):
  s = re.sub(r'\s+', ' ', str(s or '')).strip()
  return s if len(s) <= n else s[:n] + ' …'


def directory(url):
  status, ctype, body = fetch(url + ('&' if '?' in url else '?') + 'f=json')
  print(f'\n=== DIRECTORY {url} status={status}')
  j = as_json(body)
  if not isinstance(j, dict):
    print('  ', clip(body.decode('utf-8', 'replace'), 300))
    return
  folders = j.get('folders') or []
  services = j.get('services') or []
  print(f'  folders {len(folders)} · services {len(services)}')
  hazardish = [f for f in folders if HAZARD.search(f)]
  if hazardish:
    print('  hazard-shaped folders:', hazardish)
  for s in services:
    name = s.get('name') or s.get('title') or ''
    if HAZARD.search(name):
      print(f"  service {name} ({s.get('type')})")


def layer(url):
  sep = '&' if '?' in url else '?'
  status, ctype, body = fetch(url if 'GetCapabilities' in url else url + sep + 'f=json')
  print(f'\n=== LAYER {url} status={status} type={ctype}')
  j = as_json(body)
  if not isinstance(j, dict):
    text = body.decode('utf-8', 'replace')
    names = re.findall(r'<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>', text)
    print('   feature types:', names[:40])
    print('  ', clip(text, 400))
    return
  if j.get('error'):
    print('   error:', j['error'])
    return
  for k in ('name', 'mapName', 'description', 'serviceDescription', 'copyrightText', 'type', 'geometryType',
            'defaultVisibility', 'maxRecordCount'):
    if j.get(k) not in (None, ''):
      print(f'   {k}: {clip(j[k])}')
  if j.get('layers'):
    for l in j['layers']:
      if HAZARD.search(l.get('name', '')):
        print(f"   layer {l.get('id')}: {l.get('name')}")
  if j.get('fields'):
    print('   fields:', [f.get('name') for f in j['fields']][:30])


def identify(base, lng, lat, layers='all'):
  d = 0.0005
  p = urllib.parse.urlencode({
    'f': 'json', 'geometry': json.dumps({'x': lng, 'y': lat}), 'geometryType': 'esriGeometryPoint', 'sr': '4326',
    'layers': layers, 'tolerance': '0', 'mapExtent': f'{lng-d},{lat-d},{lng+d},{lat+d}',
    'imageDisplay': '400,400,96', 'returnGeometry': 'false',
  })
  status, _, body = fetch(f'{base}/identify?{p}')
  j = as_json(body)
  results = (j or {}).get('results') if isinstance(j, dict) else None
  print(f'  identify {base.split("/services/")[-1]} layers={layers} status={status} results={None if results is None else len(results)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  for r in (results or [])[:12]:
    attrs = {k: v for k, v in (r.get('attributes') or {}).items() if v not in (None, '', 'Null')}
    print(f"   · {r.get('layerId')} {r.get('layerName')}: {clip(json.dumps(attrs)[:500], 500)}")


def query(url, lng, lat, label):
  p = urllib.parse.urlencode({
    'f': 'json', 'geometry': f'{lng},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': '4326',
    'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'returnGeometry': 'false',
  })
  status, _, body = fetch(f'{url}/query?{p}')
  j = as_json(body)
  feats = (j or {}).get('features') if isinstance(j, dict) else None
  print(f'  query {label} status={status} features={None if feats is None else len(feats)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  for f in (feats or [])[:6]:
    attrs = {k: v for k, v in (f.get('attributes') or {}).items() if v not in (None, '', 'Null')}
    print('   ·', clip(json.dumps(attrs), 500))


def count_by(url, field):
  """How much of the state a layer covers: its features grouped by a field."""
  p = urllib.parse.urlencode({
    'f': 'json', 'where': '1=1', 'groupByFieldsForStatistics': field,
    'outStatistics': json.dumps([{'statisticType': 'count', 'onStatisticField': field, 'outStatisticFieldName': 'n'}]),
  })
  status, _, body = fetch(f'{url}/query?{p}')
  j = as_json(body)
  feats = (j or {}).get('features') if isinstance(j, dict) else None
  print(f'  count by {field} status={status} groups={None if feats is None else len(feats)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  groups = sorted(((f.get('attributes') or {}).get(field), (f.get('attributes') or {}).get('n')) for f in (feats or []))
  print('   ', clip(json.dumps(groups), 3000))


for url in DIRECTORIES:
  directory(url)
for url in LAYERS:
  layer(url)

print('\n\n######## POINT READINGS')
hz = f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer'
for key in ('NSW', 'NSW2'):
  label, lng, lat = POINTS[key]
  print(f'\n--- {label}')
  identify(hz, lng, lat, 'all:229,230,231,232')
  identify(hz, lng, lat, 'all')
  query('https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Bushfire_Prone_Land/MapServer/0', lng, lat, 'six BFPL')

label, lng, lat = POINTS['QLD']
print(f'\n--- {label}')
query('https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/BushfireProneAreas/MapServer/0', lng, lat, 'QLD BPA')
identify('https://spatial-gis.information.qld.gov.au/arcgis/rest/services/FloodCheck/RapidHazardAssessment/MapServer', lng, lat)

print('\n\n######## COVERAGE — which councils publish a flood planning map to the NSW layer')
for lid in (230, 231):
  layer_url = f'{hz}/{lid}'
  status, _, body = fetch(layer_url + '?f=json')
  j = as_json(body) or {}
  fields = [f.get('name') for f in j.get('fields') or []]
  print(f'\n layer {lid} {j.get("name")} fields={fields}')
  for candidate in ('LGA_NAME', 'LGA', 'COUNCIL', 'EPI_NAME', 'LEP_NAME', 'EPI'):
    if candidate in fields:
      count_by(layer_url, candidate)
      break

print('\n\nVIC — bushfire-prone-area and flood feature types on the Vicmap WFS')
status, _, body = fetch('https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&request=GetCapabilities', 'application/xml')
text = body.decode('utf-8', 'replace')
names = re.findall(r'<Name>([^<]+)</Name>', text)
print(f' status={status} feature types={len(names)}')
print(' hazard-shaped:', [n for n in names if HAZARD.search(n)][:60])
