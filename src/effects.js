const COLORS = { violet: '#bd94ff', cyan: '#66f3ef', blue: '#87baff', pink: '#ff91d1', amber: '#ffe190', mint: '#86f4bf' };

/** Bounded, event-driven effects: no permanent animation loop on an idle board. */
export class GameEffects {
  constructor(canvas, cells, board) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.cells = cells;
    this.board = board;
    this.enabled = true;
    this.items = [];
    this.frame = 0;
    this.lastTime = 0;
    this.lastTrail = 0;
    this.resize();
  }

  setEnabled(enabled) { this.enabled = Boolean(enabled); if (!enabled) this.reset(); }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  cellCenter(row, col) {
    const rect = this.cells[row * 8 + col].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width };
  }
  add(item) {
    if (!this.enabled || !this.context) return;
    if (this.items.length > 650) this.items.splice(0, 100);
    this.items.push({ life: 0, duration: .65, delay: 0, ...item });
    if (!this.frame) { this.lastTime = performance.now(); this.frame = requestAnimationFrame((now) => this.tick(now)); }
  }

  place(cells, color) {
    if (!this.enabled) return;
    const centers = cells.map(([r, c]) => this.cellCenter(r, c));
    const x = centers.reduce((sum, p) => sum + p.x, 0) / centers.length;
    const y = centers.reduce((sum, p) => sum + p.y, 0) / centers.length;
    this.add({ type: 'ring', x, y, radius: centers[0].size * .5, color: COLORS[color], duration: .48 });
    for (const center of centers) for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.add({ type: 'spark', x: center.x, y: center.y, vx: Math.cos(angle) * 55, vy: Math.sin(angle) * 55 - 25, size: 1.3 + Math.random() * 1.5, color: COLORS[color], duration: .3 + Math.random() * .25 });
    }
  }

  clear(result, board) {
    if (!this.enabled) return;
    const first = this.cells[0].getBoundingClientRect();
    const last = this.cells[63].getBoundingClientRect();
    for (const row of result.clearedRows) {
      const p = this.cellCenter(row, 0);
      this.add({ type: 'beam', x: first.left, y: p.y, length: last.right - first.left, vertical: false, color: '#dfb9ff', duration: .55 });
    }
    for (const col of result.clearedCols) {
      const p = this.cellCenter(0, col);
      this.add({ type: 'beam', x: p.x, y: first.top, length: last.bottom - first.top, vertical: true, color: '#a1fff0', duration: .55 });
    }
    for (const [r, c] of result.clearedCells) {
      const p = this.cellCenter(r, c);
      const color = COLORS[board[r][c]] || COLORS.violet;
      for (let i = 0; i < 7; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * (125 + Math.min(result.combo, 5) * 12);
        this.add({ type: i < 3 ? 'shard' : 'spark', x: p.x, y: p.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 75,
          size: i < 3 ? 3 + Math.random() * 4.5 : 1 + Math.random() * 2,
          rotation: Math.random() * Math.PI, spin: (Math.random() - .5) * 8,
          color, duration: .45 + Math.random() * .6, delay: .045 + (r + c) * .007 });
      }
    }
    const rect = this.board.getBoundingClientRect();
    this.add({ type: 'ring', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      radius: rect.width * .18, color: result.combo > 1 ? '#e3afff' : '#86f3de', duration: .7 });
  }

  trail(x, y, color) {
    if (!this.enabled || performance.now() - this.lastTrail < 28) return;
    this.lastTrail = performance.now();
    this.add({ type: 'spark', x: x + (Math.random() - .5) * 12, y: y + (Math.random() - .5) * 12,
      vx: (Math.random() - .5) * 15, vy: 14 + Math.random() * 18, size: 1 + Math.random() * 1.5,
      color: COLORS[color] || COLORS.violet, duration: .28 });
  }

  celebrate() {
    if (!this.enabled) return;
    const rect = this.board.getBoundingClientRect();
    for (let side = 0; side < 2; side++) for (let i = 0; i < 38; i++) {
      this.add({ type: 'shard', x: side ? rect.right : rect.left, y: rect.bottom - rect.height * .2,
        vx: (side ? -1 : 1) * (55 + Math.random() * 190), vy: -170 - Math.random() * 240,
        size: 3 + Math.random() * 4, rotation: Math.random() * Math.PI, spin: (Math.random() - .5) * 12,
        color: Object.values(COLORS)[i % 6], duration: .85 + Math.random() * .7 });
    }
  }

  tick(now) {
    const dt = Math.min((now - this.lastTime) / 1000, .04);
    this.lastTime = now;
    const ctx = this.context;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.items = this.items.filter((p) => p.life < p.duration + p.delay);
    for (const p of this.items) {
      p.life += dt;
      if (p.life < p.delay) continue;
      const progress = Math.min(1, (p.life - p.delay) / p.duration);
      const fade = (1 - progress) ** 1.4;
      ctx.save();
      ctx.globalAlpha = fade;
      if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * fade;
        ctx.shadowColor = p.color; ctx.shadowBlur = 12 * fade;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.radius * (1 + progress * 2), p.radius * (1 + progress * 2) * .62, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'beam') {
        ctx.translate(p.x, p.y);
        if (p.vertical) ctx.rotate(Math.PI / 2);
        const sweep = Math.min(1, progress * 3);
        const gradient = ctx.createLinearGradient(0, 0, Math.max(1, p.length * sweep), 0);
        gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.7, p.color); gradient.addColorStop(1, '#fff');
        ctx.strokeStyle = gradient; ctx.lineWidth = 2 + 5 * fade; ctx.shadowColor = p.color; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(p.length * sweep, 0); ctx.stroke();
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += (p.type === 'shard' ? 380 : 110) * dt;
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;
        if (p.type === 'shard') {
          ctx.rotate((p.rotation || 0) + progress * (p.spin || 0));
          const size = p.size * (.7 + .3 * fade);
          ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size, -size * .4); ctx.lineTo(size * .65, size * .7); ctx.lineTo(-size * .5, size); ctx.lineTo(-size, 0); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffffff75'; ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size, -size * .4); ctx.lineTo(0, size * .12); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(0, size * .12); ctx.lineTo(-size * .5, size); ctx.closePath(); ctx.fill();
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = p.color; ctx.shadowBlur = 7;
          ctx.beginPath(); ctx.arc(0, 0, Math.max(.1, p.size * fade), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
    this.frame = this.items.length ? requestAnimationFrame((time) => this.tick(time)) : 0;
    if (!this.items.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  reset() {
    cancelAnimationFrame(this.frame); this.frame = 0; this.items = [];
    this.context?.clearRect(0, 0, innerWidth, innerHeight);
  }
}
