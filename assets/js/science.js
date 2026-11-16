import { getSelectedPlace, requestClimate, formatNumber, chartOrMessage, chartOptions } from './common.js';

const $ = (id) => document.getElementById(id);
const location = getSelectedPlace();
$('science-location').textContent = location.name;
let climate, monthlyChart, heatChart;

function openTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(panel => panel.hidden = panel.id !== tab);
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  openTab(button.dataset.tab);
  window.history.replaceState({}, '', `#${button.dataset.tab}`);
}));
const initialTab = window.location.hash.slice(1);
if (['climate', 'vegetation', 'soil', 'risk', 'methods'].includes(initialTab)) openTab(initialTab);

async function loadData() {
  const data = await requestClimate(location, $('science-status'), $('science-load'));
  if (!data) return;
  climate = data;
  const recent = data.annual.at(-1);
  const mean = data.annual.reduce((sum, x) => sum + x.rainfall, 0) / data.annual.length;
  $('s-rain').textContent = formatNumber(recent.rainfall);
  $('s-normal').textContent = formatNumber(mean);
  $('s-hot').textContent = formatNumber(recent.hotDays);
  $('s-dry').textContent = formatNumber(recent.drySpell);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  monthlyChart = chartOrMessage('monthly-chart', 'monthly-placeholder', {
    type: 'bar', data: { labels: months, datasets: [{ label: 'Mean monthly precipitation', data: data.monthlyRainfall, backgroundColor: '#6b9f7a', borderRadius: 5 }] },
    options: chartOptions('mm')
  }, monthlyChart);
  heatChart = chartOrMessage('heat-chart', 'heat-placeholder', {
    type: 'line', data: { labels: data.annual.map(d => d.year), datasets: [{ label: 'Hot days', data: data.annual.map(d => d.hotDays), borderColor: '#cd9362', backgroundColor: 'rgba(205,147,98,.10)', borderWidth: 3, pointRadius: 4, tension: .2, fill: true }] },
    options: chartOptions('days')
  }, heatChart);
  renderRisks(data);
}
$('science-load').addEventListener('click', loadData);
$('risk-load').addEventListener('click', loadData);

function renderRisks(data) {
  const years = data.annual;
  const minRain = years.reduce((a, b) => a.rainfall < b.rainfall ? a : b);
  const maxRain = years.reduce((a, b) => a.rainfall > b.rainfall ? a : b);
  const maxDry = years.reduce((a, b) => a.drySpell > b.drySpell ? a : b);
  const maxHot = years.reduce((a, b) => a.hotDays > b.hotDays ? a : b);
  $('risk-cards').replaceChildren();
  const cards = [
    ['Dry-spell exposure', `Longest Apr–Sep dry spell in this period: ${maxDry.drySpell} days (${maxDry.year}). This is an exposure indicator, not measured crop injury.`],
    ['Heat exposure', `Largest count of days with Tmax ≥32°C: ${maxHot.hotDays} (${maxHot.year}). Crop damage depends on growth stage and local conditions.`],
    ['Rainfall variability', `Observed growing-season rainfall ranged from ${formatNumber(minRain.rainfall)} mm (${minRain.year}) to ${formatNumber(maxRain.rainfall)} mm (${maxRain.year}).`]
  ];
  cards.forEach(([title, detail]) => {
    const card = document.createElement('article'); card.className = 'risk-card';
    const dot = document.createElement('span'); dot.className = 'risk-dot amber';
    const h = document.createElement('h4'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = detail;
    card.append(dot, h, p); $('risk-cards').append(card);
  });
  $('risk-load').hidden = true;
}
