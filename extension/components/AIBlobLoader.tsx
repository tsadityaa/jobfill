import { useEffect, useRef } from 'react';

// ============================================================
// AI Blob Loader — morphing organic blob with neon particle field
// Inspired by the Dribbble AI technology loading animation
// Pure canvas — zero dependencies
// ============================================================

export default function AIBlobLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // ---- Blob config ----
    const NUM_POINTS = 8;          // control points around the blob
    const BASE_R = 52;             // base radius px
    const MORPH_AMP = 14;          // how far points can wander
    const MORPH_SPEED = 0.0018;    // morph frequency
    const ROT_SPEED = 0.0006;      // slow rotation

    // ---- Particles ----
    const NUM_PARTICLES = 55;
    interface Particle {
      angle: number; dist: number; size: number;
      speed: number; opacity: number; hue: number;
    }
    const particles: Particle[] = Array.from({ length: NUM_PARTICLES }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: BASE_R * (0.85 + Math.random() * 0.7),
      size: 0.6 + Math.random() * 1.8,
      speed: (0.004 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1),
      opacity: 0.3 + Math.random() * 0.7,
      hue: 200 + Math.random() * 60,   // cyan-to-violet range
    }));

    // ---- Phase offsets per point ----
    const phases = Array.from({ length: NUM_POINTS }, () => Math.random() * Math.PI * 2);
    const freqs  = Array.from({ length: NUM_POINTS }, () => 0.7 + Math.random() * 0.6);

    let t = 0;

    // ---- Catmull-Rom smooth blob path ----
    function buildBlobPath(t: number): Path2D {
      const pts: [number, number][] = [];
      for (let i = 0; i < NUM_POINTS; i++) {
        const angle = (i / NUM_POINTS) * Math.PI * 2 + t * ROT_SPEED * 1000;
        const r = BASE_R + Math.sin(t * MORPH_SPEED * 1000 * freqs[i] + phases[i]) * MORPH_AMP;
        pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }
      // Close loop
      const path = new Path2D();
      const n = pts.length;
      path.moveTo(
        (pts[0][0] + pts[1][0]) / 2,
        (pts[0][1] + pts[1][1]) / 2,
      );
      for (let i = 0; i < n; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % n];
        const p2 = pts[(i + 2) % n];
        const mx1 = (p0[0] + p1[0]) / 2;
        const my1 = (p0[1] + p1[1]) / 2;
        const mx2 = (p1[0] + p2[0]) / 2;
        const my2 = (p1[1] + p2[1]) / 2;
        path.quadraticCurveTo(p1[0], p1[1], mx2, my2);
        void mx1; void my1; // used implicitly via moveTo seed
      }
      path.closePath();
      return path;
    }

    function draw(timestamp: number) {
      t = timestamp;
      ctx.clearRect(0, 0, W, H);

      // ---- Outer ambient glow ----
      const outerGlow = ctx.createRadialGradient(cx, cy, BASE_R * 0.2, cx, cy, BASE_R * 2.2);
      outerGlow.addColorStop(0, 'rgba(100,60,255,0.08)');
      outerGlow.addColorStop(0.5, 'rgba(0,180,255,0.04)');
      outerGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = outerGlow;
      ctx.fillRect(0, 0, W, H);

      const blobPath = buildBlobPath(t);

      // ---- Deep inner fill ----
      const innerFill = ctx.createRadialGradient(cx - 8, cy - 10, 4, cx, cy, BASE_R * 1.1);
      innerFill.addColorStop(0, 'rgba(20,10,45,1)');
      innerFill.addColorStop(0.6, 'rgba(10,5,25,0.98)');
      innerFill.addColorStop(1, 'rgba(5,2,15,0.95)');
      ctx.save();
      ctx.fillStyle = innerFill;
      ctx.fill(blobPath);
      ctx.restore();

      // ---- Neon border glow — multiple passes ----
      const glowColors = [
        { color: `hsla(${200 + Math.sin(t * 0.0005) * 40},100%,65%,0.9)`, width: 2.5 },
        { color: `hsla(${240 + Math.sin(t * 0.0004) * 50},90%,70%,0.5)`, width: 6 },
        { color: `hsla(${270 + Math.sin(t * 0.0003) * 30},100%,75%,0.2)`, width: 14 },
        { color: `hsla(${200 + Math.sin(t * 0.0005) * 40},100%,65%,0.07)`, width: 28 },
      ];
      for (const g of glowColors) {
        ctx.save();
        ctx.strokeStyle = g.color;
        ctx.lineWidth = g.width;
        ctx.shadowColor = g.color;
        ctx.shadowBlur = g.width * 3;
        ctx.stroke(blobPath);
        ctx.restore();
      }

      // ---- Inner surface highlight ----
      ctx.save();
      ctx.clip(blobPath);
      const highlight = ctx.createRadialGradient(cx - 12, cy - 14, 2, cx, cy, BASE_R * 0.9);
      highlight.addColorStop(0, 'rgba(180,220,255,0.12)');
      highlight.addColorStop(0.4, 'rgba(80,130,255,0.04)');
      highlight.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = highlight;
      ctx.fillRect(0, 0, W, H);

      // Specular dot
      const specX = cx - 14 + Math.sin(t * 0.0007) * 4;
      const specY = cy - 16 + Math.cos(t * 0.0009) * 3;
      const spec = ctx.createRadialGradient(specX, specY, 0, specX, specY, 7);
      spec.addColorStop(0, 'rgba(255,255,255,0.55)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(specX, specY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ---- Orbiting particles ----
      for (const p of particles) {
        p.angle += p.speed;
        const px = cx + Math.cos(p.angle) * p.dist;
        const py = cy + Math.sin(p.angle) * p.dist;
        // Flicker opacity
        const flicker = p.opacity * (0.7 + 0.3 * Math.sin(t * 0.003 + p.angle * 4));
        ctx.save();
        ctx.globalAlpha = flicker;
        const pg = ctx.createRadialGradient(px, py, 0, px, py, p.size * 2.5);
        pg.addColorStop(0, `hsla(${p.hue},100%,75%,1)`);
        pg.addColorStop(1, `hsla(${p.hue},100%,75%,0)`);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, p.size * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ---- Cross lens flare ----
      const flareAlpha = 0.12 + 0.06 * Math.sin(t * 0.0012);
      const flareLenH = BASE_R * 2.4;
      const flareLenV = BASE_R * 2.2;
      ctx.save();
      ctx.globalAlpha = flareAlpha;
      // Horizontal ray
      const gradH = ctx.createLinearGradient(cx - flareLenH, cy, cx + flareLenH, cy);
      gradH.addColorStop(0, 'rgba(0,220,180,0)');
      gradH.addColorStop(0.45, 'rgba(0,255,200,0.8)');
      gradH.addColorStop(0.5, 'rgba(180,255,240,1)');
      gradH.addColorStop(0.55, 'rgba(0,255,200,0.8)');
      gradH.addColorStop(1, 'rgba(0,220,180,0)');
      ctx.fillStyle = gradH;
      ctx.fillRect(cx - flareLenH, cy - 1.5, flareLenH * 2, 3);
      // Vertical ray
      const gradV = ctx.createLinearGradient(cx, cy - flareLenV, cx, cy + flareLenV);
      gradV.addColorStop(0, 'rgba(0,200,255,0)');
      gradV.addColorStop(0.45, 'rgba(0,200,255,0.7)');
      gradV.addColorStop(0.5, 'rgba(160,230,255,1)');
      gradV.addColorStop(0.55, 'rgba(0,200,255,0.7)');
      gradV.addColorStop(1, 'rgba(0,200,255,0)');
      ctx.fillStyle = gradV;
      ctx.fillRect(cx - 1.5, cy - flareLenV, 3, flareLenV * 2);
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px 0 2px',
      gap: '2px',
    }}>
      <canvas
        ref={canvasRef}
        width={180}
        height={180}
        style={{ display: 'block' }}
      />
      {/* Scanning text with animated dots */}
      <div style={{
        fontSize: '0.78rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: 'linear-gradient(90deg, #8b5cf6, #06b6d4, #8b5cf6)',
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        animation: 'gradient-text-flow 2s ease-in-out infinite',
        marginTop: '-12px',
      }}>
        AI Mapping Fields
      </div>
      <div style={{
        fontSize: '0.65rem',
        color: 'var(--color-pc-text-muted)',
        letterSpacing: '0.03em',
        marginTop: '2px',
      }}>
        Analysing unknown form fields…
      </div>
    </div>
  );
}
