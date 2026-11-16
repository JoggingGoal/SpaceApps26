#!/usr/bin/env python3
import calendar
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
import math
import statistics
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
MODIS_API_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"
CLIMATE_START_YEAR = 1991
CLIMATE_END_YEAR = 2020
NASA_REQUEST_INTERVAL_SECONDS = 5
NDVI_COMPLETE_YEARS = 5
MODIS_DATES_PER_REQUEST = 10
MODIS_MAX_CONCURRENT_REQUESTS = 3
MIN_VALID_NDVI_COMPOSITES_PER_YEAR = 5
NDVI_TREND_THRESHOLD_PER_YEAR = 0.01
NASA_HTTP_TIMEOUT_SECONDS = 45

_request_lock = threading.Lock()
_last_nasa_request = 0.0


def _number(parameter, key):
    try:
        value = float(parameter[key])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(value) or value <= -900:
        return None
    return value


def _climate_summary(payload):
    try:
        parameters = payload["properties"]["parameter"]
    except (KeyError, TypeError):
        raise ValueError("NASA POWER returned an unexpected response.") from None

    required = ("PRECTOTCORR", "T2M", "T2M_MAX")
    if any(name not in parameters or not isinstance(parameters[name], dict) for name in required):
        raise ValueError("NASA POWER did not return all requested climate parameters.")

    annual_rainfall = []
    annual_temperatures = []
    warmest_month_highs = {month: [] for month in range(1, 13)}
    for year in range(CLIMATE_START_YEAR, CLIMATE_END_YEAR + 1):
        rainfall_total = 0.0
        temperature_total = 0.0
        days_total = 0
        valid_year = True
        for month in range(1, 13):
            key = f"{year}{month:02d}"
            days = calendar.monthrange(year, month)[1]
            precipitation_rate = _number(parameters["PRECTOTCORR"], key)
            mean_temperature = _number(parameters["T2M"], key)
            mean_daily_high = _number(parameters["T2M_MAX"], key)
            if precipitation_rate is None or mean_temperature is None or mean_daily_high is None:
                valid_year = False
                continue
            rainfall_total += precipitation_rate * days
            temperature_total += mean_temperature * days
            days_total += days
            warmest_month_highs[month].append(mean_daily_high)
        if valid_year and days_total:
            annual_rainfall.append(rainfall_total)
            annual_temperatures.append(temperature_total / days_total)

    if len(annual_rainfall) < 24:
        raise ValueError("NASA POWER returned too few complete years for a climate normal.")

    first_half = statistics.mean(annual_rainfall[:15])
    second_half = statistics.mean(annual_rainfall[-15:])
    rainfall_change = second_half - first_half
    if first_half >= 1:
        rainfall_change_percent = rainfall_change / first_half * 100
        if rainfall_change_percent <= -10:
            rainfall_pattern = "drier"
        elif rainfall_change_percent >= 10:
            rainfall_pattern = "wetter"
        else:
            rainfall_pattern = "stable"
    elif rainfall_change <= -50:
        rainfall_change_percent = None
        rainfall_pattern = "drier"
    elif rainfall_change >= 50:
        rainfall_change_percent = None
        rainfall_pattern = "wetter"
    else:
        rainfall_change_percent = None
        rainfall_pattern = "stable"

    monthly_high_averages = [
        statistics.mean(values)
        for values in warmest_month_highs.values()
        if values
    ]
    if not monthly_high_averages:
        raise ValueError("NASA POWER did not return warm-season temperatures.")
    warmest_month_high = max(monthly_high_averages)
    if warmest_month_high >= 35:
        heat_risk = "high"
    elif warmest_month_high >= 28:
        heat_risk = "medium"
    else:
        heat_risk = "low"

    elevation = None
    try:
        candidate = float(payload["geometry"]["coordinates"][2])
        if math.isfinite(candidate) and candidate > -900:
            elevation = round(candidate, 1)
    except (KeyError, IndexError, TypeError, ValueError):
        pass

    return {
        "period": f"{CLIMATE_START_YEAR}-{CLIMATE_END_YEAR}",
        "completeYears": len(annual_rainfall),
        "annualRainfallMm": round(statistics.mean(annual_rainfall), 1),
        "annualTemperatureC": round(statistics.mean(annual_temperatures), 1),
        "warmestMonthMeanDailyHighC": round(warmest_month_high, 1),
        "rainfallChangePercent": round(rainfall_change_percent, 1) if rainfall_change_percent is not None else None,
        "rainfallPattern": rainfall_pattern,
        "heatRisk": heat_risk,
        "gridElevationMeters": elevation,
        "source": "NASA POWER monthly Agroclimatology (PRECTOTCORR, T2M, T2M_MAX)",
        "resolutionNote": "NASA grid-cell estimate; not a field measurement."
    }


