// Panel de administración. Se usa dentro de la consola (apartado Admin) y en /admin.
// mountAdmin(contenedor, { onExit }) — todo el HTML se genera aquí.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountAdmin(root, { onExit } = {}) {
  let token = sessionStorage.getItem('gh.adminToken');
  let tab = 'sessions';
  let idle;

  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') { logout(); throw new Error('Sesión de administración vencida'); }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  };

  function logout() {
    token = null; sessionStorage.removeItem('gh.adminToken'); renderLogin();
  }
  function bumpIdle() {
    clearTimeout(idle);
    idle = setTimeout(() => { if (token) { logout(); onExit?.(); } }, 5 * 60_000);
  }
  root.addEventListener('keydown', bumpIdle);
  root.addEventListener('pointerdown', bumpIdle);

  function renderLogin(error = '') {
    root.innerHTML = `
      <div class="adm adm-login">
        <h1><span class="adm-lock">🔒</span> Administración</h1>
        <form class="adm-card" data-f="pass">
          <label>Usuario <input name="user" class="nav" value="admin" autocomplete="username"></label>
          <label>Contraseña <input name="pass" class="nav" type="password" autocomplete="current-password"></label>
          <button class="nav adm-primary">Entrar</button>
        </form>
        <form class="adm-card" data-f="code">
          <label>…o código de 6 dígitos generado en otro dispositivo
            <input name="code" class="nav" inputmode="numeric" maxlength="6" placeholder="123456"></label>
          <button class="nav">Entrar con código</button>
        </form>
        <p class="adm-error">${esc(error)}</p>
        ${onExit ? '<button class="nav adm-exit">Volver</button>' : ''}
      </div>`;
    root.querySelector('[data-f="pass"]').onsubmit = (e) => { e.preventDefault(); login({ user: e.target.user.value, pass: e.target.pass.value }); };
    root.querySelector('[data-f="code"]').onsubmit = (e) => { e.preventDefault(); login({ code: e.target.code.value.trim() }); };
    root.querySelector('.adm-exit')?.addEventListener('click', () => onExit());
    root.querySelector('input[name="pass"]').focus();
  }

  async function login(creds) {
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: creds });
      token = r.token; sessionStorage.setItem('gh.adminToken', token); bumpIdle(); render();
    } catch (e) { renderLogin(e.message); }
  }

  async function render(msg = '') {
    let st;
    try { st = await api('/api/admin/state'); } catch (e) { return renderLogin(e.message); }
    const tabs = [['sessions', 'Sesiones'], ['games', 'Juegos'], ['devices', 'Dispositivos'], ['settings', 'Ajustes']];
    let body = '';
    if (tab === 'sessions') {
      body = st.sessions.length ? `<table><tr><th>Código</th><th>Estado</th><th>Juego</th><th>Jugadores</th><th>Consola</th><th></th></tr>${st.sessions.map((s) => `
        <tr><td><b>${esc(s.code)}</b></td><td>${s.phase === 'playing' ? 'Jugando' : 'Lobby'}</td><td>${esc(s.gameId || '—')}</td>
        <td>${s.players.map((p) => `<span class="adm-dot" style="background:${esc(p.color)}"></span>${esc(p.name)}`).join(' ') || '—'}</td>
        <td>${s.consoleOnline ? 'En línea' : 'Desconectada'}</td>
        <td><button class="nav adm-danger" data-close="${esc(s.code)}">Cerrar</button></td></tr>`).join('')}</table>` : '<p>No hay sesiones activas.</p>';
    } else if (tab === 'games') {
      body = `<table><tr><th>Juego</th><th>Versión</th><th>Jugadores</th><th>Estado</th><th></th></tr>${st.games.map((g) => `
        <tr><td><b>${esc(g.name)}</b><br><small>${esc(g.id)}</small></td><td>${esc(g.version)}</td><td>${g.players.min}–${g.players.max}</td>
        <td>${g.enabled ? 'Activo' : 'Desactivado'}</td>
        <td><button class="nav" data-game="${esc(g.id)}" data-en="${g.enabled ? 0 : 1}">${g.enabled ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}</table>
        <p><button class="nav" data-act="rescan">Buscar juegos nuevos en la carpeta games/</button></p>`;
    } else if (tab === 'devices') {
      body = st.devices.length ? `<table><tr><th>Nombre</th><th>Tipo</th><th>Último uso</th><th></th></tr>${st.devices.map((d) => `
        <tr><td>${esc(d.name)}</td><td>${d.kind === 'android' ? 'App Android' : 'Navegador'}</td><td>${esc(new Date(d.lastSeen).toLocaleString())}</td>
        <td><button class="nav adm-danger" data-dev="${esc(d.id)}">Quitar</button></td></tr>`).join('')}</table>` : '<p>No hay consolas registradas.</p>';
    } else {
      body = `
        <form class="adm-card" data-f="settings">
          <label>Nombre del servidor <input name="name" class="nav" value="${esc(st.name)}"></label>
          <label>URL pública (opcional, para QR y enlaces) <input name="publicUrl" class="nav" value="${esc(st.publicUrl || '')}" placeholder="http://192.168.1.20:7777"></label>
          <button class="nav adm-primary">Guardar</button>
        </form>
        <form class="adm-card" data-f="password">
          <label>Contraseña actual <input name="old" type="password" class="nav"></label>
          <label>Nueva contraseña (mín. 8) <input name="new" type="password" class="nav"></label>
          <button class="nav">Cambiar contraseña</button>
        </form>
        <div class="adm-card"><p>Código para entrar desde la TV sin teclear la contraseña:</p>
          <button class="nav" data-act="code">Generar código</button> <b class="adm-code"></b></div>
        <p><small>GameHub ${esc(st.version)}</small></p>`;
    }
    root.innerHTML = `
      <div class="adm">
        <header><h1><span class="adm-lock">🔒</span> Administración · ${esc(st.name)}</h1>
          <div>${onExit ? '<button class="nav" data-act="exit">Volver a la consola</button>' : ''} <button class="nav" data-act="logout">Cerrar sesión</button></div></header>
        <nav>${tabs.map(([id, label]) => `<button class="nav ${tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>
        <p class="adm-msg">${esc(msg)}</p>
        <section>${body}</section>
      </div>`;

    const act = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => fn(el).catch((e) => render(e.message))));
    act('[data-tab]', async (el) => { tab = el.dataset.tab; render(); });
    act('[data-act="logout"]', async () => logout());
    act('[data-act="exit"]', async () => onExit());
    act('[data-close]', async (el) => { await api(`/api/admin/sessions/${el.dataset.close}`, { method: 'DELETE' }); render('Sesión cerrada'); });
    act('[data-game]', async (el) => { await api(`/api/admin/games/${el.dataset.game}`, { method: 'POST', body: { enabled: el.dataset.en === '1' } }); render('Juego actualizado'); });
    act('[data-dev]', async (el) => { await api(`/api/admin/devices/${el.dataset.dev}`, { method: 'DELETE' }); render('Dispositivo quitado'); });
    act('[data-act="rescan"]', async () => { const r = await api('/api/admin/rescan', { method: 'POST' }); render(`${r.count} juegos encontrados`); });
    act('[data-act="code"]', async () => { const r = await api('/api/admin/code', { method: 'POST' }); root.querySelector('.adm-code').textContent = `${r.code} (vence en 5 min)`; });
    root.querySelector('[data-f="settings"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/settings', { method: 'POST', body: { name: e.target.name.value, publicUrl: e.target.publicUrl.value } }); render('Ajustes guardados'); } catch (err) { render(err.message); }
    });
    root.querySelector('[data-f="password"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/password', { method: 'POST', body: { old: e.target.old.value, new: e.target.new.value } }); render('Contraseña cambiada'); } catch (err) { render(err.message); }
    });
    root.querySelector('.nav.on')?.focus();
  }

  if (token) { bumpIdle(); render(); } else renderLogin();
  return { unmount() { clearTimeout(idle); root.replaceChildren(); } };
}
