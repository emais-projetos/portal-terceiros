# Portal de Terceiros

Portal do Grupo Emais para os fornecedores das obras cadastrarem colaboradores e enviarem documentos. O administrativo confere e libera, e o TST da obra dá a validação final.

- **Site:** https://emais-projetos.github.io/portal-terceiros/
- **Banco e login:** Supabase, projeto `ntjhkengoqpcyjsjawbw`

## Como está organizado

| Pasta | O que tem |
|---|---|
| `supabase/migrations` | Estrutura do banco, na ordem em que foi aplicada no Supabase |
| `supabase/testes` | Teste das regras de acesso (quem vê o quê), para rodar num Postgres local |
| `site` | O site (React + Vite), publicado no GitHub Pages |
| `supabase/functions` | Função `gerenciar-acesso`: cria acessos e gera o link de primeiro acesso ou de nova senha |
| `.github/workflows` | Publicação automática do site a cada atualização da branch `main` |

### Migrações do banco

| Arquivo | O que faz |
|---|---|
| `20261019_001_modelo_fase1.sql` | Tabelas, regras de vencimento, regras de acesso por perfil, ações do fluxo (enviar, aprovar, devolver, validar) e armazenamento privado dos arquivos |
| `20261019_002_ajustes_migracao.sql` | CPF opcional com aviso de pendência de cadastro, NR extra por colaborador e área temporária da carga da planilha |
| `20261019_003_remover_area_migracao.sql` | Remove a área temporária depois da carga |
| `20261019_004_desempenho_regras_acesso.sql` | Deixa as regras de acesso e as visões de pendências rápidas (mesmo resultado, sem estourar o tempo limite do Supabase) |
| `20261019_005_texto_aviso_liberacao.sql` | Texto do e-mail de liberação gerado para o Outlook |
| `20261019_006_envio_fornecedor.sql` | Envio de documento com arquivo numa operação só, e envio para análise só com os obrigatórios enviados |
| `20261019_007_integracao_tst.sql` | Turmas de integração na obra: lista de presença, confirmação dos presentes e registro da data pelo TST ou pelo administrativo |
| `20261019_008_medicao.sql` | Medição mensal (F.48): itens, medição por empresa, obra e mês, arquivos, conferência por colaborador e as ações de envio e conferência |
| `20261019_009_medicao_remover_colaborador.sql` | Fornecedor tira da medição quem não trabalhou no mês (aplicada à parte, pelo SQL Editor) |
| `20261019_010_cobrancas.sql` | Registro das cobranças por e-mail já abertas ou dispensadas e destinatários da engenharia de cada obra |
| `20261019_011_cobranca_tres_passos.sql` | Tolerância até o dia 30, data combinada com o fornecedor, novos tipos de cobrança e assinatura dos e-mails |
| `20261021_012_modelo_lista_integracao.sql` | Documentos controlados: texto, data e revisão da lista de presença da integração |
| `20261021_013_lista_integracao_obra_instrutor.sql` | Lista de presença com o nome da obra e rótulo Instrutor(a) |
| `20261021_014_perfil_engenharia.sql` | Novo perfil de acesso: engenharia da obra |
| `20261021_015_painel_obra.sql` | Painel da obra (só leitura): colaboradores, pendências de documento, integração e medição das obras do acesso, sem CPF e sem arquivos |
| `20261021_016_painel_obra_historico.sql` | Painel da obra com o histórico da medição, incluindo os meses da planilha das empresas que trabalham na obra |
| `20261021_017_treinamentos_por_colaborador.sql` | Exceção da NR por colaborador: o administrativo torna uma NR obrigatória ou não obrigatória fora da regra da função, com motivo registrado no histórico |
| `20261021_018_colaborador_datas.sql` | Data de admissão (registro) e data de nascimento no cadastro do colaborador, com conferência das datas |
| `20261022_019_painel_farois.sql` | Painel com faróis também para o fornecedor (só as próprias empresas) e pendências com o grupo do documento (empresa ou colaborador) |
| `20261023_020_aceite_lgpd_medicao.sql` | Aceite de LGPD também no envio dos arquivos da medição, com data e hora gravadas |
| `20261106_021_ajustes_cadastro.sql` | Idade mínima de 18 anos, correção do cadastro pelo fornecedor até o envio, "Outro documento" e NR dispensável com justificativa, demissão com rescisórios, bloqueio com histórico, subcontratada pelo fornecedor, contrato entre as partes obrigatório, "PGR" e anexo das NRs para o TST |
| `20261106_022_cobrancas_automaticas.sql` | Envio automático das cobranças pelo n8n: registro de cada envio (enviada ou com erro) e parâmetros para testar com algumas empresas, mandar tudo para um endereço de teste ou pausar |
| `20261109_023_regras_e_modelos_email.sql` | Acessos > Regras (prazos da medição, avisos de vencimento, integração, envio automático e assinatura, com histórico) e Acessos > E-mails (textos das cobranças em modelos com revisões) |
| `20261109_024_aviso_liberacao_automatico.sql` | Aviso de liberação pelo envio automático: o administrativo clica em Enviar, o aviso entra na fila e o n8n envia; texto no modelo "Aviso de liberação" de Acessos > E-mails |

