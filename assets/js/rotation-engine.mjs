/**
 * The Green Revolution: interpretable crop-rotation screening engine.
 * Pure functions; no browser globals and no hardcoded mock climate outcomes.
 * This is NOT a calibrated crop-yield, regional-suitability, or profit model.
 * Method and assumptions: see ROTATION_MODEL.md.
 */
export const MAX_CASH_CROPS = 8;
const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const median = xs => { const s=[...xs].sort((a,b)=>a-b); return s.length ? (s[Math.floor((s.length-1)/2)] + s[Math.floor(s.length/2)])/2 : null; };
const cmp = (a,b) => String(a).localeCompare(String(b));

// Broad categories are used ONLY when we lack a specifically identified crop profile.
const GROUP_TRAITS = {
 cereal: {water:0.60, drought:0.48, heat:0.50, preferred:['loamy'], label:'cereal/general', season:'varies'},
 legume: {water:0.48, drought:0.57, heat:0.53, preferred:['loamy'], label:'legume/general', season:'varies'},
 root: {water:0.68, drought:0.33, heat:0.42, preferred:['loamy','sandy'], label:'root/general', season:'varies'},
 oilseed: {water:0.58, drought:0.48, heat:0.53, preferred:['loamy'], label:'broadleaf/general', season:'varies'},
 sorghum: {water:0.32, drought:0.82, heat:0.82, preferred:['loamy','sandy'], label:'millet/sorghum/general', season:'warm'},
 forage: {water:0.55, drought:0.55, heat:0.48, preferred:['loamy'], label:'forage/general', season:'varies'},
};
// Explicit generic screening assumptions for well-recognized species. Values are
// qualitative parameters, not calibrated FAO crop coefficients or yield response data.
const SPECIES = [
 [/^(maize|dent maize|flint maize|sweet corn|popcorn)$/i,'Poaceae',.70,.45,.55,'warm'],
 [/^(wheat|durum wheat|emmer wheat|einkorn wheat|spelt wheat|spring wheat|winter wheat)$/i,'Poaceae',.57,.59,.43,'cool'],
 [/^(barley|spring barley|winter barley|hulless barley|pearl barley)$/i,'Poaceae',.50,.60,.42,'cool'],
 [/^(oats|naked oats|rye|triticale)$/i,'Poaceae',.55,.55,.40,'cool'],
 [/^(rice|upland rice|african rice)$/i,'Poaceae',.85,.23,.73,'warm'],
 [/^(sorghum|grain sorghum|sweet sorghum|forage sorghum|sorghum-sudangrass)$/i,'Poaceae',.36,.82,.85,'warm'],
 [/\bmillet\b/i,'Poaceae',.39,.76,.78,'warm'],
 [/^(soybean|edamame)$/i,'Fabaceae',.60,.48,.57,'warm'],
 [/chickpea/i,'Fabaceae',.42,.78,.60,'cool'],
 [/lentil/i,'Fabaceae',.39,.73,.49,'cool'],
 [/^(field pea|yellow pea|faba bean)$/i,'Fabaceae',.50,.59,.37,'cool'],
 [/^(cowpea|black-eyed pea|pigeon pea|mung bean)$/i,'Fabaceae',.40,.78,.78,'warm'],
 [/^(potato)$/i,'Solanaceae',.72,.32,.34,'cool'],
 [/^sweet potato$/i,'Convolvulaceae',.56,.61,.73,'warm'],
 [/^cassava$/i,'Euphorbiaceae',.45,.72,.80,'warm'],
 [/^(tomato|tomato \(.*\)|cherry tomato|beefsteak tomato|eggplant|eggplant \(.*\)|sweet pepper|hot pepper|bell pepper|jalapeño pepper)$/i,'Solanaceae',.74,.35,.64,'warm'],
 [/^(buckwheat|tartary buckwheat)$/i,'Polygonaceae',.47,.59,.37,'cool'],
 [/^(quinoa|grain amaranth|amaranth greens|spinach|beetroot|sugar beet)$/i,'Amaranthaceae',.55,.55,.58,'varies'],
 [/^(sunflower|safflower)$/i,'Asteraceae',.48,.68,.73,'warm'],
 [/^(canola|rapeseed|mustard.*|broccoli|cauliflower|.*cabbage|.*radish|turnip|kale)$/i,'Brassicaceae',.55,.48,.45,'cool'],
 [/^(cucumber.*|zucchini|.*squash|pumpkin.*|watermelon.*|cantaloupe|honeydew)$/i,'Cucurbitaceae',.75,.40,.72,'warm'],
 [/^(onion|garlic|leek|shallot)$/i,'Amaryllidaceae',.57,.43,.50,'cool'],
 [/^(carrot|parsnip|celery|coriander seed|cilantro|fennel|dill seed)$/i,'Apiaceae',.57,.47,.42,'cool'],
 [/^(alfalfa|red clover \(forage\)|white clover \(forage\))$/i,'Fabaceae',.54,.64,.55,'varies'],
 ];
