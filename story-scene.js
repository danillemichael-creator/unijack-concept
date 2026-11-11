import * as THREE from 'three';
import { buildDetailedModel } from './detailed-model.js';
import { setupStudioEnvironment } from './material-finish.js';
import { mercuryInsertionPose, STORY, span, easeInOut, easeOut, frameDelta } from './motion.js';

// One renderer for the whole UniJack story. Story progress (0–1) sets every
// pose; the assembly controls can temporarily override it. Frames are drawn
// only while something is changing.
const MM = .05; // Authored millimetres to scene units.
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
const EXPLODE = {mercury:V(0,46,-4), peri:V(30,20,0), components:12};
// Exits are lateral so they read as leaving frame in the top-down view.
const LEAVE = {mercury:V(-190,40,-150), peri:V(200,30,40)};
const BOARD_LAYER = /^(FR4 cut edge|Teal solder mask|Photographic solder mask and silkscreen)$/;
const lerp = THREE.MathUtils.lerp;
function lerpAngle(a,b,t){let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return a+d*t;}

function contactShadow(){
 const size=256,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d'),g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
 g.addColorStop(0,'rgba(0,0,0,.62)');g.addColorStop(.55,'rgba(0,0,0,.28)');g.addColorStop(1,'rgba(0,0,0,0)');
 ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
 const texture=new THREE.CanvasTexture(canvas);
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,color:'#000'}));
 mesh.rotation.x=-Math.PI/2;mesh.renderOrder=-1;return mesh;
}

