/*
  Cricket motion. Progressive enhancement:
  1. Scoreboard figures rolling up on view
  2. Heavy bowling delivery, pitch bounce, bat strike impact, and ball hit for six
  3. Scorebook rows ruling in
  4. Procedural willow crack audio on impact (Web Audio API)

  Everything bails on prefers-reduced-motion. The CSS in tokens.css already
  flattens declarative animation; this covers the scripted kind, which that
  media query cannot reach.
*/

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Run once when the element first scrolls into view, then stop watching. */
function onceInView(el: Element, fn: () => void, threshold = 0.4): void {
  if (!('IntersectionObserver' in window)) {
    fn();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io.unobserve(entry.target);
          fn();
        }
      }
    },
    { threshold },
  );
  io.observe(el);
}

/* -------------------------------------------------------------------------
   0. Procedural Willow-on-Leather Sound Engine
   Synthesizes the wooden transient crack & leather thud of a cricket bat
   directly via Web Audio API. Zero external assets required.
   ---------------------------------------------------------------------- */
let audioCtx: AudioContext | null = null;

function playWillowCrack(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // 1. Sharp wooden bat click
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1150, now);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.08);

    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(oscGain);
    oscGain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.1);

    // 2. Leather ball body resonance
    const thud = audioCtx.createOscillator();
    const thudGain = audioCtx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(210, now);
    thud.frequency.exponentialRampToValueAtTime(42, now + 0.2);

    thudGain.gain.setValueAtTime(0.5, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    thud.connect(thudGain);
    thudGain.connect(audioCtx.destination);
    thud.start(now);
    thud.stop(now + 0.24);
  } catch {
    // Fail gracefully if audio policy restricts playback
  }
}

/* -------------------------------------------------------------------------
   1. Scoreboard figures.
   The real number is already in the HTML. This rolls up to it the way a
   scoreboard clacks over, leaving the DOM exactly as it found it.
   ---------------------------------------------------------------------- */
function countUp(el: HTMLElement): void {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;

  const pad = el.textContent?.trim().length ?? 2;
  const duration = 900;
  let start: number | null = null;

  const step = (now: number) => {
    start ??= now;
    const t = Math.min((now - start) / duration, 1);
    // Ease out — fast off the bat, settling into the final figure.
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(target * eased)).padStart(pad, '0');
    if (t < 1) requestAnimationFrame(step);
  };

  el.textContent = '0'.padStart(pad, '0');
  requestAnimationFrame(step);
}

/* -------------------------------------------------------------------------
   2. Canvas Particle Shockwave & Turf Dust
   ---------------------------------------------------------------------- */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

class ParticleSystem {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private isRunning = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    }
  }

  burst(x: number, y: number, isPitchBounce = false): void {
    const colors = isPitchBounce
      ? ['#b4b4ae', '#5b6068', '#fbfbf9']
      : ['#b4b5ba', '#fbfbf9', '#ffffff', '#1c3069'];

    const count = isPitchBounce ? 14 : 32;
    for (let i = 0; i < count; i++) {
      const angle = isPitchBounce ? -Math.PI * 0.5 + (Math.random() - 0.5) * 1.2 : Math.random() * Math.PI * 2;
      const speed = (Math.random() * 6 + 2) * (isPitchBounce ? 0.6 : 1);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (isPitchBounce ? 1.5 : 0.5),
        radius: Math.random() * 2.5 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: Math.random() * 0.03 + 0.02,
      });
    }

    if (!isPitchBounce) {
      this.shockwaves.push({
        x,
        y,
        radius: 8,
        maxRadius: 90,
        alpha: 0.75,
        color: '#b4b5ba',
      });
    }

    if (!this.isRunning) {
      this.isRunning = true;
      this.loop();
    }
  }

  private loop = (): void => {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18; // gravity
      p.alpha -= p.decay;

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += 4;
      s.alpha -= 0.035;

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, s.alpha);
      this.ctx.strokeStyle = s.color;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();

      if (s.alpha <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    if (this.particles.length > 0 || this.shockwaves.length > 0) {
      requestAnimationFrame(this.loop);
    } else {
      this.isRunning = false;
    }
  };
}

/* -------------------------------------------------------------------------
   3. Heavy Delivery & Six Strike Choreography
   ---------------------------------------------------------------------- */
let particleSystem: ParticleSystem | null = null;
let isAnimating = false;

