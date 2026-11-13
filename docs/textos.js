/* =====================================================================
   TEXTOS DA PÁGINA INICIAL — edite à vontade.
   Pode usar <b>negrito</b>, <i>itálico</i> e <a href="...">links</a>.
   ===================================================================== */
window.TEXTOS = {
  projeto: {
    titulo: "Quanto custa manter um deputado?",
    chamada: "Explore, compare e investigue como são utilizados os recursos públicos destinados aos deputados federais.",
    paragrafos: [
      "Todo mês, cada deputado federal recebe salário e pode usar verbas para manter o mandato: a <b>cota parlamentar</b> (passagens, divulgação, combustível, escritório…), a <b>verba de gabinete</b> (salários da equipe) e, em alguns casos, o <b>auxílio-moradia</b>. São informações públicas, mas espalhadas em vários sites e difíceis de comparar.",
      "O Projeto Quanto Custa junta tudo num só lugar, desde 2009, corrige os valores pela inflação e atualiza os dados automaticamente todos os dias. Aqui você pode ver o custo de cada deputado, comparar parlamentares, descobrir quais empresas mais recebem dinheiro da cota e acompanhar padrões que merecem atenção.",
    ],
  },

  // --------------------------------------------------- boas-vindas
  // Abre na primeira visita de cada pessoa. Para desligar, use ativo: false.
  // Quando trocar o texto, mude também "versao" para mostrar de novo a quem já viu.
  boas_vindas: {
    ativo: true,
    versao: 1,
    titulo: "Bem-vindo ao Projeto Quanto Custa",
    texto: [
      "Aqui você descobre quanto custa cada deputado federal, com dados oficiais da Câmara, atualizados todos os dias e corrigidos pela inflação.",
      "Pesquise o seu deputado, veja quanto ele gasta, com quem gasta, se vai às sessões e quais projetos aprovou. Tudo com a fonte de cada número.",
      "[Texto provisório — troque pelo seu em docs/textos.js, no bloco boas_vindas.]",
    ],
  },

  // Compromissos exibidos em "Sobre o projeto" (edite ou remova itens)
  independencia: [
    "Projeto independente, sem vínculo com partidos, políticos ou com a Câmara dos Deputados.",
    "Usa apenas dados públicos e oficiais, com a fonte de cada número indicada.",
    "Diferencia informação oficial, análise estatística e ponto de atenção: nenhum indicador é acusação.",
    "Código aberto: qualquer pessoa pode conferir como cada valor é calculado.",
  ],
};