const MIXED_NAMES = /mix|grass-legume pasture|ryegrass-clover/i;
function isPerennial(name) { return /alfalfa|miscanthus|switchgrass|orchardgrass|perennial|tall fescue|timothy|bermudagrass|bluegrass|asparagus|artichoke|rhubarb/i.test(name); }
export function cropProfile(crop) {
 if (!crop || typeof crop.name !== 'string' || !crop.id) throw Error('Invalid selected crop');
 if (crop.group === 'cover') return {...crop, cover:true};
 const base=GROUP_TRAITS[crop.group] ?? GROUP_TRAITS.oilseed;
 let match = SPECIES.find(s=>s[0].test(crop.name));
 let family = match ? match[1] : (crop.group === 'legume' ? 'Fabaceae' : crop.group==='sorghum' ? 'Poaceae' : `Unspecified ${crop.group} family`);
 if (MIXED_NAMES.test(crop.name)) {match=null;family='Mixed crop / unknown family';}
 const specific=Boolean(match);
 return {...crop, cover:false,family, specificity:specific?'named':'broad',
  waterNeed:specific?match[2]:base.water,
  droughtTolerance:specific?match[3]:base.drought,
  heatTolerance:specific?match[4]:base.heat,
  season:specific?match[5]:base.season,
  perennial:isPerennial(crop.name)};
}

/** Extract 90%-complete, actual weather seasons from NASA POWER daily records. */
export function climateSeasons(payload, mode='apr-sep') {
 if (!payload || !Array.isArray(payload.daily)) return [];
 if (!['apr-sep','oct-mar','year-round'].includes(mode)) throw Error('Unknown growing season');
 const grouped=new Map();
 for (const row of payload.daily) {
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')) continue;
  const date=new Date(row.date+'T00:00:00Z');
  if (!Number.isFinite(date.getTime())) continue;
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1;
  const key=mode==='apr-sep' ? (m>=4&&m<=9?y:null) : mode==='oct-mar'?(m>=10?y:m<=3?y-1:null):y;
  if(key===null)continue;
  if(!grouped.has(key))grouped.set(key,[]);
  grouped.get(key).push(row);
 }
 const result=[];
 for(const [year,unsorted] of [...grouped].sort((a,b)=>a[0]-b[0])) {
  const rows=unsorted.sort((a,b)=>cmp(a.date,b.date));
  const start=mode==='apr-sep'?`${year}-04-01`:mode==='oct-mar'?`${year}-10-01`:`${year}-01-01`;
  const end=mode==='apr-sep'?`${year}-09-30`:mode==='oct-mar'?`${year+1}-03-31`:`${year}-12-31`;
  const expected=Math.round((new Date(end+'T00:00:00Z')-new Date(start+'T00:00:00Z'))/86400000)+1;
  const usable=rows.filter(r=>Number.isFinite(r.precip)&&Number.isFinite(r.tmax)&&Number.isFinite(r.tmin));
  if(usable.length<0.90*expected)continue;
  let longest=0,streak=0,lastDate=null;
  for(const r of rows){
   const dt=Date.parse(r.date+'T00:00:00Z');
   if(lastDate!==null&&dt-lastDate!==86400000)streak=0;
   lastDate=dt;
   if(Number.isFinite(r.precip)&&r.precip<1)streak++; else streak=0;
   longest=Math.max(longest,streak);
  }
  result.push({year,period:`${start} to ${end}`,rainfall:+usable.reduce((s,r)=>s+r.precip,0).toFixed(1),
   hotDays:usable.filter(r=>r.tmax>=32).length,drySpell:longest,
   frostDays:usable.filter(r=>r.tmin<0).length,
   gdd:+usable.reduce((s,r)=>s+Math.max(0,(r.tmax+r.tmin)/2-10),0).toFixed(1),
   coverage:+(usable.length/expected).toFixed(3)});
 }
 return result;
}