Os arquivos usados para carregar as planilhas `CONTROLE_DE_INTEGRAÇÃO` e de medição mensal não estão neste repositório, porque têm CPFs. O repositório é público: nenhum dado pessoal, senha ou chave secreta entra aqui.

## Perfis

| Perfil | Vê |
|---|---|
| Fornecedor | Só os dados da própria empresa |
| Administrativo | Tudo, e é o único que abre os arquivos enviados |
| TST da obra | Os dados digitados das obras pelas quais responde, sem acesso aos arquivos |
| Engenharia da obra | Só o **Painel da obra** das obras marcadas no acesso, em leitura: nomes, funções, situação, pendências, integração e medição. Não vê CPF, arquivos nem os documentos da medição |

Quem decide o que cada pessoa vê é o banco (regras de acesso por linha). O site usa só a chave pública do Supabase.

## Troca de endereço (jana-projetos para emais-projetos)

O endereço do site vem do nome da conta do GitHub. Para ficar `emais-projetos.github.io`:

1. No GitHub, o repositório passa para a organização **emais-projetos** (Settings > General > Transfer ownership).
2. Em **Settings > Pages** do repositório, a origem continua em "GitHub Actions"; a próxima publicação já sai no endereço novo.
3. No Supabase, em **Authentication > URL Configuration**: Site URL `https://emais-projetos.github.io/portal-terceiros/` e, em Redirect URLs, só `https://emais-projetos.github.io/portal-terceiros/**`.
4. Quem estava logado entra de novo uma vez (o navegador guarda a sessão por endereço).

O endereço antigo (`jana-projetos.github.io`) deixa de abrir com a transferência; como o portal ainda estava em teste, não ficou redirecionamento. Os links dos e-mails novos já saem com o endereço da organização.

## Configuração do login no Supabase (feita uma vez)

Em **Authentication > URL Configuration**:

- **Site URL:** `https://emais-projetos.github.io/portal-terceiros/`
- **Redirect URLs:** `https://emais-projetos.github.io/portal-terceiros/**` e, para testes no computador, `http://localhost:5173/**`

Em **Authentication > Sign In / Providers**, desligar **Allow new users to sign up**. Os acessos são criados pelo administrativo, ninguém se cadastra sozinho.

O envio de e-mail padrão do Supabase tem limite baixo por hora. Para uso com fornecedores, configurar o SMTP do domínio da Emais em **Authentication > Emails > SMTP Settings**.

## Primeiro acesso do administrativo

1. Em **Authentication > Users > Add user**, criar o usuário com e-mail e senha (marcar *Auto Confirm User*).
2. No **SQL Editor**, ligar o usuário ao perfil:

