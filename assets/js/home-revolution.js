/** The Green Revolution
 *   Progressive enhancement: working navigation without JavaScript;
 *   no fabricated data; GSAP animations only when loaded and permitted.
 */
(() => {
  'use strict';

  const header = document.querySelector('.site-header');
  const progress = document.querySelector('#scroll-progress');
  const mobileButton = document.querySelector('#mobile-menu-toggle');
  const mobileNav = document.querySelector('#mobile-menu');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function toggleMenu(open) {
    if (!mobileNav || !mobileButton) return;
    mobileNav.hidden = !open;
    mobileButton.setAttribute('aria-expanded', String(open));
    mobileButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  }
  mobileButton?.addEventListener('click', () => toggleMenu(mobileNav.hidden));
  mobileNav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggleMenu(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileNav && !mobileNav.hidden) {
      toggleMenu(false);
      mobileButton?.focus();
    }
  });
  document.addEventListener('click', e => {
    if (mobileNav && !mobileNav.hidden && !e.target.closest('.site-header')) toggleMenu(false);
  });
  window.matchMedia('(min-width: 1024px)').addEventListener?.('change', e => {
    if (e.matches) toggleMenu(false);
  });

  // Decorative page progress, not a scientific data reading.
  let scrollScheduled = false;
  function updateProgress() {
    scrollScheduled = false;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const amount = total > 0 ? 100 * window.scrollY / total : 0;
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, amount))}%`;
    header?.classList.toggle('is-scrolled', window.scrollY > 30);
  }
  window.addEventListener('scroll', () => {
    if (!scrollScheduled) {
      scrollScheduled = true;
      requestAnimationFrame(updateProgress);
    }
  }, { passive: true });
  updateProgress();

  const explanations = {
    climate: {
      title: 'Climate | What is changing?',
      text: 'Historical temperature, rainfall, and dry spells reveal recurring weather challenges. NASA POWER provides regional meteorological observations and modeled estimates, not measurements of every individual field.'
    },
    vegetation: {
      title: 'Vegetation | What does NDVI show?',
      text: 'NDVI describes vegetation greenness from reflected light. It can help reveal seasonal changes, but a low value does not by itself diagnose drought, nutrient deficiency, or soil health. Satellite NDVI integration is a planned extension.'
    },
    soil: {
      title: 'Soil & water | What do we need to know?',
      text: 'Rainfall and estimated crop water use can help screen for water stress. Soil texture and available water capacity depend on mapped soil surveys or farmer measurements; regional satellite moisture is not the same as field-level soil water.'
    },
    rotations: {
      title: 'Rotations | What could change?',
      text: 'Our prototype compares an existing rotation with cover-crop and diversified alternatives. Rankings depend on farmer priorities, simple crop assumptions, and historical weather, not validated yield or carbon-sequestration forecasts.'
    }
  };
  const cards = [...document.querySelectorAll('[data-indicator]')];
  const detailTitle = document.querySelector('#indicator-title');
  const detailText = document.querySelector('#indicator-text');
  const detailEyebrow = document.querySelector('.indicator-detail-eyebrow');
  function selectIndicator(key) {
    const info = explanations[key];
    if (!info) return;
    cards.forEach(card => {
      const selected = card.dataset.indicator === key;
      card.classList.toggle('indicator-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    if (detailTitle) detailTitle.textContent = info.title;
    if (detailText) detailText.textContent = info.text;
    if (detailEyebrow) detailEyebrow.textContent = 'WHAT THE INDICATOR MEANS';
  }
  cards.forEach(card => {
    card.addEventListener('click', () => selectIndicator(card.dataset.indicator));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectIndicator(card.dataset.indicator);
      }
    });
  });

  // On cards, move a small highlight toward the pointer. Content remains clickable.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion.matches) {
    document.querySelectorAll('[data-gsap="destination-card"]').forEach(card => {
      card.addEventListener('pointermove', event => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${((event.clientX - r.left) / r.width) * 100}%`);
        card.style.setProperty('--mouse-y', `${((event.clientY - r.top) / r.height) * 100}%`);
      }, { passive: true });
    });
  }

  // The free WebGL globe is initialized independently in earth-globe.js.
  // GSAP animates the outer stage, so the two renderers do not fight over camera movement.

  // Sticky narrative and camera zoom are driven by native scroll progress, not by GSAP's
  // optional CDN. This ensures the first scroll zooms the actual Three.js Earth.
  const journey = document.getElementById('earth-scroll-journey');
  const hero = document.getElementById('space-hero');
  const fieldOverlay = document.getElementById('earth-to-field');
  const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
  const smooth = (a,b,x) => {
    const t=clamp((x-a)/(b-a));
    return t*t*(3-2*t);
  };
  let journeyScheduled=false;
  function updateEarthJourney(){
    journeyScheduled=false;
    if (!journey || !hero || reduceMotion.matches) return;
    const rect=journey.getBoundingClientRect();
    const scrollSpan=Math.max(1, journey.offsetHeight-window.innerHeight);
    const p=clamp(-rect.top/scrollSpan);
    // p is 0 at the top, 1 as the farmland story arrives.
    hero.style.setProperty('--hero-copy-opacity', (1-smooth(.06,.32,p)).toFixed(3));
    hero.style.setProperty('--hero-copy-y', `${Math.round(-65*smooth(.06,.32,p))}px`);
    hero.style.setProperty('--scroll-cue-opacity', (1-smooth(.02,.15,p)).toFixed(3));
    hero.style.setProperty('--fallback-earth-scale', (1.05+2.8*smooth(.08,.74,p)).toFixed(3));
    const fieldOpacity=smooth(.65,.91,p);
    hero.style.setProperty('--field-opacity', fieldOpacity.toFixed(3));
    fieldOverlay?.classList.toggle('active-field',fieldOpacity>.005);
    const copy=smooth(.78,.97,p);
    hero.style.setProperty('--field-copy-opacity', copy.toFixed(3));
    hero.style.setProperty('--field-copy-y',`${Math.round((1-copy)*36)}px`);
    window.GreenRevolutionEarth?.setProgress(p);
  }
  function requestEarthJourney(){
    if(journeyScheduled) return;
    journeyScheduled=true;
    requestAnimationFrame(updateEarthJourney);
  }
  window.addEventListener('scroll', requestEarthJourney, {passive:true});
  window.addEventListener('resize', requestEarthJourney, {passive:true});
  window.addEventListener('pageshow', requestEarthJourney);
  window.addEventListener('green-earth-ready', requestEarthJourney);
  requestEarthJourney();

  // GSAP remains an enhancement for content reveals only. It must not pin a second copy
  // of the hero or independently scale the 3D canvas.
  if (!window.gsap || !window.ScrollTrigger || reduceMotion.matches) return;
  gsap.registerPlugin(ScrollTrigger);

  // Shared, lightweight reveals on scrolling. No elements are hidden if GSAP fails.
  const revealElements = [
    '#farmland h2',
    '#farmland p',
    '#farmland .grid.grid-cols-2 > div',
    '#introduction h2',
    '#introduction > div > div > p',
    '[data-gsap="manifesto"]',
    '[data-gsap="indicator"]',
    '#destinations h2',
    '[data-gsap="destination-card"]'
  ];
  revealElements.forEach(selector => {
    const nodes = gsap.utils.toArray(selector);
    if (nodes.length) {
      gsap.from(nodes, {
        opacity: 0,
        y: 34,
        duration: 0.8,
        stagger: 0.10,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
        scrollTrigger: { trigger: nodes[0], start: 'top 88%', once: true }
      });
    }
  });
})();