function launchDelivery(
  hero: HTMLElement,
  ball: HTMLElement,
  heroContent: HTMLElement | null,
  titleWords: HTMLElement[],
  canvas: HTMLCanvasElement | null,
): void {
  if (isAnimating) return;
  isAnimating = true;

  const { width: w, height: h } = hero.getBoundingClientRect();
  if (!w || !h) {
    isAnimating = false;
    return;
  }

  if (canvas && !particleSystem) {
    particleSystem = new ParticleSystem(canvas);
  }
  if (particleSystem) {
    particleSystem.resize();
  }

  // Key coordinates in hero space
  const startX = -w * 0.08;
  const startY = h * 0.22;

  const pitchX = w * 0.32;
  const pitchY = h * 0.68;

  const impactX = w * 0.46;
  const impactY = h * 0.48;

  const outX = w * 1.14;
  const outY = -h * 0.35;
  const outCtrlX = w * 0.72;
  const outCtrlY = -h * 0.85;

  const frames: Keyframe[] = [];
  const totalSteps = 60;

  // Key normalized time markers
  const tPitch = 0.38;
  const tImpact = 0.52;

  let pitchBurstTriggered = false;
  let impactBurstTriggered = false;

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    let x: number;
    let y: number;
    let scale = 1;
    let rotation = 0;
    let opacity = 1;

    if (t <= tPitch) {
      // 1. Delivery down towards pitch bounce
      const prog = t / tPitch;
      const eased = prog * prog; // accelerate
      x = startX + (pitchX - startX) * eased;
      y = startY + (pitchY - startY) * eased;
      scale = 0.75 + eased * 0.35;
      rotation = eased * 720;
      opacity = prog < 0.05 ? prog / 0.05 : 1;
    } else if (t <= tImpact) {
      // 2. Rising off the pitch into sweet spot of the bat
      const prog = (t - tPitch) / (tImpact - tPitch);
      x = pitchX + (impactX - pitchX) * prog;
      y = pitchY + (impactY - pitchY) * (1 - Math.pow(1 - prog, 2));
      scale = 1.1 + prog * 0.15;
      rotation = 720 + prog * 360;
    } else {
      // 3. Struck for SIX off the bat: parabolic arc over the ropes
      const prog = (t - tImpact) / (1 - tImpact);
      const inv = 1 - prog;
      x = inv * inv * impactX + 2 * inv * prog * outCtrlX + prog * prog * outX;
      y = inv * inv * impactY + 2 * inv * prog * outCtrlY + prog * prog * outY;
      scale = 1.25 * (1 - prog * 0.65);
      rotation = 1080 + prog * 1080;
      opacity = prog > 0.88 ? Math.max(0, 1 - (prog - 0.88) / 0.12) : 1;
    }

    frames.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)}) rotate(${rotation.toFixed(0)}deg)`,
      opacity,
      offset: t,
    });
  }

  // Monitor frame timing for effects
  const duration = 1550;
  const anim = ball.animate(frames, { duration, easing: 'linear', fill: 'forwards' });

  // Pitch bounce effect
  window.setTimeout(() => {
    if (!pitchBurstTriggered && particleSystem) {
      pitchBurstTriggered = true;
      particleSystem.burst(pitchX, pitchY, true);
    }
  }, duration * tPitch);

  // Bat impact effect
  window.setTimeout(() => {
    if (!impactBurstTriggered) {
      impactBurstTriggered = true;
      playWillowCrack();

      if (particleSystem) {
        particleSystem.burst(impactX, impactY, false);
      }

      // Kinetic screen impulse on hero
      if (heroContent) {
        heroContent.animate(
          [
            { transform: 'translate(-4px, 3px)' },
            { transform: 'translate(3px, -2px)' },
            { transform: 'translate(-1px, 1px)' },
            { transform: 'translate(0, 0)' },
          ],
          { duration: 320, easing: 'ease-out' },
        );
      }

      // Title words spring pop
      titleWords.forEach((word, index) => {
        word.animate(
          [
            { transform: 'translateY(1.2rem) scale(0.96)', opacity: 0.7 },
            { transform: 'translateY(-0.35rem) scale(1.03)', opacity: 1, offset: 0.6 },
            { transform: 'translateY(0) scale(1)', opacity: 1 },
          ],
          {
            duration: 520,
            delay: index * 60,
            easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            fill: 'both',
          },
        );
      });
    }
  }, duration * tImpact);

  anim.onfinish = () => {
    isAnimating = false;
  };
}

/* -------------------------------------------------------------------------
   4. Scorebook lines.
   Rows arrive one after another, the way lines get written into a scorebook
   rather than all appearing at once.
   ---------------------------------------------------------------------- */
function ruleIn(rows: HTMLElement[]): void {
  rows.forEach((row, i) => {
    row.animate(
      [
        { opacity: 0, transform: 'translateX(-0.75rem)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 420, delay: i * 90, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
    );
  });
}

/* ---------------------------------------------------------------------- */

function init(): void {
  // Navigation is not motion — it runs even when animation is turned off.
  wireNavMenus();

  if (reduced.matches) return;

  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    onceInView(el, () => countUp(el));
  }

  const groups = new Map<Element, HTMLElement[]>();
  for (const row of document.querySelectorAll<HTMLElement>('[data-rule-in]')) {
    const parent = row.parentElement;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(row);
  }
  for (const [parent, rows] of groups) {
    onceInView(parent, () => ruleIn(rows), 0.15);
  }

  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const ball = document.querySelector<HTMLElement>('[data-six-ball]');
  const heroContent = document.querySelector<HTMLElement>('[data-hero-content]');
  const titleWords = Array.from(document.querySelectorAll<HTMLElement>('.lockup__word'));
  const canvas = document.querySelector<HTMLCanvasElement>('[data-six-canvas]');
  const trigger = document.querySelector<HTMLButtonElement>('[data-six-trigger]');

  if (hero && ball) {
    const launch = () => launchDelivery(hero, ball, heroContent, titleWords, canvas);

    // One bowling delivery on arrival
    window.setTimeout(launch, 500);

    // Replay on button trigger
    trigger?.addEventListener('click', (e) => {
      e.preventDefault();
      launch();
    });

    // Replay on Space when focused within hero
    hero.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        launch();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}


/* -------------------------------------------------------------------------
   Nav dropdowns.
   The menu is a <details>, so it already opens and closes on its own. This
   only adds the two conveniences a <details> cannot do by itself: close on
   Escape, and close when a click lands outside it. With JavaScript off the
   menu still works — it just stays open until you click the summary again.
   ---------------------------------------------------------------------- */
function wireNavMenus(): void {
  const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>('.nav-menu'));
  if (menus.length === 0) return;

  const closeAll = (except?: HTMLDetailsElement) => {
    for (const m of menus) if (m !== except) m.open = false;
  };

  for (const menu of menus) {
    // Only one open at a time.
    menu.addEventListener('toggle', () => {
      if (menu.open) closeAll(menu);
    });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!menus.some((m) => m.contains(target))) closeAll();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = menus.find((m) => m.open);
    if (open) {
      open.open = false;
      open.querySelector('summary')?.focus();
    }
  });
}
