/* The reading room's living photo: the founder's render of the hall, with every reader cut out of it and brought back to life
   by warping the photo itself (never drawn over). Readers appear in the chairs that are taken and breathe, read along the lines,
   blink, shift in their chairs and turn pages; the room has sun and dust by day, lamps and a fire at night, and steam over the tea.
   Ported from the prototype (prototypes/reading-room/index.html), where every number here was measured and checked. */
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const seg=(p,a,b)=>clamp((p-a)/(b-a));
const lerp=(a,b,t)=>a+(b-a)*t;
const eio=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const rng=seed=>{let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}};

/* the shader draws up to NS readers at once, NP of them turning pages, with NE eyes that blink; the pages texture holds NT page tiles */
const NS=12,NP=5,NE=8,NT=10;
const VS=`attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;
const RAYS_FS=`precision highp float;varying vec2 vUv;uniform sampler2D uImg;uniform vec2 uSun;uniform float uAR;
void main(){vec2 uv=vUv;vec2 d=(uv-uSun)/56.;vec2 s=uv;vec3 acc=vec3(0.);float w=1.;
 for(int i=0;i<56;i++){s-=d;vec3 c=texture2D(uImg,s).rgb;float l=dot(c,vec3(.299,.587,.114));
  float near=smoothstep(.36,.1,length((s-uSun)*vec2(uAR,1.)));
  acc+=c*smoothstep(.62,.95,l)*near*w;w*=.972;}
 gl_FragColor=vec4(acc/56.*2.2,1.);}`;
const MAIN_FS=`precision highp float;varying vec2 vUv;
uniform sampler2D uImg;uniform sampler2D uRay;uniform vec2 uRes;uniform vec2 uOff;uniform vec2 uSize;uniform vec2 uPar;uniform float uTime;uniform float uWake;uniform float uNight;uniform float uRayK;
uniform vec4 uWin;uniform vec3 uFire;uniform vec4 uFireBox;uniform vec4 uLamp[24];uniform int uNL;uniform vec4 uSway[6];uniform float uLoaded;uniform sampler2D uWith;uniform sampler2D uMask;uniform sampler2D uRig;uniform sampler2D uSoft;uniform sampler2D uPages;
uniform vec4 uS[${NS*8}];uniform vec4 uPg[${NP*7}];uniform vec4 uEye[${NE}];uniform vec4 uLid[${NE}];uniform vec4 uCup[8];
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 aff(vec4 m,vec2 t,vec2 p){return vec2(m.x*p.x+m.y*p.y,m.z*p.x+m.w*p.y)+t;}
/* every reader comes from the same render of the hall */
vec3 photo(vec2 s,float id){return texture2D(uWith,s).rgb;}
/* the reader's own pixel at s: its colour, and its coverage only where the mask belongs to this reader */
vec4 person(vec2 s,float id){vec3 mk=texture2D(uMask,s).rgb;return vec4(photo(s,id),mk.r*(1.-step(.04,abs(mk.g*25.5-id))));}
/* a blink: the upper lid comes down over the eye. Its skin takes the colour of the skin at the crease and under the eye,
   and the lash line travels down with the lid's edge, column by column */
