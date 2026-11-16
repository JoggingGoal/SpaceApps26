/* The Green Revolution | Explore the Land v4
 * Everything on this page remains usable without external map/chart libraries.
 * Source of observations: /api/climate (NASA POWER historical regional weather).
 * City selection event: greenrevolution:city-selected from city-autocomplete.js.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PRESETS = {
    ames: {name:'Ames, Iowa, United States',lat:42.03,lon:-93.62},
    mason: {name:'Mason, Ohio, United States',lat:39.3601,lon:-84.3099},
    davis: {name:'Davis, California, United States',lat:38.5449,lon:-121.7405},
    lubbock: {name:'Lubbock, Texas, United States',lat:33.5779,lon:-101.8552},
  };
  const STORAGE_KEY = 'fieldshift.selectedPlace.v1';
  const START = 2016, END = 2025;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formats = {
    rainfall:{title:'Growing-season rainfall by year',subtitle:'April–September rainfall totals, 2016–2025.',key:'rainfall',unit:'mm',chart:'bar',text:'Rainfall totals do not reveal when rain arrived, how much ran off, or how much water crops could access.',formula:'Seasonal rainfall = sum of daily precipitation'},
    monthly:{title:'When does precipitation usually arrive?',subtitle:'Historical monthly average rainfall across 2016–2025.',key:'monthlyRainfall',unit:'mm',chart:'line',text:'Rainfall timing can be as important as total rainfall. Two equally wet regions may have very different growing seasons.',formula:'Monthly mean = mean of the same calendar month across 10 years'},
    hotDays:{title:'How often does extreme heat occur?',subtitle:'April–September days with maximum air temperature ≥ 32°C.',key:'hotDays',unit:'days',chart:'bar',text:'Heat sensitivity depends on the crop and growth stage. A threshold of 32°C is for comparison, not a universal crop damage point.',formula:'Hot days = count of days with Tmax ≥ 32°C'},
    drySpell:{title:'How long can the rain stop?',subtitle:'Longest run of days below 1 mm rain, April–September.',key:'drySpell',unit:'days',chart:'bar',text:'A dry spell is not the same as crop drought stress. Stored soil water and irrigation can change the impact.',formula:'Longest dry spell = longest run of days with precipitation < 1 mm'},
    gdd:{title:'How much warmth accumulates?',subtitle:'April–September growing degree days (10°C base).',key:'gdd',unit:'°C·days',chart:'line',text:'Growing degree days approximate thermal time, but crop-specific calculations and thresholds differ.',formula:'GDD = Σ max(0, (Tmax + Tmin)/2 − 10°C)'}
  };
  function coords(p){return `${Math.abs(p.lat).toFixed(4)}° ${p.lat>=0?'N':'S'}, ${Math.abs(p.lon).toFixed(4)}° ${p.lon>=0?'E':'W'}`;}
  function number(v, decimals=0){return Number.isFinite(Number(v)) && v!==null && v!==''?Number(v).toLocaleString('en-US',{maximumFractionDigits:decimals}):'—';}
  function avg(values){const a=values.filter(v=>typeof v==='number'&&Number.isFinite(v));return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
  function isPlace(p){return p&&typeof p.name==='string'&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lon))<=180;}
  function storedPlace(){try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY));if(isPlace(p))return {name:p.name,lat:Number(p.lat),lon:Number(p.lon)};}catch{}return {...PRESETS.ames};}
  let place=storedPlace(), observations=null, requestId=0, inflight=null, selectedMetric='rainfall';
  let svg=null, svgView={x:0,y:0,w:1000,h:500};
  const ui = { name:$('place-name'),coordinates:$('place-coordinates'),status:$('map-status'),load:$('load-climate'),chart:$('chart-fallback'),empty:$('analysis-empty'), canvas:$('analysis-chart'), map:$('earth-map'), feedback:$('layer-feedback')};
  if(!ui.name||!ui.coordinates||!ui.status||!ui.load||!ui.map){console.error('Explore the Land: required page elements missing');return;}
  function status(text, error=false){ui.status.textContent=text;ui.status.classList.toggle('error',error);}
  function syncPanel(){
    ui.name.textContent=place.name;
    ui.coordinates.textContent=coords(place);
    const detail=$('detailed-map-link');if(detail)detail.href=`https://www.openstreetmap.org/#map=11/${place.lat.toFixed(4)}/${place.lon.toFixed(4)}`;
    document.querySelectorAll('[data-place]').forEach(b=>{
      const p=PRESETS[b.dataset.place], active=p&&Math.abs(p.lat-place.lat)<.001&&Math.abs(p.lon-place.lon)<.001;
      b.classList.toggle('is-active',Boolean(active));b.setAttribute('aria-pressed',String(Boolean(active)));
    });
  }
  function resetResults(){
    for(const id of ['map-rain','map-heat','map-dry','map-year']) if($(id))$(id).textContent='—';
    for(const id of ['rain-explain','heat-explain','dry-explain']) if($(id))$(id).textContent='Weather observations will appear after loading.';
    $('export-climate').disabled=true;
    showEmpty('Retrieving location-specific weather history…');
  }
  function showEmpty(text){
    ui.empty.hidden=false;ui.empty.textContent=text;
    ui.chart.hidden=true;ui.chart.replaceChildren();
    if(ui.canvas)ui.canvas.hidden=true;
  }
  function savePlace(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(place));localStorage.removeItem('fieldshift.climate.v1');}catch{}}
  function selectPlace(p,{zoom=true,load=true,changeSearch=false}={}){
    if(!isPlace(p))return;
    place={name:p.name.trim(),lat:Number(p.lat),lon:Number(p.lon)};
    savePlace();syncPanel();resetResults();
    observations=null;requestId++;
    inflight?.abort(); inflight=null;
    if(zoom)zoomTo(place.lon,place.lat,2.9);
    updatePin();
    if(changeSearch){const input=$('city-query');if(input)input.value=place.name;}
    ui.load.textContent='Analyze this location ↗';ui.load.disabled=false;
    status(`Selected ${place.name}. ${load?'Loading historical climate data…':'Click Analyze this location to retrieve data.'}`);
    if(load)void fetchWeather();
  }
  // World map is a local SVG. The img in HTML is visible before JavaScript loads.
  async function initWorldMap(){
    try{
      const response=await fetch('../assets/maps/world-overview.svg',{cache:'force-cache'});
      if(!response.ok)throw Error('local map unavailable');
      const text=await response.text();
      const doc=new DOMParser().parseFromString(text,'image/svg+xml');
      const node=doc.documentElement;
      if(node.nodeName.toLowerCase()!=='svg')throw Error('unexpected map format');
      svg=document.importNode(node,true);svg.classList.add('is-interactive');
      ui.map.replaceChildren(svg); // Only replace static map AFTER valid SVG loads.
      updatePin();setView(svgView);
      $('layer-feedback').textContent='Interactive country map ready. City search supports worldwide locations; use +/− to zoom.';
      let pointer=null,origin=null;
      svg.addEventListener('pointerdown',ev=>{
        if(ev.button!==0)return;
        pointer={id:ev.pointerId,x:ev.clientX,y:ev.clientY};
        origin={...svgView};svg.setPointerCapture(ev.pointerId);svg.classList.add('is-dragging');
      });
      svg.addEventListener('pointermove',ev=>{
        if(!pointer||pointer.id!==ev.pointerId)return;
        const rect=svg.getBoundingClientRect();
        const dx=(ev.clientX-pointer.x)/rect.width*origin.w;
        const dy=(ev.clientY-pointer.y)/rect.height*origin.h;
        setView({...origin,x:origin.x-dx,y:origin.y-dy});
      });
      svg.addEventListener('pointerup',ev=>{
        if(!pointer)return;
        const moved=Math.hypot(ev.clientX-pointer.x,ev.clientY-pointer.y);
        pointer=null;svg.classList.remove('is-dragging');
        if(moved<8){const loc=clientToPoint(ev.clientX,ev.clientY);if(loc){
          selectPlace({name:'Selected map coordinates',lon:loc[0]/1000*360-180,lat:90-loc[1]/500*180},{zoom:false,load:true,changeSearch:true});
        }}
      });
      svg.addEventListener('pointercancel',()=>{pointer=null;svg.classList.remove('is-dragging')});
      svg.addEventListener('wheel',ev=>{ev.preventDefault();zoomStep(ev.deltaY<0?1.25:.8);},{passive:false});
    }catch(error){
      // The <img> fallback from the HTML remains visible even in a broken browser.
      $('layer-feedback').textContent='World map available. If map interaction is unavailable, use the city search above.';
      console.warn('Interactive world map unavailable:',error);
    }
  }
  function clientToPoint(cx,cy){
    if(!svg)return null;
    const pt=svg.createSVGPoint();pt.x=cx;pt.y=cy;
    try{const matrix=svg.getScreenCTM();if(matrix){const p=pt.matrixTransform(matrix.inverse());return [p.x,p.y];}}catch{}
    return null;
  }
  function setView(view){
    const w=Math.max(45,Math.min(1000,view.w));const h=w/2;
    svgView={w,h,x:Math.max(0,Math.min(1000-w,view.x)),y:Math.max(0,Math.min(500-h,view.y))};
    if(svg){svg.setAttribute('viewBox',`${svgView.x} ${svgView.y} ${svgView.w} ${svgView.h}`);styleMapAnnotations();}
  }
  function zoomTo(lon,lat,factor){
    const w=Math.max(45,1000/factor),h=w/2;
    const x=(lon+180)/360*1000, y=(90-lat)/180*500;
    setView({x:x-w/2,y:y-h/2,w,h});
  }
  function zoomStep(factor){
    const old=svgView;
    const centerX=old.x+old.w/2,centerY=old.y+old.h/2;
    const w=Math.max(45,Math.min(1000,old.w/factor));
    setView({x:centerX-w/2,y:centerY-w/4,w,h:w/2});
  }
  function styleMapAnnotations(){
    if(!svg)return;
    // Keep labels legible and the marker a consistent visual size while zooming.
    const factor=svgView.w/1000;
    svg.querySelectorAll('.country-label').forEach(label=>{
      label.style.fontSize=`${12*factor}px`;
      label.style.strokeWidth=`${2.5*factor}px`;
    });
    const marker=svg.querySelector('#selected-marker');
    if(marker){
      const circle=marker.querySelector('circle'), label=marker.querySelector('text');
      if(circle){circle.setAttribute('r',String(7*factor));circle.style.strokeWidth=`${2*factor}px`}
      if(label){label.setAttribute('x',String(12*factor));label.setAttribute('y',String(-9*factor));label.style.fontSize=`${12*factor}px`;label.style.strokeWidth=`${2.5*factor}px`;}
    }
  }
  function updatePin(){
    if(!svg)return;
    const marker=svg.querySelector('#selected-marker');if(!marker)return;
    const x=(place.lon+180)/360*1000,y=(90-place.lat)/180*500;
    marker.setAttribute('transform',`translate(${x},${y})`);
    const label=marker.querySelector('text');if(label)label.textContent=place.name.split(',')[0];styleMapAnnotations();
  }
  function drawSVG(labels,values,label,type){
    ui.chart.replaceChildren();ui.chart.hidden=false;ui.empty.hidden=true;
    const NS='http://www.w3.org/2000/svg';const graph=document.createElementNS(NS,'svg');graph.setAttribute('viewBox','0 0 900 315');graph.setAttribute('role','img');graph.setAttribute('aria-label',label+' chart');
    const left=76,right=18,top=25,bottom=54, width=900-left-right,height=315-top-bottom;
    const valid=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
    if(!valid.length){showEmpty('No valid values available for this chart.');return;}
    const ymax=Math.max(1,...valid)*1.15;
    const X=i=>left+(i+.5)/labels.length*width,Y=v=>top+height*(1-v/ymax);
    const add=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;graph.append(e);return e;};
    for(let j=0;j<=4;j++){
      const value=ymax*j/4, yy=Y(value);add('line',{x1:left,x2:900-right,y1:yy,y2:yy,stroke:'#dfe9dc'});
      add('text',{x:left-11,y:yy+4,'text-anchor':'end',fill:'#526f5b','font-size':12},value.toFixed(0));
    }
    if(type==='bar'){
      values.forEach((v,i)=>{if(!Number.isFinite(v))return;
        const w=Math.min(42,width/labels.length*.68);
        const bar=add('rect',{x:X(i)-w/2,y:Y(v),width:w,height:top+height-Y(v),rx:5,fill:'#5d9b70'});
        const tooltip=document.createElementNS(NS,'title');tooltip.textContent=`${labels[i]}: ${number(v,1)} ${label}`;bar.append(tooltip);
      });
    }else{
      let d='';values.forEach((v,i)=>{if(Number.isFinite(v))d+=`${d?' L':'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;});
      add('path',{d,stroke:'#307b50','stroke-width':3,fill:'none','stroke-linecap':'round'});
      values.forEach((v,i)=>{if(Number.isFinite(v)){const dot=add('circle',{cx:X(i),cy:Y(v),r:4,fill:'#307b50'});const tip=document.createElementNS(NS,'title');tip.textContent=`${labels[i]}: ${number(v,1)} ${label}`;dot.append(tip);}});
    }
    labels.forEach((t,i)=>{if(labels.length>16&&i%2)return;add('text',{x:X(i),y:286,'text-anchor':'middle',fill:'#526f5b','font-size':12},t)});
    add('text',{x:450,y:311,'text-anchor':'middle',fill:'#668171','font-size':11},label);
    ui.chart.append(graph);
  }
  function renderMetric(metric){
    if(!formats[metric])return;
    selectedMetric=metric;const m=formats[metric];
    document.querySelectorAll('[data-metric]').forEach(b=>{const on=b.dataset.metric===metric;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on));});
    $('analysis-title').textContent=m.title;$('analysis-subtitle').textContent=m.subtitle;
    $('insight-title').textContent=m.title;$('insight-text').textContent=m.text;$('insight-equation').textContent=m.formula;
    if(!observations?.annual?.length){showEmpty('Select a city to load historical weather data.');return;}
    const annual=observations.annual;
    const labels=metric==='monthly'?MONTHS:annual.map(r=>String(r.year));
    const values=metric==='monthly'?observations.monthlyRainfall:annual.map(r=>r[m.key]);
    drawSVG(labels,values,m.unit,m.chart);
    const latest=annual.at(-1), baseline=avg(values);
    $('analysis-interpretation').textContent=metric==='monthly'?`Monthly precipitation averages for ${place.name}, based on NASA POWER observations.`:`${latest.year}: ${number(latest[m.key],1)} ${m.unit}; ${START}–${END} mean: ${number(baseline,1)} ${m.unit}. Regional observations, not a forecast.`;
  }
  function renderValues(){
    if(!observations?.annual?.length)return;
    const data=observations.annual;
    const last=data.find(r=>r.year===2025)||data.at(-1);
    $('map-rain').textContent=number(last.rainfall);
    $('map-heat').textContent=number(last.hotDays);
    $('map-dry').textContent=number(last.drySpell);
    $('map-year').textContent=number(avg(data.map(r=>r.rainfall)));
    const snap=document.querySelector('.land-small-label');if(snap)snap.innerHTML=`${last.year} GROWING-SEASON SNAPSHOT <span class="land-snapshot-sub">April–September</span>`;
    for(const [key,id,unit] of [['rainfall','rain-explain','mm'],['hotDays','heat-explain','days'],['drySpell','dry-explain','days']]){
      const baseline=avg(data.map(r=>r[key]));const difference=last[key]-baseline;
      const phrase=Math.abs(difference)<.05?'similar to':difference>0?'above':'below';
      $(id).textContent=`${last.year}: ${number(last[key],1)} ${unit}, ${phrase} the ${START}–${END} average of ${number(baseline,1)} ${unit}.`;
    }
    $('export-climate').disabled=false;
    renderMetric(selectedMetric);
  }
  async function fetchWeather(){
    const seq=++requestId;inflight?.abort();inflight=new AbortController();
    const point={...place};ui.load.disabled=true;ui.load.textContent='Loading weather…';
    status(`Retrieving NASA POWER weather for ${point.name}. This may take a little time…`);
    showEmpty('Loading historical climate observations…');
    try{
      const response=await fetch(`/api/climate?lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lon)}`,{signal:inflight.signal});
      let payload;
      try{payload=await response.json();}catch{throw Error(`Server returned HTTP ${response.status} instead of weather data.`)}
      if(!response.ok)throw Error(payload?.error||`Climate service HTTP ${response.status}`);
      if(!Array.isArray(payload.annual)||!payload.annual.length)throw Error('No complete growing seasons available for these coordinates.');
      if(seq!==requestId)return;
      observations=payload;renderValues();
      status(`Loaded ${payload.annual.length} growing seasons for ${point.name} from NASA POWER (${payload.retrieval||'available'}).${payload.warning?' Previously cached observations used.':''}`);
      ui.load.textContent='Refresh weather analysis ↗';
    }catch(error){
      if(seq!==requestId||error.name==='AbortError')return;
      status(`Could not load NASA POWER data: ${error.message}. You can retry using Analyze this location.`,true);
      showEmpty('Weather data is unavailable right now. Choose another city or try again.');
      ui.load.textContent='Retry weather analysis ↗';
    }finally{if(seq===requestId){ui.load.disabled=false;inflight=null;}}
  }
  function csv(){if(!observations?.annual?.length)return;
    const rows=['year,rainfall_mm,hot_days_32C,longest_dry_spell_days,growing_degree_days_10C',...observations.annual.map(r=>[r.year,r.rainfall,r.hotDays,r.drySpell,r.gdd].join(','))];
    const blob=new Blob([rows.join('\n')+'\n'],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`green-revolution-${place.lat.toFixed(2)}-${place.lon.toFixed(2)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const soil={unknown:['Soil type not yet known','Use local surveys or a field sample; remote weather data cannot determine soil texture.'],sandy:['Sandy soil','Often drains readily and may hold less plant-available water; local structure and organic matter still matter.'],loam:['Loam soil','A mixture of sand, silt, and clay often balances drainage and water storage.'],clay:['Clay-rich soil','May retain considerable water, although compaction and drainage can restrict roots.'],silt:['Silt-rich soil','Can retain moisture but may crust or erode when exposed.']};
  function initSoil(){const s=$('soil-texture');if(!s)return;
    try{s.value=localStorage.getItem('green-revolution.soil-texture')||'unknown'}catch{}
    const update=()=>{const info=soil[s.value]||soil.unknown;$('soil-character').textContent=info[0];$('soil-explanation').textContent=info[1];try{localStorage.setItem('green-revolution.soil-texture',s.value)}catch{}};
    s.addEventListener('change',update);update();
  }
  function init(){
    // Wire controls BEFORE any asynchronous map or climate requests.
    document.addEventListener('greenrevolution:city-selected',event=>selectPlace(event.detail,{zoom:true,load:true}));
    document.querySelectorAll('[data-place]').forEach(b=>b.addEventListener('click',()=>{const p=PRESETS[b.dataset.place];if(p)selectPlace(p,{zoom:true,load:true,changeSearch:true})}));
    ui.load.addEventListener('click',()=>void fetchWeather());
    $('export-climate').addEventListener('click',csv);
    document.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>renderMetric(b.dataset.metric)));
    $('reset-world').addEventListener('click',()=>setView({x:0,y:0,w:1000,h:500}));
    $('map-zoom-in').addEventListener('click',()=>zoomStep(1.5));
    $('map-zoom-out').addEventListener('click',()=>zoomStep(1/1.5));
    syncPanel();initSoil();void initWorldMap();renderMetric('rainfall');
    void fetchWeather();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
