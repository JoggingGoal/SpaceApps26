import { getSelectedPlace, setSelectedPlace } from "./common.js";
import { climateSeasons, recommend, cropProfile, exploreCrops, MAX_CASH_CROPS } from "./rotation-engine.mjs";

    "use strict";

    const cropOptionGroups = [
      { group: "cereal", label: "Cereals and pseudocereals", names: "Wheat|Durum wheat|Emmer wheat|Einkorn wheat|Spelt wheat|Spring wheat|Winter wheat|Barley|Hulless barley|Spring barley|Winter barley|Oats|Naked oats|Rye|Triticale|Maize|Dent maize|Flint maize|Sweet corn|Popcorn|Rice|Upland rice|Buckwheat|Tartary buckwheat|Quinoa|Kañiwa|Grain amaranth|Teff|Fonio|African rice|Wild rice|Canary seed|Job's tears|Broomcorn|Grain sorghum|Pearl barley".split("|") },
      { group: "legume", label: "Pulses and legumes", names: "Common bean|Pinto bean|Navy bean|Kidney bean|Black bean|Cranberry bean|Lima bean|Runner bean|Tepary bean|Mung bean|Adzuki bean|Cowpea|Black-eyed pea|Pigeon pea|Chickpea|Kabuli chickpea|Desi chickpea|Green lentil|Red lentil|Black lentil|Brown lentil|Field pea|Yellow pea|Faba bean|Soybean|Edamame|White lupin|Blue lupin|Sweet lupin|Chickling vetch|Common vetch|Guar|Lablab bean|Moth bean|Horse gram|Bambara groundnut|Fenugreek|Hyacinth bean|Winged bean|Velvet bean|Rice bean|Jack bean|Peanut".split("|") },
      { group: "root", label: "Roots, tubers, and bulbs", names: "Potato|Sweet potato|Cassava|Yam|Taro|Cocoyam|Arrowroot|Beetroot|Sugar beet|Mangelwurzel|Carrot|Parsnip|Turnip|Rutabaga|Daikon radish|Garden radish|Horseradish|Celeriac|Chicory root|Salsify|Black salsify|Yacon|Jicama|Ginger|Turmeric|Onion|Garlic|Leek|Shallot|Crosne|Lotus root|Oca|Ulluco|Mashua|Chinese yam|Jerusalem artichoke|Taro eddoe|Konjac|Water chestnut|Burdock root".split("|") },
      { group: "oilseed", label: "Oilseeds, fiber, and broadleaf crops", names: "Sunflower|Canola|Rapeseed|Camelina|Safflower|Flax|Linseed|Sesame|White mustard|Brown mustard|Oriental mustard|Crambe|Field pennycress|Hempseed|Cotton|Castor bean|Perilla|Poppy seed|Chia|Pumpkin seed|Watermelon seed|Evening primrose|Kenaf|Jute|Niger seed|Oilseed radish|Tobacco|Sugarcane|Sweet pepper|Hot pepper|Tomato|Tomatillo|Eggplant|Okra|Cucumber|Zucchini|Summer squash|Winter squash|Pumpkin|Bottle gourd|Luffa|Bitter melon|Watermelon|Cantaloupe|Honeydew melon|Tomato (processing)|Bell pepper|Jalapeño pepper".split("|") },
      { group: "sorghum", label: "Drought-tolerant grains and millets", names: "Sorghum|Sweet sorghum|Forage sorghum|Pearl millet|Finger millet|Foxtail millet|Proso millet|Barnyard millet|Little millet|Kodo millet|Browntop millet|Japanese millet|Guinea millet|Teff (drought-tolerant)|Fonio (dryland)|Tef|Job's tears (dryland)|Pearl millet (dual-purpose)|Millet mix|Sorghum-sudangrass".split("|") },
      { group: "cover", label: "Cover crops and green manures", names: "Crimson clover|Red clover (cover)|White clover (cover)|Berseem clover|Arrowleaf clover|Subterranean clover|Sweetclover|Hairy vetch|Common vetch (cover)|Austrian winter pea|Field pea (cover)|Winter rye|Cereal rye (cover)|Annual ryegrass|Forage oats (cover)|Forage barley|Winter wheat (cover)|Buckwheat (cover)|Forage radish|Tillage radish|Fodder turnip|Phacelia|Mustard (cover)|Sunn hemp|Cowpea (cover)|Black oats|Triticale (cover)|Winter camelina|Winter pea|Chickling vetch (cover)|Lacy phacelia|Egyptian clover|Turnip rape|Mung bean (cover)|Rye-vetch mix|Oat-pea mix|Clover-grass mix|Oilseed radish (cover)|Japanese millet (cover)|Forage brassica mix".split("|") },
      { group: "forage", label: "Forage crops and pasture species", names: "Alfalfa|Orchardgrass|Timothy|Tall fescue|Meadow fescue|Perennial ryegrass|Italian ryegrass|Smooth bromegrass|Meadow bromegrass|Reed canarygrass|Cocksfoot|Festulolium|Kura clover|Alsike clover|Birdsfoot trefoil|Sainfoin|Red clover (forage)|White clover (forage)|Chicory (forage)|Plantain (forage)|Switchgrass|Miscanthus|Sudangrass|Forage kale|Forage turnip|Forage rape|Forage beet|Forage pea|Forage soybean|Lablab (forage)|Millet (forage)|Bermudagrass|Bahiagrass|Rhodes grass|Perennial sorghum|Annual clover|Clover-grass pasture|Ryegrass-clover mix|Teff (forage)|Sorghum-sudangrass (forage)|Bluegrass|Creeping red fescue|Tall wheatgrass".split("|") },
      { group: "oilseed", label: "Vegetables and other annual broadleaf crops", names: "Lettuce|Spinach|Swiss chard|Arugula|Endive|Escarole|Collard greens|Kale|Celery|Fennel|Purslane|Amaranth greens|Mustard greens|Pak choi|Bok choy|Chinese cabbage|Green cabbage|Red cabbage|Savoy cabbage|Brussels sprouts|Broccoli|Cauliflower|Kohlrabi|Mizuna|Tatsoi|Watercress|Artichoke|Asparagus|Rhubarb|Tomato (fresh market)|Cherry tomato|Beefsteak tomato|Eggplant (Asian)|Thai eggplant|Poblano pepper|Cayenne pepper|Habanero pepper|Serrano pepper|Anaheim pepper|Cucumber (slicing)|Pickling cucumber|Acorn squash|Butternut squash|Spaghetti squash|Delicata squash|Pumpkin (winter)|Bottle gourd (vegetable)|Bitter gourd|Chayote|Muskmelon|Canary melon|Honeydew|Crenshaw melon|Watermelon (seedless)|Culinary pumpkin|Green zucchini|Yellow summer squash|Tomatillo (green)|Okra (spineless)|Celery leaf|Garden cress|Coriander seed|Dill seed|Basil (annual)|Cilantro|Parsley (annual)|Summer savory|Annual marjoram|Annual flowers for pollinators|Calendula|Nasturtium|Borage".split("|") }
    ];
    const cropTypes = cropOptionGroups.flatMap(({ group, label, names }) =>
      names.map((name, index) => ({ id: `${group}-${label}-${index}`, group, optionGroup: label, name }))
    );

    const form = document.getElementById("farm-form");
    const planList = document.getElementById("plan-list");
    const resultStatus = document.getElementById("result-status");
    const latitude = document.getElementById("latitude");
    const longitude = document.getElementById("longitude");
    const mapPlaceholder = document.getElementById("map-placeholder");
    const mapLink = document.getElementById("map-link");
    const buildButton = document.getElementById("build-button");
    const nasaStatus = document.getElementById("nasa-status");
    const cropPicker = document.getElementById("available-crops");
    const cropSearch = document.getElementById("crop-search");
    let selectedCropIds = new Set();
    let hasGenerated = false;
    let loadedNasaCoordinates = null;
    let nasaRequestInProgress = false;
    let nasaNdvi = null;
    let nasaNdviTrend = "unknown";
    let dailyClimate = null;
    let farmSeasons = [];
    const seasonSelect = document.getElementById("farm-season");
    let selectedCity = null;

    function checkedValues(name) {
      return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    }

    const cropChips = document.getElementById("selected-crop-chips");
    const cropError = document.getElementById("crop-selection-error");
    const currentOne = document.getElementById("existing-crop-1");
    const currentTwo = document.getElementById("existing-crop-2");

    function chosenCrops() { return cropTypes.filter(c => selectedCropIds.has(c.id)); }
    function cashCrops() { return chosenCrops().filter(c => c.group !== "cover"); }
    function updateSelectedCropCount() {
      const cash = cashCrops().length, cover = chosenCrops().length - cash;
      document.getElementById("selected-crop-count").textContent = `${cash} cash crop${cash === 1 ? "" : "s"} chosen${cover ? ` • ${cover} optional cover crop${cover===1?"":"s"}` : ""}. Choose 2–8 cash crops.`;
      cropError.hidden = cash >= 2 && cash <= MAX_CASH_CROPS;
    }
    function updateCurrentCropOptions() {
      const previousOne = currentOne.value, previousTwo = currentTwo.value;
      const crops = cashCrops();
      for (const [select, first, previous] of [[currentOne, "Not specified", previousOne], [currentTwo, "Same as first / unknown", previousTwo]]) {
        select.replaceChildren();
        select.add(new Option(first, ""));
        crops.forEach(c => select.add(new Option(c.name, c.id)));
        select.value = crops.some(c => c.id === previous) ? previous : "";
      }
    }
    function renderSelectedChips() {
      cropChips.replaceChildren();
      chosenCrops().forEach(c => {
        const pill = document.createElement("button"); pill.type = "button"; pill.className = "farm-crop-chip";
        pill.textContent = `${c.name} ×`;
        pill.setAttribute("aria-label", `Remove ${c.name} from selected crops`);
        pill.addEventListener("click", () => { selectedCropIds.delete(c.id); refreshCropSelection(); });
        cropChips.append(pill);
      });
    }
    function renderCropOptions() {
      const query = cropSearch.value.trim().toLocaleLowerCase();
      const matches = cropTypes.filter(c => !query || c.name.toLocaleLowerCase().includes(query)).slice(0, 45);
      cropPicker.replaceChildren();
      matches.forEach(c => {
        const label = makeElement("label", "farm-crop-option");
        const check = document.createElement("input"); check.type = "checkbox"; check.value = c.id;
        check.checked = selectedCropIds.has(c.id);
        check.addEventListener("change", () => {
          if (check.checked && chosenCrops().some(existing=>existing.name.trim().toLocaleLowerCase()===c.name.trim().toLocaleLowerCase())) {
            check.checked = false;
            document.getElementById("selected-crop-count").textContent = `${c.name} is already in your list. Choose distinct crop names.`;
            return;
          }
          if (check.checked && c.group !== "cover" && cashCrops().length >= MAX_CASH_CROPS) {
            check.checked = false;
            document.getElementById("selected-crop-count").textContent = `Choose no more than ${MAX_CASH_CROPS} cash crops to keep comparisons understandable.`;
            return;
          }
          if (check.checked) selectedCropIds.add(c.id); else selectedCropIds.delete(c.id);
          refreshCropSelection();
        });
        const description = makeElement("span", "farm-crop-item-label", c.name);
        const family = makeElement("small", "", c.group === "cover" ? "Cover crop (optional between crops)" : c.optionGroup);
        label.append(check, description, family); cropPicker.append(label);
      });
      if (!matches.length) cropPicker.append(makeElement("p", "hint", "No matches. Try another crop name."));
    }
    function refreshCropSelection() {
      renderCropOptions(); renderSelectedChips(); updateCurrentCropOptions(); updateSelectedCropCount();
      if (hasGenerated) updatePlans();
    }
    function validateCropSelection() {
      const valid = cashCrops().length >= 2 && cashCrops().length <= MAX_CASH_CROPS;
      cropError.hidden = valid;
      if (!valid) {
        hasGenerated = false;
        document.getElementById("farm-decision").hidden = true;
        document.getElementById("farm-actions").hidden = true;
        document.getElementById("farm-expand-choices").hidden = true;
        planList.replaceChildren(makeElement("div", "empty-state", "Select 2–8 named cash crops first. The simulator will not invent crops you did not select."));
        resultStatus.textContent = "Please select 2–8 cash crops you can actually grow.";
      }
      return valid;
    }

    function numberOrNull(id) {
      const raw = document.getElementById(id).value;
      if (raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }

    function collectFarm() {
      return {
        place: document.getElementById("place").value.trim(),
        area: numberOrNull("area"),
        water: document.getElementById("water").value,
        soil: document.getElementById("soil").value,
        ph: numberOrNull("ph"),
        organicMatter: numberOrNull("organic-matter"),
        rainfall: numberOrNull("rainfall"),
        rainTrend: document.getElementById("rain-trend").value,
        heatRisk: document.getElementById("heat-risk").value,
        frostDays: numberOrNull("frost-days"),
        ndvi: nasaNdvi,
        ndviTrend: nasaNdviTrend,
        practices: checkedValues("practice"),
        slope: numberOrNull("slope"),
        erosionRisk: document.getElementById("erosion-risk").value,
        drainage: document.getElementById("drainage").value,
        selectedCrops: cropTypes.filter((crop) => selectedCropIds.has(crop.id)),
        existingCrop1: currentOne.value,
        existingCrop2: currentTwo.value,
        priority: document.getElementById("farm-priority").value,
        incomeChange: numberOrNull("income-change"),
        additionalCost: numberOrNull("additional-cost")
      };
    }

    function makeElement(tag, className, text) {
      const el=document.createElement(tag);if(className)el.className=className;
      if(text!==undefined)el.textContent=text;return el;
    }
    function renderPlan(rotation, index, isBaseline=false, baseline=null, margin=4) {
      const article=makeElement("article","plan"+(isBaseline?" farm-baseline":""));
      article.append(makeElement("div","farm-plan-eyebrow",isBaseline?"Your current rotation · comparison baseline":rotation.kind));
      const top=makeElement("div","plan-top");
      const heading=makeElement("div","");
      heading.append(makeElement("h3","",rotation.crops.map(c=>c.name).join(" → ")),
        makeElement("p","plan-description",isBaseline?"What you told us you currently plant":"A candidate cash-crop cycle; repeat only after checking local calendars"));
      top.append(heading,makeElement("span","score",`${rotation.score}/100`));article.append(top);
      const seasons=makeElement("div","seasons");
      rotation.crops.forEach((c,i)=>{const step=makeElement("div","season");step.append(makeElement("span","",`Year ${i+1}`),makeElement("strong","",c.name));seasons.append(step);});
      article.append(seasons);
      if(!isBaseline&&baseline){
        const diff=rotation.score-baseline.score;
        const note=Math.abs(diff)<=margin
          ? `Close to your current rotation (within ${margin} screening points). This is not a proven improvement.`
          : `${diff>0?"+":""}${diff} screening points versus your current rotation. This is a model preference difference, not a predicted yield change.`;
        article.append(makeElement("p","farm-score-difference",note));
      }
      const insight=makeElement("p","plan-reason",`Botanical families: ${rotation.profiles.map(c=>c.family).join(" → ")}. Family transitions: ${Math.round(rotation.diversity.breakRate*100)}% (including the cycle back to year 1).`);
      article.append(insight);
      const explanation=makeElement("p","farm-plan-explanation",`Historical-weather fit ${rotation.weather}/100 · Soil-texture screening ${rotation.soil}/100 · Family diversity ${rotation.stewardship}/100 · Practicality ${rotation.adoption}/100.`);
      article.append(explanation);
      if (rotation.profiles.some(c=>c.specificity==="broad"))article.append(makeElement("p","farm-caution",`Some selected plants use generic crop-category traits. The number is lower-confidence; do not interpret it as species-specific suitability.`));
      if(rotation.profiles.some(c=>c.perennial))article.append(makeElement("p","farm-caution","This sequence includes a potentially perennial forage/crop. Establishment and termination may take multiple years. Verify the timetable locally."));
      if(rotation.diversity.familyCount===1)article.append(makeElement("p","farm-caution","All crops fall in the same botanical family in this screening model. They may not offer a meaningful break for family-related pests and diseases."));
      article.append(makeElement("p","farm-plan-explanation",`Score range across ${rotation.years.length} historical seasons: ${Math.min(...rotation.years.map(y=>y.score)).toFixed(1)}–${Math.max(...rotation.years.map(y=>y.score)).toFixed(1)}. Difficult-season average: ${rotation.difficultSeasonScore}.`));
      return article;
    }

    function asNode(tag, text, className = "") {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = text;
      return el;
    }
    function addAction(title, detail) {
      const item = asNode("div", "", "farm-action-item");
      item.append(asNode("strong", title), asNode("p", detail));
      document.getElementById("farm-action-list").append(item);
    }
    function renderDecision(result,farm) {
      const alternative=result.alternatives[0] || null,base=result.baseline;
      const box=document.getElementById("farm-decision");
      const actions=document.getElementById("farm-actions");
      box.hidden=false;actions.hidden=false;box.replaceChildren();
      const delta = base&&alternative ? alternative.score-base.score : null;
      const close = delta!==null && Math.abs(delta)<=result.margin;
      const keepExisting=Boolean(base&&(!alternative||alternative.score<=base.score+result.margin));
      const winner=keepExisting?base:alternative;
      if(!winner) {
        box.append(asNode("p","Only one allowed rotation is available; select more cash crops to compare alternatives. No additional crops will be invented."));
        return;
      }
      const sequence=winner.crops.map(c=>c.name).join(" → ");
      const conclusion=base
          ? (!alternative ? "Only your current crop cycle is available from these choices"
             : close ? "No clear scoring advantage over your current rotation"
             : keepExisting ? "Your current sequence scores higher in this screening"
             : "An alternative scores higher under your selected assumptions")
          : "Leading screening option among the crops you selected";
      box.append(asNode("p",conclusion,"eyebrow"),
        asNode("h3",sequence),
        asNode("p",`Screening preference score: ${winner.score}/100 across ${result.seasonsUsed} NASA historical growing seasons. This is NOT a yield, profit, or proven-optimum prediction.`));
      if(keepExisting){
        box.append(asNode("p",alternative
          ? (close ? `Your current sequence and the leading alternative are only ${Math.abs(delta)} screening points apart. Treat that difference as inconclusive and compare costs, disease history and planting calendars before changing crops.`
                   : `The highest tested alternative scored ${alternative.score}/100 compared with ${base.score}/100 for your current sequence. Changing crops does not appear to improve this screening index under these assumptions.`)
          : "The available choices do not produce a distinct alternative to your existing cycle. Add another crop from your own list or investigate the optional research ideas below."));
      }
      if(base && !keepExisting) {
        const delta=winner.score-base.score;
        box.append(asNode("p",`Your entered starting rotation scored ${base.score}/100, compared with ${winner.score}/100 for this candidate (+${delta} screening points). This does not demonstrate higher yields or profit.`));
      }else if(!base){
        box.append(asNode("p","For a stronger comparison, fill in the current crops you actually plant. We will not invent a baseline."));
      }
      box.append(asNode("p",`Why it ranks here: this ${winner.crops.length}-crop sequence contains ${winner.diversity.familyCount} botanical families. Family-break score ${Math.round(winner.diversity.breakRate*100)}%; regional weather-fit screening ${winner.weather}/100; soil-texture screening ${winner.soil}/100. The current priority weights give these criteria different importance.`));
      const weights=winner.weights;
      if(winner.legumeBeforeGrass) box.append(asNode("p",`The sequence places a legume before a grass in ${winner.legumeBeforeGrass} transition(s). This is a modest qualitative nutrient-cycling consideration, not a fertilizer-saving calculation.`));
      box.append(asNode("p",`Weights: regional weather ${Math.round(weights.weather*100)}%, soil texture ${Math.round(weights.soil*100)}%, family diversity/soil stewardship ${Math.round(weights.diversity*100)}%, adoption simplicity ${Math.round(weights.adoption*100)}%. Final score = 80% average across observed seasons + 20% average of the lowest-scoring quarter of seasons.`));
      if(winner.profileCount>winner.knownProfiles)
        box.append(asNode("p",`${winner.profileCount-winner.knownProfiles} crop(s) use broad-category rather than named-crop climate assumptions. That makes the ranking less certain.`,"farm-caution"));
      if(winner.profiles.some(c=>c.perennial))
        box.append(asNode("p","One or more choices may require multi-year perennial management. This prototype does not establish planting and termination dates.","farm-caution"));
      if(winner.diversity.familyCount===1)
        box.append(asNode("p","These crops share a botanical family. Changing species does not guarantee a pest or disease break; consider another family if available.","farm-caution"));
      const actionsList=document.getElementById("farm-action-list");actionsList.replaceChildren();
      addAction(keepExisting?`Evaluate your existing sequence: ${sequence}`:`Investigate this alternative: ${sequence}`,"Check local planting/harvest windows, variety suitability, disease history, equipment and crop-market demand before implementing any change. A stronger screening score is not proof of superior yield or profit.");
      if(winner.diversity.legume)
        addAction("Use the legume phase deliberately","A selected legume may support nitrogen cycling, but the amount depends on species, inoculation, residue removal and field conditions. Do not assume a fixed fertilizer saving.");
      else addAction("Explore a locally suitable legume if possible","None of your selected cash crops is categorized as a legume. Consider adding a locally marketable legume to your allowed list for another comparison, if agronomically feasible.");
      const medRain = farmSeasons.length ? [...farmSeasons.map(x=>x.rainfall)].sort((a,b)=>a-b)[Math.floor((farmSeasons.length-1)/2)] : null;
      if(farm.water==="limited" || (medRain!==null && Math.max(...farmSeasons.map(x=>x.drySpell))>=15))
        addAction("Plan around water-limited periods","Review soil water holding capacity, irrigation limits, and crop-specific seasonal demand. Long dry spells in the historical record warrant checking timing against crop growth stages.");
      if(farm.frostDays!==null && farm.frostDays<120)
        addAction("Verify the short frost-free season","Your entered growing season is relatively short. Check crop maturity requirements, variety selection and planting dates locally; this advisory is not in the ranking formula.");
      if(farm.soil==="unknown" || farm.ph===null)
        addAction("Improve the soil evidence","A soil survey and soil test (texture, pH, organic matter and drainage) could change the crop comparison. Without them, soil-fit scores are generalized assumptions.");
      if(farm.ph!==null && (farm.ph<5.5 || farm.ph>8))
        addAction("Check the measured soil pH","Your entered pH is outside the common range for many crops. Species-specific tolerance varies considerably; consult locally validated recommendations rather than adjusting planting solely from this app. Soil pH is not incorporated into the numeric ranking.");
      if(farm.organicMatter!==null)
        addAction("Track soil organic matter","Compare the soil-test percentage against a local benchmark at the same soil depth over time. More residue, diverse roots and suitable cover practices can support soil function; annual carbon gains are not predicted here.");
      if(farm.erosionRisk==="high" || (farm.slope!==null&&farm.slope>=5))
        addAction("Protect erosion-prone ground","Consider local contouring or erosion control, residue retention and continuous cover as appropriate to the site. Actual soil loss is not estimated here.");
      if(result.coverCrops.length)
        addAction(`Explore optional cover crops: ${result.coverCrops.map(c=>c.name).join(", ")}`, "These were selected by you, not added as cash-crop years. Check whether they fit the fallow window and whether they could compete for scarce water.");
      else if(farm.practices.includes("cover"))addAction("Continue monitoring your soil-cover practice","You reported keeping soil covered already. Check ground cover during erosion-prone weeks and review termination timing, moisture use and pest risks.");
      else addAction("Keep soil covered between cash crops","Where practical, preserve residues and discuss compatible cover crops with a local advisor. A cover crop can also increase water use during its growing period.");
      if(farm.incomeChange!==null&&farm.additionalCost!==null){
        const net=farm.incomeChange-farm.additionalCost;
        addAction("Budget scenario using your numbers",`${net>=0?"+":""}${net.toFixed(2)} per hectare (your estimated added revenue minus added costs). This is not a forecast and does not enter the agronomic ranking.`);
      } else addAction("Estimate the business trade-off","Compare local seed, irrigation, labor, machinery and market revenue for each specific crop. Regional weather records alone cannot predict profit.");
      if(result.alternatives.length<4) addAction("Limited crop combinations",`Only ${result.alternatives.length} distinct crop sets were available from your selection. The optional crop-expansion ideas below require your explicit approval before they can enter a rotation.`);
    }


    function renderCropExpansion(result, farm) {
      const target=document.getElementById('farm-expand-choices');
      const list=document.getElementById('farm-expansion-list');
      if(!target||!list)return;
      target.hidden=false;
      list.replaceChildren();
      if(cashCrops().length>=MAX_CASH_CROPS){
        list.append(asNode('p','You already selected the maximum eight cash crops. Remove one to investigate other choices.','hint'));
        return;
      }
      const ideas=exploreCrops({catalog:cropTypes,selectedCrops:result.availableCash,seasons:farmSeasons,farm});
      for(const idea of ideas){
        const card=asNode('div','','farm-expand-card');
        const copy=asNode('div','','farm-expand-copy');
        copy.append(asNode('strong',idea.crop.name),asNode('p',idea.reason+' This crop has NOT been added or scored.','hint'));
        const add=document.createElement('button'); add.type='button';add.className='small-button';add.textContent='Add to my crop list';
        add.addEventListener('click',()=>{
          if(cashCrops().length>=MAX_CASH_CROPS){
            document.getElementById('selected-crop-count').textContent='Remove a cash crop before adding another.';return;
          }
          selectedCropIds.add(idea.crop.id);
          refreshCropSelection();
          cropSearch.value=idea.crop.name;
          renderCropOptions();
          document.getElementById('crop-selection-section').scrollIntoView({behavior:'smooth',block:'center'});
          document.getElementById('crop-selection-section').focus?.();
        });
        card.append(copy,add);list.append(card);
      }
      if(!ideas.length)list.append(asNode('p','No additional named research suggestions available from the small reference pool. You can search the complete crop list above.','hint'));
    }

    function trendFromSeasons(seasons) {
      if(seasons.length<6)return "unknown";
      const half=Math.floor(seasons.length/2);
      const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
      const a=mean(seasons.slice(0,half).map(x=>x.rainfall));
      const b=mean(seasons.slice(-half).map(x=>x.rainfall));
      return a<=0?"unknown":b/a<.85?"drier":b/a>1.15?"wetter":"stable";
    }
    function seasonLabel() {
      return seasonSelect.value==="apr-sep"?"April–September":seasonSelect.value==="oct-mar"?"October–March":"January–December";
    }
    function showClimate(data) {
      dailyClimate=data;
      farmSeasons=climateSeasons(data,seasonSelect.value);
      const section=document.getElementById("farm-climate-summary");
      const bars=document.getElementById("farm-annual-bars");
      if(farmSeasons.length<3){
        section.replaceChildren(asNode("p",`Not enough complete NASA weather seasons for ${seasonLabel()}. Choose another calendar or location.`,"farm-caution"));
        document.getElementById("farm-weather-chart").hidden=true;
        return;
      }
      const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
      const rain=mean(farmSeasons.map(x=>x.rainfall)),hot=mean(farmSeasons.map(x=>x.hotDays)),dry=mean(farmSeasons.map(x=>x.drySpell));
      document.getElementById("rainfall").value=rain.toFixed(1);
      document.getElementById("rain-trend").value=trendFromSeasons(farmSeasons);
      document.getElementById("heat-risk").value=hot>=30?"high":hot>=10?"medium":"low";
      section.replaceChildren(asNode("p",`NASA POWER daily weather | ${farmSeasons.length} verified ${seasonLabel()} seasons | ${data.period.start.slice(0,4)}–${data.period.end.slice(0,4)}`,"eyebrow"));
      const metrics=asNode("div","","farm-climate-metrics");
      [[`${rain.toFixed(0)} mm`,"Average precipitation"],[`${hot.toFixed(1)} days`,"Days at/above 32°C"],[`${dry.toFixed(1)} days`,"Average longest dry spell"]].forEach(([value,label])=>{
        const m=asNode("div","");m.append(asNode("strong",value),asNode("span",label));metrics.append(m);
      });section.append(metrics);
      section.append(asNode("p","These are regional gridded weather estimates; hot days and dry spells are fixed screening thresholds, not crop-specific damage levels.","hint"));
      const max=Math.max(...farmSeasons.map(x=>x.rainfall),1);
      bars.replaceChildren();farmSeasons.forEach(item=>{
        const col=asNode("div","","farm-bar-col"),bar=asNode("div","","farm-bar");
        bar.style.height=Math.max(3,item.rainfall/max*94)+"px";
        bar.title=`Season ${item.year}: ${item.rainfall} mm, ${item.hotDays} hot days, ${item.drySpell}-day longest dry spell`;
        col.append(bar,asNode("span",String(item.year).slice(-2)));bars.append(col);
      });document.getElementById("farm-weather-chart").hidden=false;
    }
    function resetClimateState() {
      dailyClimate=null;farmSeasons=[];nasaNdvi=null;nasaNdviTrend="unknown";loadedNasaCoordinates=null;
      document.getElementById("farm-weather-chart").hidden=true;
      document.getElementById("farm-decision").hidden=true;
      document.getElementById("farm-actions").hidden=true;
      document.getElementById("farm-expand-choices").hidden=true;
      document.getElementById("farm-climate-summary").replaceChildren(asNode("p","Weather observations will appear after you analyze the location.","hint"));
    }
    function updatePlans() {
      if(!hasGenerated)return;
      if(!validateCropSelection())return;
      if(farmSeasons.length<3){resultStatus.textContent="At least three complete NASA weather seasons are required.";return;}
      const farm=collectFarm();
      try {
        const existing=[farm.existingCrop1, farm.existingCrop2].filter(Boolean);
        const result=recommend({selectedCrops:farm.selectedCrops,existingCropIds:existing,farm,climate:farmSeasons});
        const plans=[...(result.baseline?[result.baseline]:[]),...result.alternatives];
        planList.replaceChildren(...plans.map((p,i)=>renderPlan(p,i,p.id==="existing",result.baseline,result.margin)));
        const candidateLabel=result.alternatives.length===1?"sequence":"sequences";
        resultStatus.textContent=`Screened ${result.candidateCount} distinct candidate cycles from your ${result.availableCash.length} chosen cash crops; showing ${result.alternatives.length} alternative ${candidateLabel} plus ${result.baseline?"your reported existing sequence":"no assumed baseline"}. NASA weather: ${result.seasonsUsed} complete ${seasonLabel()} seasons. Screening scores are NOT verified yields.`;
        document.getElementById("area-note").textContent=farm.area!==null&&farm.area>0?`Farm size: ${farm.area} ha (not used in suitability ranking).`:"Farm size is not used in suitability ranking.";
        renderDecision(result,farm);
        renderCropExpansion(result,farm);
      }catch(e){resultStatus.textContent=e.message;planList.replaceChildren(makeElement("p","farm-caution",e.message));}
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!validateCropSelection()) {document.getElementById("crop-selection-section").scrollIntoView({behavior:"smooth",block:"start"});cropSearch.focus();return;}
      if (!form.reportValidity() || nasaRequestInProgress) return;
      const coordinateKey = `${Number(latitude.value).toFixed(5)},${Number(longitude.value).toFixed(5)}`;
      if (loadedNasaCoordinates !== coordinateKey && !(await loadNasaData())) {
        resultStatus.textContent = "NASA climate data could not be loaded, so rotation ideas were not updated. Check your connection and try again.";
        return;
      }
      if(farmSeasons.length<3){resultStatus.textContent="No sufficient real NASA weather seasons. The simulator will not produce made-up rankings.";return;}
      hasGenerated = true;
      updatePlans();
    });

    form.addEventListener("reset", () => {
      window.setTimeout(() => {
        hasGenerated = false;
        planList.replaceChildren(makeElement("div", "empty-state", "Your rotation options will appear here. Add your farm details and required coordinates, then build your ideas."));
        resultStatus.textContent = "Add a few details, then build your rotation ideas. You can leave optional fields blank.";
        document.getElementById("area-note").textContent = "Farm size is used for context, not the score.";
        document.getElementById("farm-expand-choices").hidden=true;
        selectedCropIds.clear();
        cropSearch.value = "";
        refreshCropSelection();
        resetClimateState();
        nasaStatus.textContent = "NASA climate and vegetation data load automatically when you build rotation ideas. Required coordinates are sent only for that request.";
        document.getElementById("ndvi-status").textContent = "MODIS NDVI trend will be calculated from quality-screened satellite observations when you build rotation ideas.";
        document.getElementById("grid-elevation").textContent = "NASA grid elevation is not loaded.";
        updateMap();
      }, 0);
    });

    form.addEventListener("input", (event)=>{if(event.target===cropSearch||event.target===latitude||event.target===longitude||event.target===document.getElementById("place"))return;updatePlans();});
    form.addEventListener("change", (event)=>{if(event.target===seasonSelect)return;updatePlans();});
    seasonSelect.addEventListener("change",()=>{if(dailyClimate){showClimate(dailyClimate);if(hasGenerated)updatePlans();}});

    cropSearch.addEventListener("input", renderCropOptions);
    currentOne.addEventListener("change", updatePlans);
    currentTwo.addEventListener("change", updatePlans);

    function validCoordinates() {
      const lat = Number(latitude.value);
      const lon = Number(longitude.value);
      return latitude.value !== "" && longitude.value !== "" && Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }

    function updateMap() {
      const valid = validCoordinates();
      mapLink.hidden = !valid;
      const lat = Number(latitude.value), lon = Number(longitude.value);
      const key = valid ? `${lat.toFixed(5)},${lon.toFixed(5)}` : null;
      if (loadedNasaCoordinates && key !== loadedNasaCoordinates) {
        hasGenerated = false; resetClimateState();
        planList.replaceChildren(asNode("div","Location changed. Select Analyze to compare rotations using the new region.","empty-state"));
        nasaStatus.textContent="Coordinates changed. Climate data will be refreshed when you build recommendations.";
      }
      mapPlaceholder.hidden=false;
      const preview = document.getElementById("map-box");
      const oldFrame = preview.querySelector("iframe"); if (oldFrame) oldFrame.remove();
      if (!preview.querySelector(".farm-world-map")) {
        const img = document.createElement("img");img.className="farm-world-map";
        img.src="../assets/maps/world-overview.svg";
        img.alt="World geographic overview";
        preview.prepend(img);
      }
      mapPlaceholder.querySelector("p").textContent = valid
        ? `Selected coordinates: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "Search for a city or enter valid coordinates.";
      if (valid) mapLink.href=`https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=10/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
    }

    async function loadNasaData() {
      if (!validCoordinates() || nasaRequestInProgress) return false;
      nasaRequestInProgress=true;
      buildButton.disabled=true;buildButton.textContent="Retrieving climate data…";
      nasaStatus.textContent="Loading verified daily NASA POWER regional weather. First requests may take a little time…";
      const lat=Number(latitude.value),lon=Number(longitude.value);
      const key=`${lat.toFixed(5)},${lon.toFixed(5)}`;
      const controller=new AbortController();const t=setTimeout(()=>controller.abort(),65000);
      try {
        const res=await fetch(`/api/climate?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,{signal:controller.signal});
        const data=await res.json();
        if (!res.ok || !Array.isArray(data.annual) || !data.annual.length) throw new Error(data.error || "No complete historical seasons were returned.");
        if (!validCoordinates() || `${Number(latitude.value).toFixed(5)},${Number(longitude.value).toFixed(5)}` !== key) {
          nasaStatus.textContent="Coordinates changed while weather was loading; please run analysis again.";return false;
        }
        // Evaluate the user-selected regional calendar from NASA daily rows, not a fixed Apr–Sep total.
        loadedNasaCoordinates=key;
        showClimate(data);
        document.getElementById("grid-elevation").textContent="Daily climate API does not return a field-level elevation measurement. Enter terrain observations manually if known.";
        nasaStatus.textContent=`NASA POWER ${data.period.start.slice(0,4)}–${data.period.end.slice(0,4)} observations retrieved (${data.retrieval || "network"}). ${seasonLabel()} seasonal statistics calculated. ${data.warning || ""}`;
        return true;
      } catch(error) {
        nasaStatus.textContent=`Unable to load NASA observations: ${error.name==="AbortError"?"request timed out":error.message}. No rankings will be generated without verified climate data.`;
        return false;
      } finally {clearTimeout(t);nasaRequestInProgress=false;buildButton.disabled=false;buildButton.textContent="Analyze farm & recommend rotations";}
    }

    latitude.addEventListener("input",()=>{selectedCity=null;updateMap();});
    longitude.addEventListener("input",()=>{selectedCity=null;updateMap();});
    document.getElementById("locate-button").addEventListener("click",()=>{
      const help=document.getElementById("location-help");
      if (!navigator.geolocation) {help.textContent="Browser location is unavailable. Search for a city instead.";return;}
      help.textContent="Requesting location permission…";
      navigator.geolocation.getCurrentPosition(position=>{
        latitude.value=position.coords.latitude.toFixed(5);
        longitude.value=position.coords.longitude.toFixed(5);
        document.getElementById("place").value="My approximate location";
        resetClimateState();updateMap();
        help.textContent="Location set. Coordinates are sent to NASA when you run analysis.";
      },()=>{help.textContent="Location access unavailable. Please choose a city or enter coordinates.";},
      {timeout:10000,maximumAge:300000,enableHighAccuracy:false});
    });

    // Accessible global city autocomplete: same /api/geocode service as Explore the Land.
    (()=>{
      const input=document.getElementById("place"), box=document.getElementById("farm-city-results"), help=document.getElementById("farm-city-help");
      let timer=null, controller=null,seq=0,items=[],active=-1;
      function hide() {box.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");active=-1;}
      function draw(places) {
        items=places.filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon)));
        box.replaceChildren();
        if (!items.length) {hide();help.textContent="No cities found. Try a different spelling or add a country.";return;}
        items.slice(0,8).forEach((city,i)=>{
          const b=document.createElement("button");b.type="button";b.role="option";b.id=`farm-city-${i}`;
          b.setAttribute("aria-selected","false");b.append(asNode("strong",city.name),
            asNode("small",[city.admin1,city.country].filter(Boolean).join(", ")));
          b.addEventListener("click",()=>choose(city));box.append(b);
        });box.hidden=false;input.setAttribute("aria-expanded","true");help.textContent="Choose a city from the list to fill its coordinates.";
      }
      function choose(city){
        const name=[city.name,city.admin1,city.country].filter(Boolean).join(", ");
        input.value=name;latitude.value=Number(city.lat).toFixed(5);longitude.value=Number(city.lon).toFixed(5);
        selectedCity={name,lat:Number(city.lat),lon:Number(city.lon)};
        setSelectedPlace(selectedCity);hide();box.replaceChildren();resetClimateState();updateMap();
        help.textContent=`Selected ${name}. Click Analyze to load its weather history.`;
      }
      async function search(query) {
        controller?.abort();controller=new AbortController();const mine=++seq;
        try {
          const res=await fetch(`/api/geocode?q=${encodeURIComponent(query)}`,{signal:controller.signal});
          const data=await res.json();if(!res.ok)throw new Error(data.error||"City lookup unavailable");
          if(mine!==seq || input.value.trim()!==query)return;
          draw(Array.isArray(data.results)?data.results:[]);
        }catch(err){if(err.name==='AbortError'||mine!==seq)return;hide();help.textContent="City search is unavailable; enter coordinates manually.";}
      }
      input.addEventListener("input",()=>{clearTimeout(timer);controller?.abort();seq++;hide();selectedCity=null;
        const q=input.value.trim();if(q.length<3){help.textContent="Type at least 3 letters.";return;}
        help.textContent="Looking up cities…";timer=setTimeout(()=>search(q),320);
      });
      input.addEventListener("keydown",e=>{
        if(e.key==="Escape"){hide();return;}
        const options=[...box.querySelectorAll('button')];if(!options.length||box.hidden)return;
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){
          e.preventDefault();active=(active+(e.key==="ArrowDown"?1:-1)+options.length)%options.length;
          options.forEach((el,i)=>el.setAttribute("aria-selected",String(i===active)));
          input.setAttribute("aria-activedescendant",options[active].id);
        }else if(e.key==="Enter"){e.preventDefault();options[active>=0?active:0].click();}
      });
      document.addEventListener("pointerdown",e=>{if(e.target!==input&&!box.contains(e.target))hide();});
      const stored=getSelectedPlace();
      if(stored && Number.isFinite(stored.lat) && Number.isFinite(stored.lon)) {
        input.value=stored.name;latitude.value=stored.lat.toFixed(5);longitude.value=stored.lon.toFixed(5);
        selectedCity=stored;help.textContent=`Using saved location: ${stored.name}. Choose a different city any time.`;
      }
    })();

    async function optionalEndpoint(route,statusId,button,callback) {
      if(!validCoordinates()){document.getElementById(statusId).textContent="Select a city before loading extra observations.";return;}
      button.disabled=true;const status=document.getElementById(statusId);
      status.textContent="Retrieving optional NASA observations. This service may be slower…";
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),120000);
      try {
        const res=await fetch(`${route}?lat=${encodeURIComponent(latitude.value)}&lon=${encodeURIComponent(longitude.value)}`,{signal:controller.signal});
        const data=await res.json();if(!res.ok)throw new Error(data.error||"Dataset unavailable");
        callback(data,status);
      }catch(e){status.textContent=`Optional source unavailable: ${e.name==='AbortError'?'request timed out':e.message}. Main rainfall/heat analysis is unaffected.`;}
      finally{clearTimeout(timeout);button.disabled=false;}
    }
    document.getElementById("load-normal").addEventListener("click",function(){
      optionalEndpoint("/api/farm-normals","normal-status",this,(data,status)=>{
        status.textContent=`NASA POWER ${data.period} climate normal: ${data.annualRainfallMm} mm/year, mean temperature ${data.annualTemperatureC}°C. ${data.resolutionNote} Separate period from the 2016–2025 scoring data.`;
      });
    });
    document.getElementById("load-ndvi").addEventListener("click",function(){
      optionalEndpoint("/api/farm-ndvi","ndvi-status",this,(data,status)=>{
        nasaNdvi=Number.isFinite(data.latestNdvi)?data.latestNdvi:null;
        nasaNdviTrend=data.trend||"unknown";
        status.textContent=`${data.message} Latest usable annual mean NDVI: ${nasaNdvi??"unavailable"}. ${data.resolutionNote}`;
        // NDVI is reported for context, not used to infer field soil health.
      });
    });
    refreshCropSelection();updateMap();
