"""Parâmetros do projeto "Quanto custa um deputado".

Os valores fixos (subsídio, auxílio-moradia, ajudas de custo) vêm de normas.
Quando houver reajuste, basta acrescentar uma linha aqui — o resto do código
se ajusta. Cada valor traz a norma de origem.
"""
from datetime import date

ANO_INICIAL = 2009  # primeiro ano com arquivo de cota parlamentar

# Legislaturas (número, início, fim). A 57ª é a atual.
LEGISLATURAS = [
    (53, date(2007, 2, 1), date(2011, 1, 31)),
    (54, date(2011, 2, 1), date(2015, 1, 31)),
    (55, date(2015, 2, 1), date(2019, 1, 31)),
    (56, date(2019, 2, 1), date(2023, 1, 31)),
    (57, date(2023, 2, 1), date(2027, 1, 31)),
]
LEGISLATURA = LEGISLATURAS[-1][0]

# Subsídio mensal. (início dos efeitos financeiros, valor)
SUBSIDIO = [
    (date(2007, 4, 1), 16_512.09),   # DL 112/2007
    (date(2011, 2, 1), 26_723.13),   # DL 805/2010
    (date(2015, 2, 1), 33_763.00),   # DL 276/2014
    (date(2023, 1, 1), 39_293.32),   # DL 172/2022, inciso I
    (date(2023, 4, 1), 41_650.92),   # DL 172/2022, inciso II
    (date(2024, 2, 1), 44_008.52),   # DL 172/2022, inciso III
    (date(2025, 2, 1), 46_366.19),   # DL 172/2022, inciso IV
]

# Auxílio-moradia mensal (teto), pago a quem não usa imóvel funcional.
AUXILIO_MORADIA = [
    (date(2009, 1, 1), 3_000.00),    # valor vigente antes do reajuste de 2013
    (date(2013, 4, 1), 3_800.00),    # Ato da Mesa 94/2013 (+26,6%)
    (date(2015, 4, 1), 4_253.00),    # Ato da Mesa 3/2015 (+11,92%)
]
# Desde 2023 o deputado pode COMPLEMENTAR o aluguel com a cota parlamentar (até
# R$ 4.148,80); esse complemento já entra na cota, não no auxílio. O valor do
# auxílio continua R$ 4.253,00 (página oficial "Gastos parlamentares", 2026).

# Ajuda de custo: até 2012 eram pagos 2 subsídios extras por ano ("14º e
# 15º", início e fim da sessão legislativa), extintos em 2013. Desde então,
# 1 subsídio no início e 1 no fim de cada mandato.
ULTIMO_ANO_14_15 = 2012

# Correção monetária: IPCA mensal, série 433 do SGS/Banco Central
IPCA_SGS = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados"
            "?formato=json&dataInicial=01/01/{ano}")

# Educação com o servidor do site: pausa entre requisições (segundos)
PAUSA_ENTRE_REQUISICOES = 0.6
USER_AGENT = "ProjetoQuantoCusta/1.0 (painel de transparencia com dados abertos)"

# Fontes
API_CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
CEAP_ZIP = "https://www.camara.leg.br/cotas/Ano-{ano}.csv.zip"
PERFIL_DEPUTADO = "https://www.camara.leg.br/deputados/{id}?ano={ano}"
EMENDAS_ZIP = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"


def valor_vigente(tabela, dia: date) -> float:
    """Retorna o valor da tabela [(inicio, valor)] vigente no dia."""
    atual = 0.0
    for inicio, valor in sorted(tabela):
        if dia >= inicio:
            atual = valor
    return atual


def anos_de_inicio_de_legislatura() -> set[int]:
    return {ini.year for _, ini, _ in LEGISLATURAS}


# ------------------------------------------- notas fiscais e fornecedores
# No ano corrente, os arquivos de notas e de fornecedores (grandes) são
# regravados só uma vez por semana, para o repositório não crescer demais.
DIA_DA_SEMANA_NOTAS = 6            # 0 = segunda ... 6 = domingo
URL_NOTA_PREFIXO = "https://www.camara.leg.br/cota-parlamentar/"


# ------------------------------------------------ Receita Federal (CNPJ)
# Dados abertos do CNPJ, publicados pela Receita uma vez por mês, em pastas
# AAAA-MM com Empresas0..9.zip, Estabelecimentos0..9.zip, Socios0..9.zip,
# Simples.zip e as tabelas de códigos. O robô tenta os endereços na ordem
# e usa a pasta mais recente que estiver completa. Se a Receita mudar o
# endereço, é só acrescentar o novo aqui.
RECEITA_FONTES = [
    {"tipo": "indice", "url": "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/"},
    {"tipo": "indice", "url": "https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/"},
    # compartilhamento (Nextcloud) usado pela Receita em alguns períodos
    {"tipo": "webdav", "url": "https://arquivos.receitafederal.gov.br/public.php/webdav/", "token": "YggdBLfdninEJX9"},
]
# Limite anual de faturamento do MEI (para o alerta "MEI acima do limite")
MEI_LIMITE = [(2018, 81000.0)]

# ------------------------------------------------ Projetos aprovados
PROP_CSV = "https://dadosabertos.camara.leg.br/arquivos/proposicoes/csv/proposicoes-{ano}.csv"
PROP_TEMAS_CSV = "https://dadosabertos.camara.leg.br/arquivos/proposicoesTemas/csv/proposicoesTemas-{ano}.csv"
PROP_AUTORES_CSV = "https://dadosabertos.camara.leg.br/arquivos/proposicoesAutores/csv/proposicoesAutores-{ano}.csv"
PROP_ANO_APRESENTACAO_INICIAL = 1995   # projetos antigos também são aprovados anos depois
PROP_APROVADOS_DESDE = 2009            # só entra o que foi aprovado de 2009 em diante
URL_PROPOSICAO = "https://www.camara.leg.br/propostas-legislativas/{id}"

# ------------------------------------------------ Presença (dados abertos da Câmara)
EVENTOS_CSV = "https://dadosabertos.camara.leg.br/arquivos/eventos/csv/eventos-{ano}.csv"
PRESENCA_CSV = "https://dadosabertos.camara.leg.br/arquivos/eventosPresencaDeputados/csv/eventosPresencaDeputados-{ano}.csv"
URL_EVENTO = "https://www.camara.leg.br/evento-legislativo/{id}"
PRESENCA_DESDE = 2009   # anos sem o arquivo de presença ficam sem esse dado (o robô avisa)
# Recesso parlamentar (Constituição, art. 57): 18 a 31 de julho e 23 de dezembro a 1º de fevereiro.
# É contexto, nunca falta.
RECESSOS = [((7, 18), (7, 31)), ((12, 23), (12, 31)), ((1, 1), (2, 1))]
