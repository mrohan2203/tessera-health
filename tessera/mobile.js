/* Tessera Health — phone layer.
   On narrow screens (phones and the iOS app) this adds a native-style app bar, a bottom tab bar,
   a "More" sheet for the rest of the menu, card-style tables and bottom-sheet dialogs.
   It works only on top of the rendered page (no view code changes), so the desktop app is untouched. */
(function () {
  const T = window.Tessera;
  const mq = window.matchMedia('(max-width: 860px)');
  const root = document.documentElement;
  const on = () => mq.matches;
  const sync = () => root.classList.toggle('m', on());
  sync();
  (mq.addEventListener ? mq.addEventListener('change', () => { sync(); if (T.me && T.me()) T.render(); }) : mq.addListener(sync));
  T.isMobile = on;

  /* ---- tab bar choices: the 3–4 pages each role opens most; the rest live under "More" ---- */
  const PRIMARY = {
    doctor: (u) => u.dept === 'EMER' ? ['home', 'er', 'patients', 'mywork'] : u.dept === 'SURG' ? ['home', 'ot', 'patients', 'mywork'] : ['home', 'patients', 'orders', 'mywork'],
    nurse: (u) => u.unit === 'PERIOP' ? ['home', 'ot', 'daycare', 'patients'] : ['home', 'patients', 'mar', 'mywork'],
    pharmacist: () => ['home', 'verify', 'inventory', 'mywork'],
    lab: () => ['home', 'lab', 'bloodbank', 'mywork'],
    pathologist: () => ['home', 'lab', 'bloodbank', 'mywork'],
    radiologist: () => ['home', 'radiology', 'mywork'],
    receptionist: () => ['home', 'registration', 'appointments', 'beds'],
    billing: () => ['home', 'accounts', 'estimates', 'mywork'],
    insurance: () => ['home', 'insurance', 'discharge', 'mywork'],
    quality: () => ['home', 'measures', 'gaps', 'incidents'],
    executive: () => ['home', 'forecast', 'twin', 'finance'],
    admin: () => ['home', 'users', 'audit', 'privacy'],
    platform: () => ['home'],
    patient: () => ['home', 'visits', 'myresults', 'mymeds']
  };
  const SHORT = { home: 'Home', patients: 'Patients', mywork: 'Tasks', orders: 'Orders', er: 'ER', ot: 'OT', mar: 'eMAR', daycare: 'Day care', verify: 'Verify', inventory: 'Stock',
    lab: 'Worklist', bloodbank: 'Blood', radiology: 'Worklist', registration: 'Register', appointments: 'Bookings', beds: 'Beds', accounts: 'Claims', estimates: 'Estimates',
    insurance: 'Pre-auth', discharge: 'Discharge', measures: 'HEDIS', gaps: 'Gaps', incidents: 'Incidents', forecast: 'Forecast', twin: 'Map', finance: 'Finance',
    users: 'Users', audit: 'Audit', privacy: 'Privacy', visits: 'Visits', myresults: 'Results', mymeds: 'Meds',
    live: 'Live', ambient: 'Ambient', casesheet: 'Case sheet', rx: 'Rx', schedule: 'Schedule', encounters: 'Encounters', tele: 'Telehealth', icu: 'ICU', assess: 'Risk', medrec: 'Med rec',
    handover: 'Handover', pathways: 'Pathways', results: 'Critical', docintel: 'Doc AI', consents: 'Consents', myconsents: 'Consents', sdoh: 'Social', report: 'Report', alerts: 'Alerts',
    credentials: 'Credentials', assets: 'Assets', shifts: 'Shifts', config: 'Settings', interop: 'FHIR', review: 'Review', analytics: 'Analytics', infection: 'Infection', research: 'Research',
    bills: 'Bills', vault: 'Vault', people: 'Family', access: 'Access log', engagement: 'Follow-up' };
  const P = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    home: P('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
    patients: P('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14c2 .7 3 2.8 3 6"/>'),
    mywork: P('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12 5 13.5 7.5 11M3.5 18 5 19.5 7.5 17"/>'),
    orders: P('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h5"/>'),
    er: P('<path d="M12 4v16M4 12h16"/><rect x="3" y="3" width="18" height="18" rx="4"/>'),
    ot: P('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
    mar: P('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="m9.4 8.4 5.2 7.2"/>'),
    verify: P('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    inventory: P('<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>'),
    lab: P('<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
    bloodbank: P('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
    radiology: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 7v10M9 9.5h6M8.5 12.5h7M9 15.5h6"/>'),
    registration: P('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c0-3.6 2.9-6.5 6.5-6.5 1.5 0 2.9.5 4 1.4M18 14v6M15 17h6"/>'),
    appointments: P('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h3"/>'),
    beds: P('<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>'),
    accounts: P('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>'),
    estimates: P('<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>'),
    insurance: P('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M12 9v6M9 12h6"/>'),
    discharge: P('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
    measures: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    gaps: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    incidents: P('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
    forecast: P('<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>'),
    twin: P('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    finance: P('<path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3S7.5 5.8 7.5 7.5 9.5 10.3 12 11s4.5 1.8 4.5 3.7-2 3.3-4.5 3.3-4.5-1.3-4.5-3"/>'),
    users: P('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'),
    audit: P('<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8.5 12h7M8.5 16h5"/>'),
    privacy: P('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    visits: P('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
    myresults: P('<path d="M3 12h4l2.5-6 5 12L17 12h4"/>'),
    mymeds: P('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="m9.4 8.4 5.2 7.2"/>'),
    daycare: P('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    live: P('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
    ambient: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    casesheet: P('<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h3"/>'),
    rx: P('<path d="M6 20V4h5a4 4 0 0 1 0 8H6M10 12l8 8M18 13l-5 6"/>'),
    schedule: P('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17M12 13v3l2 1"/>'),
    encounters: P('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
    tele: P('<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>'),
    icu: P('<path d="M3 12h3l2-4 3 8 2-4h8"/><rect x="2" y="4" width="20" height="16" rx="2"/>'),
    assess: P('<path d="M9 4h6v3H9z"/><path d="M7 5.5H5v15h14v-15h-2"/><path d="m8.5 14 2 2 4-4.5"/>'),
    medrec: P('<path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3"/>'),
    handover: P('<path d="M8 12h8M13 8l4 4-4 4"/><circle cx="4.5" cy="12" r="2"/><circle cx="19.5" cy="12" r="2"/>'),
    pathways: P('<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h6a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h6"/>'),
    results: P('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
    docintel: P('<path d="M6 3h9l3 3v15H6z"/><path d="m12 9 .9 2.1L15 12l-2.1.9L12 15l-.9-2.1L9 12l2.1-.9z"/>'),
    consents: P('<path d="M6 3h9l3 3v15H6z"/><path d="M8.5 17c1.5-2 2.5-2 3 0s1.5 2 3.5-1"/>'),
    myconsents: P('<path d="M6 3h9l3 3v15H6z"/><path d="M8.5 17c1.5-2 2.5-2 3 0s1.5 2 3.5-1"/>'),
    sdoh: P('<path d="M4 11 12 4l8 7v9H4z"/><path d="M12 17.5s-3-1.8-3-3.8a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 2-3 3.8-3 3.8z"/>'),
    report: P('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
    alerts: P('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M4 3 20 21"/>'),
    credentials: P('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4M15 10h3M15 13h3"/>'),
    assets: P('<path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.3 2.3-2.4-.6-.6-2.4z"/>'),
    shifts: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5h4"/>'),
    config: P('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    interop: P('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
    review: P('<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-5-5M8 10.5l2 2 3.5-3.5"/>'),
    analytics: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    infection: P('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    research: P('<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/>'),
    bills: P('<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>'),
    vault: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M15.5 12H17"/>'),
    people: P('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14c2 .7 3 2.8 3 6"/>'),
    access: P('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    search: P('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    bell: P('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    close: P('<path d="M6 6l12 12M18 6 6 18"/>')
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Where the back arrow goes: the last top-level page the user was on */
  let lastTop = 'home', lastKey = '';
  const LOGO = '<svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" fill="#4fbfc3"/><rect x="15" y="1" width="12" height="12" rx="2" fill="#2c8f94"/><rect x="1" y="15" width="12" height="12" rx="2" fill="#2c8f94"/><rect x="15" y="15" width="12" height="12" rx="2" fill="#e2ecee"/></svg>';

  /* ---- tables → cards: give every cell its column name so CSS can lay rows out as cards ---- */
  function labelTables(scope) {
    scope.querySelectorAll('table.t').forEach((t) => {
      if (t.dataset.mLabeled) return; t.dataset.mLabeled = '1';
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          if (td.colSpan > 1) { td.classList.add('m-span'); return; }
          if (heads[i]) td.setAttribute('data-label', heads[i]);
          if (!td.textContent.trim() && !td.querySelector('button,a,input,select,svg,img,canvas')) td.classList.add('m-empty');
        });
      });
    });
  }
  T.mLabelTables = labelTables;

  function chrome(u, route, args) {
    const shell = document.querySelector('#app .shell'); if (!shell) return;
    const navLinks = [...shell.querySelectorAll('.rail nav a')];
    const ids = navLinks.map((a) => a.getAttribute('href').slice(1));
    if (ids.includes(route)) lastTop = route;
    const want = (PRIMARY[u.role] ? PRIMARY[u.role](u) : []).filter((id) => ids.includes(id));
    const prim = (want.length ? want : ids.slice(0, 4)).slice(0, 4);
    const isTop = ids.includes(route);
    const title = (shell.querySelector('.topbar h1') || {}).textContent || '';
    const bell = shell.querySelector('.topbar [data-act="notif-toggle"]');
    const unread = bell ? (bell.querySelector('.nbadge') || {}).textContent || '' : '';
    const badge = (id) => { const a = navLinks.find((x) => x.getAttribute('href') === '#' + id); const c = a && a.querySelector('.count'); return c ? `<span class="m-badge ${c.classList.contains('crit') ? 'crit' : ''}">${esc(c.textContent)}</span>` : ''; };
    const moreActive = !prim.includes(route) && route !== 'patient' ? ' aria-current="page"' : '';
    const whoName = (shell.querySelector('.rail .who b') || {}).textContent || '';
    const whoTitle = ((shell.querySelector('.rail .who span:not(.usertile):not(.lockline)') || {}).textContent || '');
    const tile = shell.querySelector('.rail .usertile');
    const chip = shell.querySelector('.topbar .rolechip');
    const lock = (shell.querySelector('.rail .lockline') || {}).textContent || '';

    const bar = document.createElement('header');
    bar.className = 'm-bar';
    bar.innerHTML = `${isTop ? `<span class="m-logo">${LOGO}</span>` : `<a class="m-icon m-back" href="#${lastTop}" aria-label="Back">${ICON.back}</a>`}
      <span class="m-title">${esc(title)}</span>
      <button class="m-icon" data-act="search-open" aria-label="Search">${ICON.search}</button>
      <span class="notif m-notif"><button class="m-icon" data-act="notif-toggle" aria-label="Notifications, ${unread || 0} unread">${ICON.bell}${unread ? `<span class="m-dot">${esc(unread)}</span>` : ''}</button></span>
      <button class="usertile m-avatar role-${u.role}" data-act="m-more" aria-label="Account and menu">${esc(tile ? tile.textContent : '')}</button>`;
    shell.querySelector('.main').prepend(bar);

    const tabs = document.createElement('nav');
    tabs.className = 'm-tabs'; tabs.setAttribute('aria-label', 'Quick navigation');
    tabs.innerHTML = prim.map((id) => `<a href="#${id}" ${route === id ? 'aria-current="page"' : ''}>${ICON[id] || ICON.home}${badge(id)}<span>${esc(SHORT[id] || id)}</span></a>`).join('')
      + `<button data-act="m-more"${moreActive}>${ICON.more}<span>More</span></button>`;
    shell.appendChild(tabs);

    const sheet = document.createElement('div');
    sheet.className = 'm-sheet-back'; sheet.hidden = true;
    const sections = [...shell.querySelectorAll('.rail nav > *')];
    let groups = '', open = false;
    sections.forEach((el) => {
      if (el.classList.contains('navsec')) { groups += (open ? '</div>' : '') + `<h4>${esc(el.textContent)}</h4><div class="m-group">`; open = true; }
      else { const id = el.getAttribute('href').slice(1); groups += `<a href="#${id}" ${route === id ? 'aria-current="page"' : ''}><span class="m-gi">${ICON[id] || ICON.more}</span><span class="m-gl">${el.querySelector('span').innerHTML}</span>${el.querySelector('.count') ? el.querySelector('.count').outerHTML : ''}<i aria-hidden="true">›</i></a>`; }
    });
    if (open) groups += '</div>';
    sheet.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="m-grab" aria-hidden="true"></div>
      <div class="m-me"><span class="usertile role-${u.role}">${esc(tile ? tile.textContent : '')}</span><div><b>${esc(whoName)}</b><small>${esc(whoTitle)}</small></div><button class="m-icon" data-act="m-close" aria-label="Close menu">${ICON.close}</button></div>
      ${chip ? `<div class="m-chip">${chip.outerHTML}<span class="muted">${esc(lock)}</span></div>` : ''}
      ${groups}
      <button class="btn m-signout" data-act="signout">Sign out</button>
    </div>`;
    document.getElementById('app').appendChild(sheet);

    // Large title collapses into the app bar as it scrolls away (iOS pattern)
    const big = shell.querySelector('.topbar h1');
    if (big && route !== 'home' && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => bar.classList.toggle('m-titled', !e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
      io.observe(big);
    }

    // New page → start at the top; re-renders of the same page keep their place
    // (switching tabs inside one chart keeps the place)
    const key = route + '-' + (args[0] || '');
    if (key !== lastKey) { if (lastKey) window.scrollTo(0, 0); lastKey = key; }
    shell.querySelectorAll('.tabs').forEach((t) => { const c = t.querySelector('[aria-current="page"]'); if (c) t.scrollLeft = c.offsetLeft - (t.clientWidth - c.offsetWidth) / 2; });
    labelTables(shell);
    if (route === 'home') homeLayer(u, shell, ids, prim, bar);
  }

  /* ---------- Home: hero day card, "needs you" stack, bento stats, quick actions ---------- */
  let clockT = null;
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  function greetName(u) {
    const n = u.name.replace(/,.*/, '');
    if (/^Dr\.?\s/.test(n)) return 'Dr. ' + n.split(/\s+/).pop();
    return n.split(/\s+/)[0];
  }
  function homeLayer(u, shell, ids, prim, bar) {
    shell.classList.add('m-home');
    const content = shell.querySelector('.content'); if (!content) return;
    const S = T.S; const now = T.nowMin ? T.nowMin() : new Date().getHours() * 60 + new Date().getMinutes();
    const part = now < 300 ? 'Working late' : now < 720 ? 'Good morning' : now < 1020 ? 'Good afternoon' : 'Good evening';
    const sub = (shell.querySelector('.topbar .crumbs small') || {}).textContent || '';

    // The tiles already on the page say what is urgent; turn them into one sentence
    const firstTiles = content.querySelector('.tiles');
    const urgent = [...(firstTiles ? firstTiles.querySelectorAll('.tile.crit, .tile.warn') : [])]
      .filter((t) => Number((t.querySelector('b') || {}).textContent) !== 0)
      .map((t) => `<b>${esc(t.querySelector('b').textContent)}</b> ${esc((t.querySelector('span') || {}).textContent || '').toLowerCase()}`);
    const pulse = urgent.length ? urgent.slice(0, 2).join(' · ') : 'Nothing urgent right now. Nice and steady.';

    // Shift arc: 07:00 → 19:00 (patients see their day instead)
    const s0 = 7 * 60, s1 = 19 * 60; const pct = Math.max(0, Math.min(1, (now - s0) / (s1 - s0)));
    const R = 44, cx = 52, cy = 52; const ang = Math.PI * (1 - pct);
    const sx = cx + R * Math.cos(ang), sy = cy - R * Math.sin(ang);
    const arc = `<svg class="m-arc" viewBox="0 0 104 62" aria-hidden="true"><path d="M8 52a44 44 0 0 1 88 0" class="a-bg"/><path d="M8 52a44 44 0 0 1 88 0" class="a-fg" pathLength="100" style="stroke-dasharray:${(pct * 100).toFixed(1)} 100"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5.5" class="a-sun"/></svg>`;

    const mosaic = Array.from({ length: 48 }, (_, i) => { const h = (i * 2654435761 >>> 0) % 97; const c = h < 40 ? 't1' : h < 62 ? 't2' : h < 78 ? 't3' : h < 92 ? 't4' : 'tc'; return `<i class="${c}" style="--d:${(h % 17) * 180}ms"></i>`; }).join('');
    const hero = document.createElement('section');
    hero.className = 'm-hero';
    hero.innerHTML = `<div class="m-mosaic" aria-hidden="true">${mosaic}</div>
      <div class="m-hero-top"><div class="m-hero-txt"><span class="m-hello">${part},</span><h1>${esc(greetName(u))}</h1><span class="m-sub">${esc(sub)}</span></div>
        <div class="m-arcbox">${arc}<span class="m-clock" data-m-clock>${hm(now)}</span><small>${u.role === 'patient' ? 'today' : `shift ${Math.round(pct * 100)}%`}</small></div></div>
      <p class="m-pulse"><span class="m-beat ${urgent.length ? 'hot' : ''}" aria-hidden="true"></span><span>${pulse}</span></p>`;
    content.prepend(hero);

    // "Needs you" — unread notifications as a swipeable card stack
    let cardsHtml = '';
    try {
      const list = T.notifs ? T.notifs(u) : []; const read = new Set((S.notifRead || {})[u.id] || []);
      const rank = { crit: 0, warn: 1, info: 2, ok: 3 };
      const items = list.filter((x) => !read.has(x.id)).sort((a, b) => (rank[a.level] ?? 4) - (rank[b.level] ?? 4)).slice(0, 8);
      if (items.length) cardsHtml = `<div class="m-sec"><h3>Needs you</h3><span>${items.length} unread · swipe</span></div><div class="m-needs">${items.map((x, i) => `<a class="m-need ${x.level}" href="${x.href}" data-act="notif-go" data-id="${esc(x.id)}" data-href="${x.href}" style="--i:${i}"><span class="m-need-k">${x.level === 'crit' ? 'Urgent' : x.level === 'warn' ? 'Soon' : x.level === 'ok' ? 'Done' : 'Update'}</span><span class="m-need-t">${esc(x.text)}</span><span class="m-need-go">Open ›</span></a>`).join('')}</div>`;
    } catch (e) { /* notifications are optional on home */ }

    // Quick actions: the rest of the role's menu as app-style shortcuts
    const links = [...shell.querySelectorAll('.rail nav a')];
    const quick = ids.filter((id) => id !== 'home' && !prim.includes(id)).slice(0, 8);
    const quickHtml = quick.length ? `<div class="m-sec"><h3>Shortcuts</h3></div><div class="m-quick">${quick.map((id) => { const a = links.find((x) => x.getAttribute('href') === '#' + id); const label = a ? a.querySelector('span').textContent : id; return `<a href="#${id}"><span class="m-qi">${ICON[id] || ICON.more}</span><span class="m-ql">${esc(SHORT[id] || label)}</span></a>`; }).join('')}</div>` : '';

    const mid = document.createElement('div'); mid.className = 'm-home-mid';
    mid.innerHTML = cardsHtml + quickHtml;
    hero.after(mid);
    const strip = mid.querySelector('.m-needs'); if (strip) requestAnimationFrame(() => { strip.scrollLeft = 0; });
    if (firstTiles) { firstTiles.classList.add('m-bento'); const h = document.createElement('div'); h.className = 'm-sec'; h.innerHTML = '<h3>At a glance</h3>'; firstTiles.before(h); }
    const rest = document.createElement('div'); rest.className = 'm-sec'; rest.innerHTML = '<h3>Your day in detail</h3>';
    const after = firstTiles ? firstTiles.nextElementSibling : mid.nextElementSibling; if (after) after.before(rest);

    // App bar title once the hero scrolls away
    const t = bar.querySelector('.m-title'); if (t) t.textContent = greetName(u);
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => bar.classList.toggle('m-titled', !e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' }).observe(hero.querySelector('h1'));

    clearInterval(clockT);
    clockT = setInterval(() => { const c = document.querySelector('[data-m-clock]'); if (!c) { clearInterval(clockT); return; } const d = new Date(); c.textContent = hm(d.getHours() * 60 + d.getMinutes()); }, 15000);
  }

  T.after.push((u, route, args) => { if (on()) chrome(u, route, args || []); });

  // Content painted after render (search lists, live panels) can add tables; label those too.
  // Also releases the menu's scroll lock whenever the open sheet is gone (sign-out, idle timeout,
  // any re-render), so the next screen, such as the entry page, can scroll.
  new MutationObserver(() => {
    if (!document.querySelector('.m-sheet-back:not([hidden])')) document.body.classList.remove('m-lock');
    if (on()) { const a = document.getElementById('app'); a && labelTables(a); }
  })
    .observe(document.getElementById('app'), { childList: true, subtree: true });

  const openSheet = () => { const s = document.querySelector('.m-sheet-back'); if (!s) return; s.hidden = false; requestAnimationFrame(() => s.classList.add('open')); document.body.classList.add('m-lock'); };
  const closeSheet = () => { const s = document.querySelector('.m-sheet-back'); if (!s) return; s.classList.remove('open'); document.body.classList.remove('m-lock'); setTimeout(() => { s.hidden = true; }, 220); };
  Object.assign(T.ACT, { 'm-more': openSheet, 'm-close': closeSheet });
  document.addEventListener('click', (e) => {
    const back = e.target.closest('.m-sheet-back');
    if (back && (e.target === back || e.target.closest('.m-sheet a'))) { if (e.target === back) closeSheet(); else document.body.classList.remove('m-lock'); }
  });
  window.addEventListener('hashchange', () => document.body.classList.remove('m-lock'));
})();
