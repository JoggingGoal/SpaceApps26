import test from 'node:test';
import assert from 'node:assert/strict';
import {cropProfile,climateSeasons,diversityMetrics,rotationCandidates,scoreRotation,recommend,exploreCrops} from '../assets/js/rotation-engine.mjs';
const crops=(names,groups)=>names.map((name,i)=>({id:`c${i}`,name,group:groups[i]}));
const maize=crops(['Maize'],['cereal'])[0];
const soybean={id:'c1',name:'Soybean',group:'legume'};
const wheat={id:'c2',name:'Wheat',group:'cereal'};
const potato={id:'c3',name:'Potato',group:'root'};
const sample=[
 {year:2016,rainfall:470,hotDays:8,drySpell:7},
 {year:2017,rainfall:230,hotDays:29,drySpell:25},
 {year:2018,rainfall:510,hotDays:7,drySpell:10},
 {year:2019,rainfall:330,hotDays:19,drySpell:18},
 {year:2020,rainfall:400,hotDays:12,drySpell:12},
 {year:2021,rainfall:480,hotDays:11,drySpell:8}];
const baseFarm={priority:'balanced',soil:'loamy',water:'limited',drainage:'moderate'};
test('taxonomy recognizes buckwheat, and related potatoes/tomatoes',()=>{
 assert.equal(cropProfile({id:'b',name:'Buckwheat',group:'cereal'}).family,'Polygonaceae');
 assert.equal(cropProfile(potato).family,'Solanaceae');
 assert.equal(cropProfile({id:'t',name:'Tomato',group:'oilseed'}).family,'Solanaceae');
 assert.equal(cropProfile(maize).family,'Poaceae');
});
test('rotations require selected cash crops (not cover-only)',()=>{
 const c=[maize,{id:'cover',name:'Winter rye',group:'cover'}];
 assert.throws(()=>recommend({selectedCrops:c,climate:sample,farm:baseFarm}),/at least two/);
});
test('never suggests a cash crop not selected',()=>{
 const chosen=[maize,soybean,wheat,potato,{id:'c4',name:'Winter rye',group:'cover'}];
 const r=recommend({selectedCrops:chosen,climate:sample,farm:baseFarm});
 assert.ok(r.alternatives.length>0);
 const ids=new Set(chosen.filter(c=>c.group!=='cover').map(c=>c.id));
 for(const plan of r.alternatives)for(const crop of plan.crops) assert.ok(ids.has(crop.id));
 for(const plan of r.alternatives)assert.ok(plan.crops.every(c=>c.group!=='cover'));
 assert.equal(r.coverCrops.length,1);
});
test('no fabricated current crop baseline',()=>{
 const chosen=[maize,soybean,wheat];
 const r=recommend({selectedCrops:chosen,climate:sample,farm:baseFarm});
 assert.equal(r.baseline,null);
 const r2=recommend({selectedCrops:chosen,existingCropIds:['c0','c1'],climate:sample,farm:baseFarm});
 assert.deepEqual(r2.baseline.crops.map(c=>c.name),['Maize','Soybean']);
});
test('family diversity recognizes species from same botanical family',()=>{
 assert.equal(diversityMetrics([cropProfile(maize),cropProfile(wheat)]).familyCount,1);
 assert.equal(diversityMetrics([cropProfile(maize),cropProfile(soybean)]).familyCount,2);
 assert.ok(diversityMetrics([cropProfile(maize),cropProfile(soybean)]).diversity>diversityMetrics([cropProfile(maize),cropProfile(wheat)]).diversity);
});
test('weather variability changes yearwise scores and water choice matters',()=>{
 const sequence={id:'x',crops:[maize,soybean]};
 const a=scoreRotation(sequence,{...baseFarm,water:'limited'},sample);
 const b=scoreRotation(sequence,{...baseFarm,water:'abundant'},sample);
 assert.ok(a.years.some(y=>y.score!==a.years[0].score));
 assert.ok(b.score>a.score);
 assert.ok(a.scoreAverage>=a.difficultSeasonScore);
});
test('priority weights change plan scoring',()=>{
 const plan={id:'r',crops:[maize,soybean,wheat]};
 const a=scoreRotation(plan,{...baseFarm,priority:'soil'},sample);
 const b=scoreRotation(plan,{...baseFarm,priority:'adoption'},sample);
 assert.notEqual(a.score,b.score);
 assert.equal(a.weights.diversity,.45);
});
test('no NASA seasons yields no recommendations',()=>{
 assert.throws(()=>recommend({selectedCrops:[maize,soybean],climate:[],farm:baseFarm}),/three verified/);
});
test('candidate cycles are unique up to cyclic rotation',()=>{
 const cs=rotationCandidates([maize,soybean,wheat]);
 assert.equal(cs.length,5); // 3 pairs and 2 directed 3-year cycles
 assert.equal(new Set(cs.map(c=>c.key)).size,cs.length);
});
test('max 8 cash crops enforced',()=>{
 const cs=Array.from({length:9},(_,i)=>({name:`Crop ${i}`,id:`x${i}`,group:'cereal'}));
 assert.throws(()=>recommend({selectedCrops:cs,climate:sample,farm:baseFarm}),/no more than 8/);
});
test('season builder handles missing observations and hemisphere season boundaries',()=>{
 const daily=[];
 for(let y=2016;y<=2020;y++){
  for(let d=new Date(`${y}-01-01T00:00:00Z`);d.getUTCFullYear()===y;d.setUTCDate(d.getUTCDate()+1)){
   const date=d.toISOString().slice(0,10);
   daily.push({date,precip:2,tmax:33,tmin:20});
  }
 }
 const apr=climateSeasons({daily},'apr-sep');
 const oct=climateSeasons({daily},'oct-mar');
 assert.equal(apr.length,5);
 assert.equal(oct.length,4);
 assert.equal(apr[0].hotDays,183);
 assert.equal(oct[0].year,2016);
 assert.ok(Math.abs(apr[0].rainfall-366)<.01);
});
test('seasons discard incomplete years',()=>{
 const daily=[{date:'2020-04-01',precip:5,tmax:30,tmin:20}];
 assert.deepEqual(climateSeasons({daily},'apr-sep'),[]);
});
test('different selected crop lists produce different named sequences',()=>{
 const a=recommend({selectedCrops:[maize,soybean,wheat],climate:sample,farm:baseFarm});
 const b=recommend({selectedCrops:[maize,potato,wheat],climate:sample,farm:baseFarm});
 assert.ok(a.alternatives.some(p=>p.crops.some(c=>c.name==='Soybean')));
 assert.ok(b.alternatives.every(p=>p.crops.every(c=>c.name!=='Soybean')));
});
test('does not relabel the exact reported existing cycle as a new alternative',()=>{
 const r=recommend({selectedCrops:[maize,soybean,wheat],existingCropIds:[maize.id,soybean.id],farm:baseFarm,climate:sample});
 assert.ok(r.alternatives.every(p=>p.crops.map(c=>c.id).sort().join(',')!==[maize.id,soybean.id].sort().join(',')));
});
test('two chosen cash crops already in current sequence produce honest zero alternatives',()=>{
 const r=recommend({selectedCrops:[maize,soybean],existingCropIds:[maize.id,soybean.id],farm:baseFarm,climate:sample});
 assert.equal(r.alternatives.length,0);
 assert.ok(r.baseline);
});
test('known perennial choices are flagged for local calendar verification',()=>{
 const alfalfa=cropProfile({id:'alf',name:'Alfalfa',group:'forage'});
 assert.equal(alfalfa.perennial,true);
});

