(() => {
  // Disable only on pure touch mobile devices that cannot hover and have coarse pointer
  if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    return;
  }

  const ICONS = {
    default: {
      dx: 3,
      dy: 3,
      svg: '<svg class="cursor-icon icon-default" width="26" height="30" viewBox="0 0 26 30" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3L3 23.5L8.5 18.5L13 27.5L16.2 25.8L11.8 17L19.5 17L3 3Z" fill="#0b0f19" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>'
    },
    pointer: {
      dx: 10.5,
      dy: 1.5,
      svg: '<svg class="cursor-icon icon-pointer" width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 1.5C9.4 1.5 8.5 2.4 8.5 3.5V16.2L6.8 14.5C6 13.7 4.7 13.7 3.9 14.5C3.1 15.3 3.1 16.6 3.9 17.4L9.2 24.5C10.5 26.2 12.5 27.2 14.7 27.2C18.6 27.2 21.8 24 21.8 20.1V14.5C21.8 13.4 20.9 12.5 19.8 12.5C19.5 12.5 19.2 12.6 18.9 12.7C18.6 11.7 17.6 11 16.5 11C16.1 11 15.7 11.1 15.4 11.3C15 10.4 14.1 9.8 13 9.8C12.8 9.8 12.6 9.8 12.5 9.9V3.5C12.5 2.4 11.6 1.5 10.5 1.5Z" fill="#0b0f19" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>'
    },
    text: {
      dx: 12,
      dy: 14,
      svg: '<svg class="cursor-icon icon-text" width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4H17M12 4V24M7 24H17" stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 4H17M12 4V24M7 24H17" stroke="#0b0f19" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    wait: {
      dx: 14,
      dy: 14,
      svg: '<svg class="cursor-icon icon-wait win11-spinner" width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="10.5" stroke="rgba(255,255,255,0.25)" stroke-width="2.8"/><path d="M14 3.5C19.799 3.5 24.5 8.20101 24.5 14C24.5 16.5 23.5 18.9 21.8 20.8" stroke="url(#win11SpinGrad)" stroke-width="3.2" stroke-linecap="round"/><defs><linearGradient id="win11SpinGrad" x1="14" y1="3.5" x2="24" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs></svg>'
    },
    'not-allowed': {
      dx: 13,
      dy: 13,
      svg: '<svg class="cursor-icon icon-not-allowed" width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="13" r="10" fill="#0b0f19" stroke="#ffffff" stroke-width="2.2"/><circle cx="13" cy="13" r="8" fill="none" stroke="#ef4444" stroke-width="2.4"/><line x1="7.5" y1="7.5" x2="18.5" y2="18.5" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/></svg>'
    },
    help: {
      dx: 3,
      dy: 3,
      svg: '<svg class="cursor-icon icon-help" width="28" height="30" viewBox="0 0 28 30" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3L3 23.5L8.5 18.5L13 27.5L16.2 25.8L11.8 17L19.5 17L3 3Z" fill="#0b0f19" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="21" cy="19" r="6" fill="#0b0f19" stroke="#ffffff" stroke-width="2"/><text x="21" y="22.2" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif">?</text></svg>'
    }
  };

  let cursor = null;
  let x = -100;
  let y = -100;
  let frame = 0;
  let isVisible = false;
  let currentMode = 'default';

  const ensureCursor = () => {
    if (!cursor || !document.body.contains(cursor)) {
      cursor = document.querySelector('.expo-cursor');
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'expo-cursor mode-default';
        cursor.setAttribute('aria-hidden', 'true');
        cursor.innerHTML = Object.values(ICONS).map(item => item.svg).join('');
        document.body.appendChild(cursor);
      }
    }
    return cursor;
  };

  const setMode = mode => {
    if (!ICONS[mode]) mode = 'default';
    if (mode === currentMode) return;
    if (cursor) {
      cursor.classList.remove(`mode-${currentMode}`);
      currentMode = mode;
      cursor.classList.add(`mode-${currentMode}`);
    } else {
      currentMode = mode;
    }
  };

  const detectMode = target => {
    if (!target || !(target instanceof Element)) return 'default';

    if (target.closest('button:disabled, input:disabled, select:disabled, [aria-disabled="true"], .disabled')) {
      return 'not-allowed';
    }

    if (document.body.classList.contains('is-loading') || target.closest('.skeleton, .loading, [aria-busy="true"]')) {
      return 'wait';
    }

    if (target.closest('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [contenteditable="true"], .rich')) {
      return 'text';
    }

    if (target.closest('a, button, select, [role="button"], label, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], .card, .btn, [tabindex]:not([tabindex="-1"]), [data-p], [data-page], [data-e], [data-c], [data-d]')) {
      return 'pointer';
    }

    if (target.closest('[title], [data-tooltip], abbr')) {
      return 'help';
    }

    try {
      const computed = window.getComputedStyle(target).cursor;
      if (computed === 'pointer') return 'pointer';
      if (computed === 'text') return 'text';
      if (computed === 'not-allowed') return 'not-allowed';
      if (computed === 'wait' || computed === 'progress') return 'wait';
      if (computed === 'help') return 'help';
    } catch {}

    return 'default';
  };

  const draw = () => {
    frame = 0;
    if (cursor) {
      const cfg = ICONS[currentMode] || ICONS.default;
      cursor.style.transform = `translate3d(${x - cfg.dx}px, ${y - cfg.dy}px, 0)`;
    }
  };

  const show = (clientX, clientY, target) => {
    ensureCursor();
    x = clientX;
    y = clientY;

    if (target) {
      setMode(detectMode(target));
    }

    if (!frame) frame = requestAnimationFrame(draw);
    if (!isVisible) {
      isVisible = true;
      cursor.classList.add('is-visible');
      document.body.classList.add('cursor-ready');
    }
  };

  const hide = () => {
    if (!isVisible) return;
    isVisible = false;
    if (cursor) cursor.classList.remove('is-visible');
    document.body.classList.remove('cursor-ready');
  };

  const onPointerMove = event => {
    if (event.pointerType && event.pointerType !== 'mouse') {
      hide();
      return;
    }
    show(event.clientX, event.clientY, event.target);
  };

  const onMouseMove = event => {
    show(event.clientX, event.clientY, event.target);
  };

  const onMouseDown = () => {
    if (cursor) cursor.classList.add('is-pressed');
  };

  const onMouseUp = () => {
    if (cursor) cursor.classList.remove('is-pressed');
  };

  const onMouseLeave = event => {
    if (!event.relatedTarget && !event.toElement) {
      hide();
    }
  };

  const init = () => {
    ensureCursor();

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    window.addEventListener('mousedown', onMouseDown, { passive: true });
    window.addEventListener('mouseup', onMouseUp, { passive: true });

    document.documentElement.addEventListener('mouseleave', onMouseLeave, { passive: true });
    document.documentElement.addEventListener('mouseenter', onPointerMove, { passive: true });

    window.addEventListener('blur', hide, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hide();
    });

    window.addEventListener('touchstart', hide, { passive: true });

    window.addEventListener('beforeunload', () => {
      if (frame) cancelAnimationFrame(frame);
    }, { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
