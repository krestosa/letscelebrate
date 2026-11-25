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
  const mobile = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth,innerHeight)<=600;
  const sensor = window.DeviceOrientationEvent;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  const root = document.documentElement;
  let w = 0, h = 0, active = false, disposed = false, frame = 0, last = 0, time = 0;
  let target = 0, wind = 0, previousSensor = -Infinity, particles = [], sensorListening = false;
  let landing = false, landingBlend = 0;
  let lastTick = 0, frameDebt = 0, step = mobile ? 1000/30 : 1000/60;
  const dragFactors = [0,0,0];

  function onOrientation(event) {
    if (!Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
    const angle = (screen.orientation?.angle ?? Number(window.orientation ?? 0)) * Math.PI / 180;
    const gamma = event.gamma * Math.PI / 180;
    const beta = event.beta * Math.PI / 180;
    // Use screen-relative tilt rather than attenuating gamma by cos(beta):
    // an upright phone should still react visibly to a small side tilt.
    const horizontal = Math.sin(gamma);
    const vertical = Math.sin(beta);
    const projected = horizontal * Math.cos(angle) + vertical * Math.sin(angle);
    const magnitude = Math.abs(projected);
    // Tiny dead zone, strong response to small inclinations, bounded gusts.
    target = magnitude < .012 ? 0 : Math.sign(projected) * Math.min(360, (magnitude-.012)*560);
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
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 0.9 : 1.5);
    canvas.width = Math.round(w*dpr);
    canvas.height = Math.round(h*dpr);
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    const count = Math.round(mobile ? clamp(w*h/7200,32,72) : clamp(w*h/6500,48,180));
    if (oldW && oldH) for (const p of particles) {
      p.x *= w/oldW; p.y *= h/oldH;
    }
    if (particles.length>count) particles.length=count;
    while (particles.length<count) particles.push(particle(true,layerFor(particles.length)));
  }

  function recycle(p) {
    const next = particle(false,p.layer);
    if (Math.abs(wind)>30 && Math.random()<Math.min(.86,.32+Math.abs(wind)/600)) {
      next.x=wind>0?-next.radius*3:w+next.radius*3;
      next.y=Math.random()*h;
    } else {
      next.x=clamp(Math.random()*w-wind*.25,-w*.14,w*1.14);
    }
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed) return;
    const gap=now-(lastTick||now);lastTick=now;
    if(!mobile){
      frameDebt=gap>24?Math.min(12,frameDebt+1):Math.max(0,frameDebt-.25);
      step=frameDebt>=6?1000/30:1000/60;
    }
    if(last&&now-last<step-1.5){frame=requestAnimationFrame(render);return;}
    const dt=clamp((now-(last||now))/1000,0,.067);
    last=now;time+=dt;
    for(let layer=0;layer<3;layer++)dragFactors[layer]=1-Math.exp(-dt*(7.0+layer*1.1));
    // Orientation events may stop while the phone remains still; retain the
    // last valid gravity direction until a new reading replaces it.
    const targetWind = Number.isFinite(previousSensor) ? target : 0;
    wind += (targetWind-wind)*(1-Math.exp(-dt*10));
    const air = Math.sin(time*.75)*6+Math.sin(time*.27+1.3)*4;
    landingBlend += ((landing?1:0)-landingBlend)*(1-Math.exp(-dt*4));
    ctx.clearRect(0,0,w,h);
    for (const p of particles) {
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const desiredX = (wind+air)*(.72+p.layer*.24)+Math.sin(p.phase)*p.sway;
      const desiredY = p.speed*(1+.08*Math.sin(p.phase*.7));
      const drag=dragFactors[p.layer];
      p.vx+=(desiredX-p.vx)*drag;
      p.vy+=(desiredY-p.vy)*drag;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      const pad=p.radius*4;
      if (p.y>h+pad || p.x<-pad-w*.18 || p.x>w+pad+w*.18) recycle(p);
      // Ease each flake into view and protect the main typographic lockup.
      const birth=smooth(p.age/p.fade);
      if (birth<=0) continue;
      const dx=(p.x-w*.5)/(w*.32),dy=(p.y-h*.5)/(h*.23);
      const center=.38+.62*smooth(dx*dx+dy*dy);
      const alpha=p.opacity*birth*(center+(1-center)*landingBlend*.65)*(1-landingBlend*.12);
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
    root.classList.remove("snow-active");
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
    active=true;last=0;lastTick=0;time=0;
    root.classList.add("snow-active");
    if(!document.hidden)frame=requestAnimationFrame(render);
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
  const enterLanding=()=>{landing=true;start();};
  document.addEventListener("intro-revealing",enterLanding,{once:true,signal:lifetime.signal});
  document.addEventListener("intro-dismissed",enterLanding,{once:true,signal:lifetime.signal});
  // Preserve particles and sensor state while the intro is removed.
  // Suspend the animation when the page is hidden, then resume without a jump.
  document.addEventListener("visibilitychange",()=>{
    if(!active||disposed)return;
    cancelAnimationFrame(frame);
    last=0;lastTick=0;
    if(!document.hidden)frame=requestAnimationFrame(render);
  },{signal:lifetime.signal});
  window.addEventListener("pagehide",event=>{if(!event.persisted)dispose();},options);
  let resizePending=false;
  window.addEventListener("resize",()=>{
    if(!active||resizePending)return;
    resizePending=true;
    requestAnimationFrame(()=>{resizePending=false;if(active)resize();});
  },options);
  reduced.addEventListener?.("change",()=>{if(reduced.matches)dispose();},{signal:lifetime.signal});
})();
