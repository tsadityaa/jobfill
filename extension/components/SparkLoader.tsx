import { useEffect, useRef } from 'react';

// ============================================================
// SparkLoader — Electric arc / lightning crackle canvas loader
// Used for: scanning (cyan arcs) and filling (green lightning)
// Pure canvas, zero deps, 60 fps rAF loop
// ============================================================

interface SparkLoaderProps {
  label: string;
  sublabel?: string;
  /** 'cyan' for scanning, 'green' for filling */
  color?: 'cyan' | 'green';
}

export default function SparkLoader({ label, sublabel, color = 'cyan' }: SparkLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  const hue = color === 'cyan' ? 188 : 145; // electric cyan vs neon green

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // ---- Core ring ----
    const RING_R = 38;

    // ---- Lightning bolt segment ----
    interface Bolt {
      angle: number;       // direction out from center
      life: number;        // current age 0..maxLife
      maxLife: number;
      segs: [number, number][];  // zigzag points
      hue: number;
      width: number;
    }

    const bolts: Bolt[] = [];
    let nextBolt = 0;   // ms until next bolt spawns

    function spawnBolt(t: number): Bolt {
      const angle = Math.random() * Math.PI * 2;
      const len   = RING_R * (0.8 + Math.random() * 1.4);
      // Build zigzag path
      const segs: [number, number][] = [];
      const steps = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const dist = frac * len;
        const jitter = (i === 0 || i === steps) ? 0 : (Math.random() - 0.5) * 14;
        const perpAngle = angle + Math.PI / 2;
        segs.push([
          cx + Math.cos(angle) * dist + Math.cos(perpAngle) * jitter,
          cy + Math.sin(angle) * dist + Math.sin(perpAngle) * jitter,
        ]);
      }
      return {
        angle,
        life: 0,
        maxLife: 140 + Math.random() * 200,
        segs,
        hue: hue + (Math.random() - 0.5) * 30,
        width: 0.6 + Math.random() * 1.2,
      };
    }

    // ---- Embers (tiny sparks that fly out from bolt tips) ----
    interface Ember {
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      hue: number; size: number;
    }
    const embers: Ember[] = [];

    function spawnEmbers(x: number, y: number, count: number) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 0.5 + Math.random() * 2;
        embers.push({
          x, y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          life: 0,
          maxLife: 40 + Math.random() * 80,
          hue: hue + (Math.random() - 0.5) * 40,
          size: 0.8 + Math.random() * 1.6,
        });
      }
    }

    // ---- Ring scan particles ----
    interface RingParticle {
      angle: number; speed: number; opacity: number; size: number;
    }
    const ringParticles: RingParticle[] = Array.from({ length: 24 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (0.02 + Math.random() * 0.04) * (Math.random() < 0.5 ? 1 : -1),
      opacity: 0.3 + Math.random() * 0.7,
      size: 0.8 + Math.random() * 1.4,
    }));

    let lastT = 0;

    function draw(timestamp: number) {
      const dt = timestamp - lastT;
      lastT = timestamp;
      ctx.clearRect(0, 0, W, H);

      // ---- Background radial haze ----
      const haze = ctx.createRadialGradient(cx, cy, 8, cx, cy, W * 0.55);
      haze.addColorStop(0, `hsla(${hue},100%,60%,0.06)`);
      haze.addColorStop(0.5, `hsla(${hue},80%,50%,0.03)`);
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H);

      // ---- Core ring + pulse ----
      const pulse = 0.7 + 0.3 * Math.sin(timestamp * 0.006);

      // Outer glow rings
      for (let i = 3; i >= 1; i--) {
        ctx.beginPath();
        ctx.arc(cx, cy, RING_R + i * 7 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue},100%,65%,${0.06 / i})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // Main ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, RING_R, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${hue},100%,65%,${0.55 + 0.35 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `hsla(${hue},100%,70%,0.8)`;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();

      // Inner bright core
      const coreFill = ctx.createRadialGradient(cx, cy, 0, cx, cy, RING_R * 0.5);
      coreFill.addColorStop(0, `hsla(${hue},100%,95%,${0.15 * pulse})`);
      coreFill.addColorStop(0.5, `hsla(${hue},100%,70%,${0.06 * pulse})`);
      coreFill.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coreFill;
      ctx.fillRect(0, 0, W, H);

      // ---- Ring orbit particles ----
      for (const p of ringParticles) {
        p.angle += p.speed * (dt / 16);
        const px = cx + Math.cos(p.angle) * RING_R;
        const py = cy + Math.sin(p.angle) * RING_R;
        ctx.save();
        ctx.globalAlpha = p.opacity * (0.6 + 0.4 * Math.sin(timestamp * 0.004 + p.angle * 3));
        ctx.shadowColor = `hsla(${hue},100%,75%,0.9)`;
        ctx.shadowBlur = 6;
        ctx.fillStyle = `hsla(${hue},100%,85%,1)`;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ---- Spawn bolts ----
      nextBolt -= dt;
      if (nextBolt <= 0) {
        bolts.push(spawnBolt(timestamp));
        nextBolt = 60 + Math.random() * 100;
      }

      // ---- Draw & update bolts ----
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.life += dt;

        if (b.life >= b.maxLife) {
          // Spawn embers at tip on death
          const tip = b.segs[b.segs.length - 1];
          spawnEmbers(tip[0], tip[1], 3 + Math.floor(Math.random() * 4));
          bolts.splice(i, 1);
          continue;
        }

        const alpha = Math.min(1, (1 - b.life / b.maxLife) * 3);

        // Draw the zigzag bolt
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = `hsla(${b.hue},100%,70%,0.9)`;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = `hsla(${b.hue},100%,85%,1)`;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        ctx.moveTo(b.segs[0][0], b.segs[0][1]);
        for (let s = 1; s < b.segs.length; s++) {
          ctx.lineTo(b.segs[s][0], b.segs[s][1]);
        }
        ctx.stroke();

        // Softer wide stroke underneath for bloom effect
        ctx.shadowBlur = 20;
        ctx.strokeStyle = `hsla(${b.hue},100%,70%,0.3)`;
        ctx.lineWidth = b.width * 4;
        ctx.stroke();
        ctx.restore();

        // Occasional branch spark
        if (Math.random() < 0.01 && b.segs.length > 2) {
          const randIdx = 1 + Math.floor(Math.random() * (b.segs.length - 1));
          const origin  = b.segs[randIdx];
          spawnEmbers(origin[0], origin[1], 1);
        }
      }

      // ---- Draw & update embers ----
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.x += e.vx;
        e.y += e.vy;
        e.vy += 0.04; // slight gravity
        e.life += dt;

        if (e.life >= e.maxLife) { embers.splice(i, 1); continue; }

        const a = (1 - e.life / e.maxLife) * 0.9;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowColor = `hsla(${e.hue},100%,80%,0.8)`;
        ctx.shadowBlur = 5;
        ctx.fillStyle = `hsla(${e.hue},100%,90%,1)`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ---- Scanline streak (thin horizontal slash for drama) ----
      const scanPhase = (timestamp * 0.001) % 1;
      if (scanPhase < 0.35) {
        const scanY = cy - RING_R + scanPhase * RING_R * 2 / 0.35;
        ctx.save();
        ctx.globalAlpha = 0.18 * Math.sin(scanPhase * Math.PI / 0.35);
        const scanGrad = ctx.createLinearGradient(cx - W * 0.4, scanY, cx + W * 0.4, scanY);
        scanGrad.addColorStop(0, 'transparent');
        scanGrad.addColorStop(0.3, `hsla(${hue},100%,75%,1)`);
        scanGrad.addColorStop(0.5, `hsla(${hue},100%,90%,1)`);
        scanGrad.addColorStop(0.7, `hsla(${hue},100%,75%,1)`);
        scanGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(cx - W * 0.4, scanY - 0.8, W * 0.8, 1.6);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hue]);

  const accentColor = color === 'cyan' ? '#00d4ff' : '#00ff87';
  const accentColor2 = color === 'cyan' ? '#00ff87' : '#ffb300';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4px 0 0',
      gap: '0px',
      userSelect: 'none',
    }}>
      <canvas
        ref={canvasRef}
        width={160}
        height={130}
        style={{ display: 'block' }}
      />
      <div style={{
        fontSize: '0.82rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: `linear-gradient(90deg, ${accentColor}, ${accentColor2}, ${accentColor})`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        animation: 'gradient-text-flow 2s ease-in-out infinite',
        marginTop: '-14px',
        fontFamily: 'var(--font-mono)',
      }}>
        {label}
      </div>
      {sublabel && (
        <div style={{
          fontSize: '0.62rem',
          color: 'var(--color-pc-text-muted)',
          letterSpacing: '0.04em',
          marginTop: '4px',
          fontFamily: 'var(--font-mono)',
        }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
