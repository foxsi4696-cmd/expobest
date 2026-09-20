(() => {
  // app.js schedules its first route before the optional catalogue extensions
  // are loaded. Defer only that initial student route to the extension so the
  // generic renderer cannot race it and inject duplicate filter controls.
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    if (delay === 0 && callback?.name === 'route') {
      return nativeSetTimeout(() => {
        if (location.hash.split('?')[0] === '#/students' && typeof window.list === 'function') return window.list('students', t('students'));
        return callback(...args);
      }, delay);
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
})();
