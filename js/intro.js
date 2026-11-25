"use strict";
(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let phase = "counter";
  let holdTimer, watchdog, cancelTransition = () => {};
  let sectionsObserver;
  root.classList.add("intro-active");

  const token = (name, fallback) => {
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    const n = parseFloat(value);
    return Number.isFinite(n) ? n * (value.endsWith("ms") ? 1 : value.endsWith("s") ? 1000 : 1) : fallback;
  };

  // Sequence follows actual transition completion. The timeout is only a
  // safety net for background tabs, missing assets or disabled transitions.
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
    clearTimeout(holdTimer);
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
    clearTimeout(holdTimer);
    clearTimeout(watchdog);
    cancelTransition();
    const overlay = document.getElementById("intro-screen");
    const page = document.getElementById("landing-page");
    if (page) {
      page.inert = false;
      animateSections(page);
    }
    // The hero starts its own entrance while the overlay is dissolving.
    root.classList.add("landing-enter");
    if (overlay) overlay.inert = true;
    if (!overlay || reduced.matches) { dismiss(); return; }
    afterMotion(overlay, "opacity", token("--intro-exit", 420), dismiss);
    root.classList.add("intro-revealing");
  }

  function writeSignature() {
    if (phase !== "counter-hold") return;
    const signature = document.getElementById("intro-signature");
    const lastStroke = signature?.querySelector(".signature-complete");
    if (reduced.matches || !lastStroke) {
      reveal();
      return;
    }
    phase = "signature";
    // The first pass starts only after all four reels have settled.
    // Finish on the mask's last animation event, not the scaling transition.
    const writeDuration = token("--signature-write-first", 1250)
      + token("--signature-write-second", 800)
      + token("--signature-write-finish", 160);
    afterMotion(lastStroke, "signature-finish", writeDuration, () => {
      if (phase !== "signature") return;
      holdTimer = setTimeout(reveal, token("--signature-hold", 180));
    }, true);
    root.classList.add("intro-signature");
  }

  function counterComplete() {
    if (phase !== "counter") return;
    clearTimeout(watchdog);
    if (reduced.matches) { reveal(); return; }
    phase = "counter-hold";
    holdTimer = setTimeout(writeSignature, token("--year-hold", 160));
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
