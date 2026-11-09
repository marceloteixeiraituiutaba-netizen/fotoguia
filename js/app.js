/* FotoGuia 3D — guia de enquadramento e ângulo para fotos de produto (3:4) e escaneamento 3D.
 *
 * Convenções de ângulo:
 *  - Azimute (az): posição ao redor do objeto, 0° = Frente. Aumenta quando você caminha para a
 *    DIREITA ao redor do objeto (90° = lateral direita, 180° = traseira, 270° = lateral esquerda).
 *  - Elevação (el): quanto a câmera aponta para baixo em relação ao horizonte (0° = na altura do
 *    objeto, 90° = de cima).
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------ Configuração
  const ASPECT = 3 / 4;                     // largura / altura
  const ZONE = { x: 0.10, y: 0.10, w: 0.80, h: 0.80 }; // área-alvo onde o objeto deve ficar
  const FILL_MIN = 0.62, FILL_MAX = 1.0;    // quanto do quadro-alvo o objeto deve ocupar
  const CENTER_TOL = 0.07;
  const TOL_AZ = 10, TOL_AZ_HIGH = 20, TOL_EL = 7, TOL_ROLL = 3;
  const AUTO_HOLD_MS = 800, AUTO_COOLDOWN_MS = 1500;
  const DET_W = 240, DET_H = 320;

  const AZ_NAMES = { 0: 'Frente', 45: '3/4 direita', 90: 'Lateral direita', 135: '3/4 traseira dir.',
    180: 'Traseira', 225: '3/4 traseira esq.', 270: 'Lateral esquerda', 315: '3/4 esquerda' };
  const azName = az => AZ_NAMES[Math.round(az)] ?? `${Math.round(az)}°`;
  const ring = (el, n, off = 0) => Array.from({ length: n }, (_, i) => {
    const az = (off + i * 360 / n) % 360;
    return { az, el, label: `${azName(az)} · ${el}°` };
  });

  const PLANS = {
    rapido: { name: 'Rápido · 3 fotos', kind: 'ad', targets: [
      { az: 0, el: 15, label: 'Frente' },
      { az: 45, el: 25, label: '3/4 direita' },
      { az: 90, el: 15, label: 'Lateral direita' },
    ] },
    anuncio: { name: 'Anúncio · 7 fotos', kind: 'ad', targets: [
      { az: 0, el: 15, label: 'Frente' },
      { az: 45, el: 25, label: '3/4 direita' },
      { az: 90, el: 15, label: 'Lateral direita' },
      { az: 180, el: 15, label: 'Traseira' },
      { az: 270, el: 15, label: 'Lateral esquerda' },
      { az: 315, el: 25, label: '3/4 esquerda' },
      { az: 0, el: 65, label: 'Vista superior' },
    ] },
    scan24: { name: 'Scanner 3D · 24 fotos', kind: 'scan', targets: [
      ...ring(10, 8), ...ring(35, 8, 22.5), ...ring(60, 8),
    ] },
    scan40: { name: 'Scanner 3D detalhado · 40 fotos', kind: 'scan', targets: [
      ...ring(5, 12), ...ring(30, 12, 15), ...ring(55, 12), ...ring(80, 4, 45),
    ] },
  };

  const PT = { person: 'pessoa', bicycle: 'bicicleta', car: 'carro', motorcycle: 'moto', bottle: 'garrafa',
    'wine glass': 'taça', cup: 'xícara/copo', fork: 'garfo', knife: 'faca', spoon: 'colher', bowl: 'tigela',
    banana: 'banana', apple: 'maçã', orange: 'laranja', chair: 'cadeira', couch: 'sofá', 'potted plant': 'vaso de planta',
    bed: 'cama', 'dining table': 'mesa', toilet: 'vaso sanitário', tv: 'TV', laptop: 'notebook', mouse: 'mouse',
    remote: 'controle', keyboard: 'teclado', 'cell phone': 'celular', microwave: 'micro-ondas', oven: 'forno',
    toaster: 'torradeira', sink: 'pia', refrigerator: 'geladeira', book: 'livro', clock: 'relógio', vase: 'vaso',
    scissors: 'tesoura', 'teddy bear': 'pelúcia', 'hair drier': 'secador', toothbrush: 'escova de dentes',
    backpack: 'mochila', umbrella: 'guarda-chuva', handbag: 'bolsa', tie: 'gravata', suitcase: 'mala',
    frisbee: 'frisbee', skis: 'esquis', snowboard: 'snowboard', 'sports ball': 'bola', kite: 'pipa',
    'baseball bat': 'taco', 'baseball glove': 'luva', skateboard: 'skate', surfboard: 'prancha',
    'tennis racket': 'raquete', bench: 'banco', cat: 'gato', dog: 'cachorro', bird: 'pássaro',
    sandwich: 'sanduíche', pizza: 'pizza', donut: 'rosquinha', cake: 'bolo', broccoli: 'brócolis', carrot: 'cenoura',
    'hot dog': 'cachorro-quente', 'fire hydrant': 'hidrante', 'stop sign': 'placa', 'parking meter': 'parquímetro' };
  const ptName = c => PT[c] ?? c;

  // ------------------------------------------------------------------ Estado
  const S = {
    plan: 'anuncio', mode: 'walk', res: 'max', grid: true, requireObj: true, vibrate: true, auto: false,
    shots: [],                 // {id, blob, url, name, targetIndex, meta}
    done: new Map(),           // targetIndex -> shot id
    heading0: null,            // rumo da câmera na "Frente"
    pose: null,                // {heading, el, roll, t}
    vecHist: [],               // histórico p/ estabilidade
    hasSensor: false,
    model: null, preds: [], box: null, boxLabel: '', lastSeen: 0, locked: null,
    holdSince: 0, lastShotAt: 0, lastShotTarget: -1, busy: false,
    eval: null,
  };

  const $ = id => document.getElementById(id);
  const els = {
    start: $('start'), app: $('app'), startPlan: $('startPlan'), startMode: $('startMode'), btnStart: $('btnStart'),
    startError: $('startError'), video: $('video'), overlay: $('overlay'), viewfinder: $('viewfinder'),
    instruction: $('instruction'), ckFrame: $('ckFrame'), ckAngle: $('ckAngle'), ckHeight: $('ckHeight'), ckLevel: $('ckLevel'),
    modelStatus: $('modelStatus'), flash: $('flash'), targetLabel: $('targetLabel'), targetSub: $('targetSub'),
    radar: $('radar'), btnShutter: $('btnShutter'), btnGallery: $('btnGallery'), lastThumb: $('lastThumb'),
    shotCount: $('shotCount'), btnAuto: $('btnAuto'), planName: $('planName'), progressText: $('progressText'),
    progressBar: $('progressBar'), btnPlan: $('btnPlan'), btnSettings: $('btnSettings'), gallery: $('gallery'),
    galleryGrid: $('galleryGrid'), btnShare: $('btnShare'), btnZip: $('btnZip'), btnNewSession: $('btnNewSession'),
    settings: $('settings'), setPlan: $('setPlan'), setMode: $('setMode'), setRes: $('setRes'), setGrid: $('setGrid'),
    setRequireObj: $('setRequireObj'), setSound: $('setSound'), btnCalibrate: $('btnCalibrate'), toast: $('toast'),
  };

  // ------------------------------------------------------------------ Utilidades
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const norm360 = a => ((a % 360) + 360) % 360;
  const angDiff = (target, current) => { let d = norm360(target - current); if (d > 180) d -= 360; return d; }; // -180..180
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('fotoguia.prefs') || '{}');
      for (const k of ['plan', 'mode', 'res', 'grid', 'requireObj', 'vibrate', 'auto']) if (k in p) S[k] = p[k];
      if (!PLANS[S.plan]) S.plan = 'anuncio';
    } catch { /* sem armazenamento */ }
  }
  function savePrefs() {
    try {
      const { plan, mode, res, grid, requireObj, vibrate, auto } = S;
      localStorage.setItem('fotoguia.prefs', JSON.stringify({ plan, mode, res, grid, requireObj, vibrate, auto }));
    } catch { /* ignorar */ }
  }

  let toastTimer;
  function toast(msg, ms = 2200) {
    els.toast.textContent = msg; els.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ Sensores
  // Vetor de visada da câmera traseira (eixo -Z do aparelho) em coordenadas do mundo
  // (x = leste, y = norte, z = cima), a partir de alpha/beta/gamma (R = Rz·Rx·Ry).
  let smoothVec = null;
  function onOrientation(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    S.hasSensor = true;
    const a = rad(e.alpha), b = rad(e.beta), g = rad(e.gamma);
    const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
    const v = [-ca * sg - sa * sb * cg, -sa * sg + ca * sb * cg, -cb * cg];
    // Filtro passa-baixa no vetor (evita saltos de 359°→0°)
    if (!smoothVec) smoothVec = v;
    else smoothVec = smoothVec.map((s, i) => s + (v[i] - s) * 0.35);
    const [x, y, z] = smoothVec;
    const heading = norm360(deg(Math.atan2(x, y)));
    const el = deg(Math.asin(clamp(-z, -1, 1)));
    // Inclinação lateral (rolagem) do aparelho: componentes verticais dos eixos X e Y do aparelho
    const roll = deg(Math.atan2(-cb * sg, sb));
    const t = performance.now();
    S.pose = { heading, el, roll, t };
    S.vecHist.push({ v: v, t });
    while (S.vecHist.length && t - S.vecHist[0].t > 450) S.vecHist.shift();
  }

  function isStable() {
    if (!S.hasSensor) return true;
    const h = S.vecHist; if (h.length < 3) return false;
    const a = h[0].v, b = h[h.length - 1].v;
    const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
    return deg(Math.acos(dot)) < 1.8;
  }

  async function enableSensors() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); // iOS
        if (r !== 'granted') { toast('Sensores negados: guia de ângulo desativado.'); return; }
      }
    } catch { /* ignorar */ }
    window.addEventListener('deviceorientation', onOrientation);
  }

  const currentAz = () => (S.pose && S.heading0 != null) ? norm360(S.heading0 - S.pose.heading) : 0;

  // ------------------------------------------------------------------ Câmera
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não dá acesso à câmera (é preciso HTTPS).');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
    });
    els.video.srcObject = stream;
    await els.video.play();
    try { await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') { try { await navigator.wakeLock?.request('screen'); } catch { } }
    });
  }

  // Recorte central 3:4 do quadro nativo do vídeo (igual ao que o visor mostra com object-fit: cover)
  function cropRect(vw, vh) {
    if (vw / vh > ASPECT) { const w = vh * ASPECT; return { x: (vw - w) / 2, y: 0, w, h: vh }; }
    const h = vw / ASPECT; return { x: 0, y: (vh - h) / 2, w: vw, h };
  }

  // ------------------------------------------------------------------ Detecção de objetos
  const detCanvas = document.createElement('canvas');
  detCanvas.width = DET_W; detCanvas.height = DET_H;
  const detCtx = detCanvas.getContext('2d', { willReadFrequently: true });

  async function loadModel() {
    const t0 = Date.now();
    while (!(window.cocoSsd && window.tf)) {
      if (Date.now() - t0 > 20000) { els.modelStatus.textContent = 'IA indisponível — use o quadro‑alvo'; return; }
      await new Promise(r => setTimeout(r, 200));
    }
    try {
      // Modelo servido pela própria pasta do app (vendor/model), sem depender de servidores externos.
      S.model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: new URL('vendor/model/model.json', location.href).href });
      els.modelStatus.textContent = `IA ativa (${tf.getBackend()})`;
      detectLoop();
    } catch (err) {
      console.error(err);
      els.modelStatus.textContent = 'Falha ao carregar IA — use o quadro‑alvo';
    }
  }

  const iou = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / (a.w * a.h + b.w * b.h - inter || 1);
  };

  async function detectLoop() {
    const v = els.video;
    if (document.visibilityState !== 'visible' || !v.videoWidth) { setTimeout(detectLoop, 300); return; }
    const t0 = performance.now();
    try {
      const c = cropRect(v.videoWidth, v.videoHeight);
      detCtx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, DET_W, DET_H);
      const raw = await S.model.detect(detCanvas, 10, 0.3);
      S.preds = raw.map(p => ({ cls: p.class, score: p.score,
        box: { x: p.bbox[0] / DET_W, y: p.bbox[1] / DET_H, w: p.bbox[2] / DET_W, h: p.bbox[3] / DET_H } }));
      choosePrimary();
    } catch (err) { console.warn(err); }
    setTimeout(detectLoop, Math.max(20, 110 - (performance.now() - t0)));
  }

  // Escolhe o objeto principal: central, grande, confiável; prioriza o objeto travado / o anterior.
  function choosePrimary() {
    let best = null, bestScore = 0;
    for (const p of S.preds) {
      const b = p.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const central = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.7);
      let s = p.score * Math.sqrt(b.w * b.h) * (0.35 + central);
      if (p.cls === 'person') s *= 0.25;
      if (p.cls === 'dining table' || p.cls === 'bed') s *= 0.4;
      if (b.w > 0.97 && b.h > 0.97) s *= 0.3;
      if (S.locked) s *= (p.cls === S.locked ? 3 : 0.15);
      if (S.box && iou(S.box, b) > 0.3) s *= 1.6;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    const now = performance.now();
    if (best) {
      const nb = best.box;
      if (S.box && iou(S.box, nb) > 0.2) {
        const k = 0.45; // suavização exponencial
        S.box = { x: S.box.x + (nb.x - S.box.x) * k, y: S.box.y + (nb.y - S.box.y) * k,
          w: S.box.w + (nb.w - S.box.w) * k, h: S.box.h + (nb.h - S.box.h) * k };
      } else S.box = { ...nb };
      S.boxLabel = `${ptName(best.cls)} ${Math.round(best.score * 100)}%`;
      S.boxCls = best.cls;
      S.lastSeen = now;
    } else if (now - S.lastSeen > 900) { S.box = null; }
  }

  // ------------------------------------------------------------------ Avaliação (enquadramento + pose)
  const targets = () => PLANS[S.plan].targets;
  function nextTargetIndex() {
    const t = targets();
    for (let i = 0; i < t.length; i++) if (!S.done.has(i)) return i;
    return -1;
  }

  function evalFraming() {
    const b = S.box;
    if (!b) return { ok: false, na: !S.model, msg: S.model ? 'Procurando o objeto… centralize-o no quadro' : 'Posicione o objeto dentro do quadro' };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const fill = Math.max(b.w / ZONE.w, b.h / ZONE.h);
    const touching = b.x < 0.015 || b.y < 0.015 || b.x + b.w > 0.985 || b.y + b.h > 0.985;
    if (touching || fill > FILL_MAX) return { ok: false, msg: 'Afaste-se um pouco ⤢' };
    if (fill < FILL_MIN) return { ok: false, msg: 'Aproxime-se do objeto ⤡' };
    const dx = cx - 0.5, dy = cy - 0.5;
    if (Math.abs(dx) > CENTER_TOL || Math.abs(dy) > CENTER_TOL) {
      if (Math.abs(dx) >= Math.abs(dy)) return { ok: false, msg: dx > 0 ? 'Mova a câmera para a direita →' : '← Mova a câmera para a esquerda' };
      return { ok: false, msg: dy > 0 ? 'Aponte um pouco mais para baixo ↓' : 'Aponte um pouco mais para cima ↑' };
    }
    return { ok: true, msg: '' };
  }

  function evalPose(ti) {
    const res = { angle: { ok: true, na: false }, height: { ok: true, na: false }, level: { ok: true, na: false }, msgs: [], azDelta: 0, elDelta: 0 };
    if (ti < 0) return res;
    const tg = targets()[ti];
    if (!S.hasSensor || !S.pose) {
      res.angle.na = res.height.na = res.level.na = true;
      return res;
    }
    const { el, roll } = S.pose;
    // Nível (só faz sentido se a câmera não estiver apontando quase para baixo)
    if (el < 65) {
      if (Math.abs(roll) > TOL_ROLL) { res.level.ok = false; res.msgs.push(roll > 0 ? 'Gire o celular levemente no sentido horário ⟳' : 'Gire o celular levemente no sentido anti-horário ⟲'); }
    } else res.level.na = true;
    // Altura / elevação
    const dEl = tg.el - el; res.elDelta = dEl;
    if (Math.abs(dEl) > TOL_EL) {
      res.height.ok = false;
      res.msgs.push(dEl > 0 ? `Suba a câmera e incline para baixo (${Math.round(el)}° → ${tg.el}°)` : `Abaixe a câmera (${Math.round(el)}° → ${tg.el}°)`);
    }
    // Ângulo ao redor do objeto
    const tolAz = tg.el >= 70 ? TOL_AZ_HIGH : TOL_AZ;
    if (S.mode === 'walk') {
      if (S.heading0 == null) {
        if (tg.az !== 0) { res.angle.ok = false; res.msgs.push('Defina a frente: fique de frente para o objeto e toque em ⚙ → “Frente”'); }
      } else {
        const dAz = angDiff(tg.az, currentAz()); res.azDelta = dAz;
        if (Math.abs(dAz) > tolAz) {
          res.angle.ok = false;
          res.msgs.unshift(dAz > 0 ? `Caminhe para a DIREITA ao redor do objeto ↻ ${Math.round(dAz)}°` : `↺ Caminhe para a ESQUERDA ao redor do objeto ${Math.round(-dAz)}°`);
        }
      }
    } else {
      // Prato giratório: a câmera fica parada (mesmo rumo da frente); o objeto é que gira.
      if (S.heading0 != null) {
        const dAz = angDiff(0, currentAz()); res.azDelta = dAz;
        if (Math.abs(dAz) > tolAz) { res.angle.ok = false; res.msgs.unshift('Volte a câmera para a posição inicial (não ande, gire o objeto)'); }
      }
    }
    return res;
  }

  function evaluate() {
    const ti = nextTargetIndex();
    const fr = evalFraming();
    const po = evalPose(ti);
    // Sem detecção (IA indisponível ou objeto fora das classes conhecidas): se o usuário não exige
    // detecção, o enquadramento fica por conta dele, guiado pelo quadro-alvo.
    const frameSkip = !S.box && (!S.model || !S.requireObj);
    const frameOk = fr.ok || frameSkip;
    const poseOk = po.angle.ok && po.height.ok && po.level.ok;
    let msg, ok = false;
    if (ti < 0) msg = 'Sessão completa! Abra a galeria para exportar ✓';
    else if (po.msgs.length) msg = po.msgs[0];
    else if (!frameOk) msg = fr.msg;
    else {
      ok = true;
      msg = !fr.ok ? 'Ângulo certo — confira se o objeto preenche o quadro'
        : (S.auto ? 'Perfeito — segure firme…' : 'Perfeito — pode fotografar ✓');
    }
    S.eval = { ti, fr, po, frameOk, poseOk, ok, msg, autoReady: ti >= 0 && poseOk && frameOk };
    return S.eval;
  }

  // ------------------------------------------------------------------ Desenho
  const octx = els.overlay.getContext('2d');
  const rctx = els.radar.getContext('2d');

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = els.viewfinder.getBoundingClientRect();
    els.overlay.width = Math.round(r.width * dpr); els.overlay.height = Math.round(r.height * dpr);
    const rr = els.radar.getBoundingClientRect();
    els.radar.width = Math.round(rr.width * dpr); els.radar.height = Math.round(rr.height * dpr);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawOverlay(ev) {
    const c = octx, W = els.overlay.width, H = els.overlay.height, u = W / 360;
    c.clearRect(0, 0, W, H);

    if (S.grid) {
      c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1 * u;
      c.beginPath();
      for (const f of [1 / 3, 2 / 3]) { c.moveTo(W * f, 0); c.lineTo(W * f, H); c.moveTo(0, H * f); c.lineTo(W, H * f); }
      c.stroke();
    }

    // Quadro-alvo: onde o objeto deve ficar
    const zx = ZONE.x * W, zy = ZONE.y * H, zw = ZONE.w * W, zh = ZONE.h * H;
    const zoneColor = ev.fr.ok ? '#34d399' : '#fbbf24';
    c.save();
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath(); c.rect(0, 0, W, H); c.rect(zx, zy, zw, zh); c.fill('evenodd');
    c.strokeStyle = zoneColor; c.lineWidth = 4 * u; c.lineCap = 'round';
    const L = 26 * u;
    c.beginPath();
    for (const [x, y, sx, sy] of [[zx, zy, 1, 1], [zx + zw, zy, -1, 1], [zx, zy + zh, 1, -1], [zx + zw, zy + zh, -1, -1]]) {
      c.moveTo(x, y + sy * L); c.lineTo(x, y); c.lineTo(x + sx * L, y);
    }
    c.stroke();
    // tamanho mínimo ideal (área interna tracejada)
    const mw = zw * FILL_MIN, mh = zh * FILL_MIN;
    c.setLineDash([6 * u, 6 * u]); c.lineWidth = 1.5 * u; c.strokeStyle = 'rgba(255,255,255,.35)';
    c.strokeRect(W / 2 - mw / 2, H / 2 - mh / 2, mw, mh);
    c.setLineDash([]);
    // mira central
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5 * u;
    c.beginPath(); c.moveTo(W / 2 - 10 * u, H / 2); c.lineTo(W / 2 + 10 * u, H / 2); c.moveTo(W / 2, H / 2 - 10 * u); c.lineTo(W / 2, H / 2 + 10 * u); c.stroke();
    c.restore();

    // Outros objetos detectados (toque para travar)
    for (const p of S.preds) {
      if (S.box && iou(p.box, S.box) > 0.5) continue;
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5 * u; c.setLineDash([4 * u, 4 * u]);
      c.strokeRect(p.box.x * W, p.box.y * H, p.box.w * W, p.box.h * H); c.setLineDash([]);
    }

    // Objeto principal
    if (S.box) {
      const b = S.box, x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
      c.strokeStyle = ev.fr.ok ? '#34d399' : '#38bdf8'; c.lineWidth = 2.5 * u;
      roundRect(c, x, y, w, h, 8 * u); c.stroke();
      const label = (S.locked ? '🔒 ' : '') + S.boxLabel;
      c.font = `600 ${12 * u}px system-ui, sans-serif`;
      const tw = c.measureText(label).width + 12 * u;
      const ly = y > 22 * u ? y - 20 * u : y + 2 * u;
      c.fillStyle = ev.fr.ok ? '#34d399' : '#38bdf8'; roundRect(c, x, ly, tw, 18 * u, 5 * u); c.fill();
      c.fillStyle = '#04121b'; c.fillText(label, x + 6 * u, ly + 13 * u);
    }

    // Nível (horizonte)
    if (S.pose && !ev.po.level.na) {
      const ok = ev.po.level.ok;
      c.save(); c.translate(W / 2, H * 0.62); c.rotate(rad(S.pose.roll));
      c.strokeStyle = ok ? '#34d399' : '#fbbf24'; c.lineWidth = 2.5 * u;
      c.beginPath(); c.moveTo(-70 * u, 0); c.lineTo(-18 * u, 0); c.moveTo(18 * u, 0); c.lineTo(70 * u, 0); c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 1.5 * u;
      c.beginPath(); c.moveTo(W / 2 - 12 * u, H * 0.62); c.lineTo(W / 2 + 12 * u, H * 0.62); c.stroke();
    }

    // Medidor de elevação (lado direito)
    if (S.pose && ev.ti >= 0) {
      const tg = targets()[ev.ti];
      const gx = W - 18 * u, gy0 = H * 0.25, gh = H * 0.5;
      const yOf = e => gy0 + gh * clamp(e, 0, 90) / 90;
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 3 * u; c.lineCap = 'round';
      c.beginPath(); c.moveTo(gx, gy0); c.lineTo(gx, gy0 + gh); c.stroke();
      c.fillStyle = 'rgba(52,211,153,.35)';
      c.fillRect(gx - 7 * u, yOf(tg.el - TOL_EL), 14 * u, yOf(tg.el + TOL_EL) - yOf(tg.el - TOL_EL));
      c.fillStyle = ev.po.height.ok ? '#34d399' : '#fbbf24';
      c.beginPath(); c.arc(gx, yOf(S.pose.el), 6 * u, 0, Math.PI * 2); c.fill();
      c.font = `600 ${10 * u}px system-ui`; c.fillStyle = '#fff'; c.textAlign = 'right';
      c.fillText(`${Math.round(S.pose.el)}°`, gx - 10 * u, yOf(S.pose.el) + 4 * u); c.textAlign = 'left';
    }

    // Setas de direção ao redor do objeto
    if (S.mode === 'walk' && !ev.po.angle.ok && Math.abs(ev.po.azDelta) > 0) {
      const right = ev.po.azDelta > 0, cy = H * 0.5, ax = right ? W - 44 * u : 44 * u, s = right ? 1 : -1;
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
      c.fillStyle = `rgba(251,191,36,${pulse})`;
      for (const off of [0, 16]) {
        c.beginPath(); c.moveTo(ax + s * (off - 8) * u, cy - 18 * u); c.lineTo(ax + s * (off + 6) * u, cy); c.lineTo(ax + s * (off - 8) * u, cy + 18 * u);
        c.lineTo(ax + s * (off - 2) * u, cy); c.closePath(); c.fill();
      }
    }
  }

  function drawRadar(ev) {
    const c = rctx, W = els.radar.width, H = els.radar.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8;
    c.clearRect(0, 0, W, H);
    const pos = (az, el) => { const r = R * (1 - clamp(el, 0, 90) / 90) * 0.92 + R * 0.08; const p = rad(270 + az);
      return [cx + r * Math.cos(p), cy - r * Math.sin(p)]; };
    c.strokeStyle = '#2a313a'; c.lineWidth = 1;
    for (const e of [0, 30, 60]) { const r = R * (1 - e / 90) * 0.92 + R * 0.08; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); }
    // objeto ao centro
    c.fillStyle = '#9aa6b2'; c.fillRect(cx - 5, cy - 5, 10, 10);
    const t = targets(), dot = Math.max(3, R * 0.07);
    t.forEach((tg, i) => {
      const [x, y] = pos(tg.az, tg.el);
      c.beginPath(); c.arc(x, y, dot, 0, Math.PI * 2);
      if (S.done.has(i)) { c.fillStyle = '#34d399'; c.fill(); }
      else if (i === ev.ti) { c.fillStyle = '#fbbf24'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      else { c.strokeStyle = '#6b7684'; c.lineWidth = 1.5; c.stroke(); }
    });
    // posição atual
    if (S.pose) {
      const az = S.mode === 'walk' ? currentAz() : (ev.ti >= 0 ? t[ev.ti].az : 0);
      const [x, y] = pos(az, S.pose.el);
      c.fillStyle = '#38bdf8'; c.beginPath(); c.arc(x, y, dot * 0.9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(56,189,248,.7)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(cx, cy); c.stroke();
    }
    c.fillStyle = '#9aa6b2'; c.font = `${Math.round(R * 0.16)}px system-ui`; c.textAlign = 'center';
    c.fillText('frente', cx, H - 1);
  }

  function setCheck(el, st) {
    el.classList.toggle('ok', st.ok && !st.na); el.classList.toggle('bad', !st.ok && !st.na); el.classList.toggle('na', !!st.na);
  }

  function updateHud(ev) {
    els.instruction.textContent = ev.msg;
    els.instruction.classList.toggle('ok', ev.ok);
    setCheck(els.ckFrame, { ok: ev.fr.ok, na: ev.fr.na });
    setCheck(els.ckAngle, ev.po.angle); setCheck(els.ckHeight, ev.po.height); setCheck(els.ckLevel, ev.po.level);
    els.btnShutter.classList.toggle('ready', ev.ok);
    const t = targets();
    if (ev.ti >= 0) {
      const tg = t[ev.ti];
      els.targetLabel.textContent = `Próxima: ${tg.label}`;
      els.targetSub.textContent = S.mode === 'turntable'
        ? `Gire o objeto ${Math.round(tg.az)}° no sentido horário (visto de cima) · câmera a ${tg.el}°`
        : `Posição ${Math.round(tg.az)}° ao redor · câmera inclinada ${tg.el}°`;
    } else { els.targetLabel.textContent = 'Todas as posições capturadas'; els.targetSub.textContent = 'Exporte pela galeria'; }
  }

  function updateProgress() {
    const n = targets().length, d = S.done.size;
    els.planName.textContent = PLANS[S.plan].name;
    els.progressText.textContent = `${d}/${n}`;
    els.progressBar.style.width = `${(d / n) * 100}%`;
    els.shotCount.textContent = S.shots.length;
    const last = S.shots[S.shots.length - 1];
    if (last) els.lastThumb.src = last.url; else els.lastThumb.removeAttribute('src');
  }

  // ------------------------------------------------------------------ Loop principal
  function frame() {
    const ev = evaluate();
    drawOverlay(ev); drawRadar(ev); updateHud(ev);
    // captura automática
    const now = performance.now();
    if (S.auto && ev.autoReady && isStable() && !S.busy && now - S.lastShotAt > AUTO_COOLDOWN_MS) {
      if (!S.holdSince) S.holdSince = now;
      if (now - S.holdSince > AUTO_HOLD_MS) { S.holdSince = 0; capture(true); }
    } else S.holdSince = 0;
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ Captura
  function outputSize(crop) {
    if (S.res === 'max') return { w: Math.round(crop.w), h: Math.round(crop.w / ASPECT) };
    const h = Math.min(Number(S.res), Math.round(crop.h));
    return { w: Math.round(h * ASPECT), h };
  }

  async function capture(isAuto = false) {
    const v = els.video;
    if (S.busy || !v.videoWidth) return;
    const ti = nextTargetIndex();
    if (ti < 0) { toast('Todas as posições já foram capturadas. Abra a galeria.'); return; }
    S.busy = true;
    try {
      const tg = targets()[ti];
      // Calibração automática: a primeira foto define a referência de rumo
      if (S.hasSensor && S.pose && S.heading0 == null) S.heading0 = norm360(S.pose.heading + (S.mode === 'walk' ? tg.az : 0));

      const crop = cropRect(v.videoWidth, v.videoHeight);
      const out = outputSize(crop);
      const cv = document.createElement('canvas'); cv.width = out.w; cv.height = out.h;
      const cx = cv.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, out.w, out.h);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));

      els.flash.classList.remove('go'); void els.flash.offsetWidth; els.flash.classList.add('go');
      if (S.vibrate) navigator.vibrate?.(40);

      const idx = S.shots.length + 1;
      const name = `${String(idx).padStart(2, '0')}_az${String(Math.round(tg.az)).padStart(3, '0')}_el${String(tg.el).padStart(2, '0')}.jpg`;
      const meta = {
        file: name, targetIndex: ti, targetLabel: tg.label, target: { azimuth: tg.az, elevation: tg.el },
        measured: S.pose ? {
          azimuth: S.mode === 'walk' ? +currentAz().toFixed(1) : null,
          elevation: +S.pose.el.toFixed(1), roll: +S.pose.roll.toFixed(1), heading: +S.pose.heading.toFixed(1),
        } : null,
        object: S.box ? { class: S.boxCls, bbox: Object.fromEntries(Object.entries(S.box).map(([k, val]) => [k, +val.toFixed(4)])) } : null,
        width: out.w, height: out.h, auto: isAuto, mode: S.mode, time: new Date().toISOString(),
      };
      const shot = { id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), blob, url: URL.createObjectURL(blob), name, targetIndex: ti, meta };
      S.shots.push(shot); S.done.set(ti, shot.id);
      S.lastShotAt = performance.now(); S.lastShotTarget = ti;
      updateProgress();
      if (nextTargetIndex() < 0) toast('Sessão completa! Abra a galeria para exportar.', 3500);
    } catch (err) {
      console.error(err); toast('Erro ao capturar a foto.');
    } finally { S.busy = false; }
  }

  // ------------------------------------------------------------------ Galeria / exportação
  function renderGallery() {
    const g = els.galleryGrid; g.innerHTML = '';
    if (!S.shots.length) { g.innerHTML = '<p class="gallery-empty">Nenhuma foto ainda.</p>'; return; }
    for (const s of S.shots) {
      const f = document.createElement('figure');
      const img = document.createElement('img'); img.src = s.url; img.alt = s.meta.targetLabel; img.loading = 'lazy';
      img.addEventListener('click', () => window.open(s.url, '_blank'));
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.title = 'Excluir e refazer';
      del.addEventListener('click', () => removeShot(s.id));
      const cap = document.createElement('figcaption'); cap.textContent = `${s.meta.targetLabel}\n${s.meta.width}×${s.meta.height}`;
      cap.style.whiteSpace = 'pre-line';
      f.append(img, del, cap); g.append(f);
    }
  }

  function removeShot(id) {
    const i = S.shots.findIndex(s => s.id === id); if (i < 0) return;
    const [s] = S.shots.splice(i, 1);
    URL.revokeObjectURL(s.url);
    if (S.done.get(s.targetIndex) === id) S.done.delete(s.targetIndex);
    renderGallery(); updateProgress();
  }

  function sessionName() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `fotoguia_${S.plan}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function posesJson() {
    return JSON.stringify({
      app: 'FotoGuia 3D', version: 1, plan: S.plan, planName: PLANS[S.plan].name, mode: S.mode, aspect: '3:4',
      conventions: {
        azimuth: 'graus ao redor do objeto; 0 = frente; aumenta caminhando para a direita (objeto visto de cima: sentido anti-horário)',
        elevation: 'graus que a câmera aponta abaixo do horizonte; 0 = altura do objeto; 90 = vista de cima',
      },
      shots: S.shots.map(s => s.meta),
    }, null, 2);
  }

  async function buildZip() {
    if (!window.JSZip) throw new Error('Biblioteca de ZIP não carregou (verifique a internet).');
    const zip = new JSZip(), name = sessionName(), folder = zip.folder(name);
    for (const s of S.shots) folder.file(s.name, s.blob);
    folder.file('poses.json', posesJson());
    folder.file('LEIA-ME.txt', [
      'Fotos geradas pelo FotoGuia 3D (proporção 3:4).',
      'poses.json: ângulo planejado e medido de cada foto.',
      '',
      'Para modelagem 3D (fotogrametria), importe a pasta inteira em Meshroom (AliceVision),',
      'RealityScan/RealityCapture, Metashape, COLMAP ou similares.',
    ].join('\r\n'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return { blob, filename: `${name}.zip` };
  }

  function download(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function onZip() {
    if (!S.shots.length) return toast('Nenhuma foto para exportar.');
    els.btnZip.disabled = true; els.btnZip.textContent = 'Gerando ZIP…';
    try { const { blob, filename } = await buildZip(); download(blob, filename); }
    catch (e) { toast(e.message); }
    finally { els.btnZip.disabled = false; els.btnZip.textContent = 'Baixar ZIP (fotos + poses)'; }
  }

  async function onShare() {
    if (!S.shots.length) return toast('Nenhuma foto para compartilhar.');
    try {
      let files;
      if (PLANS[S.plan].kind === 'ad' && S.shots.length <= 10) {
        files = S.shots.map(s => new File([s.blob], s.name, { type: 'image/jpeg' }));
      } else {
        const { blob, filename } = await buildZip();
        files = [new File([blob], filename, { type: 'application/zip' })];
      }
      if (navigator.canShare?.({ files })) await navigator.share({ files, title: 'Fotos do produto' });
      else { toast('Compartilhamento não suportado aqui — baixando ZIP.'); onZip(); }
    } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar.'); }
  }

  function newSession() {
    for (const s of S.shots) URL.revokeObjectURL(s.url);
    S.shots = []; S.done.clear(); S.heading0 = null; S.lastShotTarget = -1;
    renderGallery(); updateProgress();
  }

  // ------------------------------------------------------------------ Interface
  function fillPlanSelect(sel) {
    sel.innerHTML = '';
    for (const [k, p] of Object.entries(PLANS)) { const o = document.createElement('option'); o.value = k; o.textContent = p.name; sel.append(o); }
    sel.value = S.plan;
  }

  function changePlan(plan) {
    if (plan === S.plan) return;
    if (S.shots.length && !confirm('Trocar a sessão apaga as fotos atuais. Exporte antes se precisar. Continuar?')) {
      els.setPlan.value = S.plan; return;
    }
    S.plan = plan; savePrefs(); newSession();
  }

  function openSheet(el) { el.hidden = false; }
  function closeSheet(el) { el.hidden = true; }

  function bindUi() {
    els.btnShutter.addEventListener('click', () => capture(false));
    els.btnAuto.addEventListener('click', () => {
      S.auto = !S.auto; els.btnAuto.setAttribute('aria-pressed', String(S.auto)); savePrefs();
      toast(S.auto ? 'Captura automática ligada: fotografa quando tudo estiver verde.' : 'Captura automática desligada.');
    });
    els.btnGallery.addEventListener('click', () => { renderGallery(); openSheet(els.gallery); });
    els.btnSettings.addEventListener('click', () => openSheet(els.settings));
    els.btnPlan.addEventListener('click', () => openSheet(els.settings));
    for (const sh of [els.gallery, els.settings]) {
      sh.addEventListener('click', e => { if (e.target === sh || e.target.closest('[data-close]')) closeSheet(sh); });
    }
    els.btnZip.addEventListener('click', onZip);
    els.btnShare.addEventListener('click', onShare);
    els.btnNewSession.addEventListener('click', () => {
      if (S.shots.length && !confirm('Apagar todas as fotos desta sessão?')) return;
      newSession(); closeSheet(els.gallery);
    });

    fillPlanSelect(els.setPlan);
    els.setPlan.addEventListener('change', e => changePlan(e.target.value));
    els.setMode.value = S.mode;
    els.setMode.addEventListener('change', e => {
      S.mode = e.target.value; S.heading0 = null; savePrefs();
      toast('Modo alterado: a próxima foto redefine a referência de ângulo.');
    });
    els.setRes.value = S.res;
    els.setRes.addEventListener('change', e => { S.res = e.target.value; savePrefs(); });
    els.setGrid.checked = S.grid;
    els.setGrid.addEventListener('change', e => { S.grid = e.target.checked; savePrefs(); });
    els.setRequireObj.checked = S.requireObj;
    els.setRequireObj.addEventListener('change', e => { S.requireObj = e.target.checked; savePrefs(); });
    els.setSound.checked = S.vibrate;
    els.setSound.addEventListener('change', e => { S.vibrate = e.target.checked; savePrefs(); });
    els.btnCalibrate.addEventListener('click', () => {
      if (!S.pose) return toast('Sensores de movimento indisponíveis neste aparelho.');
      S.heading0 = S.pose.heading; toast('Posição atual definida como Frente (0°).'); closeSheet(els.settings);
    });
    els.btnAuto.setAttribute('aria-pressed', String(S.auto));

    // Toque no visor: travar/destravar objeto
    els.overlay.addEventListener('click', e => {
      const r = els.overlay.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const hit = S.preds.filter(p => x >= p.box.x && x <= p.box.x + p.box.w && y >= p.box.y && y <= p.box.y + p.box.h)
        .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
      if (hit) { S.locked = hit.cls; S.box = { ...hit.box }; toast(`Objeto travado: ${ptName(hit.cls)}`); }
      else if (S.locked) { S.locked = null; toast('Objeto destravado'); }
    });

    window.addEventListener('resize', resizeCanvases);
    window.addEventListener('beforeunload', e => { if (S.shots.length) { e.preventDefault(); e.returnValue = ''; } });
  }

  async function start() {
    els.btnStart.disabled = true; els.startError.hidden = true;
    S.plan = els.startPlan.value; S.mode = els.startMode.value; savePrefs();
    try {
      await enableSensors();           // precisa ser no gesto do usuário (iOS)
      await startCamera();
    } catch (err) {
      console.error(err);
      els.startError.textContent = err.name === 'NotAllowedError' ? 'Permissão da câmera negada.' : (err.message || 'Não foi possível abrir a câmera.');
      els.startError.hidden = false; els.btnStart.disabled = false; return;
    }
    els.start.hidden = true; els.app.hidden = false;
    bindUi(); resizeCanvases(); updateProgress();
    setTimeout(() => { if (!S.hasSensor) toast('Sem sensores de movimento: o guia de ângulo fica desativado.', 3500); }, 2500);
    requestAnimationFrame(frame);
    loadModel();
  }

  // ------------------------------------------------------------------ Inicialização
  loadPrefs();
  fillPlanSelect(els.startPlan);
  els.startMode.value = S.mode;
  els.btnStart.addEventListener('click', start);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
  }
})();
