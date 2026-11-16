-- Metas de conformidade das inspeções (Regras > Segurança da obra): linha de meta nos gráficos e alerta nos cartões.
insert into public.parametros (chave, valor, descricao, rotulo, grupo, tipo, minimo, maximo, unidade, ordem) values
  ('seg_meta_alojamento', '90', 'Conformidade mínima esperada nas vistorias de alojamento (itens "Sim" sobre os aplicáveis). Abaixo disso o painel marca em alerta.',
   'Meta de conformidade do alojamento', 'Segurança da obra', 'inteiro', 1, 100, '%', 30),
  ('seg_meta_canteiro', '85', 'Conformidade mínima esperada nas vistorias de canteiro (itens "Sim" sobre os aplicáveis). Abaixo disso o painel marca em alerta.',
   'Meta de conformidade do canteiro', 'Segurança da obra', 'inteiro', 1, 100, '%', 40)
on conflict (chave) do nothing;
