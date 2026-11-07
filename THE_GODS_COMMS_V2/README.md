# THE GODS COMMS V2

Nova interface da plataforma The Gods, com identidade preta, azul-marinho e azul elétrico. A logo original enviada pelo usuário foi mantida sem edição em `assets/the-gods-logo.png`.

## O que esta versão entrega

- Login, cadastro e recuperação de senha pelo Supabase Auth.
- Perfis com nome de exibição, criados automaticamente no cadastro.
- Canais de texto e salas de voz listados separadamente.
- Chat em tempo real com autor correto, avatar por iniciais, horário e histórico.
- Presença online via Supabase Realtime Presence.
- Criação de canais e edição do nome de perfil.
- Interface responsiva com navegação lateral inspirada em apps de comunidade.
- SQL de atualização que preserva canais e mensagens existentes.

## 1. Configurar chave do Supabase

Abra `config.js` e substitua `COLE_AQUI_SUA_CHAVE_PUBLICAVEL_COMPLETA` pela chave **publicável** do seu projeto Supabase (`sb_publishable_...`). A URL do projeto já está preenchida. Nunca coloque `sb_secret_` ou `service_role` no navegador.

## 2. Atualizar o banco

1. Entre no painel do Supabase do projeto The Gods Comms.
2. Abra **SQL Editor** > **New query**.
3. Abra `sql/schema.sql`, copie todo o conteúdo e cole no editor.
4. Clique em **Run**.

O script é idempotente e foi escrito para atualizar a estrutura inicial sem apagar mensagens ou canais. Ele cria/preenche perfis, adiciona o gatilho de novos cadastros e recria as políticas RLS necessárias.

Se o Supabase informar que a tabela `messages` já está na publicação Realtime, isso é esperado.

## 3. Publicar no Cloudflare Pages

1. Extraia o ZIP.
2. Edite `config.js` e salve a chave publicável.
3. Envie o conteúdo da pasta `THE_GODS_COMMS_V2` para o projeto Pages, mantendo `index.html`, `style.css`, `config.js`, `app.js` e a pasta `assets` na raiz.
4. Abra o endereço publicado e teste com duas contas diferentes, preferencialmente em navegadores ou janelas separadas.

## 4. Teste de identidade das mensagens

O envio consulta a sessão autenticada atual com `auth.getUser()` e grava o `user_id` retornado pelo Supabase. O nome do autor vem da tabela `profiles`, relacionada ao `user_id` da mensagem. O rótulo **Você** é exibido somente quando o `user_id` da mensagem corresponde ao ID da sessão atual. Isso evita tratar todos os autores como o usuário local.

## 5. Limites desta entrega

As salas de voz já aparecem na interface, mas áudio real, chamadas em grupo, compartilhamento de tela e redução de ruído ainda não estão conectados. Para isso, a próxima etapa deve integrar um servidor de mídia (recomendado: LiveKit) com URL e emissão segura de tokens. Não é correto prometer voz estável usando apenas a interface atual.

Anexos, cargos/permissões, convites e moderação também ficam para etapas seguintes.
