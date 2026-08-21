const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// The scroll index order. The accessibility snapshot is taken right after this
// list has been walked, so the expected resting section is derived from the list
// rather than hard-coded — the two drifted apart once already.
const SCROLL_SECTION_IDS = ['main', 'factions', 'world', 'schedule', 'characters'];
const LAST_SCROLL_SECTION_ID = SCROLL_SECTION_IDS[SCROLL_SECTION_IDS.length - 1];

function readOption(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge was not found. Set CHROME_PATH and retry.');
  return found;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { method, resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message);
          error.name = 'CdpProtocolError';
          error.code = message.error.code;
          error.data = message.error.data;
          error.method = method;
          reject(error);
        } else {
          resolve(message.result || {});
        }
        return;
      }
      if (message.method) this.events.push(message);
    });
    this.socket.addEventListener('close', () => {
      const error = new Error('Chrome DevTools Protocol connection closed.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
  }

  isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        reject(new Error(`Cannot send ${method}: Chrome DevTools Protocol connection is not open.`));
        return;
      }
      this.pending.set(id, { method, resolve, reject });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.socket?.close();
  }
}

async function waitForJson(url, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome may need a moment to expose the debugging endpoint.
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function isTransientNavigationError(error) {
  const message = String(error?.message || '');
  return error?.method === 'Runtime.evaluate' && (
    message.includes('Inspected target navigated or closed') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id') ||
    message.includes('No execution context with given id')
  );
}

async function evaluate(cdp, expression, { navigationRetries = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= navigationRetries; attempt += 1) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === navigationRetries || !cdp.isOpen()) throw error;
      await sleep(140 * (attempt + 1));
    }
  }
  throw lastError;
}

async function waitForCondition(cdp, expression, { timeoutMs = 3000, intervalMs = 80 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = false;
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, expression);
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  return lastValue;
}

async function waitForRequiredCondition(cdp, expression, message, options = {}) {
  const matched = await waitForCondition(cdp, expression, options);
  if (matched) return matched;
  throw new Error(message);
}

async function waitForApp(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 갤러리는 별도 페이지라 명부 카드가 없다. 그 페이지는 에셋 목록이 채워지면
    // 준비된 것으로 본다.
    const state = await evaluate(cdp, `({
      ready: document.readyState,
      loading: document.body?.classList.contains('js-loading'),
      galleryPage: document.body?.dataset.page === 'gallery',
      expected: window.ISMAppDiagnostics?.getCharacters().length || 0,
      cards: document.querySelectorAll('.char-card[data-code]').length,
      assets: document.querySelectorAll('#emo-sidebar .assets-char-item').length
    })`);
    if (state.ready === 'complete' && !state.loading) {
      if (state.galleryPage ? state.assets > 0 : (state.expected > 0 && state.cards === state.expected)) return state;
    }
    await sleep(100);
  }
  throw new Error('The application did not finish initial loading.');
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 768,
    screenWidth: width,
    screenHeight: height,
  });
}

