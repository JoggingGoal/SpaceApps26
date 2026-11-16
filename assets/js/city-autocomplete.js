/* City autocomplete for Explore the Land.
   Works independently of map.js and avoids full-page form submissions.
   City data: existing /api/geocode endpoint (Open-Meteo / GeoNames).
   Selecting a city only changes location. NASA weather loads separately. */
(() => {
  'use strict';
  const form = document.getElementById('city-form');
  const input = document.getElementById('city-query');
  const list = document.getElementById('city-results');
  const help = document.getElementById('city-help');
  if (!form || !input || !list || !help) return;

  let selectedPlace = null;
  let matches = [];
  let active = -1;
  let timer = null;
  let controller = null;
  let sequence = 0;

  const message = text => { help.textContent = text; };
  const hide = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const clear = () => {
    matches = [];
    list.replaceChildren();
    hide();
  };
  function activate(index) {
    if (!matches.length) return;
    active = (index + matches.length) % matches.length;
    [...list.children].forEach((item, i) => {
      item.classList.toggle('is-highlighted', i === active);
      item.setAttribute('aria-selected', String(i === active));
    });
    const item = list.children[active];
    input.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({block: 'nearest'});
  }
  function choose(place) {
    if (!place) return;
    const name = [place.name, place.admin1, place.country]
      .filter(Boolean).join(', ');
    input.value = name;
    selectedPlace = { ...place, name };
    const panelName = document.getElementById("place-name");
    const panelCoordinates = document.getElementById("place-coordinates");
    if (panelName) panelName.textContent = name;
    if (panelCoordinates) panelCoordinates.textContent = `${Math.abs(place.lat).toFixed(4)}° ${place.lat >= 0 ? "N" : "S"}, ${Math.abs(place.lon).toFixed(4)}° ${place.lon >= 0 ? "E" : "W"}`;
    clearTimeout(timer);
    controller?.abort();
    sequence += 1;
    clear();
    message(`Selected ${name}. Click “Analyze this location” to load its weather history.`);
    document.dispatchEvent(new CustomEvent('greenrevolution:city-selected', {
      detail: {name, lat: Number(place.lat), lon: Number(place.lon)}
    }));
  }
  function render(places) {
    clear();
    matches = places.filter(p => p && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!matches.length) {
      message('No matching cities. Try a different spelling or add a full state/country name.');
      return;
    }
    const fragment = document.createDocumentFragment();
    matches.forEach((place, i) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.role = 'option';
      option.id = `city-option-${i}`;
      option.className = 'land-search-result';
      option.setAttribute('aria-selected', 'false');
      const primary = document.createElement('span');
      primary.className = 'city-primary';
      primary.textContent = place.name;
      const secondary = document.createElement('span');
      secondary.className = 'city-secondary';
      secondary.textContent = [place.admin1, place.country].filter(Boolean).join(', ');
      option.append(primary, secondary);
      option.addEventListener('mousedown', e => e.preventDefault());
      option.addEventListener('click', () => choose(place));
      fragment.append(option);
    });
    list.append(fragment);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    message(`${matches.length} matching locations. Use arrow keys or click to select.`);
  }
  async function fetchCities(query, chooseFirst = false) {
    controller?.abort();
    const thisRequest = ++sequence;
    controller = new AbortController();
    message('Finding cities…');
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: {'Accept': 'application/json'}
      });
      if (!response.ok) throw new Error(`Search service returned ${response.status}`);
      const data = await response.json();
      if (thisRequest !== sequence || input.value.trim() !== query) return;
      render(Array.isArray(data.results) ? data.results : []);
      if (chooseFirst && matches.length) choose(matches[0]);
    } catch (err) {
      if (err.name === 'AbortError' || thisRequest !== sequence) return;
      clear();
      message('City suggestions unavailable. Check that python3 app.py is running and try again.');
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    sequence += 1;
    selectedPlace = null;
    clear();
    const query = input.value.trim();
    if (query.length < 3) {
      message('Start typing at least 3 letters to see matching cities.');
      return;
    }
    timer = setTimeout(() => fetchCities(query), 300);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hide(); return; }
    if (event.key === 'ArrowDown' && matches.length && !list.hidden) {
      event.preventDefault(); activate(active + 1);
    } else if (event.key === 'ArrowUp' && matches.length && !list.hidden) {
      event.preventDefault(); activate(active - 1);
    } else if (event.key === 'Enter' && matches.length && !list.hidden) {
      event.preventDefault(); choose(matches[active < 0 ? 0 : active]);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); // Never reload the website when searching.
    clearTimeout(timer);
    const query = input.value.trim();
    if (selectedPlace && query === [selectedPlace.name, selectedPlace.admin1, selectedPlace.country].filter(Boolean).join(", ")) {
      choose(selectedPlace);
    } else if (matches.length && !list.hidden) {
      choose(matches[active < 0 ? 0 : active]);
    } else if (query.length >= 3) {
      fetchCities(query, true);
    } else {
      message('Type at least 3 letters, then select a location.');
      input.focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!form.contains(event.target)) hide();
  });
})();
