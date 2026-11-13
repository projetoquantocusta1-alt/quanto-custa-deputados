# Projeto Quanto Custa — Deputados federais

Site que mostra quanto cada deputado federal custa ao contribuinte (salário,
auxílio-moradia, cota parlamentar e verba de gabinete) e, à parte, quanto
destinou em emendas. Um robô atualiza os dados **todo dia** direto das fontes
oficiais.

## O painel

- **Início**: apresentação do projeto (edite `docs/textos.js`) e contador em tempo real.
- **Visão geral**: indicadores com variação contra o ano anterior, gasto por mês (com previsão), composição, cota por tipo de gasto, mapa por estado, partidos, distribuição e dispersão cota × gabinete.
- **Deputados**: ranking ordenável e ficha completa (percentis, pontos de atenção, trajetória, fornecedores, emendas).
- **Comparar**: até 6 deputados lado a lado.
- **Fornecedores**: quem mais recebe da cota e quais deputados pagam cada empresa.
- **Pontos de atenção**: padrões estatísticos (concentração, fornecedor exclusivo, fim de semana, valores redondos, picos, ano eleitoral).
- **Rankings e mapa**: por tipo de gasto, economia da cota e distribuição por partido.
- **Previsões** e **Histórico** (2009 até hoje, corrigido pelo IPCA).

## Como funciona

```
GitHub Actions (todo dia 05:17)  →  atualizar.py  →  docs/dados/*.json  →  GitHub Pages (site)
```

| Item | Fonte |
|---|---|
| Lista de deputados, partido, UF, foto | API de Dados Abertos da Câmara (`/api/v2/deputados`) |
| Cota parlamentar (CEAP), por tipo e fornecedor | `camara.leg.br/cotas/Ano-AAAA.csv.zip` |
| Verba de gabinete gasta, auxílio-moradia, imóvel funcional, pessoal | Página pública do deputado (`camara.leg.br/deputados/ID?ano=AAAA`) |
| Salário | Subsídio do Decreto Legislativo 172/2022 (em `config.py`) × meses em exercício |
| Emendas individuais | Portal da Transparência (arquivo único de emendas) |
| Fotos (versão pequena, em `docs/dados/fotos/`) | Foto oficial da Câmara (`bandep/ID.jpg`) |
| Novas notas de hoje (`docs/dados/novas/`) | Comparação diária do arquivo da cota com as notas já vistas (`dados_brutos/novas/`) |
| Cadastro e sócios dos fornecedores (`docs/dados/receita/`) | Dados abertos do CNPJ da Receita Federal (arquivos mensais) — `receita.py`, toda semana confere se há base nova |
| Projetos aprovados com nota de relevância (`docs/dados/projetos/`) | Arquivos anuais de proposições, temas e autores da Câmara — `projetos.py`, todo domingo |

As subpáginas do deputado (remuneração, verba-gabinete) são vetadas pelo
`robots.txt` da Câmara, por isso o robô lê só a página principal.

## Colocar no ar (uma vez só, ~10 min)

1. Crie um repositório público no GitHub chamado `quanto-custa-um-deputado`
   e suba estes arquivos (pode arrastar a pasta em *Add file → Upload files*).
2. Em **Settings → Actions → General → Workflow permissions**, marque
   *Read and write permissions* e salve.
3. Em **Actions**, abra *Atualizar dados* → **Run workflow**. Na primeira vez,
   preencha `2023 2024 2025 2026` para baixar a legislatura inteira
   (leva ~1 h por causa da pausa educada entre requisições).
4. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`,
   pasta `/docs`. O site fica em `https://SEU_USUARIO.github.io/quanto-custa-um-deputado/`.
5. Troque `SEU_USUARIO` em `config.py` (USER_AGENT) pelo seu usuário.

Depois disso o robô roda sozinho todo dia. Anos fechados ficam em cache
(`dados_brutos/`), então a rotina diária só reprocessa o ano corrente.

## Rodar no seu computador

```bash
pip install -r requirements.txt
python atualizar.py --limite 5        # teste rápido
python atualizar.py --anos 2025       # um ano
python -m http.server -d docs         # abre o site em http://localhost:8000
python -m pytest -q                   # testes dos leitores
```

## Se o robô falhar

- **Sites do governo bloqueando o GitHub**: alguns órgãos recusam IPs de
  datacenter. Se o log mostrar erro 403/timeout nas fontes, rode
  `atualizar.py` no seu PC pelo Agendador de Tarefas do Windows (1x ao dia)
  e faça `git push` em seguida.
- **Página da Câmara mudou de layout**: os testes em `tests/` mostram qual
  campo deixou de ser lido; ajuste as expressões em `coletor/camara.py → parse_perfil`.
- Se uma fonte falhar, o robô mantém os dados do dia anterior para ela.

## Metodologia e limites

- Meses em exercício = meses com verba de gabinete ou cota usadas (com os
  buracos preenchidos). Em ano fechado soma o 13º proporcional.
- Auxílio-moradia: aplicado conforme o status atual da página do deputado.
- Não inclui encargos, plano de saúde, imóvel funcional (não monetizado),
  diárias de missão e custos indiretos da Câmara.
- Emendas são casadas pelo nome do autor (nome parlamentar, eleitoral ou
  civil); nomes ambíguos são descartados. Emendas de bancada/comissão não entram.
- Reajustes: acrescente a nova linha em `SUBSIDIO` / `AUXILIO_MORADIA` em `config.py`.
