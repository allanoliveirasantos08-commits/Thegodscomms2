import { AccessToken } from 'livekit-server-sdk';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin');
  const ownOrigin = new URL(request.url).origin;
  const allowedOrigin = requestOrigin && (requestOrigin === ownOrigin || requestOrigin === env.APP_ORIGIN)
    ? requestOrigin : '';
  return allowedOrigin ? {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, service: 'the-gods-comms-api', livekitConfigured: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) }, 200, cors);
    }
    if (url.pathname !== '/api/livekit/token') return json({ error: 'Rota não encontrada.' }, 404, cors);
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, cors);

    try {
      const authHeader = request.headers.get('Authorization') || '';
      const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!accessToken) return json({ error: 'Faça login para entrar na sala.' }, 401, cors);

      const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
      const missing = required.filter((key) => !env[key]);
      if (missing.length) return json({ error: 'Backend ainda não configurado. Confira os segredos do Worker.', missing }, 503, cors);

      const userResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      });
      if (!userResponse.ok) return json({ error: 'Sessão inválida ou expirada. Entre novamente.' }, 401, cors);
      const authUser = await userResponse.json();

      const body = await request.json().catch(() => ({}));
      const room = typeof body.room === 'string' ? body.room.trim() : '';
      if (!room || room.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(room)) {
        return json({ error: 'Sala inválida.' }, 400, cors);
      }

      let displayName = authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Membro The Gods';
      const profileResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=display_name`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      });
      if (profileResponse.ok) {
        const profiles = await profileResponse.json();
        if (profiles[0]?.display_name) displayName = profiles[0].display_name;
      }

      const participant = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: authUser.id,
        name: String(displayName).slice(0, 64),
        ttl: '10m',
      });
      participant.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
      return json({ token: await participant.toJwt(), serverUrl: env.LIVEKIT_URL, room }, 200, cors);
    } catch (error) {
      return json({ error: 'Não foi possível gerar o token da sala.', detail: error?.message || 'Erro interno.' }, 500, cors);
    }
  },
};
