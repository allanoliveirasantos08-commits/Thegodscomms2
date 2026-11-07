(() => {
  'use strict';

  /* ===== utilidades ===== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ic = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const setIcon = (el, name) => el?.querySelector('use')?.setAttribute('href', '#i-' + name);

  const LOGO_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#58d6ff"/><stop offset="1" stop-color="#1e8fff"/></linearGradient></defs><path d="M64 6l50 18v38c0 30-21 51-50 60C35 113 14 92 14 62V24z" fill="#0a1429" stroke="url(#g)" stroke-width="5"/><text x="64" y="77" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="38" fill="url(#g)">TG</text></svg>');
  const fixLogo = (img) => { if (img.dataset.fb) return; img.dataset.fb = '1'; img.src = LOGO_FALLBACK; };
  document.addEventListener('error', (e) => { if (e.target?.matches?.('img[data-logo]')) fixLogo(e.target); }, true);
  $$('img[data-logo]').forEach((img) => { if (img.complete && img.naturalWidth === 0) fixLogo(img); });

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignora */ } },
  };
  const prefs = { autoMic: true, noise: true, echo: true, agc: true, keepAudio: true, sounds: true, inputId: '', outputId: '', ...store.get('tg_prefs_v3', {}) };
  const savePrefs = () => store.set('tg_prefs_v3', prefs);
  const volumes = store.get('tg_volumes_v3', {});

  let toastTimer;
  const toast = (message) => {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3600);
  };

  const initials = (name = 'TG') => String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || 'TG';
  const hueOf = (id = '') => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return 195 + (Math.abs(h) % 85); };
  const makeAvatar = (name, id, cls = '') => {
    const el = document.createElement('div'); el.className = 'av ' + cls; el.textContent = initials(name); el.style.setProperty('--h', hueOf(id)); return el;
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // equalizador decorativo do login
  (() => {
    const eq = $('#eq'); if (!eq) return;
    for (let i = 0; i < 40; i++) {
      const bar = document.createElement('i');
      bar.style.setProperty('--hh', (25 + Math.random() * 70) + '%');
      bar.style.animationDuration = (1 + Math.random() * 1.4) + 's';
      bar.style.animationDelay = (-Math.random() * 2) + 's';
      eq.append(bar);
    }
  })();

  /* ===== estado ===== */
  const configured = Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_ANON_KEY.includes('COLE_AQUI') && !window.SUPABASE_URL.includes('COLE_AQUI'));
  let db = null, user = null, profile = null, authMode = 'login';
  let appActive = false, entering = false;
  let channels = [], currentChannel = null;
  let chatChannel = null, chatSubscribedOnce = false, presenceChannel = null, presenceSince = new Date().toISOString();
  let members = [], onlineUsers = new Map();
  const profileCache = new Map();
  const unread = new Map();
  let messageRows = new Map(), lastMsg = null, lastDay = '', loadToken = 0, sending = false;

  const currentUser = async () => {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const u = data.session?.user;
    if (!u) throw new Error('Sua sessão expirou. Entre novamente.');
    user = u; return u;
  };
  const nameOf = (id) => profileCache.get(id) || (id === user?.id ? profile?.display_name : null) || 'Membro';

  /* ===== autenticação ===== */
  const setAuthMessage = (m) => { $('#auth-message').textContent = m; };
  function setAuthMode(mode) {
    authMode = mode;
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#auth-submit').textContent = mode === 'login' ? 'Entrar na plataforma' : 'Criar minha conta';
    $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    setAuthMessage(mode === 'login' ? 'Use sua conta para acessar a comunidade.' : 'Crie sua conta com um e-mail válido.');
  }
  $$('.auth-tab').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));

  async function ensureProfile(authUser) {
    const fallback = authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Guerreiro';
    const { data: existing, error: readError } = await db.from('profiles').select('id,display_name').eq('id', authUser.id).maybeSingle();
    if (readError) throw readError;
    if (existing) {
      profile = existing;
      if (!existing.display_name) {
        const { data, error } = await db.from('profiles').update({ display_name: fallback }).eq('id', authUser.id).select('id,display_name').single();
        if (!error && data) profile = data;
      }
    } else {
      const { data, error } = await db.from('profiles').upsert({ id: authUser.id, display_name: fallback }, { onConflict: 'id' }).select('id,display_name').single();
      if (error) throw error;
      profile = data;
    }
    profileCache.set(authUser.id, profile.display_name);
    updateMyIdentity();
  }
  function updateMyIdentity() {
    const name = profile?.display_name || user?.email?.split('@')[0] || 'Guerreiro';
    $('#my-name').textContent = name;
    const av = $('#my-avatar'); av.textContent = initials(name); av.style.setProperty('--h', hueOf(user?.id));
  }

  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured) return toast('Configure a chave publicável no arquivo config.js.');
    const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
    $('#auth-submit').disabled = true;
    try {
      const result = authMode === 'login'
        ? await db.auth.signInWithPassword({ email, password })
        : await db.auth.signUp({ email, password, options: { data: { display_name: email.split('@')[0] } } });
      if (result.error) throw result.error;
      if (authMode === 'signup' && !result.data.session) {
        setAuthMessage('Conta criada. Confirme seu e-mail e depois entre na plataforma.');
        toast('Cadastro realizado! Confira sua caixa de entrada.');
      } else if (result.data.session) {
        user = result.data.user; await enterApp();
      }
    } catch (error) { toast(error.message || 'Não foi possível autenticar.'); }
    finally { $('#auth-submit').disabled = false; }
  });

  $('#forgot-password').addEventListener('click', async () => {
    if (!configured) return toast('Configure o Supabase primeiro.');
    const email = $('#email').value.trim().toLowerCase();
    if (!email) return toast('Digite seu e-mail no campo acima primeiro.');
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      toast('Se o e-mail estiver cadastrado, você receberá o link de recuperação.');
    } catch (error) { toast(error.message); }
  });

  $('#recovery-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const { error } = await db.auth.updateUser({ password: $('#new-password').value });
      if (error) throw error;
      $('#recovery-dialog').close(); $('#new-password').value = ''; toast('Senha atualizada.');
    } catch (error) { toast('Não foi possível salvar a senha: ' + error.message); }
  });

  async function enterApp() {
    if (appActive || entering) return;
    entering = true;
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data.user) throw error || new Error('Sua sessão expirou. Entre novamente.');
      user = data.user;
      await ensureProfile(user);
      $('#auth-view').hidden = true; $('#app-view').hidden = false;
      await Promise.all([loadChannels(), loadMembers()]);
      startChat(); await startPresence();
      appActive = true;
      const first = channels.find((c) => c.type === 'text') || channels[0];
      if (first) openChannel(first); else showEmptyWelcome();
    } catch (error) {
      toast('Erro ao abrir a comunidade: ' + (error.message || error));
      $('#auth-view').hidden = false; $('#app-view').hidden = true;
    } finally { entering = false; }
  }

  async function resetApp() {
    await leaveVoice({ silent: true }).catch(() => {});
    try { if (chatChannel) await db.removeChannel(chatChannel); } catch { /* ok */ }
    try { if (presenceChannel) await db.removeChannel(presenceChannel); } catch { /* ok */ }
    chatChannel = presenceChannel = null; chatSubscribedOnce = false;
    user = profile = currentChannel = null; channels = []; members = []; onlineUsers = new Map(); unread.clear(); messageRows = new Map();
    appActive = false; document.title = 'THE GODS COMMS';
    $('#app-view').hidden = true; $('#auth-view').hidden = false; $('#password').value = ''; setAuthMode('login');
  }
  async function logout() { try { await leaveVoice({ silent: true }); await db.auth.signOut(); } finally { await resetApp(); } }
  $('#logout-rail').addEventListener('click', logout); $('#logout-side').addEventListener('click', logout);

  /* ===== drawers (mobile) ===== */
  const shell = () => $('#app-view');
  const closeDrawers = () => shell().classList.remove('drawer-left', 'drawer-right');
  $('#mobile-menu').addEventListener('click', () => { const open = shell().classList.contains('drawer-left'); closeDrawers(); if (!open) shell().classList.add('drawer-left'); });
  $('#members-toggle').addEventListener('click', () => { const open = shell().classList.contains('drawer-right'); closeDrawers(); if (!open) shell().classList.add('drawer-right'); });
  $('#scrim').addEventListener('click', closeDrawers);

  /* ===== canais ===== */
  async function loadChannels() {
    const { data, error } = await db.from('channels').select('id,name,type,created_at').order('created_at', { ascending: true });
    if (error) { toast('Não foi possível carregar os canais: ' + error.message); return; }
    channels = data || [];
    if (currentChannel) currentChannel = channels.find((c) => c.id === currentChannel.id) || currentChannel;
    renderChannels();
  }

  function renderChannels() {
    const t = $('#text-channels'), v = $('#voice-channels'); t.replaceChildren(); v.replaceChildren();
    const texts = channels.filter((c) => c.type === 'text'), voices = channels.filter((c) => c.type === 'voice');
    if (!texts.length) t.append(el('div', 'loading-line', 'Nenhum canal de texto ainda.'));
    if (!voices.length) v.append(el('div', 'loading-line', 'Nenhuma sala de voz ainda.'));
    texts.forEach((c) => t.append(textChannelButton(c)));
    voices.forEach((c) => v.append(voiceChannelBlock(c)));
  }

  function textChannelButton(channel) {
    const b = el('button', 'channel' + (currentChannel?.id === channel.id ? ' active' : '') + (unread.get(channel.id) ? ' unread' : ''));
    b.type = 'button'; b.innerHTML = ic('hash');
    b.append(el('span', 'channel-name', channel.name));
    const n = unread.get(channel.id); if (n) b.append(el('span', 'badge', n > 99 ? '99+' : String(n)));
    b.addEventListener('click', () => openChannel(channel));
    return b;
  }

  function voiceChannelBlock(channel) {
    const wrap = el('div');
    const b = el('button', 'channel' + (currentChannel?.id === channel.id ? ' active' : '') + (voice.channelId === channel.id ? ' live' : ''));
    b.type = 'button'; b.innerHTML = ic('volume'); b.append(el('span', 'channel-name', channel.name));
    b.addEventListener('click', () => openChannel(channel));
    wrap.append(b);
    const people = peopleInVoice(channel.id);
    if (people.length) {
      const list = el('div', 'voice-members');
      people.forEach((p) => {
        const row = el('div', 'vm'); row.append(makeAvatar(p.display_name, p.user_id), el('span', '', p.display_name || 'Guerreiro'));
        if (p.mic === false || p.deaf) { const s = document.createElement('span'); s.innerHTML = ic(p.deaf ? 'headphones-off' : 'mic-off'); row.append(s.firstChild); }
        list.append(row);
      });
      wrap.append(list);
    }
    return wrap;
  }
  const peopleInVoice = (channelId) => [...onlineUsers.values()].filter((p) => p.voice === channelId);

  async function openChannel(channel) {
    currentChannel = channel; unread.delete(channel.id); updateTitle(); renderChannels(); closeDrawers();
    $('#welcome-state').hidden = true;
    $('#chat-view').hidden = channel.type !== 'text';
    $('#voice-view').hidden = channel.type !== 'voice';
    $('#chat-title').textContent = channel.name;
    $('#chat-subtitle').textContent = channel.type === 'text' ? 'Canal de texto • mensagens em tempo real' : 'Sala de voz da equipe';
    $('#current-channel-icon').innerHTML = ic(channel.type === 'text' ? 'hash' : 'volume');
    if (channel.type === 'voice') { renderVoiceView(); return; }
    const input = $('#message-input');
    input.placeholder = `Conversar em #${channel.name}`; input.disabled = false; syncSend();
    if (window.matchMedia('(min-width:901px)').matches) input.focus();
    renderTyping();
    await loadMessages(channel);
  }

  function showEmptyWelcome() {
    $('#welcome-state').hidden = false; $('#chat-view').hidden = true; $('#voice-view').hidden = true;
    $('#welcome-text').textContent = 'Ainda não há canais. Crie os canais iniciais para começar.';
    $('#seed-channels').hidden = false;
  }
  $('#seed-channels').addEventListener('click', async () => {
    try {
      const u = await currentUser();
      const { error } = await db.from('channels').insert([
        { name: 'geral', type: 'text', created_by: u.id },
        { name: 'estrategias', type: 'text', created_by: u.id },
        { name: 'sala-1', type: 'voice', created_by: u.id },
      ]);
      if (error) throw error;
      await loadChannels(); $('#seed-channels').hidden = true;
      const first = channels.find((c) => c.type === 'text'); if (first) openChannel(first);
    } catch (e) { toast('Não foi possível criar os canais: ' + e.message); }
  });

  function updateTitle() {
    const total = [...unread.values()].reduce((a, b) => a + b, 0);
    document.title = (total ? `(${total}) ` : '') + 'THE GODS COMMS';
  }

  /* criar canal / perfil */
  const openChannelDialog = (type) => { $('#channel-type').value = type; $('#channel-dialog').showModal(); $('#channel-name').focus(); };
  $('#new-text-channel').addEventListener('click', () => openChannelDialog('text'));
  $('#new-voice-channel').addEventListener('click', () => openChannelDialog('voice'));
  $('#close-dialog').addEventListener('click', () => $('#channel-dialog').close());
  $('#channel-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#channel-name').value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const type = $('#channel-type').value;
    if (!name) return toast('Digite um nome válido para o canal.');
    try {
      const u = await currentUser();
      const { data, error } = await db.from('channels').insert({ name, type, created_by: u.id }).select('id,name,type,created_at').single();
      if (error) throw error;
      $('#channel-dialog').close(); $('#channel-form').reset(); toast('Canal criado.');
      await loadChannels(); if (data) openChannel(channels.find((c) => c.id === data.id) || data);
    } catch (error) { toast('Não foi possível criar o canal: ' + error.message); }
  });

  $('#profile-edit').addEventListener('click', () => { $('#display-name').value = profile?.display_name || ''; $('#profile-dialog').showModal(); });
  $('#close-profile').addEventListener('click', () => $('#profile-dialog').close());
  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const display_name = $('#display-name').value.trim();
    if (display_name.length < 2) return toast('Use pelo menos 2 caracteres.');
    try {
      const u = await currentUser();
      const { data, error } = await db.from('profiles').upsert({ id: u.id, display_name }, { onConflict: 'id' }).select('id,display_name').single();
      if (error) throw error;
      profile = data; profileCache.set(u.id, data.display_name); updateMyIdentity();
      $('#profile-dialog').close(); await loadMembers(); pushPresence(); toast('Perfil atualizado.');
    } catch (error) { toast('Não foi possível salvar: ' + error.message); }
  });

  /* ===== chat ===== */
  const isNearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const scrollToBottom = () => { const b = $('#messages'); b.scrollTop = b.scrollHeight; $('#scroll-bottom').hidden = true; };

  function resetMessages(html) {
    messageRows = new Map(); lastMsg = null; lastDay = '';
    $('#messages').replaceChildren(); if (html) $('#messages').append(el('div', 'empty-state', html));
  }

  async function loadMessages(channel) {
    const token = ++loadToken;
    resetMessages('Carregando mensagens...');
    const { data, error } = await db.from('messages').select('id,content,user_id,created_at').eq('channel_id', channel.id).order('created_at', { ascending: false }).limit(150);
    if (token !== loadToken) return;
    if (error) { resetMessages('Não foi possível carregar o histórico. Confira as tabelas e as políticas RLS.'); toast('Erro ao carregar mensagens: ' + error.message); return; }
    const rows = (data || []).reverse();
    await cacheProfiles(rows.map((m) => m.user_id));
    if (token !== loadToken) return;
    resetMessages();
    rows.forEach(renderMessage);
    if (!rows.length) $('#messages').append(el('div', 'empty-state', 'Este canal ainda está quieto. Que tal começar a conversa?'));
    scrollToBottom();
  }

  async function cacheProfiles(ids) {
    const missing = [...new Set(ids.filter((id) => id && !profileCache.has(id)))];
    if (!missing.length) return;
    const { data } = await db.from('profiles').select('id,display_name').in('id', missing);
    (data || []).forEach((p) => profileCache.set(p.id, p.display_name));
  }

  const dayLabel = (d) => {
    const today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  function linkify(text) {
    const frag = document.createDocumentFragment();
    text.split(/(https?:\/\/[^\s<]+)/g).forEach((part, i) => {
      if (i % 2) { const a = el('a', '', part); a.href = part; a.target = '_blank'; a.rel = 'noopener noreferrer'; frag.append(a); }
      else if (part) frag.append(document.createTextNode(part));
    });
    return frag;
  }

  function renderMessage(m) {
    if (!m?.id || messageRows.has(m.id)) return;
    messageRows.set(m.id, m);
    const box = $('#messages'), near = isNearBottom(box), mine = m.user_id === user?.id;
    box.querySelector('.empty-state')?.remove();
    const date = new Date(m.created_at), day = date.toDateString();
    if (day !== lastDay) { box.append(el('div', 'day', dayLabel(date))); lastDay = day; lastMsg = null; }
    const cont = lastMsg && lastMsg.user_id === m.user_id && (date - lastMsg.date) < 5 * 60e3;
    const name = nameOf(m.user_id);
    const row = el('article', 'msg' + (cont ? ' cont' : '') + (mine ? ' mine' : '')); row.dataset.id = m.id;
    const gutter = el('div', 'msg-gutter');
    const time = el('time', 'msg-time', date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); time.dateTime = m.created_at;
    const main = el('div', 'msg-main');
    if (cont) gutter.append(time);
    else {
      gutter.append(makeAvatar(name, m.user_id));
      const head = el('div', 'msg-head'); head.append(el('span', 'msg-author', mine ? 'Você' : name), time); main.append(head);
    }
    const text = el('p', 'msg-text'); text.append(linkify(String(m.content ?? ''))); main.append(text);
    row.append(gutter, main); box.append(row); lastMsg = { user_id: m.user_id, date };
    if (near || mine) scrollToBottom(); else $('#scroll-bottom').hidden = false;
  }
  $('#messages').addEventListener('scroll', () => { if (isNearBottom($('#messages'))) $('#scroll-bottom').hidden = true; });
  $('#scroll-bottom').addEventListener('click', scrollToBottom);

  function startChat() {
    if (chatChannel) db.removeChannel(chatChannel);
    chatChannel = db.channel('tg-chat', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onInsert)
      .on('broadcast', { event: 'typing' }, onTyping)
      .subscribe((status) => {
        const chip = $('#conn-chip');
        if (status === 'SUBSCRIBED') {
          chip.classList.add('ok'); chip.lastElementChild.textContent = 'Conectado';
          if (chatSubscribedOnce && currentChannel?.type === 'text') loadMessages(currentChannel); // recupera o que passou durante a queda
          chatSubscribedOnce = true;
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          chip.classList.remove('ok'); chip.lastElementChild.textContent = 'Reconectando';
          if (status === 'CHANNEL_ERROR') toast('Tempo real indisponível. Confira se o Realtime está ativo na tabela messages.');
        }
      });
  }

  async function onInsert(payload) {
    const m = payload.new; if (!m?.id) return;
    if (m.channel_id === currentChannel?.id && currentChannel.type === 'text') {
      await cacheProfiles([m.user_id]);
      if (m.channel_id === currentChannel?.id) renderMessage(m);
      typers.delete(m.user_id); renderTyping();
    } else if (m.user_id !== user?.id) {
      unread.set(m.channel_id, (unread.get(m.channel_id) || 0) + 1); updateTitle(); renderChannels();
    }
  }

  /* digitando */
  const typers = new Map(); let lastTypingSent = 0;
  function sendTyping() {
    const now = Date.now(); if (now - lastTypingSent < 2500 || !chatChannel || !currentChannel) return;
    lastTypingSent = now;
    chatChannel.send({ type: 'broadcast', event: 'typing', payload: { channel_id: currentChannel.id, user_id: user.id, name: profile?.display_name || 'Alguém' } });
  }
  function onTyping({ payload }) {
    if (!payload || payload.user_id === user?.id) return;
    clearTimeout(typers.get(payload.user_id)?.timer);
    typers.set(payload.user_id, { name: payload.name, channel: payload.channel_id, timer: setTimeout(() => { typers.delete(payload.user_id); renderTyping(); }, 4000) });
    renderTyping();
  }
  function renderTyping() {
    const names = [...typers.values()].filter((t) => t.channel === currentChannel?.id).map((t) => t.name);
    $('#typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} está digitando…` : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando…` : 'Vários membros estão digitando…';
  }

  /* composer */
  const input = $('#message-input');
  const syncSend = () => { $('#send-btn').disabled = !input.value.trim() || !currentChannel || currentChannel.type !== 'text' || sending; };
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
  const updateCount = () => { const c = $('#char-count'), left = 2000 - input.value.length; c.hidden = left > 200; c.textContent = left; };
  input.addEventListener('input', () => { autosize(); updateCount(); syncSend(); if (input.value.trim()) sendTyping(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#message-form').requestSubmit(); } });
  $('#message-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content || !currentChannel || currentChannel.type !== 'text' || sending) return;
    sending = true; syncSend();
    try {
      const u = await currentUser();
      const { data, error } = await db.from('messages').insert({ channel_id: currentChannel.id, user_id: u.id, content }).select('id,content,user_id,created_at').single();
      if (error) throw error;
      input.value = ''; autosize(); updateCount();
      renderMessage(data); // o eco do Realtime é ignorado pelo id
    } catch (error) { toast('Não foi possível enviar: ' + error.message); }
    finally { sending = false; syncSend(); input.focus(); }
  });

  const EMOJIS = ['🔥', '👍', '😂', '❤️', '🎮', '🏆', '💀', '😎', '🤝', '👀', '💪', '🙌', '😅', '🤔', '😭', '🥶', '⚡', '🎯', '👑', '🚀', '✅', '❌', '😤', '🫡'];
  const pop = $('#emoji-pop');
  EMOJIS.forEach((e) => { const b = el('button', '', e); b.type = 'button'; b.addEventListener('click', () => {
    const s = input.selectionStart ?? input.value.length; input.setRangeText(e, s, input.selectionEnd ?? s, 'end');
    input.dispatchEvent(new Event('input')); input.focus(); }); pop.append(b); });
  $('#emoji-btn').addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });

  /* ===== membros e presença ===== */
  async function loadMembers() {
    const { data, error } = await db.from('profiles').select('id,display_name').order('display_name');
    if (error) { members = []; renderMembers(); return; }
    members = data || []; members.forEach((m) => profileCache.set(m.id, m.display_name)); renderMembers();
  }

  function memberRow(m, online) {
    const row = el('div', 'member ' + (online ? 'online' : 'offline'));
    row.append(makeAvatar(m.display_name, m.id));
    const copy = el('div', 'member-copy'); copy.append(el('span', 'member-name', (m.display_name || 'Guerreiro') + (m.id === user?.id ? ' (você)' : '')));
    const p = onlineUsers.get(m.id);
    if (p?.voice) { const ch = channels.find((c) => c.id === p.voice); if (ch) copy.append(el('span', 'member-sub', 'Em ' + ch.name)); }
    row.append(copy); return row;
  }

  function renderMembers() {
    const on = $('#online-members'), off = $('#offline-members'); on.replaceChildren(); off.replaceChildren();
    const known = new Set(members.map((m) => m.id));
    const extra = [...onlineUsers.entries()].filter(([id]) => !known.has(id)).map(([id, p]) => ({ id, display_name: p.display_name }));
    const all = [...members, ...extra];
    const online = all.filter((m) => onlineUsers.has(m.id)), offline = all.filter((m) => !onlineUsers.has(m.id));
    online.forEach((m) => on.append(memberRow(m, true))); offline.forEach((m) => off.append(memberRow(m, false)));
    if (!online.length) on.append(el('div', 'loading-line', 'Ninguém online agora.'));
    $('#online-count').textContent = online.length; $('#offline-count').textContent = offline.length; $('#member-count').textContent = all.length;
  }

  const myPresence = () => ({
    user_id: user.id, display_name: profile?.display_name || 'Guerreiro', online_at: presenceSince,
    voice: voice.channelId || null, mic: voice.mic, deaf: voice.deaf, screen: voice.screen,
  });
  let trackTimer;
  function pushPresence() {
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => { if (presenceChannel && user) Promise.resolve(presenceChannel.track(myPresence())).catch(() => {}); }, 150);
  }

  async function startPresence() {
    if (presenceChannel) await db.removeChannel(presenceChannel);
    presenceChannel = db.channel('tg-community-presence', { config: { presence: { key: user.id } } });
    ['sync', 'join', 'leave'].forEach((ev) => presenceChannel.on('presence', { event: ev }, updatePresence));
    presenceChannel.subscribe((status) => { if (status === 'SUBSCRIBED') presenceChannel.track(myPresence()); });
  }
  function updatePresence() {
    if (!presenceChannel) return;
    onlineUsers = new Map();
    Object.entries(presenceChannel.presenceState()).forEach(([key, entries]) => { const e = entries?.[entries.length - 1]; if (e) onlineUsers.set(key, e); });
    renderMembers(); renderChannels();
    if (currentChannel?.type === 'voice') renderVoiceView();
    if (voice.room) syncTiles();
  }

  /* =====================================================================
     VOZ (LiveKit)
     ===================================================================== */
  const voice = {
    room: null, channelId: null, joining: false, leaving: false,
    mic: false, deaf: false, screen: false, micBeforeDeaf: false,
    screens: new Map(), activeShare: null, levelTimer: null, wakeLock: null,
  };
  const tiles = new Map();
  const stageVideo = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
  let stageTrack = null;
  const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
  const canPickOutput = 'setSinkId' in HTMLMediaElement.prototype;

  const LK = () => { if (!window.LivekitClient) throw new Error('A biblioteca de voz não carregou. Atualize a página e tente de novo.'); return window.LivekitClient; };

  /* sons de interface */
  let actx = null;
  function beep(freqs) {
    if (!prefs.sounds) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.11);
      });
    } catch { /* sem áudio de interface */ }
  }
  const SND = { join: [523, 784], other: [659, 880], leave: [784, 523], mute: [392], unmute: [587] };

  /* ---------- visão da sala ---------- */
  function setPill(state, text) {
    const pill = $('#voice-live-pill'); pill.className = 'pill' + (state ? ' ' + state : ''); pill.lastElementChild.textContent = text;
  }

  function renderVoiceView() {
    const ch = currentChannel; if (!ch || ch.type !== 'voice') return;
    $('#voice-title').textContent = ch.name;
    const inThis = !!voice.room && voice.channelId === ch.id;
    $('#voice-lobby').hidden = inThis; $('#voice-room').hidden = !inThis; $('#voice-controls').hidden = !inThis;
    if (inThis) {
      setPill('on', 'Conectado'); $('#voice-connection-label').textContent = 'Você está na sala. Fale com a equipe.';
      return;
    }
    const elsewhere = voice.room ? channels.find((c) => c.id === voice.channelId) : null;
    setPill(voice.joining ? 'warn' : '', voice.joining ? 'Conectando' : 'Desconectado');
    $('#voice-connection-label').textContent = elsewhere ? `Você está em “${elsewhere.name}”.` : 'Entre na sala para falar com a equipe.';
    $('#lobby-title').textContent = elsewhere ? 'Mudar de sala?' : 'Pronto para entrar?';
    $('#lobby-note').textContent = elsewhere ? `Você sai de “${elsewhere.name}” e entra em “${ch.name}”.` : (prefs.autoMic ? 'Você entra com o microfone ligado. Dá para desligar a qualquer momento.' : 'Você entra com o microfone desligado.');
    const people = $('#lobby-people'); people.replaceChildren();
    const inRoom = peopleInVoice(ch.id);
    if (!inRoom.length) people.append(el('span', 'muted', 'Ninguém na sala agora. Seja o primeiro.'));
    inRoom.forEach((p) => { const chip = el('span', 'chip'); chip.append(makeAvatar(p.display_name, p.user_id), document.createTextNode(p.display_name || 'Guerreiro')); people.append(chip); });
    const btn = $('#voice-join'); btn.disabled = voice.joining;
    btn.lastElementChild.textContent = voice.joining ? 'Conectando…' : (elsewhere ? 'Mudar para esta sala' : 'Entrar na sala');
  }

  /* ---------- controles ---------- */
  function setCtl(sel, { off = false, on = false, icon, label }) {
    $$(sel).forEach((b) => {
      b.classList.toggle('off', off); b.classList.toggle('on', on); setIcon(b, icon);
      b.setAttribute('aria-label', label); b.title = label;
    });
  }
  function syncControls() {
    const inRoom = !!voice.room;
    $('#voice-dock').hidden = !inRoom;
    if (inRoom) $('#dock-name').textContent = channels.find((c) => c.id === voice.channelId)?.name || 'Sala de voz';
    const micLabel = voice.mic ? 'Desligar microfone' : 'Ligar microfone';
    setCtl('#voice-mic, #dock-mic', { off: !voice.mic, icon: voice.mic ? 'mic' : 'mic-off', label: micLabel });
    const deafLabel = voice.deaf ? 'Ativar áudio da sala' : 'Ensurdecer';
    setCtl('#voice-deaf, #dock-deaf', { off: voice.deaf, icon: voice.deaf ? 'headphones-off' : 'headphones', label: deafLabel });
    setCtl('#voice-screen', { on: voice.screen, icon: 'screen', label: voice.screen ? 'Parar compartilhamento' : 'Compartilhar tela' });
    $('#voice-screen .ctl-tx').textContent = voice.screen ? 'Parar' : 'Tela';
    $('#voice-screen').disabled = !canShareScreen;
    if (!canShareScreen) $('#voice-screen').title = 'Este dispositivo não permite compartilhar a tela';
    $('#share-banner').hidden = !voice.screen;
  }

  /* ---------- participantes ---------- */
  const allParticipants = () => voice.room ? [voice.room.localParticipant, ...voice.room.remoteParticipants.values()] : [];

  function buildTile(p) {
    const root = el('div', 'tile'); root.dataset.id = p.identity;
    const name = p.name || p.identity;
    const av = makeAvatar(name, p.identity);
    const badges = el('div', 'tile-badges');
    const bMic = el('span'); bMic.innerHTML = ic('mic-off'); bMic.title = 'Microfone desligado';
    const bDeaf = el('span'); bDeaf.innerHTML = ic('headphones-off'); bDeaf.title = 'Áudio da sala desligado';
    const bScr = el('span', 'b-screen'); bScr.innerHTML = ic('screen'); bScr.title = 'Compartilhando a tela';
    const q = el('span', 'q'); q.innerHTML = '<i></i><i></i><i></i>'; q.title = 'Qualidade da conexão';
    badges.append(bMic, bDeaf, bScr, q);
    const nameEl = el('div', 'tile-name'), sub = el('div', 'tile-sub');
    root.append(badges, av, nameEl, sub);
    const t = { el: root, av, nameEl, sub, bMic, bDeaf, bScr, q, lvl: -1, speaking: false };
    if (!p.isLocal) {
      const vol = el('label', 'tile-vol'); vol.innerHTML = ic('volume');
      const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.05';
      range.value = String(volumes[p.identity] ?? 1); range.setAttribute('aria-label', 'Volume de ' + name);
      const out = document.createElement('output'); out.textContent = Math.round(range.value * 100) + '%';
      range.addEventListener('input', () => {
        const v = Number(range.value); volumes[p.identity] = v; store.set('tg_volumes_v3', volumes);
        out.textContent = Math.round(v * 100) + '%'; applyVolume(p);
      });
      vol.append(range, out); root.append(vol); t.range = range;
    }
    return t;
  }

  function applyVolume(p) {
    const v = volumes[p.identity] ?? 1, L = LK();
    try { p.setVolume(v); p.setVolume(v, L.Track.Source.ScreenShareAudio); } catch { /* ainda sem faixa */ }
  }

  function updateTile(p, t) {
    t.nameEl.textContent = (p.name || p.identity) + (p.isLocal ? ' (você)' : '');
    const info = onlineUsers.get(p.identity);
    const deaf = p.isLocal ? voice.deaf : !!info?.deaf;
    const micOn = p.isLocal ? voice.mic : p.isMicrophoneEnabled;
    const sharing = p.isLocal ? voice.screen : p.isScreenShareEnabled;
    t.bMic.hidden = micOn; t.bDeaf.hidden = !deaf; t.bScr.hidden = !sharing;
    t.sub.textContent = deaf ? 'Áudio desligado' : (micOn ? (t.speaking ? 'Falando agora' : 'Microfone ligado') : 'Microfone desligado');
    const quality = { excellent: 3, good: 2, poor: 1, lost: 0 }[p.connectionQuality];
    t.q.hidden = quality == null; if (quality != null) t.q.dataset.l = String(quality);
  }

  function syncTiles() {
    const list = $('#voice-participants'); if (!list) return;
    const parts = allParticipants(), ids = new Set(parts.map((p) => p.identity));
    tiles.forEach((t, id) => { if (!ids.has(id)) { t.el.remove(); tiles.delete(id); } });
    parts.forEach((p) => {
      let t = tiles.get(p.identity);
      if (!t) { t = buildTile(p); tiles.set(p.identity, t); list.append(t.el); }
      updateTile(p, t);
    });
    $('#voice-participant-count').textContent = String(parts.length);
  }

  function startLevels() {
    stopLevels();
    voice.levelTimer = setInterval(() => {
      allParticipants().forEach((p) => {
        const t = tiles.get(p.identity); if (!t) return;
        const muted = p.isLocal ? !voice.mic : !p.isMicrophoneEnabled;
        const lvl = muted ? 0 : Math.min(1, (p.audioLevel || 0) * 2.4);
        const speaking = !muted && p.isSpeaking;
        if (Math.abs(lvl - t.lvl) > 0.02) { t.lvl = lvl; t.el.style.setProperty('--lvl', lvl.toFixed(2)); }
        if (speaking !== t.speaking) { t.speaking = speaking; t.el.classList.toggle('speaking', speaking); updateTile(p, t); }
        if (p.isLocal && $('#audio-dialog').open) $('#mic-meter').style.width = Math.round(lvl * 100) + '%';
      });
    }, 90);
  }
  function stopLevels() { clearInterval(voice.levelTimer); voice.levelTimer = null; }

  /* ---------- palco de compartilhamento ---------- */
  function detachStage() {
    try { stageTrack?.detach(stageVideo); } catch { /* ok */ }
    stageTrack = null; stageVideo.srcObject = null; stageVideo.remove();
  }
  function renderStage() {
    const wrap = $('#stage-wrap'), room = $('#voice-room'), ids = [...voice.screens.keys()];
    if (!ids.length) { detachStage(); wrap.hidden = true; room.classList.remove('has-stage'); return; }
    if (!voice.activeShare || !voice.screens.has(voice.activeShare)) voice.activeShare = ids[ids.length - 1];
    const cur = voice.screens.get(voice.activeShare);
    if (stageTrack !== cur.track) { detachStage(); stageTrack = cur.track; cur.track.attach(stageVideo); $('#screen-stage').prepend(stageVideo); }
    else if (!stageVideo.isConnected) $('#screen-stage').prepend(stageVideo);
    $('#stage-label').textContent = 'Tela de ' + cur.name;
    const tabs = $('#stage-tabs'); tabs.replaceChildren();
    if (ids.length > 1) ids.forEach((id) => {
      const b = el('button', id === voice.activeShare ? 'active' : '', voice.screens.get(id).name); b.type = 'button';
      b.addEventListener('click', () => { voice.activeShare = id; renderStage(); }); tabs.append(b);
    });
    wrap.hidden = false; room.classList.add('has-stage');
  }
  $('#stage-fullscreen').addEventListener('click', () => { const s = $('#screen-stage'); (document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen?.())?.catch?.(() => {}); });

  /* ---------- entrar ---------- */
  async function joinVoice() {
    const ch = currentChannel;
    if (!ch || ch.type !== 'voice' || voice.joining || (voice.room && voice.channelId === ch.id)) return;
    voice.joining = true; renderVoiceView();
    try {
      const L = LK();
      if (voice.room) await leaveVoice({ silent: true });
      const { data: sd, error: se } = await db.auth.getSession(); if (se) throw se;
      const accessToken = sd.session?.access_token;
      if (!accessToken) throw new Error('Sua sessão expirou. Entre novamente.');
      let res;
      try {
        res = await fetch('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ room: String(ch.id) }) });
      } catch { throw new Error('Sem conexão com o servidor de voz. Verifique sua internet.'); }
      const payload = await res.json().catch(() => null);
      if (!payload) throw new Error('A API de voz não respondeu. Confirme que o Worker foi publicado (teste /api/health).');
      if (!res.ok) throw new Error(payload.missing?.length ? 'Backend ainda não configurado. Faltam: ' + payload.missing.join(', ') : (payload.error || 'Não foi possível obter acesso à sala.'));

      const room = new L.Room({
        adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true,
        audioCaptureDefaults: { echoCancellation: prefs.echo, noiseSuppression: prefs.noise, autoGainControl: prefs.agc, channelCount: 1, deviceId: prefs.inputId || undefined },
        publishDefaults: { dtx: true, red: true, audioPreset: { maxBitrate: 48000 }, screenShareEncoding: { maxBitrate: 6000000, maxFramerate: 30 } },
      });
      voice.room = room; voice.channelId = ch.id; voice.mic = false; voice.deaf = false; voice.screen = false;
      bindRoom(room, L);
      await room.connect(payload.serverUrl, payload.token, { autoSubscribe: true });
      room.startAudio().catch(() => {});
      if (prefs.outputId && canPickOutput) room.switchActiveDevice('audiooutput', prefs.outputId).catch(() => {});

      voice.joining = false;
      beep(SND.join); startLevels(); enableBackgroundKeepAlive(ch.name);
      syncControls(); syncTiles(); renderVoiceView(); renderChannels(); pushPresence();
      if (prefs.autoMic) await setMic(true);
      loadDevices();
    } catch (error) {
      const failed = voice.room; voice.room = null; voice.channelId = null;
      try { await failed?.disconnect(); } catch { /* ok */ }
      teardownVoice(); toast(error.message || 'Não foi possível entrar na sala.');
      setPill('', 'Desconectado'); $('#voice-connection-label').textContent = error.message || 'Falha ao conectar.';
    } finally { voice.joining = false; renderVoiceView(); }
  }

  function bindRoom(room, L) {
    const E = L.RoomEvent, S = L.Track.Source;
    room.on(E.ParticipantConnected, () => { beep(SND.other); syncTiles(); });
    room.on(E.ParticipantDisconnected, (p) => { beep(SND.leave); voice.screens.delete(p.identity); renderStage(); syncTiles(); });
    room.on(E.TrackSubscribed, (track, pub, p) => {
      if (track.kind === 'audio') {
        const a = track.attach(); a.dataset.pid = p.identity; a.muted = voice.deaf; $('#audio-sink').append(a); applyVolume(p);
      } else if (track.kind === 'video' && track.source === S.ScreenShare) {
        voice.screens.set(p.identity, { track, name: p.name || p.identity }); voice.activeShare = p.identity; renderStage();
      }
      syncTiles();
    });
    room.on(E.TrackUnsubscribed, (track, pub, p) => {
      track.detach().forEach((n) => n.remove());
      if (track.source === S.ScreenShare && track.kind === 'video') { voice.screens.delete(p.identity); renderStage(); }
      syncTiles();
    });
    const syncLocal = () => {
      const lp = room.localParticipant;
      voice.mic = lp.isMicrophoneEnabled; voice.screen = lp.isScreenShareEnabled;
      syncControls(); syncTiles(); pushPresence();
    };
    room.on(E.LocalTrackPublished, syncLocal); room.on(E.LocalTrackUnpublished, syncLocal);
    room.on(E.TrackMuted, (pub, p) => { if (p.isLocal) syncLocal(); else syncTiles(); });
    room.on(E.TrackUnmuted, (pub, p) => { if (p.isLocal) syncLocal(); else syncTiles(); });
    room.on(E.ConnectionQualityChanged, () => syncTiles());
    room.on(E.Reconnecting, () => { setPill('warn', 'Reconectando'); $('#voice-connection-label').textContent = 'Conexão instável. Tentando reconectar…'; });
    room.on(E.Reconnected, () => { setPill('on', 'Conectado'); $('#voice-connection-label').textContent = 'Reconectado.'; });
    room.on(E.AudioPlaybackStatusChanged, () => { $('#audio-banner').hidden = room.canPlaybackAudio; });
    room.on(E.MediaDevicesChanged, () => loadDevices());
    room.on(E.MediaDevicesError, (e) => toast(explainMediaError(e)));
    room.on(E.Disconnected, () => {
      if (voice.room !== room || voice.leaving) return;
      teardownVoice(); beep(SND.leave); toast('Você foi desconectado da sala.');
    });
  }

  /* ---------- sair ---------- */
  async function leaveVoice({ silent = false } = {}) {
    const room = voice.room; if (!room) return;
    voice.leaving = true;
    try { await room.disconnect(); } catch { /* ok */ }
    teardownVoice(); voice.leaving = false;
    if (!silent) { beep(SND.leave); toast('Você saiu da sala.'); }
  }
  function teardownVoice() {
    stopLevels(); detachStage(); voice.screens.clear(); voice.activeShare = null;
    $$('#audio-sink audio').forEach((a) => a.remove());
    tiles.forEach((t) => t.el.remove()); tiles.clear();
    voice.room = null; voice.channelId = null; voice.mic = voice.deaf = voice.screen = voice.micBeforeDeaf = false;
    $('#audio-banner').hidden = true; $('#stage-wrap').hidden = true; $('#voice-room').classList.remove('has-stage');
    disableBackgroundKeepAlive(); syncControls(); renderVoiceView(); renderChannels(); pushPresence();
  }

  /* ---------- microfone, áudio e tela ---------- */
  const explainMediaError = (e) => {
    const n = e?.name || e?.error?.name;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Permita o acesso ao microfone no navegador e tente de novo.';
    if (n === 'NotFoundError') return 'Nenhum microfone foi encontrado neste dispositivo.';
    if (n === 'NotReadableError') return 'O microfone está em uso por outro aplicativo.';
    return 'Não foi possível usar o microfone: ' + (e?.message || e?.error?.message || 'erro desconhecido');
  };
  const micOptions = () => ({ echoCancellation: prefs.echo, noiseSuppression: prefs.noise, autoGainControl: prefs.agc, channelCount: 1, deviceId: prefs.inputId || undefined });

  async function setMic(on) {
    const lp = voice.room?.localParticipant; if (!lp) return;
    try { await lp.setMicrophoneEnabled(on, on ? micOptions() : undefined); voice.mic = lp.isMicrophoneEnabled; }
    catch (e) { voice.mic = false; toast(explainMediaError(e)); }
    syncControls(); syncTiles(); pushPresence(); if (on && voice.mic) loadDevices();
  }
  function applyDeaf(on) { voice.deaf = on; $$('#audio-sink audio').forEach((a) => { a.muted = on; }); }

  async function toggleMic() {
    if (!voice.room) return;
    const next = !voice.mic;
    if (next && voice.deaf) { applyDeaf(false); voice.micBeforeDeaf = false; }
    beep(next ? SND.unmute : SND.mute); await setMic(next);
  }
  async function toggleDeaf() {
    if (!voice.room) return;
    if (!voice.deaf) { voice.micBeforeDeaf = voice.mic; applyDeaf(true); if (voice.mic) await setMic(false); beep(SND.mute); }
    else { applyDeaf(false); beep(SND.unmute); if (voice.micBeforeDeaf) { voice.micBeforeDeaf = false; await setMic(true); } }
    syncControls(); syncTiles(); pushPresence();
  }
  async function toggleScreen() {
    const lp = voice.room?.localParticipant; if (!lp) return;
    try {
      if (lp.isScreenShareEnabled) await lp.setScreenShareEnabled(false);
      else await lp.setScreenShareEnabled(true,
        { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'motion', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include' },
        { screenShareEncoding: { maxBitrate: 6000000, maxFramerate: 30 } });
    } catch (e) { if (e?.name !== 'NotAllowedError') toast('Compartilhamento não iniciado: ' + (e.message || e)); }
    voice.screen = lp.isScreenShareEnabled; syncControls(); syncTiles(); pushPresence();
  }

  $('#voice-join').addEventListener('click', joinVoice);
  $('#voice-leave').addEventListener('click', () => leaveVoice());
  $('#dock-leave').addEventListener('click', () => leaveVoice());
  $('#voice-mic').addEventListener('click', toggleMic); $('#dock-mic').addEventListener('click', toggleMic);
  $('#voice-deaf').addEventListener('click', toggleDeaf); $('#dock-deaf').addEventListener('click', toggleDeaf);
  $('#voice-screen').addEventListener('click', toggleScreen); $('#share-stop').addEventListener('click', toggleScreen);
  $('#audio-start').addEventListener('click', () => voice.room?.startAudio().then(() => { $('#audio-banner').hidden = true; }).catch(() => {}));
  $('#dock-go').addEventListener('click', () => { const ch = channels.find((c) => c.id === voice.channelId); if (ch) openChannel(ch); });

  document.addEventListener('keydown', (e) => {
    if (!voice.room || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMic(); }
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); toggleDeaf(); }
  });

  /* ---------- ajustes de áudio ---------- */
  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inSel = $('#voice-input-device'), outSel = $('#voice-output-device');
      const activeIn = voice.room?.getActiveDevice?.('audioinput') || prefs.inputId, activeOut = voice.room?.getActiveDevice?.('audiooutput') || prefs.outputId;
      inSel.replaceChildren(new Option('Padrão do sistema', '')); outSel.replaceChildren(new Option('Padrão do sistema', ''));
      devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default').forEach((d, i) => inSel.add(new Option(d.label || `Microfone ${i + 1}`, d.deviceId)));
      devices.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').forEach((d, i) => outSel.add(new Option(d.label || `Saída ${i + 1}`, d.deviceId)));
      if ([...inSel.options].some((o) => o.value === activeIn)) inSel.value = activeIn;
      if ([...outSel.options].some((o) => o.value === activeOut)) outSel.value = activeOut;
    } catch { /* lista indisponível */ }
    $('#voice-output-device').disabled = !canPickOutput; $('#output-hint').hidden = canPickOutput;
  }

  function openAudioDialog() {
    $('#pref-noise').checked = prefs.noise; $('#pref-echo').checked = prefs.echo; $('#pref-agc').checked = prefs.agc;
    $('#pref-automic').checked = prefs.autoMic; $('#keep-audio').checked = prefs.keepAudio; $('#pref-sounds').checked = prefs.sounds;
    loadDevices(); $('#audio-dialog').showModal();
  }
  $('#voice-settings-btn').addEventListener('click', openAudioDialog);
  $('#lobby-settings').addEventListener('click', openAudioDialog);
  $('#close-audio').addEventListener('click', () => $('#audio-dialog').close());
  $('#audio-dialog').addEventListener('close', () => { $('#mic-meter').style.width = '0'; });

  $('#voice-input-device').addEventListener('change', async (e) => {
    prefs.inputId = e.target.value; savePrefs();
    if (!voice.room) return;
    try { await voice.room.switchActiveDevice('audioinput', e.target.value || 'default'); toast('Microfone alterado.'); }
    catch (err) { toast('Não foi possível trocar o microfone: ' + err.message); }
  });
  $('#voice-output-device').addEventListener('change', async (e) => {
    prefs.outputId = e.target.value; savePrefs();
    if (!voice.room) return;
    try { await voice.room.switchActiveDevice('audiooutput', e.target.value || 'default'); toast('Saída de áudio alterada.'); }
    catch (err) { toast('Não foi possível trocar a saída: ' + err.message); }
  });
  [['#pref-noise', 'noise'], ['#pref-echo', 'echo'], ['#pref-agc', 'agc']].forEach(([sel, key]) => {
    $(sel).addEventListener('change', async (e) => {
      prefs[key] = e.target.checked; savePrefs();
      const track = voice.room?.localParticipant.getTrackPublication(LK().Track.Source.Microphone)?.audioTrack;
      if (track) { try { await track.restartTrack(micOptions()); } catch (err) { toast('Não foi possível aplicar: ' + err.message); } }
    });
  });
  $('#pref-automic').addEventListener('change', (e) => { prefs.autoMic = e.target.checked; savePrefs(); renderVoiceView(); });
  $('#pref-sounds').addEventListener('change', (e) => { prefs.sounds = e.target.checked; savePrefs(); });
  $('#keep-audio').addEventListener('change', (e) => {
    prefs.keepAudio = e.target.checked; savePrefs();
    if (voice.room) { if (prefs.keepAudio) enableBackgroundKeepAlive(channels.find((c) => c.id === voice.channelId)?.name); else disableBackgroundKeepAlive(); }
  });

  /* ---------- segundo plano (melhor esforço) ---------- */
  async function requestWakeLock() {
    try { if (prefs.keepAudio && voice.room && !voice.wakeLock && navigator.wakeLock && !document.hidden) { voice.wakeLock = await navigator.wakeLock.request('screen'); voice.wakeLock.addEventListener('release', () => { voice.wakeLock = null; }); } } catch { /* sem wake lock */ }
  }
  function enableBackgroundKeepAlive(roomName = 'Sala de voz') {
    if (!prefs.keepAudio) return;
    requestWakeLock();
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: roomName, artist: 'THE GODS COMMS' });
        navigator.mediaSession.playbackState = 'playing';
        try { navigator.mediaSession.setActionHandler('togglemicrophone', toggleMic); } catch { /* ação não suportada */ }
        try { navigator.mediaSession.setActionHandler('hangup', () => leaveVoice()); } catch { /* ação não suportada */ }
      }
    } catch { /* sem media session */ }
  }
  function disableBackgroundKeepAlive() {
    try { voice.wakeLock?.release(); } catch { /* ok */ } voice.wakeLock = null;
    try { if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch { /* ok */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });
  window.addEventListener('beforeunload', (e) => { if (voice.room) { e.preventDefault(); e.returnValue = ''; } });

  /* ===== inicialização ===== */
  if (!configured) {
    $('#config-warning').hidden = false;
  } else {
    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    // Não chame outras APIs do Supabase de dentro deste callback: use setTimeout para evitar deadlock.
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setTimeout(resetApp, 0);
      else if (event === 'PASSWORD_RECOVERY') setTimeout(() => $('#recovery-dialog').showModal(), 0);
      else if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) { user = session.user; setTimeout(enterApp, 0); }
      else if (event === 'TOKEN_REFRESHED' && session) user = session.user;
    });
  }
})();