```sql
insert into public.usuarios (id, nome, email, perfil)
select id, 'Nome da pessoa', email, 'admin' from auth.users where email = 'email@emais.com';
```

Os demais acessos (fornecedores, TSTs e outros do administrativo) são criados no portal, em **Acessos**. O portal gera o link de primeiro acesso e monta o e-mail; o administrativo envia pelo Outlook. Nenhum e-mail sai do Supabase nesse fluxo.

O link vale pelo prazo definido em **Authentication > Sign In / Providers > Email > Email OTP Expiration**. O padrão é 1 hora; para dar tempo de o fornecedor abrir o e-mail, o recomendado é 86400 segundos (24 horas).

### Editar acessos e cadastrar fornecedor novo

Em **Acessos**, o botão **Editar** de cada linha corrige o nome e o e-mail do acesso e troca as obras (TST e engenharia, quantas forem) ou as empresas (fornecedor). Trocar o e-mail troca o login; a senha continua a mesma, e quem ainda não entrou precisa de um novo link ("Gerar link"). O perfil não muda pela edição: para isso, desative e crie outro acesso. Cada alteração fica no histórico.

Quando o fornecedor ainda não está na base, use **Cadastrar empresa nova** dentro de **Novo acesso** (ou da edição): razão social, CNPJ (conferido pelos dígitos), e-mail de contato para as cobranças, obras onde vai trabalhar e, se for o caso, a empresa principal da qual é subcontratada. A empresa já entra marcada para o acesso.

### Publicar a função de acessos

A função fica em `supabase/functions/gerenciar-acesso` e é publicada com o Supabase CLI (`supabase functions deploy gerenciar-acesso --no-verify-jwt`). Ela confere sozinha se quem chama é administrativo ativo e usa a chave de serviço, que só existe no ambiente do Supabase.

## Nome dos arquivos baixados

Na **Análise de documentos**, "Baixar todos" (ou "Baixar desta empresa") junta os arquivos num ZIP, com uma pasta por empresa quando há mais de uma. Cada arquivo sai com o nome `AAAAMMDD_documento_colaborador`, por exemplo `20261010_ASO_AUGUSTO FRANCISCO DE LIMA.pdf`:

- a data é a emissão do documento; nos tipos sem emissão (RG, CTPS, seguro) vale o dia do envio;
- nos documentos da empresa, no lugar do colaborador vai a razão social;
- quando um documento tem mais de um arquivo, entra "(1 de 2)", "(2 de 2)".

O download individual usa o mesmo nome. O prazo de 30 dias para apagar o arquivo começa no primeiro download.

## Lista de presença da integração (documento controlado)

A lista que o TST baixa em **Integração** segue o documento controlado da Segurança do Trabalho **DECLARAÇÃO DE RECEBIMENTO DE TREINAMENTO** (data 01.08.2025, revisão 03), em A4 retrato:

- uma folha por empresa, com 7 linhas de assinatura; acima disso, mais folhas, com "PAGINA: x de y";
- a declaração cita o nome da obra como está no cadastro (controle de integração), e o instrutor sai no rodapé como "Instrutor(a)", com a função;
- depois de confirmada a presença, a lista sai só com os presentes.

O texto, a data e a revisão ficam na tabela `modelos_documento` (código `lista_presenca_integracao`). Numa nova revisão, basta atualizar essa linha no Supabase: o layout é o mesmo e o site não precisa mudar. No texto, `**...**` é negrito, `_..._` é itálico e `{CONTRATANTE}` vira o nome da obra.

## Medição mensal (F.48)

Uma medição por empresa, obra e mês trabalhado, com entrega até o dia 25 do mês seguinte.

