-- Texto da regra das fotos: agora vale também para as fichas de máquina, e o aviso é só no portal.
update public.parametros
   set descricao = 'As fotos ficam no portal por este tempo e depois são excluídas: na vistoria, contando da conclusão; na ficha de máquina, contando do fim do mês. As respostas e as assinaturas ficam. O portal avisa na última semana para baixar o PDF.'
 where chave = 'seg_dias_fotos';
