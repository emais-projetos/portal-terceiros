-- Perfil do Suprimentos: cadastra e homologa os fornecedores de serviço e registra os contratos.
-- Fica numa migração à parte porque o novo valor do enum só pode ser usado depois de gravado.
alter type public.perfil_usuario add value if not exists 'suprimentos';