const WEIGHTS={
 balanced:{weather:.32,soil:.19,diversity:.29,adoption:.20},
 soil:{weather:.16,soil:.25,diversity:.45,adoption:.14},
 water:{weather:.52,soil:.17,diversity:.20,adoption:.11},
 adoption:{weather:.19,soil:.13,diversity:.17,adoption:.51},
};
const SOIL_FIT={
 sandy:{cereal:65,legume:64,root:82,oilseed:65,sorghum:78,forage:70},
 loamy:{cereal:82,legume:80,root:82,oilseed:78,sorghum:80,forage:80},
 clay:{cereal:72,legume:67,root:49,oilseed:65,sorghum:66,forage:71},
 peaty:{cereal:55,legume:58,root:58,oilseed:54,sorghum:50,forage:65}
};
function soilFitness(crop, farm) {
 if(!SOIL_FIT[farm.soil])return 70; // unknown -> explicitly neutral assumption
 let value=SOIL_FIT[farm.soil][crop.group]??65;
 if(crop.name.toLowerCase().includes('potato') && farm.soil==='clay')value-=12;
 if(/^rice$/i.test(crop.name) && farm.soil==='clay')value+=10;
 if(farm.drainage==='poor' && crop.group==='root')value-=12;
 if(farm.drainage==='fast' && crop.waterNeed>.7)value-=8;
 return clamp(value);
}
function individualWeather(crop, farm, scenario, baselines) {
 const shortfall=clamp((baselines.rain-scenario.rainfall)/Math.max(1,baselines.rain),0,1);
 const longDry=clamp((scenario.drySpell-baselines.dry)/Math.max(7,baselines.dry),0,1);
 const extraHeat=clamp((scenario.hotDays-baselines.hot)/Math.max(12,baselines.hot),0,1);
 const dryness=clamp(.7*shortfall+.3*longDry,0,1);
 const irrigationPenalty= farm.water==='limited' ? 14 : farm.water==='unknown' ? 7 : farm.water==='adequate' ? 5 : 0;
 // Relative exposure screening only. Never a predicted yield or actual drought risk.
 const value=86 - irrigationPenalty*crop.waterNeed
   - 42*dryness*(1-crop.droughtTolerance)
   - 29*extraHeat*(1-crop.heatTolerance);
 return clamp(value);
}
export function diversityMetrics(crops) {
 const n=crops.length;if(!n)return {simpson:0,breakRate:0,diversity:0,legume:false};
 const counts=new Map();crops.forEach(c=>counts.set(c.family,(counts.get(c.family)||0)+1));
 const simpson=1-[...counts.values()].reduce((s,v)=>s+(v/n)**2,0);
 const maximum=1-1/n;
 const breaks=n<2?0:crops.filter((c,i)=>c.family!==crops[(i+1)%n].family).length/n;
 return {simpson,breakRate:breaks,diversity:clamp(100*(0.6*(maximum?simpson/maximum:0)+0.4*breaks)),
  legume:crops.some(c=>c.family==='Fabaceae'),familyCount:counts.size};
}
function canonicalCycle(crops) {
 const ids=crops.map(c=>c.id);
 return ids.map((_,i)=>[...ids.slice(i),...ids.slice(0,i)].join('|')).sort()[0];
}
export function rotationCandidates(crops) {
 if(crops.length<2||crops.length>MAX_CASH_CROPS)throw Error(`Select 2–${MAX_CASH_CROPS} cash crops`);
 const answer=[],seen=new Set();
 const traverse=(current,used,target)=>{
  if(current.length===target){const key=canonicalCycle(current);if(!seen.has(key)){
   seen.add(key);answer.push({id:`candidate-${answer.length}`,crops:[...current],kind:`${target}-year sequence`,key});
  }return;}
  crops.forEach(c=>{if(used.has(c.id))return;used.add(c.id);current.push(c);traverse(current,used,target);current.pop();used.delete(c.id);});
 };
 for(let target=2;target<=Math.min(4,crops.length);target++)traverse([],new Set(),target);
 return answer;
}
export function scoreRotation(rotation,farm,seasons) {
 if(!seasons.length)throw Error('Historical weather data required');
 const profiles=rotation.crops.map(c=>cropProfile(c));
 const diversity=diversityMetrics(profiles);
 const soil=mean(profiles.map(c=>soilFitness(c,farm)));
 const adoption=clamp((rotation.id==='existing'?96:86)-9*Math.max(0,profiles.length-2)
   - 9*profiles.filter(c=>c.perennial).length - 4*profiles.filter(c=>c.specificity==='broad').length);
 const stewardship=clamp(0.86*diversity.diversity + (diversity.legume?14:0));
 const weatherReference={rain:median(seasons.map(s=>s.rainfall)),
   hot:median(seasons.map(s=>s.hotDays)),dry:median(seasons.map(s=>s.drySpell))};
 const weights=WEIGHTS[farm.priority]||WEIGHTS.balanced;
 const yearly=seasons.map(s=>{
  const weather=mean(profiles.map(c=>individualWeather(c,farm,s,weatherReference)));
  const score=weights.weather*weather+weights.soil*soil+weights.diversity*stewardship+weights.adoption*adoption;
  return {year:s.year,score:+score.toFixed(1),weather:+weather.toFixed(1),rainfall:s.rainfall,hotDays:s.hotDays,drySpell:s.drySpell};
 });
 const avg=mean(yearly.map(y=>y.score));
 const worst=[...yearly].sort((a,b)=>a.score-b.score).slice(0,Math.max(1,Math.ceil(yearly.length/4)));
 const stressMean=mean(worst.map(y=>y.score));
 const score=Math.round(0.8*avg+0.2*stressMean);
 return {...rotation,profiles,diversity,soil:Math.round(soil),stewardship:Math.round(stewardship),adoption:Math.round(adoption),
  weather:Math.round(mean(yearly.map(y=>y.weather))),score,scoreAverage:+avg.toFixed(1),
  difficultSeasonScore:+stressMean.toFixed(1),years:yearly,knownProfiles:profiles.filter(p=>p.specificity==='named').length,
  profileCount:profiles.length,uncertainty:profiles.some(p=>p.specificity==='broad')?'higher':'moderate',weights};
}
export function recommend({selectedCrops,existingCropIds=[],farm={},climate=[],limit=4}) {
 const unique=[...new Map(selectedCrops.map(c=>[c.id,c])).values()];
 const cash=unique.filter(c=>c.group!=='cover');const cover=unique.filter(c=>c.group==='cover');
 if(cash.length<2)throw Error('Select at least two named cash crops');
 if(cash.length>MAX_CASH_CROPS)throw Error(`Select no more than ${MAX_CASH_CROPS} cash crops`);
 if(!Array.isArray(climate)||climate.length<3)throw Error('At least three verified historical growing seasons are required');
 const baselineCrops=existingCropIds.map(id=>cash.find(c=>c.id===id)).filter(Boolean);
 const baseline=baselineCrops.length ? scoreRotation({id:'existing',crops:baselineCrops,
  kind:'Farmer-reported existing sequence',key:'existing'},farm,climate):null;
 const baselineCycle=baselineCrops.length>1?canonicalCycle(baselineCrops):null;
 const candidates=rotationCandidates(cash)
  .filter(c=>c.key!==baselineCycle)
  .map(c=>scoreRotation(c,farm,climate));
 candidates.sort((a,b)=>b.score-a.score || b.stewardship-a.stewardship || a.crops.length-b.crops.length || cmp(a.key,b.key));
 const chosen=[],sets=new Set();
 // Prefer distinct selected crop sets over permutations with almost identical explanations.
 for(const c of candidates){
  const set=c.crops.map(x=>x.id).sort().join('/');if(sets.has(set))continue;
  sets.add(set);chosen.push(c);if(chosen.length>=limit)break;
 }
 return {alternatives:chosen,baseline,candidateCount:candidates.length,availableCash:cash,coverCrops:cover,
  seasonsUsed:climate.length,warning:'Preference scores are uncalibrated screening indices, not estimates of yield, profitability, carbon sequestration, or an objectively optimal rotation.'};
}
