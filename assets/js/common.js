// Shared UI and NASA data utilities for every page. No framework required.
export const PLACES = {
  ames: { name: 'Ames, Iowa', lat: 42.0300, lon: -93.6200 },
  mason: { name: 'Mason, Ohio', lat: 39.3601, lon: -84.3099 },
  davis: { name: 'Davis, California', lat: 38.5449, lon: -121.7405 },
  lubbock: { name: 'Lubbock, Texas', lat: 33.5779, lon: -101.8552 }
};
const STORE = 'fieldshift.selectedPlace.v1';
const CLIMATE_KEY = 'fieldshift.climate.v1';
export const formatNumber = (n, digits = 0) => Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
export function getSelectedPlace() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE));
    if (stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lon) && stored.name) return stored;
  } catch { /* Storage may be disabled. */ }
  return { ...PLACES.ames };
}
export function setSelectedPlace(place) {
  const data = { name: String(place.name), lat: Number(place.lat), lon: Number(place.lon) };
  try { localStorage.setItem(STORE, JSON.stringify(data)); localStorage.removeItem(CLIMATE_KEY); } catch { /* Storage may be disabled. */ }
  return data;
}
export function prettyCoordinates(place) {
  return `${Math.abs(place.lat).toFixed(4)}° ${place.lat >= 0 ? 'N' : 'S'}, ${Math.abs(place.lon).toFixed(4)}° ${place.lon >= 0 ? 'E' : 'W'}`;
}
export async function requestClimate(place, statusElement, button) {
  if (button) button.disabled = true;
  if (statusElement) { statusElement.textContent = 'Retrieving NASA POWER observations. The first request may take a little time…'; statusElement.classList.remove('error'); }
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), 60000);
  try {
    const url = `/api/climate?lat=${encodeURIComponent(place.lat)}&lon=${encodeURIComponent(place.lon)}`;
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.annual?.length) throw new Error(data.error || 'No complete historical seasons were available at that location.');
    if (statusElement) statusElement.textContent = `Loaded NASA POWER observations, ${data.period.start.slice(0, 4)}–${data.period.end.slice(0, 4)} (${data.retrieval}${data.warning ? '; cached data' : ''}).`;
    // Cache only in memory by page, avoiding enormous localStorage daily records.
    window.__fieldshiftClimate = data;
    return data;
  } catch (error) {
    if (statusElement) { statusElement.textContent = `Could not load NASA observations: ${error.name === 'AbortError' ? 'request timed out' : error.message}`; statusElement.classList.add('error'); }
    return null;
  } finally {
    clearTimeout(stop);
    if (button) button.disabled = false;
  }
}
export function chartOrMessage(canvasId, placeholderId, config, existing) {
  if (existing) existing.destroy();
  const placeholder = document.getElementById(placeholderId);
  if (!window.Chart) {
    if (placeholder) placeholder.textContent = 'Chart.js could not load. Check browser internet connectivity.';
    return null;
  }
  if (placeholder) placeholder.hidden = true;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new window.Chart(canvas, config);
}
export const chartOptions = (yTitle = '') => ({
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#193b2b', padding: 12 } },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#758b7b' } },
    y: { beginAtZero: true, title: { display: Boolean(yTitle), text: yTitle, color: '#668073' }, grid: { color: '#e8eee8' }, ticks: { color: '#758b7b' } }
  }
});
function mountShell() {
  const pathname = window.location.pathname.toUpperCase();
  const nav = [
    ['Home', '../HOME/home.html', '/HOME/'],
    ['Explore the Land', '../MAP/map.html', '/MAP/'],
    ['The Science Behind the Revolution', '../SCIENTIFIC_INFO/science.html', '/SCIENTIFIC_INFO/'],
    ['Crop Rotation Simulator', '../SIMULATIONS/simulations.html', '/SIMULATIONS/']
  ];
  const header = document.getElementById('site-header');
  if (header) {
    header.innerHTML = `<header class="site-nav"><div class="container nav-inner">
      <a class="brand" href="../HOME/home.html"><span class="brand-icon">✳</span> The Green Revolution</a>
      <nav id="site-menu" class="nav-links" aria-label="Main navigation">${nav.map(([text, href, test]) => `<a href="${href}" class="nav-link ${pathname.includes(test) ? 'active' : ''}">${text}</a>`).join('')}</nav>
      <div class="nav-actions"><a class="btn btn-primary btn-small" href="../SIMULATIONS/simulations.html">Try the simulator ↗</a><button class="mobile-toggle" id="mobile-menu" aria-expanded="false" aria-controls="site-menu">☰ Menu</button></div>
    </div></header>`;
    document.getElementById('mobile-menu')?.addEventListener('click', e => {
      const menu = document.getElementById('site-menu'); menu.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(menu.classList.contains('open')));
    });
  }
  const footer = document.getElementById('site-footer');
  if (footer) footer.innerHTML = `<footer class="site-footer"><div class="container footer-grid"><div><a class="brand" href="../HOME/home.html"><span class="brand-icon">✳</span> The Green Revolution</a><p class="footer-note mt-16">Explore climate information and farm rotation ideas. This educational prototype does not replace local agricultural expertise or soil tests.</p></div><div class="small"><strong>Explore</strong><div class="stack gap-sm mt-16"><a href="../MAP/map.html">Explore the Land</a><a href="../SCIENTIFIC_INFO/science.html">The Science Behind the Revolution</a><a href="../SIMULATIONS/simulations.html">Crop Rotation Simulator</a></div></div><div class="small"><strong>Data</strong><div class="stack gap-sm mt-16"><a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener">NASA POWER ↗</a><a href="https://www.nrcs.usda.gov/" target="_blank" rel="noopener">USDA NRCS ↗</a></div></div></div></footer>`;
}
mountShell();
