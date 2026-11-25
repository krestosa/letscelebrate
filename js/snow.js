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
  const orientationSensor = window.DeviceOrientationEvent;
  const motionSensor = window.DeviceMotionEvent;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  const root = document.documentElement;
  let w = 0, h = 0, active = false, disposed = false, frame = 0, last = 0, time = 0;
  let gravityX = 0, gravityY = 1, particles = [], sensorListening = false;
  let orientationReading = null, motionReading = null, orientationAt = -Infinity, motionAt = -Infinity;
  let motionSign = 1, sensorState = "waiting", debug = null;
  let targetX = 0, targetY = 1, flowX = 0, flowY = 1;
  let landing = false, landingBlend = 0;
  let lastTick = 0, frameDebt = 0, step = mobile ? 1000/30 : 1000/60;
  const dragFactors = [0,0,0];

  function setSensorState(state) {
    if(sensorState===state && canvas.dataset.motion===state)return;
    sensorState = state;
    canvas.dataset.motion = state;
    if (debug) debug.textContent = "Nieve · " + state;
  }
  function onOrientation(event) {
    if (!Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
    const gamma = event.gamma * Math.PI / 180;
    const beta = event.beta * Math.PI / 180;
    // Gravity projected into the original device axes (screen y points down).
    // This works even with the handset upright and avoids Euler-roll ambiguity.
    orientationReading = [Math.cos(beta)*Math.sin(gamma), Math.sin(beta)];
    orientationAt = performance.now();
  }
  function onMotion(event) {
    const g = event.accelerationIncludingGravity;
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return;
    const a = event.acceleration;
    const ax = g.x-(Number.isFinite(a?.x)?a.x:0);
    const ay = g.y-(Number.isFinite(a?.y)?a.y:0);
    const reading = [clamp(-ax/9.81,-1,1),clamp(ay/9.81,-1,1)];
    if (orientationReading && performance.now()-orientationAt<800) {
      // Match older implementations with reversed accelerometer polarity.
      const dot=reading[0]*orientationReading[0]+reading[1]*orientationReading[1];
      if(Math.abs(dot)>.18)motionSign=dot<0?-1:1;
    }
    motionReading = reading;
    motionAt = performance.now();
  }
  function updateGravity(now) {
    const useOrientation=orientationReading && (now-orientationAt<1000 || !motionReading);
    const reading = useOrientation
      ? orientationReading
      : motionReading ? motionReading.map(v=>v*motionSign) : null;
    if (!reading) return;
    setSensorState(useOrientation?"orientation":"motion");
    const angle=(screen.orientation?.angle ?? Number(window.orientation ?? 0))*Math.PI/180;
    gravityX=reading[0]*Math.cos(angle)+reading[1]*Math.sin(angle);
    gravityY=-reading[0]*Math.sin(angle)+reading[1]*Math.cos(angle);
    const planar=Math.hypot(gravityX,gravityY);
    // Amplify the horizontal component, not just an additive wind.
    // Flat devices retain a soft downward snowfall.
    const x=Math.abs(gravityX)<.008?0:gravityX*3.2;
    const y=gravityY+Math.max(0,1-planar*2.5)*.8;
    const norm=Math.hypot(x,y);
    targetX=norm>.06?x/norm:0;
    targetY=norm>.06?y/norm:1;
    if(debug)debug.textContent="Nieve · "+sensorState+" · "+Math.round(Math.atan2(targetX,targetY)*180/Math.PI)+"°";
  }
  function listenSensors() {
    if(disposed||sensorListening||!mobile||reduced.matches)return;
    sensorListening=true;
    if(orientationSensor)window.addEventListener("deviceorientation",onOrientation,options);
    if(motionSensor)window.addEventListener("devicemotion",onMotion,options);
    setSensorState("waiting");
    setTimeout(()=>{
      if(!disposed&&!orientationReading&&!motionReading)setSensorState("no-data");
    },2500);
  }
  async function permission() {
    if (!button || disposed) return;
    button.disabled = true;
    // Invoke both permission APIs during the same user activation.
    const requests=[orientationSensor,motionSensor].filter(s=>typeof s?.requestPermission==="function");
    const pending=requests.map(s=>{try{return Promise.resolve(s.requestPermission());}catch(e){return Promise.reject(e);}});
    const results=await Promise.allSettled(pending);
    if(disposed)return;
    if(results.some(r=>r.status==="fulfilled"&&r.value==="granted")){
      listenSensors();
      button.hidden=true;
    }else{
      setSensorState("denied");
      button.disabled=false;
      button.textContent="Activar inclinación";
    }
  }
  // Opt-in, local-only diagnostics; never collect or transmit sensor values.
  if(new URLSearchParams(location.search).get("snow-debug")==="1"){
    debug=document.createElement("output");
    debug.className="snow-debug";
    debug.setAttribute("aria-live","off");
    document.body.append(debug);
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
    const next=particle(false,p.layer);
    // Spawn on the incoming edge, weighted by the flow through each edge.
    // This keeps density stable when flakes travel almost horizontally.
    const horizontal=Math.abs(flowX)*h, vertical=Math.abs(flowY)*w;
    const side=Math.random()*(horizontal+vertical)<horizontal;
    const pad=next.radius*3;
    if(side){next.x=flowX>=0?-pad:w+pad;next.y=Math.random()*h;}
    else{next.x=Math.random()*w;next.y=flowY>=0?-pad:h+pad;}
    const speed=next.speed*(1+Math.abs(flowX)*2.4);
    next.vx=flowX*speed;next.vy=flowY*speed;
    next.fade=.18+Math.random()*.25;
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed) return;
    const gap=now-(lastTick||now);lastTick=now;
    if(mobile){step=Math.abs(flowX)>.12?1000/60:1000/30;}else{
      frameDebt=gap>24?Math.min(12,frameDebt+1):Math.max(0,frameDebt-.25);
      step=frameDebt>=6?1000/30:1000/60;
    }
    if(last&&now-last<step-1.5){frame=requestAnimationFrame(render);return;}
    const dt=clamp((now-(last||now))/1000,0,.067);
    last=now;time+=dt;
    for(let layer=0;layer<3;layer++)dragFactors[layer]=1-Math.exp(-dt*(4.5+layer*1.1));
    updateGravity(now);
    const response=1-Math.exp(-dt*12);
    flowX+=(targetX-flowX)*response;
    flowY+=(targetY-flowY)*response;
    const air = Math.sin(time*.75)*6+Math.sin(time*.27+1.3)*4;
    landingBlend += ((landing?1:0)-landingBlend)*(1-Math.exp(-dt*4));
    ctx.clearRect(0,0,w,h);
    for (const p of particles) {
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const speed=p.speed*(1+Math.abs(flowX)*2.4);
      const sway=Math.sin(p.phase)*p.sway+air;
      const desiredX=flowX*speed+flowY*sway;
      const desiredY=flowY*speed-flowX*sway;
      const drag=dragFactors[p.layer];
      p.vx+=(desiredX-p.vx)*drag;
      p.vy+=(desiredY-p.vy)*drag;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      const pad=p.radius*4;
      if (p.y>h+pad || p.y<-pad-h*.12 || p.x<-pad-w*.08 || p.x>w+pad+w*.08) recycle(p);
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
    debug?.remove();
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

  if(mobile&&!reduced.matches){
    if(!window.isSecureContext){
      setSensorState("HTTPS-required");
      if(!debug){
        debug=document.createElement("output");
        debug.className="snow-debug";
        debug.setAttribute("role","status");
        debug.textContent="Inclinación no disponible: se requiere HTTPS";
        document.body.append(debug);
      }else debug.textContent="Nieve · HTTPS requerido";
    }
    else if(!orientationSensor&&!motionSensor)setSensorState("unsupported");
    else if(typeof orientationSensor?.requestPermission==="function"||typeof motionSensor?.requestPermission==="function"){
      setSensorState("permission-required");
      if(button){
        button.hidden=false;
        button.addEventListener("click",permission,{signal:lifetime.signal});
      }
    }else listenSensors();
  }else setSensorState("natural");
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
