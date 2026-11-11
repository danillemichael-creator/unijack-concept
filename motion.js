// A requestAnimationFrame timestamp can precede a synchronous performance.now().
export function frameDelta(now, last) {
 if (!Number.isFinite(now) || !Number.isFinite(last) || !last) return 1 / 60;
 return Math.max(0, Math.min((now - last) / 1000, .05));
}
export function cyclePosition(value) { return ((value % 1) + 1) % 1; }

// Choreography for the illustrative Mercury assembly view. Keeping it outside
// the renderer means the loop's endpoints and cycle boundary stay testable.
export const INSERTION_LOOP_MS = 7200;
export function insertionLoopAt(elapsedMs) {
 const time=Math.max(0,elapsedMs)%INSERTION_LOOP_MS;
 const smooth=value=>value*value*(3-2*value);
 if(time<1000)return {value:1,phase:'connected'};
 if(time<2600)return {value:1-smooth((time-1000)/1600),phase:'separating'};
 if(time<3200)return {value:0,phase:'separate'};
 if(time<5600)return {value:smooth((time-3200)/2400),phase:'inserting'};
 return {value:1,phase:'connected'};
}

// An illustrative card-edge sequence: approach while tilted, then lower about
// the contact edge. This is presentation choreography, not measured socket travel.
export function mercuryInsertionPose(amount,edgeX=-17.5,edgeY=.7){
 const value=Math.max(0,Math.min(1,amount));
 const smooth=t=>t*t*(3-2*t);
 const approach=smooth(Math.min(1,value/.7));
 const angle=.32*(1-smooth(Math.max(0,(value-.7)/.3)));
 return {angle,x:24*(1-approach)+edgeX*(1-Math.cos(angle))+edgeY*Math.sin(angle),
  y:14*(1-approach)+edgeY*(1-Math.cos(angle))-edgeX*Math.sin(angle)};
}

// Scroll story timeline. Every value is a fraction of story progress (0–1),
// so the scene, labels and schematic all read from one clock and reverse
// cleanly when the visitor scrolls back up.
export const STORY = {
 yaw:[0,.15],
 // The explode reads as one movement: all parts start within a few percent.
 peri:[.15,.39], mercury:[.165,.405], components:[.18,.42], pull:[.15,.45],
 hold:[.45,.55],
 leave:[.55,.66], settle:[.55,.65], topDown:[.56,.72],
 dim:[.70,.84], schematic:[.72,.82],
 draw:{route:[.76,.87], cross:[.79,.9], loopback:[.82,.93], fanout:[.85,.96], logic:[.88,.99]}
};
export const clamp01=value=>Math.min(1,Math.max(0,value));
export const span=(progress,[from,to])=>clamp01((progress-from)/(to-from));

// CSS cubic-bezier() evaluated in JS so scrubbed motion uses the same curves
// as the stylesheet tokens (--ease-in-out, --ease-out).
export function cubicBezier(x1,y1,x2,y2){
 const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
 const sampleX=t=>((ax*t+bx)*t+cx)*t,sampleY=t=>((ay*t+by)*t+cy)*t,slope=t=>(3*ax*t+2*bx)*t+cx;
 return x=>{
  if(x<=0)return 0;if(x>=1)return 1;
  let t=x;
  for(let i=0;i<8;i++){const error=sampleX(t)-x,d=slope(t);if(Math.abs(error)<1e-6||Math.abs(d)<1e-6)break;t-=error/d;}
  if(t<0||t>1||Math.abs(sampleX(t)-x)>1e-4){let lo=0,hi=1;t=x;for(let i=0;i<30;i++){if(sampleX(t)<x)lo=t;else hi=t;t=(lo+hi)/2;}}
  return sampleY(t);
 };
}
export const easeInOut=cubicBezier(.77,0,.175,1);
export const easeOut=cubicBezier(.23,1,.32,1);
