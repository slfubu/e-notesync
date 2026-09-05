(() => {
  'use strict';

  let globalData = {};
  let currentUser = {};
  let currentPdfUrl = null;
  let actingAgency = '';
  let adminAgencies = [];

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
    $('adminAgencySelect')?.addEventListener('change', loadAdminData);
    $('adminSelectAll')?.addEventListener('change', toggleAllAdmin);
    $('modeAgencyBtn')?.addEventListener('click', enterAgencyImpersonationMode);
    $('modeAdminBtn')?.addEventListener('click', enterAdminReportMode);
    $('backToAdminMode')?.addEventListener('click', showAdminModeChooser);
    $('backToAdminModeFromAdmin')?.addEventListener('click', showAdminModeChooser);
    $('impersonateAgencySelect')?.addEventListener('change', handleImpersonatedAgencyChange);

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
  }

  async function handleImpersonatedAgencyChange() {
    const select = $('impersonateAgencySelect');
    actingAgency = select ? String(select.value || '') : '';
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
    const tbody = $('tableBody');
    if (tbody) tbody.replaceChildren();
    if ($('noDataMsg')) {
      $('noDataMsg').style.display = 'block';
      $('noDataMsg').innerHTML = `<i class="material-icons-round" style="font-size:48px; margin-bottom:10px;">domain</i><br>${escapeHtml(message)}`;
    }
    if ($('selectAll')) $('selectAll').checked = false;
    updateBudget(0);
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
      const res = await Api.getMemoData(requestedAgency);
      const facultyOrder = [
        'วิทยาศาสตร์','เกษตรศาสตร์','วิศวกรรมศาสตร์','ศิลปศาสตร์','เภสัชศาสตร์','บริหารศาสตร์',
        'พยาบาลศาสตร์','วิทยาลัยแพทยศาสตร์และการสาธารณสุข','ศิลปประยุกต์และสถาปัตยกรรมศาสตร์',
        'นิติศาสตร์','รัฐศาสตร์','ศึกษาศาสตร์'
      ];
      res.items.sort((a,b) => {
        const fa = String(a.faculty || currentUser.faculty || '').replace(/^คณะ/, '').trim();
        const fb = String(b.faculty || currentUser.faculty || '').replace(/^คณะ/, '').trim();
        let ia = facultyOrder.indexOf(fa); let ib = facultyOrder.indexOf(fb);
        if (ia < 0) ia = 999; if (ib < 0) ib = 999;
        return ia !== ib ? ia - ib : String(a.studentId).localeCompare(String(b.studentId));
      });
      globalData = res;
      if ($('selectAll')) $('selectAll').checked = false;
      if (currentUser.role === 'admin') updateAgencyDisplay(res.agency || requestedAgency);
      renderTable(res.items);
      updateBudget(0);
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

  function renderTable(items) {
    const tbody = $('tableBody');
    tbody.replaceChildren();
    if (!items.length) {
      const noData = $('noDataMsg');
      const message = currentUser.role === 'admin'
        ? 'ไม่พบรายการรอเบิกจ่ายของหน่วยงานที่เลือก'
        : 'ขณะนี้ไม่พบรายการรอเบิกจ่าย หากท่านยังไม่ได้เข้าระบบจ้างงานระหว่างเรียนเพื่ออนุมัติรายการ กรุณาดำเนินการอนุมัติก่อน จึงจะสามารถสร้างบันทึกข้อความได้';
      noData.innerHTML = `<i class="material-icons-round" style="font-size:48px; margin-bottom:10px;">inbox</i><br>${escapeHtml(message)}`;
      noData.style.display = 'block';
      return;
    }
    $('noDataMsg').style.display = 'none';

    items.forEach((item, index) => {
      const tr = document.createElement('tr');
      const checkCell = document.createElement('td');
      checkCell.style.textAlign = 'center';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.className = 'chk-item'; check.value = String(index);
      check.addEventListener('change', calcTotal);
      checkCell.appendChild(check);
      tr.append(checkCell, td(item.studentId), td(item.studentName), td(item.jobTitle), td(Number(item.amount || 0).toLocaleString(), 'text-align:right;font-weight:600;'));
      tbody.appendChild(tr);
    });
  }

  function toggleAll() {
    document.querySelectorAll('.chk-item').forEach(c => c.checked = $('selectAll').checked);
    calcTotal();
  }
  function calcTotal() {
    let total = 0;
    document.querySelectorAll('.chk-item:checked').forEach(c => total += Number(globalData.items[Number(c.value)].amount || 0));
    updateBudget(total);
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
    const selected = [...document.querySelectorAll('.chk-item:checked')];
    if (!selected.length) return Swal.fire('แจ้งเตือน', 'กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'warning');
    const studentIds = selected.map(chk => String(globalData.items[Number(chk.value)].studentId));
    const payload = {
      agency: currentUser.role === 'admin' ? actingAgency : null,
      studentIds,
      form: {
        refNo: $('memoRef').value, date: $('memoDate').value, monthYear: $('memoMonth').value,
        subject: $('memoSubject').value, to: $('memoTo').value, phone: $('memoPhone').value,
        signerName: $('memoSigner').value, signerPosition: $('memoPosition').value
      }
    };
    setLoading(true);
    try { const res = await Api.generateMemo(payload); showPdfPreview(res.pdfBase64); }
    catch (err) { Swal.fire('Error', err.message, 'error'); }
    finally { setLoading(false); }
  }

  function populateAgencyDropdown(res) {
    adminAgencies = Array.isArray(res?.data) ? res.data.slice() : [];
    populateAgencyDropdowns(adminAgencies);
  }

  async function loadAdminData() {
    const agency = $('adminAgencySelect').value;
    if (!agency) {
      $('adminTableBody').replaceChildren();
      const tr = document.createElement('tr'); const cell = td('กรุณาเลือกหน่วยงานด้านบน');
      cell.colSpan = 4; cell.style.textAlign = 'center'; cell.style.color = '#9CA3AF'; tr.appendChild(cell); $('adminTableBody').appendChild(tr); return;
    }
    setLoading(true);
    try {
      const res = await Api.getMemoData(agency);
      globalData = res;
      if ($('adminSelectAll')) $('adminSelectAll').checked = false;
      renderAdminTable(res.items); updateAdminBudget(0,0);
    } catch (err) { Swal.fire('Error', err.message, 'error'); }
    finally { setLoading(false); }
  }

  function renderAdminTable(items) {
    const tbody = $('adminTableBody'); tbody.replaceChildren();
    if (!items.length) {
      const tr = document.createElement('tr'); const cell = td('ไม่พบรายการเบิกจ่ายของหน่วยงานนี้');
      cell.colSpan=4; cell.style.textAlign='center'; cell.style.color='#9CA3AF'; tr.appendChild(cell); tbody.appendChild(tr); return;
    }
    items.forEach((item,index) => {
      const tr=document.createElement('tr'); const cc=document.createElement('td'); cc.style.textAlign='center';
      const check=document.createElement('input'); check.type='checkbox'; check.className='chk-admin-item'; check.value=String(index); check.addEventListener('change', calcAdminTotal); cc.appendChild(check);
      tr.append(cc,td(item.studentId),td(item.studentName),td(Number(item.amount||0).toLocaleString(),'text-align:right;font-weight:600;')); tbody.appendChild(tr);
    });
  }
  function toggleAllAdmin(){ document.querySelectorAll('.chk-admin-item').forEach(c=>c.checked=$('adminSelectAll').checked); calcAdminTotal(); }
  function calcAdminTotal(){ let total=0,count=0; document.querySelectorAll('.chk-admin-item:checked').forEach(c=>{total+=Number(globalData.items[Number(c.value)].amount||0);count++;}); updateAdminBudget(total,count); }
  function updateAdminBudget(total,count){ $('adminDispRequest').innerText=total.toLocaleString()+' บาท'; $('adminDispCount').innerText=`จำนวน ${count} ราย`; }

  async function printAdminMemo() {
    const agency = $('adminAgencySelect').value;
    if (!agency) return Swal.fire('แจ้งเตือน','กรุณาเลือกหน่วยงานก่อน','warning');
    const selected=[...document.querySelectorAll('.chk-admin-item:checked')];
    if (!selected.length) return Swal.fire('แจ้งเตือน','กรุณาเลือกรายชื่อนักศึกษาอย่างน้อย 1 รายการ','warning');
    const studentIds=selected.map(chk=>String(globalData.items[Number(chk.value)].studentId));
    const payload={
      agency, studentIds,
      form:{ refNo:$('adminRef').value, date:$('adminDate').value, monthYear:$('adminMonth').value,
        refOldNo:$('adminRefOldNo').value, refOldDate:$('adminRefOldDate').value, budgetYear:$('adminBudgetYear').value }
    };
    setLoading(true);
    try { const res=await Api.generateAdminMemo(payload); showPdfPreview(res.pdfBase64); }
    catch(err){ Swal.fire('Error',err.message,'error'); }
    finally{ setLoading(false); }
  }

  function base64ToBlob(base64, mime='application/pdf') {
    const binary=atob(base64); const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:mime});
  }
  function showPdfPreview(base64) {
    if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl=URL.createObjectURL(base64ToBlob(base64));
    const wrapper=document.createElement('div'); wrapper.style.padding='10px';
    const info=document.createElement('div'); info.style.cssText='background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:15px;margin-bottom:20px;text-align:left;';
    info.textContent='ระบบสร้างเอกสารสำเร็จ สามารถเปิดหรือดาวน์โหลดไฟล์ PDF ได้จากปุ่มด้านล่าง';
    const a=document.createElement('a'); a.href=currentPdfUrl; a.download='บันทึกข้อความเบิกจ่ายจ้างงานระหว่างเรียน.pdf'; a.target='_blank'; a.rel='noopener';
    a.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:100%;background:#0F52BA;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;'; a.textContent='เปิด / ดาวน์โหลดเอกสาร PDF';
    wrapper.append(info,a);
    Swal.fire({icon:'success',title:'โปรแกรมสร้างเอกสารสำเร็จ',html:wrapper,showConfirmButton:false,showCancelButton:true,cancelButtonText:'ปิดหน้าต่าง'});
  }

  function formatFacultyName(name){ return !name ? 'กำลังโหลด' : String(name).replace('วิทยาลัยแพทยศาสตร์และการสาธารณสุข','วิทยาลัยแพทยศาสตร์ฯ'); }
  function updateAgencyDisplay(name){ const el=$('displayAgency'); const shortName=formatFacultyName(name); el.textContent=shortName; if(shortName.includes('แพทยศาสตร์ฯ')||shortName.length>20) el.style.fontSize='12px'; else el.style.fontSize=''; }
  function setLoading(on){ $('loadingOverlay').style.display=on?'flex':'none'; }
})();
