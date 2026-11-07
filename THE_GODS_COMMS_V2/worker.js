import { AccessToken } from "livekit-server-sdk";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
      const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!accessToken) return json({ error: "Faça login para entrar na sala." }, 401);

      const required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
      const missing = required.filter((key) => !env[key]);
      if (missing.length) return json({ error: "Backend ainda não configurado.", missing }, 503);

      // Valida a sessão no próprio Supabase. Não confiamos em IDs enviados pelo navegador.
      const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      });
      if (!userResponse.ok) return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401);
      const authUser = await userResponse.json();

      const body = await request.json().catch(() => ({}));
      const room = typeof body.room === "string" ? body.room.trim() : "";
      if (!room || room.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(room)) {
        return json({ error: "Sala inválida." }, 400);
      }

      const participant = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: authUser.id,
        name: authUser.user_metadata?.display_name || authUser.email || "Membro The Gods",
        ttl: "10m",
      });
      participant.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      return json({ token: await participant.toJwt(), serverUrl: env.LIVEKIT_URL, room });
    } catch (error) {
      return json({ error: "Não foi possível gerar o token da sala.", detail: error?.message || "Erro interno." }, 500);
    }
  },
};
