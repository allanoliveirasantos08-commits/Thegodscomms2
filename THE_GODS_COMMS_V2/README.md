# THE GODS COMMS V2

Plataforma da equipe The Gods Gaming com Supabase (login, perfis, canais, chat em tempo real e presença) e LiveKit (salas de voz e compartilhamento de tela). A identidade visual e a logo original foram preservadas.

## Recursos desta versão

- Login, cadastro e recuperação de senha via Supabase Auth.
- Canais de texto e voz separados, criação de canais e perfis.
- Chat de texto em tempo real via Supabase Realtime.
- Presença online dos membros.
- Entrada e saída de salas de voz usando LiveKit/WebRTC.
- Ligar/desligar microfone com cancelamento de eco, supressão de ruído e controle automático de ganho quando suportados pelo navegador.
- Compartilhamento de tela com captura até 1920x1080 a 30 FPS, conforme suporte do navegador e capacidade da conexão.
- Indicador de participantes e atividade de fala.
- Controle de volume individual dos participantes remotos.
- Seleção de microfone e saída de áudio quando suportada pelo navegador/dispositivo.
- Opção para manter a conexão ao alternar de canal/aba. O navegador ou o sistema operacional ainda pode suspender áudio em segundo plano; fechar o navegador encerra a chamada.
- Interface responsiva com identidade The Gods em azul-marinho e azul elétrico.

## Configuração já existente

O `config.js` mantém a URL e a chave publicável do Supabase. A chave publicável pode ficar no navegador com RLS habilitado. Nunca coloque `service_role`, `sb_secret_` ou o segredo LiveKit no frontend.

O banco Supabase já existente deve ser mantido. Não é necessário apagar tabelas nem executar novamente SQL destrutivo para habilitar a voz. O arquivo `sql/schema.sql` é mantido como referência de estrutura.

## Configurar os segredos do Worker no Cloudflare

O `worker.js` expõe `POST /api/livekit/token`, valida o access token no Supabase e gera um token LiveKit curto. Configure no Worker de produção, em **Configurações > Variáveis e segredos**:

| Nome | Valor |
|---|---|
| `LIVEKIT_URL` | URL WebSocket do projeto LiveKit, começando com `wss://` |
| `LIVEKIT_API_KEY` | Identificador da chave API LiveKit |
| `LIVEKIT_API_SECRET` | Segredo correspondente. Salvar como **Secret** |
| `SUPABASE_URL` | `https://ejwwgpewmcayrwbbqvaf.supabase.co` |
| `SUPABASE_ANON_KEY` | A mesma chave publicável usada no `config.js` |

Não envie `LIVEKIT_API_SECRET` pelo chat, GitHub ou frontend.

## Deploy pelo GitHub conectado ao Cloudflare Workers

A raiz do projeto deve ser a pasta que contém este README, `wrangler.toml`, `worker.js`, `package.json`, `index.html`, `app.js`, `style.css`, `config.js` e `assets/`.

- Comando de build: `npm install`
- Comando de implantação: `npx wrangler deploy`
- Diretório raiz: a pasta `THE_GODS_COMMS_V2` que contém este README (no repositório atual, confira a pasta interna duplicada `THE_GODS_COMMS_V2/THE_GODS_COMMS_V2`).

O `wrangler.toml` configura o Worker para servir os arquivos estáticos e encaminhar `/api/*` ao backend. Depois do deploy, teste `https://SEU-WORKER.workers.dev/api/health`, que deve retornar `{"ok":true,"service":"the-gods-comms-api"}`.

## Teste de voz

1. Entre na plataforma com uma conta já cadastrada.
2. Abra um canal de voz e clique em **Entrar na sala**.
3. Permita o acesso ao microfone quando solicitado.
4. Ligue o microfone e teste com outra conta em outro navegador/dispositivo.
5. Teste o compartilhamento de tela e os controles de volume individual.

Se a interface mostrar “Backend ainda não configurado”, confira os cinco bindings/segredos do Worker. Se a chamada conectar mas não houver áudio, confira permissões do navegador, dispositivos selecionados, firewall e disponibilidade do projeto LiveKit.

## Limitações importantes

- A qualidade real depende da rede, do navegador, dos dispositivos e do plano/limites do servidor LiveKit. O sistema adapta mídia via WebRTC, mas não pode garantir 4K de transmissão; a interface é preparada para telas de alta resolução e o compartilhamento está limitado a até Full HD/30 FPS nesta configuração.
- Reprodução com a aba em segundo plano é solicitada mantendo a conexão ativa, mas nenhum site consegue impedir que o navegador, o celular ou o sistema operacional suspenda a reprodução. Fechar a aba/navegador encerra a chamada.
- Antes de abrir a plataforma publicamente, revise as políticas RLS e as permissões de criação/entrada de canais para o modelo de comunidade desejado.
