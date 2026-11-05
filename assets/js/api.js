(() => {
  'use strict';

  const cfg = window.APP_CONFIG;

  
  // Persist the token only for this tab so a page reload does not log users out.
  // The server remains authoritative: every reload validates the token.
  const SESSION_STORAGE_KEY = String(cfg.SESSION_KEY || 'ubuMemoSession') + ':tab:v1';
  function restoreSession() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === 'string' && /^[a-f0-9]{96}$/i.test(parsed.token)) {
        return { token: parsed.token };
      }
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (_) { /* Private mode or blocked storage: memory-only fallback. */ }
    return null;
  }
  let activeSession = restoreSession();
  function getSession() { return activeSession; }
  function setSession(session) {
    activeSession = session && session.token ? session : null;
    try {
      if (activeSession) {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: activeSession.token }));
      } else {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (_) { /* Continue without persistence if storage is disabled. */ }
  }

  async function request(action, payload = {}, options = {}) {
    if (!cfg.APPS_SCRIPT_API_URL || cfg.APPS_SCRIPT_API_URL.includes('PASTE_')) {
      throw new Error('ยังไม่ได้ตั้งค่า Apps Script API URL ใน assets/js/config.js');
    }

    const session = getSession();
    const body = {
      action,
      payload,
      token: options.noAuth ? null : (session && session.token ? session.token : null),
      requestId: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())
    };

    const actionTimeouts = {
      login: 90000,
      ssoLogin: 90000,
      session: 60000,
      logout: 30000,
      memoData: 90000,
      agencies: 90000,
      generateMemo: 150000,
      generateAdminMemo: 150000,
      combinedPayrollData: 90000,
      generateCombinedPayrollMemo: 150000
    };
    const timeoutMs = actionTimeouts[action] || cfg.REQUEST_TIMEOUT_MS || 90000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      
      
      const response = await fetch(cfg.APPS_SCRIPT_API_URL, {
        method: 'POST',
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch (_) { throw new Error('API ตอบกลับไม่ใช่ JSON ที่ถูกต้อง'); }

      if (!response.ok || data.success === false) {
        if (data.code === 'UNAUTHORIZED' || data.code === 'SESSION_EXPIRED') {
          setSession(null);
          window.dispatchEvent(new CustomEvent('auth:expired'));
        }
        const err = new Error(data.message || `HTTP ${response.status}`);
        err.code = data.code || 'API_ERROR';
        throw err;
      }
      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const e = new Error('การเชื่อมต่อเซิร์ฟเวอร์ใช้เวลานานกว่าปกติ กรุณาลองใหม่อีกครั้ง');
        e.code = 'API_TIMEOUT';
        throw e;
      }
      if (err instanceof TypeError) {
        const e = new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
        e.code = 'NETWORK_ERROR';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  window.Api = Object.freeze({
    getSession,
    setSession,
    login: (username, password) => request('login', { username, password }, { noAuth: true }),
    ssoLogin: (ticket) => request('ssoLogin', { ticket }, { noAuth: true }),
    validateSession: () => request('session'),
    logout: () => request('logout'),
    getMemoData: (agency = null, month = '', requireMonth = false) => request('memoData', { agency, month, requireMonth }),
    getAgencies: () => request('agencies'),
    generateMemo: (payload) => request('generateMemo', payload),
    generateAdminMemo: (payload) => request('generateAdminMemo', payload),
    getCombinedPayrollData: (payload) => request('combinedPayrollData', payload),
    generateCombinedPayrollMemo: (payload) => request('generateCombinedPayrollMemo', payload)
  });
})();
