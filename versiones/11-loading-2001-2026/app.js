"use strict";

(() => {
  const wheels = [...document.querySelectorAll(".wheel")];
  const label = document.getElementById("year-label");
  if (wheels.length !== 4 || !label) return;

  // Same staggered entrance as variant 10; the four reels then start together.
  const initialHold = 1160;
  const durations = [1120, 1350, 1580, 1810];
  const fullTurns = [3, 4, 4, 5];
  const acceleration = 120;
  const braking = 450;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let startedAt = null;
  let finished = false;
  let launched = false;

  const drums = wheels.map((wheel, index) => {
    const start = Number(wheel.dataset.start);
    const end = Number(wheel.dataset.end);
    const staticDigit = wheel.querySelector(".wheel__static");
    const drum = wheel.querySelector(".wheel__drum");
    const blur = document.getElementById("reel-blur-amount-" + index);
    const steps = fullTurns[index] * 10 + (end - start + 10) % 10;
    wheel.style.setProperty("--reel-filter", "url(#reel-blur-" + index + ")");
    const faces = Array.from({length: 10}, (_, digit) => {
      const face = document.createElement("span");
      const glyph = document.createElement("span");
      face.className = "wheel__face";
      glyph.className = "wheel__glyph";
      glyph.textContent = String(digit);
      face.append(glyph);
      face.style.setProperty("--face-angle", (-digit * 36) + "deg");
      drum.append(face);
      return face;
    });
    return {wheel, start, end, steps, duration: durations[index], staticDigit, drum, faces, blur, settled: false, fontPx: 0};
  });

  function settle(d) {
    if (d.settled) return;
    d.settled = true;
    d.staticDigit.textContent = String(d.end);
    d.wheel.classList.add("is-settled");
    d.wheel.classList.remove("is-spinning");
    d.drum.style.transform = "";
    d.blur?.setAttribute("stdDeviation", "0 0");
    d.faces.forEach(face => face.style.removeProperty("--face-opacity"));
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    drums.forEach(settle);
    label.textContent = "2026";
    document.documentElement.classList.add("loading-complete");
    document.dispatchEvent(new Event("loading-complete"));
  }

  // Trapezoidal velocity profile, integrated to distance. The final 450 ms
  // slow the last few digits smoothly and each reel stops at its own time.
  function motion(elapsed, duration, steps) {
    const speed = steps / (duration - (acceleration + braking) / 2);
    if (elapsed < acceleration) return {position: speed*elapsed*elapsed/(2*acceleration), speed: speed*elapsed/acceleration};
    if (elapsed < duration - braking) return {position: speed*(elapsed-acceleration/2), speed};
    const remaining = Math.max(0, duration-elapsed);
    return {position: steps-speed*remaining*remaining/(2*braking), speed: speed*remaining/braking};
  }

  function render(now) {
    if (finished) return;
    if (startedAt === null) startedAt = now;
    const elapsed = now - startedAt - initialHold;
    if (elapsed < 0) {
      frame = requestAnimationFrame(render);
      return;
    }
    for (const d of drums) {
      if (d.settled) continue;
      if (elapsed >= d.duration) { settle(d); continue; }
      if (!d.fontPx) d.fontPx = parseFloat(getComputedStyle(d.wheel).fontSize) || 100;
      d.wheel.classList.add("is-spinning");
      const m = motion(elapsed, d.duration, d.steps);
      const position = d.start + m.position;
      d.drum.style.transform = "translateZ(-1.6em) rotateX(" + position*36 + "deg)";
      // Vertical-only motion blur on each glyph (not the 3D drum).
      const blur = Math.min(d.fontPx*.085, d.fontPx*m.speed*1.65);
      d.blur?.setAttribute("stdDeviation", "0 " + blur.toFixed(3));
      for (let digit = 0; digit < 10; digit++) {
        const angle = (position-digit)*Math.PI/5;
        d.faces[digit].style.setProperty("--face-opacity", String(Math.pow(Math.max(0,Math.cos(angle)),1.7)));
      }
    }
    if (drums.every(d => d.settled)) { finish(); return; }
    frame = requestAnimationFrame(render);
  }

  if (reduced.matches) { finish(); return; }
  reduced.addEventListener?.("change", () => { if (reduced.matches) finish(); });
  addEventListener("resize", () => { drums.forEach(d => { d.fontPx = 0; }); }, {passive:true});
  function launch() {
    if (launched || finished) return;
    launched = true;
    frame = requestAnimationFrame(render);
  }
  setTimeout(launch, 1200);
  if (document.fonts?.ready) document.fonts.ready.then(launch, launch);
  else launch();
})();