- **Fornecedor**, em **Medição**: escolhe a obra e o mês e começa. A lista de colaboradores já vem com quem está liberado ou em liberação na obra; ele ajusta a situação de cada um (trabalhou, rescisão, sócio, PJ, afastado), tira quem não trabalhou e inclui quem faltou. Envia um arquivo por item (holerites, pontos e VT podem vir num arquivo só) ou marca "não se aplica" com justificativa nos itens que aceitam (adiantamento, VT, rescisão). Só consegue enviar para conferência com todos os itens enviados.
- **Administrativo**, em **Medição**: painel do mês com as medições para conferir, com o fornecedor, retidas, aprovadas e as empresas com liberados que não começaram. Na conferência, aprova ou devolve cada item, marca colaborador por colaborador (holerite, pagamento, vale, VT, ponto, RE) e conclui: sem pendência, a medição fica aprovada; com pendência, volta para o fornecedor. A cobrança e o aviso de retenção para a engenharia da obra saem prontos para o Outlook.
- **Histórico por empresa** (aba dentro de Medição): uma linha por empresa e uma coluna por mês, com a situação de cada medição (OK, conferir, pendente, retida). Clicando na célula, abre a medição.
- **Retida**: medição não aprovada depois da tolerância do dia 30 (ou da data combinada). Entre o dia 25 e o dia 30 ela aparece como **em atraso**.
- "Baixar todos" gera um ZIP com os arquivos no nome `AAAAMM_documento_empresa`, por exemplo `202609_Holerite_EMPRESA LTDA (1 de 2).pdf`.

O histórico de março a agosto de 2026 veio da planilha de medição, sem obra (a planilha não tinha essa informação), com a conferência por colaborador das abas de março a maio.

## Cobranças por e-mail

Em **Cobranças** (só administrativo), o portal monta os e-mails no calendário:

- **Medição, dia 20:** lembrete do mês anterior para quem ainda não enviou (prazo dia 25).
- **Medição, dia 26:** notificação de atraso com tolerância até o dia 30 (as guias vencem no dia 20) e pedido de retorno com a data de envio.
- **Medição, depois do dia 30:** pagamento retido para o fornecedor e aviso de retenção para a engenharia da obra. Quando o fornecedor responde com uma data, o administrativo registra a **data combinada** na medição e a retenção espera até ela.
- **Documentos dos liberados:** quando entram em 30 dias, em 15 dias e quando vencem.
- **Integração, toda segunda-feira:** colaboradores ainda não liberados com documento obrigatório faltando ou devolvido, parado há 3 dias úteis ou mais.

A tela mostra uma linha por fornecedor, com selos de Medição, Documentos e Integração (vermelho para pagamento retido ou documento já vencido). Clicando, aparecem os e-mails daquele fornecedor, com o destinatário uma vez só e os botões de cada envio. Os avisos de retenção para a engenharia ficam numa lista à parte, uma linha por obra. Os botões de filtro (Todos, Urgentes, Medição, Documentos, Integração, Avisos às obras) e a busca por nome deixam ver só o que interessa; filtrando por tipo, a linha do fornecedor mostra só os e-mails daquele tipo.

Todos os e-mails dizem que documentos e correções só valem pelo portal. A assinatura (setor, e-mail e telefone) é editada na própria tela de Cobranças.

Quando há e-mails prontos, aparece um aviso no topo do portal e um contador no menu. Cada e-mail abre no Outlook do computador já preenchido; a pessoa confere e clica em enviar. O que foi aberto ou dispensado fica registrado e não volta. O destinatário da engenharia de cada obra é informado uma vez e fica guardado.

O botão usa o programa de e-mail padrão do Windows. Para ser o Outlook: **Configurações > Aplicativos > Aplicativos padrão > Outlook**, e em **MAILTO** escolher Outlook.

O envio automático (sem abrir o Outlook) depende de autorização do administrador do Microsoft 365 da Emais; o registro das cobranças já está pronto para isso.

## Cobranças automáticas (n8n)

As regras e os textos são os mesmos da aba Cobranças. A função do Supabase `cobrancas-automaticas` monta os e-mails do dia e o n8n só envia e devolve o resultado. Fluxo para importar no n8n: `n8n/cobrancas-automaticas.json`.

