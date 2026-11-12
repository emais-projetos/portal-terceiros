import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Moldura } from '../componentes/Moldura';
import { Carregando } from '../componentes/Carregando';
import { consultarConvite, type SituacaoConvite } from '../lib/admin';
import { supabase, mensagemDeErro } from '../lib/supabase';

// Link do e-mail de acesso. Só gasta o convite quando a pessoa clica no botão: o antivírus do e-mail,
// que costuma abrir os links sozinho, não consegue usar o convite.
export function AceitarConvite() {
  const [params] = useSearchParams();
  const codigo = params.get('c') ?? '';
  const [info, setInfo] = useState<SituacaoConvite | null>(null);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    consultarConvite(codigo, false)
      .then(setInfo)
      .catch((e) => setErro(mensagemDeErro(e as Error)));
  }, [codigo]);

  async function continuar() {
    setErro(null);
    setIndo(true);
    try {
      // Se alguém estiver logado neste navegador, sai antes: a senha criada é a do convite.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      const r = await consultarConvite(codigo, true);
      if (r.situacao === 'ok' && r.link) {
        window.location.assign(r.link);
        return;
      }
      setInfo(r);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
    setIndo(false);
  }

  if (!info && !erro) return <Carregando />;

  const novaSenha = info?.tipo === 'nova_senha';
  const problema: Record<string, string> = {
    usado: 'Este link já foi usado. Se você ainda não criou a senha, responda o e-mail que recebeu que mandamos outro.',
    vencido: 'Este link passou do prazo. Responda o e-mail que recebeu que mandamos outro.',
    substituido: 'Mandamos um link mais novo para o seu e-mail. Use o e-mail mais recente.',
    desativado: 'Este acesso está desativado. Fale com o Gente e Gestão da Emais.',
    invalido: 'Link incompleto ou inválido. Confira se copiou o endereço inteiro do e-mail.',
  };

  return (
    <Moldura>
      <div className="formulario">
        {info && info.situacao === 'valido' ? (
          <>
            <h2>{novaSenha ? 'Criar nova senha' : 'Bem-vindo ao Portal de Terceiros'}</h2>
            <p className="apoio">
              {info.primeiro_nome ? `Olá, ${info.primeiro_nome}. ` : ''}
              {novaSenha ? 'Clique no botão para criar a nova senha' : 'Clique no botão para criar a sua senha'} do acesso {info.email}.
            </p>
            {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
            <button className="botao" type="button" disabled={indo} onClick={continuar}>
              {indo ? 'Abrindo' : novaSenha ? 'Criar nova senha' : 'Criar minha senha'}
            </button>
          </>
        ) : (
          <>
            <h2>Não foi possível usar este link</h2>
            <p className="apoio">{erro ?? problema[info?.situacao ?? 'invalido'] ?? problema.invalido}</p>
            <Link className="link" to="/entrar">Ir para a entrada do portal</Link>
          </>
        )}
      </div>
    </Moldura>
  );
}
