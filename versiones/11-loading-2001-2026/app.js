"use strict";

(() => {
  const wheels = [...document.querySelectorAll(".wheel")];
  const label = document.getElementById("year-label");
  if (wheels.length !== 4 || !label) return;

  const initialHold = 480;
  const spinDuration = 1120;
  const fullTurns = [3, 3, 3, 3];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let startedAt = null;
  let finished = false;

  const drums = wheels.map((wheel, index) => {
    const start = Number(wheel.dataset.start);
    const end = Number(wheel.dataset.end);
    const staticDigit = wheel.querySelector(".wheel__static");
    const drum = wheel.querySelector(".wheel__drum");
    const steps = fullTurns[index] * 10 + (end - start + 10) % 10;
    // A complete ten-sided cylindrical reel, even if the digit is unchanged.
    const faces = Array.from({length: 10}, (_, digit) => {
      const face = document.createElement("span");
      face.className = "wheel__face";
      face.textContent = String(digit);
      face.style.setProperty("--face-angle", (-digit * 36) + "deg");
      drum.append(face);
      return face;
    });
    return {wheel, start, end, steps, staticDigit, drum, faces};
  });

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    for (const d of drums) {
      d.staticDigit.textContent = String(d.end);
      d.wheel.classList.remove("is-spinning");
      d.drum.style.transform = "";
      d.wheel.style.removeProperty("--motion-blur");
      d.faces.forEach(face => face.style.removeProperty("--face-opacity"));
    }
    label.textContent = "2026";
    document.documentElement.classList.add("loading-complete");
    document.dispatchEvent(new Event("loading-complete"));
  }

  // Integrated speed curve: accelerate quickly, cruise, then decelerate.
  // Position and derivative remain continuous through the three phases.
  function motion(t) {
    const acceleration = .13, braking = .35, cruiseEnd = 1 - braking;
    const norm = 1 - (acceleration + braking) / 2;
    if (t < acceleration) return {p: t*t/(2*acceleration*norm), v: t/(acceleration*norm)};
    if (t < cruiseEnd) return {p: (t-acceleration/2)/norm, v: 1/norm};
    const remaining = 1-t;
    return {p: 1-remaining*remaining/(2*braking*norm), v: remaining/(braking*norm)};
  }

  function render(now) {
    if (finished) return;
    if (startedAt === null) startedAt = now;
    const elapsed = now - startedAt;
    if (elapsed < initialHold) {
      frame = requestAnimationFrame(render);
      return;
    }
    const t = Math.min(1, (elapsed - initialHold) / spinDuration);
    if (t >= 1) { finish(); return; }
    const m = motion(t);
    for (const d of drums) {
      d.wheel.classList.add("is-spinning");
      const position = d.start + d.steps*m.p;
      // Compensate the radius so the visible front of the cylinder stays at z=0.
      d.drum.style.transform = "translateZ(-1.6em) rotateX(" + position*36 + "deg)";
      const blur = Math.min(.065, m.v * d.steps * .0014);
      d.wheel.style.setProperty("--motion-blur", blur.toFixed(4) + "em");
      for (let digit = 0; digit < 10; digit++) {
        const angle = (position - digit) * Math.PI / 5;
        const facing = Math.max(0, Math.cos(angle));
        d.faces[digit].style.setProperty("--face-opacity", String(Math.pow(facing, 1.7)));
      }
    }
    frame = requestAnimationFrame(render);
  }

  if (reduced.matches) { finish(); return; }
  reduced.addEventListener?.("change", () => { if (reduced.matches) finish(); });
  // Start after the font is available; bound the wait so loading cannot hang.
  let launched = false;
  function launch() {
    if (launched || finished) return;
    launched = true;
    frame = requestAnimationFrame(render);
  }
  setTimeout(launch, 1200);
  if (document.fonts?.ready) document.fonts.ready.then(launch, launch);
  else launch();
})();
