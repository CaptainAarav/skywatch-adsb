#!/usr/bin/env python3
"""Build html/airport-db/airports.json from the OurAirports CSV files (public domain, github.com/davidmegginson/ourairports-data).

  python3 tools/build-airports.py [--src DIR]    # DIR with the CSVs; downloaded from the OurAirports site if omitted

Closed airports and heliports are dropped, and so are small fields without an IATA or 4-letter ICAO-style code. Output (compact, loaded lazily by html/ui/airport-panel.js):
  {v, built, src, types[], countries{code:name}, regions{code:name}, a:[row,...]}
  row = [ident, iata, typeIdx, name, lat, lon, elev_ft, country, region, municipality, wikipedia_path,
         [[le, he, length_ft, width_ft, surface, lighted, le_hdg_true, he_hdg_true], ...], [[type, mhz], ...]]
Note: OurAirports has no ILS data (its navaids file lists NDB/VOR/DME/TACAN only), so none is output.
"""
import csv, gzip, io, json, os, sys, time, urllib.request, argparse

BASE = 'https://davidmegginson.github.io/ourairports-data/'
FILES = ['airports', 'runways', 'airport-frequencies', 'navaids', 'countries', 'regions']
TYPES = ['large_airport', 'medium_airport', 'small_airport', 'seaplane_base', 'balloonport']
WIKI = 'https://en.wikipedia.org/wiki/'


def rows(src, name):
    p = os.path.join(src, name + '.csv') if src else None
    if p and os.path.exists(p):
        f = open(p, encoding='utf-8', newline='')
    else:
        f = io.StringIO(urllib.request.urlopen(BASE + name + '.csv', timeout=120).read().decode('utf-8'))
    return csv.DictReader(f)


def num(s, cast=float):
    try:
        return cast(s)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'html', 'airport-db', 'airports.json'))
    a = ap.parse_args()

    ap_rows, by_id = [], {}
    for r in rows(a.src, 'airports'):
        if r['type'] not in TYPES:
            continue                                   # drops closed and heliport
        lat, lon = num(r['latitude_deg']), num(r['longitude_deg'])
        if lat is None or lon is None:
            continue
        wiki = r['wikipedia_link']
        wiki = wiki[len(WIKI):] if wiki.startswith(WIKI) else ''
        iata = r['iata_code']
        code = r['icao_code'] or r['ident']
        # keep large/medium, anything with an IATA code, and small fields with an ICAO-style 4-letter code
        if r['type'] not in TYPES[:2] and not iata and not (len(code) == 4 and code.isalpha()):
            continue
        row = [code, iata, TYPES.index(r['type']), r['name'], round(lat, 5), round(lon, 5),
               num(r['elevation_ft'], int), r['iso_country'], r['iso_region'], r['municipality'], wiki, [], []]
        by_id[r['id']] = row
        ap_rows.append(row)

    for r in rows(a.src, 'runways'):
        row = by_id.get(r['airport_ref'])
        if not row or r['closed'] == '1':
            continue
        row[11].append([r['le_ident'], r['he_ident'], num(r['length_ft'], int), num(r['width_ft'], int), r['surface'],
                        1 if r['lighted'] == '1' else 0, num(r['le_heading_degT']), num(r['he_heading_degT'])])
    for r in rows(a.src, 'airport-frequencies'):
        row = by_id.get(r['airport_ref'])
        mhz = num(r['frequency_mhz'])
        if row and mhz:
            row[12].append([r['type'], mhz])

    countries = {r['code']: r['name'] for r in rows(a.src, 'countries')}
    regions = {r['code']: r['name'] for r in rows(a.src, 'regions')}
    used_c = {r[7] for r in ap_rows}
    used_r = {r[8] for r in ap_rows}
    out = {'v': 1, 'built': time.strftime('%Y-%m-%d', time.gmtime()), 'src': 'OurAirports (public domain)', 'types': TYPES,
           'countries': {k: v for k, v in countries.items() if k in used_c},
           'regions': {k: v for k, v in regions.items() if k in used_r}, 'a': ap_rows}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    data = json.dumps(out, separators=(',', ':'), ensure_ascii=False).encode()
    with open(a.out, 'wb') as f:
        f.write(data)
    print(f'{len(ap_rows)} airports, {len(data)} bytes, {len(gzip.compress(data, 9))} bytes gzipped -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
