/* The room's sound, made in the browser: soft chords and plucks, the fire, rain on the window, a page rustling when someone
   turns one. And the small bell at the day's thirty minutes. Nothing plays until the reader asks for it. */
export const Ding=(()=>{let ctx=null;
  const prime=()=>{try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state!=='running')ctx.resume()}catch(e){}};
  /* a bell: a few inharmonic partials ringing out, then a second, higher strike */
  const strike=(t,f,g)=>{for(const [m,a,d] of[[1,1,1.9],[2.76,.42,1.1],[5.4,.2,.6],[8.93,.08,.35]]){const o=ctx.createOscillator(),v=ctx.createGain();o.type='sine';o.frequency.value=f*m;v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(g*a,t+.006);v.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(v);v.connect(ctx.destination);o.start(t);o.stop(t+d+.05)}};
  const play=()=>{prime();if(!ctx||ctx.state!=='running')return;const t=ctx.currentTime+.03;strike(t,1318.5,.16);strike(t+.13,1975.5,.12)};
  return {prime,play};
})();

export const Snd=(()=>{
  let ctx=null,master,revIn,noise,brown,chordIdx=0;const bus={};
  const vol={music:.55,fire:.5,rain:.45,pages:.7},on={music:true,fire:true,rain:false,pages:true},api={enabled:false};
  const hz=m=>440*Math.pow(2,(m-69)/12);
  function buf(sec,br){const n=Math.floor(ctx.sampleRate*sec),b=ctx.createBuffer(1,n,ctx.sampleRate),d=b.getChannelData(0);let l=0;for(let i=0;i<n;i++){const w=Math.random()*2-1;if(br){l=(l+.02*w)/1.02;d[i]=l*3.5}else d[i]=w}return b}
  function impulse(sec){const n=Math.floor(ctx.sampleRate*sec),b=ctx.createBuffer(2,n,ctx.sampleRate);for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.6)}return b}
  function loopNoise(b,filters,gain,dest,lfo){const s=ctx.createBufferSource();s.buffer=b;s.loop=true;let node=s;for(const [type,f] of filters){const bf=ctx.createBiquadFilter();bf.type=type;bf.frequency.value=f;node.connect(bf);node=bf}const g=ctx.createGain();g.gain.value=gain;node.connect(g);g.connect(dest);if(lfo){const o=ctx.createOscillator();o.frequency.value=.13;const og=ctx.createGain();og.gain.value=gain*.35;o.connect(og);og.connect(g.gain);o.start()}s.start()}
  function burst(t,type,freq,qq,dur,gain,dest){const s=ctx.createBufferSource();s.buffer=noise;const f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=qq;const g=ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.003);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(g);g.connect(dest);s.start(t,Math.random()*3,dur+.05)}
  function schedule(){
    if(!ctx||ctx.state!=='running')return;const now=ctx.currentTime;
    if(on.rain){const n=2+Math.floor(Math.random()*4);for(let i=0;i<n;i++)burst(now+Math.random()*.09,'bandpass',1800+Math.random()*4500,6,.02+Math.random()*.03,.05+Math.random()*.12,bus.rain)}
    if(on.fire&&Math.random()<.35){const k=1+Math.floor(Math.random()*3);for(let i=0;i<k;i++)burst(now+Math.random()*.08,'highpass',1200+Math.random()*2500,.8,.006+Math.random()*.02,.15+Math.random()*.5,bus.fire);if(Math.random()<.08)burst(now,'bandpass',220+Math.random()*200,1.5,.09,.5,bus.fire)}
  }
  const CH=[[50,57,60,64,65],[46,53,57,58,62],[43,50,55,58,65],[45,52,57,60,64]];
  function chord(t){const notes=CH[chordIdx++%CH.length],lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=950;lp.Q.value=.3;const env=ctx.createGain();env.gain.setValueAtTime(.0001,t);env.gain.exponentialRampToValueAtTime(.09,t+3.5);env.gain.setValueAtTime(.09,t+8);env.gain.exponentialRampToValueAtTime(.0001,t+13);lp.connect(env);env.connect(bus.music);
    for(const m of notes)for(const [type,det,gain] of[['sine',0,.5],['triangle',6,.22]]){const o=ctx.createOscillator();o.type=type;o.frequency.value=hz(m);o.detune.value=det+(Math.random()*4-2);const g=ctx.createGain();g.gain.value=gain/notes.length;o.connect(g);g.connect(lp);o.start(t);o.stop(t+13.2)}}
  function pluck(t){const sc=[62,65,67,69,72,74,77],m=sc[Math.floor(Math.random()*sc.length)],env=ctx.createGain();env.gain.setValueAtTime(.0001,t);env.gain.exponentialRampToValueAtTime(.05,t+.008);env.gain.exponentialRampToValueAtTime(.0001,t+3);const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2200;env.connect(lp);lp.connect(bus.music);
    for(const [mul,g] of[[1,1],[2,.28],[3,.08]]){const o=ctx.createOscillator();o.type='sine';o.frequency.value=hz(m)*mul;const gg=ctx.createGain();gg.gain.value=g;o.connect(gg);gg.connect(env);o.start(t);o.stop(t+3.1)}}
  function init(){
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain();master.gain.value=0;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-20;comp.ratio.value=3;master.connect(comp);comp.connect(ctx.destination);
    const conv=ctx.createConvolver();conv.buffer=impulse(3.4);revIn=ctx.createGain();const revOut=ctx.createGain();revOut.gain.value=.5;revIn.connect(conv);conv.connect(revOut);revOut.connect(master);
    noise=buf(4,false);brown=buf(6,true);
    for(const k of Object.keys(vol)){const g=ctx.createGain();g.gain.value=on[k]?vol[k]:0;g.connect(master);bus[k]=g}
    for(const [k,v] of[['music',.7],['pages',.25],['fire',.12]]){const s=ctx.createGain();s.gain.value=v;bus[k].connect(s);s.connect(revIn)}
    loopNoise(noise,[['highpass',450],['lowpass',3800]],.28,bus.rain);loopNoise(brown,[['lowpass',320]],.9,bus.fire,true);
    setInterval(schedule,90);
    let next=ctx.currentTime+.1,nextPl=ctx.currentTime+2.5;
    setInterval(()=>{if(ctx.state!=='running')return;const now=ctx.currentTime;if(!on.music){next=Math.max(next,now);nextPl=Math.max(nextPl,now);return}while(next<now+1){chord(next);next+=10}while(nextPl<now+1){pluck(nextPl);nextPl+=2.5+Math.random()*4.5}},300);
  }
  api.enable=()=>{if(!ctx)init();ctx.resume();master.gain.setTargetAtTime(.85,ctx.currentTime,.4);api.enabled=true};
  api.disable=()=>{if(!ctx)return;master.gain.setTargetAtTime(0,ctx.currentTime,.25);api.enabled=false;setTimeout(()=>{if(!api.enabled)ctx.suspend()},900)};
  api.set=(k,b)=>{on[k]=b;if(ctx)bus[k].gain.setTargetAtTime(b?vol[k]:0,ctx.currentTime,.3)};
  api.vol=(k,v)=>{vol[k]=v;if(ctx&&on[k])bus[k].gain.setTargetAtTime(v,ctx.currentTime,.15)};
  api.page=(v=1)=>{if(!ctx||!api.enabled||!on.pages||ctx.state!=='running')return;const t=ctx.currentTime+.02,s=ctx.createBufferSource();s.buffer=noise;const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.Q.value=.8;bp.frequency.setValueAtTime(1300,t);bp.frequency.exponentialRampToValueAtTime(4200,t+.16);bp.frequency.exponentialRampToValueAtTime(1800,t+.45);const g=ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.3*v,t+.07);g.gain.exponentialRampToValueAtTime(.08*v,t+.22);g.gain.exponentialRampToValueAtTime(.0001,t+.5);s.connect(bp);bp.connect(g);g.connect(bus.pages);s.start(t,Math.random()*3,.6);burst(t+.4,'bandpass',420,1.2,.07,.12*v,bus.pages)};
  document.addEventListener('visibilitychange',()=>{if(!ctx)return;if(document.hidden)ctx.suspend();else if(api.enabled)ctx.resume()});
  return api;
})();
