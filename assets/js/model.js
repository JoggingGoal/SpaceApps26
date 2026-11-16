/**
 * FieldShift educational scenario engine.
 * All crop coefficients, cover fractions, soil capacities and management ratings
 * are illustrative assumptions, NOT calibrated agronomic recommendations.
 * Real observed weather must be supplied from NASA POWER through app.py.
 */

const corn = {
  label: 'Corn year', crop: 'corn',
  kc: [0, 0, 0, .03, .40, .80, 1.15, 1.05, .65, .15, 0, 0],
  cover: [.25, .25, .24, .24, .35, .78, .96, .97, .89, .42, .34, .28],
  calendar: ['bare','bare','bare','bare','crop','crop','crop','crop','crop','mix','bare','bare']
};
const soy = {
  label: 'Soybeans year', crop: 'soy',
  kc: [0, 0, 0, 0, .35, .70, 1.08, 1.12, .65, .08, 0, 0],
  cover: [.24, .22, .22, .23, .40, .72, .93, .93, .70, .30, .25, .24],
  calendar: ['bare','bare','bare','bare','crop','crop','crop','crop','crop','mix','bare','bare']
};
const cornRye = {
  label: 'Corn → winter rye', crop: 'corn',
  kc: [0, 0, 0, .03, .40, .80, 1.15, 1.05, .65, .19, .22, .22],
  cover: [.25, .25, .24, .24, .35, .78, .96, .97, .89, .50, .66, .74],
  calendar: ['bare','bare','bare','bare','crop','crop','crop','crop','crop','mix','cover','cover']
};
const soyRye = {
  label: 'Rye → soybeans', crop: 'soy',
  kc: [.18, .20, .28, .40, .45, .70, 1.08, 1.12, .65, .08, 0, 0],
  cover: [.74, .75, .79, .84, .60, .73, .93, .93, .70, .30, .25, .24],
  calendar: ['cover','cover','cover','cover','mix','crop','crop','crop','crop','mix','bare','bare']
};
const oatsClover = {
  label: 'Oats + red clover', crop: 'oats',
  kc: [0, 0, .25, .65, .95, 1.08, .90, .48, .38, .27, .10, 0],
  cover: [.35, .35, .50, .66, .86, .95, .93, .79, .70, .65, .55, .46],
  calendar: ['bare','bare','cover','crop','crop','crop','crop','mix','cover','cover','cover','bare']
};
export const ROTATIONS = [
  { id: 'baseline', name: 'Current rotation', subtitle: 'Corn → Soybeans', note: 'Established two-crop system; includes periods with relatively low living cover.', feasibility: 95, crops: ['corn','soy'], profiles: [corn, soy] },
  { id: 'rye', name: 'Winter rye cover', subtitle: 'Corn → Rye cover → Soybeans', note: 'Adds seasonal protection; living rye can also compete for spring soil moisture.', feasibility: 72, crops: ['corn','soy'], profiles: [cornRye, soyRye] },
  { id: 'diverse', name: 'Diversified rotation', subtitle: 'Corn → Soybeans → Oats + clover', note: 'Adds a small grain and legume, but requires different scheduling, management and markets.', feasibility: 52, crops: ['corn','soy','oats'], profiles: [corn, soy, oatsClover] }
];
export const SOIL_WATER_MM = { sandy: 80, loam: 150, clay: 180 };
const clip = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Estimate daily reference ET via Hargreaves-Samani (FAO-56 approximate method).
 * Ra is extraterrestrial radiation in MJ m^-2 day^-1, converted to equivalent mm/day by 0.408.
 * This is a simplified approximation, especially where wind/humidity data are absent.
 */
