import { getSelectedPlace, requestClimate, formatNumber } from './common.js';

const el = id => document.getElementById(id);
const place = getSelectedPlace();
el('science-place').textContent = place.name;
let climate = null;
let activeMetric = 'rainfall';

// Reveal only once. We deliberately do NOT hide content again on upward scroll.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reducedMotion && 'IntersectionObserver' in window) {
  const items = [...document.querySelectorAll('.science-reveal')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.06, rootMargin: '0px 0px 24px 0px' });
  // Only enable reveal styling after observer registration.
  items.forEach(node => observer.observe(node));
  document.body.classList.add('science-motion-ready');
  items.filter(node => node.getBoundingClientRect().top < window.innerHeight)
    .forEach(node => node.classList.add('is-visible'));
}

// Soil-cover teaching demo, not a hydrological erosion prediction.
const coverInput = el('cover-slider');
const rainInput = el('rain-slider');
function updateExposure() {
  const c = Number(coverInput.value) / 100;
  const rainfall = Number(rainInput.value);
  const exposed = rainfall * (1-c);
  const covered = rainfall * c;
  el('cover-output').textContent = `${Math.round(c * 100)}%`;
  el('rain-output').textContent = `${rainfall} mm`;
  el('exposed-output').textContent = `${exposed.toFixed(1)} mm`;
  el('covered-output').textContent = `${covered.toFixed(1)} mm`;
  el('exposure-fill').style.width = `${100*(1-c)}%`;
  el('covered-fill').style.width = `${100*c}%`;
}
coverInput.addEventListener('input', updateExposure);
rainInput.addEventListener('input', updateExposure);
updateExposure();

// Hypothetical margin change, always labeled as user-entered assumptions.
function updateProfit() {
  const savings = Number(el('profit-savings').value) || 0;
  const revenue = Number(el('profit-revenue').value) || 0;
  const costs = Number(el('profit-cost').value) || 0;
  const result = savings + revenue - costs;
  const sign = result > 0 ? '+' : result < 0 ? '−' : '';
  el('profit-net').textContent = `${sign}$${Math.abs(result).toLocaleString(undefined,{ maximumFractionDigits:2 })} / acre`;
  el('profit-net').style.color = result < 0 ? '#a15b46' : '#195035';
}
['profit-savings','profit-revenue','profit-cost'].forEach(id => el(id).addEventListener('input', updateProfit));
updateProfit();

const chartTitles = {
  rainfall: ['Growing-season rainfall through time','Total precipitation, April–September each year · mm'],
  heat: ['How often did very hot days occur?','Number of April–September days with daily Tmax ≥ 32°C'],
  dry: ['How long did dry spells last?','Longest consecutive stretch of days with rainfall below 1 mm'],
  monthly: ['When does rain usually fall?','Mean monthly precipitation totals across available complete years · mm']
};

document.querySelectorAll('[data-metric]').forEach(btn => {
  btn.addEventListener('click', () => {
    activeMetric = btn.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach(other => {
      const selected = other === btn;
      other.classList.toggle('is-active', selected);
      other.setAttribute('aria-pressed', String(selected));
    });
    renderChart();
  });
});

function svgEscape(text) { return String(text).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
function valid(n) { return typeof n === 'number' && Number.isFinite(n); }

// Build inline SVG charts. They work without Chart.js, D3, or any external CDN.
function createBarChart(labels, values, unit) {
  const width=900, height=340, left=62, right=20, top=24, bottom=54;
  const pw=width-left-right, ph=height-top-bottom;
  const finite=values.filter(valid);
  if (!finite.length) return '<p class="chart-await">No valid observations available for this chart.</p>';
  const max=Math.max(1, Math.max(...finite)*1.16);
  const step=pw/values.length, barWidth=Math.min(48,step*0.66);
  let content=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(chartTitles[activeMetric][0])}. Values shown in a bar chart.">`;
  for(let i=0;i<=4;i++){
    const val=max*i/4, y=top+ph-(ph*i/4);
    content+=`<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#42644d" stroke-width="1" opacity=".42"/><text x="${left-12}" y="${y+4}" text-anchor="end" fill="#bbd0bb" font-size="12">${val.toFixed(val<10?1:0)}</text>`;
  }
  values.forEach((v,i)=>{
    const x=left+i*step+(step-barWidth)/2;
    const y=valid(v)?top+ph-(ph*v/max):top+ph;
    if(valid(v))content+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0,(top+ph-y)).toFixed(1)}" rx="5" fill="${i===values.length-1?'#e6bc7f':'#9ed2a4'}"><title>${svgEscape(labels[i])}: ${formatNumber(v,1)} ${unit}</title></rect>`;
    content+=`<text x="${(left+i*step+step/2).toFixed(1)}" y="${height-27}" text-anchor="middle" fill="#bbd0bb" font-size="12">${svgEscape(labels[i])}</text>`;
  });
  content+='</svg>';
  return content;
}