test('baseline never receives a secret adoption-score bonus',()=>{
 const seq=[maize,soybean];
 const a=scoreRotation({id:'existing',crops:seq},baseFarm,sample);
 const b=scoreRotation({id:'alternative',crops:seq},baseFarm,sample);
 assert.equal(a.adoption,b.adoption);assert.equal(a.score,b.score);
});
test('crop expansion suggestions never alter allowed rotations',()=>{
 const selected=[maize,soybean];const pool=[...selected,
  {id:'more1',name:'Sorghum',group:'sorghum'},
  {id:'more2',name:'Chickpea',group:'legume'},
  {id:'more3',name:'Barley',group:'cereal'},
  {id:'more4',name:'Sunflower',group:'oilseed'}];
 const r=recommend({selectedCrops:selected,farm:baseFarm,climate:sample});
 assert.equal(r.availableCash.length,2);
 const ideas=exploreCrops({catalog:pool,selectedCrops:selected,seasons:sample,farm:baseFarm});
 assert.ok(ideas.length);assert.ok(ideas.every(i=>!selected.includes(i.crop)));
 assert.ok(ideas.every(i=>i.crop.name));
});
test('new crop choices can add distinct alternative sequences',()=>{
 const a=recommend({selectedCrops:[maize,soybean],existingCropIds:[maize.id,soybean.id],farm:baseFarm,climate:sample});
 const b=recommend({selectedCrops:[maize,soybean,wheat],existingCropIds:[maize.id,soybean.id],farm:baseFarm,climate:sample});
 assert.equal(a.alternatives.length,0);assert.ok(b.alternatives.length>0);
});