async function clickPoint(cdp, point) {
  // Headless Chrome can keep a newly-created CDP target in the background.
  // Mouse and keyboard input sent to a background target may be silently ignored.
  await cdp.send('Page.bringToFront');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function pressKey(cdp, key, code = key, modifiers = 0) {
  const virtualKeyCodes = {
    Tab: 9,
    Escape: 27,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };
  const windowsVirtualKeyCode = virtualKeyCodes[key] || 0;

  // `Input.dispatchKeyEvent` does not automatically foreground its target.
  // On GitHub Actions a background target accepts evaluations but can discard
  // native Tab/arrow input, causing every overlay-keyboard check to fail at once.
  await cdp.send('Page.bringToFront');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
}

async function navigate(cdp, url) {
  const destination = new URL(url);
  destination.searchParams.set('_smoke', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const navigation = await cdp.send('Page.navigate', { url: destination.toString() });
  if (navigation.errorText) {
    throw new Error(`Page.navigate failed for ${destination}: ${navigation.errorText}`);
  }
  await cdp.send('Page.bringToFront');
  await waitForApp(cdp);
  await cdp.send('Page.bringToFront');
  await sleep(780);
}

async function captureScreenshot(cdp, filePath) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
}

async function run() {
  /* --url은 스크롤 페이지(index.html)를 받는다. 갤러리는 이 실행 안에서 아래
     galleryUrl로 따로 들른다 — 따로 돌릴 필요가 없다.

     갤러리 주소를 그대로 넘기면 baseUrl과 galleryUrl이 같아져 `#world`,
     `#characters` 같은 구간을 갤러리에서 찾다가 700줄 뒤에서 널 참조로 죽었다.
     원인을 짚기 어려운 자리라 여기서 바로잡고 알린다. */
  const requestedUrl = readOption('--url', 'http://127.0.0.1:8123/index.html');
  const baseUrl = /gallery\.html(?:[?#]|$)/.test(requestedUrl)
    ? requestedUrl.replace(/gallery\.html/, 'index.html')
    : requestedUrl;
  if (baseUrl !== requestedUrl) {
    console.log(`[smoke] --url이 갤러리를 가리켜 ${baseUrl}로 바꿔 실행합니다. 갤러리는 이 실행에 포함되어 있습니다.`);
  }
  // 갤러리는 스크롤 페이지에서 나가 별도 문서가 되었다.
  const galleryUrl = baseUrl.replace(/[^/]*$/, 'gallery.html');
  const screenshotDir = readOption('--screenshots-dir');
  const chrome = findChrome();
  const port = 9300 + Math.floor(Math.random() * 400);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ism-browser-smoke-'));
  const chromeProcess = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--no-first-run',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    // Create a stable blank target first. Opening the target directly at baseUrl can race
    // with Runtime.enable/Page.navigate and invalidate a long Runtime.evaluate call.
    const target = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' }
    ).then(response => response.json());
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Network.enable'),
      cdp.send('Log.enable'),
    ]);

    const report = {
      viewports: {},
      textOverflow: {},
      main: {},
      characters: {},
      gallery: {},
      modal: {},
      scrollIndex: {},
      map: {},
      world: {},
      accessibility: {},
      consoleErrors: [],
      failedRequests: [],
    };

    await setViewport(cdp, 1440, 1000);
    await navigate(cdp, `${baseUrl}#factions`);
    report.main.structure = await evaluate(cdp, `(() => {
      const expectedSections = ['main', 'factions', 'world', 'schedule', 'characters'];
      const indexLinks = [...document.querySelectorAll('.scroll-index-dot[data-section-index]')];
      const ledgerRows = [...document.querySelectorAll('.main-ledger-row')];
      const inspectPrimaryLinks = links => links.length === expectedSections.length && links.every((link, index) =>
        link.tagName === 'A' &&
        link.dataset.sectionIndex === expectedSections[index] &&
        link.getAttribute('href') === '#' + expectedSections[index]
      );
      return {
        semanticHeading: document.querySelector('#section-main h1')?.textContent.trim().replace(/\\s+/g, ' ') === '이종족은 좋아하세요?',
        factionSectionPresent: !!document.querySelector('#section-factions .main-registry'),
        singleScrollIndexIsAnchors: inspectPrimaryLinks(indexLinks),
        legacyButtonNavigationRemoved: !document.querySelector('#top-nav, .mobile-nav-drawer, .mobile-menu-btn, .nav-tab, .mobile-nav-link'),
        epilogueAfterCharacters: (() => {
          const characters = document.getElementById('section-characters');
          const epilogue = document.getElementById('world-you');
          return !!characters && !!epilogue &&
            epilogue.parentElement?.id === 'site-content' &&
            epilogue === document.querySelector('#site-content > :last-child') &&
            !!(characters.compareDocumentPosition(epilogue) & Node.DOCUMENT_POSITION_FOLLOWING);
        })(),
        epilogueCopyMatches: (() => {
          const text = document.getElementById('world-you')?.textContent.replace(/\\s+/g, ' ').trim() || '';
          return text.includes('ISM 최초의 인간 교수가 되는 것도, ISM 아카데미생이 되는 것도,') &&
            text.includes('혹은 또 다른 누군가가 되어 이 세상에 뛰어드는 것도, 당신의 자유!') &&
            text.includes('ISM의 문은 열려 있습니다');
        })(),
        ledgerComplete: ledgerRows.length === 3 && ledgerRows.every(row =>
          row.querySelector('dt')?.textContent.trim() && row.querySelector('dd')?.textContent.trim()
        ),
        factionOptionsAreButtons: [...document.querySelectorAll('[data-main-faction-option]')].length === 5 &&
          [...document.querySelectorAll('[data-main-faction-option]')].every(option =>
            option.tagName === 'BUTTON' && option.hasAttribute('aria-pressed')
          ),
        factionStepButtonsNamed: [...document.querySelectorAll('[data-main-faction-step]')].length === 2 &&
          [...document.querySelectorAll('[data-main-faction-step]')].every(button =>
            button.tagName === 'BUTTON' && button.getAttribute('aria-label')?.trim()
          ),
        autoplayControlNamed: (() => {
          const button = document.querySelector('[data-main-faction-autoplay]');
          return button?.tagName === 'BUTTON' &&
            button.hasAttribute('aria-pressed') &&
            !!button.getAttribute('aria-label')?.trim();
        })(),
        skipLinkTargetsMain: document.querySelector('.skip-link')?.getAttribute('href') === '#site-content' &&
          !!document.getElementById('site-content'),
        sealIsDecorative: document.querySelector('.main-logo-wrap img')?.getAttribute('alt') === ''
      };
    })()`);
    const autoplaySetup = await evaluate(cdp, `(() => {
      const root = document.querySelector('#section-factions .main-registry');
      const button = root?.querySelector('[data-main-faction-autoplay]');
      const ismOption = root?.querySelector('[data-main-faction-option="ism"]');
      if (!root || !button || !ismOption) {
        return { rootPresent: !!root, controlPresent: !!button, optionPresent: !!ismOption };
      }
      if (button.getAttribute('aria-pressed') === 'true') button.click();
      ismOption.click();
      return { rootPresent: true, controlPresent: true, optionPresent: true };
    })()`);

    if (!autoplaySetup.rootPresent || !autoplaySetup.controlPresent || !autoplaySetup.optionPresent) {
      report.main.autoplay = {
        rootPresent: autoplaySetup.rootPresent,
        controlPresent: autoplaySetup.controlPresent,
        optionPresent: autoplaySetup.optionPresent,
        started: false,
        advanceIntervalLabelled: false,
        didNotAdvanceEarly: false,
        advancedAfterInterval: false,
        transitionWithinTolerance: false,
        paused: false,
      };
    } else {
      await sleep(900);
      const autoplayStartedAt = Date.now();
      await evaluate(cdp, `(() => {
        const button = document.querySelector('#section-factions [data-main-faction-autoplay]');
        if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
        return button?.getAttribute('aria-pressed') || '';
      })()`);

      const started = !!(await waitForCondition(cdp, `(() => {
        const root = document.querySelector('#section-factions .main-registry');
        const button = root?.querySelector('[data-main-faction-autoplay]');
        return !!button && button.getAttribute('aria-pressed') === 'true' &&
          root.classList.contains('is-autoplay-enabled') &&
          root.classList.contains('is-autoplay-counting');
      })()`, { timeoutMs: 2400 }));

      const advanceIntervalLabelled = await evaluate(cdp, `(() => {
        const button = document.querySelector('#section-factions [data-main-faction-autoplay]');
        const progress = button?.querySelector('.main-faction-autoplay-progress');
        const duration = progress ? Number.parseFloat(getComputedStyle(progress).animationDuration) : 0;
        return button?.querySelector('.main-faction-autoplay-count')?.textContent.trim() === '9초' &&
          Math.abs(duration - 9) < 0.05;
      })()`);

      const earlyWait = Math.max(0, 8200 - (Date.now() - autoplayStartedAt));
      if (earlyWait) await sleep(earlyWait);
      const didNotAdvanceEarly = await evaluate(cdp, `
        document.querySelector('#section-factions .main-registry')?.dataset.mainFaction === 'ism'
      `);

      const advancedAfterInterval = !!(await waitForCondition(cdp, `
        document.querySelector('#section-factions .main-registry')?.dataset.mainFaction === 'pbs'
      `, { timeoutMs: 4200, intervalMs: 90 }));
      const transitionElapsed = Date.now() - autoplayStartedAt;
      const transitionWithinTolerance = transitionElapsed >= 8750 && transitionElapsed <= 12500;

      await evaluate(cdp, `(() => {
        const button = document.querySelector('#section-factions [data-main-faction-autoplay]');
        if (button?.getAttribute('aria-pressed') === 'true') button.click();
        return true;
      })()`);
      const paused = !!(await waitForCondition(cdp, `(() => {
        const root = document.querySelector('#section-factions .main-registry');
        const button = root?.querySelector('[data-main-faction-autoplay]');
        return !!button && button.getAttribute('aria-pressed') === 'false' &&
          !root.classList.contains('is-autoplay-enabled') &&
          !root.classList.contains('is-autoplay-counting');
      })()`, { timeoutMs: 1200 }));

      report.main.autoplay = {
        rootPresent: true,
        controlPresent: true,
        optionPresent: true,
        started,
        advanceIntervalLabelled,
        didNotAdvanceEarly,
        advancedAfterInterval,
        transitionWithinTolerance,
        paused,
      };
    }
    report.main.factions = await evaluate(cdp, `(async () => {
      const root = document.querySelector('#section-factions .main-registry');
      if (!root) return { rootPresent: false, views: {}, nextWraps: false, previousWraps: false };
      const expected = {
        ism: { title: 'ISM Academy', logos: 1 },
        pbs: { title: '원혈회 Pureblood Society', logos: 1 },
        hprf: { title: '인간보전전선 Human Preservation Front', logos: 1 },
        wf: { title: '백색울타리 White Fence', logos: 1 },
        rtn: { title: '귀향파 Return Faction', logos: 1 }
      };
      const views = {};
      for (const [key, expectation] of Object.entries(expected)) {
        root.querySelector('[data-main-faction-option="' + key + '"]').click();
        await new Promise(resolve => setTimeout(resolve, 840));
        const activeOptions = [...root.querySelectorAll('[data-main-faction-option][aria-pressed="true"]')];
        const images = [...root.querySelectorAll('.main-logo-wrap img')];
        views[key] = {
          rootStateMatches: root.dataset.mainFaction === key &&
            document.getElementById('section-factions').dataset.mainFaction === key,
          titleMatches: root.querySelector('[data-main-title]').textContent.trim().replace(/\\s+/g, ' ') === expectation.title,
          singleActiveOption: activeOptions.length === 1 && activeOptions[0].dataset.mainFactionOption === key,
          logoCountMatches: images.length === expectation.logos,
          decorativeLogos: images.every(image => image.getAttribute('alt') === ''),
          ledgerPopulated: [...root.querySelectorAll('.main-ledger-row dd')].every(value => value.textContent.trim())
        };
      }
      root.querySelector('[data-main-faction-step="1"]').click();
      await new Promise(resolve => setTimeout(resolve, 840));
      const nextWraps = root.dataset.mainFaction === 'ism';
      root.querySelector('[data-main-faction-step="-1"]').click();
      await new Promise(resolve => setTimeout(resolve, 840));
      const previousWraps = root.dataset.mainFaction === 'rtn';
      root.querySelector('[data-main-faction-option="ism"]').click();
      await new Promise(resolve => setTimeout(resolve, 840));
      return { views, nextWraps, previousWraps };
    })()`);
    report.main.motion = await evaluate(cdp, `(async () => {
      const root = document.querySelector('#section-factions .main-registry');
      if (!root) return {
        rootPresent: false,
        factionTextStatic: false,
        sealIdleStill: false,
        orbitStill: false,
        titleDropActive: false,
        copyDropActive: false,
        sealDoesNotDrop: false
      };
      const primary = root.querySelector('[data-main-title-primary]');
      const sealFigure = root.querySelector('[data-main-logo-figure]');
      const kicker = root.querySelector('[data-main-kicker]');
      const motto = root.querySelector('[data-main-motto]');
      // The faction copy is deliberately static: no pointer-driven parallax.
      const bounds = root.getBoundingClientRect();
      root.dispatchEvent(new PointerEvent('pointerenter', {
        pointerType: 'mouse',
        clientX: bounds.right - 10,
        clientY: bounds.bottom - 10
      }));
      root.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'mouse',
        clientX: bounds.right - 10,
        clientY: bounds.bottom - 10
      }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const factionTextStatic = !root.classList.contains('is-pointer-active') &&
        [kicker, primary, motto, sealFigure].every(element => !element || element.style.transform === '');
      root.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      // 세력 소개에 상시로 도는 움직임은 없다. 표식이 떠 있던 mainSealFloat과
      // 궤도가 돌던 mainSealOrbit을 걷어 냈으므로, 쉬는 동안은 정지가 정답이다.
      const sealIdleStill = getComputedStyle(root.querySelector('.main-logo-wrap')).animationName === 'none';
      const orbitStill = getComputedStyle(root.querySelector('.main-seal-orbit')).animationName === 'none';
      root.querySelector('[data-main-faction-option="pbs"]').click();
      await new Promise(resolve => setTimeout(resolve, 220));
      // 넘어갈 때 남은 움직임은 하나뿐이다 — 글이 위에서 떨어진다.
      const titleDropActive = [...root.querySelectorAll('.main-title span')]
        .every(title => getComputedStyle(title).animationName === 'mainFactionDrop');
      const copyDropActive = getComputedStyle(root.querySelector('.main-registry-copy')).animationName === 'mainFactionDrop';
      const sealDoesNotDrop = getComputedStyle(root.querySelector('.main-seal-field')).animationName === 'mainFactionFade';
      await new Promise(resolve => setTimeout(resolve, 520));
      root.querySelector('[data-main-faction-option="ism"]').click();
      await new Promise(resolve => setTimeout(resolve, 840));
      return {
        factionTextStatic,
        sealIdleStill,
        orbitStill,
        titleDropActive,
        copyDropActive,
        sealDoesNotDrop
      };
    })()`);
    await cdp.send('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await sleep(100);
    report.main.reducedMotion = await evaluate(cdp, `(() => {
      const root = document.querySelector('#section-factions .main-registry');
      const button = root?.querySelector('[data-main-faction-autoplay]');
      if (!root || !button) return {
        rootPresent: false,
        mediaQueryMatches: false,
        autoplayDisabled: false,
        sealIdleStill: false,
        orbitStill: false,
        copyStaysVisible: false,
        factionTextStatic: false,
        titleTransitionDisabled: false
      };
      const primary = root.querySelector('[data-main-title-primary]');
      const sealFigure = root.querySelector('[data-main-logo-figure]');
      const bounds = root.getBoundingClientRect();
      root.dispatchEvent(new PointerEvent('pointerenter', {
        pointerType: 'mouse',
        clientX: bounds.right - 10,
        clientY: bounds.bottom - 10
      }));
      root.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'mouse',
        clientX: bounds.right - 10,
        clientY: bounds.bottom - 10
      }));
      return {
        mediaQueryMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        autoplayDisabled: button.getAttribute('aria-pressed') === 'false',
        sealIdleStill: getComputedStyle(root.querySelector('.main-logo-wrap')).animationName === 'none',
        orbitStill: getComputedStyle(root.querySelector('.main-seal-orbit')).animationName === 'none',
        // 움직임을 끈 채로 글이 opacity 0에 갇히면 화면이 비어 버린다.
        copyStaysVisible: Number(getComputedStyle(root.querySelector('.main-registry-copy')).opacity) === 1,
        factionTextStatic: !root.classList.contains('is-pointer-active') &&
          primary.style.transform === '' &&
          sealFigure.style.transform === '',
        titleTransitionDisabled: getComputedStyle(primary).transitionDuration
          .split(',')
          .every(value => Number.parseFloat(value) === 0)
      };
    })()`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });
    await sleep(60);

    for (const [width, height] of [[1440, 1000], [1024, 900], [768, 900], [390, 844], [360, 800]]) {
      await setViewport(cdp, width, height);
      await navigate(cdp, `${baseUrl}#characters`);
      report.viewports[width] = await evaluate(cdp, `({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        expectedCards: window.ISMAppDiagnostics.getCharacters().length,
        renderedCards: document.querySelectorAll('.char-card[data-code]').length,
        visibleCards: [...document.querySelectorAll('.char-card[data-code]')].filter(card => card.offsetParent).length,
        navigationMode: document.querySelector('.scroll-index') ? 'scroll-index' : 'missing',
        // 좁은 화면에서 색인은 접힌 채로 시작한다. 점 6개를 44px로 펼쳐 두면
        // 화면의 5% 넘게 한가운데를 가려 본문과 조작부를 덮었다.
        scrollIndexFootprint: (() => {
          const rail = document.querySelector('.scroll-index');
          if (!rail) return null;
          const rect = rail.getBoundingClientRect();
          return {
            areaPercent: +((rect.width * rect.height) / (window.innerWidth * window.innerHeight) * 100).toFixed(2),
            collapsedOnNarrow: window.innerWidth > 760 || !rail.classList.contains('is-open'),
            dotsShown: [...rail.querySelectorAll('.scroll-index-dot')].filter(dot => dot.getClientRects().length).length,
          };
        })(),
        smallTouchTargets: window.innerWidth <= 390 ? [...document.querySelectorAll(
          '.scroll-index-dot, .filter-btn, .filter-reset-btn, .characters-scope-pill'
        )].filter(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 &&
            (rect.width < 44 || rect.height < 44);
        }).map(element => ({
          className: element.className,
          width: Math.round(element.getBoundingClientRect().width),
          height: Math.round(element.getBoundingClientRect().height)
        })) : []
      })`);
    }

    await setViewport(cdp, 360, 800);
    for (const section of ['main', 'factions', 'world', 'schedule', 'characters']) {
      await navigate(cdp, `${baseUrl}#${section}`);
      report.textOverflow[section] = await evaluate(cdp, `(() =>
        [...document.querySelectorAll('.section.active *')]
          .filter(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const hasOwnText = [...element.childNodes]
              .some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (!hasOwnText || rect.width < 8 || rect.height < 8) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (style.webkitLineClamp !== 'none') return false;
            if (element.closest('.faction-wordmark-fallback')) return false;
            let ancestor = element;
            while (ancestor && !ancestor.classList?.contains('section')) {
              const ancestorOverflow = getComputedStyle(ancestor).overflowX;
              if (ancestorOverflow === 'auto' || ancestorOverflow === 'scroll') return false;
              ancestor = ancestor.parentElement;
            }
            return element.scrollWidth > element.clientWidth + 1 ||
              rect.left < -1 || rect.right > window.innerWidth + 1;
          })
          .map(element => ({
            tag: element.tagName,
            className: element.className,
            text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }))
      )()`);
    }

    await setViewport(cdp, 1024, 900);
    await navigate(cdp, `${baseUrl}#world`);
    report.world.canon = await evaluate(cdp, `(() => {
      const root = document.getElementById('section-world');
      const text = root?.textContent.replace(/\\s+/g, ' ').trim() || '';
      return {
        longCoexistencePresent: text.includes('오래전부터 서로의 존재를 알고 함께 살아왔으며'),
        massacrePresent: text.includes('1988년 8월 8일') && text.includes('8888 참사') && text.includes('인간 대량학살'),
        busanLocationPresent: text.includes('부산시') && text.includes('이종족 배척이 가장 심'),
        azachielPresent: text.includes('아자키엘') && text.includes('Azachiel'),
        sarielRelationPresent: text.includes('사리엘의 형'),
        failedRulerAssessmentPresent: text.includes('실패한 지배자'),
        aldheimMediationPresent: text.includes('알드헤임 가문') && text.includes('타협과 중재'),
        hostileFactionOriginPresent: text.includes('정 실바노의 계략') && text.includes('인간보전전선과 백색울타리가 탄생'),
        obsoleteWestSeaContactAbsent: !text.includes('서해 접촉 사태')
      };
    })()`);
    // 세계관은 한 번에 한 장만 편다. 여덟을 이어 두었더니 구간이 8000px가 됐다.
    // 한 장만 보이는 구성이므로 시맨틱은 탭이다 — aria-selected와 로빙 tabindex를
    // 확인하고, 고른 것만 보이는지, 나머지가 inert인지를 본다.
    report.world.toc = await evaluate(cdp, `(async () => {
      const entries = [...document.querySelectorAll('[data-world-panel-target]')];
      const panels = [...document.querySelectorAll('#section-world .world-panel')];
      const target = entries.find(entry => entry.dataset.worldPanelTarget === 'world-academy');
      const academy = document.getElementById('world-academy');
      target?.click();
      await new Promise(resolve => setTimeout(resolve, 700));
      const academyBox = academy.getBoundingClientRect();
      return {
        eightEntries: entries.length === 8 && entries.every(entry => entry.tagName === 'BUTTON'),
        insideTablist: entries.every(entry => !!entry.closest('[role="tablist"]')),
        tabRoles: entries.every(entry => entry.getAttribute('role') === 'tab') &&
          panels.every(panel => panel.getAttribute('role') === 'tabpanel'),
        // 고른 것 하나만 보이고 나머지는 hidden + inert여야 한다.
        onlySelectedPanelShown: panels.length === 8 &&
          panels.filter(panel => panel.getClientRects().length > 0).length === 1 &&
          !academy.hidden && !academy.inert &&
          panels.filter(panel => panel !== academy).every(panel => panel.hidden && panel.inert),
        // 로빙 tabindex — 탭 묶음은 Tab 한 번으로 들어오고 나간다.
        rovingTabindex: entries.filter(entry => entry.tabIndex === 0).length === 1 &&
          target?.tabIndex === 0,
        tocIsSticky: getComputedStyle(document.querySelector('.world-index')).position === 'sticky',
        marksCurrent: target?.getAttribute('aria-selected') === 'true',
        scrolledToTarget: Math.abs(academyBox.top) < window.innerHeight * 2
      };
    })()`);
    report.world.stigmaSigmaSymbol = await evaluate(cdp, `(async () => {
      document.querySelector('[data-world-panel-target="world-stigma"]')?.click();
      const image = document.querySelector('#world-stigma .world-stigma-visual img');
      image?.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (image && !image.complete) {
        await Promise.race([
          new Promise(resolve => image.addEventListener('load', resolve, { once: true })),
          new Promise(resolve => image.addEventListener('error', resolve, { once: true })),
          new Promise(resolve => setTimeout(resolve, 1200))
        ]);
      }
      return {
        usesWebp: image?.getAttribute('src')?.endsWith('/assets/world/stigma-sigma-symbols.webp') || false,
        imageLoaded: !!image?.complete && image.naturalWidth === 1254 && image.naturalHeight === 1254
      };
    })()`);
    report.map.interaction = await evaluate(cdp, `(async () => {
      document.querySelector('[data-world-panel-target="world-map"]')?.click();
      const root = document.getElementById('world-map');
      const image = root?.querySelector('.cheonghaedo-map-figure img');
      root?.scrollIntoView({ block: 'start' });
      await new Promise(resolve => setTimeout(resolve, 120));
      if (image && !image.complete) await new Promise(resolve => image.addEventListener('load', resolve, { once: true }));
      const legendItems = [...root.querySelectorAll('.cheonghaedo-map-legend-item')];
      return {
        imageLoaded: !!image?.complete && image.naturalWidth === 1536 && image.naturalHeight === 1024,
        legendItemCount: legendItems.length,
        allDescriptionsPresent: legendItems.every(item => item.querySelector('strong')?.textContent.trim() && item.querySelector('p')?.textContent.trim()),
        interactionRemoved: !root.querySelector('button, input, [data-map-viewport], [data-map-details], [data-map-action]')
      };
    })()`);
    if (screenshotDir) await captureScreenshot(cdp, path.join(screenshotDir, 'map-desktop-selected.png'));

    await setViewport(cdp, 390, 844);
    await navigate(cdp, `${baseUrl}#world`);
    report.map.mobile = await evaluate(cdp, `(async () => {
      document.querySelector('[data-world-panel-target="world-map"]')?.click();
      const root = document.getElementById('world-map');
      root?.scrollIntoView({ block: 'start' });
      await new Promise(resolve => setTimeout(resolve, 120));
      const layout = root.querySelector('.cheonghaedo-map-static-layout');
      const image = root.querySelector('.cheonghaedo-map-figure');
      const legend = root.querySelector('.cheonghaedo-map-legend');
      return {
        singleColumn: getComputedStyle(layout).gridTemplateColumns.split(' ').length === 1,
        imageBeforeLegend: image.getBoundingClientRect().top < legend.getBoundingClientRect().top,
        imageWithinScreen: image.getBoundingClientRect().right <= window.innerWidth + 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        interactionRemoved: !root.querySelector('button, input, [data-map-action]')
      };
    })()`);
    if (screenshotDir) await captureScreenshot(cdp, path.join(screenshotDir, 'map-mobile.png'));

    await setViewport(cdp, 390, 844);
    await navigate(cdp, `${baseUrl}#factions`);
    report.main.mobile = await evaluate(cdp, `(() => {
      const ledgerRows = [...document.querySelectorAll('.main-ledger-row')];
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        factionControlsReachable: [...document.querySelectorAll('.main-faction-option, .main-faction-step')].every(control => {
          const rect = control.getBoundingClientRect();
          return rect.height >= 44 && rect.width >= 44;
        }),
        ledgerRowsReadable: ledgerRows.every(row => {
          const rect = row.getBoundingClientRect();
          return rect.width > 0 && rect.height >= 44 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
        }),
        titleFitsViewport: (() => {
          const rect = document.querySelector('.main-title').getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth + 1;
        })()
      };
    })()`);
    report.main.factionsMobile = await evaluate(cdp, `(async () => {
      const root = document.querySelector('#section-factions .main-registry');
      if (!root) return {
        missing: {
          noHorizontalOverflow: false,
          titleFitsViewport: false,
          fieldFitsViewport: false,
          logosLoaded: false
        }
      };
      const results = {};
      for (const key of ['ism', 'pbs', 'hprf', 'wf', 'rtn']) {
        root.querySelector('[data-main-faction-option="' + key + '"]').click();
        await new Promise(resolve => setTimeout(resolve, 840));
        const titleRect = root.querySelector('.main-title').getBoundingClientRect();
        const fieldRect = root.querySelector('.main-seal-field').getBoundingClientRect();
        const images = [...root.querySelectorAll('.main-logo-wrap img')];
        results[key] = {
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          titleFitsViewport: titleRect.left >= 0 && titleRect.right <= window.innerWidth + 1,
          fieldFitsViewport: fieldRect.left >= 0 && fieldRect.right <= window.innerWidth + 1,
          logosLoaded: images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0)
        };
      }
      root.querySelector('[data-main-faction-option="ism"]').click();
      await new Promise(resolve => setTimeout(resolve, 840));
      return results;
    })()`);
    await evaluate(cdp, `(() => {
      const target = [...document.querySelectorAll('.scroll-index-dot[data-section-index]')]
        .find(link => link.dataset.sectionIndex === 'factions');
      target?.click();
      return !!target;
    })()`);
    await waitForCondition(cdp, `(() => {
      const target = document.querySelector('.scroll-index-dot[data-section-index="factions"]');
      const section = document.getElementById('section-factions');
      const tolerance = Math.max(24, window.innerHeight * 0.03);
      return !!target && !!section && target.classList.contains('active') &&
        target.getAttribute('aria-current') === 'page' &&
        Math.abs(section.getBoundingClientRect().top) <= tolerance;
    })()`, { timeoutMs: 2600, intervalMs: 90 });
    report.scrollIndex = await evaluate(cdp, `(() => {
      const links = [...document.querySelectorAll('.scroll-index-dot[data-section-index]')];
      const target = links.find(link => link.dataset.sectionIndex === 'factions');
      const section = document.getElementById('section-factions');
      const tolerance = Math.max(24, window.innerHeight * 0.03);
      return {
        // 갤러리가 별도 페이지로 나가면서 구간은 다섯이 됐다. 이 식은 브라우저
        // 안에서 평가되므로 Node 쪽 상수는 값으로 심어 넣는다.
        countMatches: links.length === ${SCROLL_SECTION_IDS.length},
        legacyNavigationRemoved: !document.querySelector('#top-nav, .mobile-nav-drawer, .mobile-menu-btn'),
        targetActive: target?.classList.contains('active') || false,
        targetCurrent: target?.getAttribute('aria-current') === 'page',
        factionsNearViewport: !!section && Math.abs(section.getBoundingClientRect().top) <= tolerance,
      };
    })()`);


    await setViewport(cdp, 1440, 1000);
    await navigate(cdp, `${baseUrl}#characters`);
    report.characters.initial = await evaluate(cdp, `({
      totalCards: document.querySelectorAll('.char-card[data-code]').length,
      duplicateCodes: [...document.querySelectorAll('.char-card[data-code]')]
        .map(card => card.dataset.code)
        .filter((code, index, codes) => codes.indexOf(code) !== index),
      defaultCollapsedGroups: [...document.querySelectorAll('.roster-group.is-collapsed')]
        .map(group => group.dataset.rosterGroup),
      academyGroupsExpanded: ['students', 'staff'].every(group => {
        const section = document.querySelector('[data-roster-group="' + group + '"]');
        return !!section && !section.classList.contains('is-collapsed') &&
          section.querySelector('.roster-group-toggle')?.getAttribute('aria-expanded') === 'true';
      }),
      activeOrg: document.querySelector('.org-roster.active')?.id || '',
      bodyClass: document.body.className
    })`);

    report.characters.gradeToggle = await evaluate(cdp, `(() => {
      const button = document.querySelector('.char-grade-toggle');
      const controlled = document.getElementById(button?.getAttribute('aria-controls'));
      const startsExpanded = button?.getAttribute('aria-expanded') === 'true';
      button?.click();
      const collapsed = button?.closest('.char-grade-section')?.classList.contains('collapsed') &&
        button?.getAttribute('aria-expanded') === 'false';
      button?.click();
      return {
        semanticButton: button?.tagName === 'BUTTON',
        startsExpanded,
        collapsed,
        controlledRegionExists: !!controlled,
        restoredExpanded: !button?.closest('.char-grade-section')?.classList.contains('collapsed') &&
          button?.getAttribute('aria-expanded') === 'true'
      };
    })()`);

    await navigate(cdp, `${baseUrl}#characters?q=${encodeURIComponent('한서윤')}&scope=external&grade=1`);
    report.characters.urlFilters = await evaluate(cdp, `(async () => {
      const initial = {
        input: document.getElementById('characters-search')?.value,
        scopePressed: document.querySelector('[data-character-scope="external"]')?.getAttribute('aria-pressed'),
        gradePressed: document.querySelector('[data-filter-kind="grade"][data-filter-value="1"]')?.getAttribute('aria-pressed'),
        filters: window.ISMAppDiagnostics.getCharacterFilters()
      };
      history.pushState(null, '', '#characters?q=' + encodeURIComponent('유리') + '&scope=ism&grade=2');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      await new Promise(resolve => setTimeout(resolve, 180));
      return {
        initial,
        afterPop: {
          input: document.getElementById('characters-search')?.value,
          scopePressed: document.querySelector('[data-character-scope="ism"]')?.getAttribute('aria-pressed'),
          gradePressed: document.querySelector('[data-filter-kind="grade"][data-filter-value="2"]')?.getAttribute('aria-pressed'),
          filters: window.ISMAppDiagnostics.getCharacterFilters()
        }
      };
    })()`);

    await navigate(cdp, `${baseUrl}#characters`);
    report.characters.order = await evaluate(cdp, `(() => {
      const groups = ['students', 'staff', 'pbs', 'hprf', 'wf', 'rtn', 'nf'];
      return Object.fromEntries(groups.map(group => {
        const actual = [...document.querySelectorAll('[data-roster-group="' + group + '"] .char-card[data-code]')]
          .map(card => card.dataset.code);
        const expected = window.ISMAppDiagnostics.getCharacters()
          .filter(character => window.ISMAppDiagnostics.getRosterGroupKey(character) === group)
          .sort((a, b) => group === 'students' ? Number(a.grade) - Number(b.grade) : 0)
          .map(character => character.code);
        return [group, { matches: JSON.stringify(actual) === JSON.stringify(expected), actual, expected }];
      }));
    })()`);

    const firstCardPoint = await evaluate(cdp, `(async () => {
      const studentGroup = document.querySelector('[data-roster-group="students"]');
      if (studentGroup?.classList.contains('is-collapsed')) studentGroup.querySelector('.roster-group-toggle')?.click();
      const card = document.querySelector('#students-grid .char-card');
      card.scrollIntoView({ block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 140));
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 180) };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...firstCardPoint });
    await sleep(180);
    report.characters.hover = await evaluate(cdp, `(() => {
      const card = document.querySelector('#students-grid .char-card');
      const panel = card.querySelector('.char-hover-card');
      const panelRect = panel.getBoundingClientRect();
      return {
        cardTransform: getComputedStyle(card).transform,
        panelOpacity: getComputedStyle(panel).opacity,
        panelWithinViewport: panelRect.left >= 0 && panelRect.right <= window.innerWidth
      };
    })()`);

    await evaluate(cdp, `document.querySelector('.org-select-card[data-org="external"]').click()`);
    await sleep(220);
    report.characters.external = await evaluate(cdp, `({
      sectionClass: document.getElementById('section-characters').className,
      visibleCards: [...document.querySelectorAll('#org-external .char-card[data-code]')].filter(card => card.offsetParent).length,
      factionBackgrounds: Object.fromEntries(['pbs','hprf','wf','rtn','nf'].map(code => [
        code,
        getComputedStyle(document.querySelector('.roster-group--' + code + ' .roster-group-toggle')).backgroundImage
      ])),
      brokenVisibleImages: [...document.querySelectorAll('#org-external img')]
        .filter(img => img.offsetParent && img.complete && img.naturalWidth === 0)
        .map(img => img.getAttribute('src'))
    })`);

    report.characters.search = await evaluate(cdp, `(async () => {
      const input = document.getElementById('characters-search');
      input.value = '한서윤';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '한서윤' }));
      await new Promise(resolve => setTimeout(resolve, 180));
      return {
        visibleCodes: [...document.querySelectorAll('.char-card[data-code]')]
          .filter(card => card.offsetParent && getComputedStyle(card).display !== 'none')
          .map(card => card.dataset.code),
        countText: document.getElementById('characters-search-count').textContent.trim()
      };
    })()`);
    report.characters.externalDetail = await evaluate(cdp, `(async () => {
      const card = document.querySelector('.char-card[data-code="HY"]');
      card.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        opened: document.getElementById('char-detail').classList.contains('open')
      };
    })()`);

    report.characters.englishNameFont = await evaluate(cdp, `(async () => {
      window.ISMAppDiagnostics.openCharacterDetail('YU', true);
      await new Promise(resolve => setTimeout(resolve, 80));
      const englishName = document.querySelector('.cdp-profile-english-name');
      return englishName ? getComputedStyle(englishName).fontFamily : '';
    })()`);

    report.characters.sarielIdentity = await evaluate(cdp, `(async () => {
      window.ISMAppDiagnostics.openCharacterDetail('SV', true);
      await new Promise(resolve => setTimeout(resolve, 80));
      const publicName = document.querySelector('.cdp-profile-name')?.textContent.trim();
      document.querySelector('[data-spoiler-toggle]')?.click();
      await new Promise(resolve => setTimeout(resolve, 120));
      const stats = Object.fromEntries([...document.querySelectorAll('.cdp-stat')].map(stat => [
        stat.querySelector('.cdp-stat-label')?.textContent.trim(),
        stat.querySelector('.cdp-stat-val')?.textContent.trim()
      ]));
      return {
        publicIdentityPreserved: publicName === '정 실바노',
        trueName: document.querySelector('.cdp-profile-name')?.textContent.trim() === '사리엘',
        trueCode: document.querySelector('.cdp-profile-meta')?.textContent.includes('SR'),
        trueSpecies: stats['종족'] === '천사족',
        // 공개 신분의 40세와 갈라져 있는지를 본다. 값 자체는 characters.json의 trueAge를 따르며
        // 정본이 68세로 확정되기 전에는 불명이었다. 리터럴을 옛 값으로 되돌리지 않는다.
        trueAgeSeparated: stats['나이'] === '68세' && stats['나이'] !== '40세',
        physicalDataInherited: stats['신장'] === '187cm' && stats['체중'] === '비공개' && stats['성별'] === '남성',
        stigmaName: document.querySelector('.cdp-power-section--stigma .cdp-power-name')?.textContent.trim() === '알 티라',
        stigmaDescription: document.querySelector('.cdp-power-section--stigma .cdp-power-description')?.textContent.trim() ===
          '자신의 말에 조금이라도 설득당한 대상을 설득당한 상태로 고정시키고 자신의 말을 더 쉽게 믿도록 만든다',
        trueAssetUsed: document.getElementById('cdp-main-img')?.src.includes('/SR/D/01.webp')
      };
    })()`);

    await setViewport(cdp, 390, 844);
    await navigate(cdp, galleryUrl);
    report.gallery.organizationGroups = await evaluate(cdp, `(() => {
      const organizationOrder = ['ism', 'pbs', 'hprf', 'wf', 'rtn', 'nf', 'spoiler'];
      const inspect = selector => {
        const groups = [...document.querySelectorAll(selector + ' .assets-org-group')];
        const organizations = groups.map(group => group.dataset.org);
        return {
          organizations,
          organizationOrderMatches: organizations.every((org, index) =>
            index === 0 || organizationOrder.indexOf(organizations[index - 1]) < organizationOrder.indexOf(org)
          ),
          namesSorted: groups.every(group => {
            const names = [...group.querySelectorAll('.assets-char-item-name')]
              .map(name => name.getAttribute('title') || name.textContent.trim());
            const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ko-KR', { sensitivity: 'base', numeric: true }));
            return JSON.stringify(names) === JSON.stringify(sorted);
          }),
          // 갤러리에 들어오면 곧바로 에셋이 보이도록 ISM만 펼친 채 연다.
          // 예전에는 여섯 소속이 전부 접혀 있어 첫 화면이 늘 비어 있었다.
          defaultOpenIsAcademyOnly: groups.every(group => {
            const collapsed = group.classList.contains('is-collapsed');
            const expanded = group.querySelector('.assets-org-toggle')?.getAttribute('aria-expanded');
            return group.dataset.org === 'ism'
              ? !collapsed && expanded === 'true'
              : collapsed && expanded === 'false';
          })
        };
      };
      // ISM이 펼친 채로 열리므로 "펼치기 먼저"를 가정하면 안 된다. 접기와
      // 펼치기를 순서대로 확인하고 원래 상태로 돌려놓는다.
      const firstGroup = document.querySelector('#emo-sidebar .assets-org-group');
      const firstToggle = firstGroup?.querySelector('.assets-org-toggle');
      const itemsDisplay = () => getComputedStyle(firstGroup.querySelector('.assets-org-items')).display;
      const startedOpen = !!firstGroup && !firstGroup.classList.contains('is-collapsed');
      if (!startedOpen) firstToggle?.click();
      const expandWorks = !!firstGroup && !firstGroup.classList.contains('is-collapsed') && itemsDisplay() !== 'none';
      firstToggle?.click();
      const collapseWorks = !!firstGroup?.classList.contains('is-collapsed') && itemsDisplay() === 'none';
      if (startedOpen) firstToggle?.click();
      return {
        emotions: inspect('#emo-sidebar'),
        nsfw: inspect('#nsfw-sidebar'),
        collapseWorks: expandWorks && collapseWorks
      };
    })()`);
    report.gallery.minorSafety = await evaluate(cdp, `(async () => {
      const emotionEntryPresent = !!document.querySelector('#emo-sidebar .assets-char-item[data-code="MY"]');
      const nsfwEntryPresent = !!document.querySelector('#nsfw-sidebar .assets-char-item[data-code="MY"]');
      const hasNsfwAssets = window.ISMAppDiagnostics.nsfwAssetsFor('MY').size > 0;
      await window.ISMAppDiagnostics.selectNsfwCharacter('MY', null, { force: true });
      return {
        emotionEntryPresent,
        excludedFromNsfwSidebar: !nsfwEntryPresent,
        noNsfwAssetSet: !hasNsfwAssets,
        selectionRejected: window.ISMAppDiagnostics.getCurrentNsfwCode() === null
      };
    })()`);
    report.gallery.search = await evaluate(cdp, `(async () => {
      const input = document.querySelector('#emo-sidebar .assets-sidebar-search');
      input.value = 'ism';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'ism' }));
      await new Promise(resolve => setTimeout(resolve, 180));
      const sidebar = document.getElementById('emo-sidebar');
      const visibleItems = [...sidebar.querySelectorAll('.assets-char-item')]
        .filter(item => getComputedStyle(item).display !== 'none');
      return {
        sidebarClass: sidebar.className,
        overflowX: getComputedStyle(sidebar).overflowX,
        layout: getComputedStyle(sidebar).display,
        visibleCodes: visibleItems.map(item => item.dataset.code),
        horizontalOverflow: sidebar.scrollWidth > sidebar.clientWidth
      };
    })()`);

    const lightboxPrepared = await evaluate(cdp, `(async () => {
      const item = [...document.querySelectorAll('#emo-sidebar .assets-char-item')]
        .find(candidate => candidate.dataset.code === 'LC' && getComputedStyle(candidate).display !== 'none');
      if (!item) return { sidebarItem: false, card: false };
      item.click();
      await new Promise(resolve => setTimeout(resolve, 160));
      const firstCard = document.querySelector('#emo-viewer .emo-asset-card:not(.broken)');
      if (!firstCard) return { sidebarItem: true, card: false };
      firstCard.scrollIntoView({ block: 'center', behavior: 'auto' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      firstCard.focus({ preventScroll: true });
      firstCard.click();
      return { sidebarItem: true, card: true };
    })()`);
    if (!lightboxPrepared?.sidebarItem || !lightboxPrepared?.card) {
      throw new Error(`Unable to prepare the gallery lightbox test: ${JSON.stringify(lightboxPrepared)}`);
    }
    await waitForRequiredCondition(cdp, `(() => {
      const lightbox = document.getElementById('lightbox');
      return lightbox?.classList.contains('open') &&
        lightbox.getAttribute('aria-hidden') === 'false' &&
        !lightbox.inert &&
        lightbox.contains(document.activeElement);
    })()`, 'The gallery card click did not open and focus the lightbox.', { timeoutMs: 2400, intervalMs: 50 });

    const lightboxInitial = await evaluate(cdp, `(() => {
      const firstCard = document.querySelector('#emo-viewer .emo-asset-card:not(.broken)');
      const cards = [...document.querySelectorAll('#emo-viewer .emo-asset-card:not(.broken)')];
      const assetUrls = [...document.querySelectorAll('#emo-viewer [data-asset-url]')]
        .map(card => card.dataset.assetUrl);
      const lightbox = document.getElementById('lightbox');
      const image = document.getElementById('lightbox-img');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(lightbox);
      return {
        cardCount: cards.length,
        assetUrls,
        opened: lightbox.classList.contains('open') &&
          lightbox.getAttribute('aria-hidden') === 'false' &&
          !lightbox.inert &&
          !!image?.src && !image.src.startsWith('data:image/gif'),
        focusInsideOnOpen: lightbox.contains(document.activeElement),
        firstCardFocusedBeforeOpen: lightbox._returnFocus === firstCard,
        focusableCount: focusable.length,
        navVisible: !document.querySelector('.lightbox-nav--next').hidden,
        optionalOutfitSectionsAbsent: !document.querySelector('#emo-viewer .assets-outfit-section')
      };
    })()`);

    await evaluate(cdp, `(() => {
      const lightbox = document.getElementById('lightbox');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(lightbox);
      const last = focusable.at(-1);
      last?.focus({ preventScroll: true });
      last?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true
      }));
      return true;
    })()`);
    await sleep(80);
    const tabWrapped = await evaluate(cdp, `(() => {
      const lightbox = document.getElementById('lightbox');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(lightbox);
      return focusable.length > 0 && document.activeElement === focusable[0];
    })()`);

    const before = await evaluate(cdp, `document.getElementById('lightbox-img').src`);
    await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true
    }))`);
    if (lightboxInitial.cardCount > 1) {
      await waitForRequiredCondition(cdp,
        `document.getElementById('lightbox-img').src !== ${JSON.stringify(before)}`,
        'The lightbox keyboard arrow did not change the active image.',
        { timeoutMs: 1800, intervalMs: 50 });
    }
    const after = await evaluate(cdp, `document.getElementById('lightbox-img').src`);

    await evaluate(cdp, `(() => {
      const button = document.querySelector('.lightbox-nav--next');
      button?.focus({ preventScroll: true });
      button?.click();
    })()`);
    if (lightboxInitial.cardCount > 1) {
      await waitForRequiredCondition(cdp,
        `document.getElementById('lightbox-img').src !== ${JSON.stringify(after)}`,
        'The visible lightbox arrow did not change the active image.',
        { timeoutMs: 1800, intervalMs: 50 });
    }
    const afterButton = await evaluate(cdp, `document.getElementById('lightbox-img').src`);
    const arrowFocusRetained = await evaluate(cdp,
      `document.activeElement === document.querySelector('.lightbox-nav--next')`);

    await evaluate(cdp, `document.querySelector('[data-lightbox-close]')?.click()`);
    await waitForRequiredCondition(cdp, `(() => {
      const lightbox = document.getElementById('lightbox');
      const firstCard = document.querySelector('#emo-viewer .emo-asset-card:not(.broken)');
      return !lightbox.classList.contains('open') && lightbox.inert && document.activeElement === firstCard;
    })()`, 'The lightbox did not close or restore focus to its opener.', { timeoutMs: 2400, intervalMs: 50 });

    const lightboxFinal = await evaluate(cdp, `(() => {
      const lightbox = document.getElementById('lightbox');
      const firstCard = document.querySelector('#emo-viewer .emo-asset-card:not(.broken)');
      return {
        closed: !lightbox.classList.contains('open'),
        focusReturned: document.activeElement === firstCard,
        closedLightboxInert: lightbox.inert
      };
    })()`);

    report.gallery.lightbox = {
      cardCount: lightboxInitial.cardCount,
      opened: lightboxInitial.opened,
      keyboardMoved: lightboxInitial.cardCount > 1 ? before !== after : true,
      screenArrowMoved: lightboxInitial.cardCount > 1 ? after !== afterButton : true,
      closed: lightboxFinal.closed,
      focusInsideOnOpen: lightboxInitial.focusInsideOnOpen,
      firstCardFocusedBeforeOpen: lightboxInitial.firstCardFocusedBeforeOpen,
      focusableCount: lightboxInitial.focusableCount,
      tabWrapped,
      arrowFocusRetained,
      focusReturned: lightboxFinal.focusReturned,
      closedLightboxInert: lightboxFinal.closedLightboxInert,
      navVisible: lightboxInitial.navVisible,
      lucyBattleAssetVisible: lightboxInitial.assetUrls.some(url => url.includes('/LC/D/19.webp')),
      optionalOutfitsOmitted: lightboxInitial.assetUrls.every(url => !url.includes('/O/') && !url.includes('/S/')),
      optionalOutfitSectionsAbsent: lightboxInitial.optionalOutfitSectionsAbsent
    };

    report.gallery.sarielBattle = await evaluate(cdp, `(async () => {
      const azachielHiddenBeforeReveal = !document.querySelector('#emo-sidebar .assets-char-item[data-code="AZ"]');
      document.querySelector('#emo-sidebar .assets-spoiler-toggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const azachielItem = document.querySelector('#emo-sidebar .assets-char-item[data-code="AZ"]');
      await window.ISMAppDiagnostics.selectEmotionCharacter('AZ', azachielItem, { force: true });
      await new Promise(resolve => setTimeout(resolve, 180));
      const azachielBattleCard = [...document.querySelectorAll('#emo-viewer [data-asset-url]')]
        .find(candidate => candidate.dataset.assetUrl.includes('/AZ/D/19.webp'));
      await window.ISMAppDiagnostics.selectEmotionCharacter('SR', null, { force: true });
      await new Promise(resolve => setTimeout(resolve, 180));
      const card = [...document.querySelectorAll('#emo-viewer [data-asset-url]')]
        .find(candidate => candidate.dataset.assetUrl.includes('/SR/D/19.webp'));
      card?.scrollIntoView({ block: 'center' });
      const image = card?.querySelector('img');
      if (image && !image.complete) {
        await Promise.race([
          new Promise(resolve => image.addEventListener('load', resolve, { once: true })),
          new Promise(resolve => image.addEventListener('error', resolve, { once: true })),
          new Promise(resolve => setTimeout(resolve, 1200))
        ]);
      }
      return {
        azachielHiddenBeforeReveal,
        azachielListedAfterReveal: !!azachielItem,
        azachielBattleCardPresent: !!azachielBattleCard,
        cardPresent: !!card,
        cardAvailable: !!card && !card.classList.contains('broken') && card.dataset.assetUnavailable !== '1',
        imageLoaded: !!image?.complete && image.naturalWidth > 0
      };
    })()`);

    await setViewport(cdp, 1440, 1000);
    await navigate(cdp, `${baseUrl}#characters`);
    const modalPrepared = await evaluate(cdp, `(() => {
      const studentGroup = document.querySelector('[data-roster-group="students"]');
      if (studentGroup?.classList.contains('is-collapsed')) studentGroup.querySelector('.roster-group-toggle')?.click();
      const opener = document.querySelector('.char-card[data-code="YU"]');
      if (!opener) return false;
      opener.scrollIntoView({ block: 'center', behavior: 'auto' });
      opener.focus({ preventScroll: true });
      opener.click();
      return true;
    })()`);
    if (!modalPrepared) throw new Error('The character-detail opener card was not found.');
    await waitForRequiredCondition(cdp, `(() => {
      const modal = document.getElementById('char-detail');
      return modal?.classList.contains('open') &&
        modal.getAttribute('aria-hidden') === 'false' &&
        !modal.inert &&
        modal.contains(document.activeElement);
    })()`, 'The character card click did not open and focus the detail dialog.', { timeoutMs: 2400, intervalMs: 50 });

    const modalInitial = await evaluate(cdp, `(() => {
      const opener = document.querySelector('.char-card[data-code="YU"]');
      const modal = document.getElementById('char-detail');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(modal);
      return {
        focusInsideOnOpen: modal.contains(document.activeElement),
        openerStored: modal._returnFocus === opener,
        pageContentInert: document.getElementById('section-characters').inert &&
          document.querySelector('.scroll-index')?.inert === true,
        focusableCount: focusable.length
      };
    })()`);

    // 상세를 열 때 app.js의 scheduleFocusWithin(modalEl, '.cdp-back')이
    // setTimeout(0)과 이중 requestAnimationFrame으로 초점을 다시 준다. 그런데
    // .cdp-back은 focusable[0]이 아니라 인덱스 2다(0번은 .cdp-nav). 그 늦은
    // 콜백이 아래 Tab 감싸기 뒤에 도착하면 초점이 0번에서 2번으로 밀려
    // "감싸기 실패"로 잘못 읽힌다. 헤드리스에서 프레임이 늦게 와야 벌어지므로
    // CI에서만 간헐적으로 터졌다 — 닫기 경로가 이미 같은 이유로 배수 코드를
    // 쓰고 있다. 재기 전에 그 콜백들을 흘려보낸다. 제품 동작은 옳고 검사가
    // 경주에서 진 것이다.
    await evaluate(cdp, `new Promise(resolve => {
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(
        () => setTimeout(resolve, 0)
      )), 0);
    })`);

    // 마지막 요소에 초점이 실제로 앉은 뒤에 Tab을 눌러야 감싸기를 확인할 수
    // 있다. 초점이 안 앉은 채로 누르면 트랩이 아니라 브라우저 기본 이동이
    // 일어나 "감싸기 실패"로 잘못 읽힌다. 어떤 요소를 썼는지도 남긴다.
    const tabWrapProbe = await evaluate(cdp, `(() => {
      const describe = el => el
        ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (el.className ? '.' + String(el.className).trim().split(/\\s+/)[0] : '')
        : 'none';
      const modal = document.getElementById('char-detail');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(modal);
      const last = focusable.at(-1);
      last?.focus({ preventScroll: true });
      const landed = document.activeElement === last;
      last?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true
      }));
      return {
        count: focusable.length,
        first: describe(focusable[0]),
        last: describe(last),
        landedOnLast: landed,
      };
    })()`);
    await sleep(80);
    const modalTabWrapped = await evaluate(cdp, `(() => {
      const modal = document.getElementById('char-detail');
      const focusable = window.ISMAppDiagnostics.focusableElementsWithin(modal);
      return focusable.length > 0 && document.activeElement === focusable[0];
    })()`);
    report.modal.tabWrapProbe = { ...tabWrapProbe, wrapped: modalTabWrapped };

    await evaluate(cdp, `window.ISMAppDiagnostics.closeCharacterDetail({ history: false })`);
    await waitForRequiredCondition(cdp, `(() => {
      const opener = document.querySelector('.char-card[data-code="YU"]');
      const modal = document.getElementById('char-detail');
      return !modal.classList.contains('open') && modal.inert && document.activeElement === opener;
    })()`, 'The character detail did not close or restore focus to its opener.', { timeoutMs: 2600, intervalMs: 50 });

    const modalFinal = await evaluate(cdp, `(() => {
      const opener = document.querySelector('.char-card[data-code="YU"]');
      const modal = document.getElementById('char-detail');
      return {
        closed: !modal.classList.contains('open'),
        focusReturned: document.activeElement === opener,
        closedModalInert: modal.inert
      };
    })()`);

    report.modal.focusManagement = {
      focusInsideOnOpen: modalInitial.focusInsideOnOpen,
      openerStored: modalInitial.openerStored,
      pageContentInert: modalInitial.pageContentInert,
      focusableCountPositive: modalInitial.focusableCount > 0,
      tabWrapped: modalTabWrapped,
      closed: modalFinal.closed,
      focusReturned: modalFinal.focusReturned,
      closedModalInert: modalFinal.closedModalInert
    };

    // restoreOverlayFocus keeps re-focusing the opener from a setTimeout(0) and a
    // double requestAnimationFrame, so a restore can still land after the close
    // condition passes — headless frames arrive late, which is why this only ever
    // failed here and in CI. Drain those callbacks before taking the field, then
    // re-focus until it sticks. The product behaviour is correct; the test raced it.
    await evaluate(cdp, `new Promise(resolve => {
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(
        () => setTimeout(resolve, 0)
      )), 0);
    })`);

    await waitForRequiredCondition(cdp, `(() => {
      const input = document.getElementById('characters-search');
      if (document.activeElement !== input) input.focus();
      return document.activeElement === input;
    })()`, 'The global character search field never kept focus.', { timeoutMs: 1600, intervalMs: 60 });

    report.modal.keyboardIsolation = await evaluate(cdp, `(async () => {
      const input = document.getElementById('characters-search');
      const before = window.ISMAppDiagnostics.getCurrentDetailCode();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 80));
      const after = window.ISMAppDiagnostics.getCurrentDetailCode();
      const active = document.activeElement;
      return {
        unchanged: before === after && active === input,
        before,
        after,
        // Name whatever stole focus; "unchanged: false" alone says nothing about why.
        activeElement: active === input
          ? 'characters-search'
          : (active && active.tagName ? active.tagName.toLowerCase() : 'none')
            + (active && active.id ? '#' + active.id : '')
            + (active && active.className ? '.' + String(active.className).split(' ')[0] : ''),
      };
    })()`);

    report.characters.scopeFilter = await evaluate(cdp, `(async () => {
      const button = document.querySelector('[data-character-scope="external"]');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 160));
      const visibleCodes = [...document.querySelectorAll('.char-card[data-code]')]
        .filter(card => card.getClientRects().length && getComputedStyle(card).display !== 'none')
        .map(card => card.dataset.code);
      const expectedCodes = [...document.querySelectorAll('.char-card[data-code]')]
        .filter(card => card.dataset.org !== 'ism')
        .map(card => card.dataset.code);
      const result = {
        activeOrg: document.querySelector('.org-roster.active')?.id || '',
        externalBackground: document.getElementById('section-characters').classList.contains('char-bg-external'),
        pressed: button.getAttribute('aria-pressed') === 'true',
        matches: JSON.stringify(visibleCodes) === JSON.stringify(expectedCodes),
        visibleCodes,
        expectedCodes
      };
      document.getElementById('characters-search-reset').click();
      return result;
    })()`);

    // A low desktop viewport previously flattened the fixed-ratio stage and
    // clipped the lower part of wide business cards. Keep every detail record
    // under that same vertical pressure during the full sweep.
    await setViewport(cdp, 1536, 742);
    report.characters.detailSweep = await evaluate(cdp, `(async () => {
      const failures = [];
      const cardsOnScreen = document.querySelectorAll('.char-card[data-code]').length;
      for (const character of window.ISMAppDiagnostics.getCharacters()) {
        window.ISMAppDiagnostics.openCharacterDetail(character.code, true);
        const images = [
          document.getElementById('cdp-main-img'),
          document.getElementById('cdp-signature-img')
        ].filter(Boolean);
        await Promise.all(images.map(image => image.complete
          ? Promise.resolve()
          : Promise.race([
              new Promise(resolve => image.addEventListener('load', resolve, { once: true })),
              new Promise(resolve => image.addEventListener('error', resolve, { once: true })),
              new Promise(resolve => setTimeout(resolve, 1200))
            ])
        ));
        await new Promise(resolve => setTimeout(resolve, 40));
        const mainImage = document.getElementById('cdp-main-img');
        const signatureImage = document.getElementById('cdp-signature-img');
        const mainStage = document.querySelector('.cdp-business-card-stage');
        const meta = document.querySelector('#cdp-content .cdp-profile-meta')?.textContent || '';
        const modal = document.getElementById('char-detail');
        const pages = document.querySelectorAll('#cdp-content .cdp-page');
        const mainLoaded = !!mainImage?.complete && mainImage.naturalWidth > 0;
        const signatureLoaded = !!signatureImage?.complete && signatureImage.naturalWidth > 0;
        const mainImageRect = mainImage?.getBoundingClientRect();
        const mainStageRect = mainStage?.getBoundingClientRect();
        const mainImageContained = !mainImageRect || !mainStageRect || (
          mainImageRect.left >= mainStageRect.left - 1 &&
          mainImageRect.top >= mainStageRect.top - 1 &&
          mainImageRect.right <= mainStageRect.right + 1 &&
          mainImageRect.bottom <= mainStageRect.bottom + 1
        );
        const mainImageUsesContain = !mainImage || getComputedStyle(mainImage).objectFit === 'contain';
        const mainImageDeclaredMissing = ['00', '01'].every(assetCode =>
          window.ISMAppDiagnostics.isCharacterAssetMissing(character, window.ISMAppDiagnostics.defaultOutfitCode, assetCode)
        );
        const signatureImageDeclaredMissing = window.ISMAppDiagnostics
          .detailAssetCandidates(character, character.signatureAsset).length === 0;
        const expectedMainAsset = mainImageDeclaredMissing
          ? ''
          : (window.ISMAppDiagnostics.isCharacterAssetMissing(character, window.ISMAppDiagnostics.defaultOutfitCode, '00') ? '01' : '00');
        const mainSourceMatches = mainImageDeclaredMissing
          ? !!mainImage?.hidden
          : mainImage?.getAttribute('src')?.endsWith('/' + character.code + '/D/' + expectedMainAsset + '.webp');
        const signatureSourceMatches = signatureImageDeclaredMissing
          ? !!signatureImage?.hidden
          : signatureLoaded;
        if (!meta.includes(character.code) || (!mainImageDeclaredMissing && (!mainLoaded || !mainImageContained || !mainImageUsesContain)) || !signatureSourceMatches || !mainSourceMatches || pages.length !== 2 || modal.scrollTop !== 0 || modal.scrollWidth > modal.clientWidth + 1) {
          failures.push({
            code: character.code,
            metaMatches: meta.includes(character.code),
            mainLoaded,
            mainImageContained,
            mainImageUsesContain,
            signatureLoaded,
            mainImageDeclaredMissing,
            signatureImageDeclaredMissing,
            expectedMainAsset,
            mainSource: mainImage?.getAttribute('src') || '',
            mainSourceMatches,
            signatureSourceMatches,
            pageCount: pages.length,
            scrollTop: modal.scrollTop,
            horizontalOverflow: modal.scrollWidth > modal.clientWidth + 1
          });
        }
      }
      window.ISMAppDiagnostics.closeCharacterDetail({ history: false, restoreFocus: false });
      await new Promise(resolve => setTimeout(resolve, 340));
      return { checked: window.ISMAppDiagnostics.getCharacters().length, cardsOnScreen, failures };
    })()`);

    report.characters.detailNameGrouping = await evaluate(cdp, `(() => {
      const inspectName = code => {
        window.ISMAppDiagnostics.openCharacterDetail(code, true);
        return [...document.querySelectorAll('.cdp-profile-name-part')]
          .map(part => part.textContent.trim());
      };
      const aldheim = inspectName('HB');
      const hohendorf = inspectName('CS');
      const luna = inspectName('LN');
      const lunaQuote = document.querySelector('.cdp-profile-quote')?.textContent || '';
      window.ISMAppDiagnostics.closeCharacterDetail({ history: false, restoreFocus: false });
      return {
        aldheim: JSON.stringify(aldheim) === JSON.stringify(['에르베스', '드 알드헤임']),
        hohendorf: JSON.stringify(hohendorf) === JSON.stringify(['카시안', '반 호엔돌프']),
        lunaOfficialName: JSON.stringify(luna) === JSON.stringify(['루나']),
        lunaQuoteAliasPreserved: lunaQuote.includes('루나 반 바스커빌')
      };
    })()`);

    // 적월극장은 '적월극장' 타이핑에서 명함 다섯 번 두드리기로 바뀌었다.
    // 타이핑은 시도할 이유가 없었고 키보드 없는 화면에서는 닿을 수조차 없었다.
    report.characters.redMoonEaster = await evaluate(cdp, `(async () => {
      const knockCard = async times => {
        for (let i = 0; i < times; i += 1) {
          document.querySelector('.cdp-business-card-stage')?.click();
          await new Promise(resolve => setTimeout(resolve, 120));
        }
      };

      window.ISMAppDiagnostics.openCharacterDetail('YU', true);
      await new Promise(resolve => setTimeout(resolve, 260));
      await knockCard(5);
      const restrictedToElinalise = !document.getElementById('redmoon-easter');
      // 다른 인물의 명함은 원래대로 라이트박스를 연다. 열어 둔 채 다음 단계로
      // 가면 그 라이트박스가 Escape를 먼저 삼켜 정리 확인이 어긋난다.
      window.ISMLightboxControls?.close?.();
      await new Promise(resolve => setTimeout(resolve, 320));

      window.ISMAppDiagnostics.openCharacterDetail('EB', true);
      await new Promise(resolve => setTimeout(resolve, 260));
      await knockCard(5);
      // 다섯 번째 뒤에 엘리나리제가 화면을 덮고 나서 적월극장이 열린다.
      const tauntShown = !!document.querySelector('.redmoon-taunt');
      await new Promise(resolve => setTimeout(resolve, 2200));
      const overlay = document.getElementById('redmoon-easter');
      const images = overlay ? [...overlay.querySelectorAll('img')] : [];
      await Promise.all(images.map(image => image.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          })));
      const result = {
        restrictedToElinalise,
        tauntShown,
        opened: !!overlay,
        durationIsFiveSeconds: overlay?.dataset.duration === '5000',
        posterLoaded: !!overlay?.querySelector('.redmoon-poster')?.naturalWidth,
        rudyBurstLoaded: !!overlay?.querySelector('.redmoon-burst--left')?.naturalWidth,
        rubyBurstLoaded: !!overlay?.querySelector('.redmoon-burst--right')?.naturalWidth,
        rudyUsesTenthAsset: overlay?.querySelector('.redmoon-burst--left')?.getAttribute('src')?.endsWith('/RD/D/10.webp') || false,
        rubyUsesTenthAsset: overlay?.querySelector('.redmoon-burst--right')?.getAttribute('src')?.endsWith('/RB/D/10.webp') || false,
        burstCopyRemoved: !overlay?.textContent.includes('뿜'),
        louiseLoaded: !!overlay?.querySelector('.redmoon-louise')?.naturalWidth,
        louiseUsesDisappointedAsset: overlay?.querySelector('.redmoon-louise')?.getAttribute('src')?.endsWith('/LB/D/16.webp') || false
      };
      // 명함을 눌러 여는 방식이 되면서 키보드 없는 화면에서도 열린다. 그래서
      // 아무 데나 눌러 닫는 길이 주 경로다. Escape는 그대로 두되, 그 키는
      // 상세까지 함께 닫아 히스토리 이동을 일으키므로 여기서는 확인하지 않는다.
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 320));
      result.pointerCleanup = !document.getElementById('redmoon-easter');
      window.ISMAppDiagnostics.closeCharacterDetail({ history: false, restoreFocus: false });
      return result;
    })()`);

    if (screenshotDir) {
      await evaluate(cdp, `(() => {
        window.ISMAppDiagnostics.openCharacterDetail('EB', true);
        for (const key of 'wjrdnjfrmrwkd') {
          document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        }
      })()`);
      await sleep(320);
      await captureScreenshot(cdp, path.join(screenshotDir, 'red-moon-easter.png'));
      await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true
      }))`);
      await sleep(260);
    }

    report.characters.detailScrollInput = await evaluate(cdp, `(async () => {
      window.ISMAppDiagnostics.openCharacterDetail('YU', true);
      const modal = document.getElementById('char-detail');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      modal.scrollTo({ top: 0, behavior: 'auto' });
      const wheelEvents = [20, 120].map(deltaY => new WheelEvent('wheel', {
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        bubbles: true,
        cancelable: true
      }));
      wheelEvents.forEach(event => modal.dispatchEvent(event));
      modal.querySelector('.cdp-scroll-guide').click();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const profileTop = modal.querySelector('[data-detail-profile-page]').offsetTop;
      const guideScrollTop = modal.scrollTop;
      const guideReachedProfile = Math.abs(guideScrollTop - profileTop) < 3;
      window.ISMAppDiagnostics.closeCharacterDetail({ history: false, restoreFocus: false });
      await new Promise(resolve => setTimeout(resolve, 340));
      return {
        nativeScrollAllowed: wheelEvents.every(event => !event.defaultPrevented),
        guideReachedProfile,
        guideScrollTop,
        profileTop
      };
    })()`);

    report.characters.detailProfileReveal = await evaluate(cdp, `(async () => {
      window.ISMAppDiagnostics.openCharacterDetail('EB', true);
      const modal = document.getElementById('char-detail');
      const profile = modal.querySelector('[data-detail-profile-page]');
      const guide = modal.querySelector('.cdp-scroll-guide');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      guide.click();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const result = {
        profileVisible: profile.classList.contains('is-visible'),
        profileNamePresent: !!profile.querySelector('.cdp-profile-name')?.textContent.trim(),
        profileInformationPresent: !!profile.querySelector('.cdp-profile-information'),
        profileReached: modal.scrollTop >= profile.offsetTop - 3,
      };
      window.ISMAppDiagnostics.closeCharacterDetail({ history: false, restoreFocus: false });
      await new Promise(resolve => setTimeout(resolve, 340));
      return result;
    })()`);

    report.sections = {};
    for (const id of SCROLL_SECTION_IDS) {
      await evaluate(cdp, `(() => {
        const link = document.querySelector('.scroll-index-dot[data-section-index="${id}"]');
        link?.click();
        return !!link;
      })()`);
      const activated = !!(await waitForCondition(cdp, `(() => {
        const link = document.querySelector('.scroll-index-dot[data-section-index="${id}"]');
        const section = document.getElementById('section-${id}');
        return !!link && !!section && section.classList.contains('active') &&
          !section.hidden && !section.inert &&
          link.classList.contains('active') && link.getAttribute('aria-current') === 'page';
      })()`, { timeoutMs: 2800, intervalMs: 90 }));
      report.sections[id] = activated;
    }


    report.accessibility = await evaluate(cdp, `(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const formControls = [...document.querySelectorAll('input, select, textarea')];
      const hasAccessibleName = element => !!(
        element.getAttribute('aria-label') ||
        element.getAttribute('aria-labelledby') ||
        (element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]'))
      );
      return {
        duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        imagesWithoutAlt: [...document.images].filter(img => !img.hasAttribute('alt')).map(img => img.src),
        unlabeledButtons: [...document.querySelectorAll('button')].filter(button =>
          !button.textContent.trim() && !button.getAttribute('aria-label') && !button.getAttribute('title')
        ).length,
        unlabeledFormControls: formControls.filter(element => !hasAccessibleName(element)).map(element => element.id || element.className),
        currentScrollSection: document.querySelector('.scroll-index-dot[aria-current="page"]')?.dataset.sectionIndex || '',
        organizationStateMatches: [...document.querySelectorAll('.org-select-card[data-org]')].every(button =>
          (button.getAttribute('aria-pressed') === 'true') === button.classList.contains('active')
        ),
        hasDescription: !!document.querySelector('meta[name="description"]')?.content.trim(),
        hasThemeColor: !!document.querySelector('meta[name="theme-color"]')?.content.trim(),
        fontStatus: document.fonts.status,
        bodyFont: getComputedStyle(document.body).fontFamily
      };
    })()`);

    if (screenshotDir) {
      await setViewport(cdp, 390, 844);
      await navigate(cdp, galleryUrl);
      await captureScreenshot(cdp, path.join(screenshotDir, 'gallery-mobile-categories.png'));
      await evaluate(cdp, `(async () => {
        const input = document.querySelector('#emo-sidebar .assets-sidebar-search');
        input.value = 'ism';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'ism' }));
        await new Promise(resolve => setTimeout(resolve, 180));
      })()`);
      await captureScreenshot(cdp, path.join(screenshotDir, 'gallery-mobile.png'));
      await setViewport(cdp, 1440, 1000);
      await navigate(cdp, galleryUrl);
      await captureScreenshot(cdp, path.join(screenshotDir, 'gallery-desktop-categories.png'));
      await navigate(cdp, `${baseUrl}#characters`);
      await evaluate(cdp, `document.querySelector('.org-select-card[data-org="external"]').click()`);
      await sleep(180);
      await captureScreenshot(cdp, path.join(screenshotDir, 'external-desktop.png'));
      for (const [code, filename] of [
        ['SH', 'detail-ism-profile-desktop.png'],
        ['EB', 'detail-pbs-profile-desktop.png'],
        ['SV', 'detail-hprf-profile-desktop.png'],
        ['HT', 'detail-wf-profile-desktop.png'],
        ['HY', 'detail-nf-profile-desktop.png'],
      ]) {
        await evaluate(cdp, `(async () => {
        window.ISMAppDiagnostics.openCharacterDetail('${code}', true);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const modal = document.getElementById('char-detail');
        const profile = modal.querySelector('[data-detail-profile-page]');
        modal.scrollTo({ top: profile.offsetTop, behavior: 'auto' });
        await new Promise(resolve => setTimeout(resolve, 420));
        })()`);
        await captureScreenshot(cdp, path.join(screenshotDir, filename));
      }
    }

    report.consoleErrors = cdp.events
      .filter(event => event.method === 'Runtime.exceptionThrown' ||
        (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'))
      .map(event => event.params.exceptionDetails?.text ||
        event.params.args?.map(arg => arg.value || arg.description).join(' ') || 'Unknown console error');
    report.failedRequests = cdp.events
      .filter(event => event.method === 'Network.loadingFailed' && !event.params.canceled)
      .map(event => ({ error: event.params.errorText, type: event.params.type }));

    report.failures = [];
    const requireCheck = (condition, message) => {
      if (!condition) report.failures.push(message);
    };
    requireCheck(Object.values(report.viewports).every(viewport => !viewport.horizontalOverflow), 'A tested viewport has horizontal page overflow.');
    requireCheck(Object.values(report.viewports).every(viewport => viewport.renderedCards === viewport.expectedCards), 'A tested viewport did not render all character cards.');
    // 아카데미와 외부 인물 명부를 모두 펼친 채로 시작한다.
    requireCheck(report.characters.initial.defaultCollapsedGroups.length === 0, 'Character roster groups must open expanded.');
    requireCheck(report.characters.initial.academyGroupsExpanded, 'Academy roster groups must open expanded.');
    requireCheck(Object.values(report.viewports).every(viewport => !viewport.smallTouchTargets.length), 'A narrow viewport has a key control smaller than 44px.');
    // 색인이 좁은 화면을 다시 크게 가리지 않도록 못을 박는다. 예전에는 60×286px,
    // 화면의 5.3%를 세로 한가운데서 차지해 여섯 구간 모두에서 본문을 덮었다.
    requireCheck(
      Object.entries(report.viewports).every(([, viewport]) => {
        const footprint = viewport.scrollIndexFootprint;
        if (!footprint) return false;
        return footprint.collapsedOnNarrow && footprint.areaPercent <= 2;
      }),
      `The scroll index covers too much of a narrow viewport: ${JSON.stringify(
        Object.fromEntries(Object.entries(report.viewports).map(([key, viewport]) => [key, viewport.scrollIndexFootprint]))
      )}`
    );
    requireCheck(Object.values(report.textOverflow).every(issues => issues.length === 0), 'Visible text overflows its container at the mobile breakpoint.');
    requireCheck(Object.values(report.main.structure).every(Boolean), 'The main registry structure or semantic navigation regressed.');
    requireCheck(Object.values(report.main.autoplay).every(Boolean), `The autoplay control or transition regressed: ${JSON.stringify(report.main.autoplay)}`);
    requireCheck(
      Object.values(report.main.factions.views).every(view => Object.values(view).every(Boolean)) &&
      report.main.factions.nextWraps &&
      report.main.factions.previousWraps,
      'A faction main view, selector state, logo set, or wraparound step control regressed.'
    );
    requireCheck(
      report.main.motion.factionTextStatic,
      'Faction copy moved on pointer input; it must stay static.'
    );
    requireCheck(
        report.main.motion.sealIdleStill &&
        report.main.motion.orbitStill &&
        report.main.motion.titleDropActive &&
        report.main.motion.copyDropActive &&
        report.main.motion.sealDoesNotDrop,
      `The main registry motion regressed: ${JSON.stringify(report.main.motion)}`
    );
    requireCheck(Object.values(report.main.reducedMotion).every(Boolean), 'Reduced-motion mode did not disable autoplay or nonessential motion.');
    requireCheck(Object.values(report.main.mobile).every(Boolean), 'The main registry mobile ledger layout regressed.');
    requireCheck(
      Object.values(report.main.factionsMobile).every(view => Object.values(view).every(Boolean)),
      'A faction main view overflows or has an unloaded logo on mobile.'
    );
    requireCheck(Object.values(report.scrollIndex).every(Boolean), 'The fixed scroll index or legacy-navigation removal regressed.');
    requireCheck(Object.values(report.characters.order).every(group => group.matches), 'Character card order differs from normalized data order.');
    requireCheck(Object.values(report.characters.gradeToggle).every(Boolean), 'Student grade toggles are not semantic buttons or ARIA-synchronized.');
    requireCheck(
      report.characters.urlFilters.initial.input === '한서윤' &&
      report.characters.urlFilters.initial.scopePressed === 'true' &&
      report.characters.urlFilters.initial.gradePressed === 'true' &&
      report.characters.urlFilters.initial.filters.scope === 'external' &&
      report.characters.urlFilters.afterPop.input === '유리' &&
      report.characters.urlFilters.afterPop.scopePressed === 'true' &&
      report.characters.urlFilters.afterPop.gradePressed === 'true' &&
      report.characters.urlFilters.afterPop.filters.scope === 'ism',
      'Character filters did not restore from URL or popstate.'
    );
    requireCheck(report.characters.hover.panelWithinViewport, 'The hover credential leaves the viewport.');
    requireCheck(report.characters.search.visibleCodes.join(',') === 'HY', 'Character search returned an unexpected result.');
    requireCheck(report.characters.scopeFilter.activeOrg === 'org-external' && report.characters.scopeFilter.externalBackground && report.characters.scopeFilter.pressed && report.characters.scopeFilter.matches, 'External character scope did not synchronize the roster and results.');
    // 처음 잰 카드 수와 비교하면 그 사이 갤러리에서 스포일러가 켜졌을 때 어긋난다.
    // 스윕은 그 시점에 실제로 화면에 있는 인물을 훑으므로 같은 시점의 카드 수와 맞춘다.
    requireCheck(report.characters.detailSweep.checked === report.characters.detailSweep.cardsOnScreen && report.characters.detailSweep.failures.length === 0, 'A character detail record failed its content, image, or overflow check.');
    requireCheck(Object.values(report.characters.detailNameGrouping).every(Boolean), 'A compound surname or Luna alias display regressed.');
    requireCheck(Object.values(report.characters.redMoonEaster).every(Boolean), 'The Elinalise red moon easter egg regressed.');
    requireCheck(report.characters.detailScrollInput.nativeScrollAllowed && report.characters.detailScrollInput.guideReachedProfile, 'Detail scrolling or the page transition guide regressed.');
    requireCheck(Object.values(report.characters.detailProfileReveal).every(Boolean), 'The Elinalise profile record did not reveal after the detail transition.');
    requireCheck(report.characters.externalDetail.opened, 'An external character card did not open its detail record.');
    requireCheck(/Times New Roman/i.test(report.characters.englishNameFont), 'Character English names are not using Times New Roman.');
    requireCheck(Object.values(report.characters.sarielIdentity).every(Boolean), 'The Sariel identity data did not remain separate from Silvano Jung.');
    requireCheck(report.gallery.search.layout === 'grid' && !report.gallery.search.horizontalOverflow, 'Mobile gallery search did not switch to a vertical-flow grid.');
    requireCheck(Object.values(report.gallery.minorSafety).every(Boolean), 'A minor character entered the NSFW gallery path.');
    requireCheck(
      report.gallery.organizationGroups.collapseWorks &&
      Object.values(report.gallery.organizationGroups).filter(value => typeof value === 'object').every(result =>
        result.organizationOrderMatches && result.namesSorted && result.defaultOpenIsAcademyOnly
      ),
      `Gallery organization grouping, sorting, or default-open behavior regressed: ${JSON.stringify(report.gallery.organizationGroups)}`
    );
    requireCheck(
      report.gallery.lightbox.keyboardMoved &&
        report.gallery.lightbox.screenArrowMoved &&
        report.gallery.lightbox.closed,
      `Lightbox keyboard, arrow, or close controls regressed: ${JSON.stringify({
        keyboardMoved: report.gallery.lightbox.keyboardMoved,
        screenArrowMoved: report.gallery.lightbox.screenArrowMoved,
        closed: report.gallery.lightbox.closed,
        cardCount: report.gallery.lightbox.cardCount,
        opened: report.gallery.lightbox.opened,
      })}`
    );
    requireCheck(
      report.gallery.lightbox.focusInsideOnOpen &&
        report.gallery.lightbox.tabWrapped &&
        report.gallery.lightbox.arrowFocusRetained &&
        report.gallery.lightbox.focusReturned &&
        report.gallery.lightbox.closedLightboxInert,
      `Lightbox focus management regressed: ${JSON.stringify({
        focusInsideOnOpen: report.gallery.lightbox.focusInsideOnOpen,
        tabWrapped: report.gallery.lightbox.tabWrapped,
        arrowFocusRetained: report.gallery.lightbox.arrowFocusRetained,
        focusReturned: report.gallery.lightbox.focusReturned,
        closedLightboxInert: report.gallery.lightbox.closedLightboxInert,
        focusableCount: report.gallery.lightbox.focusableCount,
      })}`
    );
    requireCheck(
      report.gallery.lightbox.lucyBattleAssetVisible &&
      report.gallery.lightbox.optionalOutfitsOmitted &&
      report.gallery.lightbox.optionalOutfitSectionsAbsent,
      'Lucy battle asset is missing or hidden optional outfit assets leaked into the gallery.'
    );
    requireCheck(Object.values(report.gallery.sarielBattle).every(Boolean), 'A spoiler-only character or battle asset is missing from the gallery.');
    requireCheck(report.modal.keyboardIsolation.unchanged, 'Typing-field arrow keys changed the detail record.');
    requireCheck(
      Object.values(report.modal.focusManagement).every(Boolean),
      // tabWrapped만 false로 나오면 왜인지 알 수 없다. 어느 요소에서 눌렀고
      // 어디로 갔는지를 함께 찍어야 초점을 훔친 범인이 보인다.
      `Character detail focus containment or restoration regressed: ${JSON.stringify(report.modal.focusManagement)} probe=${JSON.stringify(report.modal.tabWrapProbe)}`
    );
    requireCheck(Object.values(report.sections).every(Boolean), 'A primary navigation section did not activate.');
    requireCheck(Object.values(report.world.canon).every(Boolean), 'The 8888 massacre and long-coexistence World canon regressed.');
    requireCheck(
      Object.values(report.world.toc).every(Boolean),
      `The World & Lore table-of-contents interface regressed: ${JSON.stringify(report.world.toc)}`
    );
    requireCheck(Object.values(report.world.stigmaSigmaSymbol).every(Boolean), 'The Stigma and Sigma symbol WebP reference or image load regressed.');
    // Report which sub-check failed. A bare "checks failed" message sent one
    // session digging through the whole report to find a single stale value.
    const accessibilityProblems = [
      report.accessibility.duplicateIds.length && `duplicate ids: ${report.accessibility.duplicateIds.join(', ')}`,
      report.accessibility.imagesWithoutAlt.length && `images without alt: ${report.accessibility.imagesWithoutAlt.join(', ')}`,
      report.accessibility.unlabeledButtons !== 0 && `unlabeled buttons: ${report.accessibility.unlabeledButtons}`,
      report.accessibility.unlabeledFormControls.length && `unlabeled form controls: ${report.accessibility.unlabeledFormControls.join(', ')}`,
      report.accessibility.currentScrollSection !== LAST_SCROLL_SECTION_ID
        && `scroll index rests on "${report.accessibility.currentScrollSection}", expected "${LAST_SCROLL_SECTION_ID}"`,
      !report.accessibility.organizationStateMatches && 'organization aria-pressed and active class disagree',
    ].filter(Boolean);
    requireCheck(
      accessibilityProblems.length === 0,
      `Basic accessibility checks failed: ${accessibilityProblems.join(' | ')}`
    );
    requireCheck(report.accessibility.hasDescription && report.accessibility.hasThemeColor, 'Document metadata is incomplete.');
    requireCheck(report.consoleErrors.length === 0 && report.failedRequests.length === 0, 'Console errors or failed requests were detected.');

    console.log(JSON.stringify(report, null, 2));
    console.log(`SMOKE_FAILURES: ${report.failures.join(' | ') || 'none'}`);
    if (report.failures.length) process.exitCode = 1;
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      // Fall back to terminating the launcher process below.
    }
    if (chromeProcess.exitCode === null) {
      const exited = new Promise(resolve => chromeProcess.once('exit', resolve));
      chromeProcess.kill();
      await Promise.race([exited, sleep(1600)]);
    }
    cdp?.close();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch {
        // Windows can keep Chrome profile files locked briefly after process exit.
        await sleep(250);
      }
    }
  }
}

run().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