function createLineChart(labels, values, unit) {
  const width=900, height=340, left=62, right=20, top=24, bottom=54;
  const pw=width-left-right, ph=height-top-bottom;
  const finite=values.filter(valid);
  if (!finite.length) return '<p class="chart-await">No valid observations available for this chart.</p>';
  const max=Math.max(1,Math.max(...finite)*1.15);
  let content=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(chartTitles[activeMetric][0])}. Values shown in a line chart.">`;
  for(let i=0;i<=4;i++){
    const val=max*i/4,y=top+ph-(ph*i/4);
    content+=`<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#42644d" opacity=".42"/><text x="${left-12}" y="${y+4}" text-anchor="end" fill="#bbd0bb" font-size="12">${val.toFixed(0)}</text>`;
  }
  const points=values.map((v,i)=>!valid(v)?null:{x:left+(i/(Math.max(1,values.length-1)))*pw,y:top+ph-(v/max)*ph,v,label:labels[i]});
  const usable=points.filter(Boolean);
  if (usable.length>1) content+=`<polyline points="${usable.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#b9e6ac" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  points.forEach((p,i)=>{
    if(p)content+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i===points.length-1?'6':'4.5'}" fill="#e4be86" stroke="#103020" stroke-width="2"><title>${svgEscape(p.label)}: ${formatNumber(p.v,1)} ${unit}</title></circle>`;
    content+=`<text x="${(left+(i/(Math.max(1,values.length-1)))*pw).toFixed(1)}" y="${height-27}" text-anchor="middle" fill="#bbd0bb" font-size="12">${svgEscape(labels[i])}</text>`;
  });
  return content+'</svg>';
}

function renderChart(){
  const stage=el('science-chart');
  const [title,caption]=chartTitles[activeMetric];
  el('science-chart-title').textContent=title;
  el('science-chart-caption').textContent=caption;
  if(!climate){stage.innerHTML='<p class="chart-await">Load NASA observations to see a real historical chart.</p>';return;}
  const years=climate.annual || [];
  const labels=years.map(row=>String(row.year));
  let values,unit,method;
  if(activeMetric==='rainfall'){values=years.map(row=>row.rainfall);unit='mm';method='bar';}
  if(activeMetric==='heat'){values=years.map(row=>row.hotDays);unit='days';method='line';}
  if(activeMetric==='dry'){values=years.map(row=>row.drySpell);unit='days';method='bar';}
  if(activeMetric==='monthly'){
    values=climate.monthlyRainfall||[];unit='mm';method='bar';
    labels.splice(0,labels.length,...['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
  }
  stage.innerHTML=method==='bar'?createBarChart(labels,values,unit):createLineChart(labels,values,unit);
  const parsed=values.filter(valid);
  const first=years.at(0)?.year, last=years.at(-1)?.year;
  el('science-chart-insight').textContent=parsed.length?(
    activeMetric==='rainfall'?`Rainfall changes from season to season. Compare each ${first}–${last} total with the same-location historical average, not a universal ideal.`:
    activeMetric==='heat'?`These counts use a stated 32°C screening threshold. Actual crop vulnerability depends on development stage and duration.`:
    activeMetric==='dry'?`Dry spells are consecutive days with less than 1 mm of rain; soil storage and irrigation determine how crops respond.`:
    `Monthly amounts are averages across complete months. This chart shows seasonality, not the exact planting calendar.`
  ):'No complete observations available.';
}

async function loadClimate(){
  const data=await requestClimate(place,el('science-data-status'),el('load-science-data'));
  if(!data) return;
  climate=data;
  const years=data.annual||[];
  const recent=years.at(-1);
  if(!recent){el('science-data-status').textContent='NASA returned no complete growing seasons for this location.';return;}
  const mean=years.reduce((sum,year)=>sum+year.rainfall,0)/years.length;
  el('live-season').textContent=String(recent.year);
  el('live-rain').textContent=`${formatNumber(recent.rainfall,1)} mm`;
  el('live-rainmean').textContent=`${formatNumber(mean,1)} mm`;
  el('live-heat').textContent=`${formatNumber(recent.hotDays)} days`;
  renderChart();
}
el('load-science-data').addEventListener('click',loadClimate);
renderChart();
