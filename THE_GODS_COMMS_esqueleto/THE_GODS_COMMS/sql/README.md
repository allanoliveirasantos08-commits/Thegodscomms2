# THE GODS COMMS | MVP inicial

Pacote inicial para rodar localmente e publicar no Cloudflare Pages, com Supabase Auth, canais e chat de texto em tempo real.

## 1. Configurar o Supabase

A URL do projeto já está configurada em `config.js`:

`https://ejwwgpewmcayrwbbqvaf.supabase.co`

1. Abra `config.js` em um editor de texto.
2. Na linha `window.SUPABASE_ANON_KEY`, substitua `COLE_AQUI_SUA_CHAVE_PUBLICAVEL_COMPLETA` pela chave inteira copiada da seção **Chave publicável** do Supabase (começa com `sb_publishable_`).
3. Salve o arquivo.
4. Nunca use `sb_secret_` ou `service_role` no navegador.

Não é necessário enviar a chave no chat. Faça essa configuração localmente.

## 2. Criar as tabelas

1. No painel Supabase, abra **SQL Editor** e clique em **New query**.
2. Abra `sql/schema.sql` deste pacote, copie todo o conteúdo e cole no editor.
3. Clique em **Run**. O script cria as tabelas básicas, políticas RLS e canais iniciais.

Este SQL é um ponto de partida de desenvolvimento. Antes de abrir para várias equipes, vamos implementar comunidades, associação de membros, cargos e permissões por comunidade.

## 3. Testar localmente

Sirva a pasta por um servidor local simples (por exemplo, a extensão Live Server do VS Code) e abra o endereço local. No Supabase, mantenha o provedor **Email** habilitado em **Authentication > Providers**. Se a confirmação de e-mail estiver ativa, o cadastro pedirá confirmação antes do primeiro login.

## 4. Publicar no Cloudflare Pages

1. Extraia o ZIP.
2. No Cloudflare, entre em **Workers & Pages** e crie um projeto **Pages**.
3. Escolha **Direct Upload** e envie os arquivos extraídos, mantendo `index.html`, `style.css`, `config.js` e `app.js` na raiz.
4. Publique e teste a URL gerada.

## 5. O que esta versão inclui

- Interface responsiva para computador e celular.
- Cadastro e login por e-mail e senha.
- Criação e listagem de canais.
- Envio e recebimento de mensagens em tempo real, depois de executar o SQL e habilitar Realtime para `messages` caso necessário.

## 6. O que ainda não está implementado

- Comunidades múltiplas, membros, cargos e permissões detalhadas.
- Áudio real, chamadas em grupo, compartilhamento de tela e WebRTC.
- Moderação, convites e recuperação de senha.

Não considere o sistema pronto para lançamento público até endurecermos as políticas de acesso e testarmos os fluxos completos.