def _fetch_json(url, timeout=NASA_HTTP_TIMEOUT_SECONDS):
    request = Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "FieldwisePlanner/1.0"
    })
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _modis_ndvi_summary(latitude, longitude):
    query = urlencode({"latitude": latitude, "longitude": longitude})
    dates_payload = _fetch_json(f"{MODIS_API_URL}/dates?{query}")
    records = dates_payload.get("dates")
    if not isinstance(records, list):
        raise ValueError("NASA MODIS returned an unexpected date response.")

    end_year = date.today().year - 1
    start_year = end_year - NDVI_COMPLETE_YEARS + 1
    dates = []
    for item in records:
        if not isinstance(item, dict):
            continue
        calendar_date = item.get("calendar_date")
        modis_date = item.get("modis_date")
        if not isinstance(calendar_date, str) or not calendar_date[:4].isdigit() or not isinstance(modis_date, str):
            continue
        year = int(calendar_date[:4])
        if start_year <= year <= end_year:
            dates.append(item)
    annual_values = {year: [] for year in range(start_year, end_year + 1)}

    chunks = [
        dates[offset:offset + MODIS_DATES_PER_REQUEST]
        for offset in range(0, len(dates), MODIS_DATES_PER_REQUEST)
    ]
    subset_urls = []
    for chunk in chunks:
        subset_query = urlencode({
            "latitude": latitude,
            "longitude": longitude,
            "startDate": chunk[0]["modis_date"],
            "endDate": chunk[-1]["modis_date"],
            "kmAboveBelow": 0,
            "kmLeftRight": 0
        })
        subset_urls.append(f"{MODIS_API_URL}/subset?{subset_query}")

    unavailable_batches = 0
    with ThreadPoolExecutor(max_workers=MODIS_MAX_CONCURRENT_REQUESTS) as executor:
        subset_requests = [executor.submit(_fetch_json, url) for url in subset_urls]
        for chunk, subset_request in zip(chunks, subset_requests):
            try:
                subset_payload = subset_request.result()
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
                unavailable_batches += 1
                continue
            bands_by_date = {}
            subset = subset_payload.get("subset")
            if not isinstance(subset, list):
                raise ValueError("NASA MODIS returned an unexpected vegetation response.")
            for item in subset:
                if not isinstance(item, dict):
                    continue
                band = item.get("band")
                modis_date = item.get("modis_date")
                if band in ("250m_16_days_NDVI", "250m_16_days_pixel_reliability") and isinstance(modis_date, str):
                    bands_by_date.setdefault(modis_date, {})[band] = item.get("data", [])

            for record in chunk:
                modis_date = record["modis_date"]
                values = bands_by_date.get(modis_date, {})
                ndvi_values = values.get("250m_16_days_NDVI", [])
                reliability_values = values.get("250m_16_days_pixel_reliability", [])
                good_pixels = []
                for raw_ndvi, raw_reliability in zip(ndvi_values, reliability_values):
                    try:
                        ndvi_value = int(raw_ndvi)
                        reliability = int(raw_reliability)
                    except (TypeError, ValueError):
                        continue
                    if -2000 <= ndvi_value <= 10000 and reliability in (0, 1):
                        good_pixels.append(ndvi_value * 0.0001)
                if good_pixels:
                    year = int(record["calendar_date"][:4])
                    annual_values[year].append(statistics.mean(good_pixels))

    annual_means = [
        {"year": year, "ndvi": statistics.mean(values), "composites": len(values)}
        for year, values in annual_values.items()
        if len(values) >= MIN_VALID_NDVI_COMPOSITES_PER_YEAR
    ]
    resolution_note = "Point sample from a ~250 m MODIS pixel; not a field-boundary average."
    batch_note = (
        f" {unavailable_batches} of {len(chunks)} MODIS data batches were unavailable."
        if unavailable_batches
        else ""
    )
    if len(annual_means) < 3:
        return {
            "latestNdvi": None,
            "trend": "unknown",
            "trendSlopePerYear": None,
            "startYear": start_year,
            "endYear": end_year,
            "compositesUsed": sum(len(values) for values in annual_values.values()),
            "annualMeans": annual_means,
            "message": f"Not enough quality-screened MODIS observations in at least three years to estimate an NDVI trend.{batch_note}",
            "resolutionNote": resolution_note
        }

    years = [item["year"] for item in annual_means]
    means = [item["ndvi"] for item in annual_means]
    x_mean = statistics.mean(years)
    y_mean = statistics.mean(means)
    denominator = sum((year - x_mean) ** 2 for year in years)
    slope = sum((year - x_mean) * (value - y_mean) for year, value in zip(years, means)) / denominator
    if slope >= NDVI_TREND_THRESHOLD_PER_YEAR:
        trend = "improving"
    elif slope <= -NDVI_TREND_THRESHOLD_PER_YEAR:
        trend = "declining"
    else:
        trend = "stable"

    return {
        "latestNdvi": round(annual_means[-1]["ndvi"], 3),
        "trend": trend,
        "trendSlopePerYear": round(slope, 4),
        "startYear": years[0],
        "endYear": years[-1],
        "compositesUsed": sum(item["composites"] for item in annual_means),
        "annualMeans": [
            {**item, "ndvi": round(item["ndvi"], 3)}
            for item in annual_means
        ],
        "message": f"Trend calculated from annual means for {len(annual_means)} quality-screened years.{batch_note}",
        "resolutionNote": resolution_note
    }