- Dias úteis às 7h o n8n pede a fila, envia cada e-mail pela caixa gente10@emais.com e registra se saiu ou deu erro. Às 7h30 manda um resumo para gente10@emais.com.
- E-mail enviado entra em `cobrancas` e não sai de novo. Com erro, volta para a fila e tenta no próximo dia útil.
- Cada tentativa fica em `cobrancas_envios`.
- Acesso à função: cabeçalho `x-chave-n8n` igual ao segredo `CHAVE_N8N` (cadastrado em Edge Functions > Secrets no Supabase, nunca no repositório).

- Aviso de liberação: na tela Aviso de liberação, o botão Enviar coloca o aviso na fila (`avisos_liberacao.situacao_envio`). A cada 10 minutos, em dias úteis das 7h às 19h, o n8n busca a fila (`acao: liberacoes`), envia e registra (`acao: registrar_liberacao`). O modo de teste e a pausa valem também aqui.

Quem recebe, na tabela `parametros`:

| Chave | Uso |
|---|---|
| `cobranca_automatica_empresas` | CNPJs liberados, separados por vírgula, ou `todas`. Vazio: ninguém recebe. Com só alguns CNPJs, o aviso de retenção para a engenharia não sai (ele lista outras empresas da obra), a não ser em modo de teste. |
| `cobranca_automatica_teste_para` | Se preenchido, tudo vai para este endereço, com o destinatário real no assunto, e nada é marcado como cobrado. |
| `cobranca_automatica_pausada` | `sim` suspende os envios. |

Para ligar para todos: rodar uma vez o nó "Marcar fila atual como cobrada" do fluxo (para o atraso acumulado não sair de uma vez) e depois trocar `cobranca_automatica_empresas` para `todas`.

A função é escrita em `supabase/functions/cobrancas-automaticas/fonte.ts` e empacotada com as regras do site em `index.ts` por `empacotar.mjs` (precisa do esbuild). Mudou `site/src/lib/cobrancas.ts`: empacote e publique a função de novo.

## Regras e e-mails (Acessos)

- **Regras**: dias do lembrete, do prazo e da tolerância da medição; primeiro e segundo aviso de vencimento; dias úteis parados na integração; validade de cada documento (com motivo); envio automático; assinatura. Cada mudança vai para `parametros_historico` (ou `tipos_documento_historico`, na validade) e aparece no fim da aba.
- **E-mails**: assunto e texto de cada cobrança em `modelos_email`, com campos entre chaves (`{empresa}`, `{prazo}`, `{documentos}`...). O banco recusa campos que não são do modelo. Cada mudança salva vira uma revisão em `modelos_email_revisoes`, e dá para voltar ao texto de uma revisão anterior. E-mail desligado sai da aba Cobranças e do envio automático.
- O portal e a função `cobrancas-automaticas` leem as regras e os modelos a cada cálculo, então não é preciso publicar nada depois de mudar um texto ou um prazo.

## Aceite de tratamento de dados (LGPD)

Todo envio de documento pelo fornecedor pede o aceite abaixo, e o botão de enviar só libera com ele marcado: documentos dos colaboradores, documentos da empresa e arquivos da medição (marcar "não se aplica" não pede, porque não envia dado pessoal).

> Declaro que autorizo a Emais Urbanismo a tratar os dados pessoais dos colaboradores da minha empresa, enviados neste sistema, para fins de integração em obras, liberação de medição e comprovação de regularidade documental, fiscal e trabalhista, nos termos da LGPD (Lei nº 13.709/2018). Declaro ainda que estou autorizado a compartilhar esses dados e que informei os titulares sobre o tratamento.

O banco recusa o envio sem o aceite e guarda a data e hora de cada um (`aceite_lgpd_em` nos documentos e nos arquivos da medição). O texto é este desde 23/10/2026; antes, o aceite dos documentos tinha outro texto e a medição não pedia aceite. O texto fica em `site/src/componentes/TermoLgpd.tsx`.

## Cadastro do colaborador

