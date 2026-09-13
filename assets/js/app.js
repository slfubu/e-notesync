(() => {
  'use strict';

  let globalData = {};
  let currentUser = {};
  let currentPdfUrl = null;
  let currentDocxUrl = null;
  let actingAgency = '';
  let adminAgencies = [];
  let selectedMemoMonth = '';
  let selectedAdminMonth = '';

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('[App Init]', err);
      Api.setSession(null);
      showLogin();
    });
  });
  window.addEventListener('auth:expired', () => {
    Api.setSession(null);
    showLogin();
    Swal.fire('หมดเวลาใช้งาน', 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง', 'warning');
  });

  async function init() {
    bindEvents();

    // SSO จาก S-MIS PORTAL ต้องถูกประมวลผลก่อน Session เดิม
    const ssoTicket = takeSsoTicketFromUrl();
    if (ssoTicket) {
      await loginWithSsoTicket(ssoTicket);
      return;
    }

    const session = Api.getSession();
    if (!session || !session.token) return showLogin();

    // ขั้นที่ 1: ตรวจ session เท่านั้น ถ้า session เสียจริงจึงค่อยออกจากระบบ
    try {
      const res = await Api.validateSession();
      currentUser = res.user;
      Api.setSession({ token: session.token, user: res.user });
    } catch (_) {
      Api.setSession(null);
      showLogin();
      return;
    }

    // ขั้นที่ 2: โหลดข้อมูลเริ่มต้น แยกจากการตรวจ session
    // ถ้า Google Sheets/API ช้า จะไม่ล้าง session และไม่เด้งกลับหน้า Login
    try {
      await enterApp();
    } catch (err) {
      await showInitialDataWarning(err);
    }
  }

  function takeSsoTicketFromUrl() {
    try {
      const rawHash = String(window.location.hash || '').replace(/^#/, '');
      if (!rawHash) return '';

      const params = new URLSearchParams(rawHash);
      const ticket = String(params.get('sso') || '').trim();

      if (ticket) {
        // ลบ Signed Token ออกจาก Address Bar / History ทันที
        history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }

      return ticket;
    } catch (_) {
      return '';
    }
  }

  async function loginWithSsoTicket(ticket) {
    // SSO ใหม่ต้องแทน Session เดิมเสมอ เพื่อป้องกันบัญชีเดิมค้างข้ามผู้ใช้
    Api.setSession(null);
    currentUser = {};

    try {
      const res = await Api.ssoLogin(ticket);

      if (!res || !res.token || !res.user) {
        throw new Error('ข้อมูล Single Sign-On ไม่สมบูรณ์');
      }

      currentUser = res.user;
      Api.setSession({
        token: res.token,
        user: res.user
      });

      try {
        await enterApp();
      } catch (err) {
        await showInitialDataWarning(err);
      }
    } catch (err) {
      Api.setSession(null);
      showLogin();

      await Swal.fire({
        icon: 'error',
        title: 'Single Sign-On ไม่สำเร็จ',
        text: err?.message || 'กรุณากลับไปที่ S-MIS PORTAL แล้วเปิด e-NoteSync ใหม่อีกครั้ง',
        confirmButtonText: 'ตกลง',
        returnFocus: false
      });
    }
  }

  function bindEvents() {
    const loginBtn = document.querySelector('.btn-login-new');
    if (loginBtn) loginBtn.addEventListener('click', doLogin);
    $('username')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password')?.focus(); });
    $('password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('togglePassword')?.addEventListener('click', togglePasswordVisibility);

    document.querySelectorAll('.btn-danger').forEach(btn => btn.addEventListener('click', confirmLogout));
    $('selectAll')?.addEventListener('change', toggleAll);
    $('adminAgencySelect')?.addEventListener('change', handleAdminAgencyChange);
    $('adminSelectAll')?.addEventListener('change', toggleAllAdmin);
    $('modeAgencyBtn')?.addEventListener('click', enterAgencyImpersonationMode);
    $('modeAdminBtn')?.addEventListener('click', enterAdminReportMode);
    $('backToAdminMode')?.addEventListener('click', showAdminModeChooser);
    $('backToAdminModeFromAdmin')?.addEventListener('click', showAdminModeChooser);
    $('impersonateAgencySelect')?.addEventListener('change', handleImpersonatedAgencyChange);
    $('memoMonthSelect')?.addEventListener('change', handleMemoMonthChange);
    $('adminMonthSelect')?.addEventListener('change', handleAdminMonthChange);

    // V1.6.0 Workflow UI helpers
    $('memoSearchInput')?.addEventListener('input', filterMemoRows);
    $('adminSearchInput')?.addEventListener('input', filterAdminRows);
    $('memoLatestMonthBtn')?.addEventListener('click', selectLatestMemoMonth);
    $('adminLatestMonthBtn')?.addEventListener('click', selectLatestAdminMonth);
    $('memoSelectVisibleBtn')?.addEventListener('click', () => selectVisibleItems('.chk-item', calcTotal));
    $('adminSelectVisibleBtn')?.addEventListener('click', () => selectVisibleItems('.chk-admin-item', calcAdminTotal));
    $('memoClearSelectionBtn')?.addEventListener('click', () => clearSelections('.chk-item', 'selectAll', calcTotal));
    $('adminClearSelectionBtn')?.addEventListener('click', () => clearSelections('.chk-admin-item', 'adminSelectAll', calcAdminTotal));
    bindSidebarNavigation();

    const printMemoBtn = document.querySelector('#appPage .btn-primary');
    if (printMemoBtn) printMemoBtn.addEventListener('click', printMemo);
    const printAdminBtn = document.querySelector('#adminPage .btn-primary');
    if (printAdminBtn) printAdminBtn.addEventListener('click', printAdminMemo);
  }

  function finishBoot() {
    document.body.classList.remove('app-booting');
    const boot = $('sessionBoot');
    if (boot) {
      boot.setAttribute('aria-hidden', 'true');
      boot.style.display = 'none';
    }
  }

  function showLogin() {
    currentUser = {};
    globalData = {};
    actingAgency = '';
    adminAgencies = [];
    selectedAdminMonth = '';
    $('loginPage').style.display = '';
    $('appPage').style.display = 'none';
    $('adminPage').style.display = 'none';
    $('adminModePage').style.display = 'none';
    finishBoot();
    resetPasswordVisibility();
    setLoginButtonLoading(false);
    window.requestAnimationFrame(() => $('username')?.focus());
  }

  function togglePasswordVisibility() {
    const passwordEl = $('password');
    const toggle = $('togglePassword');
    if (!passwordEl || !toggle) return;

    const show = passwordEl.type === 'password';
    passwordEl.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    const icon = toggle.querySelector('.material-icons-round');
    if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
    passwordEl.focus({ preventScroll: true });
  }

  function resetPasswordVisibility() {
    const passwordEl = $('password');
    const toggle = $('togglePassword');
    if (passwordEl) passwordEl.type = 'password';
    if (toggle) {
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', 'แสดงรหัสผ่าน');
      const icon = toggle.querySelector('.material-icons-round');
      if (icon) icon.textContent = 'visibility';
    }
  }

  function setLoginButtonLoading(isLoading) {
    const loginBtn = $('loginButton') || document.querySelector('.btn-login-new');
    const text = $('loginButtonText');
    const icon = loginBtn?.querySelector('.login-button-icon');
    if (!loginBtn) return;

    loginBtn.disabled = Boolean(isLoading);
    loginBtn.classList.toggle('is-loading', Boolean(isLoading));
    if (text) text.textContent = isLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ';
    if (icon) icon.textContent = isLoading ? 'sync' : 'arrow_forward';
  }

  async function enterApp() {
    $('loginPage').style.display = 'none';
    if (currentUser.role === 'admin') {
      const res = await Api.getAgencies();
      adminAgencies = Array.isArray(res.data) ? res.data.slice() : [];
      populateAgencyDropdowns(adminAgencies);
      updateAdminIdentity();
      showAdminModeChooser();
      finishBoot();
      return;
    }

    $('adminModePage').style.display = 'none';
    $('adminPage').style.display = 'none';
    $('appPage').style.display = 'flex';
    $('adminAgencyModeBar').style.display = 'none';
    updateAgencyDisplay(currentUser.faculty || '');
    updateRoleDisplay('หน่วยงานจ้างงานระหว่างเรียน', false);
    resetMemoMonthSelection();
    finishBoot();
    await loadData(true);
  }

  function updateAdminIdentity() {
    const name = currentUser.name || 'Administrator';
    const modeName = $('adminModeDisplayName');
    const reportName = $('adminReportDisplayName');
    if (modeName) modeName.textContent = name;
    if (reportName) reportName.textContent = name;
  }

  function hideWorkPages() {
    $('appPage').style.display = 'none';
    $('adminPage').style.display = 'none';
    $('adminModePage').style.display = 'none';
  }

  function showAdminModeChooser() {
    if (currentUser.role !== 'admin') return;
    hideWorkPages();
    $('adminModePage').style.display = 'flex';
    globalData = {};
    if ($('selectAll')) $('selectAll').checked = false;
    if ($('adminSelectAll')) $('adminSelectAll').checked = false;
  }

  function populateAgencyDropdowns(agencies) {
    const list = Array.isArray(agencies) ? agencies : [];
    const targets = [
      { el: $('adminAgencySelect'), placeholder: '-- เลือกระบุหน่วยงาน --' },
      { el: $('impersonateAgencySelect'), placeholder: '-- เลือกหน่วยงานที่ต้องการทำแทน --' }
    ];
    targets.forEach(({ el, placeholder }) => {
      if (!el) return;
      const previous = el.value;
      el.replaceChildren(new Option(placeholder, ''));
      list.forEach(a => el.add(new Option(a, a)));
      if (previous && list.includes(previous)) el.value = previous;
    });
  }

  function enterAgencyImpersonationMode() {
    if (currentUser.role !== 'admin') return;
    hideWorkPages();
    $('appPage').style.display = 'flex';
    $('adminAgencyModeBar').style.display = 'flex';
    updateRoleDisplay('ผู้ดูแลระบบ • ทำรายการแทนหน่วยงาน', true);
    resetMemoMonthSelection();
    const select = $('impersonateAgencySelect');
    if (actingAgency && adminAgencies.includes(actingAgency)) select.value = actingAgency;
    else select.value = '';

    if (select.value) {
      actingAgency = select.value;
      updateAgencyDisplay(actingAgency);
      loadData();
    } else {
      actingAgency = '';
      updateAgencyDisplay('กรุณาเลือกหน่วยงาน');
      clearAgencyWorkTable('กรุณาเลือกหน่วยงานด้านบนก่อนทำรายการ');
    }
  }

  function enterAdminReportMode() {
    if (currentUser.role !== 'admin') return;
    hideWorkPages();
    $('adminPage').style.display = 'flex';
    resetAdminMonthSelection();
    clearAdminTable('กรุณาเลือกหน่วยงานและประจำเดือนด้านบน');
  }

  async function handleImpersonatedAgencyChange() {
    const select = $('impersonateAgencySelect');
    actingAgency = select ? String(select.value || '') : '';
    resetMemoMonthSelection();
    if (!actingAgency) {
      updateAgencyDisplay('กรุณาเลือกหน่วยงาน');
      clearAgencyWorkTable('กรุณาเลือกหน่วยงานด้านบนก่อนทำรายการ');
      return;
    }
    updateAgencyDisplay(actingAgency);
    await loadData();
  }

  function clearAgencyWorkTable(message) {
    globalData = {};
    resetMemoMonthSelection();
    const tbody = $('tableBody');
    if (tbody) tbody.replaceChildren();
    if ($('noDataMsg')) {
      $('noDataMsg').style.display = 'block';
      $('noDataMsg').innerHTML = `<i class="material-icons-round" style="font-size:48px; margin-bottom:10px;">domain</i><br>${escapeHtml(message)}`;
    }
    if ($('selectAll')) $('selectAll').checked = false;
    resetSearchField('memoSearchInput');
    updateBudget(0);
    updateAgencyKpis();
  }

  function resetMemoMonthSelection() {
    selectedMemoMonth = '';
    const select = $('memoMonthSelect');
    if (select) {
      select.replaceChildren(new Option('-- เลือกเดือนที่มีรายการอนุมัติแล้ว --', ''));
      select.value = '';
      select.disabled = true;
    }
    const memoMonth = $('memoMonth');
    if (memoMonth) memoMonth.value = '';
    updateAgencyKpis();
  }

  function populateMemoMonthOptions(months, activeMonth = '') {
    const select = $('memoMonthSelect');
    if (!select) return;

    const list = Array.isArray(months)
      ? months.map(x => String(x || '').trim()).filter(Boolean)
      : [];

    select.replaceChildren(new Option('-- เลือกเดือนที่มีรายการอนุมัติแล้ว --', ''));
    list.forEach(month => select.add(new Option(month, month)));
    select.disabled = list.length === 0;

    const requested = String(activeMonth || '').trim();
    selectedMemoMonth = requested && list.includes(requested) ? requested : '';
    select.value = selectedMemoMonth;

    const memoMonth = $('memoMonth');
    if (memoMonth) memoMonth.value = selectedMemoMonth;
    updateAgencyKpis();
  }

  async function handleMemoMonthChange() {
    const select = $('memoMonthSelect');
    selectedMemoMonth = select ? String(select.value || '').trim() : '';
    const memoMonth = $('memoMonth');
    if (memoMonth) memoMonth.value = selectedMemoMonth;

    if ($('selectAll')) $('selectAll').checked = false;
    resetSearchField('memoSearchInput');
    if (!selectedMemoMonth) {
      globalData.items = [];
      renderTable([], 'กรุณาเลือกประจำเดือนที่ต้องการออกบันทึกข้อความ');
      updateBudget(0);
      return;
    }

    await loadData();
  }

  function bindSidebarNavigation() {
    document.querySelectorAll('.workspace-sidebar .sidebar-link').forEach(link => {
      link.addEventListener('click', () => {
        const sidebar = link.closest('.workspace-sidebar');
        sidebar?.querySelectorAll('.sidebar-link').forEach(x => x.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  function setUiText(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value == null ? '' : value);
  }

  function updateAgencyKpis() {
    const months = Array.isArray(globalData.availableMonths) ? globalData.availableMonths.length : 0;
    const items = Array.isArray(globalData.items) ? globalData.items.length : 0;
    const selected = [...document.querySelectorAll('.chk-item:checked')];
    let total = 0;
    selected.forEach(c => {
      const item = globalData.items?.[Number(c.value)];
      total += Number(item?.amount || 0);
    });
    setUiText('uiAvailableMonths', months.toLocaleString());
    setUiText('uiCurrentItems', items.toLocaleString());
    setUiText('uiSelectedCount', selected.length.toLocaleString());
    setUiText('uiSelectedTotal', total.toLocaleString());
  }

  function updateAdminKpis() {
    const months = Array.isArray(globalData.availableMonths) ? globalData.availableMonths.length : 0;
    const items = Array.isArray(globalData.items) ? globalData.items.length : 0;
    const selected = [...document.querySelectorAll('.chk-admin-item:checked')];
    let total = 0;
    selected.forEach(c => {
      const item = globalData.items?.[Number(c.value)];
      total += Number(item?.amount || 0);
    });
    setUiText('adminUiAvailableMonths', months.toLocaleString());
    setUiText('adminUiCurrentItems', items.toLocaleString());
    setUiText('adminUiSelectedCount', selected.length.toLocaleString());
    setUiText('adminUiSelectedTotal', total.toLocaleString());
  }

  function filterRows(inputId, checkboxSelector) {
    const input = $(inputId);
    const query = String(input?.value || '').trim().toLocaleLowerCase('th');
    document.querySelectorAll(checkboxSelector).forEach(check => {
      const row = check.closest('tr');
      if (!row) return;
      const haystack = String(row.dataset.search || row.textContent || '').toLocaleLowerCase('th');
      row.style.display = !query || haystack.includes(query) ? '' : 'none';
    });
  }

  function filterMemoRows() {
    if ($('selectAll')) $('selectAll').checked = false;
    filterRows('memoSearchInput', '.chk-item');
  }

  function filterAdminRows() {
    if ($('adminSelectAll')) $('adminSelectAll').checked = false;
    filterRows('adminSearchInput', '.chk-admin-item');
  }

  function selectVisibleItems(selector, recalc) {
    document.querySelectorAll(selector).forEach(check => {
      const row = check.closest('tr');
      if (!row || row.style.display === 'none') return;
      check.checked = true;
    });
    recalc();
  }

  function clearSelections(selector, masterId, recalc) {
    document.querySelectorAll(selector).forEach(check => { check.checked = false; });
    if ($(masterId)) $(masterId).checked = false;
    recalc();
  }

  function chooseNewestMonth(selectId) {
    const select = $(selectId);
    if (!select || select.disabled || select.options.length < 2) {
      return Swal.fire('ยังไม่มีเดือนให้เลือก', 'ไม่พบรายการอนุมัติที่พร้อมออกเอกสาร', 'info');
    }
    // Backend เรียง availableMonths ใหม่ -> เก่า อยู่แล้ว
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectLatestMemoMonth() { return chooseNewestMonth('memoMonthSelect'); }
  function selectLatestAdminMonth() { return chooseNewestMonth('adminMonthSelect'); }

  function resetSearchField(id) {
    const el = $(id);
    if (el) el.value = '';
  }

  function updateRoleDisplay(text, isAdminActing) {
    const el = $('displayRole');
    if (!el) return;
    el.textContent = text;
    el.style.background = isAdminActing ? '#FFF7D6' : '';
    el.style.color = isAdminActing ? '#8A5A00' : '';
  }

  async function doLogin() {
    const usernameEl = $('username');
    const passwordEl = $('password');
    const u = usernameEl.value.trim();
    const p = passwordEl.value;

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (!u || !p) {
      await Swal.fire({
        icon: 'warning',
        title: 'กรอกข้อมูลไม่ครบ',
        text: 'กรุณากรอกรหัสหน่วยงานและรหัสผ่านให้ครบถ้วน',
        confirmButtonText: 'ตกลง',
        returnFocus: false
      });
      if (!u) usernameEl.focus();
      else passwordEl.focus();
      return;
    }

    setLoginButtonLoading(true);
    Swal.fire({
      icon: 'info',
      title: 'กำลังเข้าสู่ระบบ',
      html: 'กำลังตรวจสอบบัญชีผู้ใช้งานกับฐานข้อมูลระบบกลาง<br><small style="color:#64748b">บางครั้งอาจใช้เวลาสักครู่ในการเริ่มทำงาน</small>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      returnFocus: false,
      didOpen: () => Swal.showLoading()
    });

    // ตรวจชื่อผู้ใช้/รหัสผ่านแยกจากการโหลดข้อมูลหลัง Login
    let res;
    try {
      res = await Api.login(u, p);
    } catch (err) {
      passwordEl.value = '';
      setLoginButtonLoading(false);
      await Swal.fire({
        icon: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ',
        text: err?.message || 'รหัสหน่วยงานหรือรหัสผ่านไม่ถูกต้อง',
        confirmButtonText: 'ลองใหม่อีกครั้ง',
        returnFocus: false
      });
      passwordEl.focus();
      return;
    }

    currentUser = res.user;
    Api.setSession({ token: res.token, user: res.user });
    passwordEl.value = '';
    setLoginButtonLoading(false);

    await Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: currentUser.name ? `ยินดีต้อนรับ ${currentUser.name}` : 'ระบบตรวจสอบบัญชีเรียบร้อยแล้ว',
      timer: 900,
      timerProgressBar: true,
      showConfirmButton: false,
      allowOutsideClick: false,
      returnFocus: false
    });

    // จากจุดนี้ Login สำเร็จแล้ว หากโหลดข้อมูลช้าต้องไม่รายงานว่า "รหัสผ่านผิด"
    try {
      await enterApp();
    } catch (err) {
      await showInitialDataWarning(err);
    }
  }

  async function showInitialDataWarning(err) {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'เข้าสู่ระบบสำเร็จ',
      html: `แต่ยังโหลดข้อมูลเริ่มต้นไม่สำเร็จ<br><small>${escapeHtml(err?.message || 'เซิร์ฟเวอร์ตอบกลับช้ากว่าปกติ')}</small>`,
      showCancelButton: true,
      confirmButtonText: 'ลองโหลดข้อมูลอีกครั้ง',
      cancelButtonText: 'ไว้ภายหลัง',
      returnFocus: false
    });

    if (result.isConfirmed) {
      try {
        await enterApp();
      } catch (retryErr) {
        await Swal.fire({
          icon: 'error',
          title: 'ยังโหลดข้อมูลไม่ได้',
          text: retryErr?.message || 'กรุณาลองใหม่อีกครั้งภายหลัง',
          confirmButtonText: 'ตกลง',
          returnFocus: false
        });
      }
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function logout() {
    try { await Api.logout(); } catch (_) { /* local logout still continues */ }
    Api.setSession(null);
    if (currentPdfUrl) { URL.revokeObjectURL(currentPdfUrl); currentPdfUrl = null; }
    if (currentDocxUrl) { URL.revokeObjectURL(currentDocxUrl); currentDocxUrl = null; }
    $('username').value = '';
    $('password').value = '';
    $('tableBody').replaceChildren();
    $('adminTableBody').replaceChildren();
    actingAgency = '';
    adminAgencies = [];
    showLogin();
  }

  function confirmLogout() {
    Swal.fire({
      title: 'ยืนยันการออกจากระบบ', text: 'คุณต้องการออกจากระบบใช่หรือไม่', icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#EF4444', cancelButtonColor: '#6B7280',
      confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก'
    }).then(r => { if (r.isConfirmed) logout(); });
  }

  async function loadData(rethrow = false) {
    const requestedAgency = currentUser.role === 'admin' ? actingAgency : null;
    if (currentUser.role === 'admin' && !requestedAgency) {
      clearAgencyWorkTable('กรุณาเลือกหน่วยงานด้านบนก่อนทำรายการ');
      return;
    }

    setLoading(true);
    try {
      const res = await Api.getMemoData(requestedAgency, selectedMemoMonth, true);
      const facultyOrder = [
        'วิทยาศาสตร์','เกษตรศาสตร์','วิศวกรรมศาสตร์','ศิลปศาสตร์','เภสัชศาสตร์','บริหารศาสตร์',
        'พยาบาลศาสตร์','วิทยาลัยแพทยศาสตร์และการสาธารณสุข','ศิลปประยุกต์และสถาปัตยกรรมศาสตร์',
        'นิติศาสตร์','รัฐศาสตร์','ศึกษาศาสตร์'
      ];
      const items = Array.isArray(res.items) ? res.items : [];
      items.sort((a,b) => {
        const fa = String(a.faculty || currentUser.faculty || '').replace(/^คณะ/, '').trim();
        const fb = String(b.faculty || currentUser.faculty || '').replace(/^คณะ/, '').trim();
        let ia = facultyOrder.indexOf(fa); let ib = facultyOrder.indexOf(fb);
        if (ia < 0) ia = 999; if (ib < 0) ib = 999;
        return ia !== ib ? ia - ib : String(a.studentId).localeCompare(String(b.studentId));
      });
      res.items = items;
      globalData = res;
      populateMemoMonthOptions(res.availableMonths, res.selectedMonth || selectedMemoMonth);
      if ($('selectAll')) $('selectAll').checked = false;
      if (currentUser.role === 'admin') updateAgencyDisplay(res.agency || requestedAgency);

      if (!selectedMemoMonth) {
        const hasMonths = Array.isArray(res.availableMonths) && res.availableMonths.length > 0;
        const monthMessage = res.monthColumnFound === false
          ? 'ไม่พบคอลัมน์ WorkDate ในชีต Payroll ระบบกำหนดเดือนจากวันที่ทำงานใน WorkDate เท่านั้น'
          : (hasMonths
            ? 'กรุณาเลือกประจำเดือนด้านบน ระบบจะแสดงเฉพาะรายการที่อนุมัติแล้วของเดือนนั้น'
            : 'ไม่พบเดือนที่มีรายการสถานะอนุมัติรอกองคลังโอนเงินของหน่วยงานนี้');
        renderTable([], monthMessage);
      } else {
        renderTable(items, `ไม่พบรายการรอเบิกจ่ายในเดือน ${selectedMemoMonth}`);
      }
      updateBudget(0);
      updateAgencyKpis();
    } catch (err) {
      if (rethrow) throw err;
      await Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: err?.message || 'กรุณาลองใหม่อีกครั้ง' });
    } finally { setLoading(false); }
  }

  function td(text, style = '') {
    const el = document.createElement('td');
    el.textContent = text == null ? '' : String(text);
    if (style) el.setAttribute('style', style);
    return el;
  }

  function renderTable(items, emptyMessage = '') {
    const tbody = $('tableBody');
    tbody.replaceChildren();
    if (!items.length) {
      const noData = $('noDataMsg');
      const message = emptyMessage || (currentUser.role === 'admin'
        ? 'ไม่พบรายการรอเบิกจ่ายของหน่วยงานที่เลือก'
        : 'ขณะนี้ไม่พบรายการรอเบิกจ่าย หากท่านยังไม่ได้เข้าระบบจ้างงานระหว่างเรียนเพื่ออนุมัติรายการ กรุณาดำเนินการอนุมัติก่อน จึงจะสามารถสร้างบันทึกข้อความได้');
      noData.innerHTML = `<i class="material-icons-round" style="font-size:48px; margin-bottom:10px;">inbox</i><br>${escapeHtml(message)}`;
      noData.style.display = 'block';
      return;
    }
    $('noDataMsg').style.display = 'none';

    items.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.dataset.search = [item.studentId, item.studentName, item.jobTitle, item.faculty, item.month].join(' ');
      const checkCell = document.createElement('td');
      checkCell.style.textAlign = 'center';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'chk-item'; check.value = String(index);
      check.addEventListener('change', calcTotal);
      checkCell.appendChild(check);
      tr.append(
        checkCell,
        td(item.studentId),
        td(item.studentName),
        td(item.jobTitle),
        td(item.faculty || '-'),
        td(Number(item.amount || 0).toLocaleString(), 'text-align:right;font-weight:700;')
      );
      tbody.appendChild(tr);
    });
    filterMemoRows();
    updateAgencyKpis();
  }

  function toggleAll() {
    const checked = Boolean($('selectAll')?.checked);
    document.querySelectorAll('.chk-item').forEach(c => {
      const row = c.closest('tr');
      if (row && row.style.display !== 'none') c.checked = checked;
    });
    calcTotal();
  }
  function calcTotal() {
    let total = 0;
    document.querySelectorAll('.chk-item:checked').forEach(c => total += Number(globalData.items?.[Number(c.value)]?.amount || 0));
    updateBudget(total);
    updateAgencyKpis();
  }
  function updateBudget(requestAmt) {
    const stats = globalData.stats || { allocated:0, usedPrevious:0 };
    const alloc = Number(stats.allocated || 0), prevUsed = Number(stats.usedPrevious || 0);
    const prevBal = alloc - prevUsed, newBal = prevBal - requestAmt;
    $('dispAlloc').innerText = alloc.toLocaleString();
    $('dispPrev').innerText = prevBal.toLocaleString();
    $('dispRequest').innerText = requestAmt.toLocaleString();
    $('dispBalance').innerText = newBal.toLocaleString();
    $('dispBalance').style.color = newBal < 0 ? '#EF4444' : '#10B981';
  }

  async function printMemo() {
    if (currentUser.role === 'admin' && !actingAgency) {
      return Swal.fire('แจ้งเตือน', 'กรุณาเลือกหน่วยงานที่ต้องการทำรายการแทนก่อน', 'warning');
    }
    if (!selectedMemoMonth) {
      return Swal.fire('แจ้งเตือน', 'กรุณาเลือกประจำเดือนที่ต้องการออกบันทึกข้อความก่อน', 'warning');
    }
    const selected = [...document.querySelectorAll('.chk-item:checked')];
    if (!selected.length) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'warning');

    const requiredFields = [
      ['memoTo', 'กรุณาระบุผู้รับหนังสือ'],
      ['memoSigner', 'กรุณาระบุชื่อผู้ลงนาม'],
      ['memoPosition', 'กรุณาระบุตำแหน่งผู้ลงนาม'],
      ['memoPhone', 'กรุณาระบุเบอร์โทรภายใน']
    ];
    for (const [id, message] of requiredFields) {
      if (!String($(id)?.value || '').trim()) {
        $(id)?.focus();
        return Swal.fire('ข้อมูลยังไม่ครบ', message, 'warning');
      }
    }

    const selectedTotal = selected.reduce((sum, chk) => sum + Number(globalData.items?.[Number(chk.value)]?.amount || 0), 0);
    const preview = await Swal.fire({
      icon: 'question',
      title: 'ตรวจสอบก่อนสร้างเอกสาร',
      html: `<div style="text-align:left;line-height:1.8"><b>หน่วยงาน:</b> ${escapeHtml(currentUser.role === 'admin' ? actingAgency : (globalData.agency || currentUser.faculty || '-'))}<br><b>ประจำเดือน:</b> ${escapeHtml(selectedMemoMonth)}<br><b>จำนวน:</b> ${selected.length.toLocaleString()} ราย<br><b>ยอดรวม:</b> ${selectedTotal.toLocaleString()} บาท</div>`,
      showCancelButton: true,
      confirmButtonText: 'ยืนยันสร้างเอกสาร',
      cancelButtonText: 'กลับไปตรวจสอบ',
      confirmButtonColor: '#0F52BA'
    });
    if (!preview.isConfirmed) return;

    const studentIds = selected.map(chk => String(globalData.items[Number(chk.value)].studentId));
    const payload = {
      agency: currentUser.role === 'admin' ? actingAgency : null,
      month: selectedMemoMonth,
      studentIds,
      form: {
        refNo: $('memoRef').value, date: $('memoDate').value, monthYear: selectedMemoMonth,
        subject: $('memoSubject').value, to: $('memoTo').value, phone: $('memoPhone').value,
        signerName: $('memoSigner').value, signerPosition: $('memoPosition').value
      }
    };
    setLoading(true);
    try {
      const res = await Api.generateMemo(payload);
      showDocumentPreview(res.pdfBase64, res.docxBase64, res.exportErrors);
    }
    catch (err) { Swal.fire('Error', err.message, 'error'); }
    finally { setLoading(false); }
  }

  function populateAgencyDropdown(res) {
    adminAgencies = Array.isArray(res?.data) ? res.data.slice() : [];
    populateAgencyDropdowns(adminAgencies);
  }

  function clearAdminTable(message) {
    const tbody = $('adminTableBody');
    if (!tbody) return;
    tbody.replaceChildren();
    const tr = document.createElement('tr');
    const cell = td(message || 'ไม่พบรายการ');
    cell.colSpan = 6;
    cell.style.textAlign = 'center';
    cell.style.color = '#9CA3AF';
    tr.appendChild(cell);
    tbody.appendChild(tr);
    if ($('adminSelectAll')) $('adminSelectAll').checked = false;
    resetSearchField('adminSearchInput');
    updateAdminBudget(0, 0);
    updateAdminKpis();
  }

  function resetAdminMonthSelection() {
    selectedAdminMonth = '';
    const select = $('adminMonthSelect');
    if (select) {
      select.replaceChildren(new Option('-- เลือกเดือนที่มีรายการอนุมัติแล้ว --', ''));
      select.value = '';
      select.disabled = true;
    }
    const monthInput = $('adminMonth');
    if (monthInput) monthInput.value = '';
    updateAdminKpis();
  }

  function populateAdminMonthOptions(months, activeMonth = '') {
    const select = $('adminMonthSelect');
    if (!select) return;

    const list = Array.isArray(months)
      ? months.map(x => String(x || '').trim()).filter(Boolean)
      : [];

    select.replaceChildren(new Option('-- เลือกเดือนที่มีรายการอนุมัติแล้ว --', ''));
    list.forEach(month => select.add(new Option(month, month)));
    select.disabled = list.length === 0;

    const requested = String(activeMonth || '').trim();
    selectedAdminMonth = requested && list.includes(requested) ? requested : '';
    select.value = selectedAdminMonth;

    const monthInput = $('adminMonth');
    if (monthInput) monthInput.value = selectedAdminMonth;
    updateAdminKpis();
  }

  async function handleAdminAgencyChange() {
    resetAdminMonthSelection();
    await loadAdminData();
  }

  async function handleAdminMonthChange() {
    const select = $('adminMonthSelect');
    selectedAdminMonth = select ? String(select.value || '').trim() : '';
    const monthInput = $('adminMonth');
    if (monthInput) monthInput.value = selectedAdminMonth;
    resetSearchField('adminSearchInput');

    if (!selectedAdminMonth) {
      globalData = { ...globalData, items: [] };
      clearAdminTable('กรุณาเลือกประจำเดือนที่ต้องการออกเอกสารส่วนกลาง');
      return;
    }

    await loadAdminData();
  }

  async function loadAdminData() {
    const agency = $('adminAgencySelect').value;
    if (!agency) {
      resetAdminMonthSelection();
      clearAdminTable('กรุณาเลือกหน่วยงานด้านบน');
      return;
    }

    setLoading(true);
    try {
      const res = await Api.getMemoData(agency, selectedAdminMonth, true);
      globalData = res;
      populateAdminMonthOptions(res.availableMonths, res.selectedMonth || selectedAdminMonth);
      if ($('adminSelectAll')) $('adminSelectAll').checked = false;

      if (!selectedAdminMonth) {
        const hasMonths = Array.isArray(res.availableMonths) && res.availableMonths.length > 0;
        const message = res.workDateColumnFound === false
          ? 'ไม่พบคอลัมน์ WorkDate ในชีต Payroll'
          : (hasMonths
            ? 'กรุณาเลือกประจำเดือนด้านบน ระบบจะแสดงเฉพาะรายการอนุมัติของเดือนนั้น'
            : 'ไม่พบเดือนที่มีรายการสถานะอนุมัติรอกองคลังโอนเงินของหน่วยงานนี้');
        clearAdminTable(message);
      } else {
        renderAdminTable(Array.isArray(res.items) ? res.items : [], `ไม่พบรายการเบิกจ่ายในเดือน ${selectedAdminMonth}`);
        updateAdminBudget(0, 0);
      }
      updateAdminKpis();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function renderAdminTable(items, emptyMessage = '') {
    const tbody = $('adminTableBody'); tbody.replaceChildren();
    if (!items.length) {
      const tr = document.createElement('tr'); const cell = td(emptyMessage || 'ไม่พบรายการเบิกจ่ายของหน่วยงานนี้');
      cell.colSpan=6; cell.className='table-empty-cell'; tr.appendChild(cell); tbody.appendChild(tr); updateAdminKpis(); return;
    }
    items.forEach((item,index) => {
      const tr=document.createElement('tr');
      tr.dataset.search=[item.studentId,item.studentName,item.jobTitle,item.faculty,item.month].join(' ');
      const cc=document.createElement('td'); cc.style.textAlign='center';
      const check=document.createElement('input'); check.type='checkbox'; check.className='chk-admin-item'; check.value=String(index); check.addEventListener('change', calcAdminTotal); cc.appendChild(check);
      tr.append(
        cc,
        td(item.studentId),
        td(item.studentName),
        td(item.jobTitle || '-'),
        td(item.faculty || '-'),
        td(Number(item.amount||0).toLocaleString(),'text-align:right;font-weight:700;')
      );
      tbody.appendChild(tr);
    });
    filterAdminRows();
    updateAdminKpis();
  }
  function toggleAllAdmin(){
    const checked=Boolean($('adminSelectAll')?.checked);
    document.querySelectorAll('.chk-admin-item').forEach(c=>{const row=c.closest('tr');if(row&&row.style.display!=='none')c.checked=checked;});
    calcAdminTotal();
  }
  function calcAdminTotal(){
    let total=0,count=0;
    document.querySelectorAll('.chk-admin-item:checked').forEach(c=>{total+=Number(globalData.items?.[Number(c.value)]?.amount||0);count++;});
    updateAdminBudget(total,count);
    updateAdminKpis();
  }
  function updateAdminBudget(total,count){
    if ($('adminDispRequest')) $('adminDispRequest').innerText=Number(total||0).toLocaleString()+' บาท';
    if ($('adminDispCount')) $('adminDispCount').innerText=`จำนวน ${Number(count||0).toLocaleString()} ราย`;
  }

  async function printAdminMemo() {
    const agency = $('adminAgencySelect').value;
    if (!agency) return Swal.fire('แจ้งเตือน','กรุณาเลือกหน่วยงานก่อน','warning');
    if (!selectedAdminMonth) return Swal.fire('แจ้งเตือน','กรุณาเลือกประจำเดือนที่ต้องการออกเอกสารส่วนกลางก่อน','warning');
    const selected=[...document.querySelectorAll('.chk-admin-item:checked')];
    if (!selected.length) return Swal.fire('แจ้งเตือน','กรุณาเลือกรายชื่อนักศึกษาอย่างน้อย 1 รายการ','warning');
    const selectedTotal=selected.reduce((sum,chk)=>sum+Number(globalData.items?.[Number(chk.value)]?.amount||0),0);
    const preview=await Swal.fire({
      icon:'question',
      title:'ตรวจสอบเอกสารส่วนกลาง',
      html:`<div style="text-align:left;line-height:1.8"><b>หน่วยงาน:</b> ${escapeHtml(agency)}<br><b>ประจำเดือน:</b> ${escapeHtml(selectedAdminMonth)}<br><b>จำนวน:</b> ${selected.length.toLocaleString()} ราย<br><b>ยอดรวม:</b> ${selectedTotal.toLocaleString()} บาท</div>`,
      showCancelButton:true,
      confirmButtonText:'ยืนยันสร้างเอกสาร',
      cancelButtonText:'กลับไปตรวจสอบ',
      confirmButtonColor:'#0F52BA'
    });
    if(!preview.isConfirmed) return;
    const studentIds=selected.map(chk=>String(globalData.items[Number(chk.value)].studentId));
    const payload={
      agency, month: selectedAdminMonth, studentIds,
      form:{ refNo:$('adminRef').value, date:$('adminDate').value, monthYear:selectedAdminMonth,
        refOldNo:$('adminRefOldNo').value, refOldDate:$('adminRefOldDate').value, budgetYear:$('adminBudgetYear').value }
    };
    setLoading(true);
    try {
      const res = await Api.generateAdminMemo(payload);
      showDocumentPreview(res.pdfBase64, res.docxBase64, res.exportErrors);
    }
    catch(err){ Swal.fire('Error',err.message,'error'); }
    finally{ setLoading(false); }
  }

  function base64ToBlob(base64, mime = 'application/pdf') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function revokeDocumentUrls() {
    if (currentPdfUrl) {
      URL.revokeObjectURL(currentPdfUrl);
      currentPdfUrl = null;
    }
    if (currentDocxUrl) {
      URL.revokeObjectURL(currentDocxUrl);
      currentDocxUrl = null;
    }
  }

  function showDocumentPreview(pdfBase64, docxBase64, exportErrors = []) {
    revokeDocumentUrls();

    if (!pdfBase64 && !docxBase64) {
      const details = Array.isArray(exportErrors) && exportErrors.length
        ? exportErrors.map(x => `${x.format}: ${x.message}`).join('\n')
        : 'ระบบไม่ได้รับไฟล์เอกสารจากเซิร์ฟเวอร์';
      return Swal.fire('Error', details, 'error');
    }

    const wrapper = document.createElement('div');
    wrapper.style.padding = '10px';

    const info = document.createElement('div');
    info.style.cssText = 'background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:15px;margin-bottom:16px;text-align:left;line-height:1.6;';
    if (pdfBase64 && docxBase64) {
      info.textContent = 'ระบบสร้างเอกสารสำเร็จ สามารถดาวน์โหลดได้ทั้ง Microsoft Word (.docx) และ PDF (.pdf)';
    } else if (pdfBase64) {
      info.textContent = 'ระบบสร้าง PDF สำเร็จ แต่ Word ยังส่งออกไม่สำเร็จ กรุณาดูรายละเอียดด้านล่าง';
    } else {
      info.textContent = 'ระบบสร้าง Word สำเร็จ แต่ PDF ยังส่งออกไม่สำเร็จ กรุณาดูรายละเอียดด้านล่าง';
    }
    wrapper.appendChild(info);

    if (Array.isArray(exportErrors) && exportErrors.length) {
      const warning = document.createElement('div');
      warning.style.cssText = 'background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;border-radius:8px;padding:12px 14px;margin-bottom:16px;text-align:left;font-size:13px;line-height:1.55;white-space:pre-wrap;';
      warning.textContent = exportErrors.map(x => `${x.format}: ${x.message}`).join('\n');
      wrapper.appendChild(warning);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;gap:10px;';

    if (docxBase64) {
      currentDocxUrl = URL.createObjectURL(base64ToBlob(
        docxBase64,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ));

      const wordLink = document.createElement('a');
      wordLink.href = currentDocxUrl;
      wordLink.download = 'บันทึกข้อความเบิกจ่ายจ้างงานระหว่างเรียน.docx';
      wordLink.rel = 'noopener';
      wordLink.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:100%;background:#185ABD;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;';
      wordLink.textContent = 'ดาวน์โหลดเอกสาร Word (.docx)';
      actions.appendChild(wordLink);
    }

    if (pdfBase64) {
      currentPdfUrl = URL.createObjectURL(base64ToBlob(pdfBase64, 'application/pdf'));

      const pdfLink = document.createElement('a');
      pdfLink.href = currentPdfUrl;
      pdfLink.download = 'บันทึกข้อความเบิกจ่ายจ้างงานระหว่างเรียน.pdf';
      pdfLink.target = '_blank';
      pdfLink.rel = 'noopener';
      pdfLink.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:100%;background:#DC2626;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;';
      pdfLink.textContent = 'เปิด / ดาวน์โหลดเอกสาร PDF (.pdf)';
      actions.appendChild(pdfLink);
    }

    wrapper.appendChild(actions);

    Swal.fire({
      icon: (pdfBase64 && docxBase64) ? 'success' : 'warning',
      title: 'โปรแกรมสร้างเอกสารเสร็จแล้ว',
      html: wrapper,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'ปิดหน้าต่าง',
      didClose: () => revokeDocumentUrls()
    });
  }

  function formatFacultyName(name){ return !name ? 'กำลังโหลด' : String(name).replace('วิทยาลัยแพทยศาสตร์และการสาธารณสุข','วิทยาลัยแพทยศาสตร์ฯ'); }
  function updateAgencyDisplay(name){ const el=$('displayAgency'); const shortName=formatFacultyName(name); el.textContent=shortName; if(shortName.includes('แพทยศาสตร์ฯ')||shortName.length>20) el.style.fontSize='12px'; else el.style.fontSize=''; }
  function setLoading(on){ $('loadingOverlay').style.display=on?'flex':'none'; }
})();
