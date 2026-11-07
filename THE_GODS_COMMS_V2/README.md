# THE GODS COMMS V3

Plataforma da The Gods Gaming: login (Supabase Auth), canais de texto com chat em tempo real, presença online e salas de voz com LiveKit (microfone, volume individual, escolha de dispositivos e compartilhamento de tela Full HD).

## O que mudou nesta versão

**Visual**
- Interface nova em azul-marinho e azul elétrico, pensada para telas HD/Full HD e responsiva (celular, tablet, desktop).
- Fontes Unbounded (títulos) e Manrope (interface); ícones em SVG.

**Voz**
- Entrar/sair da sala, ligar/desligar microfone e **ensurdecer** (atalhos `M` e `D`).
- Anel de fala animado que reage ao volume de cada participante e indicador de qualidade da conexão.
- Volume individual por participante, **lembrado entre sessões**.
- Seleção de microfone e saída de áudio (a saída depende do navegador; Chrome/Edge suportam), com suprimir ruído, eco e ganho automático ajustáveis ao vivo.
- Compartilhamento de tela até 1920x1080 a 30 FPS com áudio, exibido num palco grande; vários compartilhamentos viram abas.
- Painel de voz no menu lateral: continua visível ao trocar de canal, com mudo, ensurdecer e sair.
- Quem está em cada sala de voz aparece no menu lateral, mesmo para quem ainda não entrou.
- Sons de entrada/saída, reconexão automática com aviso, aviso quando o navegador bloqueia o áudio.

**Chat**
- Mensagens agrupadas por autor, separadores por dia, links clicáveis, Shift+Enter para quebra de linha, emojis.
- Aviso "fulano está digitando", contador de não lidas por canal (também no título da aba).
- Uma única conexão Realtime para todos os canais; recupera mensagens perdidas após queda.

**Correções**
- O arraste do volume não é mais interrompido (antes a lista era recriada a cada mudança de fala).
- O LiveKit agora carrega por script UMD fixado em versão (antes dependia do esm.sh e podia não estar pronto).
- O Worker valida que a sala é um **canal de voz real** e usa o nome do perfil.
- Recuperação de senha agora tem tela para definir a nova senha.
- `wrangler.toml`: `compatibility_date` fixada em data estável e `.assetsignore` impede publicar `worker.js`, `package.json` e `node_modules` como arquivos estáticos.

## Arquivos

Substitua no repositório: `index.html`, `style.css`, `app.js`, `worker.js`, `wrangler.toml`, `package.json`, `README.md` e adicione `.assetsignore`.
Mantenha como está: `config.js`, a pasta `assets/` (com `the-gods-logo.png`) e `sql/`. Se a logo não for encontrada, a interface usa um brasão de reserva.

## Segredos do Worker (Cloudflare > Configurações > Variáveis e segredos)

| Nome | Valor |
|---|---|
| `LIVEKIT_URL` | URL `wss://...` do projeto LiveKit |
| `LIVEKIT_API_KEY` | Chave API do LiveKit |
| `LIVEKIT_API_SECRET` | Segredo (salvar como **Secret**) |
| `SUPABASE_URL` | `https://ejwwgpewmcayrwbbqvaf.supabase.co` |
| `SUPABASE_ANON_KEY` | A mesma chave publicável do `config.js` |

Nunca coloque `LIVEKIT_API_SECRET`, `service_role` ou `sb_secret_` no frontend ou no GitHub.

## Deploy

- Comando de build: `npm install`
- Comando de implantação: `npx wrangler deploy`
- Diretório raiz: a pasta que contém `wrangler.toml` e `worker.js`.

Depois do deploy, abra `https://SEU-WORKER.workers.dev/api/health`. Deve responder `{"ok":true,"service":"the-gods-comms-api"}`.

## Supabase: conferir

O chat em tempo real exige a tabela `messages` na publicação do Realtime. Se as mensagens só aparecem após enviar, rode uma vez (não apaga nada):

```sql
alter publication supabase_realtime add table public.messages;
```

A presença e o aviso de digitação usam canais do Realtime e não precisam de tabelas.

## Teste de voz

1. Entre com duas contas em navegadores/dispositivos diferentes.
2. Abra uma sala de voz e clique em **Entrar na sala** (permita o microfone).
3. Fale: o anel verde deve acender no seu cartão e no da outra conta.
4. Teste ensurdecer, volume individual e **Tela**.

Mensagens de erro e o que fazer:
- "Backend ainda não configurado. Faltam: ..." — configure os segredos listados.
- "A API de voz não respondeu" — o Worker não foi publicado ou a rota `/api` não chega nele.
- Conecta mas sem áudio — permissões do navegador, dispositivo de saída, firewall ou limites do projeto LiveKit.

## Limitações

- A qualidade real depende de rede, navegador, dispositivo e plano do LiveKit. O compartilhamento é limitado a Full HD/30 FPS; não há garantia de 4K.
- Nenhum site consegue impedir que o navegador ou o celular pause o áudio em segundo plano. A opção "Manter áudio ativo" usa Wake Lock e Media Session como melhor esforço. Fechar a aba encerra a chamada.
- Compartilhar tela não existe na maioria dos navegadores de celular.
- Antes de abrir a plataforma ao público, revise as políticas RLS e quem pode criar canais.
