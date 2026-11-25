"use strict";
(() => {
  const root=document.documentElement;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  let revealing=false, dismissed=false, holdTimer, exitTimer, watchdog;
  root.classList.add("intro-active");

  function dismiss(){
    if(dismissed)return;
    dismissed=true;
    clearTimeout(holdTimer);clearTimeout(exitTimer);clearTimeout(watchdog);
    root.classList.remove("intro-active","intro-revealing");
    const page=document.getElementById("landing-page");
    if(page)page.inert=false;
    document.getElementById("intro-screen")?.remove();
    document.dispatchEvent(new Event("intro-dismissed"));
  }
  function reveal(){
    if(revealing||dismissed)return;
    revealing=true;
    const overlay=document.getElementById("intro-screen");
    const landing=document.getElementById("landing-page");
    if(landing)landing.inert=false;
    if(overlay)overlay.inert=true;
    if(!overlay||reduced.matches){dismiss();return;}
    overlay.addEventListener("transitionend",event=>{
      if(event.target===overlay&&event.propertyName==="opacity")dismiss();
    });
    root.classList.add("intro-revealing");
    exitTimer=setTimeout(dismiss,600);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    const landing=document.getElementById("landing-page");
    if(landing&&!revealing&&!dismissed)landing.inert=true;
  },{once:true});
  document.addEventListener("loading-complete",()=>{
    if(revealing||dismissed)return;
    if(reduced.matches)reveal();
    else holdTimer=setTimeout(reveal,200);
  },{once:true});
  reduced.addEventListener?.("change",()=>{if(reduced.matches)reveal();});
  watchdog=setTimeout(reveal,8000);
})();
