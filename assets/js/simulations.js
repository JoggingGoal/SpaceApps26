import { getSelectedPlace, requestClimate, chartOrMessage, chartOptions, formatNumber } from './common.js';
import { ROTATIONS, compareRotations, pickYear } from './model.js';

const $ = id => document.getElementById(id);
const place = getSelectedPlace();
$('lab-location').textContent = place.name;
let climate = null, scenario = 'typical', deficitChart, coverChart;
const weightTypes = ['water','cover','diversity','feasibility'];

function selectedWeights() {
  return Object.fromEntries(weightTypes.map(k => [k, Number($(`weight-${k}`).value)]));
}
function selectedSettings() {
  return { soil: $('soil-type').value, irrigated: $('irrigation').value === 'irrigated', weights: selectedWeights() };
}
function setStatus(message) { $('lab-status').textContent = message; }
function renderTimeline() {
  const timeline = $('crop-timeline'); timeline.replaceChildren();
  const head = document.createElement('div'); head.className = 'timeline-row';
  head.innerHTML = '<span class="timeline-name">ROTATION YEAR</span>' + ['J','F','M','A','M','J','J','A','S','O','N','D'].map(m => `<span class="month-header">${m}</span>`).join('');
  timeline.append(head);
  ROTATIONS.forEach(rotation => {
    rotation.profiles.forEach(profile => {
      const row = document.createElement('div'); row.className = 'timeline-row';
      const name = document.createElement('span'); name.className = 'timeline-name';
      name.textContent = (rotation.id === 'baseline' ? 'A' : rotation.id === 'rye' ? 'B' : 'C') + ' · ' + profile.label;
      row.append(name);
      profile.calendar.forEach(value => {
        const cell = document.createElement('span'); cell.className = `month-cell ${value}`;
        cell.title = `${profile.label}: ${value} (representative assumption)`;
        row.append(cell);
      });
      timeline.append(row);
    });
  });
}
function makeResultCard(r, index) {
  const box = document.createElement('article'); box.className = `result-card ${index === 0 ? 'best' : ''}`;
  const score = formatNumber(r.score, 1);
  const pct = (n) => `${formatNumber(n, 1)}%`;
  const safeStr = str => String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  box.innerHTML = `<div class="between"><span class="pill ${index === 0 ? '' : 'pill-neutral'}">${index === 0 ? 'TOP UNDER THESE WEIGHTS' : 'STRATEGY ' + (index + 1)}</span><span class="small muted">${index + 1} of 3</span></div>
    <h3 class="mt-16">${safeStr(r.name)}</h3><p>${safeStr(r.subtitle)}</p>
    <div class="divider"></div><div class="score">${score}<span style="font-size:13px;color:#82988a;font-weight:600"> / 100</span></div>
    <div class="small muted">Prototype preference index</div>
    <div class="metrics-mini">
      <div><div class="metric-row"><span>Modeled water demand unmet</span><b>${pct(r.waterDeficit * 100)}</b></div><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, 100-r.waterDeficit*100)}%"></div></div></div>
      <div><div class="metric-row"><span>Rainfall-weighted exposure</span><b>${pct(r.exposure * 100)}</b></div><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, 100-r.exposure*100)}%"></div></div></div>
      <div><div class="metric-row"><span>Crop diversity score</span><b>${pct(r.dimensionScores.diversity)}</b></div><div class="progress-track"><div class="progress-fill" style="width:${r.dimensionScores.diversity}%"></div></div></div>
    </div><div class="divider"></div><p>${safeStr(r.note)}</p>`;
  return box;
}
function renderCharts(results) {
  const labels = results.map(r => r.name);
  deficitChart = chartOrMessage('deficit-chart', 'deficit-placeholder', {
    type: 'bar', data: { labels, datasets: [{ label: 'Estimated unmet demand (%)', data: results.map(r => +(r.waterDeficit * 100).toFixed(2)), backgroundColor: '#cf9d66', borderRadius: 6 }] },
    options: chartOptions('%')
  }, deficitChart);
  coverChart = chartOrMessage('cover-chart', 'cover-placeholder', {
    type: 'bar', data: { labels, datasets: [{ label: 'Estimated cover exposure (%)', data: results.map(r => +(r.exposure * 100).toFixed(2)), backgroundColor: '#609a77', borderRadius: 6 }] },
    options: chartOptions('%')
  }, coverChart);
}
function recompute() {
  if (!climate) return;
  const chosen = pickYear(climate.annual, scenario);
  if (!chosen) { setStatus('No eligible historical growing seasons found.'); return; }
  const meanings = { typical: 'rainfall closest to the observed seasonal mean', dry: 'lowest growing-season rainfall', wet: 'highest growing-season rainfall', hot: 'most days above 32°C' };
  $('year-explainer').textContent = `${chosen.year} selected because it had the ${meanings[scenario]}. NASA observations: ${formatNumber(chosen.rainfall)} mm Apr–Sep rainfall, ${chosen.hotDays} hot days, longest dry spell ${chosen.drySpell} days.`;
  try {
    const results = compareRotations(climate, chosen.year, selectedSettings());
    const cards = $('rotation-cards'); cards.replaceChildren();
    results.forEach((r, i) => cards.append(makeResultCard(r, i)));
    renderCharts(results);
    setStatus(`Calculated educational rotation indicators using NASA POWER daily weather for ${chosen.year}. Results are not validated yield forecasts.`);
  } catch (err) { setStatus('Could not calculate the scenario: ' + err.message); }
}
async function loadAndRun() {
  const data = await requestClimate(place, $('lab-status'), $('run-simulation'));
  if (!data) return;
  climate = data;
  recompute();
}
$('run-simulation').addEventListener('click', () => { if (climate) recompute(); else loadAndRun(); });
document.querySelectorAll('[data-scenario]').forEach(button => {
  button.addEventListener('click', () => {
    scenario = button.dataset.scenario;
    document.querySelectorAll('[data-scenario]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    recompute();
  });
});
[...weightTypes.map(k => $(`weight-${k}`)), $('soil-type'), $('irrigation')].forEach(control => {
  control.addEventListener('input', () => {
    weightTypes.forEach(k => { $(`value-${k}`).textContent = $(`weight-${k}`).value; });
    recompute();
  });
});
renderTimeline();