export async function createStoryScene(host,{lite=false,instant=false,onFrame=()=>{}}={}){
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:lite?'low-power':'high-performance'});
 const source=await buildDetailedModel();
 const maxRatio=lite?1.5:1.75;
 renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
 renderer.shadowMap.enabled=!lite;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');canvas.className='stage-webgl';
 host.prepend(canvas);

 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(30,1,.1,120);
 const disposeEnvironment=setupStudioEnvironment(scene,renderer);scene.environmentIntensity=.78;
 scene.add(new THREE.HemisphereLight('#dfe8ef','#0b1726',.34));
 const key=new THREE.DirectionalLight('#f5f8fb',2.05);key.position.set(-5,7,-3);
 if(!lite){key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-7,right:7,top:6,bottom:-6,near:.5,far:30});key.shadow.bias=-.00008;key.shadow.normalBias=.004;key.shadow.radius=2.5;}
 const fill=new THREE.DirectionalLight('#cfdcea',.55);fill.position.set(4.5,3,5);
 const under=new THREE.DirectionalLight('#dfe5eb',.32);under.position.set(-2.5,-5,2);
 // Brand rim: cyan from behind the board, strongest while the layers separate.
 const rim=new THREE.DirectionalLight('#74e2f4',.5);rim.position.set(6,2.2,-7);
 scene.add(key,fill,under,rim);

 const root=source.root;root.scale.setScalar(MM);scene.add(root);
 const base=root.getObjectByName('UniJack_baseboard'),mercury=root.getObjectByName('Mercury_module'),peri=root.getObjectByName('PeriBoard');
 const components=new THREE.Group();components.name='UniJack component layer';
 for(const mesh of [...base.children])if(!BOARD_LAYER.test(mesh.name))components.add(mesh);
 base.add(components);
 const rest={mercury:source.rest.mercury.clone(),peri:source.rest.peri.clone()};
 const shadow=contactShadow();scene.add(shadow);

 // Bounds for the key poses, measured once at rest and once fully exploded.
 function applyParts(m,pe,lift,tilt){
  mercury.position.copy(m);peri.position.copy(pe);components.position.y=lift;mercury.rotation.z=tilt;root.updateMatrixWorld(true);
 }
 applyParts(rest.mercury,rest.peri,0,0);
 const boxes={all:new THREE.Box3().setFromObject(root),base:new THREE.Box3().setFromObject(base),
  mercury:new THREE.Box3().setFromObject(mercury),peri:new THREE.Box3().setFromObject(peri)};
 applyParts(rest.mercury.clone().add(EXPLODE.mercury),rest.peri.clone().add(EXPLODE.peri),lite?0:EXPLODE.components,-.1);
 boxes.exploded=new THREE.Box3().setFromObject(root);
 applyParts(rest.mercury,rest.peri,0,0);
 const footprint=boxes.all.getSize(new THREE.Vector3());
 shadow.scale.set(footprint.x*1.25,footprint.z*1.7,1);shadow.position.set(boxes.all.getCenter(new THREE.Vector3()).x,boxes.all.min.y-.02,0);

 const fov=THREE.MathUtils.degToRad(camera.fov);
 // Coverage is a share of the canvas: cw horizontally, ch vertically.
 function fit(box,az,el,cw,ch=cw){
  const center=box.getCenter(new THREE.Vector3()),back=V(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
  let right=V(0,1,0).cross(back);if(right.lengthSq()<1e-8)right.set(1,0,0);right.normalize();
  const up=back.clone().cross(right),tan=Math.tan(fov/2);let distance=0;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
   const v=V(x,y,z).sub(center),depth=v.dot(back);
   distance=Math.max(distance,depth+Math.abs(v.dot(right))/(tan*camera.aspect*cw),depth+Math.abs(v.dot(up))/(tan*ch));
  }
  return {target:center,az,el,distance};
 }
 const az0=Math.atan2(-120,174),el0=Math.asin(147/Math.hypot(120,147,174)),yaw=THREE.MathUtils.degToRad(25);
 let keys={};
 // The board is the hero: ~80% of the width (max ~1200px) on desktop, nearly
 // full width on phones, inside the region below the text band (frame).
 const frameBox={top:0,bottom:0,hero:0};let steadyDy=0,regionRatio=1;
 function layoutKeys(){
  const W=canvas.clientWidth||1,H=canvas.clientHeight||1,region=Math.max(H*.3,H-frameBox.top-frameBox.bottom);
  const cw=lite?.94:Math.min(.8,1200/W),ch=region/H*.96;
  steadyDy=frameBox.top+region/2-H/2;regionRatio=Math.min(1,region/H);
  keys={
   k0:fit(boxes.all,az0,el0,cw,ch),k0b:fit(boxes.all,az0+yaw,el0-.03,cw,ch),
   k1:fit(boxes.exploded,az0+yaw+.16,el0+.07,cw,ch),
   k3:fit(boxes.base,0,THREE.MathUtils.degToRad(88.5),cw*.78,ch*.86)
  };
 }
 // Vertical framing without changing perspective: shift the projection.
 let appliedDy=NaN;
 function applyOffset(dy){
  if(Math.abs(dy-appliedDy)<.25)return;appliedDy=dy;
  const W=canvas.clientWidth||1,H=canvas.clientHeight||1;camera.setViewOffset(W,H,0,-dy,W,H);
 }
 function blendCam(a,b,t){return {target:a.target.clone().lerp(b.target,t),az:lerpAngle(a.az,b.az,t),el:lerp(a.el,b.el,t),distance:lerp(a.distance,b.distance,t)};}
 function storyCamera(p){
  if(p<=STORY.yaw[1])return blendCam(keys.k0,keys.k0b,easeInOut(span(p,STORY.yaw)));
  if(p<=STORY.pull[1])return blendCam(keys.k0b,keys.k1,easeInOut(span(p,STORY.pull)));
  if(lite)return keys.k1;
  return blendCam(keys.k1,keys.k3,easeInOut(span(p,STORY.topDown)));
 }
 // Assembly-control views reuse the reviewed framing of the previous explorer.
 function overrideCamera(o){
  if(o.inspection==='ports'||o.inspection==='chips'){
   const box=o.inspection==='ports'?new THREE.Box3(V(-87,0,-37),V(-48,16,40)):new THREE.Box3(V(-30,0,-32),V(44,9,34));
   box.min.multiplyScalar(MM);box.max.multiplyScalar(MM);
   const d=o.inspection==='ports'?V(-61,48,69):V(-48,76,90);
   return fit(box,Math.atan2(d.x,d.z),Math.asin(d.y/d.length()),.65,.65*regionRatio);
  }
  if(o.inspection==='underside'){const d=V(-15,-95,65);return fit(boxes.mercury,Math.atan2(d.x,d.z),Math.asin(d.y/d.length()),.68,.68*regionRatio);}
  const c=o.focus==='all'?.7:.74;return fit(boxes[o.focus]||boxes.all,az0+yaw,el0,c,c*regionRatio);
 }

 const state={p:0,target:0,override:null,weight:0,weightTarget:0,dragYaw:0,dragPitch:0,yawVelocity:0,idle:!lite&&!instant,paused:false,active:true,time:0,intro:instant?1:0,introStart:0};
 const INTRO_MS=800;
 let frame=0,last=0,shadowDirty=true;
 const out={labels:[{name:'UniJack',x:0,y:0,o:0},{name:'Mercury',x:0,y:0,o:0},{name:'PeriBoard',x:0,y:0,o:0}],baseRect:null,progress:0};
 const tmp=new THREE.Vector3(),mTarget=new THREE.Vector3(),pTarget=new THREE.Vector3();

 function pose(){
  const p=state.p,o=state.override;
  const periT=easeInOut(span(p,STORY.peri)),mercT=easeInOut(span(p,STORY.mercury));
  const compT=lite?0:easeInOut(span(p,STORY.components))*(1-easeInOut(span(p,STORY.settle)));
  const leaveT=lite?0:easeInOut(span(p,STORY.leave));
  mTarget.copy(rest.mercury).addScaledVector(EXPLODE.mercury,mercT).addScaledVector(LEAVE.mercury,leaveT);
  pTarget.copy(rest.peri).addScaledVector(EXPLODE.peri,periT).addScaledVector(LEAVE.peri,leaveT);
  let tilt=-.1*mercT,lift=EXPLODE.components*compT;
  let cam=storyCamera(p);
  const w=state.weight;
  if(o&&w>0){
   const ins=mercuryInsertionPose(o.insertion??1);
   const om=rest.mercury.clone();om.x+=ins.x;om.y+=ins.y;
   mTarget.lerp(om,w);pTarget.lerp(rest.peri,w);tilt=lerp(tilt,ins.angle,w);lift=lerp(lift,0,w);
   cam=blendCam(cam,overrideCamera(o),easeInOut(w));
  }
  const showAll=!o||o.focus==='all'||w<.02;
  for(const [name,part] of [['base',base],['mercury',mercury],['peri',peri]])part.visible=showAll||o.focus===name;
  if(!mercury.position.equals(mTarget)||!peri.position.equals(pTarget)||components.position.y!==lift||mercury.rotation.z!==tilt)shadowDirty=true;
  mercury.position.copy(mTarget);peri.position.copy(pTarget);components.position.y=lift;mercury.rotation.z=tilt;
  shadow.material.opacity=(1-span(p,STORY.topDown))*.9;shadow.visible=shadow.material.opacity>.01&&showAll;
  // Camera: story key + drag offset + a small idle drift at the top of the page.
  const idle=state.idle&&!state.paused?Math.sin(state.time*.32)*.1*(1-span(p,[0,.08])):0;
  const el=THREE.MathUtils.clamp(cam.el+state.dragPitch,-.2,1.545);
  const az=cam.az+state.dragYaw+idle;
  // Reveal: the board rises and scales up into place; at the top of the page
  // it sits a little lower and lifts as the hero text leaves.
  const e=easeOut(state.intro),Hc=canvas.clientHeight||1;
  const heroT=1-easeInOut(span(p,STORY.yaw));
  const heroDrop=Math.max(0,frameBox.hero-frameBox.top)*.62*heroT;
  applyOffset(steadyDy+heroDrop+Hc*.14*(1-e));
  const distance=cam.distance*(1+.32*(1-e)+(frameBox.hero>frameBox.top?.18*heroT:0));
  camera.position.set(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)).multiplyScalar(distance).add(cam.target);
  camera.up.set(0,1,0);camera.lookAt(cam.target);
  const explodeT=Math.max(periT,mercT);
  rim.intensity=.5+1.4*explodeT*(1-leaveT);
  renderer.toneMappingExposure=.92-.5*span(p,STORY.dim);
  // Leader-label anchors, in canvas pixels.
  const W=canvas.clientWidth,H=canvas.clientHeight;camera.updateMatrixWorld();
  const labelFade=explodeT*(1-Math.max(leaveT,span(p,[STORY.hold[1],STORY.leave[0]+.04])))*(1-w);
  [[base,boxes.base,0],[mercury,boxes.mercury,1],[peri,boxes.peri,2]].forEach(([part,box,i])=>{
   const c=box.getCenter(tmp);c.y=box.max.y;
   if(i>0){c.sub(i===1?rest.mercury.clone().multiplyScalar(MM):rest.peri.clone().multiplyScalar(MM)).add(part.position.clone().multiplyScalar(MM));c.y+=.25;}
   else c.y+=lift*MM+.1;
   c.project(camera);const label=out.labels[i];label.x=(c.x*.5+.5)*W;label.y=(-c.y*.5+.5)*H;label.o=labelFade*(i===0?span(p,STORY.components):1);
  });
  out.progress=p;out.intro=e;
 }
 function baseRectAtTopDown(){
  // Where the base board lands on screen in the top-down key: the schematic
  // overlay is registered to this rectangle.
  const saved=camera.position.clone(),k=keys.k3,b=boxes.base;applyOffset(steadyDy);
  camera.position.set(Math.sin(k.az)*Math.cos(k.el),Math.sin(k.el),Math.cos(k.az)*Math.cos(k.el)).multiplyScalar(k.distance).add(k.target);camera.lookAt(k.target);camera.updateMatrixWorld();
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;const W=canvas.clientWidth,H=canvas.clientHeight;
  for(const x of [b.min.x,b.max.x])for(const z of [b.min.z,b.max.z]){tmp.set(x,b.max.y,z).project(camera);const sx=(tmp.x*.5+.5)*W,sy=(-tmp.y*.5+.5)*H;minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);}
  camera.position.copy(saved);return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
 }

 function render(){
  pose();
  if(shadowDirty&&renderer.shadowMap.enabled){renderer.shadowMap.needsUpdate=true;shadowDirty=false;}
  renderer.render(scene,camera);
  canvas.dataset.frames=String(Number(canvas.dataset.frames||0)+1);
  onFrame(out);
 }
 function moving(){
  return state.intro<1||Math.abs(state.target-state.p)>1e-5||Math.abs(state.weightTarget-state.weight)>1e-4||Math.abs(state.yawVelocity)>1e-5||(state.idle&&!state.paused&&state.p<.08);
 }
 function tick(now){
  frame=0;if(!state.active)return;
  const dt=frameDelta(now,last);last=now;state.time+=dt;
  // Step the reveal per frame (capped) so a slow first frame cannot skip it.
  if(state.intro<1)state.intro=Math.min(1,state.intro+Math.min(dt,1/30)*1000/INTRO_MS);
  // Light smoothing (~33ms time constant): the board never trails the scrollbar.
  const k=instant?1:1-Math.exp(-30*dt);
  state.p+=(state.target-state.p)*k;if(Math.abs(state.target-state.p)<1e-5)state.p=state.target;
  const kw=instant?1:1-Math.exp(-9*dt);
  state.weight+=(state.weightTarget-state.weight)*kw;if(Math.abs(state.weightTarget-state.weight)<1e-4)state.weight=state.weightTarget;
  if(state.weight===0&&state.weightTarget===0)state.override=null;
  if(!dragging){state.dragYaw+=state.yawVelocity*dt;state.yawVelocity*=Math.exp(-5*dt);if(Math.abs(state.yawVelocity)<1e-4)state.yawVelocity=0;}
  render();
  if(moving()||dragging)request();
 }
 function request(){if(!frame&&state.active){if(!last)last=performance.now();frame=requestAnimationFrame(tick);}}

 // Horizontal drag turns the board; vertical gestures keep scrolling the page.
 let dragging=false,lastX=0,lastY=0,lastT=0;
 canvas.style.touchAction='pan-y';
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragging=true;lastX=e.clientX;lastY=e.clientY;lastT=e.timeStamp;state.yawVelocity=0;canvas.setPointerCapture(e.pointerId);host.dataset.dragging='true';request();});
 canvas.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY,dt=Math.max(1,e.timeStamp-lastT)/1000;
  state.dragYaw-=dx*.006;if(e.pointerType==='mouse')state.dragPitch=THREE.MathUtils.clamp(state.dragPitch+dy*.004,-.5,.45);
  state.yawVelocity=-dx*.006/dt*.35;lastX=e.clientX;lastY=e.clientY;lastT=e.timeStamp;request();});
 const endDrag=()=>{if(!dragging)return;dragging=false;host.dataset.dragging='false';request();};
 canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);

 function resize(){
  const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
  const ratio=Math.min(window.devicePixelRatio||1,maxRatio,Math.sqrt(3.2e6/(w*h)));
  renderer.setPixelRatio(Math.max(1,ratio));renderer.setSize(w,h,false);
  camera.aspect=w/h;appliedDy=NaN;camera.updateProjectionMatrix();layoutKeys();out.baseRect=baseRectAtTopDown();shadowDirty=true;render();
 }
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
 resize();
 // Warm-up while the canvas is still invisible: draw the exploded and
 // top-down poses once so no shader or shadow pass compiles mid-scroll.
 if(!instant){for(const p of [.42,.8,0]){state.p=state.target=p;shadowDirty=true;render();}}
 host.dataset.webgl='ready';host.classList.add('ready');
 Object.assign(canvas.dataset,{triangles:String(source.stats.triangles),materialBatches:String(source.stats.materialBatches)});

 return {
  canvas,
  setProgress(value){state.target=Math.min(1,Math.max(0,value));if(instant)state.p=state.target;request();},
  setOverride(o){
   if(o){state.override={focus:'all',inspection:'overview',insertion:1,...o};state.weightTarget=1;}
   else state.weightTarget=0;
   request();
  },
  hasOverride:()=>state.weightTarget>0,
  setFrame(top,bottom,hero=0){if(frameBox.top===top&&frameBox.bottom===bottom&&frameBox.hero===hero)return;frameBox.top=top;frameBox.bottom=bottom;frameBox.hero=hero;layoutKeys();out.baseRect=baseRectAtTopDown();request();},
  setPaused(value){state.paused=value;last=0;request();},
  setActive(value){state.active=value;if(value){last=0;request();}else{cancelAnimationFrame(frame);frame=0;}},
  resetView(){state.dragYaw=0;state.dragPitch=0;state.yawVelocity=0;request();},
  dock(element){if(canvas.parentElement===element)return;resizeObserver.unobserve(host);host=element;element.prepend(canvas);resizeObserver.observe(host);resize();},
  snapshot(){render();return canvas.toDataURL('image/webp',.9);},
  getState:()=>({progress:state.p,target:state.target,override:state.override,weight:state.weight,paused:state.paused,drawCalls:renderer.info.render.calls}),
  dispose(){cancelAnimationFrame(frame);resizeObserver.disconnect();disposeEnvironment();renderer.dispose();canvas.remove();}
 };
}
