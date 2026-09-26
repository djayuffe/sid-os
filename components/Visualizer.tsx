
import React, { useEffect, useRef, memo } from 'react';
import { generateWaveformPoints, SidPlayer, SID_REG } from '../services/sidService';
import { Activity, Radio, Layers, Database, Sun } from 'lucide-react';

interface VisualizerProps {
  player: SidPlayer | null;
  isPlaying: boolean;
  header: any;
  mode: 'STANDARD' | 'VECTOR' | 'FLUX';
  voiceMask?: [boolean, boolean, boolean];
  luminosity?: number;
  sidModel: '6581' | '8580';
}

const Visualizer: React.FC<VisualizerProps> = memo(({ player, isPlaying, header, mode, voiceMask, luminosity = 1.2, sidModel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fluxHistory = useRef<number[][]>([]);
  const requestRef = useRef<number>(0);
  const starsRef = useRef<{x:number, y:number, z:number, s:number, color:string}[]>([]);
  const transitionAlpha = useRef(0);
  const dimensions = useRef({ w: 0, h: 0, dpr: 1 });
  const prevRegs = useRef<number[]>(new Array(32).fill(0));
  const activityMap = useRef<Float32Array>(new Float32Array(32).fill(0));

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    const updateSize = () => {
        const dpr = window.devicePixelRatio || 2;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        dimensions.current = { w: rect.width, h: rect.height, dpr };
        canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
        ctx.resetTransform(); ctx.scale(dpr, dpr);

        if (starsRef.current.length === 0) {
            const colors = ['#00ffff', '#ff00ff', '#ffaa00', '#ffffff'];
            starsRef.current = Array.from({length: 300}, () => ({
                x: (Math.random() - 0.5) * 10000, y: (Math.random() - 0.5) * 10000, z: Math.random() * 10000,
                s: Math.random() * 4 + 1.0, color: colors[Math.floor(Math.random() * colors.length)]
            }));
        }
    };

    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(container);
    updateSize();

    const render = (time: number) => {
      const { w, h } = dimensions.current;
      if (w <= 0 || h <= 0) { requestRef.current = requestAnimationFrame(render); return; }

      const cx = w / 2, cy = h / 2;
      const lum = luminosity || 1.0;
      
      const currentCycle = player ? player.getEstimatedCycles() : 0;
      const regs = player ? player.volatileRegs : new Array(32).fill(0);
      const vStates = player ? player.volatileVoiceStates : Array(3).fill(0).map(()=>({level:0, phase:0, ctrl:0, pw:0, freq:0}));
      const physics = (player && player.volatilePhysics) ? player.volatilePhysics : { temp: 25, power: 0 };
      const mask = voiceMask || [true, true, true];
      
      const cutoff = ((regs[SID_REG.FC_LO] & 0x07) << 8) | regs[SID_REG.FC_HI];
      const resonance = (regs[SID_REG.RES_FILT] >> 4) / 15.0;
      const masterVol = (regs[SID_REG.MODE_VOL] & 0x0F) / 15.0;

      if (isPlaying) transitionAlpha.current = Math.min(1, transitionAlpha.current + 0.04);
      else transitionAlpha.current = Math.max(0, transitionAlpha.current - 0.02);

      ctx.clearRect(0, 0, w, h);
      
      if (isPlaying && transitionAlpha.current > 0.1) {
          const shaftCount = 12;
          const shaftHue = 180 + resonance * 120;
          const shaftAngle = time * 0.0005;
          ctx.globalCompositeOperation = 'screen';
          for(let i=0; i<shaftCount; i++) {
              const ang = shaftAngle + (i / shaftCount) * Math.PI * 2;
              const len = 400 + cutoff * 0.2;
              const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang)*len, cy + Math.sin(ang)*len);
              const alpha = (0.05 + resonance * 0.2) * transitionAlpha.current;
              grad.addColorStop(0, `hsla(${shaftHue}, 100%, 70%, ${alpha})`);
              grad.addColorStop(1, `hsla(${shaftHue}, 100%, 20%, 0)`);
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx + Math.cos(ang-0.1)*len, cy + Math.sin(ang-0.1)*len);
              ctx.lineTo(cx + Math.cos(ang+0.1)*len, cy + Math.sin(ang+0.1)*len);
              ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
      }

      const sSpeed = isPlaying ? 5 + (physics?.power ?? 0) * 200 : 1.5;
      starsRef.current.forEach(s => {
          s.z -= sSpeed; if(s.z <= 0) s.z = 10000;
          const k = 1000 / s.z, px = cx + s.x * k, py = cy + s.y * k;
          if(px > 0 && px < w && py > 0 && py < h) {
              ctx.fillStyle = s.color; ctx.globalAlpha = (1 - s.z / 10000) * transitionAlpha.current * 0.9;
              ctx.fillRect(px, py, s.s * k, s.s * k);
          }
      });

      const busW = 240, busH = 120;
      const busX = 40, busY = h - busH - 40;
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = 'rgba(4, 6, 12, 0.7)';
      ctx.beginPath(); ctx.roundRect(busX - 10, busY - 10, busW + 20, busH + 20, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

      for (let r = 0; r < 32; r++) {
          const rx = busX + (r % 8) * (busW / 8);
          const ry = busY + Math.floor(r / 8) * (busH / 4);
          if (regs[r] !== prevRegs.current[r]) activityMap.current[r] = 1.0;
          activityMap.current[r] *= 0.94;
          prevRegs.current[r] = regs[r];
          const act = activityMap.current[r];
          ctx.fillStyle = act > 0.05 ? `hsla(${180 + act * 60}, 100%, 50%, ${0.1 + act * 0.8})` : 'rgba(34, 211, 238, 0.05)';
          ctx.beginPath(); ctx.roundRect(rx + 2, ry + 2, 24, 20, 4); ctx.fill();
          if (act > 0.4) {
              ctx.shadowBlur = 15 * act; ctx.shadowColor = '#00ffff';
              ctx.strokeStyle = `rgba(255, 255, 255, ${act})`;
              ctx.strokeRect(rx + 2, ry + 2, 24, 20);
              ctx.shadowBlur = 0;
          }
          ctx.fillStyle = act > 0.4 ? '#ffffff' : 'rgba(34, 211, 238, 0.4)';
          ctx.font = 'bold 8px Share Tech Mono';
          ctx.fillText(regs[r].toString(16).toUpperCase().padStart(2, '0'), rx + 7, ry + 15);
      }

      const voiceColors = ['#00f2ff', '#ff00ff', '#ff9900'];

      if (mode === 'FLUX') {
          const sliceCount = 80;
          const combinedPts = new Float32Array(64).fill(0);
          for(let v=0; v<3; v++) {
            if(!mask[v]) continue;
            const vs = vStates[v];
            const phaseOffset = ((currentCycle % 16777216) * vs.freq / 16777216) % 1;
            const pts = generateWaveformPoints(vs.ctrl, vs.pw, vs.freq, 64, phaseOffset);
            pts.forEach((p, i) => combinedPts[i] += p * vs.level);
          }
          fluxHistory.current.unshift([...Array.from(combinedPts)]);
          if(fluxHistory.current.length > sliceCount) fluxHistory.current.pop();

          ctx.lineWidth = 2.5 + resonance * 10.0;
          fluxHistory.current.forEach((slice, idx) => {
              const depth = 1 - (idx / sliceCount);
              const zScale = Math.pow(depth, 1.2);
              const alpha = depth * lum * 0.85 * transitionAlpha.current;
              ctx.beginPath(); 
              ctx.strokeStyle = `hsla(${240 - idx * 3.0 + (time / 40) % 360}, 90%, 65%, ${alpha})`;
              slice.forEach((p, i) => {
                  const x = (i / 64) * w * zScale + (w * (1 - zScale) / 2);
                  const y = h * 0.7 - (idx * 7.5) + (p * 140 * zScale * (1.0 + resonance));
                  if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              });
              ctx.stroke();
          });
      } else if (mode === 'STANDARD') {
          const sliceH = h / 14;
          for (let v = 0; v < 3; v++) {
              if (!mask[v]) continue;
              const vs = vStates[v];
              const phaseOffset = ((currentCycle % 16777216) * vs.freq / 16777216) % 1;
              const pts = generateWaveformPoints(vs.ctrl || 0, vs.pw || 0, vs.freq || 0, 250, phaseOffset);
              const alpha = lum * (0.3 + vs.level * 4.0 + transitionAlpha.current * 0.1);
              ctx.shadowBlur = 40 * vs.level; ctx.shadowColor = voiceColors[v];
              ctx.beginPath(); ctx.strokeStyle = voiceColors[v]; ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
              ctx.lineWidth = 5.0 + vs.level * 60;
              pts.forEach((p, i) => {
                  const x = (i / pts.length) * w;
                  const y = cy + (v - 1) * sliceH * 4.5 + (p * sliceH * 2.8 * (masterVol + 0.5));
                  if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              });
              ctx.stroke();
              ctx.shadowBlur = 0;
          }
      } else {
          ctx.globalCompositeOperation = 'screen';
          [[0, 1], [1, 2], [2, 0]].forEach(([v1, v2], idx) => {
              if (!mask[v1] || !mask[v2]) return;
              const vs1 = vStates[v1], vs2 = vStates[v2];
              const phase1 = ((currentCycle % 16777216) * vs1.freq / 16777216) % 1;
              const phase2 = ((currentCycle % 16777216) * vs2.freq / 16777216) % 1;
              const pts1 = generateWaveformPoints(vs1.ctrl, vs1.pw, vs1.freq, 500, phase1);
              const pts2 = generateWaveformPoints(vs2.ctrl, vs2.pw, vs2.freq, 500, phase2);
              ctx.save(); ctx.translate(cx + (idx - 1) * (w / 3.0), cy);
              ctx.globalAlpha = Math.max(0, Math.min(1, (vs1.level + vs2.level) * lum * 5.0 + 0.1));
              ctx.beginPath(); ctx.strokeStyle = voiceColors[idx]; ctx.lineWidth = 7.0 + (vs1.level + vs2.level) * 30.0;
              for(let i=0; i<pts1.length; i++) {
                  const x = pts1[i] * (Math.min(w, h) * 0.38), y = pts2[i] * (Math.min(w, h) * 0.38);
                  if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              }
              ctx.stroke(); ctx.restore();
          });
          ctx.globalCompositeOperation = 'source-over';
      }

      if (isPlaying) {
          ctx.fillStyle = 'rgba(34, 211, 238, 0.7)'; ctx.font = 'bold 10px Share Tech Mono';
          ctx.fillText(`KERN::HW_VSYNC_PHASE_LOCK_OK`, w - 200, 30);
          ctx.fillText(`ANALOG::CUTOFF_${cutoff.toString().padStart(4, '0')}`, w - 200, 44);
          ctx.fillText(`ANALOG::RESONANCE_${(resonance*100).toFixed(0)}%`, w - 200, 58);
      }

      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(requestRef.current); resizeObserver.disconnect(); };
  }, [mode, voiceMask, luminosity, isPlaying, player]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden silicon-border gpu-sync rounded-xl shadow-[0_0_150px_rgba(0,0,0,1)] border border-white/5 bg-transparent">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
        <div className="absolute top-8 left-8 z-30 flex flex-col pointer-events-none">
            <div className="flex items-center gap-6 mb-4">
               <div className="bg-cyan-500/10 p-4 rounded-2xl border border-cyan-500/30 shadow-[0_0_60px_rgba(34,211,238,0.4)]">
                  <Activity className="w-10 h-10 text-cyan-400 animate-pulse" />
               </div>
               <div className="flex flex-col">
                  <span className="text-[18px] font-black text-cyan-400 tracking-[0.7em] uppercase glow-text">SID OS</span>
                  <span className="text-[10px] text-slate-500 font-black -mt-2 tracking-[0.5em] uppercase">ANALOG_VIRTUAL_PROJECTION_V9</span>
               </div>
            </div>
            <h1 className="text-[64px] font-black text-white glow-text tracking-tighter uppercase italic truncate max-w-[800px] leading-[0.7] drop-shadow-4xl">
                {header?.song || "SID OS WORKSTATION"}
            </h1>
        </div>
        <div className="absolute top-8 right-8 z-30 flex flex-col items-end pointer-events-none gap-4">
            <div className="flex flex-col items-end opacity-60">
                <Database className="w-10 h-10 text-cyan-700 mb-1" />
                <span className="text-[9px] text-cyan-800 font-black uppercase tracking-widest">BUS_IO_SYNC</span>
            </div>
            <div className="flex flex-col items-end gap-1">
                 <div className="flex items-center gap-2">
                    <span className="text-[7px] text-slate-600 font-black uppercase tracking-widest">FILTER_ENERGY</span>
                    <Sun className="w-3 h-3 text-amber-500 animate-spin-slow" />
                 </div>
                 <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/5">
                    <div className="h-full bg-cyan-400 shadow-[0_0_15px_cyan] transition-all" style={{ width: `${((player?.volatileRegs[SID_REG.FC_LO] || 0) / 255) * 100}%` }}></div>
                 </div>
            </div>
        </div>
        <div className="absolute bottom-10 right-10 flex items-center gap-8 px-12 py-6 bg-black/80 border border-white/20 rounded-[4rem] shadow-4xl backdrop-blur-4xl ring-1 ring-white/10">
            <div className="p-4 bg-emerald-500/15 rounded-full border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                <Radio className="w-8 h-8 text-emerald-400 animate-pulse" />
            </div>
            <div className="flex flex-col">
                <span className="text-[16px] font-black tracking-[0.4em] text-slate-100 uppercase">{mode}::ENGINE_ACTIVE</span>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">PHOTONIC_CORE_PROJECTION_STABLE</span>
            </div>
            <div className="w-px h-16 bg-white/20"></div>
            <div className="flex items-center gap-6">
               <Layers className="w-8 h-8 text-pink-500 drop-shadow-[0_0_15px_rgba(244,114,182,0.6)]" />
               <div className="flex flex-col">
                  <span className="text-[10px] text-pink-500 font-black uppercase tracking-[0.4em]">HDR_PASS</span>
                  <span className="text-[14px] text-white font-black">100%_HW</span>
               </div>
            </div>
        </div>
    </div>
  );
});

export default Visualizer;
