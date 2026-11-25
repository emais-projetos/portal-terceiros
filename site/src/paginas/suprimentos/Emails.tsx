import { Pagina } from '../../componentes/Pagina';
import { ModelosEmail } from '../admin/RegrasEmails';

// E-mails (Suprimentos): os mesmos textos que o administrativo edita em Acessos > E-mails.
export function Emails() {
  return (
    <Pagina
      titulo="E-mails"
      apoio="Textos dos e-mails que o portal envia: homologação, cobranças e correções. Toda alteração fica registrada com a revisão e quem salvou."
    >
      <ModelosEmail />
    </Pagina>
  );
}
