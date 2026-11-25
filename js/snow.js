"use strict";
(() => {
  const canvas = document.getElementById("intro-snow");
  const button = document.getElementById("snow-motion-permission");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const lifetime = new AbortController();
  const options = { passive: true, signal: lifetime.signal };
  const mobile = matchMedia("(pointer: coarse)").matches;
  const sensor = window.DeviceOrientationEvent;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let w = 0, h = 0, active = false, disposed = false, frame = 0, last = 0;
  let target = 0, wind = 0, previousSensor = 0, particles = [], sensorListening = false;

  function onOrientation(event) {
    if (!Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
    // Project gravity into screen coordinates, including landscape rotation.
    const angle = (screen.orientation?.angle ?? Number(window.orientation ?? 0)) * Math.PI / 180;
    const gamma = event.gamma * Math.PI / 180;
    const beta = event.beta * Math.PI / 180;
    const horizontal = Math.sin(gamma) * Math.cos(beta);
    const vertical = Math.sin(beta);
    target = clamp((horizontal * Math.cos(angle) + vertical * Math.sin(angle)) * 150, -125, 125);
    previousSensor = performance.now();
  }
  function listenOrientation() {
    if (disposed || sensorListening || !sensor || !mobile || reduced.matches) return;
    sensorListening = true;
    window.addEventListener("deviceorientation", onOrientation, options);
  }
  async function permission() {
    if (!button || disposed) return;
    button.disabled = true;
    try {
      if (await sensor.requestPermission() === "granted") listenOrientation();
    } catch { /* Keep natural downward snowfall if unavailable. */ }
    button.hidden = true;
  }

  function particle(initial = false) {
    const depth = Math.random();
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : -8 - Math.random() * 28,
      radius: .65 + depth * 2.25,
      speed: 22 + depth * 64,
      opacity: .18 + depth * .46,
      sway: 5 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      frequency: .55 + Math.random() * .9,
      depth
    };
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const oldW = w, oldH = h;
    w = bounds.width; h = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    const count = Math.round(clamp(w * h / 8500, 38, mobile ? 84 : 145));
    if (oldW && oldH) for (const p of particles) {
      p.x *= w / oldW; p.y *= h / oldH;
    }
    if (particles.length > count) particles.length = count;
    while (particles.length < count) particles.push(particle(true));
  }

  function render(now) {
    if (!active || disposed) return;
    const dt = Math.min(.04, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    const fresh = now - previousSensor < 1100;
    // A low-pass filter avoids visible jitter from noisy phone sensors.
    wind += ((fresh ? target : 0) - wind) * (1 - Math.exp(-dt * 5));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f7f5f0";
    for (const p of particles) {
      p.phase += dt * p.frequency;
      p.x += (wind * (.5 + p.depth * .5) + Math.sin(p.phase) * p.sway) * dt;
      p.y += p.speed * dt;
      if (p.x > w + 8) p.x = -8;
      else if (p.x < -8) p.x = w + 8;
      if (p.y > h + 8) {
        p.y = -8 - Math.random() * 20;
        p.x = Math.random() * w;
      }
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(render);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    cancelAnimationFrame(frame);
    lifetime.abort();
    if (button) button.hidden = true;
    ctx.clearRect(0, 0, w, h);
    particles = [];
    canvas.width = canvas.height = 1;
  }

  function start() {
    if (disposed || active || reduced.matches) return;
    resize();
    if (!w || !h) return;
    active = true;
    document.documentElement.classList.add("loading-spinning");
    frame = requestAnimationFrame(render);
  }

  if (mobile && sensor && !reduced.matches) {
    if (typeof sensor.requestPermission === "function") {
      if (button) {
        button.hidden = false;
        button.addEventListener("click", permission, { signal: lifetime.signal });
      }
    } else listenOrientation();
  }
  document.addEventListener("loading-spin-start", start, { once: true, signal: lifetime.signal });
  document.addEventListener("intro-dismissed", dispose, { once: true, signal: lifetime.signal });
  window.addEventListener("resize", () => { if (active) resize(); }, options);
  reduced.addEventListener?.("change", () => { if (reduced.matches) dispose(); }, { signal: lifetime.signal });
})();
