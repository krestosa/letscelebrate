"use strict";
(() => {
  const wheels = [...document.querySelectorAll(".wheel")];
  const label = document.getElementById("year-label");
  const progress = document.getElementById("loading-progress");
  const fill = document.getElementById("loading-progress-fill");
  let canvas = document.getElementById("cylinder-canvas");
  if (wheels.length !== 4 || !label || !progress || !fill || !canvas) return;

  const root = document.documentElement;
  const mobile = matchMedia("(pointer: coarse)").matches;
  let pixelRatioCap = mobile ? 1.25 : 2;
  let lastRender = -Infinity, slowFrames = 0, loweredResolution = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const tokens=getComputedStyle(root);
  const entrance={
    delay:parseFloat(tokens.getPropertyValue("--intro-delay"))||100,
    duration:parseFloat(tokens.getPropertyValue("--digit-duration"))||420,
    offsets:wheels.map(w=>parseFloat(w.style.getPropertyValue("--digit-offset"))||0)
  };
  const initialHold=entrance.delay+Math.max(...entrance.offsets)+entrance.duration+90;
  const durations=[1320,1760,2200,2640];
  const totalDuration=initialHold+durations[3];
  const acceleration=140, braking=920;
  const clamp = v => Math.max(0,Math.min(1,v));
  // Ten equally spaced digits on a complete circular reel.
  const step = Math.PI * 2 / 10;
  const radius = 1.45, camera = .65;
  const limit = Math.acos(radius / (camera + radius));
  // Desktop glyph texture tracks the actual display pixel size; mobile retains 256px.
  let cell = mobile ? 256 : Math.max(512, Math.min(1024, Math.ceil((parseFloat(getComputedStyle(wheels[0]).fontSize)||512)*Math.min(devicePixelRatio||1,2)/128)*128));
  let atlasSize = cell*4;
  let renderer, frame = 0, startedAt = null, finished = false, launched = false;
  let lastPercent = -1, needsResize = true, drawingStarted = false, progressMotion;
  let spinStarted = false;
  const drums = wheels.map((wheel, i) => {
    const start = Number(wheel.dataset.start), end = Number(wheel.dataset.end);
    return {wheel, start, end, steps:10+(end-start+10)%10,
      duration:durations[i], index:i, digit:wheel.querySelector(".wheel__static"), settled:false, phase:start};
  });
  root.classList.add("loading-preparing");

  // Rasterize the original Gazzetta glyphs once. The texture is wrapped
  // around a genuinely curved cylindrical surface, not a stack of flat cards.
  function makeAtlas() {
    const a = document.createElement("canvas");
    a.width = a.height = atlasSize;
    const ctx = a.getContext("2d");
    ctx.font = '900 '+cell+'px Gazzetta, Impact, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f7f5f0";
    const m = ctx.measureText("2026");
    const baseline = cell/2 + ((m.fontBoundingBoxAscent ?? cell*.8)-(m.fontBoundingBoxDescent ?? cell*.2))/2;
    for (let i=0;i<10;i++) {
      const x=(i%4)*cell, y=Math.floor(i/4)*cell;
      ctx.save(); ctx.beginPath(); ctx.rect(x,y,cell,cell);ctx.clip();
      ctx.fillText(String(i),x+cell/2,y+baseline);ctx.restore();
    }
    return a;
  }

  function webGLRenderer(atlas) {
    const gl = canvas.getContext("webgl", {alpha:true, antialias:!mobile, depth:false, stencil:false, premultipliedAlpha:true, preserveDrawingBuffer:!mobile});
    if (!gl) return null;
    const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(atlasSize>maxTexture){cell=Math.floor(maxTexture/4);atlasSize=cell*4;atlas=makeAtlas();}
    const vertex = `
      attribute vec2 aSurface;
      uniform vec2 uSize,uCenter;
      uniform float uEm,uRadius,uCamera;
      varying float vAngle,vU;
      void main(){
        float angle=aSurface.y;
        float y=uRadius*sin(angle), z=uRadius*(cos(angle)-1.0);
        float w=1.0-z/uCamera;
        vec2 center=vec2(2.0*uCenter.x/uSize.x-1.0,1.0-2.0*uCenter.y/uSize.y);
        vec2 offset=vec2(2.0*aSurface.x*uEm/uSize.x,-2.0*y*uEm/uSize.y);
        gl_Position=vec4(center*w+offset,0.0,w);
        vAngle=angle;vU=aSurface.x+0.5;
      }`;
    const blurSamples = mobile ? 3 : 7;
    const fragment = `
      precision highp float;
      uniform sampler2D uAtlas;
      uniform float uPhase,uStep,uBlur,uLimit,uOpacity,uIsolation;
      varying float vAngle,vU;
      vec4 glyph(float phase){
        float n=phase+vAngle/uStep+0.5;
        float digit=mod(floor(n),10.0);
        vec2 uv=(vec2(mod(digit,4.0),floor(digit/4.0))*${cell}.0+
          vec2(0.5+vU*${cell-1}.0,0.5+fract(n)*${cell-1}.0))/${atlasSize}.0;
        vec4 sampleColor=texture2D(uAtlas,uv);
        // Peripheral digits are deliberately gray. As the reel settles,
        // only the exact central digit remains visible.
        float distanceToCenter=abs(floor(n)-uPhase);
        float focus=1.0-smoothstep(0.18,0.85,distanceToCenter);
        float central=1.0-step(0.5,distanceToCenter);
        sampleColor.a*=mix(0.26,1.0,focus)*mix(1.0,central,uIsolation);
        return sampleColor;
      }
      void main(){
        vec4 c;
        // Resting and entering digits need one texture sample, not seven.
        if(uBlur<0.001){
          c=glyph(uPhase);
        }else{
          c=vec4(0.0);
          for(int i=0;i<${blurSamples};i++){
            float f=(float(i)-${((mobile?3:7)-1)/2}.0)/${((mobile?3:7)-1)/2}.0;
            c+=glyph(uPhase+f*uBlur)*(1.0-0.65*abs(f));
          }
          c/=${mobile ? "1.7" : "4.4"};
        }
        float edge=1.0-smoothstep(uLimit*0.70,uLimit,abs(vAngle));
        float lit=max(0.0,cos(vAngle));
        float light=0.18+0.82*lit*lit*lit;
        gl_FragColor=vec4(vec3(0.9686,0.9608,0.9412)*light,clamp(c.a*edge*uOpacity,0.0,1.0));
      }`;
    const compile=(kind,src)=>{
      const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program=gl.createProgram();
    const vs=compile(gl.VERTEX_SHADER,vertex), fs=compile(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,vs);
    gl.attachShader(program,fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    // 96 connected curved segments per reel; perspective-correct texture mapping.
    const vertices=[];
    const segments=mobile?48:96;
    for(let i=0;i<=segments;i++){
      const a=-limit+2*limit*i/segments;
      vertices.push(-.5,a,.5,a);
    }
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    const attr=gl.getAttribLocation(program,"aSurface");
    gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
    for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const u=Object.fromEntries(["uSize","uCenter","uEm","uRadius","uCamera","uAtlas","uPhase","uStep","uBlur","uLimit","uOpacity","uIsolation"].map(n=>[n,gl.getUniformLocation(program,n)]));
    gl.uniform1i(u.uAtlas,0);gl.uniform1f(u.uRadius,radius);
    gl.uniform1f(u.uCamera,camera);gl.uniform1f(u.uStep,step);gl.uniform1f(u.uLimit,limit);
    gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    return {
      gpu:true,
      dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);},
      resize(w,h,dpr){gl.viewport(0,0,Math.round(w*dpr),Math.round(h*dpr));gl.uniform2f(u.uSize,w,h);},
      clear(){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);},
      draw(d,pos,speed,opacity=1,offset=0,isolation=0){
        gl.uniform2f(u.uCenter,d.x,d.y+offset*d.em);gl.uniform1f(u.uEm,d.em);
        gl.uniform1f(u.uPhase,((pos%10)+10)%10);
        gl.uniform1f(u.uBlur,Math.min(.14,speed*7));gl.uniform1f(u.uOpacity,opacity);gl.uniform1f(u.uIsolation,isolation);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,vertices.length/2);
      }
    };
  }

  // CPU fallback: project the same curved cylindrical mesh in narrow strips.
  // This preserves curvature and depth even if WebGL is disabled.
  function cpuRenderer(atlas) {
    const ctx=canvas.getContext("2d");
    if(!ctx)return null;
    let w=0,h=0;
    const project=a=>{
      const z=radius*(Math.cos(a)-1), scale=camera/(camera-z);
      return {y:radius*Math.sin(a)*scale, scale};
    };
    const n=mobile?48:192;
    const mesh=Array.from({length:n},(_,i)=>{
      const a=-limit+2*limit*i/n,b=-limit+2*limit*(i+1)/n,mid=(a+b)/2;
      const p=project(a),q=project(b),m=project(mid);
      const edge=clamp((limit-Math.abs(mid))/(limit*.2));
      const shade=.18+.82*Math.pow(Math.cos(mid),3);
      return {y:p.y,dy:q.y-p.y,scale:m.scale,mid,alpha:edge*shade,sh:(b-a)/step*cell};
    });
    const single=[[0,1]];
    return {
      gpu:false,
      resize(width,height,dpr){w=width;h=height;ctx.setTransform(dpr,0,0,dpr,0,0);},
      clear(){ctx.clearRect(0,0,w,h);},
      draw(d,pos,speed,opacity=1,offset=0,isolation=0){
        const blur=Math.min(.14,speed*7);
        const samples=!mobile&&blur>.015?[[-blur,.25],[0,.5],[blur,.25]]:single;
        for(const m of mesh){
          const mid=m.mid;
          const dy=d.y+(m.y+offset)*d.em,dh=Math.max(.25,m.dy*d.em+.25);
          const dw=d.em*m.scale,dx=d.x-dw/2;
          for(const [offset,weight] of samples){
            const index=pos+offset+mid/step+.5;
            const digit=((Math.floor(index)%10)+10)%10;
            const fraction=index-Math.floor(index);
            const sy=Math.min(cell-1,Math.max(0,fraction*cell));
            const sh=Math.min(cell-sy,Math.max(1,m.sh));
            const distanceToCenter=Math.abs(Math.floor(index)-pos);
            const f=clamp((distanceToCenter-.18)/(.85-.18));
            const focus=1-f*f*(3-2*f);
            const central=distanceToCenter<.5?1:0;
            ctx.globalAlpha=m.alpha*weight*opacity*(.26+.74*focus)*(1-isolation+isolation*central);
            ctx.drawImage(atlas,(digit%4)*cell,Math.floor(digit/4)*cell+sy,cell,sh,dx,dy,dw,dh);
          }
        }
        ctx.globalAlpha=1;
      }
    };
  }

  function resize(){
    const box=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,pixelRatioCap);
    if(!box.width||!box.height)return;
    canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);
    renderer?.resize(box.width,box.height,dpr);
    for(const d of drums){
      const r=d.wheel.getBoundingClientRect();
      d.x=r.left-box.left+r.width/2;d.y=r.top-box.top+r.height/2;
      d.em=parseFloat(getComputedStyle(d.wheel).fontSize)||100;
    }
    needsResize=false;
  }

  function updateProgress(elapsed){
    const value=Math.max(0,Math.min(1,elapsed/totalDuration));
    if(!progressMotion)fill.style.transform="scaleX("+value+")";
    const percent=Math.floor(value*100);
    if(percent!==lastPercent){lastPercent=percent;progress.setAttribute("aria-valuenow",String(percent));}
  }
  function settle(d){
    if(d.settled)return;
    d.settled=true;d.phase=d.end;d.digit.textContent=String(d.end);
    d.wheel.classList.add("is-settled");d.wheel.classList.remove("is-spinning");
    if(renderer && drawingStarted)d.wheel.classList.add("is-rendered");
  }
  function finish(){
    if(finished)return;
    finished=true;cancelAnimationFrame(frame);
    drums.forEach(settle);
    if(renderer && drawingStarted){
      renderer.clear();drums.forEach(d=>renderer.draw(d,d.end,0,1,0,1));
      if(renderer.gpu&&mobile){
        // Copy the final composited frame while the GL drawing buffer is valid.
        // Release GPU resources before starting the signature.
        const still=canvas.cloneNode(false);
        still.width=canvas.width;still.height=canvas.height;
        const ctx=still.getContext("2d");
        if(ctx){ctx.drawImage(canvas,0,0);canvas.replaceWith(still);canvas=still;}
        renderer.dispose();renderer=null;
      }
    }
    // Persist the exact end value before releasing the compositor animation.
    if(progressMotion){fill.style.transform="scaleX(1)";progressMotion.cancel();progressMotion=null;}
    updateProgress(totalDuration);label.textContent="2026";
    root.classList.add("loading-complete");
    document.dispatchEvent(new Event("loading-complete"));
  }
  // Match the existing CSS ease-out exactly.
  function entranceEase(t){
    if(t<=0||t>=1)return t;
    const bez=(u,a,b)=>3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u;
    let lo=0,hi=1;
    for(let i=0;i<16;i++){
      const u=(lo+hi)/2;
      if(bez(u,.22,.36)<t)lo=u;else hi=u;
    }
    return bez((lo+hi)/2,1,1);
  }
  // Continuous angular velocity and acceleration, exact landing without bounce.
  function motion(t,duration,steps){
    const speed=steps/(duration-(acceleration+braking)/2);
    if(t<acceleration){
      const q=clamp(t/acceleration);
      return {p:speed*acceleration*(q-Math.sin(Math.PI*q)/Math.PI)/2,
        v:speed*(1-Math.cos(Math.PI*q))/2};
    }
    if(t<duration-braking)return {p:speed*(t-acceleration/2),v:speed};
    const q=clamp((duration-t)/braking);
    return {p:steps-speed*braking*(q-Math.sin(Math.PI*q)/Math.PI)/2,
      v:speed*(1-Math.cos(Math.PI*q))/2};
  }
  function render(now){
    if(finished)return;
    const gap=now-lastRender;
    if(mobile&&gap<14.5){frame=requestAnimationFrame(render);return;}
    if(mobile&&spinStarted&&!loweredResolution&&Number.isFinite(gap)){
      slowFrames=gap>24?slowFrames+1:Math.max(0,slowFrames-1);
      if(slowFrames>=5){pixelRatioCap=1;loweredResolution=true;needsResize=true;}
    }
    lastRender=now;
    if(startedAt===null){
      startedAt=now;root.classList.add("loading-ready");
      // Predetermined linear progress belongs to the compositor; the
      // cylinder alone needs per-frame rendering for its curved texture.
      if(typeof fill.animate==="function"){
        try{
          progressMotion=fill.animate([{transform:"scaleX(0)"},{transform:"scaleX(1)"}],
            {duration:totalDuration,easing:"linear",fill:"forwards"});
          progressMotion.startTime=now;
        }catch{progressMotion?.cancel();progressMotion=null;}
      }
    }
    updateProgress(now-startedAt);
    const elapsed=now-startedAt-initialHold;
    if(needsResize)resize();
    if(renderer && !drawingStarted){
      drawingStarted=true;
      for(const d of drums)d.wheel.classList.add("is-rendered");
    }
    renderer?.clear();
    if(elapsed<0){
      // Keep the same texture and projection from the first frame to the last.
      if(renderer){
        for(const d of drums){
          const t=clamp((now-startedAt-entrance.delay-entrance.offsets[d.index])/entrance.duration);
          if(t<=0)continue;
          const eased=entranceEase(t);
          renderer.draw(d,d.start,0,eased,(1-eased)*1.1,1);
        }
      }
    }else{
      if(!spinStarted){
        spinStarted=true;
        document.dispatchEvent(new Event("loading-spin-start"));
      }
      for(const d of drums){
        if(!d.settled && elapsed>=d.duration)settle(d);
        if(d.settled){if(renderer)renderer.draw(d,d.end,0,1,0,1);continue;}
        const m=motion(elapsed,d.duration,d.steps);
        const remaining=clamp((d.steps-m.p)/.4);
        const landing=1-remaining*remaining*(3-2*remaining);
        const reveal=clamp(elapsed/acceleration);
        const opening=1-reveal*reveal*(3-2*reveal);
        // Gray neighbors emerge with the spin, not with a hard state change.
        const isolation=Math.max(landing,opening);
        if(renderer)renderer.draw(d,d.start+m.p,m.v,1,0,isolation);
      }
      if(drums.every(d=>d.settled)){finish();return;}
    }
    frame=requestAnimationFrame(render);
  }

  // Release the counter's frame loop and listeners when the orchestrator
  // removes the loading overlay, including watchdog and reduced-motion exits.
  const lifetime = new AbortController();
  document.addEventListener("intro-dismissed",()=>{
    finished=true;
    cancelAnimationFrame(frame);
    progressMotion?.cancel();
    progressMotion=null;
    renderer?.dispose?.();renderer=null;
    canvas.width=canvas.height=1;
    lifetime.abort();
  },{once:true});
  if(reduced.matches){finish();return;}
  canvas.addEventListener("webglcontextlost",event=>{
    event.preventDefault();
    renderer=null;drawingStarted=false;
    for(const d of drums){d.wheel.classList.remove("is-rendered","is-spinning");d.digit.textContent=String(d.end);}
    finish();
  },{once:true});
  reduced.addEventListener?.("change",()=>{
    if(!reduced.matches)return;
    renderer?.clear();renderer?.dispose?.();renderer=null;drawingStarted=false;
    for(const d of drums)d.wheel.classList.remove("is-rendered","is-spinning");
    finish();
  },{signal:lifetime.signal});
  addEventListener("resize",()=>{
    if(!finished)needsResize=true;
    else if(!mobile&&renderer&&drawingStarted){resize();renderer.clear();drums.forEach(d=>renderer.draw(d,d.end,0,1,0,1));}
  },{passive:true,signal:lifetime.signal});
  function launch(){
    if(launched||finished)return;
    launched=true;
    try{
      const atlas=makeAtlas();
      try{renderer=webGLRenderer(atlas);}catch{
        const replacement=canvas.cloneNode(false);
        canvas.replaceWith(replacement);canvas=replacement;
      }
      if(!renderer)renderer=cpuRenderer(atlas);
    }catch{renderer=null;}
    frame=requestAnimationFrame(render);
  }
  setTimeout(launch,1200);
  if(document.fonts?.ready)document.fonts.ready.then(launch,launch);else launch();
})();
