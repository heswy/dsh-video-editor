/** Trusted DSP only. No user code, file access, network, packages or dynamic evaluation. */
import { parentPort,workerData as score } from 'node:worker_threads';
const SR=48000,TAU=Math.PI*2;
try {
 const n=Math.round(score.duration*SR),left=new Float32Array(n),right=new Float32Array(n);
 let state=score.seed>>>0;
 const noise=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/2147483648-1;};
 for(const e of score.events){
  const start=Math.round(e.at*SR),len=Math.round(e.duration*SR),f=440*2**((e.note-69)/12),gain=10**(e.gainDb/20),l=Math.cos((e.pan+1)*Math.PI/4),r=Math.sin((e.pan+1)*Math.PI/4);
  let phase=0,low=0,previous=0;
  for(let i=0;i<len&&start+i<n;i++){
   const t=i/SR,u=i/Math.max(1,len-1),edge=Math.min(1,t/0.004,(len-1-i)/SR/0.012);
   let x=0,env=edge;
   switch(e.sound){
    case 'kick':phase+=TAU*(44+100*Math.exp(-t/0.025))/SR;x=Math.sin(phase)+noise()*Math.exp(-t/0.003)*0.15;env*=Math.exp(-t/0.14);break;
    case 'snare':x=noise()*0.75+Math.sin(TAU*180*t)*0.25;env*=Math.exp(-t/0.07);break;
    case 'hat':{const v=noise();x=(v-previous)*0.5;previous=v;env*=Math.exp(-t/0.025);break;}
    case 'click':x=Math.sin(TAU*2200*t);env*=Math.exp(-t/0.007);break;
    case 'whoosh':case 'riser':case 'rain':{const v=noise(),cut=e.sound==='rain'?0.18:0.025+0.5*u;low+=cut*(v-low);x=(v-low)*0.6;env*=e.sound==='riser'?u*u:e.sound==='rain'?Math.min(1,t/0.1,(e.duration-t)/0.1):Math.sin(Math.PI*u)**2;break;}
    case 'bell':x=Math.sin(TAU*f*t+1.4*Math.exp(-t/0.12)*Math.sin(TAU*f*3.5*t));env*=Math.exp(-t/0.6);break;
    case 'pluck':x=(Math.sin(TAU*f*t)+0.35*Math.sin(TAU*f*2*t)+0.12*Math.sin(TAU*f*3*t))/1.47;env*=Math.exp(-t/0.18);break;
    case 'pad':x=(Math.sin(TAU*f*0.997*t)+Math.sin(TAU*f*1.003*t)+0.15*Math.sin(TAU*f*2*t))/2.15;env*=Math.min(1,t/0.2,(e.duration-t)/0.3);break;
    case 'bass':x=(Math.sin(TAU*f*t)+0.15*Math.sin(TAU*f*2*t))/1.15;env*=Math.min(1,t/0.01,(e.duration-t)/0.04);break;
    default:x=Math.sin(TAU*f*t);
   }
   const v=x*Math.max(0,env)*gain;left[start+i]+=v*l;right[start+i]+=v*r;
  }
 }
 let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
 if(peak<1e-6)throw new Error('事件表没有可听声音，请检查增益和音符');
 const scale=10**(score.masterDb/20)*Math.min(1,0.89/peak),wav=Buffer.alloc(44+n*4);let energy=0,outPeak=0;
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(SR,24);wav.writeUInt32LE(SR*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++){const v=(ch?right[i]:left[i])*scale;energy+=v*v;outPeak=Math.max(outPeak,Math.abs(v));wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*4+ch*2);}
 const bytes=new Uint8Array(wav);
 parentPort.postMessage({bytes,analysis:{duration:n/SR,sampleRate:SR,channels:2,eventCount:score.events.length,peakDb:20*Math.log10(outPeak),rmsDb:10*Math.log10(energy/(n*2)),seed:score.seed},usage:{duration:n/SR,characters:0}},[bytes.buffer]);
}catch(e){parentPort.postMessage({error:e.message});}