def _ndvi_unavailable(message):
    end_year = date.today().year - 1
    return {
        "latestNdvi": None,
        "trend": "unknown",
        "trendSlopePerYear": None,
        "startYear": end_year - NDVI_COMPLETE_YEARS + 1,
        "endYear": end_year,
        "compositesUsed": 0,
        "annualMeans": [],
        "message": message,
        "resolutionNote": "MODIS NDVI is unavailable for this request."
    }


class FieldwiseHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/nasa-farm-data":
            self._get_nasa_farm_data(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/"):
            self._send_json(404, {"error": "API route not found."})
            return
        super().do_GET()

    def _get_nasa_farm_data(self, query):
        try:
            latitude = self._coordinate(query, "latitude", -90, 90)
            longitude = self._coordinate(query, "longitude", -180, 180)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return

        global _last_nasa_request
        with _request_lock:
            now = time.monotonic()
            wait = NASA_REQUEST_INTERVAL_SECONDS - (now - _last_nasa_request)
            if wait > 0:
                self._send_json(429, {"error": "Please wait a few seconds before requesting NASA data again."})
                return
            _last_nasa_request = now

        try:
            climate_query = urlencode({
                "parameters": "PRECTOTCORR,T2M,T2M_MAX",
                "community": "AG",
                "latitude": latitude,
                "longitude": longitude,
                "start": CLIMATE_START_YEAR,
                "end": CLIMATE_END_YEAR,
                "format": "JSON"
            })
            climate = _climate_summary(_fetch_json(f"{NASA_POWER_URL}?{climate_query}"))
        except HTTPError as error:
            self.log_error("NASA POWER returned HTTP %s", error.code)
            self._send_json(502, {"error": "NASA POWER could not provide climate data for this location."})
            return
        except URLError as error:
            self.log_error("NASA POWER request failed: %s", error.reason)
            self._send_json(502, {"error": "Could not connect to NASA POWER. Check the server's internet connection and try again."})
            return
        except TimeoutError:
            self.log_error("NASA POWER request timed out")
            self._send_json(504, {"error": "NASA POWER took too long to respond. Please try again."})
            return
        except (json.JSONDecodeError, ValueError) as error:
            self.log_error("NASA POWER response could not be used: %s", error)
            self._send_json(502, {"error": str(error)})
            return

        try:
            ndvi = _modis_ndvi_summary(latitude, longitude)
        except HTTPError as error:
            self.log_error("NASA MODIS returned HTTP %s", error.code)
            ndvi = _ndvi_unavailable(f"NASA MODIS vegetation service returned HTTP {error.code}.")
        except URLError as error:
            self.log_error("NASA MODIS request failed: %s", error.reason)
            ndvi = _ndvi_unavailable("Could not connect to NASA MODIS. Climate normals loaded, but no NDVI trend is available.")
        except TimeoutError:
            self.log_error("NASA MODIS request timed out")
            ndvi = _ndvi_unavailable("NASA MODIS took too long to respond. Climate normals loaded, but no NDVI trend is available.")
        except (json.JSONDecodeError, ValueError) as error:
            self.log_error("NASA MODIS response could not be used: %s", error)
            ndvi = _ndvi_unavailable(f"NASA MODIS data could not be used: {error}")

        response_data = {**climate, "ndvi": ndvi, "latitude": latitude, "longitude": longitude}
        self._send_json(200, response_data)

    @staticmethod
    def _coordinate(query, name, minimum, maximum):
        values = query.get(name, [])
        if len(values) != 1:
            raise ValueError(f"Provide exactly one {name} value.")
        try:
            value = float(values[0])
        except ValueError:
            raise ValueError(f"{name.capitalize()} must be a number.") from None
        if not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(f"{name.capitalize()} must be between {minimum} and {maximum}.")
        return value

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print("Fieldwise is available at http://localhost:8000/home.html")
    print("NASA coordinates are requested when the user builds rotation ideas.")
    ThreadingHTTPServer(("0.0.0.0", 8000), FieldwiseHandler).serve_forever()