Nome, CPF, função, data de admissão (registro) e data de nascimento. As duas datas foram carregadas das colunas DATA DE REGISTRO e DATA DE NASCIMENTO da planilha `CONTROLE_DE_INTEGRAÇÃO` (a carga fica fora do repositório, porque tem dados pessoais). No cadastro de um colaborador novo o fornecedor é obrigado a informar as duas; nos antigos sem data, o detalhe do colaborador pede para completar. O administrativo também corrige em **Editar cadastro**. O banco recusa colaborador menor de 18 anos, admissão antes do nascimento ou mais de 90 dias à frente. O Painel da obra (engenharia) não mostra essas datas.

- **Função:** o fornecedor escolhe da lista ou usa "+ Nova função"; a função nova entra como texto e a Emais confere quais NRs ela exige.
- **Correção pelo fornecedor:** nome, CPF, empresa e função, em **Corrigir cadastro**, até alguma obra do colaborador ser enviada para análise. Depois disso, só o administrativo corrige (Editar cadastro, em Colaboradores ou pela Análise).
- **Outro documento:** o fornecedor inclui no colaborador uma NR que a função não pede ou um "Outro documento" com a descrição (ex.: treinamento de máquina). O documento passa a ser exigido.
- **Dispensa de NR:** a NR pedida pela função pode ser dispensada pelo fornecedor com justificativa; a dispensa vai para a análise da Emais, que vê a justificativa na Análise de documentos.
- **Demissão:** "Demitir ou informar desligamento" pede a data. Demitido encerra as obras e deixa pendentes no cadastro o TRCT assinado, a guia e o comprovante do FGTS rescisório, o ASO demissional e o comprovante de pagamento das verbas rescisórias (também em "O que falta"). Desistência antes de começar não pede rescisórios.
- **Bloqueio:** administrativo e TST bloqueiam e desbloqueiam no detalhe do colaborador, sempre com motivo; o histórico fica no cadastro. O bloqueado não é aprovado nem liberado em nenhuma obra, aparece em vermelho nos faróis e o fornecedor vê o motivo.
- **Fechar o cadastro:** clicar fora da janela não fecha mais (perdia o que foi digitado). Ao fechar um cadastro ainda não enviado, o portal avisa que ele só vai para análise com "Enviar para análise".

## Subcontratada

Em **Documentos da empresa**, o fornecedor usa **Inserir subcontratada** (CNPJ, razão social, e-mail e obras). A subcontratada fica no mesmo login, com os documentos de empresa e os colaboradores dela. O **contrato de serviço entre as partes** é obrigatório para liberar os colaboradores de subcontratada.

## Treinamentos (NR) por colaborador

A função define as NRs obrigatórias. Em **Colaboradores**, no detalhe do colaborador, o administrativo usa **Editar cadastro** para corrigir nome, CPF e função e para marcar, NR por NR, se ela se aplica àquele colaborador. Quando a marcação foge da regra da função, o portal pede o motivo, que fica no histórico do colaborador, e mostra o ajuste no detalhe (também para o TST). Desmarcar o ajuste volta a valer a função.

A mudança vale na hora para as pendências, a liberação, o "O que falta" do fornecedor e o Painel da obra. Só as NRs podem ser ajustadas assim; os demais documentos seguem a regra geral. Só o administrativo grava.

## Faróis do painel de obras

Engenharia e TST entram direto no **Painel da obra**; o fornecedor, em **Suas obras**. Cada empresa (ou, para o fornecedor, cada obra) tem um farol geral e três faróis menores: **Documentos**, **Integração** e **Medição**. Clicando, aparece o que está por trás de cada um; para o fornecedor, a lista "O que fazer para ficar verde", com o botão de cada ação.

