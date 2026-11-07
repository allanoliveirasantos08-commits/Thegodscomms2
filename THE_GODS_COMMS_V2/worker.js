import { AccessToken } from "livekit-server-sdk";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const REQUIRED_ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
const ROOM_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

// Consulta o PostgREST do Supabase usando o token do próprio usuário (RLS continua valendo).
const supabaseRest = (env, path, accessToken) =>
  fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "the-gods-comms-api" });
    }
    if (url.pathname !== "/api/livekit/token") {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

    try {
      const authHeader = request.headers.get("Authorization") || "";
      const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!accessToken) return json({ error: "Faça login para entrar na sala." }, 401);

      const missing = REQUIRED_ENV.filter((key) => !env[key]);
      if (missing.length) return json({ error: "Backend ainda não configurado.", missing }, 503);

      // 1) Valida a sessão no Supabase. Nunca confiamos em IDs enviados pelo navegador.
      const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      });
      if (!userResponse.ok) return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401);
      const authUser = await userResponse.json();

      // 2) Valida o nome da sala.
      const body = await request.json().catch(() => ({}));
      const room = typeof body.room === "string" ? body.room.trim() : "";
      if (!ROOM_PATTERN.test(room)) return json({ error: "Sala inválida." }, 400);

      // 3) A sala precisa ser um canal de VOZ real que este usuário consegue ver.
      const channelResponse = await supabaseRest(
        env,
        `channels?select=id,type&id=eq.${encodeURIComponent(room)}&limit=1`,
        accessToken,
      );
      if (channelResponse.status === 400) return json({ error: "Sala de voz não encontrada." }, 404);
      if (!channelResponse.ok) return json({ error: "Não foi possível validar a sala de voz." }, 502);
      const [channel] = await channelResponse.json();
      if (!channel || channel.type !== "voice") return json({ error: "Sala de voz não encontrada." }, 404);

      // 4) Nome de exibição vem do perfil (mesmo nome que aparece no chat).
      let displayName = authUser.user_metadata?.display_name || authUser.email?.split("@")[0] || "Membro The Gods";
      try {
        const profileResponse = await supabaseRest(
          env,
          `profiles?select=display_name&id=eq.${encodeURIComponent(authUser.id)}&limit=1`,
          accessToken,
        );
        if (profileResponse.ok) {
          const [profile] = await profileResponse.json();
          if (profile?.display_name) displayName = profile.display_name;
        }
      } catch {
        /* usa o nome de fallback */
      }

      const participant = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: authUser.id,
        name: displayName,
        ttl: "10m",
      });
      participant.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      });

      return json({ token: await participant.toJwt(), serverUrl: env.LIVEKIT_URL, room });
    } catch (error) {
      return json({ error: "Não foi possível gerar o token da sala.", detail: error?.message || "Erro interno." }, 500);
    }
  },
};
