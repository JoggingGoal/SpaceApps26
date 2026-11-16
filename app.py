"""FieldShift starter development server (Python standard library only).

Start with: python app.py
API: GET /api/climate?lat=42.03&lon=-93.62
Observations: NASA POWER Daily Point API, 2016-2025 inclusive.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import statistics
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / 'data' / 'cache'
NASA_API = 'https://power.larc.nasa.gov/api/temporal/daily/point'
START, END = '20160101', '20251231'
CACHE_SECONDS = 60 * 60 * 24
PARAMETERS = 'PRECTOTCORR,T2M_MAX,T2M_MIN'


def safe_value(value):
    """NASA uses -999 for absent values; never treat them as real observations."""
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= -900:
        return None
    return float(value)


def longest_dry_spell(rows, threshold=1.0):
    longest = current = 0
    for row in rows:
        p = row['precip']
        if p is None:
            current = 0  # Missing data must not extend a dry spell.
        elif p < threshold:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def summarize(rows, lat, lon):
    by_year = defaultdict(list)
    for day in rows:
        by_year[int(day['date'][:4])].append(day)

    annual = []
    for year, entries in sorted(by_year.items()):
        growing = [r for r in entries if 4 <= int(r['date'][5:7]) <= 9]
        p = [r['precip'] for r in growing if r['precip'] is not None]
        highs = [r['tmax'] for r in growing if r['tmax'] is not None]
        valid_t = [r for r in growing if r['tmax'] is not None and r['tmin'] is not None]
        gdd = sum(max(0, (r['tmax'] + r['tmin']) / 2 - 10) for r in valid_t)
        # Exclude substantially incomplete growing seasons from rankings.
        if min(len(p), len(highs), len(valid_t)) < len(growing) * .90:
            continue
        annual.append({
            'year': year,
            'rainfall': round(sum(p), 1),
            'hotDays': sum(t >= 32 for t in highs),
            'drySpell': longest_dry_spell(growing),
            'gdd': round(gdd, 1),
        })

    monthly_by_year = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r['precip'] is not None:
            monthly_by_year[int(r['date'][5:7])][int(r['date'][:4])].append(r['precip'])
    # Each year's monthly precipitation is summed, then years are averaged.
    monthly = []
    for month in range(1, 13):
        sums = [sum(days) for days in monthly_by_year[month].values()
                if len(days) >= (25 if month == 2 else 27)]
        monthly.append(round(statistics.mean(sums), 1) if sums else None)

    valid_days = sum(r['precip'] is not None and r['tmax'] is not None and r['tmin'] is not None for r in rows)
    return {
        'source': 'NASA POWER Daily Point API',
        'sourceUrl': 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
        'period': {'start': START, 'end': END},
        'location': {'lat': lat, 'lon': lon},
        'units': {'precip': 'mm/day', 'tmax': '°C', 'tmin': '°C'},
        'definitions': {
            'growingSeason': 'April 1 through September 30',
            'hotDay': 'daily maximum temperature >= 32°C',
            'dryDay': 'daily precipitation < 1 mm',
            'gdd': 'sum max(0, (Tmax + Tmin)/2 - 10°C)',
        },
        'quality': {'validDays': valid_days, 'totalDays': len(rows), 'annualYears': len(annual)},
        'annual': annual,
        'monthlyRainfall': monthly,
        'daily': rows,
    }


def request_nasa(lat, lon):
    query = urlencode({
        'latitude': f'{lat:.4f}', 'longitude': f'{lon:.4f}',
        'start': START, 'end': END, 'community': 'AG',
        'parameters': PARAMETERS, 'format': 'JSON',
    })
    req = Request(NASA_API + '?' + query, headers={
        'User-Agent': 'FieldShift-Student-Project/1.0', 'Accept': 'application/json',
    })
    with urlopen(req, timeout=50) as response:
        raw = json.load(response)
    values = raw.get('properties', {}).get('parameter', {})
    required = ('PRECTOTCORR', 'T2M_MAX', 'T2M_MIN')
    if any(k not in values or not isinstance(values[k], dict) for k in required):
        raise ValueError('NASA response did not contain the expected daily measurements.')
    dates = sorted(set().union(*(values[k].keys() for k in required)))
    if len(dates) < 300:
        raise ValueError('NASA response did not contain enough observations.')
    rows = []
    for d in dates:
        try:
            date = datetime.strptime(d, '%Y%m%d').strftime('%Y-%m-%d')
        except ValueError:
            continue
        rows.append({
            'date': date,
            'precip': safe_value(values['PRECTOTCORR'].get(d)),
            'tmax': safe_value(values['T2M_MAX'].get(d)),
            'tmin': safe_value(values['T2M_MIN'].get(d)),
        })
    return summarize(rows, lat, lon)


def fetch_climate(lat, lon):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # NASA's native grid is coarser than a field; nearby requests reuse cache.
    key = f'{lat:.2f}_{lon:.2f}'.replace('-', 'm')
    path = CACHE_DIR / f'{key}.json'
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_SECONDS:
        payload = json.loads(path.read_text(encoding='utf-8'))
        payload['retrieval'] = 'cached'
        return payload
    try:
        payload = request_nasa(lat, lon)
        path.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
        payload['retrieval'] = 'live'
        return payload
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        if path.exists():
            payload = json.loads(path.read_text(encoding='utf-8'))
            payload['retrieval'] = 'cached-stale'
            payload['warning'] = f'NASA request failed; showing previously downloaded data ({type(exc).__name__}).'
            return payload
        raise



# Optional data endpoints for Explore the Land. Each uses a documented NASA
# service. Failed remote requests are reported as unavailable, never guessed.
ORNL_API = 'https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset'


def external_json(url, timeout=45):
    req = Request(url, headers={
        'User-Agent': 'Green-Revolution-Student-Prototype/1.0',
        'Accept': 'application/json',
    })
    with urlopen(req, timeout=timeout) as response:
        return json.load(response)


def cached_external(key, producer, expire=CACHE_SECONDS):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / key
    if path.exists() and time.time() - path.stat().st_mtime < expire:
        data = json.loads(path.read_text(encoding='utf-8'))
        data['retrieval'] = 'cached'
        return data
    try:
        data = producer()
        path.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
        data['retrieval'] = 'live'
        return data
    except Exception:
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            data['retrieval'] = 'cached-stale'
            data['warning'] = 'Showing previously downloaded observations; current data source unavailable.'
            return data
        raise


def summarize_soil_wetness(series, lat, lon):
    """Summarize NASA POWER model-derived wetness (0–1) by calendar month."""
    by_month = defaultdict(list)
    latest = defaultdict(list)
    by_year = defaultdict(list)
    for date, value in series.items():
        v = safe_value(value)
        if v is None or v < 0 or v > 1:
            continue
        try:
            dt = datetime.strptime(date, '%Y%m%d')
        except ValueError:
            continue
        by_month[dt.month].append(v)
        if dt.year == 2025:
            latest[dt.month].append(v)
        if 4 <= dt.month <= 9:
            by_year[dt.year].append(v)
    if sum(map(len, by_month.values())) < 300:
        raise ValueError('Not enough valid NASA model soil-wetness values.')
    months = [{
        'month': m,
        'historical': round(statistics.mean(by_month[m]), 3) if by_month[m] else None,
        'latest': round(statistics.mean(latest[m]), 3) if latest[m] else None,
    } for m in range(1, 13)]
    annual = [{'year': year, 'growingSeasonMean': round(statistics.mean(vals), 3)}
              for year, vals in sorted(by_year.items()) if len(vals) >= 150]
    return {
        'source': 'NASA POWER Hydrology / MERRA-2 model',
        'sourceUrl': 'https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/',
        'variable': 'GWETROOT', 'unit': 'fraction, 0–1',
        'definition': 'Regional modeled root-zone soil wetness, NOT SMAP field-level measurements or soil texture.',
        'location': {'lat':lat, 'lon':lon}, 'period': {'start':START,'end':END},
        'months': months, 'annual': annual,
        'sampleCount': sum(map(len, by_month.values())),
    }


def request_soil_wetness(lat, lon):
    query = urlencode({
        'latitude': f'{lat:.4f}', 'longitude': f'{lon:.4f}',
        'start': START, 'end': END, 'community': 'HY',
        'parameters': 'GWETROOT', 'format': 'JSON',
    })
    raw = external_json(NASA_API + '?' + query)
    values = raw.get('properties', {}).get('parameter', {}).get('GWETROOT')
    if not isinstance(values, dict):
        raise ValueError('NASA POWER did not return GWETROOT.')
    return summarize_soil_wetness(values, lat, lon)


def fetch_soil_wetness(lat, lon):
    key = 'gwetroot_' + f'{lat:.2f}_{lon:.2f}'.replace('-', 'm') + '.json'
    return cached_external(key, lambda:request_soil_wetness(lat,lon))


def summarize_modis_ndvi(payload, lat, lon):
    """Extract quality-screened median NDVI from a small MOD13Q1 subset.

    MOD13Q1 NDVI values have scale factor 0.0001. Reliability 0/1 are
    good/marginal; 2/3 indicate snow/cloud and are excluded.
    """
    records = payload.get('subset', [])
    by_date = defaultdict(dict)
    for item in records:
        if not isinstance(item, dict):
            continue
        date, band = item.get('modis_date'), item.get('band')
        if date and band in ('250m_16_days_NDVI', '250m_16_days_pixel_reliability'):
            by_date[date][band] = item.get('data') or []
    points = []
    for modis_date, bands in sorted(by_date.items()):
        ndvi = bands.get('250m_16_days_NDVI', [])
        qa = bands.get('250m_16_days_pixel_reliability', [])
        if not ndvi or len(qa) != len(ndvi):
            continue  # No quality data -> do not invent valid readings.
        accepted = []
        for raw_val, quality in zip(ndvi, qa):
            if not isinstance(raw_val, (int,float)) or quality not in (0, 1):
                continue
            scaled = float(raw_val) * 0.0001
            if -0.2 <= scaled <= 1:
                accepted.append(scaled)
        if not accepted:
            continue
        dt = datetime.strptime(modis_date, 'A%Y%j')
        points.append({'date': dt.strftime('%Y-%m-%d'),
                       'ndvi': round(statistics.median(accepted), 3),
                       'validPixels': len(accepted), 'totalPixels': len(ndvi)})
    if not points:
        raise ValueError('No quality-screened NDVI observations returned.')
    return {
        'source': 'NASA ORNL DAAC / Terra MODIS MOD13Q1',
        'sourceUrl': 'https://modis.ornl.gov/data/modis_webservice.html',
        'method': 'Median of pixels marked good or marginal by MODIS reliability band within the requested small regional subset.',
        'period': {'start':'2025-04-01','end':'2025-08-31'},
        'scale': '250 m, 16-day composites',
        'location': {'lat':lat,'lon':lon}, 'points': points,
    }


def request_modis_ndvi(lat, lon):
    query = urlencode({
        'latitude': f'{lat:.4f}', 'longitude': f'{lon:.4f}',
        'startDate': 'A2025097', 'endDate': 'A2025241',
        'kmAboveBelow': 1, 'kmLeftRight': 1,
    })
    raw = external_json(ORNL_API + '?' + query, timeout=45)
    return summarize_modis_ndvi(raw, lat, lon)


def fetch_modis_ndvi(lat, lon):
    key = 'mod13q1_' + f'{lat:.2f}_{lon:.2f}'.replace('-', 'm') + '.json'
    return cached_external(key, lambda: request_modis_ndvi(lat,lon), expire=CACHE_SECONDS*7)


# Search only resolves a place name to coordinates; observations still come from NASA POWER.
GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search'


def search_cities(query):
    query = query.strip()
    if len(query) < 2 or len(query) > 100:
        raise ValueError('Search at least two characters and at most 100.')
    params = urlencode({'name': query, 'count': 6, 'language': 'en', 'format': 'json'})
    raw = external_json(GEOCODING_API + '?' + params, timeout=15)
    places = []
    for item in raw.get('results', []):
        lat = item.get('latitude')
        lon = item.get('longitude')
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        places.append({
            'name': str(item.get('name', 'Unknown')),
            'admin1': str(item.get('admin1', '')),
            'country': str(item.get('country', '')),
            'lat': float(lat), 'lon': float(lon),
        })
    return {'results': places, 'source': 'Open-Meteo Geocoding / GeoNames'}




def fetch_extended_farm_data(lat, lon, is_ndvi=False):
    """Monthly 1991–2020 NASA climate normal or optional 5-year MODIS NDVI.

    Uses the supplied server.py's calculation functions; caches successes to
    avoid excess remote requests. These are distinct from the daily API data.
    """
    import farmwise_backend as farmwise
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    kind = 'ndvi' if is_ndvi else 'normal'
    path = CACHE_DIR / f'farmwise_{kind}_{lat:.2f}_{lon:.2f}.json'.replace('-', 'm')
    age_seconds = 60 * 60 * 24 * (7 if is_ndvi else 30)
    if path.exists() and (time.time() - path.stat().st_mtime) < age_seconds:
        return json.loads(path.read_text(encoding='utf-8'))
    try:
        if is_ndvi:
            payload = farmwise._modis_ndvi_summary(lat, lon)
        else:
            query = urlencode({
                'parameters': 'PRECTOTCORR,T2M,T2M_MAX', 'community': 'AG',
                'latitude': round(lat, 5), 'longitude': round(lon, 5),
                'start': farmwise.CLIMATE_START_YEAR, 'end': farmwise.CLIMATE_END_YEAR,
                'format': 'JSON',
            })
            payload = farmwise._climate_summary(
                farmwise._fetch_json(f'{farmwise.NASA_POWER_URL}?{query}')
            )
        path.write_text(json.dumps(payload), encoding='utf-8')
        return payload
    except Exception:
        if path.exists():
            payload = json.loads(path.read_text(encoding='utf-8'))
            payload['warning'] = 'Showing a previously cached optional dataset.'
            return payload
        raise


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, content, status=200):
        body = json.dumps(content, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/':
            self.send_response(302)
            self.send_header('Location', '/HOME/home.html')
            self.end_headers()
            return
        if parsed.path == '/api/geocode':
            query = parse_qs(parsed.query).get('q', [''])[0]
            try:
                self.send_json(search_cities(query))
            except ValueError as exc:
                self.send_json({'error': str(exc)}, 400)
            except Exception as exc:
                print('City lookup error:', repr(exc))
                self.send_json({'error': 'City search is temporarily unavailable. Try an example city or click the map.'}, 502)
            return
        # Optional monthly climate normal and point NDVI from the user's uploaded
        # server.py. They are independent of the fast daily NASA POWER comparison.
        if parsed.path in ('/api/farm-normals', '/api/farm-ndvi'):
            params = parse_qs(parsed.query)
            try:
                lat = float(params.get('lat', [''])[0])
                lon = float(params.get('lon', [''])[0])
                if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('Out of bounds')
            except (ValueError, IndexError):
                self.send_json({'error': 'Provide valid latitude and longitude.'}, 400)
                return
            try:
                self.send_json(fetch_extended_farm_data(lat, lon, parsed.path == '/api/farm-ndvi'))
            except Exception as exc:
                print('Optional farm dataset error:', type(exc).__name__, str(exc)[:180])
                self.send_json({'error': 'The optional NASA source could not return usable data. The main simulator still works.',
                                'detail': type(exc).__name__}, 502)
            return
        if parsed.path == '/api/health':
            self.send_json({'ok': True, 'project': 'FieldShift', 'weatherSource': 'NASA POWER'})
            return
        if parsed.path in ('/api/soil-wetness', '/api/ndvi'):
            params = parse_qs(parsed.query)
            try:
                lat = float(params.get('lat', ['42.03'])[0])
                lon = float(params.get('lon', ['-93.62'])[0])
                if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('Invalid coordinates')
            except (ValueError, IndexError):
                self.send_json({'error':'Invalid latitude or longitude.'},400)
                return
            try:
                payload = (fetch_soil_wetness(lat,lon) if parsed.path == '/api/soil-wetness'
                           else fetch_modis_ndvi(lat,lon))
                self.send_json(payload)
            except Exception as exc:
                print('Optional environmental source error:',parsed.path, repr(exc))
                self.send_json({'error':'This NASA dataset is unavailable for the selected point right now.',
                                'detail':type(exc).__name__},502)
            return
        if parsed.path == '/api/climate':
            params = parse_qs(parsed.query)
            try:
                lat = float(params.get('lat', ['42.03'])[0])
                lon = float(params.get('lon', ['-93.62'])[0])
                if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('Coordinates must be valid latitude and longitude.')
            except (ValueError, IndexError):
                self.send_json({'error': 'Invalid latitude or longitude.'}, 400)
                return
            try:
                self.send_json(fetch_climate(lat, lon))
            except Exception as exc:
                print('NASA climate error:', repr(exc))
                self.send_json({'error': 'Could not retrieve NASA POWER data. Check connectivity and try again.',
                                'detail': type(exc).__name__}, 502)
            return
        return super().do_GET()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    print(f'FieldShift starting at http://localhost:{port}')
    print('Open the forwarded Port 8000 in GitHub Codespaces.')
    with ThreadingHTTPServer(('0.0.0.0', port), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