| | Verde | Amarelo | Vermelho |
|---|---|---|---|
| Documentos | Liberados com tudo em dia | Documento vencendo em 30 dias, colaborador aguardando liberação, documento da empresa pendente sem liberados | Liberado trabalhando com documento obrigatório faltando ou vencido (ou documento da empresa faltando com gente liberada) |
| Integração | Liberados com integração em dia | Liberado pelo portal (de setembro de 2026 em diante) sem integração registrada, ou integração vencida ou vencendo em 30 dias | Não bloqueia |
| Medição | Mês aprovado, ou mês corrente no prazo do dia 25 | Depois do dia 25 na tolerância, em conferência, com data combinada ou devolvida | Pagamento retido: qualquer mês não aprovado depois do dia 30 ou da data combinada |

O administrativo vê na tela inicial, **Situação das obras**, uma linha por obra com o farol geral (o pior entre as empresas) e os faróis de Documentos, Integração e Medição; clicando, aparecem as empresas da obra com os faróis delas e os atalhos para o painel da obra e os colaboradores.

O farol geral é o pior dos três. Os documentos da empresa (ex.: Cartão CNPJ) contam uma vez só. As regras ficam em `site/src/lib/farois.ts`. Os detalhes que já existiam (pagamento por mês, histórico da medição, documentos e colaboradores) continuam no painel, em "Mais detalhes da obra", só para o administrativo; engenharia e TST veem apenas os faróis.

## Painel da obra (engenharia)

Acompanhamento da obra para a engenharia, também aberto ao TST e ao administrativo (menu **Painel da obra**). A engenharia entra direto nele e não tem outras telas. As obras de cada acesso são marcadas em **Acessos** ao criar o acesso com o perfil *Engenharia da obra*.

- **Resumo:** liberados para trabalhar e aguardando liberação, conformidade documental (liberados sem documento vencido ou faltando), integração em dia e pagamentos do mês.
- **Medição, pagamento das empresas:** por mês trabalhado, cada empresa com colaborador liberado ou com medição aparece como *Liberar* (medição aprovada), *Reter* (passou do dia 30, ou da data combinada, sem aprovação) ou *Aguardar* (no prazo até o dia 25, na tolerância até o dia 30, com data combinada ou em conferência na Emais), com o que falta.
- **Histórico da medição por empresa:** a mesma grade empresa × mês do administrativo. Os meses da planilha (março a agosto de 2026) não tinham obra e aparecem para as empresas que têm ou tiveram colaborador na obra; medições de outras obras da empresa ficam de fora. Clicando na célula, o mês abre no quadro de pagamento.
- **Conformidade documental por empresa:** liberados, com pendência, em dia, vencendo em 30 dias e aguardando liberação. Clicando na empresa aparecem os colaboradores e os documentos pendentes.
- **Integração:** turmas agendadas e realizadas nos últimos 90 dias e liberados sem integração, vencida ou vencendo em 30 dias.
- **Colaboradores na obra:** lista com busca e filtros (com pendência, sem integração em dia, aguardando liberação).

Os dados vêm da função `painel_obra` do banco, que confere se a obra é do acesso. A engenharia não lê nenhuma tabela diretamente.

## Indicadores

Em **Indicadores** (só administrativo), com filtro de obra e período:

- **Medição:** medições aprovadas por mês, entrega até o dia 25, tempo de conferência da Emais (dias úteis do envio à conclusão), itens pendentes nas entregas parciais e ranking dos 10 piores e 10 melhores fornecedores (só meses com prazo vencido).
- **Liberação:** tempo de liberação (do envio para análise à validação do TST, separado em Emais e TST), liberados com documento vencido ou faltando (por obra e por documento) e rankings de fornecedores nos dois.

As metas ficam em `site/src/lib/indicadores.ts` (`METAS`). Entrega no prazo e tempo de conferência só existem a partir das medições feitas no portal, porque a planilha não tinha essas datas.

## Rodar o site no computador

```bash
cd site
cp .env.exemplo .env.local   # preencher a chave pública
npm install
npm run dev                  # abre em http://localhost:5173/portal-terceiros/
```

## Publicação

Cada atualização na `main` dispara o workflow **Publicar site**, que gera o site e publica no GitHub Pages. Na primeira vez, em **Settings > Pages**, escolher **Source: GitHub Actions**.
