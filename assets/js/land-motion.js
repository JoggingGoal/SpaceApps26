/* Scroll motion designed to never hide headings when scrolling back upward. */
(function(){
 const bar=document.getElementById('land-scroll-progress');
 function progress(){if(!bar)return;const range=Math.max(1,document.documentElement.scrollHeight-innerHeight);bar.style.width=(100*scrollY/range).toFixed(2)+'%';}
 addEventListener('scroll',progress,{passive:true});progress();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(reduced||!window.gsap||!window.ScrollTrigger)return;
 const gsap=window.gsap;gsap.registerPlugin(window.ScrollTrigger);
 // The first chapter is visually sticky for a short scroll; the headline is NEVER faded out.
 // This avoids the reverse-scroll blank-heading bug.
 if(matchMedia('(min-width: 800px)').matches){
   gsap.timeline({scrollTrigger:{trigger:'.land-hero',start:'top top',end:'+=360',scrub:true,pin:true,anticipatePin:1,invalidateOnRefresh:true}})
     .fromTo('.land-hero-orbit',{scale:1,rotation:0},{scale:1.75,rotation:11,ease:'none'},0)
     .fromTo('.land-hero-grid',{scale:1},{scale:1.2,ease:'none'},0);
 }
 // Trigger animations exactly once and leave elements visible after that.
 gsap.utils.toArray('[data-reveal]').forEach(el=>{
   gsap.fromTo(el,{y:20,opacity:.65},{y:0,opacity:1,duration:.7,ease:'power2.out',immediateRender:false,scrollTrigger:{trigger:el,start:'top 93%',once:true}});
 });
 gsap.utils.toArray('.land-explain,.land-indicator').forEach((el,i)=>{
   gsap.fromTo(el,{y:18,opacity:.7},{y:0,opacity:1,duration:.55,delay:Math.min(i%4*.08,.24),ease:'power2.out',immediateRender:false,scrollTrigger:{trigger:el,start:'top 96%',once:true}});
 });
})();
