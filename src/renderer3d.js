// The input plane stays in the DOM. This renderer follows those exact rectangles,
// so lighting and mesh depth never change where a block can be picked up or placed.
const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform vec4 uRect;
uniform vec2 uViewport;
uniform float uDepth;
uniform float uLayer;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec2 pixel = uRect.xy + (aPosition.xy + 0.5) * uRect.zw;
  // An orthographic, slightly oblique projection exposes the real side faces.
  // The front face remains locked to the measured cell rectangle.
  pixel += vec2(0.40, 1.0) * uDepth * (1.0 - aPosition.z);
  gl_Position = vec4(pixel.x / uViewport.x * 2.0 - 1.0,
                     1.0 - pixel.y / uViewport.y * 2.0,
                     uLayer - aPosition.z * 0.035, 1.0);
  vNormal = aNormal;
  vPosition = aPosition;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBrightness;
uniform float uSaturation;
uniform float uTime;
uniform float uEnergy;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 key = normalize(vec3(-0.48, -0.67, 0.82));
  vec3 fill = normalize(vec3(0.75, -0.12, 0.38));
  vec3 view = normalize(vec3(-vPosition.xy * 0.30, 2.0));
  float diffuse = max(dot(normal, key), 0.0);
  float bounce = max(dot(normal, fill), 0.0);
  float specular = pow(max(dot(normal, normalize(key + view)), 0.0), 38.0);
  float rim = pow(1.0 - max(dot(normal, view), 0.0), 2.6);
  float front = smoothstep(0.78, 0.98, normal.z);
  float upperLight = 1.0 - smoothstep(-0.46, 0.42, vPosition.y);
  float studio = exp(-pow((vPosition.y + vPosition.x * 0.22 + 0.29) * 9.0, 2.0));
  float sweep = exp(-pow((vPosition.x + vPosition.y * 0.63
                         - sin(uTime * 1.5) * 0.95) * 14.0, 2.0));
  vec3 color = uColor * (0.34 + diffuse * 0.68 + bounce * 0.16);
  color += uColor * front * upperLight * 0.12;
  color += vec3(0.93, 0.96, 1.0) * (specular * 0.42 + studio * front * 0.12);
  color += mix(uColor, vec3(0.78, 0.88, 1.0), 0.28) * rim * 0.15;
  color += vec3(0.90, 0.96, 1.0) * sweep * front * uEnergy * 0.16;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation) * uBrightness;
  // The transparent canvas is composited using premultiplied alpha.
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * uOpacity, uOpacity);
}`;

const FALLBACK_COLORS = {
  violet: '#9762e7', cyan: '#31bccb', blue: '#5184ec',
  pink: '#d75b9d', amber: '#eab554', mint: '#48c790',
};
const JEWEL_SELECTOR = '.cell.jewel, .piece-shape .jewel, #drag-ghost .jewel';
const OBSERVED_SELECTOR = '.board-frame, .piece-tray, #drag-ghost';

function parseColor(value, element) {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((digit) => digit + digit).join('');
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255);
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return rgb.slice(1, 4).map((component) => Math.min(1, Number(component) / 255));
  const name = Object.keys(FALLBACK_COLORS).find((color) => element.classList.contains(`color-${color}`));
  return parseColor(FALLBACK_COLORS[name] || FALLBACK_COLORS.violet, element);
}

function roundedRing(inset, radius, z) {
  const extent = 0.5 - inset;
  const centers = [
    [extent - radius, -extent + radius, -Math.PI / 2],
    [extent - radius, extent - radius, 0],
    [-extent + radius, extent - radius, Math.PI / 2],
    [-extent + radius, -extent + radius, Math.PI],
  ];
  const ring = [];
  for (const [x, y, start] of centers) {
    for (let step = 0; step <= 5; step++) {
      const angle = start + step / 5 * Math.PI / 2;
      ring.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z]);
    }
  }
  return ring;
}

function createBeveledMesh() {
  const vertices = [];
  const triangle = (a, b, c, normals) => {
    for (const [index, point] of [a, b, c].entries()) vertices.push(...point, ...normals[index]);
  };
  const normalize = ([x, y, z]) => {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
  const radialNormal = (ring, index, z) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const next = ring[(index + 1) % ring.length];
    const x = next[1] - previous[1];
    const y = previous[0] - next[0];
    const length = Math.hypot(x, y) || 1;
    return normalize([x / length, y / length, z]);
  };
  const connect = (back, front, zNormal) => {
    for (let index = 0; index < back.length; index++) {
      const next = (index + 1) % back.length;
      const n0 = radialNormal(back, index, zNormal);
      const n1 = radialNormal(back, next, zNormal);
      triangle(back[index], back[next], front[next], [n0, n1, n1]);
      triangle(back[index], front[next], front[index], [n0, n1, n0]);
    }
  };
  const back = roundedRing(0.025, 0.095, 0);
  const rim = roundedRing(0.0, 0.12, 0.70);
  const front = roundedRing(0.065, 0.075, 1.0);
  connect(back, rim, 0.02);
  connect(rim, front, 0.90);
  for (let index = 0; index < front.length; index++) {
    triangle([0, 0, 1], front[index], front[(index + 1) % front.length], [[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
  }
  return new Float32Array(vertices);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create the block shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || 'Could not compile the block shader.');
  }
  return shader;
}

/**
 * Render real lit, beveled cuboids over the existing interactive DOM tiles.
 * CSS may hide backgrounds/borders under body.webgl-blocks, but must preserve
 * tile visibility, dimensions, opacity and transforms. A failed/lost WebGL
 * context removes that class immediately, restoring the CSS version.
 */
export class BlockRenderer3D {
  constructor(canvas, { root = document, onAvailabilityChange } = {}) {
    this.canvas = canvas;
    this.root = root;
    this.document = root.ownerDocument || root;
    this.window = this.document.defaultView;
    this.onAvailabilityChange = onAvailabilityChange;
    this.enabled = true;
    this.motionEnabled = true;
    this._available = false;
    this._disposed = false;
    this._frame = 0;
    this._animateUntil = 0;
    this._observedNodes = new WeakSet();
    this._tick = this._tick.bind(this);
    this._refreshListener = () => this.refresh();
    this._visibilityListener = () => {
      if (this.document.hidden) this._stop();
      else this.refresh();
    };
    this._hoverListener = (event) => {
      if (event.target instanceof this.window.Element && event.target.closest('.piece-slot, .board-frame')) this.refresh();
    };
    this._lostListener = (event) => {
      event.preventDefault();
      this._available = false;
      this._stop();
      this._syncAvailability();
    };
    this._restoredListener = () => {
      this._initialize();
      this.refresh();
    };
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'none';
    canvas.addEventListener('webglcontextlost', this._lostListener, false);
    canvas.addEventListener('webglcontextrestored', this._restoredListener, false);
    this.window.addEventListener('resize', this._refreshListener, { passive: true });
    this.window.addEventListener('scroll', this._refreshListener, { passive: true, capture: true });
    this.window.visualViewport?.addEventListener('resize', this._refreshListener, { passive: true });
    this.window.visualViewport?.addEventListener('scroll', this._refreshListener, { passive: true });
    this.document.addEventListener('visibilitychange', this._visibilityListener);
    root.addEventListener('pointerover', this._hoverListener, { passive: true });
    root.addEventListener('pointerout', this._hoverListener, { passive: true });
    if (this.window.MutationObserver) {
      this._mutationObserver = new this.window.MutationObserver(() => this.refresh());
    }
    if (this.window.ResizeObserver) {
      this._resizeObserver = new this.window.ResizeObserver(() => this.refresh());
    }
    this._initialize();
    this.refresh();
  }

  get available() { return this._available; }

  _initialize() {
    let vertexShader;
    let fragmentShader;
    let program;
    try {
      const gl = this.canvas.getContext('webgl', {
        alpha: true, antialias: true, premultipliedAlpha: true,
        depth: true, stencil: false, preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
      if (!gl || gl.isContextLost()) throw new Error('WebGL is unavailable.');
      this.gl = gl;
      vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error('Could not create the block material.');
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.program = program;
      const mesh = createBeveledMesh();
      this.vertexCount = mesh.length / 6;
      this.buffer = gl.createBuffer();
      if (!this.buffer) throw new Error('Could not create the block geometry.');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      this.attributes = {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
      };
      this.uniforms = Object.fromEntries([
        'uRect', 'uViewport', 'uDepth', 'uLayer', 'uColor', 'uOpacity',
        'uBrightness', 'uSaturation', 'uTime', 'uEnergy',
      ].map((name) => [name, gl.getUniformLocation(program, name)]));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // The screen-space Y axis is inverted in the vertex shader. Culling the
      // hidden faces also avoids double-blending translucent preview blocks.
      gl.enable(gl.CULL_FACE);
      gl.frontFace(gl.CW);
      gl.cullFace(gl.BACK);
      gl.clearColor(0, 0, 0, 0);
      this._available = true;
    } catch {
      if (program && this.gl) this.gl.deleteProgram(program);
      if (this.buffer && this.gl) this.gl.deleteBuffer(this.buffer);
      this.program = null;
      this.buffer = null;
      this._available = false;
    } finally {
      if (vertexShader && this.gl) this.gl.deleteShader(vertexShader);
      if (fragmentShader && this.gl) this.gl.deleteShader(fragmentShader);
    }
    this._syncAvailability();
  }

  _syncAvailability() {
    const active = this.enabled && this._available && !this._disposed;
    this.document.body?.classList.toggle('webgl-blocks', active);
    this.canvas.style.visibility = active ? 'visible' : 'hidden';
    if (this._reportedAvailability !== this._available) {
      this._reportedAvailability = this._available;
      this.onAvailabilityChange?.(this._available);
    }
  }

  setEnabled(enabled) {
    if (this._disposed) return;
    this.enabled = Boolean(enabled);
    this._syncAvailability();
    if (this.enabled) this.refresh();
    else {
      this._stop();
      this.gl?.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }
  }

  setMotionEnabled(enabled) {
    this.motionEnabled = Boolean(enabled);
    this.refresh();
  }

  refresh() {
    if (this._disposed || !this.enabled || !this._available || this.document.hidden) return;
    // Mutations are observed only inside the board/tray/ghost, never the canvas
    // or body class we update ourselves. Animation sampling stops after settling.
    for (const element of this.root.querySelectorAll(OBSERVED_SELECTOR)) {
      if (this._observedNodes.has(element)) continue;
      this._observedNodes.add(element);
      this._mutationObserver?.observe(element, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
      this._resizeObserver?.observe(element);
    }
    this._animateUntil = this.window.performance.now() + (this.motionEnabled ? 1350 : 0);
    if (!this._frame) this._frame = this.window.requestAnimationFrame(this._tick);
  }

  _stop() {
    if (this._frame) this.window.cancelAnimationFrame(this._frame);
    this._frame = 0;
    this._animateUntil = 0;
  }

  _tick(time) {
    this._frame = 0;
    if (this._disposed || !this.enabled || !this._available || this.document.hidden) return;
    this._draw(time);
    if (time < this._animateUntil) this._frame = this.window.requestAnimationFrame(this._tick);
  }

  _draw(time) {
    const gl = this.gl;
    const canvasRect = this.canvas.getBoundingClientRect();
    const width = canvasRect.width;
    const height = canvasRect.height;
    if (!width || !height || gl.isContextLost()) return;
    const ratio = Math.min(this.window.devicePixelRatio || 1, 1.75);
    const physicalWidth = Math.max(1, Math.round(width * ratio));
    const physicalHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== physicalWidth || this.canvas.height !== physicalHeight) {
      this.canvas.width = physicalWidth;
      this.canvas.height = physicalHeight;
    }
    gl.viewport(0, 0, physicalWidth, physicalHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.attributes.position);
    gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.attributes.normal);
    gl.vertexAttribPointer(this.attributes.normal, 3, gl.FLOAT, false, 24, 12);
    const u = this.uniforms;
    gl.uniform2f(u.uViewport, width, height);
    gl.uniform1f(u.uTime, this.motionEnabled ? time / 1000 : 0.35);

    const styleCache = new Map();
    const appearanceCache = new Map();
    const styleFor = (element) => {
      if (!styleCache.has(element)) styleCache.set(element, this.window.getComputedStyle(element));
      return styleCache.get(element);
    };
    const appearanceFor = (element) => {
      if (!element || element === this.document.documentElement) return { opacity: 1, brightness: 1, saturation: 1 };
      if (appearanceCache.has(element)) return appearanceCache.get(element);
      const style = styleFor(element);
      const parent = appearanceFor(element.parentElement);
      let opacity = parent.opacity * (Number.parseFloat(style.opacity) || 0);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') opacity = 0;
      const filterAmount = (name) => {
        const match = style.filter.match(new RegExp(`${name}\\(([\\d.]+)(%)?\\)`));
        return match ? Number(match[1]) / (match[2] ? 100 : 1) : 1;
      };
      const result = { opacity, brightness: parent.brightness * filterAmount('brightness'), saturation: parent.saturation * filterAmount('saturate') };
      appearanceCache.set(element, result);
      return result;
    };

    for (const element of this.root.querySelectorAll(JEWEL_SELECTOR)) {
      const ghost = element.closest('#drag-ghost');
      if (ghost && !ghost.classList.contains('active')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.bottom < 0 || rect.left > width + canvasRect.left || rect.top > height + canvasRect.top) continue;
      const appearance = appearanceFor(element);
      if (appearance.opacity < 0.005) continue;
      const color = parseColor(styleFor(element).getPropertyValue('--tile-color'), element);
      const preview = element.classList.contains('preview');
      const energetic = element.classList.contains('clearing') || element.classList.contains('clear-preview') || element.classList.contains('placed');
      gl.uniform4f(u.uRect, rect.left - canvasRect.left, rect.top - canvasRect.top, rect.width, rect.height);
      gl.uniform1f(u.uDepth, Math.min(3.4, Math.min(rect.width, rect.height) * 0.085));
      gl.uniform1f(u.uLayer, ghost ? -0.6 : energetic ? 0.10 : 0.3);
      gl.uniform3f(u.uColor, ...color);
      gl.uniform1f(u.uOpacity, Math.min(1, appearance.opacity));
      gl.uniform1f(u.uBrightness, Math.min(2.3, appearance.brightness));
      gl.uniform1f(u.uSaturation, appearance.saturation);
      gl.uniform1f(u.uEnergy, this.motionEnabled ? (energetic ? 1.0 : ghost ? 0.65 : preview ? 0.20 : 0.0) : 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._stop();
    this._mutationObserver?.disconnect();
    this._resizeObserver?.disconnect();
    this.window.removeEventListener('resize', this._refreshListener);
    this.window.removeEventListener('scroll', this._refreshListener, true);
    this.window.visualViewport?.removeEventListener('resize', this._refreshListener);
    this.window.visualViewport?.removeEventListener('scroll', this._refreshListener);
    this.document.removeEventListener('visibilitychange', this._visibilityListener);
    this.root.removeEventListener('pointerover', this._hoverListener);
    this.root.removeEventListener('pointerout', this._hoverListener);
    this.canvas.removeEventListener('webglcontextlost', this._lostListener);
    this.canvas.removeEventListener('webglcontextrestored', this._restoredListener);
    if (this.gl) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }
    this._available = false;
    this._syncAvailability();
  }
}
