(() => {
  const $ = (s) => document.querySelector(s);
  const toast = (msg) => { const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.classList.remove("show"),3000); };
  const configured = window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_URL.includes("COLE_AQUI") && !window.SUPABASE_ANON_KEY.includes("COLE_AQUI");
  let supabase = null, currentChannel = null, messageSubscription = null, mode = "login", user = null;

  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
    $("#auth-submit").textContent = mode === "login" ? "Entrar na plataforma ↗" : "Criar minha conta ↗";
    $("#auth-note").textContent = mode === "login" ? "Use sua conta para acessar a comunidade." : "Após o cadastro, confirme seu e-mail se solicitado.";
  }));
  $("#auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!configured) return toast("Configure config.js com os dados do Supabase primeiro.");
    const email=$("#email").value.trim(), password=$("#password").value;
    $("#auth-submit").disabled=true;
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({email,password})
        : await supabase.auth.signUp({email,password});
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) toast("Conta criada! Confira seu e-mail para confirmar o cadastro.");
      else { user=result.data.user; await showApp(); }
    } catch(err) { toast(err.message || "Não foi possível autenticar."); }
    finally { $("#auth-submit").disabled=false; }
  });

  async function showApp() {
    $("#auth-view").hidden=true; $("#app-view").hidden=false;
    $("#user-email").textContent=user?.email || "";
    await loadChannels();
  }
  async function loadChannels() {
    const {data,error}=await supabase.from("channels").select("id,name,type").order("created_at");
    if(error){ $("#channels").innerHTML='<p class="muted">Não foi possível carregar canais. Confira o SQL e as políticas RLS no README.</p>'; return; }
    $("#channels").replaceChildren();
    if(!data.length) $("#channels").innerHTML='<p class="muted">Nenhum canal ainda. Crie o primeiro espaço da equipe.</p>';
    data.forEach(ch=>{
      const b=document.createElement("button"); b.className="channel";
      const icon=document.createElement("span"); icon.className="channel-icon"; icon.textContent=ch.type==="voice"?"♫":"#";
      const label=document.createElement("span"); label.className="channel-label";
      const strong=document.createElement("b"); strong.textContent=ch.name;
      const small=document.createElement("small"); small.textContent=ch.type==="voice"?"Sala de voz":"Canal de texto";
      label.append(strong,small); b.append(icon,label); b.addEventListener("click",()=>openChannel(ch)); $("#channels").append(b);
    });
  }
  async function openChannel(ch) {
    currentChannel=ch; $("#chat-title").textContent=(ch.type==="voice"?"♫ ":"# ")+ch.name;
    const textChannel=ch.type==="text";
    $("#message-input").disabled=!textChannel; $("#send-btn").disabled=!textChannel;
    $("#message-input").placeholder=textChannel?"Escreva uma mensagem...":"Canal de voz: integração WebRTC será adicionada na próxima etapa.";
    $("#messages").innerHTML=textChannel?'<div class="empty">Carregando mensagens...</div>':'<div class="empty">Este canal está criado. Voz e compartilhamento de tela ainda serão integrados.</div>';
    if(messageSubscription){await supabase.removeChannel(messageSubscription);messageSubscription=null;}
    if(!textChannel)return;
    const {data,error}=await supabase.from("messages").select("id,content,user_id,created_at").eq("channel_id",ch.id).order("created_at").limit(100);
    if(error){$("#messages").innerHTML='<div class="empty">Erro ao carregar mensagens. Verifique a tabela messages e as políticas RLS.</div>';return;}
    renderMessages(data||[]);
    messageSubscription=supabase.channel("messages-"+ch.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"channel_id=eq."+ch.id},payload=>appendMessage(payload.new))
      .subscribe();
  }
  function renderMessages(rows){$("#messages").replaceChildren(); if(!rows.length){$("#messages").innerHTML='<div class="empty">Ainda não há mensagens. Comece a conversa!</div>';return;} rows.forEach(appendMessage);}
  function appendMessage(m){
    const empty=$("#messages .empty"); if(empty)empty.remove();
    const item=document.createElement("article"); item.className="message";
    const author=document.createElement("b"); author.textContent=m.user_id===user.id?"Você":"Membro";
    const body=document.createElement("p"); body.textContent=m.content;
    const time=document.createElement("small"); time.textContent=new Date(m.created_at).toLocaleString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    item.append(author,time,body); $("#messages").append(item); $("#messages").scrollTop=$("#messages").scrollHeight;
  }
  $("#message-form").addEventListener("submit",async e=>{
    e.preventDefault(); const content=$("#message-input").value.trim();
    if(!content||!currentChannel||currentChannel.type!=="text")return;
    $("#send-btn").disabled=true;
    const {error}=await supabase.from("messages").insert({channel_id:currentChannel.id,user_id:user.id,content});
    $("#send-btn").disabled=false;
    if(error)toast(error.message); else $("#message-input").value="";
  });
  $("#new-channel").addEventListener("click",()=>$("#channel-dialog").showModal());
  $("#close-dialog").addEventListener("click",()=>$("#channel-dialog").close());
  $("#channel-form").addEventListener("submit",async e=>{
    e.preventDefault(); const name=$("#channel-name").value.trim().toLowerCase().replace(/\s+/g,"-"), type=$("#channel-type").value;
    if(!name)return;
    const {error}=await supabase.from("channels").insert({name,type,created_by:user.id});
    if(error)toast("Não foi possível criar: "+error.message);
    else {$("#channel-dialog").close();$("#channel-form").reset();toast("Canal criado.");await loadChannels();}
  });
  async function logout(){if(supabase)await supabase.auth.signOut();user=null;currentChannel=null;$("#app-view").hidden=true;$("#auth-view").hidden=false;}
  $("#logout").addEventListener("click",logout);$("#logout-top").addEventListener("click",logout);

  if(!configured){$("#config-warning").hidden=false;$("#auth-submit").addEventListener("click",()=>toast("Configure primeiro o arquivo config.js."));}
  else {
    supabase=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
    supabase.auth.getSession().then(async({data})=>{if(data.session){user=data.session.user;await showApp();}});
    supabase.auth.onAuthStateChange(async(_event,session)=>{if(session){user=session.user; if($("#app-view").hidden)await showApp();}});
  }
})();