vec3 lid(vec2 s,vec3 col,vec4 E,vec4 L,float w,float id){
 if(w<.002||E.z<=0.)return col;
 float x=(s.x-E.x)/E.z,ax=abs(x);if(ax>=1.)return col;
 float pr=1.-ax*ax,yc=E.y+E.w*x,top=yc-L.x*pr,bot=yc+L.y*pr,lt=L.z*(.4+.6*pr);
 float L0=mix(top-lt,yc-(L.x+L.z)*sqrt(pr)-.0002,smoothstep(0.,.3,w));
 float M=mix(top,bot+.15*L.z*pr,w),y0=M-lt;
 if(s.y<L0||s.y>M)return col;
 if(s.y>=y0)return photo(vec2(s.x,top-lt+s.y-y0),id);
 float by=bot+.001+L.y*.2*pr,dx=E.z*.35,k=(s.y-L0)/max(y0-L0,1e-6);
 vec3 a=photo(vec2(s.x,L0-.0003),id),b=(photo(vec2(s.x-dx,by),id)+2.*photo(vec2(s.x,by),id)+photo(vec2(s.x+dx,by),id))*.25;
 return mix(a,b,smoothstep(0.,.55,k))*(1.-.08*smoothstep(.55,1.,k));
}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 px=vec2(vUv.x*uRes.x,(1.-vUv.y)*uRes.y);
 vec2 uv=(px-uOff)/uSize;
 float depth=mix(.2,1.,smoothstep(0.,1.,uv.y));
 uv-=uPar*depth/uSize;
 vec2 uv0=uv;float ar=uSize.x/uSize.y;
 float sw=0.;for(int i=0;i<6;i++){vec4 m=uSway[i];if(m.z<=0.)continue;sw+=smoothstep(1.,.25,length((uv-m.xy)/m.zw));}
 uv.x+=sin(uTime*1.15+uv.y*16.)*.0012*sw+sin(uTime*.6+uv.y*5.)*.0006*sw;
 uv.y+=cos(uTime*.9+uv.x*12.)*.0007*sw;
 vec3 c=texture2D(uImg,clamp(uv,0.,1.)).rgb;
 float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
 c=mix(vec3(.09,.045,.025),c,inside*uLoaded);
 /* the fire: the photo's own flames flicker and sway in the heat, new tongues rise, the palm leaves stay in front */
 vec4 FB=uFireBox;
 float inF=smoothstep(FB.x,FB.x+.02,uv0.x)*smoothstep(FB.z,FB.z-.02,uv0.x)*smoothstep(FB.y,FB.y+.035,uv0.y)*smoothstep(FB.w,FB.w-.035,uv0.y)*uFire.z*inside;
 if(inF>.001){
  vec2 fl=(uv0-FB.xy)/(FB.zw-FB.xy);float up=1.-fl.y;
  vec2 wob=vec2(fbm(vec2(fl.x*6.,fl.y*5.+uTime*2.6))-.5,fbm(vec2(fl.x*5.+7.,fl.y*4.+uTime*2.1))-.5)*vec2(.007,.01)*inF;
  vec3 c2=texture2D(uImg,uv0+wob).rgb;float l2=dot(c2,vec3(.299,.587,.114));
  /* only the flames themselves: bright and hot, not the lamplit wall around them in the evening renders */
  float flamePix=smoothstep(.45,.85,l2)*smoothstep(.06,.18,c2.r-c2.b);
  float fk=.65+.7*fbm(vec2(fl.x*4.,fl.y*3.+uTime*2.4));
  c=mix(c,c2*fk*vec3(1.15,1.,.8),flamePix*inF);
  float n=fbm(vec2(fl.x*3.4,up*2.6-uTime*2.)+vec2(0.,fbm(vec2(fl.x*2.2,uTime*.7))*.8));
  float tongue=smoothstep(0.,.32,n*1.4-up*1.08+.1)*smoothstep(0.,.3,fl.x)*smoothstep(1.,.7,fl.x)*smoothstep(0.,.18,fl.y);
  float notLeaf=smoothstep(.03,-.03,c.g-c.r);
  vec3 fc=mix(vec3(.85,.22,.04),vec3(1.,.82,.45),smoothstep(.25,.9,tongue));
  c+=fc*tongue*notLeaf*inF*mix(.6,.3,uNight);
 }
 /* the readers appear from the rendered photo when their seat is taken. Torso, head, book and the hand that turns pages each move
    as a whole and pull the pixels around them softly, so outlines move too and the empty chair shows where a reader leans away */
 for(int i=0;i<${NS};i++){
  vec4 S6=uS[i*8+6];float vis=S6.w*inside*uLoaded;vec4 bx=uS[i*8];
  if(vis<.002||uv0.x<bx.x||uv0.x>bx.z||uv0.y<bx.y||uv0.y>bx.w)continue;
  float id=S6.z;vec2 p=uv0;vec4 S3=uS[i*8+3],S4=uS[i*8+4];
  vec2 pT=aff(uS[i*8+2],S3.xy,p),pH=aff(vec4(S3.zw,S4.xy),S4.zw,p),pB=aff(uS[i*8+5],S6.xy,p),pW=pB;
  /* this reader's pages and the hand that turns them, when they have them */
  vec4 PS=vec4(0.),PR=vec4(0.),PU=vec4(0.),PT=vec4(-1.),PC=vec4(1.,1.,1.,-1.);
  for(int k=0;k<${NP};k++){vec4 q3=uPg[k*7+3];if(abs(q3.w-float(i))>.5)continue;
   PS=uPg[k*7];PR=uPg[k*7+1];PU=uPg[k*7+2];PT=q3;PC=uPg[k*7+4];vec4 w6=uPg[k*7+6];if(w6.z>.5)pW=aff(uPg[k*7+5],w6.xy,p);}
  vec4 To=uS[i*8+1];
  vec2 s=mix(p,pT,smoothstep(1.,.4,length((p-To.xy)/To.zw)));
  vec3 sw=texture2D(uSoft,s).rgb;
  s=mix(s,pH,sw.r);s=mix(s,pB,sw.g);s=mix(s,pW,sw.b);
  vec4 q=person(s,id);c=mix(c,q.rgb,q.a*vis);
  /* the book with the hands holding it, crisp and whole */
  vec3 rB=texture2D(uRig,pB).rgb;
  if(rB.g>.002){q=person(pB,id);c=mix(c,q.rgb,q.a*rB.g*vis);}
  if(PU.w>.5){
   vec2 S0=PS.xy,d=PS.zw,R=PR.xy,L=PR.zw,Up=PU.xy,qb=pB-S0;
   float crR=d.x*R.y-d.y*R.x,crL=d.x*L.y-d.y*L.x;
   float aR=(qb.x*R.y-qb.y*R.x)/crR,bR=(d.x*qb.y-d.y*qb.x)/crR,aL=(qb.x*L.y-qb.y*L.x)/crL,bL=(d.x*qb.y-d.y*qb.x)/crL;
   bool onR=aR>0.&&aR<1.&&bR>0.&&bR<1.,onL=aL>0.&&aL<1.&&bL>0.&&bL<1.;
   /* the clean page under the thumb, seen once the hand lifts off it */
   if(PC.w>=0.&&rB.b>.002&&onR)c=mix(c,texture2D(uPages,vec2((PC.w+clamp(bR,.02,.97))/${NT}.,.5+clamp(aR,.01,.99)*.5)).rgb,rB.b*vis*smoothstep(.95,.9,aR)*smoothstep(.99,.95,bR));
   /* page turn: the right-hand sheet lifts off, curls over the spine and settles on the left. It is lit by the angle it makes
      with the light, shows the page's front and then its back, and casts a soft shadow on the pages underneath */
   float ph=PT.x;
   if(ph>=0.&&length(qb-d*.5)<length(d)+length(R)+length(L)){
    float th=3.14159*(.5-.5*cos(3.14159*ph)),fade=1.;
    if(PU.z>.5){th=mix(1.5708,3.14159,smoothstep(0.,1.,ph));fade=smoothstep(0.,.18,ph)*(1.-smoothstep(.6,.88,ph));}
    float sh=0.;
    if(onR&&th<1.5708)sh=.38*sin(th)*(1.-smoothstep(cos(th)*.85,cos(th)*.85+.4,bR));
    if(onL&&th>1.5708)sh=.38*sin(th)*(1.-smoothstep(-cos(th)*.85,-cos(th)*.85+.4,bL));
    c*=1.-sh*fade*vis;
    /* the sheet, drawn as eight strips so it can bend */
    vec2 Pk=vec2(0.);float hit=0.,tp=0.,ha=0.,hk=0.,fr=1.,ea=1.3/length(d*uSize);
    for(int k=0;k<8;k++){
     float tk=th-.62*sin(th)*(float(k)+.5)/8.;if(PU.z>.5)tk=max(tk,1.5708);
     vec2 e=(((1.+cos(tk))*.5)*R+((1.-cos(tk))*.5)*L+sin(tk)*Up)/8.;
     vec2 r=qb-Pk;float det=d.x*e.y-d.y*e.x;
     if(abs(det)>1e-10){float a=(r.x*e.y-r.y*e.x)/det,b=(d.x*r.y-d.y*r.x)/det;
      float eb=k==7?1.3/max(length(e*8.*uSize),1.):0.;
      if(a>=0.&&a<=1.&&b>=-.04&&b<=1.04){float al=smoothstep(0.,ea,a)*smoothstep(1.,1.-ea,a)*(k==7?smoothstep(1.,1.-eb,b):1.);if(al>=hit){hit=al;tp=clamp((float(k)+b)/8.,0.,1.);ha=a;hk=tk;fr=sign(det)==sign(crR)?1.:0.;}}}
     Pk+=e;
    }
    /* a book turned to us: the sheet is behind its cover until it clears it */
    if(PU.z>.5)hit*=1.-smoothstep(0.,.03,aR)*smoothstep(1.,.97,aR)*smoothstep(-.01,.02,bR)*smoothstep(1.,.97,bR);
    if(hit>0.){
     float tile=(fr>.5&&PU.z<.5)?PT.y:PT.z;
     /* lying flat it is exactly the page in the photo; in the air it is lit by its angle */
     vec2 tuv=vec2((tile+clamp(tp,.02,.97))/${NT}.,clamp(ha,.01,.99)*.5);float mid=smoothstep(0.,.5,sin(hk));
     vec3 pg=mix(texture2D(uPages,tuv+vec2(0.,.5)).rgb,texture2D(uPages,tuv).rgb,mid)*PC.rgb;
     float lit=.7+.34*abs(cos(hk))+.13*sin(3.14159*tp)*sin(hk)-(fr>.5?0.:.05);
     lit=mix(1.,lit*(1.-.16*smoothstep(.82,1.,tp)-.22*smoothstep(.95,1.,tp)),mid);
     c=mix(c,pg*lit,hit*fade*vis);
    }
   }
  }
  /* the hand that turns pages, over the sheet it holds */
  float rW=texture2D(uRig,pW).b;
  if(rW>.002){q=person(pW,id);c=mix(c,q.rgb,q.a*rW*vis);}
  /* the head, rigid, with its own blinks */
  float rH=texture2D(uRig,pH).r;
  if(rH>.002){float bl=uS[i*8+7].x;q=person(pH,id);
   if(bl>.002)for(int e=0;e<${NE};e++){vec4 L=uLid[e];if(abs(L.w-float(i))<.5)q.rgb=lid(pH,q.rgb,uEye[e],L,bl,id);}
   c=mix(c,q.rgb,q.a*rH*vis);}
 }
 /* steam over the hot cups: a soft plume that rises, widens, curls and thins out */
 float steam=0.;
 for(int i=0;i<8;i++){vec4 cp=uCup[i];if(cp.z<=0.)continue;
  float hg=cp.w*.075,wd=cp.w*.0075;float dy=(cp.y-uv0.y)/hg;if(dy<0.||dy>1.)continue;
  float dx=(uv0.x-cp.x)/wd;if(abs(dx)>4.5)continue;
  float sd=float(i)*3.7;
  float wv=fbm(vec2(dx*.45+sd,dy*1.6-uTime*.33));
  float xo=(sin(dy*5.+uTime*.75+sd)*.45+(wv-.5)*2.4)*dy*1.3;
  float col=exp(-pow((dx-xo)/(.5+dy*1.7),2.));
  float dn=fbm(vec2((dx-xo)*1.1+sd,dy*3.4-uTime*.9)+wv*1.4);
  steam+=col*smoothstep(0.,.1,dy)*(1.-smoothstep(.3,1.,dy))*smoothstep(.36,.74,dn)*cp.z;
 }
 c=mix(c,vec3(1.,.95,.88)*.95+c*.1,clamp(steam*.34,0.,.55)*uWake);
 float l=dot(c,vec3(.299,.587,.114));
 /* sunlight breathing through the leaves on the window */
 float hi=smoothstep(.48,.86,l)*(1.-uNight)*uWake;
 float n=noise(uv*vec2(7.,5.)+vec2(uTime*.06,-uTime*.035))*.6+noise(uv*vec2(21.,15.)-uTime*.045)*.4;
 c*=1.+hi*(n-.5)*.26;
 /* god rays from the window */
 vec3 r=texture2D(uRay,clamp(uv,0.,1.)).rgb;
 float rp=.82+.12*sin(uTime*.33)+.14*(noise(vec2(uTime*.18,uv.x*4.+uv.y*2.))-.5);
 c+=r*rp*uRayK*(1.-uNight)*uWake*inside;
 /* lamps and reading lights */
 vec3 la=vec3(0.);float warm=0.;
 for(int i=0;i<24;i++){if(i>=uNL)break;vec4 L=uLamp[i];if(L.z<=.001)continue;vec2 d=(uv-L.xy)*vec2(ar,1.);float q=dot(d,d);float k=L.w*L.w;
  la+=vec3(1.,.7,.4)*L.z*(exp(-q/(k*.0011))*.5+exp(-q/(k*.012))*.2+exp(-q/(k*.06))*.05);warm+=L.z*exp(-q/(k*.03));}
 /* fire */
 float fl=.62+.32*noise(vec2(uTime*3.7,0.))+.14*sin(uTime*17.)*noise(vec2(uTime*9.,3.));
 vec2 fd=(uv-uFire.xy)*vec2(ar,1.);float fq=dot(fd,fd);
 vec3 fire=vec3(1.,.42,.12)*uFire.z*fl*(exp(-fq/.0011)*.45+exp(-fq/.014)*.18+exp(-fq/.06)*.06);
 float wm=smoothstep(1.,.55,length((uv-uWin.xy)/uWin.zw));
 /* the night render is already lit by its lamps and the fire: reading lights and the fire's flicker stay gentle on it */
 c+=la*mix(.45,.3,uNight);
 c+=fire*mix(.55,.45,uNight);
 /* before the room wakes up: lights out, the window glowing faintly */
 vec3 off=c*.14+c*wm*.3;
 c=mix(off,c,uWake);
 /* lens: vignette and grain */
 vec2 vq=px/uRes-.5;c*=1.-dot(vq,vq)*.55;
 c+=(hash(px+fract(uTime*7.)*91.)-.5)*.02;
 gl_FragColor=vec4(c,1.);}`;

const PW=2752,PH=1536;
/* measured on the renders in uv. box: where the reader can be; hip, neck, book, wrist: what each part turns around; torso: how far the lean reaches;
   eyes: [centre u, corner line v, half width, tilt, opening above and below the corner line, lash thickness, lid skin above];
   amp: how far a new pose may go [torso lean, head tilt, book tilt (rad), book shift x, y (photo px), book scale];
   thumb: where the thumb holds the page (along the spine, across the page) */
const RIG={
  1:{box:[.25,.268,.403,.493],hip:[.316,.44],torso:[.313,.398,.027,.042],neck:[.316,.372],book:[.342,.378],
     eyes:[[.32125,.3491,.0029,.0003,.0009,.0037,.0014,.0022]],amp:[.022,.04,.025,2,2.5,.012]},
  2:{box:[.572,.234,.693,.483],hip:[.655,.365],torso:[.652,.33,.025,.038],neck:[.646,.311],book:[.63,.335],
     eyes:[[.64615,.29247,.00237,-.0001,.0008,.0033,.0011,.0019]],amp:[.022,.04,.025,2,2.5,.012]},
  3:{box:[.653,.408,.803,.701],hip:[.765,.615],torso:[.756,.555,.034,.05],neck:[.756,.512],book:[.715,.57],
     eyes:[[.75505,.4892,.00345,.00055,.003,.0034,.0012,.0024],[.74476,.48483,.0021,.00098,.0026,.0035,.0011,.0018]],amp:[.018,.035,.02,2,2.5,.012]},
  4:{box:[.088,.668,.362,.986],hip:[.215,.905],torso:[.205,.845,.05,.06],neck:[.19,.8],book:[.245,.815],wrist:[.2484,.8649],thumb:[.61,.65],amp:[.016,.05,.03,3,3,.02]},
  5:{box:[.645,.698,.852,.98],hip:[.80,.925],torso:[.805,.865,.05,.055],neck:[.80,.838],book:[.742,.832],wrist:[.7704,.8429],thumb:[.5,.88],amp:[.016,.05,.03,3,3,.02]},
  /* the second render: young men in the chairs that were empty */
  6:{box:[.31,.225,.455,.44],hip:[.345,.35],torso:[.343,.315,.025,.04],neck:[.347,.288],book:[.372,.3],amp:[.018,.035,.02,2,2.5,.012]},
  7:{box:[.195,.45,.34,.725],hip:[.265,.63],torso:[.245,.58,.03,.05],neck:[.242,.545],book:[.252,.565],
     eyes:[[.2385,.5233,.0033,-.00025,.0027,.0024,.0008,.0016],[.2477,.5217,.0017,-.0007,.0024,.002,.0007,.0014]],amp:[.018,.035,.02,2,2.5,.012]},
  8:{box:[.33,.745,.505,.98],hip:[.41,.95],torso:[.40,.90,.05,.06],neck:[.388,.868],book:[.445,.85],amp:[.016,.05,.03,3,3,.02]},
  9:{box:[.505,.75,.672,.982],hip:[.60,.95],torso:[.60,.915,.05,.055],neck:[.612,.868],book:[.574,.86],amp:[.016,.05,.03,3,3,.02]},
  10:{box:[.562,.332,.72,.558],hip:[.675,.49],torso:[.668,.45,.03,.045],neck:[.678,.414],book:[.642,.425],wrist:[.6668,.4322],thumb:[.55,.95],amp:[.018,.035,.02,2,2.5,.012]},
  11:{box:[.462,.188,.555,.395],hip:[.515,.33],torso:[.52,.285,.02,.035],neck:[.513,.252],book:[.49,.285],amp:[.014,.03,.02,1.5,2,.01]},
};
/* pages: spine start and direction, right and left page, the way up off the page; tiles in pages.png for the sheet's front and back,
   its tint, and the clean page under the thumb (-1: none) */
const PAGES={
  3:{s0:[.7074,.5623],d:[.0059,.0386],r:[.02316,-.00098],l:[-.01099,-.02602],up:[.002,-.01],away:1,tiles:[4,4],tint:[.95,1.08,1.43],under:-1},
  4:{s0:[.2571,.7978],d:[-.0203,.0485],r:[.00976,.00703],l:[-.01735,-.02266],up:[-.0015,-.004],away:0,tiles:[2,3],tint:[1,1,1],under:2},
  5:{s0:[.7274,.8132],d:[.01786,.04954],r:[.01533,-.01855],l:[-.00762,.00252],up:[.002,-.004],away:0,tiles:[4,5],tint:[1,1,1],under:4},
  9:{s0:[.5772,.823],d:[.0106,.0705],r:[.0203,-.0091],l:[-.0212,.0055],up:[.0015,-.004],away:0,tiles:[6,7],tint:[1,1,1],under:-1},
  10:{s0:[.6326,.4092],d:[.01515,.0409],r:[.01225,-.0136],l:[-.0075,.0069],up:[.0015,-.004],away:0,tiles:[8,8],tint:[1,1,1],under:8},
};
/* what the shader gets each frame: a slot per reader in view (box, torso reach, the torso, head and book maps, id, fade, blink),
   a slot per reader who turns pages (the page, its phase and tiles, the wrist map), and every eye with the slot it belongs to */
const slotBuf=new Float32Array(NS*32),pgBuf=new Float32Array(NP*28),eyeBuf=new Float32Array(NE*4),lidBuf=new Float32Array(NE*4),cupBuf=new Float32Array(32);
let frameSlots={ns:0,np:0,ne:0};
/* affine maps in photo pixels: [a,b,c,d,e,f] is x'=a·x+b·y+e, y'=c·x+d·y+f */
const aMul=(m,n)=>[m[0]*n[0]+m[1]*n[2],m[0]*n[1]+m[1]*n[3],m[2]*n[0]+m[3]*n[2],m[2]*n[1]+m[3]*n[3],m[0]*n[4]+m[1]*n[5]+m[4],m[2]*n[4]+m[3]*n[5]+m[5]];
const aRot=(c,ang,k,tx,ty)=>{const x=c[0]*PW,y=c[1]*PH,co=Math.cos(ang)*k,si=Math.sin(ang)*k;return [co,-si,si,co,x-co*x+si*y+tx,y-si*x-co*y+ty]};
/* the shader looks up where each output pixel comes from, so it gets the inverse map, in uv */
function putInv(m,buf,o){const det=m[0]*m[3]-m[1]*m[2],a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det;buf.set([a,b*PH/PW,c*PW/PH,d,-(a*m[4]+b*m[5])/PW,-(c*m[4]+d*m[5])/PH],o)}


/* each reader's habits, on their own clocks: breathing, eyes running along the lines, blinks, the book never quite still in the hands,
   now and then a new way of sitting, and the page turn with the hand that lifts the sheet */
let MOT={};
const bump=t=>t<=0||t>=1?0:Math.sin(Math.PI*t)**2;
const smooth=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10)};
const POSE0={tA:0,tX:0,tY:0,hA:0,hX:0,hY:0,bA:0,bX:0,bY:0,bS:1};
/* a page turn: the hand reaches for the corner, the sheet turns over dur seconds, the thumb lets go at `hold` of the turn, the hand settles back */
const FLIP={reach:.34,dur:1.15,hold:.36,back:.8};
const blinkAmt=t=>t<0?0:t<.085?(t/.085)**2:t<.125?1:t<.31?(1-(t-.125)/.185)**2:0;
function newPose(id,cur,paused){
  const A=RIG[id].amp,r=()=>Math.random()*2-1;let best=null,bd=-1;
  for(let k=0;k<5;k++){
    const lean=r(),p={tA:lean*A[0],tX:r()*.8,tY:r()*.8,hA:-lean*A[0]*.45+r()*A[1]*.8,hX:r()*1.1,hY:r()*.9,bA:lean*A[0]*.3+r()*A[2],bX:r()*A[3],bY:r()*A[4],bS:1+r()*A[5]};
    if(paused){p.hY-=1.4;p.bY+=A[4]*.8;p.bS-=A[5]*.5}
    const dd=Math.abs(p.tA-cur.tA)/A[0]+Math.abs(p.hA-cur.hA)/A[1]+Math.abs(p.bY-cur.bY)/A[4];
    if(dd>bd){bd=dd;best=p}
  }
  return best;
}
/* where a point of the turning sheet is, strip by strip exactly as the shader bends it (photo px) */
function sheetPoint(G,a,t,th){
  let x=G.s0[0]+a*G.d[0],y=G.s0[1]+a*G.d[1];const n=t*8;
  for(let k=0;k<8&&k<n;k++){const tk=th-.62*Math.sin(th)*(k+.5)/8,cr=(1+Math.cos(tk))*.5,cl=(1-Math.cos(tk))*.5,sn=Math.sin(tk),w=Math.min(1,n-k)/8;
    x+=(cr*G.r[0]+cl*G.l[0]+sn*G.up[0])*w;y+=(cr*G.r[1]+cl*G.l[1]+sn*G.up[1])*w}
  return [x*PW,y*PH];
}
const thAt=ph=>Math.PI*(.5-.5*Math.cos(Math.PI*clamp(ph)));
/* the hand turns about the wrist so the thumb stays on the sheet's edge: it takes the corner, lifts it to about 50°, lets go, and the hand settles
   back on the book. The wrist hardly moves, as in a real hand. Returns [dx, dy, turn, scale] about the wrist */
function handGesture(id,e){
  const G=PAGES[id],R=RIG[id],[a,t]=R.thumb,P0=sheetPoint(G,a,t,0),Wx=R.wrist[0]*PW,Wy=R.wrist[1]*PH;
  const rl=Math.hypot(G.r[0]*PW,G.r[1]*PH),ul=Math.hypot(G.up[0]*PW,G.up[1]*PH);
  const reach=[-G.r[0]*PW/rl*1.2+G.up[0]*PW/ul*.6,-G.r[1]*PH/rl*1.2+G.up[1]*PH/ul*.6];
  /* the thumb rides the sheet up to `hold`, then slides off it smoothly; the sheet point is softly held back past that */
  const eh=FLIP.hold*FLIP.dur,h=FLIP.hold+.08,ph=Math.max(0,e/FLIP.dur),phq=ph<h?ph:h+.06*(1-Math.exp(-(ph-h)/.06));
  const Q=sheetPoint(G,a,t,thAt(phq)),letGo=1-smooth((e-eh+.1)/FLIP.back),k=smooth((e+FLIP.reach)/FLIP.reach)*letGo;
  const off=[reach[0]*k+(Q[0]-P0[0])*.8*letGo,reach[1]*k+(Q[1]-P0[1])*.8*letGo];
  /* the turn and stretch about the wrist that carry the thumb tip by off */
  const r0x=P0[0]-Wx,r0y=P0[1]-Wy,r1x=r0x+off[0],r1y=r0y+off[1];
  const ang=Math.atan2(r0x*r1y-r0y*r1x,r0x*r1x+r0y*r1y),sc=clamp(Math.hypot(r1x,r1y)/Math.hypot(r0x,r0y),.97,1.05);
  return [0,0,.16*Math.tanh(ang/.16),sc];
}
/* fills the reader's slot for this frame, and a page slot and eye slots when they have them */
function motion(id,p,now,vis){
  const R=RIG[id],G=PAGES[id],F=frameSlots;if(F.ns>=NS)return;const sl=F.ns++,o=sl*32;
  const m=MOT[id]||(MOT[id]={seed:Math.random()*100,period:3.6+Math.random()*.9,line:3.2+Math.random()*.9,cur:{...POSE0},from:{...POSE0},to:{...POSE0},pt0:-99,pdur:3,pnext:now+8+Math.random()*14,blinkT:-9,blinkNext:now+1+Math.random()*3,blinkK:1,paused:false,flipSeen:null});
  const paused=!!(p&&p.status==='paused'),e=p&&p.flipAt!=null?now-p.flipAt:-99,turning=e>-FLIP.reach&&e<FLIP.dur+FLIP.back;
  /* a new way of sitting every 15–40 s, never in the middle of a page turn, and soon after a pause or a return to the book */
  if(paused!==m.paused){m.paused=paused;m.pnext=Math.min(m.pnext,now+.6+Math.random())}
  if(now>m.pnext&&!turning){m.from={...m.cur};m.to=newPose(id,m.cur,paused);m.pt0=now;m.pdur=2.4+Math.random()*1.2;m.pnext=now+15+Math.random()*25;if(R.eyes&&Math.random()<.7)m.blinkNext=Math.min(m.blinkNext,now+.12)}
  /* the torso moves first, the book a beat later, the head last */
  const kt=smooth((now-m.pt0)/m.pdur),kb=smooth((now-m.pt0-.12)/m.pdur),kh=smooth((now-m.pt0-.22)/m.pdur);
  for(const k in POSE0)m.cur[k]=lerp(m.from[k],m.to[k],k[0]==='t'?kt:k[0]==='h'?kh:kb);
  const c=m.cur,s=m.seed,dtm=Math.min(.1,Math.max(0,now-(m.last??now)));m.last=now;
  m.brPh=(m.brPh||0)+dtm*2*Math.PI/(m.period*(paused?1.2:1));m.readK=lerp(m.readK??(paused?0:1),paused?0:1,Math.min(1,dtm*1.5));
  const br=Math.sin(m.brPh+s);
  /* eyes running along the lines, carried a little by the head: a slow sweep, then a soft return to the next line */
  let rx=.5;if(R.eyes){const lp=((now+s)%m.line)/m.line;rx=.5+((lp<.84?smooth(lp/.84):1-smooth((lp-.84)/.16))-.5)*m.readK}
  let tA=c.tA+.0012*br,tX=c.tX,tY=c.tY-.45*br,
      hA=c.hA+(rx-.5)*.006+.004*Math.sin(.37*now+s),hX=c.hX+(rx-.5)*.7,hY=c.hY+rx*.3+.2*Math.sin(.29*now+s*5),
      bA=c.bA+.003*Math.sin(.63*now+s)+.002*Math.sin(1.71*now+s*2),bX=c.bX+.35*Math.sin(.8*now+s*3),bY=c.bY+.4*Math.sin(.55*now+s*4),bS=c.bS;
  let hand=[0,0,0,1],ph=-1;
  if(G&&turning){
    ph=e>=0&&e<FLIP.dur?e/FLIP.dur:-1;
    const f=clamp((e+FLIP.reach)/(FLIP.dur*.9+FLIP.reach));
    bA+=.012*bump(f)*(G.away?1:-1);bY-=.8*bump(f);hA+=(G.away?.02:-.018)*bump(f);hY-=.6*bump(f);
    if(R.wrist)hand=handGesture(id,e);
    /* the eyes jump from the end of one page to the top of the next, and blink on the way */
    if(R.eyes&&e>FLIP.dur*.45&&m.flipSeen!==p.flipAt){m.flipSeen=p.flipAt;m.blinkNext=now}
  }
  /* blinks, now and then twice */
  if(R.eyes&&now>m.blinkNext){m.blinkT=now;m.blinkK=.88+Math.random()*.12;m.blinkNext=now+(Math.random()<.14?.34:2.8+Math.random()*4.5)}
  /* parts, parent first: the head rides on the torso, the book on most of the torso's lean, the hand on the book */
  const T0=aRot(R.hip,tA,1,tX,tY),Th=aMul(T0,aRot(R.neck,hA,1,hX,hY)),Tb=aMul(aRot(R.hip,tA*.6,1,tX*.6,tY*.6),aRot(R.book,bA,bS,bX,bY));
  const Tw=R.wrist?aMul(Tb,aRot(R.wrist,hand[2],hand[3],hand[0],hand[1])):Tb;
  /* the site's masks run a soft seam past each reader's outline, so the box they may be drawn in is padded */
  const B=R.box;slotBuf.set([B[0]-.012,B[1]-.03,B[2]+.012,B[3]+.03],o);slotBuf.set(R.torso,o+4);putInv(T0,slotBuf,o+8);putInv(Th,slotBuf,o+14);putInv(Tb,slotBuf,o+20);
  slotBuf[o+26]=id;slotBuf[o+27]=vis;slotBuf[o+28]=R.eyes?blinkAmt(now-m.blinkT)*m.blinkK:0;
  if(G&&F.np<NP){const q=F.np++*28;
    pgBuf.set([...G.s0,...G.d,...G.r,...G.l,...G.up,G.away,1,ph,G.tiles[0],G.tiles[1],sl,...G.tint,G.under],q);
    if(R.wrist){putInv(Tw,pgBuf,q+20);pgBuf[q+26]=1}}
  for(const e of R.eyes||[])if(F.ne<NE){const k=F.ne++*4;eyeBuf.set(e.slice(0,4),k);lidBuf.set([...e.slice(4,7),sl],k)}
}


/* ---------- the halls, mapped in photo coordinates (0..1) ---------- */
/* seats: u, v, lamp index or -1; chars: which reader of the render sits in a seat, their gender, where the name tag and the
   "sit here" ring go. lamps glow brighter when someone reads beside them; cups steam: u, v, and the reader whose head
   hides that cup in the render (its steam stops while they sit there); sway: leaves that move in the air */
export const HALLS={
  a:{files:'a',sun:[.5,.05],win:[.5,.1,.13,.17],fire:[.915,.78],fireBox:[.893,.712,.938,.852],
    lamps:[[.15,.66,1],[.705,.38,.75],[.855,.70,1]],
    seats:[[.33,.335,-1],[.355,.44,-1],[.33,.52,-1],[.235,.63,0],[.2,.89,-1],[.42,.905,-1],[.58,.905,-1],[.79,.89,-1],[.735,.62,2],[.65,.5,-1],[.66,.36,1],[.515,.32,-1]],
    chars:{1:{seat:1,g:'f',head:[.318,.292]},2:{seat:10,g:'f',head:[.644,.252]},3:{seat:8,g:'m',head:[.754,.437],ring:[.757,.49]},4:{seat:4,g:'m',head:[.19,.705],ring:[.205,.79]},5:{seat:7,g:'f',head:[.793,.732]},
      6:{seat:0,g:'m',head:[.348,.234],ring:[.345,.31]},7:{seat:3,g:'m',head:[.238,.466],ring:[.25,.585]},8:{seat:5,g:'m',head:[.388,.771],ring:[.40,.89]},
      9:{seat:6,g:'m',head:[.614,.768],ring:[.60,.905]},10:{seat:9,g:'m',head:[.677,.349],ring:[.665,.455]},11:{seat:11,g:'m',head:[.511,.199],ring:[.512,.29]}},
    cups:[[.19,.715,4],[.177,.753,4],[.535,.745],[.57,.772],[.81,.772,5],[.53,.415]],
    sway:[[.5,.13,.14,.15],[.22,.3,.09,.17],[.04,.85,.06,.16],[.955,.9,.05,.12],[.73,.32,.05,.1]],
    dust:{skew:-.05}},
  /* the library: its front row is room A's, chair for chair. Its back row and balcony are part of the picture until an
     empty render of the library exists, so only these six chairs come and go */
  b:{files:'b',sun:[.5,.05],win:[.5,.1,.17,.2],fire:[.915,.78],fireBox:[.893,.712,.938,.852],
    lamps:[[.15,.66,1],[.855,.7,1]],
    seats:[[.235,.63,0],[.745,.62,1],[.2,.89,-1],[.42,.905,-1],[.58,.905,-1],[.79,.89,-1]],
    chars:{7:{seat:0,g:'m',head:[.238,.466],ring:[.25,.585]},3:{seat:1,g:'m',head:[.754,.437],ring:[.757,.49]},4:{seat:2,g:'m',head:[.19,.705],ring:[.205,.79]},
      8:{seat:3,g:'m',head:[.388,.771],ring:[.40,.89]},9:{seat:4,g:'m',head:[.614,.768],ring:[.60,.905]},5:{seat:5,g:'f',head:[.793,.732]}},
    cups:[[.19,.715,4],[.177,.753,4],[.535,.745],[.57,.772],[.81,.772,5]],
    sway:[[.5,.14,.18,.16],[.2,.3,.1,.18],[.68,.36,.06,.1],[.04,.85,.06,.16],[.955,.9,.05,.12]],
    dust:{skew:-.04}},
};
/* which reader of the render shows a person in a seat: only one of their own gender */
export function charFor(hall,seat,gender){
  const g=gender==='male'?'m':gender==='female'?'f':null;if(!g)return 0;
  for(const [id,c] of Object.entries(HALLS[hall].chars))if(c.seat===seat&&c.g===g)return +id;
  return 0;
}
export function seatChar(hall,seat){for(const [id,c] of Object.entries(HALLS[hall].chars))if(c.seat===seat)return {id:+id,...c};return null}

const DUST=[...Array(170)].map((_,i)=>{const r=rng(i*7+3);return {t:r(),s:r()*2-1,ph:r()*6.28,sp:.2+r()*.6,sz:.5+r()*1.4,a:.25+r()*.75}});
const EMBERS=[...Array(26)].map((_,i)=>{const r=rng(i*13+5);return {x:r(),t:r(),sp:.35+r()*.6,dr:r()*2-1,sz:.6+r()*1.2}});
const UNIFORMS=['uImg','uRay','uRes','uOff','uSize','uPar','uTime','uWake','uNight','uRayK','uWin','uFire','uFireBox','uLamp','uNL','uSway','uLoaded','uWith','uMask','uRig','uSoft','uPages','uS','uPg','uEye','uLid','uCup'];

/* opts: hall, base (url of the photos), canvas, fx, stage, frame, edge, teaser, ui, tags, scrollEl (null: the room is shown whole),
   variant ('day' | 'night'), small (phone-sized photos), reduced (less motion), onFlip(key) when a reader turns a page */
export function createRoomEngine(opts){
  const H=HALLS[opts.hall],{canvas:cv,fx,stage}=opts,fxc=fx.getContext('2d');
  MOT={};
  const gl=cv.getContext('webgl2',{antialias:false,alpha:false})||cv.getContext('webgl',{antialias:false,alpha:false});
  const GL2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;
  let progMain=null,progRays=null;const U={};
  const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.error(gl.getShaderInfoLog(s));return s};
  const program=fs=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,VS));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));gl.bindAttribLocation(p,0,'aPos');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))console.error(gl.getProgramInfoLog(p));return p};
  if(gl){
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    progMain=program(MAIN_FS);progRays=program(RAYS_FS);
    for(const n of UNIFORMS)U[n]=gl.getUniformLocation(progMain,n);
  }

  /* ---------- photos: per time of day the empty hall, the hall with everyone, where each reader is, and their pages ---------- */
  const url=(name,big)=>`${opts.base}${H.files}-${name}${big&&opts.small?'-m':''}.${name.endsWith('mask')||name.endsWith('pages')||name==='rig'||name==='soft'?'png':'jpg'}`;
  const texFrom=(img,photo)=>{
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,photo?gl.BROWSER_DEFAULT_WEBGL:gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(photo&&GL2){gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR)}else gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    if(photo){const an=gl.getExtension('EXT_texture_filter_anisotropic');if(an)gl.texParameterf(gl.TEXTURE_2D,an.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))}
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
    return t;
  };
  const loadImg=src=>new Promise((ok,no)=>{const im=new Image();im.decoding='async';im.onload=()=>ok(im);im.onerror=no;im.src=src});
  const bakeRays=(t,ar)=>{
    const RW=1024,RH=Math.round(RW/ar),rt=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,rt);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,RW,RH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    for(const [p,v] of[[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rt,0);
    gl.viewport(0,0,RW,RH);gl.useProgram(progRays);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.uniform1i(gl.getUniformLocation(progRays,'uImg'),0);gl.uniform2f(gl.getUniformLocation(progRays,'uSun'),H.sun[0],H.sun[1]);gl.uniform1f(gl.getUniformLocation(progRays,'uAR'),ar);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);
    return rt;
  };
  const shared={rig:null,soft:null};
  const V={};let variant=opts.variant,shown=null,dead=false;
  function loadVariant(v){
    if(V[v])return V[v];
    const e=V[v]={ready:false,people:null,readyAt:0,img:null,ar:2752/1536};
    loadImg(url(`${v}-empty`,true)).then(img=>{
      if(dead)return;e.img=img;e.ar=img.naturalWidth/img.naturalHeight;
      if(gl){e.tex=texFrom(img,true);e.ray=bakeRays(e.tex,e.ar)}
      e.ready=true;e.readyAt=performance.now();opts.onReady?.();
      return Promise.all([loadImg(url(v,true)),loadImg(url(`${v}-mask`)),loadImg(url(`${v}-pages`)),shared.rig?null:loadImg(url('rig')),shared.soft?null:loadImg(url('soft'))]);
    }).then(r=>{
      if(!r||dead||!gl)return;const [ph,mask,pages,rigI,softI]=r;
      if(rigI)shared.rig=texFrom(rigI,false);if(softI)shared.soft=texFrom(softI,false);
      e.people={tex:texFrom(ph,true),mask:texFrom(mask,false),pages:texFrom(pages,false)};
    }).catch(()=>{});
    return e;
  }
  loadVariant(variant);

  /* ---------- who sits where ---------- */
  let occ=new Map();/* key -> {key, seat, char, status, flipAt} */
  const seats=H.seats.map(s=>({u:s[0],v:s[1],lamp:s[2],level:0,target:0,flick:0,vis:0,occ:null}));

  /* ---------- mapping the photo onto the stage ---------- */
  const view={w:1,h:1,dpr:1,mobile:false,rect:{x:0,y:0,w:1,h:1},panX:0,ox:0,oy:0,W:1,H:1,parX:0,parY:0};
  function layout(){
    const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,1.6);
    view.w=w;view.h=h;view.dpr=dpr;view.mobile=w<760;
    cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);fx.width=cv.width;fx.height=cv.height;
    view.rect=view.mobile&&opts.phoneShare?{x:0,y:0,w,h:h*opts.phoneShare}:{x:0,y:0,w,h};
  }
  const ro=new ResizeObserver(layout);ro.observe(stage);layout();
  function computeMap(P,ar){
    const r=view.rect,baseH=Math.max(r.h,r.w/ar),baseW=baseH*ar;
    const maxPan=Math.max(0,(baseW-r.w)/2);view.panX=clamp(view.panX,-maxPan,maxPan);
    const bx=r.x+(r.w-baseW)/2+view.panX,by=r.y+(r.h-baseH)/2;
    /* the reveal: close on the window first, then back to the whole hall */
    const t=eio(seg(P,.02,.82)),Z=lerp(1.5,1,t);
    const cx=r.x+r.w/2,cy=r.y+r.h/2,fu0=(cx-bx)/baseW,fv0=(cy-by)/baseH;
    const fu=lerp(.5,fu0,t),fv=lerp(.2,fv0,t);
    view.W=baseW*Z;view.H=baseH*Z;view.ox=cx-fu*view.W;view.oy=cy-fv*view.H;
  }
  const toPx=(u,v)=>{const depth=lerp(.2,1,clamp(v)*clamp(v)*(3-2*clamp(v)));return {x:view.ox+u*view.W+view.parX*depth,y:view.oy+v*view.H+view.parY*depth}};

  /* ---------- scroll reveal, parallax, dragging on phones ---------- */
  let P=opts.scrollEl?0:.0,fixedP=opts.scrollEl?null:1,parTX=0,parTY=0,inView=true;
  const io=opts.scrollEl?new IntersectionObserver(es=>{inView=es[0].isIntersecting},{rootMargin:'200px 0px'}):null;
  if(io)io.observe(opts.scrollEl);
  function targetP(){
    if(fixedP!=null)return fixedP;
    const rc=opts.scrollEl.getBoundingClientRect(),total=rc.height-innerHeight;
    if(opts.reduced)return rc.top<innerHeight*.6?1:0;
    return clamp(-rc.top/(total*.76));
  }
  const onMove=e=>{if(view.mobile)return;const rc=stage.getBoundingClientRect();parTX=(e.clientX-rc.left)/rc.width-.5;parTY=(e.clientY-rc.top)/rc.height-.5};
  stage.addEventListener('pointermove',onMove);
  let drag=null;
  const onDown=e=>{if(!view.mobile||P<.9)return;drag={x:e.clientX,y:e.clientY,pan:view.panX,on:false}};
  const onDrag=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.on&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){drag.on=true;cv.setPointerCapture?.(e.pointerId)}if(drag.on)view.panX=drag.pan+dx};
  const onUp=()=>{drag=null};
  cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onDrag);addEventListener('pointerup',onUp);

  function applyUI(){
    const t=eio(seg(P,0,.34)),cs=lerp(Math.max(16,view.w*.07),0,t),ct=lerp(view.h*.2,0,t),cb=lerp(view.h*.23,0,t),cr=lerp(20,0,t);
    if(opts.frame)opts.frame.style.clipPath=`inset(${ct}px ${cs}px ${cb}px ${cs}px round ${cr}px)`;
    if(opts.edge)Object.assign(opts.edge.style,{top:ct+'px',left:cs+'px',right:cs+'px',bottom:cb+'px',borderRadius:cr+'px',opacity:String(1-t)});
    if(opts.teaser)opts.teaser.style.opacity=String(1-seg(P,.08,.26));
    if(opts.ui){const ui=seg(P,.8,.96);opts.ui.style.opacity=String(ui);opts.ui.style.transform=`translateY(${(1-ui)*14}px)`;opts.ui.dataset.live=ui>.9?'1':'0'}
    if(opts.tags)opts.tags.style.opacity=String(seg(P,.74,.9));
  }

  /* ---------- dust in the sunbeam, sparks from the fire ---------- */
  function drawFx(time,wake,night){
    const d=view.dpr;fxc.setTransform(1,0,0,1,0,0);fxc.clearRect(0,0,fx.width,fx.height);fxc.setTransform(d,0,0,d,0,0);
    const scale=view.W/1600,dustA=(1-night)*seg(P,.5,.8)*wake;
    if(dustA>.01){
      fxc.globalCompositeOperation='lighter';
      for(const p of DUST){
        const tt=(p.t+time*.004*p.sp)%1;
        const u=H.sun[0]+p.s*(.05+.3*tt)+H.dust.skew*tt+Math.sin(time*.2*p.sp+p.ph)*.012,v=H.sun[1]+.06+tt*.84+Math.sin(time*.15+p.ph)*.01;
        const q=toPx(u,v),rad=(p.sz*(.6+tt*1.6))*scale,tw=.55+.45*Math.sin(time*1.3*p.sp+p.ph);
        const a=dustA*p.a*tw*(1-Math.abs(p.s)*.7)*(1-tt*.55)*.55;
        const g=fxc.createRadialGradient(q.x,q.y,0,q.x,q.y,rad*2.2);g.addColorStop(0,`rgba(255,236,196,${a})`);g.addColorStop(1,'rgba(255,236,196,0)');
        fxc.fillStyle=g;fxc.fillRect(q.x-rad*2.2,q.y-rad*2.2,rad*4.4,rad*4.4);
      }
    }
    const fireA=seg(P,.45,.66)*wake;
    if(fireA>.01){
      fxc.globalCompositeOperation='lighter';const [x0,y0,x1,y1]=H.fireBox;
      for(const e of EMBERS){const tt=(e.t+time*.35*e.sp)%1;const u=lerp(x0+.006,x1-.006,e.x)+Math.sin(time*2*e.sp+e.x*9)*.004*tt+e.dr*.01*tt,v=lerp(y1-.03,y0-.06,tt);
        const q=toPx(u,v),a=fireA*(1-tt)*(.5+.5*Math.sin(time*9*e.sp+e.x*20))*(1+night),rad=e.sz*scale*1.6;
        const g=fxc.createRadialGradient(q.x,q.y,0,q.x,q.y,rad*2.4);g.addColorStop(0,`rgba(255,200,110,${a})`);g.addColorStop(.4,`rgba(255,120,40,${a*.6})`);g.addColorStop(1,'rgba(255,90,20,0)');fxc.fillStyle=g;fxc.fillRect(q.x-rad*2.4,q.y-rad*2.4,rad*4.8,rad*4.8)}
    }
  }

  /* ---------- page turns now and then, somewhere in the room ---------- */
  let T=0,nextFlip=6+Math.random()*6;
  function flipNow(o){if(!o||o.status!=='reading')return false;if(o.flipAt!=null&&T-o.flipAt<FLIP.dur+FLIP.back)return false;o.flipAt=T+FLIP.reach;setTimeout(()=>{if(!dead)opts.onFlip?.(o.key)},FLIP.reach*1000);return true}

  /* ---------- frame loop ---------- */
  const lampBuf=new Float32Array(24*4),swayBuf=new Float32Array(6*4);
  let last=performance.now(),raf=0,night=variant==='night'?1:0;
  function loop(now){
    raf=requestAnimationFrame(loop);
    const dt=Math.min(.05,(now-last)/1000);last=now;
    const tp=targetP();P+=(tp-P)*Math.min(1,dt*(opts.reduced?60:fixedP!=null?2.2:6.5));if(Math.abs(tp-P)<.0005)P=tp;
    if(!inView||document.hidden)return;
    T+=dt;applyUI();
    const want=loadVariant(variant);
    if(want.ready)shown=want;
    const tex=shown||want;night+=((shown&&shown===V.night?1:0)-night)*Math.min(1,dt*3);
    const loadK=tex.ready?clamp((now-tex.readyAt)/600):0;
    computeMap(P,tex.ar);
    const live=seg(P,.8,1);
    view.parX=lerp(view.parX,(parTX*-18+Math.sin(T*.13)*3)*live,Math.min(1,dt*2.2));
    view.parY=lerp(view.parY,(parTY*-10+Math.cos(T*.11)*2)*live,Math.min(1,dt*2.2));
    const wake=seg(P,.22,.6);
    if(T>nextFlip){nextFlip=T+7+Math.random()*9;const r=[...occ.values()].filter(o=>o.status==='reading');if(r.length)flipNow(r[Math.floor(Math.random()*r.length)])}
    let n=0;
    H.lamps.forEach((L,i)=>{
      const gate=seg(P,.5+i*.035,.62+i*.035);let boost=0;for(const s of seats)if(s.lamp===i)boost=Math.max(boost,s.level);
      lampBuf.set([L[0],L[1],gate*(.35+.95*boost)*(1-.6*night),L[2]],n*4);n++;
    });
    slotBuf.fill(0);pgBuf.fill(0);eyeBuf.fill(0);lidBuf.fill(0);for(let k=0;k<NP;k++)pgBuf[k*28+15]=-1;for(let k=0;k<NE;k++)lidBuf[k*4+3]=-1;frameSlots={ns:0,np:0,ne:0};
    const peopleReady=!!(tex.people&&shared.rig&&shared.soft);
    seats.forEach((s,i)=>{
      const o=s.occ,tgt=o?(o.status==='reading'?1:.3):0;
      if(tgt>0&&s.target===0)s.flick=.5;s.target=tgt;s.level+=(tgt-s.level)*Math.min(1,dt*2.5);
      let fm=1;if(s.flick>0){s.flick-=dt;fm=Math.random()<.5?.2:1}
      const gate=seg(P,.6+(i%8)*.02,.74+(i%8)*.02);
      if(n<24){lampBuf.set([s.u,s.v-.02,s.level*fm*gate*(o&&o.char?.22:s.lamp>=0?.35:.62)*(1+Math.sin(T*1.6+i)*.04),s.lamp>=0?.55:.8],n*4);n++}
      const ch=o&&o.char?o.char:s.lastChar||0;
      if(ch){const on=o&&o.char?1:0;s.lastChar=ch;s.vis+=(on*seg(P,.55,.75)-s.vis)*Math.min(1,dt*2.4);if(s.vis>.001&&peopleReady)motion(ch,o||{status:'reading',flipAt:null},T,s.vis);if(!on&&s.vis<.002)s.lastChar=0}
    });
    H.sway.forEach((m,i)=>swayBuf.set(m,i*4));for(let i=H.sway.length;i<6;i++)swayBuf.set([0,0,0,0],i*4);
    if(gl&&tex.ready){
      gl.viewport(0,0,cv.width,cv.height);gl.useProgram(progMain);
      const P6=tex.people;
      [['uWith',P6&&P6.tex,2],['uMask',P6&&P6.mask,3],['uRig',shared.rig,4],['uSoft',shared.soft,5],['uPages',P6&&P6.pages,6]].forEach(([u,t,i])=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,peopleReady&&t?t:tex.ray);gl.uniform1i(U[u],i)});
      if(!peopleReady)frameSlots.ns=0,slotBuf.fill(0);
      gl.uniform4fv(U.uS,slotBuf);gl.uniform4fv(U.uPg,pgBuf);gl.uniform4fv(U.uEye,eyeBuf);gl.uniform4fv(U.uLid,lidBuf);
      const shown={};for(const s of seats)if(s.lastChar)shown[s.lastChar]=Math.max(shown[s.lastChar]||0,s.vis);
      cupBuf.fill(0);H.cups.slice(0,8).forEach((cp,i)=>cupBuf.set([cp[0],cp[1]-.004,seg(P,.6,.85)*(1-(cp[2]?shown[cp[2]]||0:0)),.55+cp[1]*.75],i*4));gl.uniform4fv(U.uCup,cupBuf);gl.uniform4f(U.uFireBox,...H.fireBox);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex.tex);gl.uniform1i(U.uImg,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tex.ray);gl.uniform1i(U.uRay,1);
      gl.uniform2f(U.uRes,view.w,view.h);gl.uniform2f(U.uOff,view.ox,view.oy);gl.uniform2f(U.uSize,view.W,view.H);gl.uniform2f(U.uPar,view.parX,view.parY);
      gl.uniform1f(U.uTime,T);gl.uniform1f(U.uWake,wake);gl.uniform1f(U.uNight,night);gl.uniform1f(U.uRayK,.45*seg(P,.35,.72));gl.uniform1f(U.uLoaded,loadK);
      gl.uniform4f(U.uWin,...H.win);gl.uniform3f(U.uFire,H.fire[0],H.fire[1],seg(P,.45,.66));
      gl.uniform4fv(U.uLamp,lampBuf);gl.uniform1i(U.uNL,n);gl.uniform4fv(U.uSway,swayBuf);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }else if(tex.ready&&tex.img){
      /* no WebGL: the photo still shows */
      const c2=cv.getContext('2d');if(c2){c2.setTransform(view.dpr,0,0,view.dpr,0,0);c2.drawImage(tex.img,view.ox,view.oy,view.W,view.H)}
    }
    drawFx(T,wake*loadK,night);
    /* name tags and rings ride on the photo */
    if(opts.tags)for(const el of opts.tags.querySelectorAll('[data-u]')){
      const q=toPx(+el.dataset.u,+el.dataset.v),off=q.x<-40||q.x>view.w+40||q.y>view.rect.y+view.rect.h+10||q.y<-10;
      el.style.transform=`translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)${el.dataset.tf||''}`;
      if(off!==(el.dataset.off==='1'))el.dataset.off=off?'1':'0';
    }
  }
  raf=requestAnimationFrame(loop);

  return {
    setVariant(v){variant=v;loadVariant(v)},
    setOccupants(list){
      const next=new Map();
      for(const o of list){const prev=occ.get(o.key);next.set(o.key,prev?Object.assign(prev,{seat:o.seat,char:o.char,status:o.status}):{...o,flipAt:null})}
      occ=next;seats.forEach(s=>{s.occ=null});
      for(const o of occ.values())if(seats[o.seat])seats[o.seat].occ=o;
    },
    flip(key){return flipNow(occ.get(key))},
    setReveal(p){fixedP=p},
    get progress(){return P},
    destroy(){dead=true;cancelAnimationFrame(raf);ro.disconnect();io?.disconnect();stage.removeEventListener('pointermove',onMove);cv.removeEventListener('pointerdown',onDown);cv.removeEventListener('pointermove',onDrag);removeEventListener('pointerup',onUp)},
  };
}
