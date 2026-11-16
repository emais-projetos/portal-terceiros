// Texto do termo de uso do alojamento (versão 1, igual ao ObraCheck). Mudou o texto, sobe a versão:
// cada termo assinado guarda a versão que o colaborador leu.
export const VERSAO_TERMO = 1;

export const TERMO = {
  titulo: 'Termo de uso do alojamento',
  introducao:
    'Este termo tem como objetivo estabelecer as regras de utilização do alojamento disponibilizado pela empresa aos colaboradores durante o período de execução da obra. Ao assinar este documento, o colaborador declara estar ciente e concorda com as seguintes regras:',
  secoes: [
    {
      "titulo": "1. Regras Gerais de Convivência",
      "itens": [
        "Zelar pela conservação do alojamento, incluindo móveis, eletrodomésticos, equipamentos, utensílios, portas, janelas, colchões e demais itens disponibilizados pela empresa.",
        "Manter os quartos, banheiros, cozinha e demais áreas comuns sempre limpos, organizados e em boas condições de uso.",
        "Respeitar e promover o bom convívio entre demais colaboradores, mantendo comportamento adequado, preservando a integridade física e moral dos mesmos, estando, portanto, PROIBIDO realização de trotes e brincadeiras que possam vir a constranger alguém, ameaçar ou comprometer a integridade física ou moral de outros colaboradores.",
        "É proibido barulho excessivo nas dependências do alojamento entre 20h00 e 06h00, devendo ser respeitado o horário de silêncio.",
        "É proibida a realização de festas, confraternizações ou quaisquer eventos nas dependências do alojamento.",
        "É proibida a entrada ou permanência de pessoas não autorizadas nas dependências do alojamento e nos quartos.",
        "É proibida a criação ou permanência de animais de qualquer espécie nas dependências do alojamento.",
        "É proibido transitar pelas áreas comuns utilizando vestimentas inadequadas.",
        "É proibida a mudança de quarto ou de alojamento sem autorização prévia do responsável pelos alojamentos, considerando a disponibilidade de vagas."
      ]
    },
    {
      "titulo": "2. Álcool, Fumo e Substâncias",
      "itens": [
        "É proibido o consumo de bebidas alcoólicas ou de substâncias ilícitas nas dependências do alojamento.",
        "É proibido fumar dentro dos quartos e em quaisquer locais fechados ou sem ventilação adequada. O fumo será permitido somente nos locais ventilados previamente indicados pela empresa.",
        "É proibida a utilização ou instalação de fogões, fogareiros ou equipamentos similares que possam ocasionar incêndios nas dependências do alojamento.",
        "É proibido cozinhar, aquecer alimentos ou utilizar objetos que possam causar combustão ou incêndio dentro das dependências do alojamento."
      ]
    },
    {
      "titulo": "3. Segurança",
      "itens": [
        "É proibido o porte de armas de fogo, armas brancas ou qualquer objeto que possa ser utilizado como arma, incluindo porretes, tacos, instrumentos pontiagudos ou similares.",
        "É proibida a utilização de extensões elétricas, benjamins, adaptadores ou equipamentos similares que possam oferecer risco à instalação elétrica ou à segurança dos ocupantes.",
        "Cumprir todas as normas e orientações de segurança, higiene e saúde estabelecidas pela empresa."
      ]
    },
    {
      "titulo": "4. Conservação, Danos e Manutenção",
      "itens": [
        "Utilizar água e energia elétrica de forma consciente, evitando desperdícios.",
        "Não realizar alterações nas características do imóvel ou nas instalações do alojamento sem autorização prévia da empresa.",
        "É proibido danificar paredes, portas, janelas, vidros, maçanetas, camas, colchões, eletrodomésticos, móveis ou quaisquer outros bens disponibilizados no alojamento.",
        "É proibido retirar móveis, utensílios, equipamentos ou colchões de seus locais de utilização sem autorização.",
        "Os colchões não poderão ser retirados das camas para utilização em outros locais do alojamento, nem deixados diretamente no chão dos quartos, cozinha, sala ou demais áreas.",
        "Qualquer dano causado por mau uso, bem como alterações não autorizadas, poderá gerar a cobrança dos respectivos custos de reparo ao responsável, observadas as regras aplicáveis.",
        "Comunicar imediatamente ao responsável pelo alojamento qualquer dano, defeito, problema de manutenção ou situação que possa comprometer a segurança, higiene ou conservação do imóvel.",
        "O lixo deverá ser descartado corretamente nos locais indicados, mantendo as áreas do alojamento limpas e organizadas."
      ]
    },
    {
      "titulo": "5. Pertences e Veículos",
      "itens": [
        "Cada colaborador é responsável pela guarda e organização de seus pertences pessoais. A empresa não se responsabiliza por perdas, furtos ou danos de objetos pessoais, como celulares, carteiras, cartões, documentos, talões de cheques ou outros bens deixados nas dependências do alojamento.",
        "A empresa não se responsabiliza por danos ocorridos com veículos de colaboradores estacionados nas dependências do alojamento."
      ]
    },
    {
      "titulo": "6. Fiscalização e Cumprimento das Normas",
      "itens": [
        "É facultado à EMAIS Residências realizar vistorias periódicas nas instalações do alojamento, com o objetivo de verificar as condições do imóvel e o cumprimento destas normas.",
        "O descumprimento das normas poderá resultar na aplicação das medidas disciplinares cabíveis, conforme a gravidade da ocorrência e as regras internas da empresa.",
        "Todos os colaboradores que utilizarem o alojamento deverão conhecer, cumprir e contribuir para o cumprimento destas normas, visando garantir a segurança, higiene, conservação e boa convivência no local."
      ]
    }
  ] as { titulo: string; itens: string[] }[],
  penalidade: 'O descumprimento das regras poderá gerar medidas de reintegração e retirada do alojamento.',
  declaracao:
    'Declaro que recebi as orientações sobre as regras de utilização do alojamento da obra, compreendi todas as condições descritas neste termo e comprometo-me a cumpri-las integralmente, zelando pelo patrimônio da empresa e mantendo uma convivência respeitosa com os demais colaboradores.',
};