export function referenceET(tmax, tmin, latitude, dayOfYear) {
  if (!Number.isFinite(tmax) || !Number.isFinite(tmin) || !Number.isFinite(latitude)) return null;
  const phi = clip(latitude, -89.9, 89.9) * Math.PI / 180;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI / 365) * dayOfYear - 1.39);
  const arg = clip(-Math.tan(phi) * Math.tan(delta), -1, 1);
  const ws = Math.acos(arg);
  const ra = (24 * 60 / Math.PI) * 0.0820 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  const averageT = (tmax + tmin) / 2;
  return Math.max(0, 0.0023 * (averageT + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * Math.max(0, ra) * 0.408);
}
export function simpsonDiversity(crops) {
  if (!crops.length) return 0;
  const counts = {};
  crops.forEach(crop => { counts[crop] = (counts[crop] || 0) + 1; });
  return 1 - Object.values(counts).reduce((sum, n) => sum + (n / crops.length) ** 2, 0);
}
export function pickYear(annual, mode = 'typical') {
  if (!Array.isArray(annual) || !annual.length) return null;
  const meanRain = annual.reduce((sum, row) => sum + row.rainfall, 0) / annual.length;
  const compare = {
    typical: (a, b) => Math.abs(a.rainfall - meanRain) - Math.abs(b.rainfall - meanRain),
    dry: (a, b) => a.rainfall - b.rainfall,
    wet: (a, b) => b.rainfall - a.rainfall,
    hot: (a, b) => b.hotDays - a.hotDays
  };
  return [...annual].sort((a, b) => (compare[mode] || compare.typical)(a, b) || a.year - b.year)[0];
}
function dayOfYear(date) {
  const d = new Date(date + 'T12:00:00Z');
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

/** Run one representative crop year against a single observed weather year.
 * Rain infiltration = 85%; root-zone starts at 70% capacity.
 * Irrigation option adds 12mm when storage <35% and an active crop is present.
 * Water deficit = unmet potential ET, NOT realized yield loss.
 */
export function modelCropYear(days, profile, latitude, soilCapacity, irrigated = false) {
  let storage = soilCapacity * 0.70;
  let needed = 0, unmet = 0, exposed = 0, totalRain = 0, appliedIrrigation = 0, valid = 0;
  for (const day of days) {
    if (!Number.isFinite(day.precip) || !Number.isFinite(day.tmax) || !Number.isFinite(day.tmin)) continue;
    valid++;
    const month = Number(day.date.slice(5, 7)) - 1;
    const rainfall = Math.max(0, day.precip);
    const cover = profile.cover[month];
    totalRain += rainfall;
    exposed += rainfall * (1 - cover);
    storage = Math.min(soilCapacity, storage + rainfall * .85);
    if (irrigated && profile.kc[month] > 0.35 && storage < soilCapacity * .35) {
      const irrigation = Math.min(12, soilCapacity - storage);
      storage += irrigation; appliedIrrigation += irrigation;
    }
    const et0 = referenceET(day.tmax, day.tmin, latitude, dayOfYear(day.date));
    const demand = et0 * profile.kc[month];
    const actual = Math.min(demand, storage);
    unmet += demand - actual;
    needed += demand;
    storage -= actual;
  }
  return {
    waterDeficit: needed > 0 ? unmet / needed : 0,
    coverExposure: totalRain > 0 ? exposed / totalRain : 0,
    unmetMm: unmet, demandMm: needed,
    irrigationMm: appliedIrrigation, validDays: valid
  };
}
export function compareRotations(data, year, { soil = 'loam', irrigated = false, weights } = {}) {
  const rows = data.daily.filter(row => Number(row.date.slice(0, 4)) === Number(year));
  if (rows.length < 350) throw new Error('Daily NASA data are incomplete for this historical year.');
  const cap = SOIL_WATER_MM[soil];
  if (!cap) throw new Error('Unknown soil texture.');
  const baseWeights = { water: 40, cover: 30, diversity: 20, feasibility: 10 };
  const selected = weights || baseWeights;
  const weightTotal = Object.values(selected).reduce((a, b) => a + Number(b || 0), 0);
  if (weightTotal <= 0) throw new Error('Give at least one priority a positive weight.');
  return ROTATIONS.map(rotation => {
    const results = rotation.profiles.map(profile => modelCropYear(rows, profile, data.location.lat, cap, irrigated));
    const average = (key) => results.reduce((sum, r) => sum + r[key], 0) / results.length;
    const waterDeficit = average('waterDeficit');
    const exposure = average('coverExposure');
    const diversity = simpsonDiversity(rotation.crops);
    const dimensionScores = {
      water: clip(100 * (1 - waterDeficit), 0, 100),
      cover: clip(100 * (1 - exposure), 0, 100),
      diversity: clip(100 * diversity / (2 / 3), 0, 100),
      feasibility: rotation.feasibility
    };
    const score = Object.entries(selected).reduce((sum, [key, weight]) => sum + Number(weight) * dimensionScores[key], 0) / weightTotal;
    return { ...rotation, score, waterDeficit, exposure, diversity, irrigationMm: average('irrigationMm'), dimensionScores, modeledYear: year };
  }).sort((a, b) => b.score - a.score);
}
