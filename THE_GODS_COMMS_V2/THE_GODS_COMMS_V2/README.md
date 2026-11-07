# THE GODS COMMS V2

Aplicação de comunicação da equipe The Gods Gaming. O pacote preserva o projeto Supabase existente e adiciona a integração real do cliente LiveKit no navegador e a emissão segura de tokens no Cloudflare Worker.

## Recursos implementados no código

- Login, cadastro e recuperação de senha via Supabase Auth.
- Perfis, canais de texto/voz e mensagens em tempo real via Supabase.
- Presença online.
- Salas de voz em grupo via LiveKit: entrar/sair, ligar/desligar microfone, cancelamento de eco, supressão de ruído e ganho automático.
- Compartilhamento de tela com alvo de 1920x1080 a 30 FPS (o navegador pode limitar a captura conforme sistema/dispositivo).
- Lista de participantes e indicador de quem está falando.
- Controle de volume por participante e seleção de microfone/saída de áudio quando suportada pelo navegador.
- Manter a conexão ao alternar de aba. Navegadores e sistemas operacionais podem suspender a reprodução; fechar a aba encerra a chamada.
- Worker valida a sessão no Supabase antes de emitir token LiveKit curto. Segredo LiveKit fica apenas no ambiente do Worker.
- Interface responsiva com identidade visual The Gods e logo original.

## Arquitetura

- Frontend: `public/` (HTML, CSS, JavaScript).
- Autenticação, perfis, canais, chat e presença: Supabase.
- Voz e compartilhamento: LiveKit Cloud ou servidor LiveKit próprio.
- API segura: Cloudflare Worker em `src/worker.js`.
- `schema.sql` é uma atualização idempotente do banco existente. Não apaga mensagens/canais.

## 1. Configuração do LiveKit (obrigatória para voz real)

Crie um projeto no LiveKit Cloud e copie a URL WebSocket (`wss://...`), API Key e API Secret. No Cloudflare Dashboard, abra o Worker `thegodscomms2` > **Settings / Configurações** > **Variables and Secrets / Variáveis e segredos** e adicione:

| Nome | Tipo | Valor |
|---|---|---|
| `LIVEKIT_URL` | Text | URL `wss://...` do LiveKit |
| `LIVEKIT_API_KEY` | Secret ou Text | API Key LiveKit |
| `LIVEKIT_API_SECRET` | **Secret** | API Secret LiveKit |
| `SUPABASE_URL` | Text | `https://ejwwgpewmcayrwbbqvaf.supabase.co` |
| `SUPABASE_ANON_KEY` | Secret ou Text | A chave publicável `sb_publishable_...` do Supabase |
| `APP_ORIGIN` | Text | `https://thegodscomms2.pages.dev` (já definido em `wrangler.toml`) |

Nunca coloque `LIVEKIT_API_SECRET`, `service_role` ou `sb_secret_` em `public/config.js`.

## 2. Publicar pelo GitHub + Cloudflare Workers

O Worker deve ser implantado com Wrangler, não pelo botão de upload estático do Pages.

1. Envie o conteúdo desta pasta para a raiz `THE_GODS_COMMS_V2` do repositório GitHub `Thegodscomms2`, preservando a estrutura `public/`, `src/`, `package.json` e `wrangler.toml`.
2. No terminal local, entre na pasta `THE_GODS_COMMS_V2`.
3. Execute `npm install`.
4. Faça login uma vez com `npx wrangler login`.
5. Execute `npx wrangler deploy`.
6. No Cloudflare, confirme que os cinco valores de ambiente/secrets acima estão configurados no Worker de produção. Se adicioná-los depois do deploy, salve e faça novo deploy.

A configuração `wrangler.toml` publica o frontend em `public/` e encaminha `/api/*` ao Worker.

## 3. Endereços usados pelo frontend

O `public/config.js` está configurado para chamar o Worker em `https://thegodscomms2.thegodscomms.workers.dev` e o frontend atualmente pode continuar no Pages (`https://thegodscomms2.pages.dev`). Se o endereço do Worker na sua conta for diferente, altere apenas `window.TG_API_BASE_URL` em `public/config.js` para o domínio `workers.dev` real. O Worker permite o domínio Pages configurado em `APP_ORIGIN`.

Se optar por servir o frontend pelo próprio Worker, defina `window.TG_API_BASE_URL = ""` e acesse o domínio `workers.dev` do Worker.

## 4. Supabase

O `schema.sql` atualiza perfis, canais, mensagens, políticas RLS e publicação Realtime. Como o banco já foi criado e contém dados, **não execute alterações destrutivas**. O script não contém `DROP TABLE` nem apaga linhas; ele recria apenas as políticas nomeadas e o trigger de criação de perfil. Antes de executar, confira o SQL e faça backup se houver dados importantes.

A chave no `public/config.js` é a chave publicável já usada no projeto. Ela pode estar no navegador; as políticas RLS são a barreira de segurança.

## 5. Testes executados e testes de produção

Teste local de sintaxe:

```bash
npm run check
```

Verificação da API após deploy:

- Abra `https://SEU-WORKER.workers.dev/api/health`.
- Deve retornar JSON com `ok: true` e `livekitConfigured: true`.
- Entre no site com uma conta Supabase, abra um canal de voz e clique em **Entrar na sala**.
- Permita o microfone, teste com duas contas/dispositivos, teste volume individual e compartilhamento.

A conexão real de áudio não pode ser validada neste ambiente de desenvolvimento porque exige credenciais LiveKit da sua conta, permissões de microfone/tela e pelo menos dois clientes conectados. O código e a compilação podem ser testados aqui; o funcionamento em produção depende de configurar essas credenciais.

## 6. Limitações importantes

- 1080p/30 FPS é a solicitação inicial de captura; a resolução efetiva depende do navegador, do sistema e da conexão. 4K/60 FPS não é garantido.
- O áudio em segundo plano depende do navegador e do sistema. Alternar de aba não desconecta a sala, mas fechar a aba encerra a chamada.
- A seleção de saída de áudio depende de suporte a `HTMLMediaElement.setSinkId` (normalmente Chromium em desktop).
- O navegador solicita permissão de tela/microfone por segurança; não é possível iniciar captura silenciosamente.
