(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const toast = (message) => {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(window.__tgToastTimer); window.__tgToastTimer = setTimeout(() => node.classList.remove('show'), 3200);
  };
  const configured = Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_ANON_KEY.includes('COLE_AQUI') && !window.SUPABASE_URL.includes('COLE_AQUI'));
  let db = null, user = null, profile = null, currentChannel = null;
  let messagesChannel = null, presenceChannel = null, authMode = 'login';
  let messageRows = new Map(), onlineUsers = new Map(), sending = false;

  const initials = (name = 'TG') => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'TG';
  const safeText = (value) => String(value ?? '');
  const setAuthMessage = (message) => { $('#auth-message').textContent = message; };
  const currentUser = async () => {
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    user = data.user;
    if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
    return user;
  };

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    $('#auth-submit').innerHTML = mode === 'login' ? 'Entrar na plataforma <span>↗</span>' : 'Criar minha conta <span>↗</span>';
    $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    setAuthMessage(mode === 'login' ? 'Use sua conta para acessar a comunidade.' : 'Crie sua conta com um e-mail válido.');
  }
  document.querySelectorAll('.auth-tab').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.mode)));

  async function ensureProfile(authUser) {
    const fallbackName = authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Guerreiro';
    const { data: existing, error: readError } = await db.from('profiles').select('id,display_name').eq('id', authUser.id).maybeSingle();
    if (readError) throw readError;
    if (existing) {
      profile = existing;
      if (!existing.display_name) {
        const { data, error } = await db.from('profiles').update({ display_name: fallbackName }).eq('id', authUser.id).select('id,display_name').single();
        if (!error && data) profile = data;
      }
    } else {
      const { data, error } = await db.from('profiles').upsert({ id: authUser.id, display_name: fallbackName }, { onConflict: 'id' }).select('id,display_name').single();
      if (error) throw error;
      profile = data;
    }
    updateMyIdentity();
  }
  function updateMyIdentity() {
    const name = profile?.display_name || user?.email?.split('@')[0] || 'Guerreiro';
    $('#my-name').textContent = name;
    $('#my-avatar').textContent = initials(name);
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
        user = result.data.user;
        await enterApp();
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

  async function enterApp() {
    await currentUser();
    await ensureProfile(user);
    $('#auth-view').hidden = true; $('#app-view').hidden = false;
    await Promise.all([loadChannels(), loadMembers(), startPresence()]);
  }

  async function loadChannels() {
    const { data, error } = await db.from('channels').select('id,name,type,created_at').order('created_at', { ascending: true });
    if (error) { toast('Não foi possível carregar os canais: ' + error.message); return; }
    const text = $('#text-channels'), voice = $('#voice-channels');
    text.replaceChildren(); voice.replaceChildren();
    const textRows = (data || []).filter(channel => channel.type === 'text');
    const voiceRows = (data || []).filter(channel => channel.type === 'voice');
    if (!textRows.length) text.innerHTML = '<div class="loading-line">Nenhum canal de texto ainda.</div>';
    if (!voiceRows.length) voice.innerHTML = '<div class="loading-line">Nenhuma sala de voz ainda.</div>';
    textRows.forEach(channel => text.append(createChannelButton(channel)));
    voiceRows.forEach(channel => voice.append(createChannelButton(channel)));
    if (currentChannel) {
      const refreshed = (data || []).find(channel => channel.id === currentChannel.id);
      if (refreshed) currentChannel = refreshed;
    }
  }

  function createChannelButton(channel) {
    const button = document.createElement('button');
    button.className = 'channel' + (currentChannel?.id === channel.id ? ' active' : '');
    button.dataset.channelId = channel.id;
    const symbol = document.createElement('span'); symbol.className = 'channel-symbol'; symbol.textContent = channel.type === 'voice' ? '♫' : '#';
    const name = document.createElement('span'); name.className = 'channel-name'; name.textContent = channel.name;
    button.append(symbol, name);
    button.addEventListener('click', () => { openChannel(channel); $('#channel-sidebar')?.classList.remove('mobile-open'); document.querySelector('.channel-sidebar').classList.remove('mobile-open'); });
    return button;
  }

  async function openChannel(channel) {
    currentChannel = channel;
    document.querySelectorAll('.channel').forEach(button => button.classList.toggle('active', button.dataset.channelId === channel.id));
    $('#welcome-state').hidden = true;
    $('#chat-title').textContent = channel.name;
    $('#chat-subtitle').textContent = channel.type === 'text' ? 'Canal de texto • mensagens em tempo real' : 'Sala de voz da equipe';
    $('#current-channel-icon').textContent = channel.type === 'text' ? '#' : '♫';
    $('#chat-view').hidden = channel.type !== 'text';
    $('#voice-view').hidden = channel.type !== 'voice';
    if (channel.type === 'voice') {
      $('#voice-title').textContent = channel.name;
      $('#message-input').disabled = true; $('#send-btn').disabled = true;
      await stopMessageSubscription();
      return;
    }
    $('#message-input').disabled = false; $('#send-btn').disabled = false;
    $('#message-input').placeholder = `Conversar em #${channel.name}`;
    $('#messages').innerHTML = '<div class="empty-state">Carregando mensagens...</div>';
    messageRows = new Map();
    await stopMessageSubscription();

    // Subscribe before fetching history so a message sent during the fetch is not lost.
    messagesChannel = db.channel('tg-messages-' + channel.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + channel.id }, async payload => {
        if (currentChannel?.id !== channel.id) return;
        await addMessageWithProfile(payload.new);
      })
      .subscribe(status => { if (status === 'CHANNEL_ERROR') toast('A conexão em tempo real falhou. Verifique o Realtime no Supabase.'); });

    // messages.user_id referencia auth.users, não profiles. Por isso buscamos
    // as mensagens e os perfis separadamente, sem depender de uma FK inexistente.
    const { data, error } = await db.from('messages')
      .select('id,content,user_id,created_at')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(150);
    if (error) {
      $('#messages').innerHTML = '<div class="empty-state">Não foi possível carregar o histórico. Confira as tabelas e as políticas RLS.</div>';
      toast('Erro ao carregar mensagens: ' + error.message); return;
    }
    const authorIds = [...new Set((data || []).map(message => message.user_id).filter(Boolean))];
    let profilesById = new Map();
    if (authorIds.length) {
      const { data: authors, error: authorsError } = await db.from('profiles')
        .select('id,display_name').in('id', authorIds);
      if (authorsError) toast('Mensagens carregadas, mas alguns nomes não puderam ser consultados.');
      else profilesById = new Map((authors || []).map(author => [author.id, author]));
    }
    (data || []).forEach(message => renderMessage({ ...message, profiles: profilesById.get(message.user_id) || null }));
    if (!messageRows.size) $('#messages').innerHTML = '<div class="empty-state">Este canal ainda está quieto. Que tal começar a conversa?</div>';
  }

  async function stopMessageSubscription() {
    if (messagesChannel) { const old = messagesChannel; messagesChannel = null; await db.removeChannel(old); }
  }

  async function addMessageWithProfile(message) {
    if (!message?.id || messageRows.has(message.id)) return;
    let enriched = message;
    const { data } = await db.from('profiles').select('display_name').eq('id', message.user_id).maybeSingle();
    enriched = { ...message, profiles: data || null };
    renderMessage(enriched);
  }

  function renderMessage(message) {
    if (!message?.id || messageRows.has(message.id)) return;
    const wasAtBottom = $('#messages').scrollHeight - $('#messages').scrollTop - $('#messages').clientHeight < 100;
    messageRows.set(message.id, message);
    const empty = $('#messages .empty-state'); if (empty) empty.remove();
    const authorName = message.profiles?.display_name || (message.user_id === user?.id ? profile?.display_name : 'Membro');
    const isMine = message.user_id === user?.id;
    const article = document.createElement('article'); article.className = 'message'; article.dataset.messageId = message.id;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = initials(authorName);
    const main = document.createElement('div'); main.className = 'message-main';
    const head = document.createElement('div'); head.className = 'message-head';
    const author = document.createElement('span'); author.className = 'message-author' + (isMine ? ' self' : ''); author.textContent = isMine ? 'Você' : authorName;
    const time = document.createElement('time'); time.className = 'message-time'; time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const content = document.createElement('p'); content.className = 'message-content'; content.textContent = safeText(message.content);
    head.append(author, time); main.append(head, content); article.append(avatar, main); $('#messages').append(article);
    if (wasAtBottom || isMine) $('#messages').scrollTop = $('#messages').scrollHeight;
  }

  $('#message-form').addEventListener('submit', async event => {
    event.preventDefault();
    const content = $('#message-input').value.trim();
    if (!content || !currentChannel || currentChannel.type !== 'text' || sending) return;
    sending = true; $('#send-btn').disabled = true;
    try {
      const activeUser = await currentUser();
      const { data, error } = await db.from('messages').insert({ channel_id: currentChannel.id, user_id: activeUser.id, content }).select('id,content,user_id,created_at').single();
      if (error) throw error;
      $('#message-input').value = '';
      // Fallback in case Realtime is not enabled for this project/table.
      if (data && !messageRows.has(data.id)) await addMessageWithProfile(data);
    } catch (error) { toast('Não foi possível enviar: ' + error.message); }
    finally { sending = false; $('#send-btn').disabled = !currentChannel || currentChannel.type !== 'text'; $('#message-input').focus(); }
  });

  async function loadMembers() {
    const { data, error } = await db.from('profiles').select('id,display_name').order('display_name');
    if (error) { $('#all-members').innerHTML = '<div class="loading-line">Lista de membros indisponível.</div>'; return; }
    const list = $('#all-members'); list.replaceChildren();
    (data || []).forEach(member => {
      const row = document.createElement('div'); row.className = 'member';
      const avatar = document.createElement('div'); avatar.className = 'member-avatar'; avatar.textContent = initials(member.display_name);
      const name = document.createElement('span'); name.className = 'member-name'; name.textContent = member.display_name || 'Guerreiro';
      row.append(avatar, name); list.append(row);
    });
    if (!data?.length) list.innerHTML = '<div class="loading-line">Os membros aparecerão aqui.</div>';
  }

  async function startPresence() {
    if (presenceChannel) await db.removeChannel(presenceChannel);
    onlineUsers = new Map();
    presenceChannel = db.channel('tg-community-presence', { config: { presence: { key: user.id } } });
    presenceChannel.on('presence', { event: 'sync' }, updatePresence);
    presenceChannel.on('presence', { event: 'join' }, updatePresence);
    presenceChannel.on('presence', { event: 'leave' }, updatePresence);
    const status = await presenceChannel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ user_id: user.id, display_name: profile?.display_name || 'Guerreiro', online_at: new Date().toISOString() });
      }
    });
  }
  function updatePresence() {
    if (!presenceChannel) return;
    const state = presenceChannel.presenceState(); onlineUsers = new Map();
    Object.entries(state).forEach(([key, entries]) => {
      const entry = entries?.[entries.length - 1]; if (entry) onlineUsers.set(key, entry);
    });
    const online = $('#online-members'); online.replaceChildren();
    onlineUsers.forEach((member, id) => {
      const nameText = member.display_name || (id === user?.id ? profile?.display_name : 'Guerreiro');
      const row = document.createElement('div'); row.className = 'member';
      const avatar = document.createElement('div'); avatar.className = 'member-avatar online'; avatar.textContent = initials(nameText);
      const name = document.createElement('span'); name.className = 'member-name'; name.textContent = nameText;
      const you = document.createElement('span'); you.className = 'member-you'; you.textContent = id === user?.id ? 'VOCÊ' : '';
      row.append(avatar, name, you); online.append(row);
    });
    if (!onlineUsers.size) online.innerHTML = '<div class="loading-line">Ninguém online no momento.</div>';
    $('#online-count').textContent = onlineUsers.size; $('#member-count').textContent = onlineUsers.size;
  }

  function openChannelDialog(type) {
    $('#channel-type').value = type; $('#channel-type').disabled = type !== 'text' && type !== 'voice';
    $('#channel-dialog').showModal(); $('#channel-name').focus();
  }
  $('#new-text-channel').addEventListener('click', () => openChannelDialog('text'));
  $('#new-voice-channel').addEventListener('click', () => openChannelDialog('voice'));
  $('#channel-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#channel-name').value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const type = $('#channel-type').value;
    if (!name) return toast('Digite um nome válido para o canal.');
    try {
      const activeUser = await currentUser();
      const { error } = await db.from('channels').insert({ name, type, created_by: activeUser.id });
      if (error) throw error;
      $('#channel-dialog').close(); $('#channel-form').reset(); toast('Canal criado com sucesso.'); await loadChannels();
    } catch (error) { toast('Não foi possível criar o canal: ' + error.message); }
  });
  $('#close-dialog').addEventListener('click', () => $('#channel-dialog').close());

  $('#profile-edit').addEventListener('click', () => { $('#display-name').value = profile?.display_name || ''; $('#profile-dialog').showModal(); });
  $('#close-profile').addEventListener('click', () => $('#profile-dialog').close());
  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault(); const display_name = $('#display-name').value.trim();
    if (display_name.length < 2) return toast('Use pelo menos 2 caracteres.');
    try {
      const activeUser = await currentUser();
      const { data, error } = await db.from('profiles').upsert({ id: activeUser.id, display_name }, { onConflict: 'id' }).select('id,display_name').single();
      if (error) throw error;
      profile = data; updateMyIdentity(); $('#profile-dialog').close(); await loadMembers(); await startPresence(); toast('Perfil atualizado.');
    } catch (error) { toast('Não foi possível salvar: ' + error.message); }
  });

  async function logout() {
    try {
      await stopMessageSubscription();
      if (presenceChannel) { await db.removeChannel(presenceChannel); presenceChannel = null; }
      await db.auth.signOut();
    } finally {
      user = null; profile = null; currentChannel = null; $('#app-view').hidden = true; $('#auth-view').hidden = false;
      $('#password').value = ''; setAuthMode('login');
    }
  }
  $('#logout-rail').addEventListener('click', logout); $('#logout-side').addEventListener('click', logout);
  $('#mobile-menu').addEventListener('click', () => document.querySelector('.channel-sidebar').classList.toggle('mobile-open'));
  $('#composer-plus').addEventListener('click', () => toast('Anexos serão adicionados em uma próxima atualização.'));
  $('#team-menu').addEventListener('click', () => toast('THE GODS GAMING • Central oficial da equipe.'));

  if (!configured) {
    $('#config-warning').hidden = false;
    $('#auth-submit').addEventListener('click', () => toast('Configure primeiro a chave publicável em config.js.'));
  } else {
    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    db.auth.getSession().then(async ({ data, error }) => {
      if (error) return toast(error.message);
      if (data.session) { user = data.session.user; try { await enterApp(); } catch (e) { toast('Erro ao abrir a comunidade: ' + e.message); } }
    });
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { user = null; profile = null; $('#app-view').hidden = true; $('#auth-view').hidden = false; }
      if (event === 'TOKEN_REFRESHED' && session) user = session.user;
    });
  }
})();
