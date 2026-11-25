"use strict";
(() => {
  const canvas = document.getElementById("intro-snow");
  if (!canvas) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const lifetime = new AbortController();
  const options = { passive: true, signal: lifetime.signal };
  const mobile = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const root = document.documentElement;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  let w=0, h=0, dpr=0, active=false, disposed=false, frame=0;
  let last=0, time=0, lastTick=0, nextPaint=0, frameDebt=0, step=1000/60;
  const particles=[];
  const dragFactors=[0,0,0];
  const radians=Math.PI/180;
  // Sensor axes are relative to the device's natural orientation, not CSS.
  function orientationGravity(beta,gamma){
    return {x:Math.cos(beta*radians)*Math.sin(gamma*radians),y:Math.sin(beta*radians)};
  }
  function screenGravity(x,y,angle){
    const a=angle*radians,c=Math.cos(a),s=Math.sin(a);
    return {x:x*c+y*s,y:-x*s+y*c};
  }
  function snowDirection(x,y){
    const magnitude=Math.hypot(x,y);
    // When the phone lies flat, retain normal snowfall. A slight tilt
    // produces visible diagonal fall instead of amplifying sensor noise.
    const weight=smooth((magnitude-.04)/.34);
    const gx=weight*x/Math.max(magnitude,.001)*1.25;
    const gy=1-weight+weight*y/Math.max(magnitude,.001);
    const length=Math.hypot(gx,gy)||1;
    return {x:gx/length,y:gy/length};
  }
  let gravityX=0,gravityY=1;
  const samples=Object.create(null), sensors=Object.create(null);
  const sensorCounts={gravity:0,accelerometer:0,motion:0,orientation:0,absolute:0};
  const sensorErrors=Object.create(null);
  const priority=["gravity","accelerometer","motion","orientation","absolute"];
  let sensorSource="none",sensorCount=0,sensorStatus="waiting";
  let permissionState="unknown",debugPanel=null,debugLast=0;
  const sensorStart=performance.now();
  const debug=new URLSearchParams(location.search).get("snowDebug")==="1";
  const screenAngle=()=>Number(screen.orientation?.angle??window.orientation??0)||0;
  function noteSample(source,x,y,z){
    if(![x,y,z].every(Number.isFinite))return;
    samples[source]={x,y,z,at:performance.now()};
    sensorCount++;sensorCounts[source]++;sensorStatus="active";
  }
  function sampleOrientation(source,event){
    if(!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;
    const g=orientationGravity(event.beta,event.gamma);
    noteSample(source,g.x,g.y,Math.cos(event.beta*radians)*Math.cos(event.gamma*radians));
  }
  function sampleAcceleration(source,a){
    if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
    const norm=Math.hypot(a.x,a.y,a.z);
    if(norm<3||norm>20)return;
    let x=-a.x/norm,y=a.y/norm,z=a.z/norm;
    const prev=samples[source];
    if(source==="accelerometer"&&prev&&performance.now()-prev.at<500){
      const k=.30;
      x=prev.x+(x-prev.x)*k;y=prev.y+(y-prev.y)*k;z=prev.z+(z-prev.z)*k;
    }
    noteSample(source,x,y,z);
  }
  function getGravity(){
    const now=performance.now();
    // Prefer live streams to stale Euler angles; flat is a valid reading.
    let source=priority.find(key=>samples[key]&&now-samples[key].at<1500);
    if(!source)source=priority.filter(key=>samples[key]).sort((a,b)=>samples[b].at-samples[a].at)[0];
    if(!source){sensorSource="none";return {x:0,y:1};}
    sensorSource=source;
    const sample=samples[source];
    const g=screenGravity(sample.x,sample.y,screenAngle());
    return snowDirection(g.x,g.y);
  }
  function startGeneric(source,Constructor){
    if(sensors[source]||typeof Constructor!=="function")return;
    try{
      const sensor=new Constructor({frequency:30,referenceFrame:"device"});
      sensors[source]=sensor;
      sensor.addEventListener("reading",()=>sampleAcceleration(source,sensor),options);
      sensor.addEventListener("error",event=>{
        sensorErrors[source]=event.error?.name||"SensorError";
        delete sensors[source];delete samples[source];
        try{sensor.stop();}catch{}
      },options);
      delete sensorErrors[source];
      sensor.start();
    }catch(error){
      delete sensors[source];
      sensorErrors[source]=error.name||"SensorError";
    }
  }
  function startGenericSensors(){
    if(disposed||document.hidden)return;
    startGeneric("gravity",window.GravitySensor);
    startGeneric("accelerometer",window.Accelerometer);
  }
  function checkPermission(){
    if(!navigator.permissions?.query)return;
    navigator.permissions.query({name:"accelerometer"}).then(status=>{
      if(disposed)return;
      permissionState=status.state;
      status.addEventListener?.("change",()=>{
        permissionState=status.state;
        if(status.state==="granted")startGenericSensors();
      },options);
      if(status.state==="granted")startGenericSensors();
    }).catch(()=>{permissionState="unavailable";});
  }
  function initSensors(){
    if(!window.isSecureContext){sensorStatus="HTTPS required";return;}
    // Start on page load without device-type gating or a permission button.
    window.addEventListener("deviceorientation",event=>sampleOrientation("orientation",event),options);
    window.addEventListener("deviceorientationabsolute",event=>sampleOrientation("absolute",event),options);
    window.addEventListener("devicemotion",event=>{
      const a=event.accelerationIncludingGravity,linear=event.acceleration;
      if(a&&linear&&[a.x,a.y,a.z,linear.x,linear.y,linear.z].every(Number.isFinite)){
        const g={x:a.x-linear.x,y:a.y-linear.y,z:a.z-linear.z};
        const norm=Math.hypot(g.x,g.y,g.z);
        if(norm>=3&&norm<=20){sampleAcceleration("motion",g);return;}
      }
      sampleAcceleration("motion",a);
    },options);
    startGenericSensors();
    checkPermission();
    window.addEventListener("focus",startGenericSensors,options);
    window.addEventListener("pageshow",startGenericSensors,options);
  }
  function updateDebug(now){
    if(!debug||now-debugLast<250)return;
    debugLast=now;
    if(!debugPanel){
      debugPanel=document.createElement("output");
      debugPanel.className="snow-debug";
      document.body.appendChild(debugPanel);
    }
    const status=!sensorCount&&now-sensorStart>4000?"no sensor samples":sensorStatus;
    debugPanel.textContent="Snow 31 | "+status+" | "+sensorSource+
      "\nHTTPS: "+window.isSecureContext+" | samples: "+sensorCount+
      "\nG: "+sensorCounts.gravity+" | A: "+sensorCounts.accelerometer+" | M: "+sensorCounts.motion+
      "\nO: "+sensorCounts.orientation+" | Abs: "+sensorCounts.absolute+
      "\npermission: "+permissionState+" | errors: "+(Object.entries(sensorErrors).map(([key,value])=>key+":"+value).join(", ")||"none")+
      "\nangle: "+screenAngle()+"° | x: "+gravityX.toFixed(2)+" y: "+gravityY.toFixed(2);
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
      opacity: near ? .20 + depth*.20 : middle ? .32 + depth*.38 : .22 + depth*.24,
      phase: Math.random()*Math.PI*2, frequency: .45+Math.random()*1.05,
      sway: (near?10:middle?6:3)+Math.random()*5,
      age: initial ? .45 + Math.random()*.45 : 0,
      fade: .45 + Math.random()*.45,
      vx: gravityX*speed, vy: gravityY*speed
    };
  }
  function layerFor(i) {
    // Far field dominates; only a handful of larger foreground flakes.
    return i%13===0?2:i%3===0?1:0;
  }

  // CSS uses the stable large viewport. Browser chrome moving during scroll
  // does not change these dimensions, allocate a canvas, or respawn flakes.
  function resize() {
    if (disposed) return false;
    const width=canvas.clientWidth, height=canvas.clientHeight;
    const ratio=Math.min(devicePixelRatio || 1, mobile ? .9 : 1.5);
    if (!width || !height) return false;
    if (width===w && height===h && ratio===dpr) return true;
    const oldW=w, oldH=h;
    w=width; h=height; dpr=ratio;
    canvas.width=Math.max(1,Math.round(w*dpr));
    canvas.height=Math.max(1,Math.round(h*dpr));
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    if (oldW && oldH) {
      // A real window size change preserves the existing particle field.
      for (const p of particles) { p.x*=w/oldW; p.y*=h/oldH; }
    }
    const count=Math.round(mobile ? clamp(w*h/7200,32,72) : clamp(w*h/6500,48,180));
    if (particles.length>count) particles.length=count;
    while (particles.length<count) particles.push(particle(true,layerFor(particles.length)));
    return true;
  }

  function recycle(p) {
    const next=particle(false,p.layer);
    next.fade=.18+Math.random()*.25;
    const pad=next.radius*4+12;
    // Inject from the upstream edge in proportion to incoming flux.
    const horizontal=Math.abs(gravityX)*h,vertical=Math.abs(gravityY)*w;
    if(Math.random()*(horizontal+vertical)<horizontal){
      next.x=gravityX>0?-pad:w+pad;
      next.y=Math.random()*h;
    }else{
      next.x=Math.random()*w;
      next.y=gravityY>=0?-pad:h+pad;
    }
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed || document.hidden) return;
    const gap=now-(lastTick||now); lastTick=now;
    frameDebt=gap>26?Math.min(24,frameDebt+1):Math.max(0,frameDebt-.12);
    const nextStep=frameDebt>=12?1000/30:frameDebt<=3?1000/60:step;
    if(nextStep!==step){step=nextStep;nextPaint=now;}
    if(!nextPaint)nextPaint=now;
    if(now+1.5<nextPaint){frame=requestAnimationFrame(render);return;}
    nextPaint+=step*Math.max(1,Math.floor((now+1.5-nextPaint)/step)+1);
    const dt=clamp((now-(last||now))/1000,0,.067);
    last=now; time+=dt;
    for(let layer=0;layer<3;layer++)dragFactors[layer]=1-Math.exp(-dt*(6.2+layer*1.1));
    const target=getGravity();
    const gravityBlend=1-Math.exp(-dt*10);
    gravityX+=(target.x-gravityX)*gravityBlend;
    gravityY+=(target.y-gravityY)*gravityBlend;
    const air=Math.sin(time*.72)*3.2+Math.sin(time*.24+1.3)*2.1;
    updateDebug(now);
    ctx.clearRect(0,0,w,h);
    for(const p of particles){
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const sway=Math.sin(p.phase)*p.sway+air;
      // Each flake steers gradually instead of rotating/teleporting the
      // canvas. Different depth layers retain different inertia.
      const targetX=gravityX*p.speed+sway*gravityY;
      const targetY=gravityY*p.speed-sway*gravityX;
      p.vx+=(targetX-p.vx)*dragFactors[p.layer];
      p.vy+=(targetY-p.vy)*dragFactors[p.layer];
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      const pad=p.radius*4+44;
      if((p.x<-pad&&p.vx<0)||(p.x>w+pad&&p.vx>0)||
         (p.y<-pad&&p.vy<0)||(p.y>h+pad&&p.vy>0))recycle(p);
      const alpha=p.opacity*smooth(p.age/p.fade);
      if(alpha<.01)continue;
      ctx.globalAlpha=alpha;
      const size=p.radius*3;
      ctx.drawImage(sprites[p.layer],p.x-size*.5,p.y-size*.5,size,size);
    }
    ctx.globalAlpha=1;
    frame=requestAnimationFrame(render);
  }

  function resetClock(){
    last=0;lastTick=0;nextPaint=0;frameDebt=0;
  }
  function start(){
    if(disposed||active||!resize())return;
    active=true;
    root.classList.add("snow-active");
    if(!document.hidden)frame=requestAnimationFrame(render);
  }
  let observer;
  function onSizeChange(){
    if(disposed)return;
    if(active)resize();
    else start();
  }
  // Observe the stable canvas box rather than the scroll-dependent viewport.
  if("ResizeObserver" in window){
    observer=new ResizeObserver(onSizeChange);
    observer.observe(canvas);
  }else{
    window.addEventListener("resize",onSizeChange,options);
  }

  function dispose(){
    if(disposed)return;
    disposed=true;active=false;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    for(const sensor of Object.values(sensors)){try{sensor.stop();}catch{}}
    debugPanel?.remove();
    lifetime.abort();
    root.classList.remove("snow-active");
    particles.length=0;
    canvas.width=canvas.height=1;
    for(const sprite of sprites)sprite.width=sprite.height=1;
  }
  document.addEventListener("visibilitychange",()=>{
    if(!active||disposed)return;
    cancelAnimationFrame(frame);
    resetClock();
    if(!document.hidden){startGenericSensors();frame=requestAnimationFrame(render);}
  },options);
  window.addEventListener("pagehide",event=>{if(!event.persisted)dispose();},options);
  reduced.addEventListener?.("change",()=>{if(reduced.matches)dispose();},{signal:lifetime.signal});
  // A single field persists from the opening through the entire landing.
  initSensors();
  start();
})();
