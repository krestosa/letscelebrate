"use strict";
(() => {
  const root = document.documentElement;
  // Development only: skip by default, ?intro=1 restores the complete sequence.
  if (new URLSearchParams(location.search).get("intro") !== "1") {
    root.setAttribute("data-dev-skip-intro", "");
    return;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let phase = "counter";
  let watchdog, cancelTransition = () => {};
  let sectionsObserver;
  root.classList.add("intro-active");

  const token = (name, fallback) => {
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    const n = parseFloat(value);
    return Number.isFinite(n) ? n * (value.endsWith("ms") ? 1 : value.endsWith("s") ? 1000 : 1) : fallback;
  };

  function afterMotion(element, property, duration, next, animation = false) {
    const endEvent = animation ? "animationend" : "transitionend";
    const cancelEvent = animation ? "animationcancel" : "transitioncancel";
    cancelTransition();
    let timer, done = false;
    function clean() {
      clearTimeout(timer);
      element.removeEventListener(endEvent, ended);
      element.removeEventListener(cancelEvent, ended);
    }
    function complete() {
      if (done) return;
      done = true;
      clean();
      cancelTransition = () => {};
      next();
    }
    function ended(event) {
      if (event.target === element && (animation ? event.animationName : event.propertyName) === property) complete();
    }
    element.addEventListener(endEvent, ended);
    element.addEventListener(cancelEvent, ended);
    timer = setTimeout(complete, duration + 120);
    cancelTransition = () => { done = true; clean(); };
  }

  function animateSections(page) {
    if (!page || reduced.matches || !("IntersectionObserver" in window)) return;
    sectionsObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("section-motion-pending");
        entry.target.classList.add("section-motion-enter");
        sectionsObserver.unobserve(entry.target);
      }
    }, { threshold: 0, rootMargin: "0px 0px -4% 0px" });
    for (const section of page.querySelectorAll(".proposal, .legal")) {
      if (section.getBoundingClientRect().top < innerHeight) continue;
      section.classList.add("section-motion-pending");
      sectionsObserver.observe(section);
      section.addEventListener("focusin", () => {
        section.classList.remove("section-motion-pending", "section-motion-enter");
        sectionsObserver?.unobserve(section);
      }, { once: true });
    }
  }

  function dismiss() {
    if (phase === "done") return;
    phase = "done";
    clearTimeout(watchdog);
    cancelTransition();
    const page = document.getElementById("landing-page");
    if (page) page.inert = false;
    root.classList.remove("intro-active", "intro-signature", "intro-revealing", "loading-spinning");
    document.getElementById("intro-screen")?.remove();
    document.dispatchEvent(new Event("intro-dismissed"));
  }

  function reveal() {
    if (phase === "reveal" || phase === "done") return;
    phase = "reveal";
    clearTimeout(watchdog);
    cancelTransition();
    const overlay = document.getElementById("intro-screen");
    const page = document.getElementById("landing-page");
    if (page) {
      page.inert = false;
      animateSections(page);
    }
    root.classList.add("landing-enter");
    if (overlay) overlay.inert = true;
    if (!overlay || reduced.matches) { dismiss(); return; }
    afterMotion(overlay, "opacity", token("--intro-exit", 420), dismiss);
    root.classList.add("intro-revealing");
    document.dispatchEvent(new Event("intro-revealing"));
  }

  function holdVisible(nextPhase, duration, next) {
    phase = nextPhase;
    let remaining = duration;
    let started = null, timer;
    function pause() {
      clearTimeout(timer);
      if (started !== null) {
        remaining = Math.max(0, remaining - (performance.now() - started));
        started = null;
      }
    }
    function cleanup() {
      pause();
      document.removeEventListener("visibilitychange", sync);
    }
    function sync() {
      pause();
      if (document.hidden || phase !== nextPhase) return;
      if (remaining <= 0) {
        cleanup();
        cancelTransition = () => {};
        next();
        return;
      }
      started = performance.now();
      timer = setTimeout(sync, Math.ceil(remaining));
    }
    cancelTransition = cleanup;
    document.addEventListener("visibilitychange", sync);
    sync();
  }

  function writeSignature() {
    if(phase!=="year-hold")return;
    const signature=document.getElementById("intro-signature");
    if(reduced.matches||!signature){reveal();return;}
    phase="signature";
    const writeDuration=token("--signature-write-first",1450)+token("--signature-write-second",1000);
    let done=false, timer;
    function cleanup(){
      clearTimeout(timer);
      document.removeEventListener("signature-written",completed);
    }
    function completed(){
      if(done||phase!=="signature")return;
      done=true;cleanup();cancelTransition=()=>{};
      const art=document.getElementById("signature-art");
      if(art?.complete&&art.naturalWidth)signature.classList.add("signature-done");
      holdVisible("reading", token("--signature-reading-time", 1000), reveal);
    }
    cancelTransition();
    cancelTransition=()=>{done=true;cleanup();};
    document.addEventListener("signature-written",completed,{once:true});
    timer=setTimeout(completed,writeDuration+350);
    root.classList.add("intro-signature");
    document.dispatchEvent(new Event("intro-signature-start"));
  }

  function counterComplete() {
    if (phase !== "counter") return;
    clearTimeout(watchdog);
    if (reduced.matches) { reveal(); return; }
    holdVisible("year-hold", token("--year-reading-time", 450), writeSignature);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const landing = document.getElementById("landing-page");
    if (landing && phase !== "done" && phase !== "reveal") landing.inert = true;
  }, { once: true });
  document.addEventListener("loading-complete", counterComplete, { once: true });
  reduced.addEventListener?.("change", () => {
    if (!reduced.matches) return;
    sectionsObserver?.disconnect();
    document.querySelectorAll(".section-motion-pending, .section-motion-enter").forEach(section =>
      section.classList.remove("section-motion-pending", "section-motion-enter"));
    if (phase === "reveal") dismiss();
    else reveal();
  });
  watchdog = setTimeout(reveal, 8000);
})();
