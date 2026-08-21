/* ISM Academy hidden easter eggs.
   Kept separate from app.js so the main site logic stays easier to maintain. */
(function () {
  const BASE = '.';
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown',
                  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
                  'b','a'];
  const ISAJANG_TRIGGER = 'dltkwkdchlrh';
  const RED_MOON_DURATION = 5000;

  /* 적월극장은 원래 엘리나리제 상세에서 '적월극장'을 타이핑해야 했다. 아무도
     그걸 시도할 이유가 없었고, 모바일에서는 키보드가 없어 아예 닿을 수 없었다.
     이제는 명함을 다섯 번 두드리면 열린다 — 누르는 재미가 있으면 사람은
     한 번 더 누른다. */
  const RED_MOON_CLICKS = 5;
  const RED_MOON_CLICK_WINDOW = 700;
  const ELINALISE_CODE = 'EB';

  let konamiIdx = 0;
  let easterActive = false;
  let isajangBuffer = '';
  let audioCtx = null;
  const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function shouldReduceMotion() {
    return !!reduceMotionQuery?.matches;
  }

  function getEasterAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTiring() {
    try {
      const ctx = getEasterAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      [[1760, 0, 0.12, 0.32], [2093, 0.1, 0.18, 0.24]].forEach(([freq, delay, dur, gain]) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + delay;
        env.gain.setValueAtTime(gain, t0);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      });
    } catch {}
  }

  function isTypingField(target) {
    return target?.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '');
  }

  function isMainSection() {
    if (typeof window.getISMCurrentSection === 'function') {
      return window.getISMCurrentSection() === 'main';
    }
    return document.getElementById('section-main')?.classList.contains('active');
  }

  function isElinaliseDetail() {
    return window.getISMCurrentDetailCode?.() === 'EB' &&
      document.getElementById('char-detail')?.classList.contains('open');
  }

  function startRedMoonSound() {
    try {
      const ctx = getEasterAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const master = ctx.createGain();
      master.gain.value = 0.06;
      master.connect(ctx.destination);

      const melody = [
        523.25, 659.25, 783.99, 659.25,
        587.33, 659.25, 523.25, 392.00,
        440.00, 523.25, 659.25, 523.25,
        493.88, 587.33, 392.00, 392.00,
      ];
      const bassRoots = [130.81, 196.00, 146.83, 196.00];
      const offbeatChords = [
        [261.63, 329.63, 392.00],
        [392.00, 493.88, 587.33],
        [293.66, 369.99, 440.00],
        [392.00, 493.88, 587.33],
      ];

      function playTone(frequency, type, start, duration, peak, ornament = false) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(ornament ? frequency * 1.08 : frequency, start);
        if (ornament) osc.frequency.exponentialRampToValueAtTime(frequency, start + 0.035);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.009);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      }

      let step = 0;
      const playTrotBeat = () => {
        const now = ctx.currentTime + 0.006;
        const harmonyIndex = Math.floor(step / 2) % bassRoots.length;

        playTone(melody[step % melody.length], 'square', now, 0.145, 0.22, true);
        playTone(melody[step % melody.length] * 0.5, 'sine', now, 0.13, 0.12);

        if (step % 2 === 0) {
          playTone(bassRoots[harmonyIndex], 'triangle', now, 0.18, 0.62);
        } else {
          offbeatChords[harmonyIndex].forEach(frequency => {
            playTone(frequency, 'triangle', now, 0.11, 0.16);
          });
        }

        playTone(step % 2 ? 1760 : 1320, 'sine', now, 0.038, 0.10);
        step += 1;
      };
      playTrotBeat();
      const loop = setInterval(playTrotBeat, 190);

      return () => {
        clearInterval(loop);
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        setTimeout(() => {
          master.disconnect();
        }, 100);
      };
    } catch {
      return () => {};
    }
  }

  /* 다섯 번째 클릭의 보상. 적월극장이 열리기 전에 엘리나리제가 화면을
     통째로 차지하고 한 번 들여다본다. 곱게 등장하면 재미가 없으므로
     과하게 크게, 살짝 비딱하게 밀고 들어온다. */
  function playElinaliseTaunt() {
    return new Promise(resolve => {
      const reducedMotion = shouldReduceMotion();
      const stage = document.createElement('div');
      stage.className = reducedMotion ? 'redmoon-taunt is-reduced-motion' : 'redmoon-taunt';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML = `<img src="${BASE}/${ELINALISE_CODE}/D/10.webp" alt="" decoding="async">`;
      document.body.appendChild(stage);

      requestAnimationFrame(() => stage.classList.add('is-visible'));
      playTiring();

      window.setTimeout(() => {
        stage.classList.add('is-leaving');
        window.setTimeout(() => {
          stage.remove();
          resolve();
        }, reducedMotion ? 120 : 260);
      }, reducedMotion ? 700 : 1500);
    });
  }

  function triggerRedMoonEaster() {
    if (easterActive) return;
    easterActive = true;

    const reducedMotion = shouldReduceMotion();
    const overlay = document.createElement('div');
    overlay.id = 'redmoon-easter';
    overlay.className = reducedMotion ? 'redmoon-easter is-reduced-motion' : 'redmoon-easter';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.duration = String(RED_MOON_DURATION);
    overlay.innerHTML = `
      <img class="redmoon-burst redmoon-burst--left" src="${BASE}/RD/D/10.webp" alt="" width="768" height="1344" decoding="async">
      <img class="redmoon-poster" src="${BASE}/assets/easter/red-moon-theater.webp" alt="">
      <img class="redmoon-burst redmoon-burst--right" src="${BASE}/RB/D/10.webp" alt="" width="768" height="1344" decoding="async">
      <img class="redmoon-louise" src="${BASE}/LB/D/16.webp" alt="">
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('redmoon-easter-active');

    const stopSound = startRedMoonSound();
    let finished = false;
    let beatTimer = null;
    let cleanupTimer = null;

    const pulse = () => {
      overlay.classList.remove('is-beat');
      void overlay.offsetWidth;
      overlay.classList.add('is-beat');
    };

    function cleanup() {
      if (finished) return;
      finished = true;
      easterActive = false;
      clearInterval(beatTimer);
      clearTimeout(cleanupTimer);
      stopSound();
      document.removeEventListener('keydown', cancelOnEscape, true);
      document.removeEventListener('pointerdown', cleanup, true);
      document.body.classList.remove('redmoon-easter-active');
      overlay.classList.add('is-leaving');
      setTimeout(() => overlay.remove(), 220);
    }

    function cancelOnEscape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();
    }

    document.addEventListener('keydown', cancelOnEscape, true);
    /* 예전에는 타이핑으로만 열려서 Escape만 있어도 됐다. 이제는 명함을 눌러
       여는 방식이라 키보드가 없는 화면에서도 열린다 — 닫을 방법도 손가락으로
       닿아야 한다. 다른 이스터에그와 같은 규칙(아무 데나 누르면 닫힘)이다. */
    document.addEventListener('pointerdown', cleanup, true);
    overlay.classList.add('is-visible');
    pulse();
    if (!reducedMotion) beatTimer = setInterval(pulse, 510);
    cleanupTimer = setTimeout(cleanup, RED_MOON_DURATION);
  }

  function triggerEasterEgg(options = {}) {
    easterActive = true;

    const SCARLET_IMG = options.image || `${BASE}/SC/D/10.webp`;
    const FINALE_IMG = options.finaleImage || SCARLET_IMG;
    const EASTER_TITLE = options.title || 'Infinity Scarlet Master';
    const EASTER_SUBTITLE = options.subtitle !== undefined ? options.subtitle : '-DOYA-';
    const reducedMotion = shouldReduceMotion();
    const DURATION = reducedMotion ? 6000 : 10000;
    const FINALE_MS = reducedMotion ? 1200 : 2000;
    const COUNT = reducedMotion ? 12 : 60;
    let cleanupTimer = null;
    let finaleTimer = null;
    let startTimer = null;
    let tiringLoop = null;
    let pulseLoop = null;
    let cleanedUp = false;
    let finaleStarted = false;

    const logo = document.querySelector('.main-logo-wrap');
    if (logo) {
      logo.style.transition = 'opacity 0.35s';
      logo.style.opacity = '0';
    }

    const overlay = document.createElement('div');
    overlay.id = 'konami-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '100001',
      overflow: 'hidden',
      pointerEvents: 'none',
      background: 'rgba(5,11,24,0)',
      transformOrigin: '50% 50%',
      willChange: 'transform, filter',
    });
    document.body.appendChild(overlay);
    document.body.classList.add('konami-pulse-active');

    const overlayTitle = document.createElement('div');
    overlayTitle.className = 'konami-easter-title';
    overlayTitle.innerHTML = EASTER_SUBTITLE
      ? `${EASTER_TITLE}<br><span>${EASTER_SUBTITLE}</span>`
      : EASTER_TITLE;
    overlay.appendChild(overlayTitle);

    const motto = document.getElementById('main-motto');
    let mottoInterval = null;
    if (motto) {
      const origHTML = motto.innerHTML;
      const origStyle = motto.getAttribute('style') || '';
      const origClass = motto.className;

      motto.innerHTML = EASTER_SUBTITLE
        ? `${EASTER_TITLE}<br><span class="easter-subtitle">${EASTER_SUBTITLE}</span>`
        : EASTER_TITLE;
      Object.assign(motto.style, {
        fontSize: 'clamp(2.2rem, 7vw, 4.8rem)',
        fontWeight: '700',
        color: 'var(--gold2)',
        opacity: '0',
        textShadow: '0 0 30px rgba(201,168,76,0.7), 0 0 60px rgba(201,168,76,0.35)',
        position: 'relative',
        zIndex: '100001',
        transition: 'none',
        letterSpacing: '0.04em',
      });

      let pulse = 1;
      let dir = 1;
      const PULSE_MIN = 0.82;
      const PULSE_MAX = 1.22;
      const PULSE_SPEED = 0.03;
      if (!reducedMotion) {
        mottoInterval = setInterval(() => {
          pulse += dir * PULSE_SPEED;
          if (pulse >= PULSE_MAX) { pulse = PULSE_MAX; dir = -1; }
          if (pulse <= PULSE_MIN) { pulse = PULSE_MIN; dir = 1; }
          motto.style.transform = `scale(${pulse.toFixed(3)})`;
        }, 16);
      }

      overlay._restoreMotto = () => {
        if (mottoInterval) clearInterval(mottoInterval);
        motto.innerHTML = origHTML;
        motto.removeAttribute('style');
        if (origStyle) motto.setAttribute('style', origStyle);
        motto.className = origClass;
      };
    }

    overlay.animate([{background:'rgba(5,11,24,0)'},{background:'rgba(5,11,24,0.55)'}],
      {duration:400, fill:'forwards'});

    const particles = [];
    let rafId = null;

    function cleanupEasterEgg() {
      if (cleanedUp) return;
      cleanedUp = true;
      easterActive = false;

      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (finaleTimer) clearTimeout(finaleTimer);
      if (startTimer) clearTimeout(startTimer);
      if (tiringLoop) clearInterval(tiringLoop);
      if (pulseLoop) clearInterval(pulseLoop);
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('pointerdown', cleanupEasterEgg, true);
      document.body.classList.remove('konami-pulse-active', 'konami-pulse-hit', 'konami-finale-active');
      overlay.classList.remove('konami-overlay-thump');
      particles.length = 0;

      if (overlay._restoreMotto) overlay._restoreMotto();
      (overlay._imgs || []).forEach(img => { img.style.opacity = '0'; });
      overlay.animate([{background:'rgba(5,11,24,0.55)'},{background:'rgba(5,11,24,0)'}],
        {duration:360, fill:'forwards'});

      if (logo) setTimeout(() => { logo.style.opacity = '1'; }, 160);
      setTimeout(() => { overlay.remove(); }, 420);
    }

    function pulseScreen() {
      if (finaleStarted) return;
      document.body.classList.remove('konami-pulse-hit');
      overlay.classList.remove('konami-overlay-thump');
      void document.body.offsetWidth;
      document.body.classList.add('konami-pulse-hit');
      overlay.classList.add('konami-overlay-thump');
      playTiring();
    }

    function startFinale() {
      if (cleanedUp || finaleStarted) return;
      finaleStarted = true;
      if (pulseLoop) clearInterval(pulseLoop);
      document.body.classList.remove('konami-pulse-hit');
      document.body.classList.add('konami-finale-active');
      overlay.classList.remove('konami-overlay-thump');

      const master = document.createElement('img');
      master.src = FINALE_IMG;
      master.className = 'konami-master-scarlet';
      overlay.appendChild(master);
      overlay._imgs = overlay._imgs || [];
      overlay._imgs.push(master);

      overlay.animate([
        { background: 'rgba(5,11,24,0.55)' },
        { background: 'rgba(5,11,24,0.78)' },
      ], { duration: 600, fill: 'forwards' });

      requestAnimationFrame(() => {
        master.classList.add('rise');
      });

      finaleTimer = setTimeout(cleanupEasterEgg, FINALE_MS);
    }

    function physicsLoop() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        if (p.x < -p.size) { p.x = -p.size; p.vx *= -1; }
        if (p.x > W) { p.x = W; p.vx *= -1; }
        if (p.y < -p.size) { p.y = -p.size; p.vy *= -1; }
        if (p.y > H) { p.y = H; p.vy *= -1; }
        p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg)`;
      });
      if (easterActive) rafId = requestAnimationFrame(physicsLoop);
    }

    function spawnImg(delayMs) {
      setTimeout(() => {
        if (!easterActive) return;
        const img = document.createElement('img');
        img.src = SCARLET_IMG;

        const size = 80 + Math.random() * 260;
        const startX = Math.random() * window.innerWidth;
        const startY = Math.random() * window.innerHeight;
        const angle = Math.random() * 360;
        const vx = (Math.random() - 0.5) * 18;
        const vy = (Math.random() - 0.5) * 18;
        const spin = (Math.random() - 0.5) * 10;

        Object.assign(img.style, {
          position: 'absolute',
          zIndex: '1',
          width: size + 'px',
          height: 'auto',
          left: '0',
          top: '0',
          transform: `translate3d(${startX}px, ${startY}px, 0) rotate(${angle}deg)`,
          opacity: '0',
          transition: 'opacity 0.2s',
          borderRadius: '6px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          objectFit: 'contain',
          willChange: 'transform',
        });
        overlay.appendChild(img);
        requestAnimationFrame(() => { img.style.opacity = '1'; });

        particles.push({ el: img, x: startX, y: startY, rot: angle, vx, vy, spin, size });
        overlay._imgs = overlay._imgs || [];
        overlay._imgs.push(img);

        if (!reducedMotion) playTiring();
      }, delayMs);
    }

    document.addEventListener('pointerdown', cleanupEasterEgg, true);
    pulseScreen();
    if (!reducedMotion) pulseLoop = setInterval(pulseScreen, 430);

    startTimer = setTimeout(() => {
      rafId = requestAnimationFrame(physicsLoop);
      for (let i = 0; i < COUNT; i++) spawnImg(Math.random() * 600);

      if (!reducedMotion) tiringLoop = setInterval(() => {
        if (!easterActive) {
          clearInterval(tiringLoop);
          return;
        }
        playTiring();
      }, 280);
    }, reducedMotion ? 260 : 500);

    cleanupTimer = setTimeout(startFinale, DURATION);
  }


  function isUiOverlayActiveForEaster() {
    return document.body.classList.contains('lightbox-open') ||
      document.body.classList.contains('mobile-nav-open') ||
      document.getElementById('lightbox')?.classList.contains('open') ||
      document.getElementById('char-detail')?.classList.contains('show') ||
      document.getElementById('char-detail')?.classList.contains('open') ||
      document.getElementById('char-detail-overlay')?.classList.contains('show') ||
      document.getElementById('char-detail-overlay')?.classList.contains('open');
  }

  function routeLightboxKeyboardFirst(e) {
    const controls = window.ISMLightboxControls;
    if (!controls?.isOpen?.()) return false;
    if (typeof controls.handleKeyboard === 'function') {
      return !!controls.handleKeyboard(e);
    }
    if (e.key === 'Escape') {
      controls.close?.();
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      controls.navigate?.(-1);
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      controls.navigate?.(1);
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    return false;
  }

  function konamiCheck(key) {
    if (easterActive) return;
    const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
    if (normalizedKey === KONAMI[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === KONAMI.length) {
        konamiIdx = 0;
        triggerEasterEgg();
      }
      return;
    }
    konamiIdx = (normalizedKey === KONAMI[0]) ? 1 : 0;
  }

  function isajangCheck(e) {
    if (easterActive || !isMainSection() || isTypingField(e.target)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;

    isajangBuffer = (isajangBuffer + e.key.toLowerCase()).slice(-ISAJANG_TRIGGER.length);
    if (isajangBuffer === ISAJANG_TRIGGER) {
      isajangBuffer = '';
      konamiIdx = 0;
      triggerEasterEgg({
        image: `${BASE}/SH/D/07.webp`,
        finaleImage: `${BASE}/SH/D/05.webp`,
        title: 'Isajang Sexy Master',
        subtitle: '',
      });
    }
  }

  /* 명함 두드리기. 명함 자체는 이제 아무 동작도 갖지 않으므로 가로챌 것도
     되돌려 줄 것도 없다. 창 안에서 조용히 세기만 한다. */
  let cardClickCount = 0;
  let cardClickTimer = null;
  let cardStreakStage = null;

  function resetCardStreak() {
    window.clearTimeout(cardClickTimer);
    cardClickTimer = null;
    cardClickCount = 0;
    cardStreakStage?.classList.remove('is-easter-bouncing');
    cardStreakStage = null;
  }

  function bounceCard(stage) {
    if (shouldReduceMotion()) return;
    stage.classList.remove('is-easter-bouncing');
    void stage.offsetWidth;
    stage.classList.add('is-easter-bouncing');
  }

  function elinaliseCardClick(event) {
    if (easterActive) return;
    const stage = event.target.closest?.('.cdp-business-card-stage');
    if (!stage || !isElinaliseDetail()) return;

    cardStreakStage = stage;
    cardClickCount += 1;
    bounceCard(stage);
    stage.dataset.easterProgress = String(cardClickCount);

    if (cardClickCount >= RED_MOON_CLICKS) {
      const streakStage = cardStreakStage;
      resetCardStreak();
      delete streakStage.dataset.easterProgress;
      konamiIdx = 0;
      isajangBuffer = '';
      playElinaliseTaunt().then(triggerRedMoonEaster);
      return;
    }

    window.clearTimeout(cardClickTimer);
    cardClickTimer = window.setTimeout(() => {
      const streakStage = cardStreakStage;
      resetCardStreak();
      if (streakStage?.isConnected) delete streakStage.dataset.easterProgress;
    }, RED_MOON_CLICK_WINDOW);
  }

  document.addEventListener('click', elinaliseCardClick);

  document.addEventListener('keydown', e => {
    // Lightbox keyboard ownership lives in app.js. Easter handling only observes
    // keys that were not consumed by an active application overlay.
    if (e.defaultPrevented) return;
    if (isUiOverlayActiveForEaster()) {
      konamiIdx = 0;
      isajangBuffer = '';
      return;
    }
    konamiCheck(e.key);
    isajangCheck(e);
  });

  window.ISMEaster = {
    trigger: triggerEasterEgg,
    triggerRedMoon: triggerRedMoonEaster,
    get active() { return easterActive; },
  };
})();
