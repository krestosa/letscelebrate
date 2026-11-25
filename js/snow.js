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
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  const root = document.documentElement;
  let w = 0, h = 0, active = false, disposed = false, frame = 0, last = 0, time = 0;
  let target = 0, wind = 0, previousSensor = -Infinity, particles = [], sensorListening = false;
  let retiring = false, fieldOpacity = 1;

  function onOrientation(event) {
    if (!Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
    const angle = (screen.orientation?.angle ?? Number(window.orientation ?? 0)) * Math.PI / 180;
    const gamma = event.gamma * Math.PI / 180;
    const beta = event.beta * Math.PI / 180;
    const horizontal = Math.sin(gamma) * Math.cos(beta);
    const vertical = Math.sin(beta);
    const projected = horizontal * Math.cos(angle) + vertical * Math.sin(angle);
    target = Math.abs(projected) < .025 ? 0 : clamp(projected * 165, -125, 125);
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
    } catch { /* Natural falling snow remains available. */ }
    button.hidden = true;
  }

  // Paint the soft depth-of-field sprites once, not a blur on every frame.
  const sprites = [0,1,2].map(layer => {
    const image = document.createElement("canvas");
    image.width = image.height = 48;
    const pen = image.getContext("2d");
    const gradient = pen.createRadialGradient(24,24,0,24,24,23);
    if (layer === 0) {
      gradient.addColorStop(0,"rgba(255,255,255,.96)");
      gradient.addColorStop(.46,"rgba(255,255,255,.80)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    } else if (layer === 1) {
      gradient.addColorStop(0,"rgba(255,255,255,.98)");
      gradient.addColorStop(.48,"rgba(255,255,255,.86)");
      gradient.addColorStop(.78,"rgba(255,255,255,.18)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    } else {
      gradient.addColorStop(0,"rgba(255,255,255,.75)");
      gradient.addColorStop(.28,"rgba(255,255,255,.48)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    }
    pen.fillStyle=gradient;
    pen.fillRect(0,0,48,48);
    return image;
  });

  function particle(initial = false, layer = 0) {
    const depth = Math.random(), near = layer === 2, middle = layer === 1;
    const radius = near ? 3.2 + depth*2.6 : middle ? 1.45 + depth*1.25 : .75 + depth*.8;
    const speed = near ? 62 + depth*36 : middle ? 36 + depth*34 : 18 + depth*22;
    const y = initial ? Math.random()*h*(Math.random()<.68?.48:1) : -12 - Math.random()*32;
    return {
      layer, x: Math.random()*w, y, radius, speed,
      opacity: near ? .16 + depth*.18 : middle ? .28 + depth*.36 : .18 + depth*.23,
      phase: Math.random()*Math.PI*2, frequency: .45+Math.random()*1.05,
      sway: (near?14:middle?8:4)+Math.random()*8,
      age: initial ? -(Math.random()*.64) : 0,
      fade: .45 + Math.random()*.45,
      vx: 0, vy: speed
    };
  }
  function layerFor(i) {
    // Far field dominates; only a handful of larger foreground flakes.
    return i%13===0?2:i%3===0?1:0;
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const oldW = w, oldH = h;
    w = bounds.width; h = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    canvas.width = Math.round(w*dpr);
    canvas.height = Math.round(h*dpr);
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    const count = Math.round(clamp(w*h/6500, 48, mobile?100:180));
    if (oldW && oldH) for (const p of particles) {
      p.x *= w/oldW; p.y *= h/oldH;
    }
    if (particles.length>count) particles.length=count;
    while (particles.length<count) particles.push(particle(true,layerFor(particles.length)));
  }

  function recycle(p) {
    const next = particle(false,p.layer);
    if (Math.abs(wind)>30 && Math.random()<.32) {
      next.x=wind>0?-next.radius*3:w+next.radius*3;
      next.y=Math.random()*h*.8;
    } else {
      next.x=clamp(Math.random()*w-wind*.65,-w*.14,w*1.14);
    }
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed) return;
    const dt = clamp((now-(last||now))/1000,0,.04);
    last=now; time+=dt;
    // Orientation events may stop while the phone remains still; retain the
    // last valid gravity direction until a new reading replaces it.
    const targetWind = Number.isFinite(previousSensor) ? target : 0;
    wind += (targetWind-wind)*(1-Math.exp(-dt*4.3));
    const air = Math.sin(time*.75)*6+Math.sin(time*.27+1.3)*4;
    if (retiring) fieldOpacity += (0-fieldOpacity)*(1-Math.exp(-dt*5));
    ctx.clearRect(0,0,w,h);
    for (const p of particles) {
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const desiredX = (wind+air)*(.42+p.layer*.30)+Math.sin(p.phase)*p.sway;
      const desiredY = p.speed*(1+.08*Math.sin(p.phase*.7));
      const drag=1-Math.exp(-dt*(2.4+p.layer*.5));
      p.vx+=(desiredX-p.vx)*drag;
      p.vy+=(desiredY-p.vy)*drag;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      const pad=p.radius*4;
      if (p.y>h+pad || p.x<-pad-w*.18 || p.x>w+pad+w*.18) recycle(p);
      // Ease each flake into view and protect the main typographic lockup.
      const birth=smooth(p.age/p.fade);
      if (birth<=0) continue;
      const dx=(p.x-w*.5)/(w*.32),dy=(p.y-h*.5)/(h*.23);
      const center=.38+.62*smooth(Math.hypot(dx,dy));
      const alpha=p.opacity*birth*center*fieldOpacity;
      if(alpha<.01)continue;
      ctx.globalAlpha=alpha;
      const size=p.radius*3;
      ctx.drawImage(sprites[p.layer],p.x-size*.5,p.y-size*.5,size,size);
    }
    ctx.globalAlpha=1;
    frame=requestAnimationFrame(render);
  }

  function dispose() {
    if (disposed) return;
    disposed=true; active=false;
    cancelAnimationFrame(frame);
    lifetime.abort();
    if(button)button.hidden=true;
    particles=[];
    canvas.width=canvas.height=1;
    for(const sprite of sprites)sprite.width=sprite.height=1;
  }

  function start() {
    if(disposed||active||reduced.matches)return;
    resize();
    if(!w||!h)return;
    active=true; last=0; time=0;
    root.classList.add("loading-spinning");
    frame=requestAnimationFrame(render);
  }

  if (mobile && sensor && window.isSecureContext && !reduced.matches) {
    if(typeof sensor.requestPermission==="function"){
      if(button){
        button.hidden=false;
        button.addEventListener("click",permission,{signal:lifetime.signal});
      }
    }else listenOrientation();
  }
  document.addEventListener("loading-spin-start",start,{once:true,signal:lifetime.signal});
  document.addEventListener("intro-revealing",()=>{retiring=true;},{once:true,signal:lifetime.signal});
  document.addEventListener("intro-dismissed",dispose,{once:true,signal:lifetime.signal});
  window.addEventListener("resize",()=>{if(active)resize();},options);
  reduced.addEventListener?.("change",()=>{if(reduced.matches)dispose();},{signal:lifetime.signal});
})();
