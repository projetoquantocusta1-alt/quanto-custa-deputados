/* Quanto custa um deputado? — painel */
(() => {
  "use strict";

  // =============================================================== base
  const COMP = [
    ["salario", "Salário", "--c-salario"],
    ["ajuda_de_custo", "Ajudas de custo", "--c-ajuda"],
    ["auxilio_moradia", "Auxílio-moradia", "--c-auxilio"],
    ["cota_parlamentar", "Cota parlamentar", "--c-cota"],
    ["verba_gabinete", "Verba de gabinete", "--c-gabinete"],
  ];
  const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const CORES = ["#118dff", "#e66c37", "#12239e", "#6b007b", "#e044a7", "#744ec2", "#d9b300", "#1aab40", "#d64550", "#197278"];
  const TIPOS = {
    concentracao: ["Concentração em um fornecedor", "#d13438"],
    exclusivo: ["Fornecedor exclusivo", "#e66c37"],
    fim_de_semana: ["Notas de fim de semana", "#744ec2"],
    valores_redondos: ["Valores redondos", "#d9b300"],
    pico: ["Pico fora do padrão", "#118dff"],
  };
  // grade do mapa: [UF, linha, coluna]
  const GRADE_UF = [["RR",0,1],["AP",0,3],["AM",1,1],["PA",1,2],["MA",1,3],["CE",1,4],["RN",1,5],
    ["AC",2,0],["RO",2,1],["TO",2,2],["PI",2,3],["PE",2,4],["PB",2,5],["MT",3,1],["GO",3,2],["BA",3,3],["SE",3,4],["AL",3,5],
    ["MS",4,1],["DF",4,2],["MG",4,3],["ES",4,4],["PR",5,1],["SP",5,2],["RJ",5,3],["SC",6,1],["RS",7,1]];
  const MAX_COMP = 6;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const brlCurto = (v) => { const a = Math.abs(v || 0);
    if (a >= 1e9) return "R$ " + (v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " bi";
    if (a >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
    return brl(v); };
  const brl = (v, dec = 0) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: dec, minimumFractionDigits: dec });
  const nf = (v, d = 0) => (v || 0).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d });
  const compacto = (v) => {
    const a = Math.abs(v || 0);
    if (a >= 1e9) return "R$ " + nf(v / 1e9, 2) + " bi";
    if (a >= 1e6) return "R$ " + nf(v / 1e6, a >= 1e8 ? 0 : 1) + " mi";
    if (a >= 1e3) return "R$ " + nf(v / 1e3, 0) + " mil";
    return brl(v);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const soma = (a) => a.reduce((s, x) => s + (x || 0), 0);
  const quantil = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const p = (s.length - 1) * q;
    const b = Math.floor(p); return s[b] + (s[Math.min(b + 1, s.length - 1)] - s[b]) * (p - b); };
  const getJSON = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); };
  const docFmt = (d) => d && d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : (d ? "CPF ***" + d.slice(3, 9) + "**" : "");
  const dataBR = (s) => s ? s.split("-").reverse().join("/") : "—";
  const iniciais = (n) => { const p = String(n || "").trim().split(/\s+/).filter((x) => x.length > 2 || /^[A-ZÀ-Ú]/.test(x)); return ((p[0] || "")[0] || "") + (p.length > 1 ? p[p.length - 1][0] : ""); };

  // ============================================================= estado
  const E = { meta: null, historico: null, resumo: null, resumoAtual: null, resumoAnt: null,
    sel: [], ordem: "custo_mandato", asc: false, limite: 50, limitePrev: 15, limiteForn: 50, limitePt: 30,
    tipoPt: "", pag: "inicio", graficos: {}, cache: {}, deps: [], nomes: {} };
  const corrigir = () => $("#f-ipca").checked;
  const ehTotal = (r = E.resumo) => !!r?.total;
  const rotuloAno = (r = E.resumo) => (ehTotal(r) ? `${r.anos[0]}–${r.anos[r.anos.length - 1]}` : String(r?.ano ?? ""));
  const fator = (r = E.resumo) => (corrigir() ? (r?.fator_ipca || 1) : 1);
  const R = (v) => (v || 0) * fator();
  const valorDe = (d, k) => (k in d ? d[k] : (d.custos || {})[k]);
  const previsto = (d) => (d.previsao?.ativo ? d.previsao.restante : 0);
  const mensal = (d) => d.mensal || { fixo: Array(12).fill(0), cota: Array(12).fill(0), gabinete: Array(12).fill(0) };
  const cache = (k, f) => E.cache[k] || (E.cache[k] = f().catch(() => null));

  // filtros: estado, partido e deputado(s). Com deputados escolhidos na lista,
  // valem só eles; sem escolha, o texto digitado filtra pelo nome.
  const textoBusca = () => (E.deps.length ? "" : semAcento($("#f-busca").value.trim()));
  function passaFiltro(d) {
    const uf = $("#f-uf").value, partido = $("#f-partido").value, busca = textoBusca();
    return (!uf || d.uf === uf) && (!partido || d.partido === partido) && (!E.deps.length || E.deps.includes(+d.id))
      && (!busca || semAcento(d.nome || "").includes(busca));
  }
  const filtrados = () => E.resumo.deputados.filter(passaFiltro);
  const temFiltro = () => !!($("#f-uf").value || $("#f-partido").value || E.deps.length || textoBusca());
  const temFiltroDep = () => !!(E.deps.length || textoBusca());

  // ============================================================ gráficos
  function prepararChart() {
    Object.assign(Chart.defaults, { color: css("--muted"), borderColor: css("--line"), maintainAspectRatio: false });
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = "#252423";
    Chart.defaults.animation.duration = 300;
  }
  function grafico(id, config) {
    if (E.graficos[id]) E.graficos[id].destroy();
    const el = document.getElementById(id);
    if (!el) return null;
    return (E.graficos[id] = new Chart(el, config));
  }
  const tickBRL = { callback: (v) => compacto(v).replace("R$ ", "") };
  const tipBRL = (eixo = "y") => ({ callbacks: { label: (c) => `${c.dataset.label ? c.dataset.label + ": " : ""}${brl(eixo === "x" ? c.parsed.x : c.parsed.y ?? c.parsed)}` } });
  const legBaixo = { position: "bottom" };
  const barraH = (id, rotulos, valores, cor, extra = {}) => grafico(id, {
    type: "bar",
    data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: cor, borderRadius: 3, ...extra.ds }] },
    options: { indexAxis: "y", scales: { x: { ticks: extra.ticks || tickBRL }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
      plugins: { legend: { display: false }, tooltip: extra.tooltip || tipBRL("x") }, onClick: extra.onClick,
      onHover: (e, el) => { if (extra.onClick) e.native.target.style.cursor = el.length ? "pointer" : "default"; } },
  });

  // ================================================================ mapa
  function mapa(el, legEl, valores, fmt, aoClicar, selecionado) {
    const vs = Object.values(valores).filter((v) => v > 0);
    const min = Math.min(...vs), max = Math.max(...vs);
    const cor = (v) => { const t = max > min ? (v - min) / (max - min) : .5;
      const a = [222, 235, 247], b = [107, 174, 214], c = [8, 48, 107];
      const mix = (x, y, k) => x.map((n, i) => Math.round(n + (y[i] - n) * k));
      const rgb = t < .5 ? mix(a, b, t * 2) : mix(b, c, (t - .5) * 2);
      return [`rgb(${rgb})`, t > .45 ? "#fff" : "#1f2a44"]; };
    el.innerHTML = GRADE_UF.map(([uf, l, c]) => {
      const v = valores[uf];
      if (!v) return `<button class="sem" style="grid-row:${l + 1};grid-column:${c + 1}" disabled>${uf}</button>`;
      const [bg, tx] = cor(v);
      return `<button style="grid-row:${l + 1};grid-column:${c + 1};background:${bg};color:${tx}" data-uf="${uf}" class="${selecionado === uf ? "sel" : ""}"
        title="${uf}: ${fmt(v)}">${uf}<small>${fmt(v).replace("R$ ", "")}</small></button>`;
    }).join("");
    legEl.innerHTML = vs.length ? `<span>${fmt(min)}</span><i></i><span>${fmt(max)}</span>` : "";
    el.onclick = (e) => { const b = e.target.closest("[data-uf]"); if (b && aoClicar) aoClicar(b.dataset.uf); };
  }

  // ================================================== mapa do Brasil (SVG)
  // posição do rótulo de cada estado; os pequenos ficam fora, com uma linha
  const UF_ROT = { AC: [58, 228], AL: [626, 240, 583, 233], AP: [336, 62], AM: [150, 150], BA: [500, 290], CE: [538, 160], DF: [446, 318, 409, 330],
    ES: [556, 404, 520, 392], GO: [370, 352], MA: [446, 168], MT: [282, 282], MS: [302, 412], MG: [452, 374], PA: [330, 140], PB: [626, 192, 590, 193],
    PR: [352, 478], PE: [626, 216, 572, 213], PI: [482, 196], RJ: [520, 452, 492, 433], RN: [626, 168, 585, 174], RS: [314, 584], RO: [168, 254],
    RR: [188, 56], SC: [364, 530], SP: [400, 446], SE: [626, 264, 573, 247], TO: [402, 228] };
  function mapaBrasil(el, sel, r) {
    const M = window.MAPA_BR; if (!M) return;
    if (!el.querySelector("svg")) {
      const ufs = Object.keys(M.ufs);
      el.innerHTML = `<svg viewBox="${M.viewBox}" xmlns="http://www.w3.org/2000/svg">
        ${ufs.map((u) => `<path d="${M.ufs[u][1]}" data-uf-i="${u}" tabindex="0" role="button" aria-label="${esc(M.ufs[u][0])} (${u})"><title>${esc(M.ufs[u][0])}</title></path>`).join("")}
        ${ufs.map((u) => { const p = UF_ROT[u] || [0, 0]; return p.length > 2 ? `<line x1="${p[0] - 6}" y1="${p[1] - 4}" x2="${p[2]}" y2="${p[3]}" class="uf-linha"/>` : ""; }).join("")}
        ${ufs.map((u) => { const p = UF_ROT[u] || [0, 0]; return `<text x="${p[0]}" y="${p[1]}" data-uf-i="${u}" data-rot="${u}" class="uf-rot${p.length > 2 ? " fora" : ""}">${u}</text>`; }).join("")}
      </svg><p class="mapa-br-leg" id="i-mapa-leg"></p>`;
    }
    // cor: custo médio por deputado, por mês, no ano atual
    const porUF = {};
    (r?.deputados || []).forEach((d) => { if (!d.uf) return; const o = (porUF[d.uf] = porUF[d.uf] || { t: 0, m: 0 }); o.t += d.custo_mandato; o.m += d.meses; });
    const vals = Object.fromEntries(Object.entries(porUF).map(([k, o]) => [k, o.m ? o.t / o.m : 0]));
    const vs = Object.values(vals).filter((v) => v > 0), min = Math.min(...vs), max = Math.max(...vs);
    el.querySelectorAll("path[data-uf-i]").forEach((p) => {
      const u = p.dataset.ufI, v = vals[u], t = v && max > min ? (v - min) / (max - min) : 0.3;
      const c = [222 - 150 * t, 235 - 110 * t, 247 - 60 * t].map(Math.round);
      p.style.fill = u === sel ? "" : `rgb(${c})`;
      p.classList.toggle("sel", u === sel); p.setAttribute("aria-pressed", String(u === sel));
      const tx = el.querySelector(`text[data-rot="${u}"]`);
      if (tx) tx.classList.toggle("claro", (u === sel || t > 0.62) && !tx.classList.contains("fora"));
      p.querySelector("title").textContent = `${M.ufs[u][0]}${v ? " · " + brl(v * (r?.fator_ipca || 1)) + " por deputado, por mês" : ""}`;
    });
    el.querySelectorAll("text.fora").forEach((t) => t.classList.toggle("sel", t.dataset.rot === sel));
    const leg = el.querySelector("#i-mapa-leg");
    if (leg && vs.length) leg.textContent = `Cor: custo médio de um deputado por mês em ${r.ano} (mais escuro = mais caro).`;
  }

  // ========================================================= impostômetro
  let tick = null;
  function iniciarImpostometro() {
    const r = E.resumoAtual; if (!r) return;
    const p = r.previsao_camara;
    const anos = E.historico?.anos || [];
    const primeiro = anos.length ? Math.min(...anos.map((a) => a.ano)) : 2009;
    const totalAnt = soma(anos.filter((a) => a.ano < r.ano).map((a) => a.total_corrigido));
    $("#d-rot").textContent = `Todos os deputados federais já custaram, desde ${primeiro},`;
    $("#imp-rot").textContent = `Só em ${r.ano}`;
    const ini = new Date(r.ano, r.meses_decorridos, 1).getTime(), fim = new Date(r.ano + 1, 0, 1).getTime();
    const ja = p ? p.ja_gasto : r.total_camara;
    let porSeg = p && r.meses_decorridos < 12 ? p.restante / ((fim - ini) / 1000) : 0;
    let teto = p ? p.total_ano : r.total_camara;
    // sem previsão válida (ex.: robô rodou sem o arquivo da cota): usa a média mensal do ano
    if (!porSeg && r.meses_decorridos > 0 && r.meses_decorridos < 12) {
      const resto = (ja / r.meses_decorridos) * (12 - r.meses_decorridos);
      porSeg = resto / ((fim - ini) / 1000); teto = ja + resto;
    }
    $("#imp-seg").textContent = porSeg ? brl(porSeg, 2) : "—";
    $("#imp-dia").textContent = porSeg ? compacto(porSeg * 86400) : "—";
    $("#imp-prev").textContent = compacto(teto);
    cancelAnimationFrame(tick);
    const passo = () => {
      const v = Math.min(teto, ja + Math.max(0, (Date.now() - ini) / 1000) * porSeg);
      $("#imp-valor").textContent = brl(v, 2);
      $("#imp-total").textContent = brl(totalAnt + v * (r.fator_ipca || 1), 0);
      if (E.pag === "inicio") tick = requestAnimationFrame(passo);
    };
    passo();
  }

  // ===================================================================== KPIs
  function kpis(el, itens) {
    el.innerHTML = itens.map(([rot, val, obs, cor, delta]) => {
      const dl = delta == null || !isFinite(delta) ? "" : `<span class="delta ${delta >= 0 ? "sobe" : "desce"}">${delta >= 0 ? "▲" : "▼"} ${nf(Math.abs(delta * 100), 1)}%</span>`;
      return `<div class="kpi" style="--k:${cor || css("--accent")}"><div class="rot">${rot}</div><div class="val num">${val}${dl}</div><div class="obs">${obs || ""}</div></div>`;
    }).join("");
  }
  // variação contra o ano anterior (com os mesmos filtros), em valores de hoje
  function variacao(f) {
    if (!E.resumoAnt) return null;
    const ant = E.resumoAnt.deputados.filter(passaFiltro);
    const a = f(ant) * (E.resumoAnt.fator_ipca || 1), b = f(filtrados()) * (E.resumo.fator_ipca || 1);
    return a ? b / a - 1 : null;
  }

  // ================================================================ INÍCIO
  function renderInicio() {
    const T = window.TEXTOS || {};
    $("#i-titulo").textContent = T.projeto?.titulo || "Quanto custa um deputado?";
    $("#i-projeto").innerHTML = (T.projeto?.subtitulo ? `<p><b>${T.projeto.subtitulo}</b></p>` : "") +
      (T.projeto?.paragrafos || []).map((p) => `<p>${p}</p>`).join("");
    if ($("#i-sub")) $("#i-sub").textContent = T.projeto?.chamada || "";
    $("#i-compromissos").innerHTML = (T.independencia || []).length ? `<h3 class="d-sec">Nossos compromissos</h3><ul class="compromissos">${T.independencia.map((x) => `<li>${x}</li>`).join("")}</ul>` : "";
    renderKpisInicio();
    renderSeuEstado();
    iniciarImpostometro();
  }

  // --------------------------------------------------- KPIs e busca do início
  function renderKpisInicio() {
    const r = E.resumo || E.resumoAtual, el = $("#i-kpis"); if (!r || !el) return;
    const F = r.fator_ipca || 1, D = r.deputados || [];
    const total = (r.total_camara || D.reduce((s, d) => s + (d.custo_mandato || 0), 0)) * F;
    const cota = D.reduce((s, d) => s + (d.custos?.cota_parlamentar || 0), 0) * F;
    const k = (rot, v, o) => `<div class="kpi"><div class="rot">${rot}</div><div class="val num">${v}</div><div class="obs">${o}</div></div>`;
    const tot = ehTotal(r), nAnos = tot ? Math.max(1, (E.historico?.anos || []).filter((a) => a.deputados > 0).length) : 1;
    el.innerHTML = k("Custo total dos deputados", brlCurto(total), tot ? "soma de todos os anos, em valores de hoje" : `em ${r.ano}, em valores de hoje`)
      + k("Custo médio por cadeira", brlCurto(total / 513 / nAnos), tot ? `por ano (513 vagas, média de ${nAnos} anos)` : `em ${r.ano} (513 vagas)`)
      + k("Cota parlamentar", brlCurto(cota), tot ? "soma de todos os anos" : `usada em ${r.ano}`)
      + k("Parlamentares analisados", D.length.toLocaleString("pt-BR"), "inclui suplentes que assumiram");
    const dl = $("#i-busca-lista");
    if (dl && !dl.options.length) dl.innerHTML = D.map((d) => `<option value="${esc(d.nome)}">${esc(d.partido)} · ${esc(d.uf)}</option>`).join("");
  }
  function buscarDoInicio(ev) {
    ev.preventDefault();
    const q = semAcento($("#i-busca").value.trim()); if (!q) return;
    const D = (E.resumoAtual || E.resumo)?.deputados || [];
    const exato = D.filter((d) => semAcento(d.nome) === q), parcial = D.filter((d) => semAcento(d.nome).includes(q));
    const um = exato.length === 1 ? exato[0] : parcial.length === 1 ? parcial[0] : null;
    if (um) { abrir(um.id); return; }
    E.deps = []; $("#f-busca").value = $("#i-busca").value.trim(); irPara("deputados");
  }

  // ---------------------------------------------------------- seu estado
  const lerUF = () => { try { return localStorage.getItem("qcd_uf") || ""; } catch { return ""; } };
  const salvarUF = (uf) => { try { uf ? localStorage.setItem("qcd_uf", uf) : localStorage.removeItem("qcd_uf"); } catch { /* sem armazenamento */ } };
  function renderSeuEstado(uf = lerUF()) {
    const r = E.resumoAtual || E.resumo; if (!r) return;
    const sel = $("#i-uf");
    if (sel.options.length <= 1) sel.innerHTML = `<option value="">Escolha…</option>` + GRADE_UF.map((g) => g[0]).sort().map((u) => `<option>${u}</option>`).join("");
    sel.value = uf; $("#i-uf-ir").disabled = !uf;
    mapaBrasil($("#i-mapa"), uf, r);
    if (!uf) { $("#i-uf-tit").textContent = "Seu estado em números"; $("#i-uf-corpo").innerHTML = `<p class="sub">Escolha um estado para ver o resumo de ${r.ano}.</p>`; return; }
    const F = r.fator_ipca || 1;
    const deps = r.deputados.filter((d) => d.uf === uf);
    const porUF = {};
    r.deputados.forEach((d) => { if (!d.uf) return; const o = (porUF[d.uf] = porUF[d.uf] || { t: 0, m: 0 }); o.t += d.custo_mandato; o.m += d.meses; });
    const ordem = Object.entries(porUF).map(([k, o]) => [k, o.m ? o.t / o.m : 0]).sort((a, b) => b[1] - a[1]);
    const pos = ordem.findIndex((x) => x[0] === uf) + 1;
    const total = soma(deps.map((d) => d.custo_mandato)), meses = soma(deps.map((d) => d.meses)) || 1;
    const top = deps.slice().sort((a, b) => b.custo_mandato - a.custo_mandato).slice(0, 5);
    $("#i-uf-tit").textContent = `${uf} em ${r.ano}${r.meses_decorridos < 12 ? " (até " + MESES[r.meses_decorridos - 1].toLowerCase() + ")" : ""}`;
    $("#i-uf-corpo").innerHTML = `<div class="uf-num">
        <div><span>Deputados com gastos</span><b>${deps.length}</b></div>
        <div><span>Custo total (valores de hoje)</span><b>${compacto(total * F)}</b></div>
        <div><span>Média por deputado, por mês</span><b>${brl((total / meses) * F)}</b></div>
        <div><span>Posição entre os estados</span><b>${pos ? pos + "º de " + ordem.length : "—"}</b></div></div>
      <p class="sub" style="margin:4px 0">Mais caros do estado:</p>
      <ol class="uf-lista">${top.map((d) => `<li><button class="link-dep" data-dep="${d.id}" data-ano="${r.ano}">${esc(d.nome)}</button><span class="sub">${esc(d.partido || "")} · ${compacto(d.custo_mandato * F)}</span></li>`).join("")}</ol>`;
  }
  function escolherUF(uf) { salvarUF(uf); renderSeuEstado(uf); }
  async function irParaUF() {
    const uf = $("#i-uf").value; if (!uf) return;
    if (E.resumoAtual && +$("#f-ano").value !== E.resumoAtual.ano) await irAno(E.resumoAtual.ano);
    $("#f-uf").value = uf; $("#f-partido").value = ""; $("#f-busca").value = ""; E.deps = []; listaNomes();
    irPara("deputados");
  }

  async function copiar(btn) {
    const txt = btn.dataset.copiar, orig = btn.textContent;
    try { await navigator.clipboard.writeText(txt); btn.textContent = "Copiado ✓"; }
    catch { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); btn.textContent = "Copiado ✓"; }
    setTimeout(() => (btn.textContent = orig), 1800);
  }

  // ============================================================= GLOSSÁRIO
  const GLOSSARIO = {
    ceap: ["Cota parlamentar (CEAP)", "Cota para o Exercício da Atividade Parlamentar: verba mensal para despesas do mandato (passagens, divulgação, combustível, aluguel de carro, escritório…). O deputado paga e a Câmara reembolsa com nota fiscal. O teto varia por estado."],
    gabinete: ["Verba de gabinete", "Valor mensal para pagar os secretários parlamentares, a equipe do deputado (até 25 pessoas). Não vai para o bolso do deputado."],
    subsidio: ["Salário (subsídio)", "Remuneração mensal do deputado, fixada por decreto legislativo. Em 2025 passou para R$ 46.366,19."],
    auxilio: ["Auxílio-moradia", "Valor mensal pago a quem não usa um dos apartamentos funcionais da Câmara em Brasília."],
    ajuda: ["Ajuda de custo", "Pagamento extra igual a um salário: até 2012 eram dois por ano (o '14º e 15º'); desde 2013, um no início e outro no fim do mandato."],
    emenda: ["Emenda parlamentar individual", "Parte do Orçamento que cada deputado indica para obras e serviços em estados, municípios e entidades. Não é gasto com o deputado; por isso fica fora do custo do mandato."],
    empenhado: ["Empenhado", "Quando o governo reserva o dinheiro para uma despesa. Ainda não significa que foi pago."],
    pago: ["Pago", "Dinheiro que efetivamente saiu do caixa do governo."],
    ipca: ["IPCA", "Índice oficial de inflação do Brasil (IBGE). Usamos para levar valores antigos a preços de hoje."],
    valores_hoje: ["Valores de hoje", "Valores de anos anteriores corrigidos pela inflação (IPCA), para comparar 2009 com hoje de forma justa. Desmarque para ver os valores da época."],
    legislatura: ["Legislatura", "Período de 4 anos de um mandato na Câmara. A atual (57ª) vai de fevereiro de 2023 a janeiro de 2027."],
    suplente: ["Suplente", "Quem assume a vaga quando o titular sai (para virar ministro, por licença etc.). Por isso há mais deputados com gastos no ano do que as 513 cadeiras."],
    cota_uso: ["Uso da cota", "Quanto da cota parlamentar disponível no ano o deputado gastou. 100% = usou tudo."],
    ponto: ["Ponto de atenção", "Padrão estatístico fora do comum, calculado automaticamente. Não é acusação nem prova de irregularidade."],
    previsao: ["Previsão", "Estimativa de quanto ainda deve ser gasto até dezembro, com base no ritmo dos últimos meses. Não é dado oficial."],
    sem_nota: ["Sem nota no arquivo aberto", "Valor que está na página oficial do deputado, mas não aparece nota a nota no arquivo aberto da Câmara. Desde agosto de 2025 são, quase sempre, passagens aéreas compradas pelo sistema da Câmara (SIGEPA). Entra no custo, mas não na lista de fornecedores."],
    fornecedor: ["Fornecedor", "Empresa ou pessoa que recebeu dinheiro da cota parlamentar (identificada pelo CNPJ ou CPF da nota)."],
  };
  const T = (k, rot) => `<span class="termo" tabindex="0" data-t="${k}">${rot}</span>`;
  let balaoAlvo = null;
  function mostrarBalao(el) {
    const g = GLOSSARIO[el.dataset.t]; if (!g) return;
    const b = $("#balao"); balaoAlvo = el;
    b.innerHTML = `<b>${g[0]}</b>${g[1]}`; b.hidden = false;
    const r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), innerWidth - bw - 8);
    let y = r.bottom + 8; if (y + bh > innerHeight - 8) y = r.top - bh - 8;
    b.style.left = x + "px"; b.style.top = Math.max(8, y) + "px";
  }
  function esconderBalao() { $("#balao").hidden = true; balaoAlvo = null; }

  // ===================================== posição no ranking, em português claro
  const ORD_M = ["", "", "Segundo", "Terceiro", "Quarto", "Quinto", "Sexto", "Sétimo", "Oitavo", "Nono", "Décimo"];
  const ORD_F = ["", "", "Segunda", "Terceira", "Quarta", "Quinta", "Sexta", "Sétima", "Oitava", "Nona", "Décima"];
  // "Deputado mais caro" · "Segunda deputada mais cara" · "46º deputado mais caro" (metade de baixo: "mais barato")
  function frasePosicao(pos, total, sexo) {
    const f = sexo === "F", barato = total > 2 && pos > total / 2, k = barato ? total - pos + 1 : pos;
    const adj = barato ? (f ? "mais barata" : "mais barato") : (f ? "mais cara" : "mais caro");
    const t = k === 1 ? `${f ? "Deputada" : "Deputado"} ${adj}`
      : k <= 10 ? `${(f ? ORD_F : ORD_M)[k]} ${f ? "deputada" : "deputado"} ${adj}`
      : `${nf(k)}${f ? "ª" : "º"} ${f ? "deputada" : "deputado"} ${adj}`;
    return { titulo: t, sub: `entre ${nf(total)} deputados`, barato };
  }
  const textoPosicao = (d, total) => { const p = frasePosicao(d.posicao, total, d.sexo); return `${p.titulo} ${p.sub}`; };

  // ======================================================= CARDS (imagem)
  const CARD = { fmt: "feed", desenhar: null };
  if (!CanvasRenderingContext2D.prototype.roundRect) {   // navegadores antigos
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
  }
  const FOTOS = new Map();
  function carregarFoto(id) {
    if (!FOTOS.has(id)) FOTOS.set(id, new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `dados/fotos/${id}.jpg`; }));
    return FOTOS.get(id);
  }
  // desenha a foto recortada (ou as iniciais, se não houver foto)
  function desenharFoto(ctx, img, nome, x, y, w, h, raio) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, raio); ctx.clip();
    if (img) { const k = Math.max(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
      ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2.6, iw, ih); }
    else { ctx.fillStyle = "#c7d6ec"; ctx.fillRect(x, y, w, h); ctx.fillStyle = "#1f2a44"; ctx.textAlign = "center";
      ctx.font = `800 ${Math.round(Math.min(w, h) * 0.38)}px Inter, sans-serif`; ctx.fillText(iniciais(nome).toUpperCase(), x + w / 2, y + h / 2 + Math.min(w, h) * 0.13); ctx.textAlign = "left"; }
    ctx.restore();
  }
  function textoAjustado(ctx, txt, max, tam, peso = 800) {
    let t = tam; ctx.font = `${peso} ${t}px Inter, sans-serif`;
    while (ctx.measureText(txt).width > max && t > 24) { t -= 2; ctx.font = `${peso} ${t}px Inter, sans-serif`; }
    return t;
  }
  function moldura(ctx, W, H, titulo) {
    ctx.fillStyle = "#f3f2f1"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1f2a44"; ctx.fillRect(0, 0, W, 150);
    ctx.fillStyle = "#f2c811"; ctx.beginPath(); ctx.roundRect(60, 45, 60, 60, 12); ctx.fill();
    ctx.fillStyle = "#1f2a44"; ctx.font = "800 24px 'Roboto Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("R$", 90, 84);
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "800 36px Inter, sans-serif"; ctx.fillText("Projeto Quanto Custa", 140, 88);
    ctx.fillStyle = "#a9b4cc"; ctx.font = "500 24px Inter, sans-serif"; ctx.fillText(titulo, 140, 122);
    const dt = E.meta?.atualizado_em ? new Date(E.meta.atualizado_em).toLocaleDateString("pt-BR") : "";
    ctx.fillStyle = "#1f2a44"; ctx.fillRect(0, H - 120, W, 120);
    ctx.fillStyle = "#fff"; ctx.font = "700 28px Inter, sans-serif"; ctx.fillText(location.host + location.pathname.replace(/\/$/, ""), 60, H - 66);
    ctx.fillStyle = "#a9b4cc"; ctx.font = "500 20px Inter, sans-serif";
    ctx.fillText(`Fonte: Câmara dos Deputados (dados abertos) · dados de ${dt}${corrigir() ? " · valores corrigidos pelo IPCA" : ""}`, 60, H - 32);
  }
  function cardDeputado(d, ano, rs, fotos = {}) {
    return (ctx, W, H) => {
      const F = corrigir() ? rs?.fator_ipca || 1 : 1, story = H > 1500;
      const tot = String(ano).includes("–"), total = rs?.deputados?.length || 0;
      moldura(ctx, W, H, tot ? `Custo de todos os mandatos (${ano})` : `Custo do mandato em ${ano}`);
      // foto + nome
      let y = story ? 230 : 190;
      const fw = story ? 230 : 190, fh = Math.round(fw * 1.3);
      desenharFoto(ctx, fotos[d.id], d.nome, W - 60 - fw, y, fw, fh, 18);
      const larg = W - 120 - fw - 30;
      ctx.fillStyle = "#252423"; textoAjustado(ctx, d.nome, larg, 66); ctx.fillText(d.nome, 60, y + 70);
      ctx.fillStyle = "#605e5c"; ctx.font = "600 30px Inter, sans-serif";
      ctx.fillText(`${d.partido || ""}-${d.uf || ""}`, 60, y + 120);
      ctx.font = "500 26px Inter, sans-serif";
      ctx.fillText(tot ? `${(d.anos || []).length} ano(s) com mandato` : `${d.meses} ${d.meses === 1 ? "mês" : "meses"} de mandato em ${ano}`, 60, y + 160);
      y += fh + (story ? 50 : 30);
      // faixa de destaque com a posição
      if (total) {
        const fr = frasePosicao(d.posicao, total, d.sexo), hb = story ? 200 : 170;
        ctx.fillStyle = fr.barato ? "#107c41" : "#c4161c"; ctx.beginPath(); ctx.roundRect(60, y, W - 120, hb, 22); ctx.fill();
        ctx.fillStyle = "#fff"; const tt = fr.titulo.toUpperCase(); textoAjustado(ctx, tt, W - 180, story ? 64 : 58, 900); ctx.fillText(tt, 90, y + (story ? 92 : 80));
        ctx.font = `600 ${story ? 34 : 30}px Inter, sans-serif`; ctx.fillStyle = "#ffe9e9";
        ctx.fillText(`${fr.sub}${tot ? " · todos os anos" : " · em " + ano}`, 90, y + (story ? 150 : 130));
        y += hb + (story ? 80 : 62);
      }
      // valor
      ctx.fillStyle = "#605e5c"; ctx.font = "600 30px Inter, sans-serif"; ctx.fillText("Custou aos cofres públicos", 60, y);
      y += story ? 110 : 96; ctx.fillStyle = "#c4161c"; textoAjustado(ctx, brl(d.custo_mandato * F), W - 120, story ? 120 : 104); ctx.fillText(brl(d.custo_mandato * F), 60, y);
      y += 52; ctx.fillStyle = "#252423"; ctx.font = "600 30px Inter, sans-serif";
      ctx.fillText(`${brl(d.custo_mensal_medio * F)} por mês, em média`, 60, y);
      y += story ? 100 : 66;
      const comps = COMP.filter(([k]) => d.custos[k] > 0), max = Math.max(...comps.map(([k]) => d.custos[k]), 1), passo = story ? 92 : 64;
      comps.forEach(([k, rot, cor]) => {
        if (y + 30 > H - 140) return;
        ctx.fillStyle = "#3b3a39"; ctx.font = "600 26px Inter, sans-serif"; ctx.fillText(rot, 60, y);
        ctx.textAlign = "right"; ctx.fillText(brl(d.custos[k] * F), W - 60, y); ctx.textAlign = "left";
        y += 14; ctx.fillStyle = "#e1dfdd"; ctx.beginPath(); ctx.roundRect(60, y, W - 120, 18, 9); ctx.fill();
        ctx.fillStyle = css(cor); ctx.beginPath(); ctx.roundRect(60, y, Math.max(18, (W - 120) * d.custos[k] / max), 18, 9); ctx.fill();
        y += passo - 14;
      });
      if (d.previsao?.ativo && y < H - 230) {
        ctx.fillStyle = "#fdf0f8"; ctx.beginPath(); ctx.roundRect(60, y - 4, W - 120, 80, 12); ctx.fill();
        ctx.fillStyle = "#9c2a6f"; ctx.font = "600 27px Inter, sans-serif";
        ctx.fillText(`Previsão: deve gastar mais ${compacto(d.previsao.restante * F)} até dezembro`, 84, y + 46);
      }
    };
  }
  function cardRanking(deps, ano, rs, contexto, fotos = {}) {
    return (ctx, W, H) => {
      const F = corrigir() ? rs?.fator_ipca || 1 : 1, story = H > 1500;
      moldura(ctx, W, H, `Ranking ${String(ano).includes("–") ? "de todos os anos (" + ano + ")" : "de " + ano}${contexto ? " · " + contexto : ""}`);
      let y = story ? 290 : 232;
      const titR = contexto && deps.length === 1 ? "Deputado escolhido" : `Os ${deps.length} deputados mais caros`;
      ctx.fillStyle = "#252423"; textoAjustado(ctx, titR, W - 120, 56); ctx.fillText(titR, 60, y);
      y += 46; ctx.fillStyle = "#605e5c"; ctx.font = "500 26px Inter, sans-serif"; ctx.fillText(`Custo do mandato ${String(ano).includes("–") ? "somado de " + ano : "em " + ano}: salário, auxílios, cota e gabinete`, 60, y);
      y += story ? 70 : 42;
      const max = Math.max(...deps.map((d) => d.custo_mandato), 1), passo = story ? 128 : 90;
      const total = rs?.deputados?.length || 0, ft = story ? 96 : 70, x0 = 60 + 76 + ft + 18;
      deps.forEach((d, i) => {
        const pos = d.posicao || i + 1;
        if (i === 0) { ctx.fillStyle = "#fde7e7"; ctx.beginPath(); ctx.roundRect(44, y - 10, W - 88, ft + 20, 14); ctx.fill(); }
        ctx.fillStyle = i === 0 ? "#c4161c" : "#118dff"; ctx.font = "800 30px 'Roboto Mono', monospace"; ctx.fillText(pos + "º", 60, y + ft / 2 + 11);
        desenharFoto(ctx, fotos[d.id], d.nome, 60 + 76, y, ft, ft, ft / 2);
        ctx.fillStyle = "#252423"; ctx.font = "700 29px Inter, sans-serif";
        const nome = `${d.nome} (${d.partido || ""}-${d.uf || ""})`, lim = W - x0 - 220;
        let nm = nome; while (ctx.measureText(nm).width > lim && nm.length > 8) nm = nm.slice(0, -2); if (nm !== nome) nm += "…";
        ctx.fillText(nm, x0, y + ft / 2 - 4);
        ctx.textAlign = "right"; ctx.fillStyle = "#c4161c"; ctx.font = "800 30px Inter, sans-serif"; ctx.fillText(compacto(d.custo_mandato * F), W - 60, y + ft / 2 - 4); ctx.textAlign = "left";
        if (i === 0 && total) { ctx.fillStyle = "#c4161c"; ctx.font = "800 20px Inter, sans-serif"; ctx.fillText(frasePosicao(pos, total, d.sexo).titulo.toUpperCase(), x0, y + ft / 2 + 30); }
        else { ctx.fillStyle = "#e1dfdd"; ctx.beginPath(); ctx.roundRect(x0, y + ft / 2 + 14, W - 60 - x0, 12, 6); ctx.fill();
          ctx.fillStyle = "#118dff"; ctx.beginPath(); ctx.roundRect(x0, y + ft / 2 + 14, Math.max(12, (W - 60 - x0) * d.custo_mandato / max), 12, 6); ctx.fill(); }
        y += passo;
      });
    };
  }
  async function abrirCard(fazer, nomeArq, ids = []) {
    const lista = await Promise.all(ids.map(carregarFoto));
    const fotos = Object.fromEntries(ids.map((id, i) => [id, lista[i]]));
    CARD.desenhar = fazer(fotos); CARD.nome = nomeArq;
    $$("#dlg-card [data-fmt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fmt === CARD.fmt)));
    if (!$("#dlg-card").open) $("#dlg-card").showModal();
    await document.fonts.ready.catch(() => {});
    redesenharCard();
  }
  function redesenharCard() {
    const cv = $("#card-canvas"), W = 1080, H = CARD.fmt === "story" ? 1920 : 1350;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"); ctx.textBaseline = "alphabetic";
    CARD.desenhar(ctx, W, H);
  }
  function blobCard() { return new Promise((ok) => $("#card-canvas").toBlob(ok, "image/png")); }
  async function baixarCard() {
    const b = await blobCard(), a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = CARD.nome + ".png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function compartilharCard() {
    const b = await blobCard(), arq = new File([b], CARD.nome + ".png", { type: "image/png" });
    const url = location.origin + location.pathname;
    if (navigator.canShare && navigator.canShare({ files: [arq] })) {
      try { await navigator.share({ files: [arq], title: "Projeto Quanto Custa", text: `Veja mais em ${url}` }); } catch { /* cancelado */ }
    } else baixarCard();
  }

  // =========================================================== VISÃO GERAL
  function renderGeral() {
    const deps = filtrados(), F = fator();
    const total = soma(deps.map((d) => d.custo_mandato));
    const mesesDep = soma(deps.map((d) => d.meses)) || 1;
    const maior = deps.slice().sort((a, b) => b.custo_mandato - a.custo_mandato)[0];
    const md = E.resumo.meses_decorridos;
    const periodo = ehTotal() ? `soma de ${rotuloAno()}${corrigir() ? " · valores de hoje" : " · valores da época"}`
      : md < 12 ? `jan–${MESES[md - 1].toLowerCase()}/${E.resumo.ano}` : `${E.resumo.ano} completo`;
    const comparavel = md === 12 && E.resumoAnt;
    kpis($("#kpis"), [
      ["Custo dos mandatos", compacto(R(total)), periodo, css("--c-salario"), comparavel ? variacao((x) => soma(x.map((d) => d.custo_mandato))) : null],
      ["Por deputado, por mês", brl(R(total / mesesDep)), "média do período", css("--c-gabinete"),
        comparavel ? variacao((x) => soma(x.map((d) => d.custo_mandato)) / (soma(x.map((d) => d.meses)) || 1)) : null],
      [T("ceap", "Cota parlamentar"), compacto(R(soma(deps.map((d) => d.custos.cota_parlamentar)))), ehTotal() ? "reembolsos de todos os anos" : "reembolsos do ano", css("--c-cota"),
        comparavel ? variacao((x) => soma(x.map((d) => d.custos.cota_parlamentar))) : null],
      ["Deputados", nf(deps.length), `com gastos no período (inclui ${T("suplente", "suplentes")})`, css("--c-ajuda")],
      ["Maior custo", maior ? compacto(R(maior.custo_mandato)) : "—", maior ? `${esc(maior.nome)} (${esc(maior.partido || "")}-${esc(maior.uf || "")})` : "", css("--danger")],
      [T("emenda", "Emendas") + " " + T("empenhado", "empenhadas"), compacto(R(soma(deps.map((d) => d.emendas_empenhado)))), "fora do custo do mandato", css("--c-emenda")],
    ]);

    // gasto por mês (ou por ano, no total)
    $("#g-mes").closest(".visual").querySelector("h2").textContent = ehTotal() ? "Gasto por ano" : "Gasto por mês";
    if (ehTotal()) {
      const anosT = E.resumo.anos, porAno = anosT.map((a) => soma(deps.map((d) => (d.por_ano || {})[a] || 0)));
      $("#dica-mes").hidden = true;
      grafico("g-mes", { type: "bar", data: { labels: anosT, datasets: [{ label: corrigir() ? "Custo (valores de hoje)" : "Custo (valores da época)",
        data: porAno, backgroundColor: css("--accent"), borderRadius: 3 }] },
        options: { scales: { x: { grid: { display: false } }, y: { ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: { display: false } },
          onClick: (_, el) => { if (el.length) irAno(anosT[el[0].index]); } } });
    } else {
    const fx = Array(12).fill(0), ct = Array(12).fill(0), gb = Array(12).fill(0);
    deps.forEach((d) => { const m = mensal(d); for (let i = 0; i < 12; i++) { fx[i] += m.fixo[i]; ct[i] += m.cota[i]; gb[i] += m.gabinete[i]; } });
    const saz = E.resumo.previsao_camara?.sazonalidade, prev = Array(12).fill(null);
    if (saz && md < 12) deps.forEach((d) => { const p = d.previsao; if (!p?.ativo) return;
      const base = mensal(d).fixo[md - 1] || 0; for (let i = md; i < 12; i++) prev[i] = (prev[i] || 0) + p.ritmo_mensal_variavel * saz[i] + base; });
    $("#dica-mes").hidden = !(saz && md < 12);
    grafico("g-mes", { type: "bar", data: { labels: MESES, datasets: [
      { label: "Salários, ajudas e auxílio", data: fx.map((v, i) => (i < md ? v * F : null)), backgroundColor: css("--c-salario"), stack: "s" },
      { label: "Cota parlamentar", data: ct.map((v, i) => (i < md ? v * F : null)), backgroundColor: css("--c-cota"), stack: "s" },
      { label: "Verba de gabinete", data: gb.map((v, i) => (i < md ? v * F : null)), backgroundColor: css("--c-gabinete"), stack: "s" },
      { label: "Previsão", data: prev.map((v) => (v == null ? null : v * F)), backgroundColor: "rgba(224,68,167,.12)", borderColor: css("--c-prev"), borderWidth: 1.5, borderDash: [5, 4], stack: "s" },
    ] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
    }

    // composição
    const comp = COMP.map(([k]) => soma(deps.map((d) => d.custos[k])) * F);
    grafico("g-comp", { type: "doughnut", data: { labels: COMP.map((c) => c[1]), datasets: [{ data: comp, backgroundColor: COMP.map((c) => css(c[2])), borderColor: "#fff", borderWidth: 2 }] },
      options: { cutout: "60%", plugins: { legend: legBaixo, tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)} (${nf(100 * c.parsed / (soma(comp) || 1), 1)}%)` } } } } });

    // categorias da cota
    const cats = {};
    deps.forEach((d) => Object.entries(d.categorias || {}).forEach(([k, v]) => (cats[k] = (cats[k] || 0) + v)));
    const cl = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 12);
    barraH("g-cat", cl.map((c) => c[0]), cl.map((c) => c[1] * F), css("--c-cota"), {
      onClick: (_, el) => { if (el.length) { $("#r-cat").value = cl[el[0].index][0]; irPara("rankings"); } } });

    // mapa por UF (custo médio mensal por deputado)
    const porUF = {};
    deps.forEach((d) => { if (!d.uf) return; const u = (porUF[d.uf] = porUF[d.uf] || { t: 0, m: 0 }); u.t += d.custo_mandato; u.m += d.meses; });
    const vUF = Object.fromEntries(Object.entries(porUF).map(([k, v]) => [k, v.m ? (v.t / v.m) * F : 0]));
    mapa($("#mapa-geral"), $("#mapa-geral-leg"), vUF, (v) => compacto(v), (uf) => { $("#f-uf").value = $("#f-uf").value === uf ? "" : uf; atualizar(); }, $("#f-uf").value);

    // por partido
    const met = $("#partido-metrica").value, gp = {};
    deps.forEach((d) => { const k = d.partido || "—"; const g = (gp[k] = gp[k] || { t: 0, n: 0 }); g.t += d.custo_mandato; g.n++; });
    const pl = Object.entries(gp).map(([k, v]) => [k, met === "media" ? v.t / v.n : v.t, v.n]).sort((a, b) => b[1] - a[1]).slice(0, 22);
    barraH("g-partido", pl.map((p) => p[0]), pl.map((p) => p[1] * F), pl.map((p) => (p[0] === $("#f-partido").value ? css("--c-prev") : css("--accent"))), {
      tooltip: { callbacks: { label: (c) => `${brl(c.parsed.x)} · ${pl[c.dataIndex][2]} deputado(s)` } },
      onClick: (_, el) => { if (!el.length) return; const v = pl[el[0].index][0]; $("#f-partido").value = $("#f-partido").value === v ? "" : v; atualizar(); } });

    // distribuição do custo mensal
    const vals = deps.filter((d) => d.meses >= 3).map((d) => R(d.custo_mensal_medio));
    if (vals.length) {
      const passo = 10000, lo = Math.floor(Math.min(...vals) / passo) * passo, hi = Math.ceil(Math.max(...vals) / passo) * passo;
      const faixas = []; for (let x = lo; x < hi; x += passo) faixas.push(x);
      const cont = faixas.map((x) => vals.filter((v) => v >= x && v < x + passo).length);
      grafico("g-hist-dist", { type: "bar", data: { labels: faixas.map((x) => nf(x / 1000) + "–" + nf((x + passo) / 1000) + " mil"),
        datasets: [{ label: "Deputados", data: cont, backgroundColor: css("--accent"), barPercentage: 1, categoryPercentage: .95 }] },
        options: { scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
    }
    // dispersão cota × gabinete
    const pts = deps.filter((d) => d.meses >= 3);
    grafico("g-disp", { type: "scatter", data: { datasets: [{ data: pts.map((d) => ({ x: R(d.custos.cota_parlamentar), y: R(d.custos.verba_gabinete) })),
      backgroundColor: "rgba(17,141,255,.55)", pointRadius: 3.5, pointHoverRadius: 6 }] },
      options: { scales: { x: { title: { display: true, text: "Cota parlamentar" }, ticks: tickBRL }, y: { title: { display: true, text: "Verba de gabinete" }, ticks: tickBRL } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${pts[c.dataIndex].nome} (${pts[c.dataIndex].partido}-${pts[c.dataIndex].uf}): cota ${compacto(c.parsed.x)}, gabinete ${compacto(c.parsed.y)}` } } },
        onClick: (_, el) => { if (el.length) abrir(pts[el[0].index].id); } } });
  }

  // ============================================================ DEPUTADOS
  function cardDoRanking() {
    const deps = filtrados().slice().sort((a, b) => b.custo_mandato - a.custo_mandato).slice(0, 10);
    if (!deps.length) return;
    const ctx = [$("#f-uf").value, $("#f-partido").value, E.deps.length ? (E.deps.length === 1 ? nomeDeId(E.deps[0]) : "deputados escolhidos") : ""].filter(Boolean).join(" · ");
    abrirCard((fotos) => cardRanking(deps, rotuloAno(), E.resumo, ctx, fotos), `ranking-${E.resumo.ano}${ctx ? "-" + semAcento(ctx).replace(/\W+/g, "-") : ""}`, deps.map((d) => d.id));
  }

  function kpisDeputados(deps) {
    const F = fator(), n = deps.length, todos = E.resumo.deputados.length;
    if (!n) { kpis($("#dep-kpis"), []); return; }
    const tot = soma(deps.map((d) => d.custo_mandato)), meses = soma(deps.map((d) => d.meses)) || 1;
    const ord = deps.slice().sort((a, b) => b.custo_mandato - a.custo_mandato), caro = ord[0];
    const ativos = deps.filter((d) => d.meses >= 3), barato = ativos.slice().sort((a, b) => a.custo_mensal_medio - b.custo_mensal_medio)[0];
    const med = quantil(ativos.map((d) => d.custo_mensal_medio), 0.5);
    const usos = deps.filter((d) => d.cota_uso != null).map((d) => d.cota_uso);
    const pts = soma(deps.map((d) => d.pontos || 0)), comPts = deps.filter((d) => d.pontos).length;
    const prev = soma(deps.map(previsto));
    const quem = (d) => d ? `${esc(d.nome)} (${esc(d.partido || "")}-${esc(d.uf || "")})` : "";
    kpis($("#dep-kpis"), [
      ["Deputados na lista", nf(n), n < todos ? `de ${nf(todos)} com gastos em ${esc(rotuloAno())}` : `com gastos em ${esc(rotuloAno())}`, css("--c-ajuda")],
      ["Custo somado", compacto(R(tot)), ehTotal() ? "todos os anos" : E.resumo.meses_decorridos < 12 ? `até ${MESES[E.resumo.meses_decorridos - 1].toLowerCase()}/${E.resumo.ano}` : `em ${E.resumo.ano}`, css("--c-salario")],
      ["Custo médio por mês", brl(R(tot / meses)), `metade custa até ${brl(R(med))} (mediana)`, css("--c-gabinete")],
      ["Mais caro da lista", caro ? compacto(R(caro.custo_mandato)) : "—", caro ? `${quem(caro)} · ${esc(textoPosicao(caro, todos))}` : "", css("--danger")],
      ["Mais econômico por mês", barato ? brl(R(barato.custo_mensal_medio)) : "—", barato ? quem(barato) + " · com 3 meses ou mais" : "", css("--ok")],
      ...(usos.length ? [[T("cota_uso", "Uso médio da cota"), nf(100 * soma(usos) / usos.length) + "%", `${nf(usos.filter((u) => u >= 0.9).length)} usaram 90% ou mais`, css("--c-cota")]] : []),
      ...(prev > 0 ? [[T("previsao", "Previsão até dezembro"), "+" + compacto(R(prev)), "o que ainda devem gastar", css("--c-prev")]] : []),
      [T("ponto", "Pontos de atenção"), nf(pts), `em ${nf(comPts)} deputado(s)`, "#d13438"],
    ]);
  }

  // projetos aprovados por deputado no período escolhido (arquivo dos projetos)
  const REL_MIN = { ano: 1, total: 3 };   // etiqueta: relevantes como 1º autor no ano (ou em todos os anos)
  function projDe(id) {
    const p = E.PD?.[String(id)]; if (!E.PD) return null;
    if (!p) return { aprov: 0, rel: 0, sup: 0, relAutor: 0 };
    if (ehTotal()) return { aprov: p.aprovados, rel: (p.alto || 0) + (p.medio || 0), sup: (p.baixo || 0) + (p.simbolico || 0), relAutor: p.rel_autor || 0 };
    const y = (p.anos || {})[String(E.resumo.ano)] || [];
    return { aprov: y[0] || 0, rel: (y[2] || 0) + (y[3] || 0), sup: (y[5] || 0) + (y[6] || 0), relAutor: y[7] || 0 };
  }
  const aprovaRelevantes = (pj) => pj && pj.relAutor >= (ehTotal() ? REL_MIN.total : REL_MIN.ano);

  function renderDeputados() {
    if (E.PD === undefined) { E.PD = null; projPorDep().then((pd) => { E.PD = pd || {}; if (E.pag === "deputados") renderDeputados(); }).catch(() => { E.PD = {}; }); }
    const deps = filtrados(), temPrev = E.resumo.meses_decorridos < 12;
    kpisDeputados(deps);
    const cols = [["sel", "", ""], ["posicao", "#", "num"], ["nome", "Deputado", ""], ["custo_mandato", "Custo no ano", "num"], ["custo_mensal_medio", "Por mês", "num"],
      ["cota_parlamentar", T("ceap", "Cota"), "num"], ["cota_uso", T("cota_uso", "Uso da cota"), "num"], ["verba_gabinete", T("gabinete", "Gabinete"), "num"],
      ...(temPrev ? [["previsto", T("previsao", "Previsão até dez"), "num"]] : []), ["pontos", T("ponto", "Atenção"), "num"], ["emendas_empenhado", T("emenda", "Emendas"), "num"],
      ["proj_aprov", `<span title="Projetos aprovados em que o deputado é autor ou coautor">Projetos aprovados</span>`, "num"],
      ["proj_rel", `<span title="Relevância alta ou média: mudanças que afetam muita gente (saúde, educação, trabalho, renda, segurança…)">Relevantes</span>`, "num"],
      ["proj_sup", `<span title="Relevância baixa ou simbólica: homenagens, datas comemorativas, nomes de rodovias e prédios, concessões de rádio e TV">Supérfluos</span>`, "num"]];
    const k = E.ordem;
    const PJ = { proj_aprov: "aprov", proj_rel: "rel", proj_sup: "sup" };
    const val = (d) => (k === "previsto" ? previsto(d) : k === "nome" ? d.nome : PJ[k] ? (projDe(d.id) || {})[PJ[k]] || 0 : valorDe(d, k) || 0);
    const ord = deps.slice().sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "string" ? x.localeCompare(y, "pt-BR") : x - y; return E.asc ? r : -r; });
    const max = Math.max(...deps.map((d) => d.custo_mandato), 1);
    $("#ranking").innerHTML = `<thead><tr>${cols.map(([c, t, cl]) => `<th class="${cl}" data-col="${c}" ${c === k ? `aria-sort="${E.asc ? "ascending" : "descending"}"` : ""}>${t}</th>`).join("")}</tr></thead>
      <tbody>${ord.slice(0, E.limite).map((d) => { const pj = projDe(d.id); return `<tr>
        <td><input type="checkbox" data-sel="${d.id}" ${E.sel.includes(d.id) ? "checked" : ""} aria-label="Comparar ${esc(d.nome)}"></td>
        <td class="num sub">${d.posicao}º</td>
        <td class="nome-cel"><button class="link-dep" data-dep="${d.id}">${esc(d.nome)}</button> <span class="sub">${esc(d.partido || "s/ partido")}-${esc(d.uf || "")}</span>
          ${aprovaRelevantes(pj) ? `<span class="etq-relevante" title="Primeiro autor de ${nf(pj.relAutor)} projeto(s) de relevância alta ou média aprovado(s) ${ehTotal() ? "desde 2009" : "em " + E.resumo.ano}">Aprova projetos relevantes</span>` : ""}
          <div class="mini-barra" aria-hidden="true">${COMP.map(([c, , cor]) => `<i style="width:${(100 * (d.custos[c] || 0) / max).toFixed(2)}%;background:var(${cor})"></i>`).join("")}</div></td>
        <td class="num"><b>${brl(R(d.custo_mandato))}</b></td><td class="num">${brl(R(d.custo_mensal_medio))}</td>
        <td class="num">${brl(R(d.custos.cota_parlamentar))}</td><td class="num">${d.cota_uso != null ? nf(d.cota_uso * 100) + "%" : "—"}</td>
        <td class="num">${brl(R(d.custos.verba_gabinete))}</td>
        ${temPrev ? `<td class="num prev-cel">${d.previsao?.ativo ? "+" + compacto(R(d.previsao.restante)) : "—"}</td>` : ""}
        <td class="num">${d.pontos ? `<span class="selo-pt" data-dep="${d.id}">${d.pontos}</span>` : ""}</td>
        <td class="num">${compacto(R(d.emendas_empenhado))}</td>
        <td class="num">${pj ? nf(pj.aprov) : "…"}</td><td class="num">${pj ? `<b style="color:var(--ok)">${nf(pj.rel)}</b>` : "…"}</td><td class="num">${pj ? nf(pj.sup) : "…"}</td></tr>`; }).join("") || `<tr><td colspan="14" class="sub">Nenhum deputado com esses filtros.</td></tr>`}</tbody>`;
    $("#mais").hidden = ord.length <= E.limite;
    $("#mais").textContent = `Mostrar mais (${ord.length - E.limite} restantes)`;
  }

  // ============================================================== COMPARAR
  function atualizarSelecao() {
    const n = E.sel.length;
    $("#n-comp").hidden = !n; $("#n-comp").textContent = n;
    $("#ir-comparar").hidden = n < 2 || E.pag === "comparar";
    $("#n-comp2").textContent = `(${n})`;
  }
  function alternarSel(id) {
    id = +id;
    if (E.sel.includes(id)) E.sel = E.sel.filter((x) => x !== id);
    else if (E.sel.length < MAX_COMP) E.sel.push(id);
    else { alert(`Dá para comparar até ${MAX_COMP} deputados por vez.`); return false; }
    atualizarSelecao(); salvarURL(); return true;
  }
  async function renderComparar() {
    const mapaD = new Map(E.resumo.deputados.map((d) => [d.id, d]));
    $("#lista-deps").innerHTML = E.resumo.deputados.map((d) => `<option value="${esc(d.nome)} (${esc(d.partido || "")}-${esc(d.uf || "")})"></option>`).join("");
    const deps = E.sel.map((id) => mapaD.get(id)).filter(Boolean);
    const fora = E.sel.length - deps.length;
    $("#chips").innerHTML = deps.map((d, i) => `<span class="chip" style="--c:${CORES[i]}">${esc(d.nome)} <span class="sub">${esc(d.partido || "")}-${esc(d.uf || "")}</span>
      <button data-tirar="${d.id}" aria-label="Remover ${esc(d.nome)}">×</button></span>`).join("") + (fora ? `<span class="sub">${fora} selecionado(s) sem mandato em ${E.resumo.ano}.</span>` : "");
    const ok = deps.length >= 2;
    $("#comp-vazio").hidden = ok; $("#comp-conteudo").hidden = !ok;
    if (!ok) return;
    const F = fator(), temPrev = E.resumo.meses_decorridos < 12;
    const linhas = [
      ["Partido / estado", (d) => `${esc(d.partido || "")}-${esc(d.uf || "")}`, null],
      ["Meses em exercício", (d) => d.meses, (d) => d.meses],
      ["Custo no ano", (d) => brl(R(d.custo_mandato)), (d) => d.custo_mandato],
      ["Custo médio por mês", (d) => brl(R(d.custo_mensal_medio)), (d) => d.custo_mensal_medio],
      ...COMP.map(([k, rot]) => [rot, (d) => brl(R(d.custos[k])), (d) => d.custos[k]]),
      ["Uso da cota", (d) => (d.cota_uso != null ? nf(d.cota_uso * 100) + "%" : "—"), (d) => d.cota_uso || 0],
      ...(temPrev ? [["Previsão até dezembro", (d) => (d.previsao?.ativo ? "+" + brl(R(d.previsao.restante)) : "—"), previsto]] : []),
      ["Pontos de atenção", (d) => d.pontos || 0, (d) => d.pontos || 0],
      ["Emendas empenhadas", (d) => brl(R(d.emendas_empenhado)), (d) => d.emendas_empenhado],
      ...(ehTotal() ? [["Anos com mandato", (d) => (d.anos || []).length, (d) => (d.anos || []).length]] : []),
      ["Posição no ranking", (d) => `${d.posicao}º de ${E.resumo.deputados.length}`, null],
    ];
    $("#comp-tab").innerHTML = `<thead><tr><th></th>${deps.map((d, i) => `<th class="num" style="color:${CORES[i]}">${esc(d.nome)}</th>`).join("")}</tr></thead><tbody>${linhas.map(([rot, fmt, num]) => {
      const vs = num ? deps.map(num) : []; const max = num && new Set(vs).size > 1 ? Math.max(...vs) : null;
      return `<tr><td>${rot}</td>${deps.map((d) => `<td class="num ${num && num(d) === max && max > 0 ? "maior" : ""}">${fmt(d)}</td>`).join("")}</tr>`; }).join("")}</tbody>`;
    $("#g-comp-mes").closest(".visual").querySelector("h2").textContent = ehTotal() ? "Custo por ano" : "Gasto por mês (cota + gabinete)";
    if (ehTotal()) {
      const anosT = E.resumo.anos;
      grafico("g-comp-mes", { type: "bar", data: { labels: anosT, datasets: deps.map((d, i) => ({ label: d.nome, backgroundColor: CORES[i], borderRadius: 2,
        data: anosT.map((a) => (d.por_ano || {})[a] || null) })) },
        options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
    } else
    grafico("g-comp-mes", { type: "bar", data: { labels: MESES, datasets: deps.map((d, i) => ({ label: d.nome, backgroundColor: CORES[i], borderRadius: 2,
      data: MESES.map((_, m) => (mensal(d).cota[m] + mensal(d).gabinete[m]) * F || null) })) },
      options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
    grafico("g-comp-comp", { type: "bar", data: { labels: deps.map((d) => d.nome), datasets: COMP.map(([k, rot, cor]) => ({ label: rot, backgroundColor: css(cor), data: deps.map((d) => d.custos[k] * F) })) },
      options: { indexAxis: "y", scales: { x: { stacked: true, ticks: tickBRL }, y: { stacked: true, grid: { display: false } } }, plugins: { tooltip: tipBRL("x"), legend: legBaixo } } });
    const cats = [...new Set(deps.flatMap((d) => Object.keys(d.categorias || {})))]
      .sort((a, b) => soma(deps.map((d) => (d.categorias || {})[b])) - soma(deps.map((d) => (d.categorias || {})[a]))).slice(0, 8);
    grafico("g-comp-cat", { type: "bar", data: { labels: cats, datasets: deps.map((d, i) => ({ label: d.nome, backgroundColor: CORES[i], data: cats.map((c) => ((d.categorias || {})[c] || 0) * F) })) },
      options: { indexAxis: "y", scales: { x: { ticks: tickBRL }, y: { grid: { display: false } } }, plugins: { tooltip: tipBRL("x"), legend: legBaixo } } });
    const trajs = await Promise.all(deps.map((d) => cache("t" + d.id, () => getJSON(`dados/deputados/${d.id}.json`))));
    const anos = [...new Set(trajs.flatMap((t) => (t?.anos || []).map((a) => a.ano)))].sort();
    grafico("g-comp-traj", { type: "line", data: { labels: anos, datasets: deps.map((d, i) => ({ label: d.nome, borderColor: CORES[i], backgroundColor: CORES[i], tension: .25,
      data: anos.map((ano) => { const a = (trajs[i]?.anos || []).find((x) => x.ano === ano); if (!a) return null;
        return corrigir() ? a.custo_mensal_medio * (a.custo_mandato_corrigido / (a.custo_mandato || 1)) : a.custo_mensal_medio; }) })) },
      options: { scales: { y: { ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
  }

  // ========================================================== FORNECEDORES
  const URL_NOTA = "https://www.camara.leg.br/cota-parlamentar/";
  function urlNota(u, ano) {
    if (!u) return null;
    let m = /^p(\d+)\/(\d+)$/.exec(u);
    if (m) return `${URL_NOTA}documentos/publ/${m[1]}/${ano}/${m[2]}.pdf`;
    m = /^e(\d+)$/.exec(u);
    if (m) return `${URL_NOTA}nota-fiscal-eletronica?ideDocumentoFiscal=${m[1]}`;
    return /^https?:/.test(u) ? u : URL_NOTA + u;
  }
  const linkNota = (u, ano) => { const l = urlNota(u, ano); return l ? `<a class="link-nota" href="${esc(l)}" target="_blank" rel="noopener">ver nota ↗</a>` : `<span class="sub">—</span>`; };
  const grupoForn = (k) => { let s = 0; for (let i = 0; i < k.length; i++) s += (i + 1) * k.charCodeAt(i); return (s % 256).toString(16).padStart(2, "0"); };
  const etqTipo = (t) => (t === "PJ" ? `<span class="etq pj">Empresa</span>` : t === "PF" ? `<span class="etq pf">Pessoa física</span>` : `<span class="etq">sem documento</span>`);
  const nomeDep = (id, rs = E.resumo) => { const d = (rs?.deputados || []).find((x) => x.id === id); return d ? d : { id, nome: "Deputado " + id }; };
  const dataCurta = (s) => (s ? s.split("-").reverse().join("/") : "—");
  const mmdd = (v, ano) => { const m = Math.floor(v / 100), d = v % 100; return m ? `${String(d || 1).padStart(2, "0")}/${String(m).padStart(2, "0")}/${ano}` : "—"; };

  async function dadosForn() {
    const arq = ehTotal() ? `total/${corrigir() ? "fornecedores" : "fornecedores_nominal"}` : `${E.resumo.ano}/fornecedores`;
    return cache("forn" + arq, () => getJSON(`dados/${arq}.json`));
  }

  // várias tarefas assíncronas, poucas por vez (para não sobrecarregar o celular)
  async function emLotes(tarefas, n = 6) {
    const out = new Array(tarefas.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, async () => { while (i < tarefas.length) { const k = i++; out[k] = await tarefas[k](); } }));
    return out;
  }
  const tipoDaChave = (k) => (/^\d{14}$/.test(k) ? "PJ" : String(k).startsWith("pf") ? "PF" : "—");
  const fatorDoAno = (a) => (corrigir() ? ((E.historico?.anos || []).find((x) => x.ano === +a)?.fator_ipca || 1) : 1);
  const LIMITE_DEPS_FORN = 150;

  // filtro só por partido OU só por estado: usa os resumos prontos do robô (forn_grupos),
  // que somam todas as notas do grupo no ano — rápido e funciona também em "Todos os anos"
  function grupoDoFiltro() {
    if (E.deps.length || textoBusca()) return null;
    const uf = $("#f-uf").value, pa = $("#f-partido").value;
    if (uf && pa) return null;
    return uf ? "U-" + uf : pa ? "P-" + pa : null;
  }
  async function fornGrupo(g) {
    const tot = ehTotal();
    const anos = tot ? (E.historico?.anos || []).map((a) => a.ano) : [E.resumo.ano];
    const chave = `grp:${g}:${tot ? "T" + (corrigir() ? "c" : "n") : E.resumo.ano}`;
    if (E.cache[chave]) return E.cache[chave];
    if (tot) { $("#f-aviso").hidden = false; $("#f-aviso").textContent = `Somando ${anos.length} anos de notas de ${g.slice(2)}…`; }
    const arqs = await emLotes(anos.map((a) => () => getJSON(`dados/${a}/forn_grupos/${g}.json`).catch(() => null)));
    const ok = arqs.map((x, i) => [x, anos[i]]).filter(([x]) => x);
    if (!ok.length) return null;                       // robô ainda não gerou: volta ao cálculo antigo
    const faltam = anos.filter((a, i) => !arqs[i]);
    if (ok.length === 1 && !tot) {                      // um ano só: o arquivo já vem pronto
      const [x] = ok[0];
      return (E.cache[chave] = { ...x, agregado: true, nDeps: x.n_deps, maior: (x.maiores_notas || [])[0], grupo: g, faltam });
    }
    const forn = new Map(), catT = new Map(), tipos = {}, notas = [];
    let total = 0, nNotas = 0;
    const depsGrupo = new Set();
    for (const [x, a] of ok) {
      const k = fatorDoAno(a);
      total += x.total * k; nNotas += x.notas;
      (x.por_categoria || []).forEach(([c, v, , n]) => { const o = catT.get(c) || { valor: 0, notas: 0, forn: new Set() }; o.valor += v * k; o.notas += n; catT.set(c, o); });
      Object.entries(x.por_tipo || {}).forEach(([t, v]) => { const o = (tipos[t] = tipos[t] || { valor: 0, notas: 0, f: new Set() }); o.valor += v.valor * k; o.notas += v.notas; });
      const add = (ch, nome, doc, tipo, v, n, deps, cats) => {
        let o = forn.get(ch);
        if (!o) forn.set(ch, (o = { chave: ch, nome: "", doc: doc || "", tipo, valor: 0, notas: 0, deps: new Set(), cat: {}, catN: {}, semDeps: false }));
        if (nome && !o.nome) o.nome = nome;
        o.valor += v * k; o.notas += n;
        if (deps) deps.forEach((d) => { o.deps.add(d); depsGrupo.add(d); }); else o.semDeps = true;
        if (cats) Object.entries(cats).forEach(([ci, [cv, cn]]) => { const c = x.cats[+ci]; o.cat[c] = (o.cat[c] || 0) + cv * k; o.catN[c] = (o.catN[c] || 0) + cn; catT.get(c)?.forn.add(ch); });
        tipos[tipo]?.f.add(ch);
      };
      x.linhas.forEach((l) => add(l[0], l[1], l[2], l[3], l[5], l[6], l[9], l[8]));
      (x.resto || []).forEach(([ch, t, v, n]) => add(ch, "", "", t, v, n, null, null));
      (x.maiores_notas || []).forEach((m) => notas.push([m[0], m[1] * k, ...m.slice(2), a]));
    }
    const cats = [...catT.entries()].sort((a, b) => b[1].valor - a[1].valor).map((c) => c[0]), ci = new Map(cats.map((c, i) => [c, i]));
    const lista = [...forn.values()].sort((a, b) => b.valor - a.valor);
    const linhas = lista.map((o) => { const princ = Object.entries(o.cat).sort((a, b) => b[1] - a[1])[0];
      return [o.chave, o.nome || docFmt(o.doc) || "(fornecedor menor — abra para ver)", o.doc, o.tipo, princ ? ci.get(princ[0]) : 0, o.valor, o.notas,
        o.deps.size, Object.fromEntries(Object.entries(o.cat).map(([c, v]) => [String(ci.get(c)), [v, o.catN[c]]]))]; });
    let acum = 0; const ac = lista.map((o) => (acum += o.valor) / (total || 1));
    const pareto = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1].map((p) => [p, lista.length ? ac[Math.max(1, Math.round(lista.length * p)) - 1] : 0]);
    notas.sort((a, b) => b[1] - a[1]);
    const r = { formato: 2, agregado: true, grupo: g, faltam, total, qtd: lista.length, notas: nNotas, ticket_medio: total / Math.max(nNotas, 1),
      top10_participacao: soma(lista.slice(0, 10).map((o) => o.valor)) / (total || 1), pareto, cats, linhas,
      nDeps: depsGrupo.size || (ok.reduce((m, [x]) => Math.max(m, x.n_deps || 0), 0)),
      por_tipo: Object.fromEntries(Object.entries(tipos).map(([t, x]) => [t, { valor: x.valor, notas: x.notas, fornecedores: x.f.size }])),
      por_categoria: cats.map((c) => [c, catT.get(c).valor, catT.get(c).forn.size, catT.get(c).notas]),
      maiores_notas: notas.slice(0, 300), maior: notas[0] };
    return (E.cache[chave] = r);
  }

  // fornecedores só dos deputados filtrados, somando as notas de cada um
  async function fornFiltrado() {
    if (!temFiltro()) return null;
    const deps = filtrados(), tot = ehTotal();
    if (!deps.length && !tot) return { vazio: true };
    const g = grupoDoFiltro();
    // num ano só, até 150 deputados, soma nota a nota (mais detalhe); em "Todos os anos"
    // ou com muitos deputados, usa o resumo pronto do partido/estado
    if (g && (tot || deps.length > LIMITE_DEPS_FORN)) { const r = await fornGrupo(g); if (r) return r; }
    if (!deps.length) return { vazio: true };
    if (tot && !E.deps.length && !textoBusca()) return { amplo: "total" };
    const pares = tot ? deps.flatMap((d) => (d.anos || []).map((a) => [d.id, a])) : deps.map((d) => [d.id, E.resumo.ano]);
    if (deps.length > LIMITE_DEPS_FORN || pares.length > 250) return { amplo: deps.length };
    const chave = `agg${tot ? "T" + (corrigir() ? "c" : "n") : E.resumo.ano}:${pares.map((p) => p.join("/")).join(",")}`;
    if (E.cache[chave]) return E.cache[chave];
    $("#f-aviso").hidden = false; $("#f-aviso").textContent = `Carregando as notas fiscais de ${nf(deps.length)} deputado(s)…`;
    const nds = await emLotes(pares.map(([id, a]) => () => notasDep(id, a)));
    const forn = new Map(), catT = new Map(), tipos = {}, todas = [];
    let total = 0, nNotas = 0, comDados = 0;
    const porId = new Map(E.resumo.deputados.map((d) => [d.id, d]));
    nds.forEach((nd, i) => {
      if (!nd) return; comDados++;
      const [id, a] = pares[i], k = tot ? fatorDoAno(a) : 1, dep = porId.get(id) || {};
      nd.n.forEach(([md, cent, fi, ci, , u]) => {
        const v = (cent / 100) * k, fo = nd.f[fi] || ["?", "?", ""], ch = fo[0], cat = nd.c[ci] || "Outros";
        if (cat === "Complemento do auxílio-moradia") return;   // ajuste da Câmara, não é fornecedor
        let o = forn.get(ch);
        if (!o) forn.set(ch, (o = { chave: ch, nome: fo[1], doc: fo[2], tipo: tipoDaChave(ch), valor: 0, notas: 0, deps: new Set(), cat: {}, catN: {} }));
        o.valor += v; o.notas++; o.deps.add(id); o.cat[cat] = (o.cat[cat] || 0) + v; o.catN[cat] = (o.catN[cat] || 0) + 1;
        let c = catT.get(cat); if (!c) catT.set(cat, (c = { valor: 0, forn: new Set(), notas: 0 }));
        c.valor += v; c.notas++; c.forn.add(ch);
        const t = (tipos[o.tipo] = tipos[o.tipo] || { valor: 0, notas: 0, f: new Set() }); t.valor += v; t.notas++; t.f.add(ch);
        total += v; nNotas++;
        const mm = Math.floor(md / 100), dd = md % 100;
        todas.push([mm ? `${a}-${String(mm).padStart(2, "0")}-${String(dd || 1).padStart(2, "0")}` : "", v, id, dep.nome || "Deputado " + id, dep.partido, dep.uf, ch, fo[1], cat, u, a]);
      });
    });
    const cats = [...catT.entries()].sort((a, b) => b[1].valor - a[1].valor).map((c) => c[0]), ci = new Map(cats.map((c, i) => [c, i]));
    const lista = [...forn.values()].sort((a, b) => b.valor - a.valor);
    const linhas = lista.map((o) => [o.chave, o.nome, o.doc, o.tipo, ci.get(Object.entries(o.cat).sort((a, b) => b[1] - a[1])[0][0]), o.valor, o.notas, o.deps.size,
      Object.fromEntries(Object.entries(o.cat).map(([c, v]) => [String(ci.get(c)), [v, o.catN[c]]]))]);
    let acum = 0; const ac = lista.map((o) => (acum += o.valor) / (total || 1));
    const pareto = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1].map((p) => [p, lista.length ? ac[Math.max(1, Math.round(lista.length * p)) - 1] : 0]);
    todas.sort((a, b) => b[1] - a[1]);
    const r = { formato: 2, agregado: true, total, qtd: lista.length, notas: nNotas, ticket_medio: total / Math.max(nNotas, 1),
      top10_participacao: soma(lista.slice(0, 10).map((o) => o.valor)) / (total || 1), pareto, cats, linhas, nDeps: deps.length, comDados,
      por_tipo: Object.fromEntries(Object.entries(tipos).map(([t, x]) => [t, { valor: x.valor, notas: x.notas, fornecedores: x.f.size }])),
      por_categoria: cats.map((c) => [c, catT.get(c).valor, catT.get(c).forn.size, catT.get(c).notas]),
      maiores_notas: todas.slice(0, 300), maior: todas[0] };
    return (E.cache[chave] = r);
  }

  async function renderFornecedores() {
    const tok = (E.fornTok = (E.fornTok || 0) + 1);
    let f = await dadosForn();
    const aviso = $("#f-aviso"), filtroEl = $("#f-filtro");
    if (!f || f.formato !== 2) {
      aviso.hidden = false; filtroEl.hidden = true;
      aviso.textContent = `Os dados detalhados de fornecedores de ${rotuloAno()} ainda não foram gerados. Eles aparecem depois que o robô processar este ano com a versão nova.`;
      kpis($("#f-kpis"), []); $("#forn-tab").innerHTML = ""; $("#f-notas").innerHTML = ""; E.fornAtual = null;
      return;
    }
    const filtro = await fornFiltrado();
    if (tok !== E.fornTok) return;      // o usuário mudou o filtro enquanto carregava
    const agg = filtro?.formato === 2 ? filtro : null;
    const rotFiltro = () => { const p = [$("#f-uf").value, $("#f-partido").value].filter(Boolean).join(" · ");
      if (E.deps.length) return E.deps.length <= 3 ? E.deps.map(nomeDeId).join(", ") : `${E.deps.length} deputados escolhidos`;
      return (p || "") + (textoBusca() ? `${p ? " · " : ""}nome com "${$("#f-busca").value.trim()}"` : ""); };
    filtroEl.hidden = !filtro;
    if (agg) { filtroEl.innerHTML = `Mostrando só as notas fiscais de <b>${esc(rotFiltro())}</b> (${nf(agg.nDeps)} deputado${agg.nDeps > 1 ? "s" : ""}${ehTotal() ? ", todos os anos" : ", " + E.resumo.ano}).`
      + (agg.faltam?.length && ehTotal() ? ` <span class="sub">Ainda sem a soma por ${agg.grupo?.startsWith("U") ? "estado" : "partido"}: ${agg.faltam.join(", ")} — o robô completa nos próximos dias.</span>` : ""); f = agg; }
    else if (filtro?.vazio) filtroEl.innerHTML = `Nenhum deputado com esses filtros em ${esc(rotuloAno())}. Mostrando todos os fornecedores.`;
    else if (filtro?.amplo === "total") filtroEl.innerHTML = `Em "Todos os anos", os fornecedores de um estado ou partido aparecem quando você escolhe um ano. Para somar todos os anos, escolha deputado(s) na lista. Mostrando todos os fornecedores.`;
    else if (filtro?.amplo) filtroEl.innerHTML = `O filtro tem ${nf(filtro.amplo)} deputados — muitas notas para somar no seu aparelho. Escolha um estado, um partido ou deputados específicos (até ${LIMITE_DEPS_FORN}). Mostrando todos os fornecedores.`;
    const tot = ehTotal() && !agg, F = tot || (agg && ehTotal()) ? 1 : fator();
    $("#f-sigepa").hidden = !(ehTotal() || E.resumo.ano >= 2025);
    E.fornAtual = { f, tot, F, agg: !!agg };
    aviso.hidden = !tot;
    if (tot) aviso.textContent = `Soma de ${rotuloAno()}: mostramos os 3.000 maiores fornecedores. Para ver cada nota fiscal, escolha um ano ou escolha deputado(s).`;
    const cats = tot ? null : f.cats;
    const catDe = (l) => (tot ? l[4] : cats[l[4]]);
    // ---- indicadores
    const pj = f.por_tipo?.PJ, pf = f.por_tipo?.PF;
    kpis($("#f-kpis"), [
      ["Pago a fornecedores", compacto(f.total * F), agg ? `cota de ${nf(agg.nDeps)} deputado(s), ${rotuloAno()}` : tot ? `cota parlamentar, ${rotuloAno()}` : `cota parlamentar de ${E.resumo.ano}`, css("--c-cota")],
      ["Fornecedores diferentes", nf(f.qtd), pj ? `${nf(pj.fornecedores)} empresas · ${nf(pf?.fornecedores || 0)} pessoas físicas` : "", css("--accent")],
      ...(tot ? [] : [["Notas fiscais", nf(f.notas), `valor médio de ${brl(f.ticket_medio * F)} por nota`, css("--c-gabinete")]]),
      ["Os 10 maiores levaram", nf((f.top10_participacao || 0) * 100, 1) + "%", "de tudo o que foi pago", css("--c-ajuda")],
      ...(agg ? (agg.maior ? [["Maior nota", brl(agg.maior[1] * F), `${esc(agg.maior[7])} · ${dataCurta(agg.maior[0])}`, css("--danger")]] : [])
        : tot ? [] : [[T("fornecedor", "Fornecedores exclusivos"), nf(f.exclusivos), "R$ 150 mil+ de um só deputado", css("--danger")]]),
    ]);
    // ---- concentração (Pareto)
    if (!tot) {
      const pts = [[0, 0], ...f.pareto];
      grafico("g-forn-pareto", { type: "line", data: { labels: pts.map((p) => nf(p[0] * 100, p[0] < 0.05 && p[0] ? 0 : 0) + "%"), datasets: [
        { label: "% do dinheiro", data: pts.map((p) => p[1] * 100), borderColor: css("--c-cota"), backgroundColor: "rgba(230,108,55,.15)", fill: true, tension: .25 },
        { label: "Distribuição igual", data: pts.map((p) => p[0] * 100), borderColor: css("--line-2"), borderDash: [4, 4], pointRadius: 0 },
      ] }, options: { scales: { x: { title: { display: true, text: "% dos fornecedores (dos maiores para os menores)" } }, y: { max: 100, ticks: { callback: (v) => v + "%" } } },
        plugins: { legend: legBaixo, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${nf(c.parsed.y, 1)}%` } } } } });
      const p1 = f.pareto.find((p) => p[0] === 0.01), p10 = f.pareto.find((p) => p[0] === 0.1);
      $("#f-pareto-txt").textContent = p1 && p10 ? `O 1% maior dos fornecedores (${nf(Math.max(1, Math.round(f.qtd * 0.01)))}) ficou com ${nf(p1[1] * 100, 0)}% do dinheiro; os 10% maiores, com ${nf(p10[1] * 100, 0)}%.` : "";
      // ---- por tipo de gasto
      const pc = f.por_categoria;
      barraH("g-forn-cat", pc.map((c) => c[0]), pc.map((c) => c[1] * F), css("--c-cota"), {
        tooltip: { callbacks: { label: (c) => `${brl(c.parsed.x)} · ${nf(pc[c.dataIndex][2])} fornecedores · ${nf(pc[c.dataIndex][3])} notas` } },
        onClick: (_, el) => { if (el.length) { $("#forn-cat").value = pc[el[0].index][0]; E.limiteForn = 50; tabelaForn(); $("#forn-tab").scrollIntoView({ behavior: "smooth", block: "start" }); } } });
      // ---- PJ x PF
      const tipos = Object.entries(f.por_tipo || {});
      const rotT = { PJ: "Empresas (CNPJ)", PF: "Pessoas físicas (CPF)", "—": "Sem documento" };
      grafico("g-forn-tipo", { type: "doughnut", data: { labels: tipos.map(([t]) => rotT[t] || t),
        datasets: [{ data: tipos.map(([, v]) => v.valor * F), backgroundColor: [css("--accent"), "#e66c37", "#c8c6c4"], borderColor: "#fff", borderWidth: 2 }] },
        options: { cutout: "58%", plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)} · ${nf(tipos[c.dataIndex][1].fornecedores)} fornecedores` } } } } });
    } else {
      ["g-forn-pareto", "g-forn-cat", "g-forn-tipo"].forEach((id) => grafico(id, { type: "bar", data: { labels: ["escolha um ano para ver este gráfico"], datasets: [{ data: [0] }] }, options: { plugins: { legend: { display: false } } } }));
      $("#f-pareto-txt").textContent = "";
    }
    // ---- maiores por valor e por nº de deputados
    const L = f.linhas;
    const curto = (n) => ((n || "").length > 34 ? n.slice(0, 32) + "…" : n);
    const tv = L.slice(0, 15);
    barraH("g-forn-valor", tv.map((l) => curto(l[1])), tv.map((l) => l[5] * F), css("--c-cota"), {
      tooltip: { callbacks: { label: (c) => `${brl(c.parsed.x)} · ${tv[c.dataIndex][7]} deputado(s) · ${catDe(tv[c.dataIndex])}` } },
      onClick: (_, el) => { if (el.length) abrirFornecedor(tv[el[0].index][0]); } });
    const td = L.slice().sort((a, b) => b[7] - a[7] || b[5] - a[5]).slice(0, 15);
    barraH("g-forn-deps", td.map((l) => curto(l[1])), td.map((l) => l[7]), css("--accent"), { ticks: { precision: 0 },
      tooltip: { callbacks: { label: (c) => `${c.parsed.x} deputados · ${brl(td[c.dataIndex][5] * F)}` } },
      onClick: (_, el) => { if (el.length) abrirFornecedor(td[el[0].index][0]); } });
    // ---- valor médio por nota
    const tk = L.filter((l) => l[6] > 0).map((l) => l[5] / l[6]);
    const faixas = [[0, 100], [100, 500], [500, 1000], [1000, 5000], [5000, 10000], [10000, 50000], [50000, Infinity]];
    grafico("g-forn-ticket", { type: "bar", data: { labels: ["até 100", "100–500", "500–1 mil", "1–5 mil", "5–10 mil", "10–50 mil", "50 mil+"],
      datasets: [{ label: "Fornecedores", data: faixas.map(([a, b]) => tk.filter((v) => v >= a && v < b).length), backgroundColor: css("--c-gabinete"), borderRadius: 3 }] },
      options: { scales: { x: { title: { display: true, text: "valor médio da nota (R$)" }, grid: { display: false } }, y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
    // ---- maiores notas
    if (!tot) renderMaioresNotas(); else { $("#f-notas").innerHTML = `<tbody><tr><td class="sub">Escolha um ano para ver as notas fiscais.</td></tr></tbody>`; $("#f-notas-mais").hidden = true; }
    // ---- filtro de categorias e tabela
    const cs = $("#forn-cat"), atual = cs.value;
    const lista = tot ? [...new Set(L.flatMap((l) => (l[9] ? Object.keys(l[9]) : [l[4]])))].sort() : f.cats;
    cs.innerHTML = `<option value="">Todos os tipos de gasto</option>` + lista.map((c) => `<option>${esc(c)}</option>`).join("");
    cs.value = lista.includes(atual) ? atual : "";
    tabelaForn();
    renderAlertasReceita();
  }

  function renderMaioresNotas() {
    const { f, F } = E.fornAtual || {}; if (!f) return;
    const ano = E.resumo.ano;
    const lim = E.limiteNotasF || 20;
    const mn = f.maiores_notas.filter((n) => (!$("#f-uf").value || n[5] === $("#f-uf").value) && (!$("#f-partido").value || n[4] === $("#f-partido").value));
    $("#f-notas").innerHTML = `<thead><tr><th>Data</th><th class="num">Valor</th><th>Deputado</th><th>Fornecedor</th><th>Tipo de gasto</th><th>Nota</th></tr></thead><tbody>` +
      (mn.slice(0, lim).map((n) => `<tr><td>${dataCurta(n[0])}</td><td class="num"><b>${brl(n[1] * F)}</b></td>
        <td class="nome-cel"><button class="link-dep" data-dep="${n[2]}">${esc(n[3])}</button> <span class="sub">${esc(n[4] || "")}-${esc(n[5] || "")}</span></td>
        <td class="nome-cel"><button class="link-forn" data-forn="${esc(n[6])}">${esc(n[7])}</button></td><td class="sub">${esc(n[8])}</td><td>${linkNota(n[9], n[10] || ano)}</td></tr>`).join("")
        || `<tr><td colspan="6" class="sub">Nenhuma nota com esses filtros.</td></tr>`) + `</tbody>`;
    $("#f-notas-mais").hidden = mn.length <= lim;
  }

  async function tabelaForn() {
    if (!E.fornAtual) return;
    const { f, tot, F } = E.fornAtual;
    const q = semAcento($("#forn-busca").value.trim()), qd = q.replace(/\D/g, "");
    const cat = $("#forn-cat").value, tipo = $("#forn-tipo").value, dep = $("#forn-dep").value;
    const catDe = (l) => (tot ? l[4] : f.cats[l[4]]);
    const ci = cat && !tot ? String(f.cats.indexOf(cat)) : cat;
    // [valor, notas] do fornecedor no tipo filtrado (todos os tipos sem filtro).
    // Dados antigos, sem a divisão por tipo, caem no tipo principal.
    const noTipo = (l) => {
      if (!cat) return [l[5], l[6]];
      const pt = tot ? l[9] : l[8];
      if (pt && typeof pt === "object") return pt[ci] || null;
      return catDe(l) === cat ? [l[5], l[6]] : null;
    };
    const ord = E.ordemForn || "valor";
    let L = f.linhas.map((l) => [l, noTipo(l)]).filter(([l, x]) => x && (!q || semAcento(l[1]).includes(q) || (qd.length >= 3 && (l[2] || "").replace(/\D/g, "").includes(qd)))
      && (!tipo || l[3] === tipo) && (!dep || (dep === "1" ? l[7] === 1 : l[7] >= +dep)));
    const chaveOrd = { valor: ([, x]) => x[0], notas: ([, x]) => x[1], deputados: ([l]) => l[7], ticket: ([, x]) => x[0] / Math.max(x[1], 1) }[ord] || (([, x]) => x[0]);
    L.sort((a, b) => chaveOrd(b) - chaveOrd(a));
    const somaV = soma(L.map(([, x]) => x[0])), somaN = soma(L.map(([, x]) => x[1]));
    $("#f-contagem").textContent = `${nf(L.length)} fornecedor(es) · ${compacto(somaV * F)}`;
    const th = (c, t, cl = "num") => `<th class="${cl}" data-ordf="${c}" ${ord === c ? 'aria-sort="descending"' : ""}>${t}</th>`;
    $("#forn-tab").innerHTML = `<thead><tr><th class="num">#</th><th>Fornecedor</th><th>${cat ? "Tipo de gasto" : "Tipo de gasto principal"}</th>
      ${th("valor", cat ? "Recebido neste tipo" : "Recebido")}${th("notas", "Notas")}${th("deputados", "Deputados")}${th("ticket", "Valor médio")}${tot ? "<th>Anos</th>" : ""}</tr></thead><tbody>` +
      L.slice(0, E.limiteForn).map(([l, x], i) => `<tr class="clicavel" data-forn="${esc(l[0])}"><td class="num sub">${i + 1}º</td>
        <td class="nome-cel"><button class="link-forn" data-forn="${esc(l[0])}">${esc(l[1])}</button><div class="sub">${etqTipo(l[3])} ${esc(l[2] || "")}</div></td>
        <td class="sub" style="white-space:normal">${esc(cat || catDe(l))}${cat && x[0] < l[5] - 0.005 ? `<div class="sub">recebeu ${compacto(l[5] * F)} em todos os tipos</div>` : ""}</td>
        <td class="num"><b>${brl(x[0] * F)}</b></td><td class="num">${nf(x[1])}</td>
        <td class="num">${l[7]}</td><td class="num">${brl((x[0] / Math.max(x[1], 1)) * F)}</td>
        ${tot ? `<td class="sub">${Object.keys(l[8] || {}).length}</td>` : ""}</tr>`).join("") + `</tbody>
      <tfoot><tr class="linha-total"><td></td><td><b>Total</b> <span class="sub">${nf(L.length)} fornecedor(es)${L.length > E.limiteForn ? ", inclusive os que não estão na tela" : ""}</span></td>
        <td class="sub">${cat ? esc(cat) : "todos os tipos"}</td><td class="num"><b>${brl(somaV * F, 2)}</b></td><td class="num"><b>${nf(somaN)}</b></td><td></td>
        <td class="num"><b>${brl((somaV / Math.max(somaN, 1)) * F)}</b></td>${tot ? "<td></td>" : ""}</tr></tfoot>`;
    $("#forn-mais").hidden = L.length <= E.limiteForn;
  }

  // ------------------------------------------------------ ficha do fornecedor
  async function abrirFornecedor(chave, ano = E.resumo.ano) {
    const dlg = $("#detalhe");
    $("#d-corpo").innerHTML = `<p class="sub">Carregando…</p>`;
    if (!dlg.open) dlg.showModal();
    if (ano === "total") return abrirFornecedorTotal(chave);
    const g = await cache(`fg${ano}/${grupoForn(chave)}`, () => getJSON(`dados/${ano}/fornecedores/${grupoForn(chave)}.json`));
    const x = g?.[chave];
    if (!x) { await abrirFornecedorSoReceita(chave);
      $("#d-corpo").insertAdjacentHTML("beforeend", `<p class="sub">A ficha das notas deste fornecedor em ${ano} ainda não está disponível.${+ano === E.resumoAtual?.ano ? " As fichas do ano em andamento são refeitas aos domingos; fornecedores novos aparecem na próxima." : ""}</p>`); return; }
    const rs = ano == E.resumo.ano ? E.resumo : await cache("r" + ano, () => getJSON(`dados/${ano}/resumo.json`));
    const F = corrigir() ? rs?.fator_ipca || 1 : 1, RR = (v) => (v || 0) * F;
    const topPag = x.pagadores[0] ? x.pagadores[0][1] / x.valor : 0;
    const pagRows = x.pagadores.map(([id, v, n]) => { const d = nomeDep(id, rs);
      return `<tr><td class="nome-cel"><button class="link-dep" data-dep="${id}" data-ano="${ano}">${esc(d.nome)}</button> <span class="sub">${esc(d.partido || "")}-${esc(d.uf || "")}</span></td>
        <td class="num"><b>${brl(RR(v))}</b></td><td class="num">${nf((v / x.valor) * 100, 1)}%</td><td class="num">${n}</td>
        <td><button class="btn-sec" style="min-height:30px;padding:3px 10px" data-vernotas="${id}" data-chave="${esc(chave)}" data-ano="${ano}">ver notas</button></td></tr>`; }).join("");
    $("#d-corpo").innerHTML = `
      <div class="d-cab"><div><h2 id="d-nome">${esc(x.nome)}</h2>
        <div class="sub">${etqTipo(x.tipo)} ${esc(x.doc || "")} · ${x.posicao}º maior fornecedor da cota em ${ano}</div></div></div>
      <div class="sub">Recebeu da cota parlamentar em ${ano}${F > 1.0005 ? " (valores de hoje)" : ""}</div>
      <div class="d-total">${brl(RR(x.valor), 2)}</div>
      <div class="sub">${nf(x.participacao * 100, 2)}% de tudo o que a cota pagou no ano</div>
      <div class="percentis" style="margin-top:12px">
        <div><b>${nf(x.notas)}</b>notas fiscais</div><div><b>${x.deputados}</b>deputado(s) pagaram</div>
        <div><b>${brl(RR(x.ticket))}</b>valor médio por nota</div><div><b>${brl(RR(x.maior))}</b>maior nota</div>
        <div><b>${dataCurta(x.primeira)}</b>primeira nota do ano</div><div><b>${dataCurta(x.ultima)}</b>última nota do ano</div></div>
      ${x.deputados === 1 && x.valor >= 150000 ? `<p class="aviso" style="margin:10px 0">Fornecedor exclusivo: recebeu ${compacto(RR(x.valor))} de um só deputado no ano (padrão estatístico, não acusação).</p>` : ""}
      ${x.deputados > 1 && topPag >= 0.8 ? `<p class="sub">${nf(topPag * 100)}% do que recebeu veio de um único deputado.</p>` : ""}
      <div id="rf-box" class="rf-box"><p class="sub">Carregando dados da Receita…</p></div>
      <div class="d-grade">
        <div><h3 class="d-sec">Recebido por mês</h3><div class="canvas-box"><canvas id="g-forn-mes"></canvas></div></div>
        <div><h3 class="d-sec">Por tipo de gasto</h3><table>${Object.entries(x.categorias).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${brl(RR(v))}</td></tr>`).join("")}</table>
          <div id="forn-hist"></div></div>
      </div>
      <h3 class="d-sec">Quem pagou (${x.pagadores.length})</h3>
      <div class="tabela-rolagem"><table class="mini-tab" id="forn-pag"><thead><tr><th>Deputado</th><th class="num">Valor</th><th class="num">%</th><th class="num">Notas</th><th></th></tr></thead><tbody>${pagRows}</tbody></table></div>
      <h3 class="d-sec">Maiores notas</h3>
      <table class="mini-tab"><thead><tr><th>Data</th><th class="num">Valor</th><th>Deputado</th><th>Tipo</th><th>Nº</th><th></th></tr></thead><tbody>
        ${x.maiores.map(([dt, v, id, c, num, u]) => `<tr><td>${dataCurta(dt)}</td><td class="num">${brl(RR(v))}</td><td><button class="link-dep" data-dep="${id}" data-ano="${ano}">${esc(nomeDep(id, rs).nome)}</button></td>
          <td class="sub">${esc(c)}</td><td class="sub">${esc(num || "")}</td><td>${linkNota(u, ano)}</td></tr>`).join("")}</tbody></table>
      <div id="rf-anos"></div>
      <p class="sub" style="margin-top:14px">Fonte: notas fiscais da cota parlamentar (dados abertos da Câmara) e cadastro de CNPJ da Receita Federal. ${x.tipo === "PF" ? "O CPF aparece parcialmente oculto." : ""}</p>`;
    secaoReceita(chave, $("#rf-box")); secaoTodosAnos(chave, $("#rf-anos"));
    grafico("g-forn-mes", { type: "bar", data: { labels: MESES, datasets: [{ label: "Recebido", data: x.mes.map((v) => v * F), backgroundColor: css("--c-cota"), borderRadius: 3 }] },
      options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipBRL() } } });
    // histórico em outros anos (quando o total existe)
    const t = E.meta.total ? await cache("forntotal-" + (corrigir() ? "c" : "n"), () => getJSON(`dados/total/${corrigir() ? "fornecedores" : "fornecedores_nominal"}.json`)) : null;
    const lt = t?.linhas?.find((l) => l[0] === chave);
    if (lt && Object.keys(lt[8] || {}).length > 1) {
      $("#forn-hist").innerHTML = `<h3 class="d-sec">Em outros anos</h3><table>${Object.entries(lt[8]).sort((a, b) => b[0] - a[0]).map(([a, v]) =>
        `<tr><td>${a}</td><td class="num">${brl(v)}</td><td>${+a !== +ano ? `<button class="link-forn" data-forn="${esc(chave)}" data-ano="${a}">abrir</button>` : "<span class='sub'>este ano</span>"}</td></tr>`).join("")}</table>`;
    }
    history.replaceState(null, "", location.search + "#forn-" + encodeURIComponent(chave));
  }

  // fornecedor fora da lista do "Todos os anos": ficha só com Receita + todos os anos
  async function abrirFornecedorSoReceita(chave) {
    const c = (await cruzReceita(chave))?.[chave], cad = (await cadReceita(chave))?.[chave];
    $("#d-corpo").innerHTML = `<div class="d-cab"><div><h2 id="d-nome">${esc(cad?.razao || cnpjFmt(chave))}</h2><div class="sub">${etqTipo(tipoDaChave(chave))} ${cnpjFmt(chave)}</div></div></div>
      ${c ? "" : `<p class="sub">Para ver as notas, escolha um ano e abra o fornecedor na lista.</p>`}
      <div id="rf-anos"></div><div id="rf-box" class="rf-box"></div>`;
    secaoTodosAnos(chave, $("#rf-anos")); secaoReceita(chave, $("#rf-box"));
  }

  async function abrirFornecedorTotal(chave) {
    const arqF = corrigir() ? "fornecedores" : "fornecedores_nominal";
    const f = E.meta.total ? await cache("forntotal-" + (corrigir() ? "c" : "n"), () => getJSON(`dados/total/${arqF}.json`)) : null;
    const l = f?.linhas?.find((x) => x[0] === chave);
    if (!l) return abrirFornecedorSoReceita(chave);
    const pa = Object.entries(l[8] || {}).sort((a, b) => a[0] - b[0]);
    $("#d-corpo").innerHTML = `
      <div class="d-cab"><div><h2 id="d-nome">${esc(l[1])}</h2><div class="sub">${etqTipo(l[3])} ${esc(l[2] || "")} · ${esc(l[4])}</div></div></div>
      <div class="sub">Recebeu da cota parlamentar em ${rotuloAno()}${corrigir() ? " (valores de hoje)" : ""}</div>
      <div class="d-total">${brl(l[5], 2)}</div>
      <div class="percentis" style="margin-top:12px"><div><b>${nf(l[6])}</b>notas fiscais</div><div><b>${l[7]}</b>deputados (maior número num ano)</div><div><b>${pa.length}</b>ano(s) recebendo</div></div>
      <h3 class="d-sec">Recebido em cada ano</h3><div class="canvas-box"><canvas id="g-forn-mes"></canvas></div>
      <table style="margin-top:8px">${pa.slice().reverse().map(([a, v]) => `<tr><td>${a}</td><td class="num">${brl(v)}</td><td><button class="link-forn" data-forn="${esc(chave)}" data-ano="${a}">ver ficha do ano</button></td></tr>`).join("")}</table>
      <div id="rf-box" class="rf-box"><p class="sub">Carregando dados da Receita…</p></div><div id="rf-anos"></div>`;
    secaoReceita(chave, $("#rf-box")); secaoTodosAnos(chave, $("#rf-anos"));
    grafico("g-forn-mes", { type: "bar", data: { labels: pa.map((p) => p[0]), datasets: [{ label: "Recebido", data: pa.map((p) => p[1]), backgroundColor: css("--c-cota"), borderRadius: 3 }] },
      options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipBRL() } } });
  }

  // ------------------------------------------------ Receita Federal (ficha)
  const GRAV_COR = { alta: "#d13438", media: "#e66c37", baixa: "#605e5c" };
  const metaReceita = () => cache("rf-meta", () => getJSON("dados/receita/meta.json"));
  const cadReceita = (k) => cache("rf-cad" + grupoForn(k), () => getJSON(`dados/receita/cadastro/${grupoForn(k)}.json`));
  const cruzReceita = (k) => cache("rf-cruz" + grupoForn(k), () => getJSON(`dados/receita/cruz/${grupoForn(k)}.json`));
  const mesAno = (s) => (s ? s.slice(5, 7) + "/" + s.slice(0, 4) : "");
  function tempoDesde(ini, fim = new Date().toISOString().slice(0, 10)) {
    if (!ini) return "";
    const a = new Date(ini + "T12:00:00"), b = new Date(fim + "T12:00:00");
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); if (b.getDate() < a.getDate()) m--;
    if (m < 0) return "";
    const anos = Math.floor(m / 12), meses = m % 12;
    return [anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "", meses ? `${meses} ${meses > 1 ? "meses" : "mês"}` : ""].filter(Boolean).join(" e ") || "menos de 1 mês";
  }
  const cnpjFmt = (c) => (c && c.length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : c || "");
  const listaAlertas = (al) => (al || []).length ? `<ul class="rf-alertas">${al.map(([cod, g, t]) => `<li style="--c:${GRAV_COR[g]}"><b>${esc((E.rfRotulos || {})[cod] || cod)}</b> ${esc(t)}</li>`).join("")}</ul>
    <p class="sub">Alertas automáticos a partir dos dados oficiais. Não são acusação: servem para orientar a consulta às notas e ao cadastro.</p>` : "";

  async function secaoReceita(chave, el) {
    if (!el) return;
    if (tipoDaChave(chave) !== "PJ") {
      el.innerHTML = `<h3 class="d-sec">Na Receita Federal</h3><p class="sub">${tipoDaChave(chave) === "PF" ? "Fornecedor pessoa física: a Receita não publica dados cadastrais de CPF." : "Fornecedor sem CNPJ na nota."}</p>`;
      return;
    }
    const [meta, cads, cruz, al] = await Promise.all([metaReceita(), cadReceita(chave), cruzReceita(chave), cache("rf-alertas", () => getJSON("dados/receita/alertas.json"))]);
    if (al?.rotulos) E.rfRotulos = al.rotulos;
    const x = cads?.[chave], c = cruz?.[chave];
    if (!meta || !x) { el.innerHTML = `<h3 class="d-sec">Na Receita Federal</h3><p class="sub">${meta ? "Este CNPJ ainda não foi consultado na base da Receita (fornecedores novos entram na base do mês seguinte)." : "Os dados da Receita Federal ainda não foram baixados pelo robô."}</p>`; return; }
    const base = `base da Receita de ${mesAno(meta.base + "-01")}`;
    if (x.nao_encontrado) { el.innerHTML = `<h3 class="d-sec">Na Receita Federal <span class="sub">${base}</span></h3>${listaAlertas(c?.alertas)}`; return; }
    const e = x.end || {}, s = x.simples || {};
    const endTxt = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(", ") + (e.bairro ? ` — ${e.bairro}` : "") + ` · ${e.municipio || ""}/${e.uf || ""}` + (e.cep ? ` · CEP ${e.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}` : "");
    const ativo = x.situacao === "ATIVA";
    const atividade = ativo ? `${tempoDesde(x.abertura)} de atividade` : x.data_situacao ? `funcionou por ${tempoDesde(x.abertura, x.data_situacao)}` : "";
    const regime = s.mei && !s.mei_ate ? `MEI desde ${dataBR(s.mei_desde)}` : s.simples && !s.simples_ate ? `Simples Nacional desde ${dataBR(s.simples_desde)}`
      : s.simples_ate ? `Saiu do Simples em ${dataBR(s.simples_ate)}` : "Fora do Simples Nacional";
    const fato = (r, v) => (v ? `<div><span>${r}</span><b>${v}</b></div>` : "");
    const soc = x.socios || [];
    el.innerHTML = `<h3 class="d-sec">Na Receita Federal <span class="sub">${base}</span></h3>
      ${listaAlertas(c?.alertas)}
      <div class="rf-fatos">
        ${fato("Razão social", esc(x.razao))}${fato("Nome fantasia", esc(x.fantasia))}
        ${fato("CNPJ", `${cnpjFmt(chave)} · ${x.matriz ? "matriz" : "filial"}`)}
        ${fato("Situação", `<span class="rf-sit ${ativo ? "ok" : "ruim"}">${esc(x.situacao || "—")}</span> desde ${dataBR(x.data_situacao)}${x.motivo && !ativo ? ` · ${esc(x.motivo)}` : ""}`)}
        ${fato("Abertura", `${dataBR(x.abertura)}${atividade ? ` · ${atividade}` : ""}`)}
        ${fato("Natureza jurídica", esc(x.natureza))}${fato("Porte", esc(x.porte))}
        ${fato("Capital social", x.capital != null ? brl(x.capital, 2) : "")}${fato("Regime", regime)}
        ${fato("Atividade principal", x.cnae ? `${esc(x.cnae[1])} <span class="sub">(${esc(x.cnae[0])})</span>` : "")}
        ${fato("Endereço", `${esc(endTxt)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endTxt)}" target="_blank" rel="noopener">ver no mapa ↗</a>`)}
        ${x.situacao_especial ? fato("Situação especial", `${esc(x.situacao_especial)} (${dataBR(x.data_situacao_especial)})`) : ""}
      </div>
      ${(x.cnaes_sec || []).length ? `<details class="rf-mais"><summary>${x.cnaes_sec.length} atividade(s) secundária(s)</summary><ul>${x.cnaes_sec.map(([cd, d]) => `<li>${esc(d)} <span class="sub">(${esc(cd)})</span></li>`).join("")}</ul></details>` : ""}
      <h3 class="d-sec">Quem são os sócios (${soc.length})</h3>
      ${soc.length ? `<div class="tabela-rolagem"><table class="mini-tab"><thead><tr><th>Nome</th><th>Qualificação</th><th>Desde</th><th>Idade</th><th>Documento</th></tr></thead><tbody>
        ${soc.map((z) => `<tr><td class="nome-cel" style="white-space:normal"><b>${esc(z[1])}</b> ${z[0] === "PJ" ? `<span class="etq pj">Empresa</span>` : z[0] === "EX" ? `<span class="etq">Estrangeiro</span>` : ""}
          ${z[7] ? `<div class="sub">representante: ${esc(z[7])}${z[8] ? " (" + esc(z[8]) + ")" : ""}</div>` : ""}</td>
          <td class="sub" style="white-space:normal">${esc(z[3])}</td><td>${dataBR(z[4])}</td><td class="sub">${esc(z[5] || "—")}</td>
          <td class="sub">${z[0] === "PJ" ? cnpjFmt(z[2]) : esc(z[2])}${z[6] && z[6] !== "BRASIL" ? " · " + esc(z[6]) : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="sub">O CPF dos sócios vem parcialmente oculto pela própria Receita.</p>` : `<p class="sub">A Receita não informa sócios (comum em empresário individual e MEI, em que o dono é a própria empresa).</p>`}
      ${(c?.dep_socio || []).length ? `<h3 class="d-sec">Deputados no quadro de sócios</h3><ul class="rf-lista">${c.dep_socio.map(([id, nm, q, desde, conf, pago]) =>
        `<li><button class="link-dep" data-dep="${id}" data-ano="total">${esc(nm)}</button> — ${esc(q || "")} desde ${dataBR(desde)} ${conf === "confirmado" ? "" : `<span class="etq">conferir: nome e CPF parcial semelhantes</span>`}${pago ? ` · <b>pagou ${brl(pago)} a esta empresa com a cota depois de entrar</b>` : ""}</li>`).join("")}</ul>` : ""}
      ${(c?.comuns || []).length ? `<h3 class="d-sec">Sócios em comum com outros fornecedores da cota</h3><ul class="rf-lista">${c.comuns.map(([k2, rz, nomes, mesmos]) =>
        `<li><button class="link-forn" data-forn="${esc(k2)}" data-ano="total">${esc(rz || cnpjFmt(k2))}</button> <span class="sub">sócio(s): ${esc(nomes.join(", "))}</span>${mesmos ? ` · <b>${mesmos} deputado(s) pagaram as duas</b>` : ""}</li>`).join("")}</ul>` : ""}
      ${(c?.mesmo_end || []).length ? `<h3 class="d-sec">Outros fornecedores no mesmo endereço</h3><ul class="rf-lista">${c.mesmo_end.map(([k2, rz, mesmos]) =>
        `<li><button class="link-forn" data-forn="${esc(k2)}" data-ano="total">${esc(rz || cnpjFmt(k2))}</button>${mesmos ? ` · <b>${mesmos} deputado(s) pagaram as duas</b>` : ""}</li>`).join("")}</ul>` : ""}`;
  }

  // dinheiro recebido em todos os anos, com os deputados que pagaram
  async function secaoTodosAnos(chave, el) {
    if (!el || tipoDaChave(chave) !== "PJ") { if (el) el.innerHTML = ""; return; }
    const c = (await cruzReceita(chave))?.[chave];
    if (!c || !c.total) { el.innerHTML = ""; return; }
    const anos = Object.entries(c.por_ano).sort((a, b) => a[0] - b[0]);
    el.innerHTML = `<h3 class="d-sec">Dinheiro público recebido da cota, em todos os anos</h3>
      <div class="percentis"><div><b>${brl(c.total_hoje)}</b>em valores de hoje (${brl(c.total)} na época)</div><div><b>${nf(c.notas)}</b>notas fiscais</div>
        <div><b>${c.n_deps}</b>deputado(s) pagaram</div><div><b>${dataBR(c.primeira)}</b>primeira nota</div><div><b>${dataBR(c.ultima)}</b>última nota</div><div><b>${anos.length}</b>ano(s) recebendo</div></div>
      ${anos.length > 1 ? `<div class="canvas-box" style="margin-top:10px"><canvas id="g-forn-anos"></canvas></div>` : ""}
      <h3 class="d-sec">Deputados que mandaram dinheiro para este fornecedor</h3>
      <div class="tabela-rolagem"><table class="mini-tab"><thead><tr><th>Deputado</th><th class="num">Valor (época)</th><th class="num">Notas</th><th>Anos</th></tr></thead><tbody>
        ${c.deps.map(([id, nm, pt, uf, v, n, an]) => `<tr><td class="nome-cel"><button class="link-dep" data-dep="${id}" data-ano="${an[an.length - 1]}">${esc(nm)}</button> <span class="sub">${esc(pt || "")}-${esc(uf || "")}</span></td>
          <td class="num"><b>${brl(v)}</b></td><td class="num">${nf(n)}</td><td class="sub" style="white-space:normal">${an.map((a) => `<button class="link-ano" data-vernotas="${id}" data-chave="${esc(chave)}" data-ano="${a}">${a}</button>`).join(" ")}</td></tr>`).join("")}
      </tbody></table></div>${c.n_deps > c.deps.length ? `<p class="sub">Mostrando os ${c.deps.length} que mais pagaram, de ${c.n_deps}.</p>` : ""}
      <p class="sub">Clique num ano para ver as notas daquele deputado com este fornecedor.</p>`;
    if (anos.length > 1) grafico("g-forn-anos", { type: "bar", data: { labels: anos.map((a) => a[0]), datasets: [{ label: "Recebido (época)", data: anos.map((a) => a[1]), backgroundColor: css("--c-cota"), borderRadius: 3 }] },
      options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipBRL() } } });
  }

  // painel do cruzamento com a Receita na página Fornecedores: ranking curto + filtros
  const RF = { lim: 5, limDep: 5 };
  async function renderAlertasReceita() {
    const box = $("#f-rf"); if (!box) return;
    const a = await cache("rf-alertas", () => getJSON("dados/receita/alertas.json"));
    if (!a) { box.hidden = true; $("#f-rf-deps-box").hidden = true; return; }
    box.hidden = false; E.rfRotulos = a.rotulos;
    const deps = (x) => !E.deps.length || x.some((d) => E.deps.includes(d));
    const base = a.itens.filter((x) => deps(x[6]));
    const cont = {}; base.forEach((x) => (cont[x[2]] = (cont[x[2]] || 0) + 1));
    const total = E.deps.length ? cont : a.contagem;
    $("#f-rf-sub").textContent = `base da Receita de ${mesAno((a.base || "") + "-01")} · ${nf(a.fornecedores)} empresas conferidas`;
    const sel = $("#rf-tipo"), tipo = sel.value;
    const tipos = Object.keys(a.rotulos).filter((k) => total[k]);
    sel.innerHTML = `<option value="">Todos os tipos de inconsistência</option>` + tipos.map((k) => `<option value="${k}">${esc(a.rotulos[k])} (${nf(total[k])})</option>`).join("");
    sel.value = tipos.includes(tipo) ? tipo : "";
    $("#f-rf-tipos").innerHTML = tipos.map((k) => { const g = (base.find((x) => x[2] === k) || [])[3] || "baixa";
      return `<button type="button" data-rf-tipo="${k}" aria-pressed="${sel.value === k}" style="--c:${GRAV_COR[g]}">${esc(a.rotulos[k])} <b>${nf(total[k])}</b></button>`; }).join("");
    const g = $("#rf-grav").value, q = semAcento($("#rf-busca").value.trim()), qd = q.replace(/\D/g, "");
    const okG = (x) => !g || x[3] === "alta" || (g === "media" && x[3] === "media");
    const L = base.filter((x) => (!sel.value || x[2] === sel.value) && okG(x)
      && (!q || semAcento(x[1] || "").includes(q) || (qd.length >= 3 && x[0].includes(qd))));
    $("#rf-tit").textContent = L.length ? `${L.length > RF.lim ? `As ${Math.min(RF.lim, L.length)} mais relevantes` : "Resultado"} de ${nf(L.length)}${sel.value ? " · " + a.rotulos[sel.value] : ""}` : "";
    $("#f-rf-lista").innerHTML = L.length ? `<table class="rf-tab"><thead><tr><th class="c-emp">Empresa</th><th class="c-tipo">Inconsistência</th><th>O que encontramos</th><th class="num c-val">Recebeu da cota</th></tr></thead><tbody>
      ${L.slice(0, RF.lim).map((x, i) => `<tr><td class="c-emp"><span class="rf-pos">${i + 1}º</span><button class="link-forn" data-forn="${esc(x[0])}" data-ano="total">${esc(x[1] || cnpjFmt(x[0]))}</button><div class="sub">${cnpjFmt(x[0])}</div></td>
        <td class="c-tipo"><span class="rf-tag" style="--c:${GRAV_COR[x[3]]}">${esc(a.rotulos[x[2]] || x[2])}</span></td>
        <td class="c-txt">${esc(x[4])}</td><td class="num c-val"><span class="rot-m">Recebeu da cota: </span><b>${compacto(x[5])}</b></td></tr>`).join("")}</tbody></table>`
      : `<p class="sub">Nenhuma inconsistência com esses filtros.</p>`;
    $("#f-rf-mais").hidden = L.length <= RF.lim;
    // deputados no quadro de empresas
    const db = $("#f-rf-deps-box"), ds0 = (a.deputados_socios || []).filter((d) => !E.deps.length || E.deps.includes(d[0]));
    db.hidden = !ds0.length; if (!ds0.length) return;
    const td = $("#rf-dep-tipo").value, qq = semAcento($("#rf-dep-busca").value.trim()), qqd = qq.replace(/\D/g, "");
    const ds = ds0.filter((d) => (td === "pagou" ? d[12] > 0 && d[13] !== false : td === "recebeu" ? d[11] > 0 : true)
      && (!qq || semAcento(`${d[1]} ${d[5]}`).includes(qq) || (qqd.length >= 3 && (d[4] || "").includes(qqd))));
    const nPagou = ds0.filter((d) => d[12] > 0 && d[13] !== false).length;
    $("#rf-dep-sub").textContent = `${nf(ds0.length)} vínculos · ${nf(nPagou)} com pagamento da cota à própria empresa`;
    $("#rf-dep-tit").textContent = ds.length ? `${ds.length > RF.limDep ? `Os ${Math.min(RF.limDep, ds.length)} primeiros` : "Resultado"} de ${nf(ds.length)}` : "";
    $("#f-rf-deps").innerHTML = ds.length ? `<table class="rf-tab"><thead><tr><th class="c-emp">Deputado</th><th class="c-emp">Empresa</th><th class="c-tipo">Papel na empresa</th><th class="num c-val">Empresa recebeu da cota</th><th class="num c-val">Pago pelo próprio deputado*</th></tr></thead><tbody>
      ${ds.slice(0, RF.limDep).map((d, i) => `<tr><td class="c-emp"><span class="rf-pos">${i + 1}º</span><button class="link-dep" data-dep="${d[0]}" data-ano="total">${esc(d[1] || "")}</button> <span class="sub">${esc(d[2] || "")}-${esc(d[3] || "")}</span>${d[8] === "confirmado" ? "" : ` <span class="etq">conferir</span>`}</td>
        <td class="c-emp">${d[11] > 0 ? `<button class="link-forn" data-forn="${esc(d[4])}" data-ano="total">${esc(d[5] || "")}</button>` : `<b>${esc(d[5] || "")}</b>`}<div class="sub">${cnpjFmt(d[4])} · ${esc(d[9] || "")}${d[10] ? " · " + esc(d[10]) : ""}</div></td>
        <td class="c-tipo">${esc(d[6] || "")}<div class="sub">desde ${dataBR(d[7])}</div></td>
        <td class="num c-val"><span class="rot-m">Empresa recebeu da cota: </span>${d[11] ? compacto(d[11]) : "—"}</td><td class="num c-val"><span class="rot-m">Pago pelo próprio deputado: </span>${d[12] ? `<b class="perigo">${brl(d[12])}</b>` : "—"}</td></tr>`).join("")}</tbody></table>
      <p class="sub">* Notas pagas pelo deputado a essa empresa a partir da data em que ele entrou no quadro.</p>`
      : `<p class="sub">Nenhum vínculo com esses filtros.</p>`;
    $("#f-rf-deps-mais").hidden = ds.length <= RF.limDep;
  }

  // ----------------------------------------------- notas de um deputado
  const notasDep = (id, ano) => cache(`nd${ano}/${id}`, () => getJSON(`dados/${ano}/notas/${id}.json`));
  function linhaNota(n, nd, ano, F, mostrarForn = true) {
    const [md, cent, fi, ci, num, u, glosa, trecho, pass] = n;
    const fo = nd.f[fi] || [];
    return `<tr><td>${mmdd(md, ano)}</td>${mostrarForn ? `<td class="nome-cel"><button class="link-forn" data-forn="${esc(fo[0])}" data-ano="${ano}">${esc(fo[1] || "—")}</button><div class="sub">${esc(fo[2] || "")}</div></td>` : ""}
      <td class="sub" style="white-space:normal">${esc(nd.c[ci])}${trecho ? `<div class="trecho">${esc(trecho)}${pass ? " · " + esc(pass) : ""}</div>` : ""}</td>
      <td class="num"><b>${brl((cent / 100) * F, 2)}</b>${glosa ? `<div class="glosa">glosa ${brl((glosa / 100) * F, 2)}</div>` : ""}</td>
      <td class="sub">${esc(num || "")}</td><td>${linkNota(u, ano)}</td></tr>`;
  }
  async function mostrarNotasDoFornecedor(btn) {
    const tr = btn.closest("tr"), prox = tr.nextElementSibling, chaveSub = `${btn.dataset.vernotas}/${btn.dataset.ano}`;
    if (prox?.classList.contains("sub-notas")) { prox.remove(); if (prox.dataset.k === chaveSub) return; }
    const ano = btn.dataset.ano, chave = btn.dataset.chave, nd = await notasDep(btn.dataset.vernotas, ano);
    const linha = document.createElement("tr"); linha.className = "sub-notas"; linha.dataset.k = chaveSub;
    if (!nd) { linha.innerHTML = `<td colspan="5" class="sub">Notas não disponíveis.</td>`; tr.after(linha); return; }
    const rs = ano == E.resumo.ano ? E.resumo : await cache("r" + ano, () => getJSON(`dados/${ano}/resumo.json`));
    const F = corrigir() ? rs?.fator_ipca || 1 : 1;
    const fi = nd.f.findIndex((f) => f[0] === chave);
    const ns = nd.n.filter((n) => n[2] === fi);
    linha.innerHTML = `<td colspan="5"><table class="mini-tab"><thead><tr><th>Data</th><th>Tipo</th><th class="num">Valor</th><th>Nº</th><th></th></tr></thead><tbody>
      ${ns.map((n) => linhaNota(n, nd, ano, F, false)).join("")}</tbody></table></td>`;
    tr.after(linha);
  }
  async function renderNotasFicha(id, ano, rs) {
    const box = $("#notas-box"); if (!box) return;
    box.innerHTML = `<p class="sub">Carregando as notas…</p>`;
    const nd = await notasDep(id, ano);
    if (!nd) { box.innerHTML = `<p class="sub">As notas fiscais de ${ano} ainda não foram geradas para este deputado.</p>`; return; }
    const F = corrigir() ? rs?.fator_ipca || 1 : 1;
    box.innerHTML = `<div class="filtros-tabela">
        <input id="nf-busca" type="search" placeholder="Buscar fornecedor">
        <select id="nf-cat"><option value="">Todos os tipos de gasto</option>${nd.c.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join("")}</select>
        <select id="nf-mes"><option value="">Todos os meses</option>${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
        <select id="nf-ord"><option value="data">Mais antigas primeiro</option><option value="data-">Mais recentes primeiro</option><option value="valor">Maior valor</option></select>
      </div><p class="notas-resumo" id="nf-resumo"></p>
      <div class="tabela-rolagem"><table class="mini-tab"><thead><tr><th>Data</th><th>Fornecedor</th><th>Tipo de gasto</th><th class="num">Valor</th><th>Nº</th><th></th></tr></thead><tbody id="nf-corpo"></tbody></table></div>
      <button class="btn-sec mais" id="nf-mais" type="button" hidden>Mostrar mais</button>`;
    let lim = 100;
    const desenhar = () => {
      const q = semAcento($("#nf-busca").value.trim()), c = $("#nf-cat").value, m = $("#nf-mes").value, o = $("#nf-ord").value;
      let ns = nd.n.filter((n) => (!c || n[3] === +c) && (!m || Math.floor(n[0] / 100) === +m) && (!q || semAcento((nd.f[n[2]] || [])[1] || "").includes(q)));
      if (o === "valor") ns = ns.slice().sort((a, b) => b[1] - a[1]); else if (o === "data-") ns = ns.slice().reverse();
      $("#nf-resumo").textContent = `${nf(ns.length)} nota(s) · ${brl((soma(ns.map((n) => n[1])) / 100) * F, 2)}`;
      $("#nf-corpo").innerHTML = ns.slice(0, lim).map((n) => linhaNota(n, nd, ano, F)).join("") || `<tr><td colspan="6" class="sub">Nenhuma nota com esses filtros.</td></tr>`;
      $("#nf-mais").hidden = ns.length <= lim;
    };
    ["#nf-busca", "#nf-cat", "#nf-mes", "#nf-ord"].forEach((s) => $(s).addEventListener(s === "#nf-busca" ? "input" : "change", () => { lim = 100; desenhar(); }));
    $("#nf-mais").addEventListener("click", () => { lim += 200; desenhar(); });
    desenhar();
  }

  // ======================================================= NOVAS NOTAS DE HOJE
  const MARCAS = [
    [1, "Acima do normal do tipo", "#d13438", "valor maior que o de 95% das notas do mesmo tipo de gasto no ano"],
    [2, "Valor redondo", "#d9b300", "valor exato em milhares de reais"],
    [4, "Emitida no fim de semana", "#744ec2", "data de emissão num sábado ou domingo"],
    [8, "1ª vez com o fornecedor", "#e66c37", "primeira nota do deputado com esse fornecedor no ano"],
    [16, "Fornecedor novo na cota", "#e044a7", "ninguém tinha pago esse fornecedor no ano"],
    [32, "Emitida há mais de 90 dias", "#118dff", "nota antiga que só agora apareceu nos dados"],
    [64, "Com glosa", "#605e5c", "a Câmara cortou parte do valor pedido"],
    [128, "Estorno", "#197278", "valor negativo: devolução ou compensação"],
  ];
  const NV = { dia: null, marca: 0, lim: 100, dados: null };
  const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const rotuloDia = (dia) => { const h = hojeISO(); if (dia === h) return "Hoje"; if (diasEntre(dia, h) === 1) return "Ontem";
    const d = new Date(dia + "T12:00:00"); return `${SEMANA[d.getDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`; };
  const indiceNovas = () => cache("nv-indice", () => getJSON("dados/novas/indice.json"));
  const loteNovas = (dia) => cache("nv-" + dia, () => getJSON(`dados/novas/${dia}.json`));

  // junta um ou mais lotes (do mais antigo para o mais novo) numa lista de notas
  function juntarLotes(lotes) {
    const notas = [], deps = new Map(), forn = new Map(), cats = new Map(), tot = new Map();
    lotes.forEach((L) => Object.values(L.anos || {}).forEach((s) => {
      const ano = s.ano;
      Object.entries(s.dep || {}).forEach(([id, x]) => { const k = `${ano}|${id}`, o = deps.get(k);
        if (!o) deps.set(k, { id: +id, ano, nome: x[0], partido: x[1], uf: x[2], sexo: x[3], antes: x[4], depois: x[5], posA: x[6], posD: x[7], notasA: x[8] });
        else Object.assign(o, { nome: x[0], partido: x[1], uf: x[2], depois: x[5], posD: x[7] }); });
      s.f.forEach((f, i) => { const k = f[0], fx = s.fx[i], o = forn.get(k);
        if (!o) forn.set(k, { chave: k, nome: f[1], doc: f[2], tipo: f[3], antes: fx[0], depois: fx[1], depsA: fx[2], depsD: fx[3], ano });
        else Object.assign(o, { depois: fx[1], depsD: fx[3] }); });
      Object.entries(s.cat || {}).forEach(([c, x]) => { const k = `${ano}|${c}`, o = cats.get(k);
        if (!o) cats.set(k, { cat: c, ano, antes: x[0], depois: x[1], p50: x[2], p95: x[3], n: x[4] }); else o.depois = x[1]; });
      const t = tot.get(ano); if (!t) tot.set(ano, { ...s.tot }); else Object.assign(t, { depois: s.tot.depois, notas_depois: s.tot.notas_depois });
      s.n.forEach((n) => { const f = s.f[n[1]] || [], cat = s.c[n[2]];
        notas.push({ dia: L.data === "semana" ? (L.gerado_em || "").slice(0, 10) : L.data, ano, id: n[0], chave: f[0], fnome: f[1], doc: f[2], tipo: f[3], cat, data: n[3], v: n[4] / 100, num: n[5], url: n[6],
          glosa: n[7] / 100, m: n[8], trecho: n[9] || "", pass: n[10] || "", dep: deps.get(`${ano}|${n[0]}`), cx: cats.get(`${ano}|${cat}`) }); });
    }));
    notas.forEach((n) => { n.dep = deps.get(`${n.ano}|${n.id}`); n.cx = cats.get(`${n.ano}|${n.cat}`); n.fx = forn.get(n.chave); });
    return { notas, deps, forn, cats, tot };
  }

  async function renderNovas() {
    const idx = await indiceNovas();
    const aviso = $("#nv-aviso"), corpo = $("#nv-conteudo");
    const dias = idx?.dias || [], sem = idx?.semana;
    if (!dias.length && !sem) {
      corpo.hidden = true; aviso.hidden = false; $("#nv-dias").innerHTML = ""; $("#nv-sub").textContent = "";
      aviso.innerHTML = idx?.inicio
        ? `O robô começou a acompanhar as notas em ${dataBR(idx.inicio)}. A cada atualização diária, as despesas que a Câmara publicar aparecem aqui. Ainda não houve notas novas desde então.`
        : `Esta página começa a funcionar depois da próxima atualização do robô: no primeiro dia ele guarda as notas que já existem e, a partir do dia seguinte, mostra só as novas.`;
      return;
    }
    corpo.hidden = false;
    // padrão: as notas emitidas na última semana com dados publicados
    if (!NV.dia || (NV.dia !== "todos" && NV.dia !== "semana" && !dias.some((d) => d.data === NV.dia)) || (NV.dia === "semana" && !sem)) NV.dia = sem ? "semana" : dias[0].data;
    const h = hojeISO();
    $("#nv-dias").innerHTML = (sem ? `<button type="button" data-nv-dia="semana" aria-pressed="${NV.dia === "semana"}"><b>Última semana</b><span>${dataBR(sem.de).slice(0, 5)} a ${dataBR(sem.ate).slice(0, 5)} · ${nf(sem.notas)} notas · ${compacto(sem.valor)}</span></button>` : "") + dias.map((d) => `<button type="button" data-nv-dia="${d.data}" aria-pressed="${NV.dia === d.data}">
        <b>${rotuloDia(d.data)}</b><span>${nf(d.notas)} notas · ${compacto(d.valor)}</span></button>`).join("")
      + (dias.length > 1 ? `<button type="button" data-nv-dia="todos" aria-pressed="${NV.dia === "todos"}"><b>Últimos ${dias.length} lotes</b><span>${nf(soma(dias.map((d) => d.notas)))} notas · ${compacto(soma(dias.map((d) => d.valor)))}</span></button>` : "");
    const verif = idx.verificado_em ? new Date(idx.verificado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
    $("#nv-sub").innerHTML = `${NV.dia === "semana" ? `<b>Última semana</b>: notas emitidas de ${dataBR(sem.de)} a ${dataBR(sem.ate)} (os 7 dias até a nota mais recente que a Câmara já publicou). Os botões ao lado mostram as notas que a Câmara publicou em cada dia. ` : dias.length && dias[0].data !== h ? `Ainda não há notas novas hoje — o lote mais recente é de ${dataBR(dias[0].data)}. ` : ""}Última verificação: ${verif}. A Câmara publica as notas aos poucos, ao longo da semana. Valores da época (sem correção pela inflação). Passagens compradas pelo sistema da Câmara (SIGEPA) não entram aqui: o arquivo aberto não as traz nota a nota.`;
    aviso.hidden = true;
    const escolhidos = NV.dia === "todos" ? dias.map((d) => d.data) : [NV.dia];   // "semana" lê dados/novas/semana.json
    const lotes = (await Promise.all(escolhidos.map(loteNovas))).filter(Boolean).sort((a, b) => (a.data < b.data ? -1 : 1));
    NV.dados = juntarLotes(lotes);
    desenharNovas();
  }

  function desenharNovas() {
    const D = NV.dados; if (!D) return;
    const filtrar = (n) => !n.dep || passaFiltro({ id: n.id, uf: n.dep.uf, partido: n.dep.partido, nome: n.dep.nome });
    const ns = D.notas.filter(filtrar), filtrado = temFiltro();
    const fEl = $("#nv-filtro"); fEl.hidden = !filtrado;
    if (filtrado) fEl.innerHTML = `Com os filtros escolhidos: <b>${nf(ns.length)}</b> de ${nf(D.notas.length)} notas novas.`;
    const somaV = soma(ns.map((n) => n.v)), vals = ns.map((n) => n.v);
    const depsIds = new Map(); ns.forEach((n) => { const k = `${n.ano}|${n.id}`; const o = depsIds.get(k) || { dep: n.dep, v: 0, n: 0 }; o.v += n.v; o.n++; depsIds.set(k, o); });
    const fornV = new Map(); ns.forEach((n) => { const o = fornV.get(n.chave) || { f: n.fx, nome: n.fnome, v: 0, n: 0, deps: new Set(), ano: n.ano }; o.v += n.v; o.n++; o.deps.add(n.id); fornV.set(n.chave, o); });
    const anos = [...D.tot.keys()].sort();
    const T0 = soma(anos.map((a) => D.tot.get(a).antes)), T1 = soma(anos.map((a) => D.tot.get(a).depois));
    const NA = soma(anos.map((a) => D.tot.get(a).notas_antes));
    // impacto: Câmara inteira sem filtro; com filtro, sobre a cota dos deputados filtrados que tiveram notas novas
    const baseA = filtrado ? soma([...depsIds.values()].map((o) => o.dep?.antes || 0)) : T0;
    const imp = baseA > 0 ? somaV / baseA : null;
    const mediana = quantil(vals, 0.5), maior = ns.slice().sort((a, b) => b.v - a.v)[0];
    const novosNaCota = [...fornV.values()].filter((o) => o.f && o.f.antes === 0 && o.f.depsA === 0).length;
    const comDestaque = ns.filter((n) => n.m & (1 | 2 | 4 | 16)).length;
    kpis($("#nv-kpis"), [
      ["Notas novas", nf(ns.length), `de ${nf(depsIds.size)} deputado(s)`, css("--accent")],
      ["Valor das notas", compacto(somaV), NV.dia === "todos" ? "somando os lotes" : `publicadas ${NV.dia === hojeISO() ? "hoje" : "em " + dataBR(NV.dia)}`, css("--c-cota")],
      ["Impacto no ano", imp == null ? "—" : `+${nf(imp * 100, imp < 0.01 ? 2 : 1)}%`, filtrado ? "na cota desses deputados no ano" : `na cota parlamentar de ${anos.join(" e ")}`, css("--c-prev")],
      ["Fornecedores", nf(fornV.size), `${nf(novosNaCota)} sem nenhuma nota antes no ano`, css("--c-gabinete")],
      ["Valor médio por nota", brl(ns.length ? somaV / ns.length : 0), `mediana ${brl(mediana)} · no ano, média de ${brl(T0 / Math.max(NA, 1))}`, css("--c-ajuda")],
      ["Maior nota nova", maior ? brl(maior.v) : "—", maior ? `${esc(maior.dep?.nome || "")} · ${esc(maior.fnome || "")}` : "", css("--danger")],
      ["Notas com destaque", nf(comDestaque), "acima do normal, redondas, de fim de semana ou de fornecedor novo", "#d13438"],
    ]);

    // impacto por tipo de gasto (HTML)
    const porCat = new Map(); ns.forEach((n) => { const o = porCat.get(n.cat) || { v: 0, n: 0, antes: 0 }; o.v += n.v; o.n++; porCat.set(n.cat, o); });
    [...D.cats.values()].forEach((c) => { const o = porCat.get(c.cat); if (o) o.antes += c.antes; });
    const cl = [...porCat.entries()].sort((a, b) => b[1].v - a[1].v);
    const maxPct = Math.max(...cl.map(([, o]) => (o.antes > 0 ? o.v / o.antes : 0)), 0.0001);
    $("#nv-impacto-dica").textContent = filtrado ? "o quanto as notas novas aumentaram cada tipo de gasto no ano (Câmara inteira)" : "o quanto as notas novas aumentaram cada tipo de gasto no ano";
    $("#nv-impacto").innerHTML = `<p class="nv-frase">${filtrado ? `As notas novas desses deputados somam <b>${brl(somaV)}</b>.` :
      `Com as notas novas, a cota parlamentar de ${anos.join(" e ")} passou de <b>${brl(T0)}</b> para <b>${brl(T1)}</b> (<b>+${brl(T1 - T0)}</b>) e de ${nf(NA)} para ${nf(soma(anos.map((a) => D.tot.get(a).notas_depois)))} notas.`}</p>
      <div class="nv-barras">${cl.slice(0, 10).map(([c, o]) => { const p = o.antes > 0 ? o.v / o.antes : null;
        return `<div class="nv-barra"><span class="nv-b-rot">${esc(c)}</span><span class="nv-b-val">+${compacto(o.v)}<small>${nf(o.n)} nota(s)</small></span>
          <span class="nv-b-trilho"><i style="width:${p == null ? 100 : Math.max(2, (100 * p) / maxPct).toFixed(1)}%"></i></span>
          <span class="nv-b-pct">${p == null ? "tipo novo no ano" : "+" + nf(p * 100, p < 0.01 ? 2 : 1) + "% no ano"}</span></div>`; }).join("")}</div>`;

    // por tipo
    barraH("g-nv-cat", cl.map((c) => c[0]), cl.map((c) => c[1].v), css("--c-cota"), {
      tooltip: { callbacks: { label: (c) => { const o = cl[c.dataIndex][1]; return `${brl(o.v)} · ${o.n} nota(s)${o.antes ? " · +" + nf((100 * o.v) / o.antes, 2) + "% no tipo, no ano" : ""}`; } } } });
    // deputados
    const dl = [...depsIds.values()].sort((a, b) => b.v - a.v).slice(0, 15);
    barraH("g-nv-dep", dl.map((o) => `${o.dep?.nome || "?"} (${o.dep?.partido || ""}-${o.dep?.uf || ""})`), dl.map((o) => o.v), css("--accent"), {
      tooltip: { callbacks: { label: (c) => { const o = dl[c.dataIndex]; return `${brl(o.v)} · ${o.n} nota(s)${o.dep?.antes > 0 ? " · +" + nf((100 * o.v) / o.dep.antes, 1) + "% na cota dele(a) no ano" : ""}`; } } },
      onClick: (_, el) => { if (el.length) { const o = dl[el[0].index]; abrir(o.dep.id, o.dep.ano); } } });
    // subiu no ranking
    const sub = [...depsIds.values()].map((o) => ({ ...o, salto: o.dep?.posA ? o.dep.posA - o.dep.posD : null })).filter((o) => o.dep);
    const top = sub.filter((o) => o.salto > 0).sort((a, b) => b.salto - a.salto || b.v - a.v).slice(0, 10);
    const entraram = sub.filter((o) => o.salto == null);
    $("#nv-subiu").innerHTML = top.map((o) => `<li><span class="nv-salto">▲ ${nf(o.salto)}</span><div>
        <button class="link-dep" data-dep="${o.dep.id}" data-ano="${o.dep.ano}">${esc(o.dep.nome)}</button> <span class="sub">${esc(o.dep.partido || "")}-${esc(o.dep.uf || "")}</span>
        <div class="sub">de <b>${nf(o.dep.posA)}º</b> para <b>${nf(o.dep.posD)}º</b> no gasto da cota · +${brl(o.v)} em ${o.n} nota(s) · cota no ano: ${compacto(o.dep.antes)} → ${compacto(o.dep.depois)}</div></div></li>`).join("")
      + (entraram.length ? `<li class="nv-entraram"><span class="nv-salto novo">novo</span><div><b>${nf(entraram.length)}</b> deputado(s) tiveram a primeira nota do ano: ${entraram.slice(0, 8).map((o) => `<button class="link-dep" data-dep="${o.dep.id}" data-ano="${o.dep.ano}">${esc(o.dep.nome)}</button>`).join(", ")}${entraram.length > 8 ? "…" : ""}</div></li>` : "")
      || `<li class="sub">Ninguém mudou de posição com estas notas.</li>`;
    // fornecedores
    const fl = [...fornV.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 15);
    const curto = (n) => ((n || "").length > 34 ? n.slice(0, 32) + "…" : n);
    barraH("g-nv-forn", fl.map(([, o]) => curto(o.nome) + (o.f && o.f.antes === 0 ? " ★" : "")), fl.map(([, o]) => o.v), fl.map(([, o]) => (o.f && o.f.antes === 0 ? "#e044a7" : css("--c-cota"))), {
      tooltip: { callbacks: { label: (c) => { const o = fl[c.dataIndex][1]; return `${brl(o.v)} · ${o.n} nota(s) · ${o.deps.size} deputado(s)${o.f ? (o.f.antes === 0 ? " · ★ novo na cota no ano" : " · no ano: " + compacto(o.f.antes) + " → " + compacto(o.f.depois)) : ""}`; } } },
      onClick: (_, el) => { if (el.length) { const [k, o] = fl[el[0].index]; abrirFornecedor(k, o.ano); } } });
    // estado e partido
    const porUF = {}, porP = {};
    ns.forEach((n) => { const u = n.dep?.uf, p = n.dep?.partido || "—"; if (u) porUF[u] = (porUF[u] || 0) + n.v; porP[p] = (porP[p] || 0) + n.v; });
    mapa($("#mapa-nv"), $("#mapa-nv-leg"), porUF, compacto, (uf) => { $("#f-uf").value = $("#f-uf").value === uf ? "" : uf; listaNomes(); atualizar(); }, $("#f-uf").value);
    const pl = Object.entries(porP).sort((a, b) => b[1] - a[1]).slice(0, 20);
    barraH("g-nv-partido", pl.map((p) => p[0]), pl.map((p) => p[1]), pl.map((p) => (p[0] === $("#f-partido").value ? css("--c-prev") : css("--accent"))), {
      onClick: (_, el) => { if (!el.length) return; const v = pl[el[0].index][0]; $("#f-partido").value = $("#f-partido").value === v ? "" : v; listaNomes(); atualizar(); } });
    // atraso entre emissão e publicação
    const FX = [[0, 7, "até 7 dias"], [8, 15, "8–15"], [16, 30, "16–30"], [31, 60, "31–60"], [61, 90, "61–90"], [91, 1e9, "mais de 90"]];
    const atr = ns.filter((n) => n.data).map((n) => diasEntre(n.data, n.dia));
    grafico("g-nv-atraso", { type: "bar", data: { labels: FX.map((f) => f[2]), datasets: [{ label: "Notas", data: FX.map(([a, b]) => atr.filter((x) => x >= a && x <= b).length), backgroundColor: css("--c-gabinete"), borderRadius: 3 }] },
      options: { scales: { x: { title: { display: true, text: `dias · mediana: ${nf(quantil(atr, 0.5))} dias` }, grid: { display: false } }, y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
    // dia da semana
    const sem = Array(7).fill(0), semV = Array(7).fill(0);
    ns.forEach((n) => { if (!n.data) return; const d = new Date(n.data + "T12:00:00").getDay(); sem[d]++; semV[d] += n.v; });
    grafico("g-nv-semana", { type: "bar", data: { labels: SEMANA, datasets: [{ label: "Notas", data: sem, backgroundColor: SEMANA.map((_, i) => (i === 0 || i === 6 ? "#744ec2" : css("--accent"))), borderRadius: 3 }] },
      options: { scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y} nota(s) · ${brl(semV[c.dataIndex])}` } } } } });
    // tamanho das notas
    const FV = [[-1e12, 0, "estornos"], [0, 50, "até 50"], [50, 200, "50–200"], [200, 500, "200–500"], [500, 1000, "500–1 mil"], [1000, 5000, "1–5 mil"], [5000, 10000, "5–10 mil"], [10000, 1e12, "10 mil+"]];
    const usar = FV.filter(([a]) => a >= 0 || vals.some((v) => v < 0));
    grafico("g-nv-hist", { type: "bar", data: { labels: usar.map((f) => f[2]), datasets: [{ label: "Notas", data: usar.map(([a, b]) => vals.filter((v) => (a < 0 ? v < 0 : v >= a && v < b)).length), backgroundColor: css("--c-cota"), borderRadius: 3 }] },
      options: { scales: { x: { title: { display: true, text: "valor da nota (R$)" }, grid: { display: false } }, y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
    // estatísticas
    const media = vals.length ? somaV / vals.length : 0, dp = vals.length > 1 ? Math.sqrt(soma(vals.map((v) => (v - media) ** 2)) / (vals.length - 1)) : 0;
    const p95 = ns.filter((n) => n.m & 1).length, comp95 = ns.filter((n) => n.cx && n.cx.n >= 20 && n.v > 0).length;
    const linhaE = (r, a, b = "—") => `<tr><td>${r}</td><td class="num"><b>${a}</b></td><td class="num">${b}</td></tr>`;
    $("#nv-estat").innerHTML = `<thead><tr><th>Medida</th><th class="num">Notas novas</th><th class="num">Ano, antes do lote</th></tr></thead><tbody>
      ${linhaE("Quantidade de notas", nf(ns.length), filtrado ? "—" : nf(NA))}
      ${linhaE("Soma", brl(somaV), filtrado ? brl(baseA) : brl(T0))}
      ${linhaE("Média por nota", brl(media), filtrado ? "—" : brl(T0 / Math.max(NA, 1)))}
      ${linhaE("Mediana", brl(mediana))}
      ${linhaE("Desvio-padrão", brl(dp))}
      ${linhaE("Coeficiente de variação", media ? nf((dp / Math.abs(media)) * 100) + "%" : "—")}
      ${linhaE("1º quartil (25%)", brl(quantil(vals, 0.25)))}
      ${linhaE("3º quartil (75%)", brl(quantil(vals, 0.75)))}
      ${linhaE("Menor / maior", vals.length ? `${brl(Math.min(...vals))} / ${brl(Math.max(...vals))}` : "—")}
      ${linhaE("Acima do normal do tipo (p95)", comp95 ? `${nf(p95)} (${nf((100 * p95) / comp95, 1)}%)` : "—", "esperado: cerca de 5%")}
      ${linhaE("Emitidas no fim de semana", nf(ns.filter((n) => n.m & 4).length))}
      ${linhaE("Total glosado pela Câmara", brl(soma(ns.map((n) => n.glosa))))}</tbody>`;
    // destaques
    const cont = Object.fromEntries(MARCAS.map(([b]) => [b, ns.filter((n) => n.m & b).length]));
    $("#nv-marcas").innerHTML = `<button style="--c:#605e5c" data-nv-marca="0" aria-pressed="${!NV.marca}"><b>${nf(ns.length)}</b><span>Todas as notas novas</span></button>` +
      MARCAS.filter(([b]) => cont[b] || NV.marca === b).map(([b, rot, cor, exp]) => `<button style="--c:${cor}" data-nv-marca="${b}" aria-pressed="${NV.marca === b}" title="${esc(exp)}"><b>${nf(cont[b])}</b><span>${rot}</span></button>`).join("");
    // filtro de tipo na tabela
    const sc = $("#nv-cat"), at = sc.value, catsL = [...new Set(ns.map((n) => n.cat))].sort();
    sc.innerHTML = `<option value="">Todos os tipos de gasto</option>` + catsL.map((c) => `<option>${esc(c)}</option>`).join("");
    sc.value = catsL.includes(at) ? at : "";
    NV.ns = ns; tabelaNovas();
  }

  function tabelaNovas() {
    const ns0 = NV.ns || [], q = semAcento($("#nv-busca").value.trim()), qd = q.replace(/\D/g, ""), cat = $("#nv-cat").value, o = $("#nv-ord").value;
    let ns = ns0.filter((n) => (!NV.marca || n.m & NV.marca) && (!cat || n.cat === cat)
      && (!q || semAcento(n.dep?.nome || "").includes(q) || semAcento(n.fnome || "").includes(q) || (qd.length >= 3 && (n.doc || "").replace(/\D/g, "").includes(qd))));
    const vezes = (n) => (n.cx?.p50 > 0 ? n.v / n.cx.p50 : 0);
    const ords = { valor: (a, b) => b.v - a.v, emissao: (a, b) => (b.data || "").localeCompare(a.data || ""), "emissao-": (a, b) => (a.data || "9").localeCompare(b.data || "9"),
      dep: (a, b) => (a.dep?.nome || "").localeCompare(b.dep?.nome || "", "pt-BR") || b.v - a.v, vezes: (a, b) => vezes(b) - vezes(a) };
    ns = ns.slice().sort(ords[o] || ords.valor);
    const varios = NV.dia === "todos";
    $("#nv-contagem").textContent = `${nf(ns.length)} nota(s) · ${brl(soma(ns.map((n) => n.v)))}`;
    $("#nv-tab").innerHTML = `<thead><tr><th>Emissão</th><th>Deputado</th><th>Fornecedor</th><th>Tipo de gasto</th><th class="num">Valor</th><th>Destaques</th><th>Nota</th></tr></thead><tbody>` +
      (ns.slice(0, NV.lim).map((n) => { const vz = vezes(n);
        return `<tr><td>${dataBR(n.data)}${varios ? `<div class="sub">publicada ${n.dia.slice(8, 10)}/${n.dia.slice(5, 7)}</div>` : ""}</td>
        <td class="nome-cel"><button class="link-dep" data-dep="${n.id}" data-ano="${n.ano}">${esc(n.dep?.nome || "Deputado " + n.id)}</button> <span class="sub">${esc(n.dep?.partido || "")}-${esc(n.dep?.uf || "")}</span></td>
        <td class="nome-cel"><button class="link-forn" data-forn="${esc(n.chave)}" data-ano="${n.ano}">${esc(n.fnome || "—")}</button><div class="sub">${etqTipo(n.tipo)} ${esc(n.doc || "")}</div></td>
        <td class="sub" style="white-space:normal">${esc(n.cat)}${n.trecho ? `<div class="trecho">${esc(n.trecho)}${n.pass ? " · " + esc(n.pass) : ""}</div>` : ""}</td>
        <td class="num"><b>${brl(n.v, 2)}</b>${vz >= 1.5 ? `<div class="sub">${nf(vz, 1)}× a nota típica do tipo</div>` : ""}${n.glosa ? `<div class="glosa">glosa ${brl(n.glosa, 2)}</div>` : ""}</td>
        <td class="nv-tags">${MARCAS.filter(([b]) => n.m & b).map(([, rot, cor, exp]) => `<span style="--c:${cor}" title="${esc(exp)}">${rot}</span>`).join("")}</td>
        <td>${linkNota(n.url, n.ano)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="sub">Nenhuma nota com esses filtros.</td></tr>`) + `</tbody>`;
    $("#nv-mais").hidden = ns.length <= NV.lim;
  }

  // ===================================================== PONTOS DE ATENÇÃO
  async function renderAtencao() {
    const todos = (await cache("pt" + E.resumo.ano, () => getJSON(`dados/${ehTotal() ? "total" : E.resumo.ano}/pontos.json`))) || [];
    const pts = todos.filter(passaFiltro);
    const cont = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, pts.filter((p) => p.tipo === t).length]));
    $("#a-tipos").innerHTML = `<button style="--c:#605e5c" data-tipo="" aria-pressed="${!E.tipoPt}"><b>${pts.length}</b><span>Todos os pontos ${ehTotal() ? "de " + rotuloAno() : "em " + E.resumo.ano}</span></button>` +
      Object.entries(TIPOS).map(([t, [rot, cor]]) => `<button style="--c:${cor}" data-tipo="${t}" aria-pressed="${E.tipoPt === t}"><b>${cont[t]}</b><span>${rot}</span></button>`).join("");
    const lista = pts.filter((p) => !E.tipoPt || p.tipo === E.tipoPt);
    // por partido (pontos por deputado)
    const deps = filtrados(), np = {};
    deps.forEach((d) => { const k = d.partido || "—"; np[k] = np[k] || { n: 0, p: 0 }; np[k].n++; np[k].p += d.pontos || 0; });
    const pl = Object.entries(np).filter(([, v]) => v.n >= 3).map(([k, v]) => [k, v.p / v.n, v.n]).sort((a, b) => b[1] - a[1]).slice(0, 15);
    barraH("g-at-partido", pl.map((p) => p[0]), pl.map((p) => p[1]), "#d13438", { ticks: { callback: (v) => nf(v, 1) },
      tooltip: { callbacks: { label: (c) => `${nf(c.parsed.x, 2)} ponto(s) por deputado · ${pl[c.dataIndex][2]} deputados` } } });
    // deputados com mais pontos (empilhado por tipo)
    const porDep = {};
    pts.forEach((p) => { const o = (porDep[p.id] = porDep[p.id] || { nome: p.nome, tipos: {}, n: 0 }); o.tipos[p.tipo] = (o.tipos[p.tipo] || 0) + 1; o.n++; });
    const top = Object.entries(porDep).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
    grafico("g-at-top", { type: "bar", data: { labels: top.map(([, o]) => o.nome), datasets: Object.entries(TIPOS).map(([t, [rot, cor]]) => ({ label: rot, backgroundColor: cor,
      data: top.map(([, o]) => o.tipos[t] || 0) })) },
      options: { indexAxis: "y", scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } }, plugins: { legend: legBaixo },
        onClick: (_, el) => { if (el.length) abrir(top[el[0].index][0]); } } });
    $("#a-titulo-lista").textContent = E.tipoPt ? TIPOS[E.tipoPt][0] : "Todos os pontos";
    $("#a-lista").innerHTML = lista.slice(0, E.limitePt).map((p) => `<li style="--c:${TIPOS[p.tipo]?.[1] || "#999"}">
      <span class="tag">${TIPOS[p.tipo]?.[0] || p.tipo}${p.ano ? " · " + p.ano : ""}</span><button class="link-dep" data-dep="${p.id}" ${p.ano ? `data-ano="${p.ano}"` : ""}>${esc(p.nome)}</button>
      <span class="sub">${esc(p.partido || "")}-${esc(p.uf || "")} · ${brl(R(p.valor))}</span><p>${esc(p.texto)}</p></li>`).join("") ||
      `<li style="--c:#ccc"><p>Nenhum ponto de atenção com esses filtros.</p></li>`;
    $("#a-mais").hidden = lista.length <= E.limitePt;
  }

  // ========================================================= RANKINGS E MAPA
  function renderRankings() {
    const deps = filtrados(), F = fator();
    const cats = {};
    E.resumo.deputados.forEach((d) => Object.entries(d.categorias || {}).forEach(([k, v]) => (cats[k] = (cats[k] || 0) + v)));
    const ordem = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
    const atual = $("#r-cat").value;
    $("#r-cat").innerHTML = `<option value="__total">Custo total do mandato</option><option value="__cota">Cota parlamentar (tudo)</option>` +
      ordem.map((c) => `<option>${esc(c)}</option>`).join("");
    $("#r-cat").value = [...$("#r-cat").options].some((o) => o.value === atual) ? atual : "__total";
    const cat = $("#r-cat").value;
    const v = (d) => (cat === "__total" ? d.custo_mandato : cat === "__cota" ? d.custos.cota_parlamentar : (d.categorias || {})[cat] || 0);
    const nomeCat = cat === "__total" ? "custo total" : cat === "__cota" ? "cota parlamentar" : cat.toLowerCase();
    $("#r-tit-top").textContent = `Quem mais gastou com ${nomeCat}`;
    $("#r-tit-mapa").textContent = `${cat === "__total" ? "Custo total" : cat === "__cota" ? "Cota parlamentar" : cat} por estado`;
    const top = deps.filter((d) => v(d) > 0).sort((a, b) => v(b) - v(a)).slice(0, 15);
    barraH("g-r-top", top.map((d) => `${d.nome} (${d.partido}-${d.uf})`), top.map((d) => v(d) * F), css("--c-cota"), { onClick: (_, el) => { if (el.length) abrir(top[el[0].index].id); } });
    const porUF = {};
    deps.forEach((d) => { if (!d.uf) return; const u = (porUF[d.uf] = porUF[d.uf] || { t: 0, n: 0 }); u.t += v(d); u.n++; });
    mapa($("#mapa-r"), $("#mapa-r-leg"), Object.fromEntries(Object.entries(porUF).map(([k, x]) => [k, (x.t / x.n) * F])), compacto,
      (uf) => { $("#f-uf").value = $("#f-uf").value === uf ? "" : uf; atualizar(); }, $("#f-uf").value);
    const eco = deps.filter((d) => d.cota_uso != null && d.meses >= 10).sort((a, b) => a.cota_uso - b.cota_uso).slice(0, 12);
    if (eco.length) barraH("g-r-economia", eco.map((d) => `${d.nome} (${d.partido}-${d.uf})`), eco.map((d) => (1 - d.cota_uso) * 100), css("--ok"),
      { ticks: { callback: (x) => x + "%" }, tooltip: { callbacks: { label: (c) => `${nf(c.parsed.x, 1)}% da cota sem uso` } }, onClick: (_, el) => { if (el.length) abrir(eco[el[0].index].id); } });
    else grafico("g-r-economia", { type: "bar", data: { labels: ["sem dados de uso da cota neste ano"], datasets: [{ data: [0] }] }, options: { plugins: { legend: { display: false } } } });
    // distribuição por partido (p25–p75 e mediana)
    const gp = {};
    deps.filter((d) => d.meses >= 3).forEach((d) => (gp[d.partido || "—"] = gp[d.partido || "—"] || []).push(d.custo_mensal_medio * F));
    const bx = Object.entries(gp).filter(([, a]) => a.length >= 5).map(([k, a]) => [k, quantil(a, .25), quantil(a, .5), quantil(a, .75), a.length]).sort((a, b) => b[2] - a[2]).slice(0, 16);
    grafico("g-r-box", { data: { labels: bx.map((b) => b[0]), datasets: [
      { type: "bar", label: "Metade do meio", data: bx.map((b) => [b[1], b[3]]), backgroundColor: "rgba(17,141,255,.35)", borderColor: css("--accent"), borderWidth: 1, borderSkipped: false },
      { type: "scatter", label: "Mediana", data: bx.map((b, i) => ({ x: b[0], y: b[2] })), backgroundColor: css("--c-gabinete"), pointRadius: 5 },
    ] }, options: { scales: { y: { beginAtZero: false, ticks: tickBRL }, x: { grid: { display: false } } },
      plugins: { legend: legBaixo, tooltip: { callbacks: { label: (c) => c.dataset.type === "scatter" ? `mediana ${brl(c.parsed.y)} (${bx[c.dataIndex][4]} deputados)` : `de ${brl(bx[c.dataIndex][1])} a ${brl(bx[c.dataIndex][3])}` } } } } });
  }

  // ============================================================ PREVISÕES
  function renderPrevisoes() {
    const r = E.resumo, md = r.meses_decorridos;
    const semRitmo = md < 12 && r.previsao_camara && !(r.deputados || []).some((d) => d.previsao?.ativo);
    const aberto = md < 12 && r.previsao_camara && !semRitmo;
    $("#prev-conteudo").hidden = !aberto; $("#prev-fechado").hidden = !!aberto;
    if (semRitmo) {
      $("#prev-fechado").innerHTML = `A previsão de ${r.ano} está indisponível nesta atualização: os dados da cota parlamentar vieram incompletos da Câmara. Ela volta sozinha na próxima atualização do robô.`;
      return;
    }
    if (!aberto) {
      const at = E.resumoAtual?.ano;
      $("#prev-fechado").innerHTML = `As previsões valem para o ano em andamento. ${ehTotal(r) ? "Você está vendo a soma de todos os anos." : r.ano + " já está fechado."}${at && at !== r.ano ? `<br><br><button class="btn-sec" id="ir-atual">Ver previsões de ${at}</button>` : ""}`;
      return;
    }
    const deps = filtrados(), F = fator();
    const ja = soma(deps.map((d) => d.custo_mandato)), rest = soma(deps.map(previsto));
    const marg = Math.sqrt(soma(deps.map((d) => (d.previsao?.ativo ? (d.previsao.max - d.previsao.restante) ** 2 : 0))));
    const ant = (E.historico?.anos || []).find((a) => a.ano === r.ano - 1);
    const varAno = ant && !temFiltro() ? ((ja + rest) * (r.fator_ipca || 1)) / ant.total_corrigido - 1 : null;
    kpis($("#prev-kpis"), [
      ["Já gasto em " + r.ano, compacto(ja * F), `até ${MESES[md - 1].toLowerCase()}`, css("--c-salario")],
      ["Deve gastar mais até dezembro", "+" + compacto(rest * F), `entre ${compacto((rest - marg) * F)} e ${compacto((rest + marg) * F)}`, css("--c-prev")],
      ["Total previsto no ano", compacto((ja + rest) * F), temFiltro() ? "com os filtros aplicados" : "Câmara inteira", css("--c-cota")],
      ["Em relação a " + (r.ano - 1), varAno == null ? "—" : `${varAno >= 0 ? "+" : ""}${nf(varAno * 100, 1)}%`, varAno == null ? "disponível sem filtros" : "em valores de hoje", css("--c-gabinete")],
    ]);
    const saz = r.previsao_camara.sazonalidade, real = Array(12).fill(0), pm = Array(12).fill(0);
    deps.forEach((d) => { const m = mensal(d); for (let i = 0; i < 12; i++) real[i] += m.fixo[i] + m.cota[i] + m.gabinete[i];
      if (d.previsao?.ativo) for (let i = md; i < 12; i++) pm[i] += d.previsao.ritmo_mensal_variavel * saz[i]; });
    const fixoPrev = Math.max(0, rest - soma(pm.slice(md))); for (let i = md; i < 12; i++) pm[i] += fixoPrev / (12 - md);
    const acR = [], acP = [], mn = [], mx = []; let s = 0;
    for (let i = 0; i < 12; i++) {
      if (i < md) { s += real[i]; acR.push(s * F); acP.push(i === md - 1 ? s * F : null); mn.push(i === md - 1 ? s * F : null); mx.push(i === md - 1 ? s * F : null); }
      else { s += pm[i]; const k = Math.sqrt((i - md + 1) / (12 - md)); acR.push(null); acP.push(s * F); mn.push((s - marg * k) * F); mx.push((s + marg * k) * F); }
    }
    grafico("g-prev", { type: "line", data: { labels: MESES, datasets: [
      { label: "Faixa (máx.)", data: mx, borderColor: "transparent", backgroundColor: "rgba(224,68,167,.15)", fill: "+1", pointRadius: 0 },
      { label: "Faixa (mín.)", data: mn, borderColor: "transparent", pointRadius: 0 },
      { label: "Realizado", data: acR, borderColor: css("--c-salario"), backgroundColor: css("--c-salario"), tension: .2 },
      { label: "Previsto", data: acP, borderColor: css("--c-prev"), backgroundColor: css("--c-prev"), borderDash: [6, 4], tension: .2 },
    ] }, options: { scales: { y: { ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: { ...legBaixo, labels: { filter: (i) => !i.text.startsWith("Faixa (mín") } } } } });
    const top = deps.filter((d) => d.previsao?.ativo).sort((a, b) => previsto(b) - previsto(a));
    const max = previsto(top[0] || {}) || 1;
    $("#prev-lista").innerHTML = top.slice(0, E.limitePrev).map((d, i) => { const p = d.previsao;
      return `<li><span class="n">${i + 1}</span><div><button class="link-dep" data-dep="${d.id}">${esc(d.nome)}</button> <span class="sub">(${esc(d.partido || "")}-${esc(d.uf || "")})</span>
        deve gastar mais <b class="v">${compacto(p.restante * F)}</b> até dezembro <span class="sub">— provavelmente entre ${compacto(p.min * F)} e ${compacto(p.max * F)}. Total previsto no ano: ${compacto(p.total_ano * F)}${p.ate_fim_mandato ? `; até o fim do mandato (jan/${r.ano + 1}): +${compacto(p.ate_fim_mandato * F)}` : ""}.</span>
        <div class="barra-prev"><i style="width:${(100 * p.restante / max).toFixed(1)}%"></i></div></div></li>`; }).join("");
    $("#prev-mais").hidden = top.length <= E.limitePrev;
  }

  // ============================================================= HISTÓRICO
  // ============================================================ BOAS-VINDAS
  function boasVindas(forcar = false) {
    const B = (window.TEXTOS || {}).boas_vindas; if (!B || (!B.ativo && !forcar)) return;
    const chave = "qcd_bv_" + (B.versao || 1);
    if (!forcar) { try { if (localStorage.getItem(chave)) return; } catch { /* sem armazenamento */ } }
    $("#bv-tit").textContent = B.titulo || "Bem-vindo";
    $("#bv-texto").innerHTML = (B.texto || []).map((t) => `<p>${t}</p>`).join("");
    $("#bv").hidden = false; $("#bv-ok").focus();
    const fechar = () => { $("#bv").hidden = true; try { localStorage.setItem(chave, "1"); } catch { /* ok */ } };
    $("#bv-ok").onclick = fechar; $("#bv-fechar").onclick = fechar;
    $("#bv").onclick = (e) => { if (e.target.id === "bv") fechar(); };
  }

  // ============================================================ PRESENÇA
  const presencaDoAno = (ano) => cache("pres" + ano, () => getJSON(`dados/${ano}/presenca.json`));
  // reuniões de comissão: a página do deputado (oficial) é mais completa que os dados abertos; usa a oficial quando existe
  const comissoes = (p) => (p.oficial_comissoes && p.oficial_comissoes.presencas != null ? p.oficial_comissoes.presencas : p.reunioes_comissao || 0);
  const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const diaBR = (s) => { const [a, m, d] = s.split("-").map(Number); return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} ${DIA_SEMANA[new Date(a, m - 1, d).getDay()]}`; };
  async function renderPresenca() {
    const vazio = $("#pr-vazio"), cont = $("#pr-conteudo");
    if (ehTotal()) { vazio.hidden = false; cont.hidden = true; vazio.textContent = "A presença é contada ano a ano. Escolha um ano no filtro acima."; return; }
    const P = await presencaDoAno(E.resumo.ano);
    if (!P || P.indisponivel || !(P.dias_sessao || []).length) {
      vazio.hidden = false; cont.hidden = true;
      vazio.textContent = `Os dados de presença de ${E.resumo.ano} ainda não foram gerados (ou a Câmara não publicou o arquivo deste ano). O robô tenta de novo a cada execução.`;
      return;
    }
    vazio.hidden = true; cont.hidden = false;
    const F = fator();
    const deps = filtrados().map((d) => ({ d, p: P.deputados[String(d.id)] })).filter((x) => x.p)
      .map((x) => ({ ...x, porDia: x.p.presencas ? (x.d.custo_mandato * F) / x.p.presencas : null }));
    const sd = soma(deps.map((x) => x.p.dias)), sp = soma(deps.map((x) => x.p.presencas)), sf = soma(deps.map((x) => x.p.faltas));
    const zero = deps.filter((x) => x.p.faltas === 0).length;
    kpis($("#pr-kpis"), [
      ["Dias com sessão deliberativa", nf(P.dias_sessao.length), `no Plenário em ${E.resumo.ano}${E.resumo.meses_decorridos < 12 ? " (até agora)" : ""}`, css("--accent")],
      ["Presença média", nf(sd ? (sp / sd) * 100 : 0, 1) + "%", `${nf(deps.length)} deputado(s) ${temFiltro() ? "no filtro" : "em exercício"}`, css("--ok")],
      ["Faltas somadas", nf(sf), "dias de sessão sem presença registrada", css("--danger")],
      ["Nenhuma falta", nf(zero), "deputados presentes em todos os dias", css("--c-gabinete")],
      ["Custo por dia de presença", brl(sp ? soma(deps.map((x) => x.d.custo_mandato * F)) / sp : 0), "custo do mandato ÷ dias com presença no Plenário", css("--danger")],
    ]);
    const q = semAcento($("#pr-busca").value.trim()), o = $("#pr-ord").value;
    const lista = deps.filter((x) => !q || semAcento(x.d.nome).includes(q));
    const ordem = { faltas: (a, b) => b.p.faltas - a.p.faltas || a.p.taxa - b.p.taxa, taxa: (a, b) => a.p.taxa - b.p.taxa || b.p.faltas - a.p.faltas,
      presencas: (a, b) => b.p.presencas - a.p.presencas, comissoes: (a, b) => comissoes(b.p) - comissoes(a.p),
      pordia: (a, b) => (b.porDia ?? Infinity) - (a.porDia ?? Infinity) }[o];
    lista.sort(ordem);
    const lim = E.limPres || 25;
    const of = (x) => x ? `${x.justificadas ?? "—"} just. · ${x.nao_justificadas ?? "—"} não just.` : "—";
    $("#pr-tab").innerHTML = `<thead><tr><th>#</th><th>Deputado</th><th class="num">Dias de sessão</th><th class="num">Presenças</th><th class="num">Faltas</th><th class="num">Presença</th><th class="num">Reuniões de comissão</th><th class="num">Custo por dia de presença</th><th>Faltas (oficial)</th></tr></thead><tbody>` +
      lista.slice(0, lim).map((x, i) => `<tr><td class="num">${i + 1}º</td><td><button class="link-dep" data-dep="${x.d.id}">${esc(x.d.nome)}</button> <span class="sub">${esc(x.d.partido || "")}-${esc(x.d.uf || "")}</span></td>
        <td class="num">${nf(x.p.dias)}</td><td class="num">${nf(x.p.presencas)}</td><td class="num"><b>${nf(x.p.faltas)}</b></td>
        <td class="num">${nf(x.p.taxa * 100, 1)}%<span class="barra-taxa"><i style="width:${x.p.taxa * 100}%"></i></span></td><td class="num" title="${x.p.oficial_comissoes ? `Página da Câmara: ${x.p.oficial_comissoes.presencas ?? "—"} presenças, ${x.p.oficial_comissoes.justificadas ?? "—"} ausências justificadas, ${x.p.oficial_comissoes.nao_justificadas ?? "—"} não justificadas` : "Contado nos dados abertos"}">${nf(comissoes(x.p))}</td><td class="num">${x.porDia ? brl(x.porDia) : "—"}</td><td class="sub">${of(x.p.oficial)}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td></td><td>Total (${nf(lista.length)} deputados)</td><td class="num">${nf(soma(lista.map((x) => x.p.dias)))}</td><td class="num">${nf(soma(lista.map((x) => x.p.presencas)))}</td><td class="num">${nf(soma(lista.map((x) => x.p.faltas)))}</td><td></td><td class="num">${nf(soma(lista.map((x) => comissoes(x.p))))}</td><td class="num">${(() => { const pp = soma(lista.map((x) => x.p.presencas)); return pp ? brl(soma(lista.map((x) => x.d.custo_mandato * F)) / pp) : "—"; })()}</td><td></td></tr></tfoot>`;
    $("#pr-mais").hidden = lista.length <= lim;
    grafico("g-pr-mes", { type: "bar", data: { labels: MESES, datasets: [{ label: "Dias com sessão deliberativa", data: P.dias_por_mes, backgroundColor: css("--accent") }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } } } } });
    $("#pr-recesso").textContent = "Recesso parlamentar: 18 a 31 de julho e 23 de dezembro a 1º de fevereiro. Sessões nesses períodos são extraordinárias e contam normalmente; dias sem sessão nunca contam como falta.";
    const porP = {}; deps.forEach((x) => { const o2 = (porP[x.d.partido] = porP[x.d.partido] || { d: 0, p: 0, n: 0 }); o2.d += x.p.dias; o2.p += x.p.presencas; o2.n++; });
    const ps = Object.entries(porP).filter(([, v]) => v.n >= 3).map(([k, v]) => [k, (v.p / v.d) * 100]).sort((a, b) => a[1] - b[1]);
    grafico("g-pr-partido", { type: "bar", data: { labels: ps.map((x) => x[0]), datasets: [{ data: ps.map((x) => x[1]), backgroundColor: css("--c-gabinete") }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => nf(c.parsed.y, 1) + "% de presença" } } }, scales: { y: { min: Math.max(0, Math.floor(Math.min(...ps.map((x) => x[1]), 100) / 10) * 10 - 10), max: 100, ticks: { callback: (v) => v + "%" } } } } });
  }

  // ============================================================ PROJETOS
  const projResumo = () => cache("pj-res", () => getJSON("dados/projetos/resumo.json"));
  const projPorDep = () => cache("pj-dep", () => getJSON("dados/projetos/por_deputado.json"));
  const projDoAno = (ano) => cache("pj-ano" + ano, () => getJSON(`dados/projetos/ano_${ano}.json`));
  const NIVEL = { alto: ["Alta", "#16865D"], medio: ["Média", "#2475B8"], baixo: ["Baixa", "#8FA3B8"], simbolico: ["Simbólica", "#B0B7C1"] };
  const cartaoProjeto = (x, url) => `<li style="--c:${NIVEL[x.nivel]?.[1] || "#999"}"><span class="tag pj-nivel">${NIVEL[x.nivel]?.[0] || x.nivel} · ${x.nota}</span>
    <a href="${esc((url || "").replace("{id}", x.id))}" target="_blank" rel="noopener"><b>${esc(x.sigla)} ${x.numero}/${x.ano}</b></a> <span class="sub">${esc(x.situacao_texto || x.situacao)} em ${dataCurta(x.data)}</span>
    <p>${esc(x.ementa)}</p>${(x.temas || []).length ? `<span class="sub">${esc(x.temas.slice(0, 3).join(" · "))}</span><br>` : ""}
    <span class="pj-autores">${(x.deputados_autores || []).length ? "Autoria: " + x.deputados_autores.slice(0, 5).map((a) => `<button class="link-dep" data-dep="${a[0]}">${esc(a[1])}</button> ${esc(a[2] || "")}-${esc(a[3] || "")}`).join(", ") + (x.n_autores > 5 ? ` e mais ${x.n_autores - 5}` : "") : "Autoria: " + esc(x.autor_principal || "—")}</span></li>`;

  async function renderProjetos() {
    const [R, PD] = await Promise.all([projResumo(), projPorDep()]);
    if (!R || !PD) { $("#pj-kpis").innerHTML = `<div class="vazio">Os projetos aprovados ainda não foram gerados. Rode o robô "Receita e projetos".</div>`; return; }
    const tot = ehTotal(), ano = String(E.resumo.ano);
    const pa = tot ? { total: R.total, leis: Object.values(R.por_ano).reduce((s, x) => s + (x.leis || 0), 0), alto: R.niveis.alto, medio: R.niveis.medio } : (R.por_ano[ano] || { total: 0, leis: 0, alto: 0, medio: 0 });
    kpis($("#pj-kpis"), [
      ["Projetos aprovados", nf(pa.total || 0), tot ? `desde ${R.desde}` : `em ${ano}`, css("--accent")],
      ["Viraram lei", nf(pa.leis || 0), "sancionados ou promulgados", css("--ok")],
      ["Relevância alta", nf(pa.alto || 0), "afetam muita gente (saúde, trabalho, renda…)", css("--c-gabinete")],
      ["Relevância média", nf(pa.medio || 0), "efeito real, mais limitado", css("--c-cota")],
    ]);
    // comparativo custo × projetos (deputados do filtro)
    const q = semAcento($("#pj-busca-dep").value.trim()), o = $("#pj-ord").value, F = fator();
    const linhas = filtrados().filter((d) => !q || semAcento(d.nome).includes(q)).map((d) => {
      const p = PD[String(d.id)];
      const y = tot ? (p ? [p.aprovados, p.leis, p.alto, p.medio] : [0, 0, 0, 0]) : ((p?.anos || {})[ano] || [0, 0, 0, 0, 0]);
      const rel = y[2] + y[3], custo = d.custo_mandato * F;
      return { d, aprov: y[0], leis: y[1], alto: y[2], medio: y[3], relev: rel, custo, custo_rel: rel ? custo / rel : null };
    });
    const ord = { relev: (a, b) => b.relev - a.relev || b.aprov - a.aprov, aprov: (a, b) => b.aprov - a.aprov, custo: (a, b) => b.custo - a.custo,
      custo_rel: (a, b) => (b.custo_rel ?? Infinity) - (a.custo_rel ?? Infinity) }[o];
    linhas.sort(ord);
    const lim = E.limPj || 25;
    $("#pj-comp").innerHTML = `<thead><tr><th>#</th><th>Deputado</th><th class="num">Custo ${tot ? "(todos os anos)" : "em " + ano}</th><th class="num">Aprovados</th><th class="num">Viraram lei</th><th class="num">Relevância alta</th><th class="num">Média</th><th class="num">Custo por projeto relevante</th></tr></thead><tbody>` +
      linhas.slice(0, lim).map((x, i) => `<tr><td class="num">${i + 1}º</td><td><button class="link-dep" data-dep="${x.d.id}">${esc(x.d.nome)}</button> <span class="sub">${esc(x.d.partido || "")}-${esc(x.d.uf || "")}</span></td>
        <td class="num">${brl(x.custo)}</td><td class="num">${nf(x.aprov)}</td><td class="num">${nf(x.leis)}</td><td class="num">${nf(x.alto)}</td><td class="num">${nf(x.medio)}</td>
        <td class="num">${x.custo_rel ? brl(x.custo_rel) : `<span class="sub">nenhum relevante</span>`}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td></td><td>Total (${nf(linhas.length)} deputados)</td><td class="num">${brl(soma(linhas.map((x) => x.custo)))}</td><td class="num" title="Um projeto com vários autores conta para cada um">${nf(soma(linhas.map((x) => x.aprov)))}*</td><td class="num">${nf(soma(linhas.map((x) => x.leis)))}*</td><td class="num">${nf(soma(linhas.map((x) => x.alto)))}*</td><td class="num">${nf(soma(linhas.map((x) => x.medio)))}*</td><td></td></tr></tfoot>`;
    $("#pj-comp-dica").textContent = "* um projeto com vários autores conta para cada um deles · " + (tot ? "custo e projetos somam todos os anos" : `projetos aprovados em ${ano}`);
    $("#pj-comp-mais").hidden = linhas.length <= lim;
    // lista de projetos do ano
    const sel = $("#pj-tema");
    if (sel.options.length <= 1) sel.innerHTML = `<option value="">Todos os temas</option>` + (R.temas_relevantes || []).map(([t]) => `<option>${esc(t)}</option>`).join("");
    if (tot) { $("#pj-lista-tit").textContent = "Projetos aprovados"; $("#pj-lista-aviso").textContent = "Escolha um ano no filtro para ver a lista de projetos, um a um."; $("#pj-lista").innerHTML = ""; $("#pj-mais").hidden = true; return; }
    const A = await projDoAno(ano);
    $("#pj-lista-tit").textContent = `Projetos aprovados em ${ano}`;
    if (!A) { $("#pj-lista-aviso").textContent = "Lista deste ano ainda não gerada."; $("#pj-lista").innerHTML = ""; return; }
    const nv = $("#pj-nivel").value, tm = $("#pj-tema").value, b = semAcento($("#pj-busca").value.trim());
    const ids = temFiltro() ? new Set(filtrados().map((d) => d.id)) : null;
    const it = A.itens.filter((x) => (!nv || x.nivel === nv) && (!tm || (x.temas || []).includes(tm)) && (!b || semAcento(x.ementa).includes(b))
      && (!ids || (x.deputados_autores || []).some((a) => ids.has(a[0])))).sort((a, b2) => b2.nota - a.nota || (b2.data > a.data ? 1 : -1));
    $("#pj-lista-aviso").textContent = `${nf(it.length)} projeto(s)${ids ? " com autoria de deputados do filtro" : ""}, dos mais relevantes para os menos.`;
    const lj = E.limPjL || 30;
    $("#pj-lista").innerHTML = it.slice(0, lj).map((x) => cartaoProjeto(x, A.url_proposicao)).join("");
    $("#pj-mais").hidden = it.length <= lj;
  }

  // presença e projetos dentro da ficha do deputado
  async function preencherAtuacao(id, ano) {
    const el = $("#d-atuacao"); if (!el) return;
    const tot = ehTotal();
    const [P, PD] = await Promise.all([tot ? null : presencaDoAno(ano), projPorDep()]);
    if (!$("#d-atuacao")) return;
    let h = "";
    const x = P && !P.indisponivel ? P.deputados[String(id)] : null;
    h += `<h3 class="d-sec">Presença no Plenário${tot ? "" : " em " + ano} <span class="selo-t t-es">Cálculo com dados abertos</span></h3>`;
    if (tot) h += `<p class="sub">Escolha um ano para ver a presença dia a dia.</p>`;
    else if (!x) h += `<p class="sub">Sem dados de presença para ${ano} ainda.</p>`;
    else {
      const url = P.url_evento || "";
      h += `<p><b>${nf(x.presencas)}</b> presença(s) em <b>${nf(x.dias)}</b> dias com sessão deliberativa (${nf(x.taxa * 100, 1)}%) · <b style="color:var(--danger)">${nf(x.faltas)} falta(s)</b> · ${nf(comissoes(x))} reunião(ões) de comissão com presença${x.oficial_comissoes ? ` (página da Câmara; ${nf(x.oficial_comissoes.nao_justificadas ?? 0)} ausência(s) não justificada(s) em comissões)` : ""}.</p>`;
      const dd = (E.resumo.deputados || []).find((z) => z.id === +id);
      if (dd && x.presencas) h += `<p><span class="selo-t t-es">Cálculo</span> Custo do mandato por dia de presença no Plenário: <b>${brl((dd.custo_mandato * fator()) / x.presencas)}</b> <span class="sub">(${brl(dd.custo_mandato * fator())} ÷ ${nf(x.presencas)} dias). O mandato também inclui trabalho em comissões, no gabinete e na base eleitoral.</span></p>`;
      if (x.oficial) h += `<p class="sub"><span class="selo-t t-of">Informação oficial</span> Página da Câmara: ${x.oficial.presencas ?? "—"} presenças, ${x.oficial.justificadas ?? "—"} ausências justificadas, ${x.oficial.nao_justificadas ?? "—"} não justificadas.</p>`;
      if (x.datas_falta.length) h += `<p class="sub">Dias de sessão sem presença registrada (toque para ver a sessão):</p><div class="pr-dias">${x.datas_falta.map((d) => { const s = (P.sessoes[d] || [])[0];
        return s ? `<a class="pr-dia" href="${esc(url.replace("{id}", s[0]))}" target="_blank" rel="noopener" title="${esc(s[1])}">${diaBR(d)}</a>` : `<span class="pr-dia">${diaBR(d)}</span>`; }).join("")}</div>`;
      else h += `<p class="sub">Presente em todos os dias de sessão deliberativa em que estava em exercício.</p>`;
    }
    const p = PD ? PD[String(id)] : null;
    const y = p ? (tot ? [p.aprovados, p.leis, p.alto, p.medio, null] : (p.anos || {})[String(ano)]) : null;
    h += `<h3 class="d-sec">Projetos aprovados${tot ? " (desde 2009)" : " em " + ano} <span class="selo-t t-of">Informação oficial</span></h3>`;
    h += y && y[0] ? `<p><b>${nf(y[0])}</b> aprovado(s) como autor ou coautor · ${nf(y[1])} virou(aram) lei · relevância alta: ${nf(y[2])}, média: ${nf(y[3])}${y[4] != null ? ` · ${nf(y[4])} como primeiro autor` : ""}${p && !tot ? ` · ${nf(p.aprovados)} desde 2009` : ""}.</p>${tot ? "" : `<button class="btn-sec" id="d-ver-proj" type="button">Ver os projetos aprovados de ${ano}</button><ol class="cartoes" id="d-proj"></ol>`}`
      : `<p class="sub">Nenhum projeto aprovado${tot ? "" : " em " + ano} com este deputado entre os autores${p ? ` (${nf(p.aprovados)} desde 2009)` : ""}.</p>`;
    el.innerHTML = h;
    $("#d-ver-proj")?.addEventListener("click", async (ev) => {
      ev.target.disabled = true; const A = await projDoAno(ano);
      const it = (A?.itens || []).filter((z) => (z.deputados_autores || []).some((a) => a[0] === +id)).sort((a, b) => b.nota - a.nota);
      $("#d-proj").innerHTML = it.map((z) => cartaoProjeto(z, A.url_proposicao)).join("") || `<li><p>Lista indisponível.</p></li>`; ev.target.remove();
    });
  }

  // ==================================================== O QUE DAVA PRA FAZER
  function renderDava() {
    const R = window.REFERENCIAS; if (!R) return;
    const tot = ehTotal(), deps = filtrados();
    const F = tot ? 1 : (E.resumo.fator_ipca || 1);           // sempre em valores de hoje
    const precisaIpca = tot && !corrigir();
    const regs = R.excesso.grupos.map(([n, re]) => [n, new RegExp(re, "i")]);
    const grupos = regs.map(([n]) => ({ n, v: 0, cats: {} }));
    const porDep = deps.map((d) => {
      let v = 0;
      Object.entries(d.categorias || {}).forEach(([c, x]) => { const i = regs.findIndex(([, re]) => re.test(c)); if (i >= 0) { grupos[i].v += x * F; grupos[i].cats[c] = (grupos[i].cats[c] || 0) + x * F; v += x * F; } });
      return { d, v };
    });
    const base = soma(grupos.map((g) => g.v)), exc = base * R.excesso.percentual, pct = nf(R.excesso.percentual * 100, 0) + "%";
    const quem = temFiltro() ? `dos ${nf(deps.length)} deputados do filtro` : "dos deputados federais";
    $("#dv-sub").textContent = `${pct} do que a cota ${quem} gastou com transporte, alimentação, hospedagem e divulgação ${tot ? "em todos os anos" : "em " + E.resumo.ano}, em valores de hoje:`;
    $("#dv-total").textContent = precisaIpca ? "ligue “Valores de hoje”" : brl(exc);
    $("#dv-regra").textContent = `Base: ${brl(base)} gastos nesses grupos × ${pct}.`;
    const n = (x) => (x >= 10 ? nf(Math.floor(x)) : nf(x, 1));
    const cards = R.itens.map((it) => {
      const um = it.construcao + it.ano_funcionando, q = exc / um, so = exc / it.construcao;
      return `<div class="dv-card"><b class="dv-num">${n(q)}</b><span class="dv-rot">${esc(it.nome)}</span>
        <p>${it.feminino ? "construídas" : "construídos"} do zero e funcionando por 1 ano, sem gastar mais nada do orçamento <span class="sub">(${esc(it.detalhe)}: ${brl(it.construcao)} para construir + ${brl(it.ano_funcionando)} por ano)</span></p>
        <p class="sub">Só construir e equipar: ${n(so)} ${esc(so >= 2 ? it.plural || it.unidade : it.unidade)}.</p></div>`;
    }).join("");
    const bf = R.bolsa_familia, fam = exc / bf.por_familia_ano;
    $("#dv-cards").innerHTML = precisaIpca ? `<div class="vazio">Em "Todos os anos", ligue "Valores de hoje" para comparar.</div>` : cards +
      `<div class="dv-card"><b class="dv-num">${nf(Math.floor(fam))}</b><span class="dv-rot">famílias a mais no Bolsa Família</span><p>durante 1 ano <span class="sub">(${esc(bf.detalhe)}: ${brl(bf.por_familia_ano)} por família no ano)</span></p></div>`;
    $("#dv-grupos").innerHTML = `<thead><tr><th>Grupo</th><th class="num">Gasto</th><th class="num">${pct}</th></tr></thead><tbody>` +
      grupos.map((g) => `<tr><td style="white-space:normal;min-width:220px"><b>${esc(g.n)}</b><div class="sub">${Object.entries(g.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${esc(c)}: ${brl(v)}`).join(" · ")}</div></td><td class="num">${brl(g.v)}</td><td class="num">${brl(g.v * R.excesso.percentual)}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td>Total</td><td class="num">${brl(base)}</td><td class="num">${brl(exc)}</td></tr></tfoot>`;
    $("#dv-nota").textContent = R.excesso.nota || "";
    porDep.sort((a, b) => b.v - a.v);
    $("#dv-top").innerHTML = `<thead><tr><th>#</th><th>Deputado</th><th class="num">Gasto nesses grupos</th><th class="num">${pct}</th></tr></thead><tbody>` +
      porDep.slice(0, 10).map((x, i) => `<tr><td class="num">${i + 1}º</td><td><button class="link-dep" data-dep="${x.d.id}">${esc(x.d.nome)}</button> <span class="sub">${esc(x.d.partido || "")}-${esc(x.d.uf || "")}</span></td><td class="num">${brl(x.v)}</td><td class="num">${brl(x.v * R.excesso.percentual)}</td></tr>`).join("") + "</tbody>";
    const lnk = ([t, u]) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
    $("#dv-fontes").innerHTML = `<ul>${R.itens.map((it) => `<li><b>${esc(it.nome)}</b>: ${brl(it.construcao + it.ano_funcionando)} cada (${esc(it.detalhe)})<ul>${it.fontes.map((f) => `<li>${lnk(f)}</li>`).join("")}</ul></li>`).join("")}
      <li><b>Bolsa Família</b>: ${brl(bf.por_familia_ano)} por família no ano — ${lnk(bf.fonte)}</li></ul>`;
  }

  async function renderHistorico() {
    const anos = (E.historico?.anos || []).filter((a) => a.deputados > 0), c = corrigir();
    const fa = (a) => (c ? a.fator_ipca || 1 : 1);
    $("#hist-dica").textContent = (c ? `em valores de hoje (IPCA até ${E.historico?.ipca_referencia || "—"})` : "em valores da época")
      + (temFiltro() ? " · Câmara inteira: aqui os filtros valem só para a lista de saltos em ano eleitoral" : "");
    const fechados = anos.filter((a) => a.meses_decorridos === 12);
    const caro = fechados.slice().sort((a, b) => b.custo_mensal_medio_corrigido - a.custo_mensal_medio_corrigido)[0];
    const pri = fechados[0], ult = fechados[fechados.length - 1];
    kpis($("#h-kpis"), [
      ["Total desde " + (anos[0]?.ano || "—"), compacto(soma(anos.map((a) => a.total * fa(a)))), c ? "em valores de hoje" : "em valores da época", css("--c-salario")],
      ["Ano mais caro por deputado", caro ? String(caro.ano) : "—", caro ? brl(caro.custo_mensal_medio_corrigido) + " por mês (valores de hoje)" : "", css("--danger")],
      [pri && ult ? `De ${pri.ano} a ${ult.ano}` : "Variação", pri && ult ? `${ult.custo_mensal_medio_corrigido >= pri.custo_mensal_medio_corrigido ? "+" : ""}${nf((ult.custo_mensal_medio_corrigido / pri.custo_mensal_medio_corrigido - 1) * 100, 1)}%` : "—",
        "custo por deputado, descontada a inflação", css("--c-gabinete")],
    ]);
    const rot = anos.map((a) => a.ano + (a.meses_decorridos < 12 ? "*" : ""));
    grafico("g-hist", { type: "bar", data: { labels: rot, datasets: COMP.map(([k, r, cor]) => ({ label: r, backgroundColor: css(cor), data: anos.map((a) => (a.por_componente?.[k] || 0) * fa(a)) })) },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo },
        onClick: (_, el) => { if (el.length) { irAno(anos[el[0].index].ano); irPara("geral"); } } } });
    const ml = [], mv = [];
    anos.forEach((a) => (a.mensal || []).forEach((v, i) => { if (i < a.meses_decorridos) { ml.push(`${MESES[i]}/${String(a.ano).slice(2)}`); mv.push(v * fa(a)); } }));
    grafico("g-hist-mensal", { type: "line", data: { labels: ml, datasets: [{ label: "Custo no mês", data: mv, borderColor: css("--accent"), backgroundColor: "rgba(17,141,255,.12)", fill: true, pointRadius: 0, tension: .2 }] },
      options: { scales: { y: { ticks: tickBRL }, x: { ticks: { maxTicksLimit: 18 } } }, plugins: { tooltip: tipBRL(), legend: { display: false } } } });
    grafico("g-hist-medio", { type: "line", data: { labels: rot, datasets: [
      { label: "Valores de hoje", data: anos.map((a) => a.custo_mensal_medio_corrigido), borderColor: css("--accent"), backgroundColor: css("--accent"), tension: .25 },
      { label: "Valores da época", data: anos.map((a) => a.custo_mensal_medio), borderColor: css("--muted"), backgroundColor: css("--muted"), borderDash: [4, 4], tension: .25 },
    ] }, options: { scales: { y: { ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
    const tot = {}; anos.forEach((a) => Object.entries(a.categorias || {}).forEach(([k, v]) => (tot[k] = (tot[k] || 0) + v)));
    const top = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 7);
    grafico("g-hist-cat", { type: "bar", data: { labels: rot, datasets: [...top, "Outros"].map((k, i) => ({ label: k, backgroundColor: CORES[i % CORES.length],
      data: anos.map((a) => (k === "Outros" ? soma(Object.entries(a.categorias || {}).filter(([n]) => !top.includes(n)).map(([, v]) => v)) : (a.categorias || {})[k] || 0) * fa(a)) })) },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
    const el = (await cache("eleit", () => getJSON("dados/pontos_eleitorais.json"))) || [];
    const ef = el.filter(passaFiltro);
    $("#h-eleitoral").innerHTML = ef.slice(0, 20).map((p) => `<li style="--c:#d13438"><span class="tag">${p.ano}</span><button class="link-dep" data-dep="${p.id}" data-ano="${p.ano}">${esc(p.nome)}</button>
      <span class="sub">${esc(p.partido || "")}-${esc(p.uf || "")} · ${brl(p.valor)} a mais no ano</span><p>${esc(p.texto)}</p></li>`).join("") ||
      `<li style="--c:#ccc"><p>Nenhum caso com esses filtros (é preciso ter vários anos coletados).</p></li>`;
    $("#hist-tab").innerHTML = `<thead><tr><th>Ano</th><th class="num">Deputados</th><th class="num">Total (hoje)</th><th class="num">Total (época)</th><th class="num">Médio/mês (hoje)</th>
      <th class="num">Médio/mês (época)</th><th class="num">Emendas</th><th class="num">Gabinete informado</th></tr></thead><tbody>` +
      anos.slice().reverse().map((a) => `<tr><td>${a.ano}${a.meses_decorridos < 12 ? "*" : ""}</td><td class="num">${a.deputados}</td><td class="num">${compacto(a.total_corrigido)}</td>
        <td class="num">${compacto(a.total)}</td><td class="num">${brl(a.custo_mensal_medio_corrigido)}</td><td class="num">${brl(a.custo_mensal_medio)}</td>
        <td class="num">${compacto(a.emendas_empenhado)}</td><td class="num">${Math.round((a.cobertura_verba_gabinete ?? 1) * 100)}%</td></tr>`).join("") + `</tbody>`;
  }

  // ================================================================ FICHA
  async function abrir(id, ano = E.resumo.ano) {
    if (ano === "total") return abrirTotal(id);
    const dlg = $("#detalhe");
    $("#d-corpo").innerHTML = `<p class="sub">Carregando…</p>`;
    if (!dlg.open) dlg.showModal();
    try {
      const d = await cache(ano + "/" + id, () => getJSON(`dados/${ano}/dep/${id}.json`));
      if (!d) throw new Error("sem dados deste deputado em " + ano);
      const t = await cache("t" + id, () => getJSON(`dados/deputados/${id}.json`));
      const rs = ano == E.resumo.ano ? E.resumo : await cache("r" + ano, () => getJSON(`dados/${ano}/resumo.json`));
      const F = corrigir() ? rs?.fator_ipca || 1 : 1, RR = (v) => (v || 0) * F;
      const p = d.previsao, f = d.flags || {}, em = d.emendas;
      // percentis (custo médio mensal)
      const base = (rs?.deputados || []).filter((x) => x.meses >= 3);
      const pct = (grupo) => { const vs = grupo.map((x) => x.custo_mensal_medio); if (vs.length < 3) return null;
        return Math.round(100 * vs.filter((v) => v < d.custo_mensal_medio).length / vs.length); };
      const pcts = [["na Câmara", pct(base)], [`no ${d.uf}`, pct(base.filter((x) => x.uf === d.uf))], [`no ${d.partido}`, pct(base.filter((x) => x.partido === d.partido))]];
      const GK = { salario: "subsidio", ajuda_de_custo: "ajuda", auxilio_moradia: "auxilio", cota_parlamentar: "ceap", verba_gabinete: "gabinete" };
      const pecas = COMP.filter(([k]) => k !== "ajuda_de_custo" || d.custos[k] > 0).map(([k, rot, c]) => `<div class="peca" style="--c:var(${c})"><div class="rot">${T(GK[k], rot)}</div><div class="val num">${brl(RR(d.custos[k]))}</div></div>`).join("");
      const tab = (obj, lim = 8) => `<table>${Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, lim).map(([k, v]) => `<tr><td style="white-space:normal">${esc(k)}</td><td class="num">${brl(RR(v))}</td></tr>`).join("")}</table>`;
      const forn = ((d.ceap || {}).top_fornecedores || []).slice(0, 10).map((x) => { const dg = String(x.cnpj_cpf || "").replace(/\D/g, "");
        const nomeF = dg.length === 14 ? `<button class="link-forn" data-forn="${dg}" data-ano="${ano}">${esc(x.nome)}</button>` : esc(x.nome);
        return `<tr><td style="white-space:normal">${nomeF}<div class="sub">${dg.length === 14 ? esc(x.cnpj_cpf) : ""}</div></td><td class="num">${brl(RR(x.valor))}</td></tr>`; }).join("");
      const pts = d.pontos_de_atencao || [];
      $("#d-corpo").innerHTML = `
        <div class="d-cab"><img src="dados/fotos/${d.id}.jpg" data-alt="${esc(d.foto || "")}" alt="" onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=''}else{this.style.visibility='hidden'}">
          <div><h2 id="d-nome">${esc(d.nome)}</h2><div class="sub">${esc(d.partido || "")}-${esc(d.uf || "")} · ${d.meses} ${d.meses === 1 ? "mês" : "meses"} em exercício em ${ano}</div>
            <div class="selo-pos ${frasePosicao(d.posicao, rs?.deputados?.length || 0, d.sexo).barato ? "barato" : ""}">${esc(textoPosicao(d, rs?.deputados?.length || 0))} em ${ano}</div></div></div>
        <div class="sub">Custo do mandato em ${ano}${F > 1.0005 ? " (valores de hoje)" : ""}</div>
        <div class="d-total">${brl(RR(d.custo_mandato), 2)}</div>
        <div class="sub">${brl(RR(d.custo_mensal_medio))} por mês, em média${d.cota_uso != null ? ` · usou ${nf(d.cota_uso * 100)}% da cota disponível` : ""}</div>
        <div class="pecas">${pecas}</div>
        <div class="percentis">${pcts.filter((x) => x[1] != null).map(([r, v]) => `<div><b>${v >= 50 ? "mais caro" : "mais barato"} que ${v >= 50 ? v : 100 - v}%</b>dos deputados ${r}</div>`).join("")}</div>
        ${p?.ativo ? `<div class="caixa-prev">Deve gastar mais <b>${brl(RR(p.restante))}</b> até dezembro (provavelmente entre ${compacto(RR(p.min))} e ${compacto(RR(p.max))}), fechando ${ano} em cerca de <b>${compacto(RR(p.total_ano))}</b>.</div>` : ""}
        ${f.sem_verba_gabinete ? `<p class="aviso" style="margin:10px 0">A Câmara não informa a verba de gabinete deste deputado em ${ano}; o total está subestimado.</p>` : ""}
        ${pts.length ? `<h3 class="d-sec">Pontos de atenção em ${ano}</h3><ol class="cartoes">${pts.map((x) => `<li style="--c:${TIPOS[x.tipo]?.[1] || "#999"}"><span class="tag">${TIPOS[x.tipo]?.[0] || x.tipo}</span><p>${esc(x.texto)}</p></li>`).join("")}</ol>
          <p class="sub">Padrões estatísticos, não acusação. Confira as notas na página oficial.</p>` : ""}
        <div class="d-grade">
          <div><h3 class="d-sec">Gasto por mês em ${ano}</h3><div class="canvas-box"><canvas id="g-det-mes"></canvas></div></div>
          <div><h3 class="d-sec">Trajetória</h3><div class="canvas-box"><canvas id="g-det-traj"></canvas></div></div>
        </div>
        <div class="d-grade">
          <div><h3 class="d-sec">Cota por tipo de gasto</h3>${d.ceap || d.categorias ? tab(d.categorias || d.ceap.por_categoria, 10) : `<p class="sub">Sem dados da cota.</p>`}
            ${Math.abs(d.cota_sem_nota || 0) > 1 ? `<p class="sub">${brl(RR(d.cota_sem_nota))} estão na página oficial, mas não no arquivo nota a nota (${T("sem_nota", "o que é isso?")}).</p>` : ""}</div>
          <div><h3 class="d-sec">Quem mais recebeu da cota</h3>${forn ? `<table>${forn}</table>` : `<p class="sub">—</p>`}</div>
        </div>
        <h3 class="d-sec">Todas as despesas da cota em ${ano}, nota a nota</h3>
        <button class="btn-sec" id="ver-notas" type="button">Ver todas as notas fiscais</button>
        <div id="notas-box" class="notas-box"></div>
        <div id="d-atuacao"><p class="sub">Carregando presença e projetos…</p></div>
        <h3 class="d-sec">Emendas individuais de ${ano} <span class="sub">(fora do custo do mandato)</span></h3>
        ${em ? `<p><b>${brl(RR(em.empenhado))}</b> empenhados em ${em.qtd} registro(s) · ${brl(RR(em.pago))} pagos</p><div class="d-grade"><div>${tab(em.por_funcao)}</div>
          <div><table>${(em.top_destinos || []).slice(0, 8).map((x) => `<tr><td style="white-space:normal">${esc(x.destino)}</td><td class="num">${brl(RR(x.empenhado))}</td></tr>`).join("")}</table></div></div>`
          : `<p class="sub">Nenhuma emenda individual encontrada para ${ano}.</p>`}
        <p class="sub" style="margin-top:16px"><button class="btn" id="card-dep" type="button">Gerar imagem para compartilhar</button>
          <button class="btn-sec" data-comparar="${d.id}">${E.sel.includes(d.id) ? "Remover da comparação" : "Adicionar à comparação"}</button>
          · <a href="${esc(d.fonte_perfil)}" target="_blank" rel="noopener">página oficial na Câmara (com as notas fiscais)</a></p>`;
      E.ficha = { d, ano, rs };
      preencherAtuacao(d.id, ano);
      const m = mensal(d);
      grafico("g-det-mes", { type: "bar", data: { labels: MESES, datasets: [
        { label: "Salário e auxílios", data: m.fixo.map((v) => v * F), backgroundColor: css("--c-salario"), stack: "s" },
        { label: "Cota", data: m.cota.map((v) => v * F), backgroundColor: css("--c-cota"), stack: "s" },
        { label: "Gabinete", data: m.gabinete.map((v) => v * F), backgroundColor: css("--c-gabinete"), stack: "s" },
      ] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: tickBRL } }, plugins: { tooltip: tipBRL(), legend: legBaixo } } });
      const ta = (t?.anos || []);
      grafico("g-det-traj", { type: "bar", data: { labels: ta.map((a) => a.ano), datasets: [{ label: "Custo médio por mês",
        data: ta.map((a) => (corrigir() ? a.custo_mensal_medio * (a.custo_mandato_corrigido / (a.custo_mandato || 1)) : a.custo_mensal_medio)),
        backgroundColor: ta.map((a) => (a.ano == ano ? css("--c-prev") : css("--accent"))) }] },
        options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipBRL() } } });
      history.replaceState(null, "", location.search + "#dep-" + id);
    } catch (e) {
      $("#d-corpo").innerHTML = `<p class="sub">Não foi possível carregar os detalhes (${esc(e.message)}).</p>`;
    }
  }

  // ----------------------------------------------------- ficha (todos os anos)
  async function abrirTotal(id) {
    const dlg = $("#detalhe");
    $("#d-corpo").innerHTML = `<p class="sub">Carregando…</p>`;
    if (!dlg.open) dlg.showModal();
    const arqT = corrigir() ? "resumo" : "resumo_nominal";
    const RT = ehTotal() ? E.resumo : await cache("rtotal-" + arqT, () => getJSON(`dados/total/${arqT}.json`));
    const d = RT?.deputados.find((x) => x.id === +id);
    const t = await cache("t" + id, () => getJSON(`dados/deputados/${id}.json`));
    if (!d) { $("#d-corpo").innerHTML = `<p class="sub">Deputado não encontrado.</p>`; return; }
    const GK = { salario: "subsidio", ajuda_de_custo: "ajuda", auxilio_moradia: "auxilio", cota_parlamentar: "ceap", verba_gabinete: "gabinete" };
    const pecas = COMP.filter(([k]) => d.custos[k] > 0).map(([k, rot, c]) => `<div class="peca" style="--c:var(${c})"><div class="rot">${T(GK[k], rot)}</div><div class="val num">${brl(d.custos[k])}</div></div>`).join("");
    const ta = t?.anos || [];
    $("#d-corpo").innerHTML = `
      <div class="d-cab"><img src="dados/fotos/${d.id}.jpg" data-alt="${esc(d.foto || "")}" alt="" onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=''}else{this.style.visibility='hidden'}">
        <div><h2 id="d-nome">${esc(d.nome)}</h2><div class="sub">${esc(d.partido || "")}-${esc(d.uf || "")} · ${(d.anos || []).length} ano(s) com mandato entre ${rotuloAno(RT)}</div>
          <div class="selo-pos ${frasePosicao(d.posicao, RT.deputados.length, d.sexo).barato ? "barato" : ""}">${esc(textoPosicao(d, RT.deputados.length))} (soma de todos os anos)</div></div></div>
      <div class="sub">Custo somado de todos os anos${corrigir() ? " (valores de hoje)" : " (valores da época)"}</div>
      <div class="d-total">${brl(d.custo_mandato, 2)}</div>
      <div class="sub">${brl(d.custo_mensal_medio)} por mês de mandato, em média · ${d.meses} meses no total</div>
      <div class="pecas">${pecas}</div>
      ${d.pontos ? `<p class="sub">${d.pontos} ponto(s) de atenção ao longo dos anos (veja na ficha de cada ano).</p>` : ""}
      <h3 class="d-sec">Custo em cada ano</h3>
      <div class="canvas-box"><canvas id="g-det-traj"></canvas></div>
      <div class="tabela-rolagem"><table style="margin-top:10px"><thead><tr><th>Ano</th><th>Partido</th><th class="num">Meses</th><th class="num">Custo</th><th class="num">Posição</th><th></th></tr></thead><tbody>
        ${ta.slice().reverse().map((a) => `<tr><td>${a.ano}</td><td>${esc(a.partido || "")}-${esc(a.uf || "")}</td><td class="num">${a.meses}</td>
          <td class="num">${brl(corrigir() ? a.custo_mandato_corrigido : a.custo_mandato)}</td><td class="num">${a.posicao}º de ${a.de}</td>
          <td><button class="link-dep" data-dep="${d.id}" data-ano="${a.ano}">ver ficha do ano</button></td></tr>`).join("")}</tbody></table></div>
      <h3 class="d-sec">Cota por tipo de gasto (soma)</h3>
      <table>${Object.entries(d.categorias || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${brl(v)}</td></tr>`).join("")}</table>
      <p class="sub" style="margin-top:16px"><button class="btn" id="card-dep" type="button">Gerar imagem para compartilhar</button>
        <button class="btn-sec" data-comparar="${d.id}">${E.sel.includes(d.id) ? "Remover da comparação" : "Adicionar à comparação"}</button></p>`;
    E.ficha = { d, ano: rotuloAno(RT), rs: RT };
    grafico("g-det-traj", { type: "bar", data: { labels: ta.map((a) => a.ano), datasets: [{ label: "Custo no ano",
      data: ta.map((a) => (corrigir() ? a.custo_mandato_corrigido : a.custo_mandato)), backgroundColor: css("--accent"), borderRadius: 3 }] },
      options: { scales: { y: { ticks: tickBRL }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipBRL() } } });
    history.replaceState(null, "", location.search + "#dep-" + id);
  }

  // ============================================================ navegação
  function salvarURL() {
    const p = new URLSearchParams();
    ["ano", "uf", "partido"].forEach((k) => { const v = $("#f-" + k).value; if (v) p.set(k, v); });
    if (E.deps.length) p.set("deps", E.deps.join(",")); else if ($("#f-busca").value.trim()) p.set("busca", $("#f-busca").value.trim());
    if (!corrigir()) p.set("ipca", "0");
    if (E.pag !== "inicio") p.set("pag", E.pag);
    if (E.sel.length) p.set("comp", E.sel.join(","));
    history.replaceState(null, "", "?" + p.toString() + (location.hash.startsWith("#dep-") ? location.hash : ""));
  }
  function fecharMenu() { $("#menu").classList.remove("aberto"); $("#veu").hidden = true; $("#abrir-menu").setAttribute("aria-expanded", "false"); }
  function irPara(pag) {
    E.pag = pag;
    $$(".menu nav button").forEach((b) => (b.dataset.pag === pag ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    $$(".pagina").forEach((s) => s.classList.toggle("ativa", s.dataset.pag === pag));
    $("#segmentacoes").hidden = pag === "inicio" || pag === "metodo";
    $("#segmentacoes").classList.toggle("sem-ano", pag === "novas");
    fecharMenu(); window.scrollTo(0, 0);
    atualizar();
  }
  function avisos() {
    const h = (E.historico?.anos || []).find((x) => x.ano === E.resumo.ano), el = $("#aviso");
    const mostrar = h && h.cobertura_verba_gabinete < 0.9 && !["inicio", "metodo"].includes(E.pag);
    el.hidden = !mostrar;
    if (mostrar) el.textContent = `Atenção: em ${E.resumo.ano}, a Câmara só informa a verba de gabinete de ${Math.round(h.cobertura_verba_gabinete * 100)}% dos deputados. Para os demais, o custo aparece sem essa parte e fica subestimado.`;
  }
  function atualizar() {
    if (!E.resumo) return;
    avisos();
    ({ inicio: renderInicio, geral: renderGeral, deputados: renderDeputados, novas: renderNovas, comparar: renderComparar, fornecedores: renderFornecedores,
      atencao: renderAtencao, presenca: renderPresenca, projetos: renderProjetos, dava: renderDava, rankings: renderRankings, previsoes: renderPrevisoes, historico: renderHistorico }[E.pag] || (() => {}))();
    atualizarSelecao(); salvarURL();
  }
  function preencherOpcoes() {
    const fill = (sel, vals, todos) => { const at = sel.value; sel.innerHTML = `<option value="">${todos}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join(""); if (vals.includes(at)) sel.value = at; };
    fill($("#f-uf"), [...new Set(E.resumo.deputados.map((d) => d.uf).filter(Boolean))].sort(), "Todos");
    fill($("#f-partido"), [...new Set(E.resumo.deputados.map((d) => d.partido).filter(Boolean))].sort(), "Todos");
    listaNomes();
  }
  // ============================================ campo "Deputado(s)": lista própria
  // (a lista nativa do navegador só aparece depois de digitar em muitos celulares)
  const COMBO = { aberto: false, ativo: -1, itens: [], lim: 150 };
  const nomeDeId = (id) => (E.resumo?.deputados.find((x) => x.id === id) || {}).nome || E.nomes[id] || "Deputado " + id;
  function renderChips() {
    $("#combo-chips").innerHTML = E.deps.map((id) => { const fora = !E.resumo?.deputados.some((x) => x.id === id);
      return `<span class="cchip${fora ? " fora" : ""}"${fora ? ` title="sem mandato em ${esc(rotuloAno())}"` : ""}>${esc(nomeDeId(id))}<button type="button" data-tirar-dep="${id}" aria-label="Tirar ${esc(nomeDeId(id))} do filtro">×</button></span>`; }).join("");
    $("#f-busca").placeholder = E.deps.length ? "Adicionar outro…" : "Toque para ver a lista";
    $("#combo-campo").classList.toggle("com-chips", E.deps.length > 0);
  }
  function listaNomes() { renderChips(); if (COMBO.aberto) desenharLista(); }
  function desenharLista() {
    const uf = $("#f-uf").value, partido = $("#f-partido").value, q = semAcento($("#f-busca").value.trim()), F = fator();
    const base = (E.resumo?.deputados || []).filter((d) => (!uf || d.uf === uf) && (!partido || d.partido === partido));
    const deps = base.filter((d) => !q || semAcento(d.nome).includes(q)).sort((a, b) => {
      if (q) { const x = semAcento(a.nome).startsWith(q), y = semAcento(b.nome).startsWith(q); if (x !== y) return x ? -1 : 1; }
      return a.nome.localeCompare(b.nome, "pt-BR"); });
    COMBO.itens = deps.slice(0, COMBO.lim);
    if (COMBO.ativo >= COMBO.itens.length) COMBO.ativo = COMBO.itens.length - 1;
    $("#combo-info").innerHTML = `<b>${nf(deps.length)}</b> deputado(s)${uf || partido ? ` (${[uf, partido].filter(Boolean).join(" · ")})` : ""} em ${esc(rotuloAno())} · marque quantos quiser`
      + (E.deps.length ? ` · <button type="button" class="link" id="combo-limpar">desmarcar todos (${E.deps.length})</button>` : "");
    $("#combo-lista").innerHTML = (COMBO.itens.map((d, i) => { const sel = E.deps.includes(d.id);
      return `<li role="option" id="co-${d.id}" data-co="${d.id}" aria-selected="${sel}" class="${i === COMBO.ativo ? "ativo" : ""}">
        <span class="co-foto" aria-hidden="true"><i>${esc(iniciais(d.nome))}</i><img src="dados/fotos/${d.id}.jpg" alt="" loading="lazy" onerror="this.remove()"></span>
        <span class="co-nome">${esc(d.nome)}<small>${esc(d.partido || "")}-${esc(d.uf || "")} · ${compacto(d.custo_mandato * F)}</small></span>
        <span class="co-marca" aria-hidden="true">${sel ? "✓" : ""}</span></li>`; }).join("")
      + (deps.length > COMBO.lim ? `<li class="co-mais" data-co-mais="1">Mostrar mais ${nf(Math.min(300, deps.length - COMBO.lim))} (faltam ${nf(deps.length - COMBO.lim)}) — ou continue digitando</li>` : ""))
      || `<li class="co-vazio">Nenhum deputado com esse nome${uf || partido ? " no estado/partido escolhido" : ""} em ${esc(rotuloAno())}.</li>`;
    const at = COMBO.itens[COMBO.ativo];
    $("#f-busca").setAttribute("aria-activedescendant", at ? "co-" + at.id : "");
    if (at) document.getElementById("co-" + at.id)?.scrollIntoView({ block: "nearest" });
  }
  function abrirCombo() {
    if (COMBO.aberto) return;
    COMBO.aberto = true; COMBO.ativo = -1; COMBO.lim = 150;
    $("#combo-painel").hidden = false; $("#f-busca").setAttribute("aria-expanded", "true"); desenharLista();
  }
  function fecharCombo() {
    if (!COMBO.aberto) return;
    COMBO.aberto = false; $("#combo-painel").hidden = true; $("#f-busca").setAttribute("aria-expanded", "false");
  }
  function alternarDep(id) {
    id = +id;
    E.deps = E.deps.includes(id) ? E.deps.filter((x) => x !== id) : [...E.deps, id];
    E.nomes[id] = nomeDeId(id);
    $("#f-busca").value = ""; COMBO.ativo = -1;
    renderChips(); if (COMBO.aberto) desenharLista();
    E.limite = 50; E.limiteForn = 50; atualizar();
  }
  async function irAno(ano) {
    if (ano === "total") {
      const arq = corrigir() ? "resumo" : "resumo_nominal";
      E.resumo = await cache("rtotal-" + arq, () => getJSON(`dados/total/${arq}.json`));
      E.resumoAnt = null;
    } else {
      ano = +ano;
      E.resumo = await cache("r" + ano, () => getJSON(`dados/${ano}/resumo.json`));
      E.resumoAnt = (E.meta.anos || []).includes(ano - 1) ? await cache("r" + (ano - 1), () => getJSON(`dados/${ano - 1}/resumo.json`)) : null;
    }
    $("#f-ano").value = String(ano);
    E.limite = 50; E.limiteForn = 50; E.limitePt = 30; E.limiteNotasF = 20;
    preencherOpcoes(); atualizar();
  }

  async function iniciar() {
    prepararChart();
    try { E.meta = await getJSON("dados/meta.json"); }
    catch { $("#imp-total").textContent = "—"; $("#i-projeto").innerHTML = `<p class="sub">Os dados ainda não foram gerados. O robô de atualização precisa rodar pela primeira vez.</p>`; renderInicioSemDados(); return; }
    E.historico = await getJSON("dados/historico.json").catch(() => null);
    const p = new URLSearchParams(location.search);
    const anos = (E.meta.anos || []).slice().sort((a, b) => b - a);
    $("#f-ano").innerHTML = (E.meta.total ? `<option value="total">Todos os anos (${anos[anos.length - 1]}–${anos[0]})</option>` : "") +
      anos.map((a) => `<option>${a}</option>`).join("");
    if (p.get("ipca") === "0") $("#f-ipca").checked = false;
    if (p.get("busca")) $("#f-busca").value = p.get("busca");
    if (p.get("deps")) E.deps = p.get("deps").split(",").map(Number).filter(Boolean);
    if (p.get("comp")) E.sel = p.get("comp").split(",").map(Number).filter(Boolean).slice(0, MAX_COMP);
    const ref = E.meta.ipca_referencia || E.historico?.ipca_referencia;
    if (ref) $("#ipca-ref").textContent = `IPCA até ${ref}`;
    const dt = E.meta.atualizado_em ? new Date(E.meta.atualizado_em) : null;
    $("#atualizado").textContent = dt ? `Dados atualizados em ${dt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "";
    const fx = E.meta.fontes || {};
    $("#fontes").innerHTML = "Fontes: " + [["API de Dados Abertos da Câmara", fx.deputados], ["Cota parlamentar (arquivo anual)", fx.cota_parlamentar && fx.cota_parlamentar.replace("AAAA", anos[0])],
      ["Páginas públicas dos deputados", "https://www.camara.leg.br/deputados/quem-sao"], ["Emendas — Portal da Transparência", fx.emendas], ["IPCA — Banco Central (série 433)", "https://www3.bcb.gov.br/sgspub"]]
      .filter((x) => x[1]).map(([r, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${r}</a>`).join(" · ");
    E.resumoAtual = await cache("r" + anos[0], () => getJSON(`dados/${anos[0]}/resumo.json`));
    const anoUrl = p.get("ano") === "total" && E.meta.total ? "total" : +p.get("ano");
    E.pag = ["inicio", "geral", "deputados", "presenca", "projetos", "novas", "comparar", "fornecedores", "atencao", "rankings", "previsoes", "dava", "historico", "metodo"].includes(p.get("pag")) ? p.get("pag") : "inicio";
    await irAno(anoUrl === "total" || anos.includes(anoUrl) ? anoUrl : anos[0]);
    ["uf", "partido"].forEach((k) => { if (p.get(k)) $("#f-" + k).value = p.get(k); });
    irPara(E.pag);

    // eventos
    $$(".menu nav button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.pag)));
    $$("[data-ir]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.ir)));
    $("#i-busca-form")?.addEventListener("submit", buscarDoInicio);
    ["#pr-busca", "#pr-ord"].forEach((k) => $(k).addEventListener(k === "#pr-busca" ? "input" : "change", () => { E.limPres = 25; renderPresenca(); }));
    $("#pr-mais").addEventListener("click", () => { E.limPres = (E.limPres || 25) + 50; renderPresenca(); });
    ["#pj-busca-dep", "#pj-ord"].forEach((k) => $(k).addEventListener(k === "#pj-busca-dep" ? "input" : "change", () => { E.limPj = 25; renderProjetos(); }));
    ["#pj-nivel", "#pj-tema", "#pj-busca"].forEach((k) => $(k).addEventListener(k === "#pj-busca" ? "input" : "change", () => { E.limPjL = 30; renderProjetos(); }));
    $("#pj-comp-mais").addEventListener("click", () => { E.limPj = (E.limPj || 25) + 50; renderProjetos(); });
    $("#pj-mais").addEventListener("click", () => { E.limPjL = (E.limPjL || 30) + 50; renderProjetos(); });
    $("#bv-abrir")?.addEventListener("click", () => boasVindas(true));
    setTimeout(() => boasVindas(), 600);
    $("#abrir-menu").addEventListener("click", () => { $("#menu").classList.add("aberto"); $("#veu").hidden = false; $("#abrir-menu").setAttribute("aria-expanded", "true"); });
    $("#veu").addEventListener("click", fecharMenu);
    $("#f-ano").addEventListener("change", (e) => irAno(e.target.value));
    ["#f-uf", "#f-partido", "#partido-metrica", "#r-cat"].forEach((s) => $(s).addEventListener("change", () => { E.limite = 50; listaNomes(); atualizar(); }));
    // campo "Deputado(s)"
    let t1;
    const busca = $("#f-busca");
    busca.addEventListener("focus", abrirCombo);
    busca.addEventListener("click", abrirCombo);
    busca.addEventListener("input", () => { COMBO.ativo = busca.value.trim() ? 0 : -1; COMBO.lim = 150; if (!COMBO.aberto) abrirCombo(); else desenharLista();
      if (!E.deps.length) { clearTimeout(t1); t1 = setTimeout(() => { E.limite = 50; atualizar(); }, 250); } });
    busca.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); abrirCombo();
        COMBO.ativo = Math.max(0, Math.min(COMBO.itens.length - 1, COMBO.ativo + (e.key === "ArrowDown" ? 1 : -1))); desenharLista(); }
      else if (e.key === "Enter") { e.preventDefault();
        const at = COMBO.itens[COMBO.ativo] || (COMBO.itens.length === 1 ? COMBO.itens[0] : null);
        if (at) alternarDep(at.id); else { fecharCombo(); atualizar(); } }
      else if (e.key === "Escape") { fecharCombo(); }
      else if (e.key === "Backspace" && !busca.value && E.deps.length) alternarDep(E.deps[E.deps.length - 1]);
      else if (e.key === "Tab") fecharCombo();
    });
    $("#combo-seta").addEventListener("click", () => { if (COMBO.aberto) fecharCombo(); else { busca.focus(); abrirCombo(); } });
    $("#combo-painel").addEventListener("mousedown", (e) => { if (!e.target.closest("button")) e.preventDefault(); });
    $("#combo-painel").addEventListener("click", (e) => {
      const li = e.target.closest("[data-co]"); if (li) { alternarDep(li.dataset.co); return; }
      if (e.target.closest("[data-co-mais]")) { COMBO.lim += 300; desenharLista(); return; }
      if (e.target.id === "combo-limpar") { E.deps = []; renderChips(); desenharLista(); atualizar(); }
    });
    $("#combo-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-tirar-dep]"); if (b) { e.stopPropagation(); alternarDep(b.dataset.tirarDep); } });
    $("#combo-campo").addEventListener("click", (e) => { if (e.target === e.currentTarget || e.target.id === "combo-chips") busca.focus(); });
    document.addEventListener("pointerdown", (e) => { if (COMBO.aberto && !e.target.closest("#combo-dep")) fecharCombo(); });
    let t2; $("#forn-busca").addEventListener("input", () => { clearTimeout(t2); t2 = setTimeout(() => { E.limiteForn = 50; tabelaForn(); }, 200); });
    ["#forn-cat", "#forn-tipo", "#forn-dep"].forEach((s) => $(s).addEventListener("change", () => { E.limiteForn = 50; tabelaForn(); }));
    $("#f-rf-tipos").addEventListener("click", (e) => { const b = e.target.closest("[data-rf-tipo]"); if (!b) return;
      $("#rf-tipo").value = $("#rf-tipo").value === b.dataset.rfTipo ? "" : b.dataset.rfTipo; RF.lim = 5; renderAlertasReceita(); });
    ["#rf-tipo", "#rf-grav", "#rf-dep-tipo"].forEach((x) => $(x).addEventListener("change", () => { RF.lim = 5; RF.limDep = 5; renderAlertasReceita(); }));
    let t4; ["#rf-busca", "#rf-dep-busca"].forEach((x) => $(x).addEventListener("input", () => { clearTimeout(t4); t4 = setTimeout(() => { RF.lim = 5; RF.limDep = 5; renderAlertasReceita(); }, 200); }));
    $("#f-rf-mais").addEventListener("click", () => { RF.lim += 10; renderAlertasReceita(); });
    $("#f-rf-deps-mais").addEventListener("click", () => { RF.limDep += 10; renderAlertasReceita(); });
    $("#f-notas-mais").addEventListener("click", () => { E.limiteNotasF = (E.limiteNotasF || 20) + 40; renderMaioresNotas(); });
    $("#f-ipca").addEventListener("change", async () => { if (ehTotal()) await irAno("total"); atualizar(); const m = location.hash.match(/^#dep-(\d+)/); if ($("#detalhe").open && m) abrir(m[1]); });
    $("#limpar").addEventListener("click", () => { ["#f-uf", "#f-partido", "#f-busca"].forEach((s) => ($(s).value = "")); E.deps = []; listaNomes(); atualizar(); });
    $("#mais").addEventListener("click", () => { E.limite += 100; renderDeputados(); });
    $("#forn-mais").addEventListener("click", () => { E.limiteForn += 100; tabelaForn(); });
    $("#a-mais").addEventListener("click", () => { E.limitePt += 50; renderAtencao(); });
    $("#prev-mais").addEventListener("click", () => { E.limitePrev += 25; renderPrevisoes(); });
    $("#ir-comparar").addEventListener("click", () => irPara("comparar"));
    // novas notas
    $("#nv-dias").addEventListener("click", (e) => { const b = e.target.closest("[data-nv-dia]"); if (b) { NV.dia = b.dataset.nvDia; NV.lim = 100; renderNovas(); } });
    $("#nv-marcas").addEventListener("click", (e) => { const b = e.target.closest("[data-nv-marca]"); if (b) { NV.marca = +b.dataset.nvMarca; NV.lim = 100; desenharNovas(); } });
    let t3; $("#nv-busca").addEventListener("input", () => { clearTimeout(t3); t3 = setTimeout(() => { NV.lim = 100; tabelaNovas(); }, 200); });
    ["#nv-cat", "#nv-ord"].forEach((s) => $(s).addEventListener("change", () => { NV.lim = 100; tabelaNovas(); }));
    $("#nv-mais").addEventListener("click", () => { NV.lim += 200; tabelaNovas(); });
    indiceNovas().then((idx) => { const d = idx?.dias?.[0]; if (d && d.data === hojeISO()) { $("#n-novas").hidden = false; $("#n-novas").textContent = d.notas > 999 ? "999+" : d.notas; } });
    $("#a-tipos").addEventListener("click", (e) => { const b = e.target.closest("[data-tipo]"); if (b) { E.tipoPt = b.dataset.tipo; E.limitePt = 30; renderAtencao(); } });
    $("#forn-tab").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-ordf]"); if (th) { E.ordemForn = th.dataset.ordf; tabelaForn(); }
    });
    $("#ranking").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-col]");
      if (th && th.dataset.col !== "sel") { const c = th.dataset.col; E.asc = E.ordem === c ? !E.asc : c === "nome" || c === "posicao" || c === "cota_uso"; E.ordem = c; renderDeputados(); return; }
      const cb = e.target.closest("input[data-sel]"); if (cb && !alternarSel(cb.dataset.sel)) cb.checked = false;
    });
    document.addEventListener("click", (e) => {
      const termo = e.target.closest(".termo");
      if (termo) { mostrarBalao(termo); e.preventDefault(); return; }
      if (!$("#balao").hidden) esconderBalao();
      const cp = e.target.closest("[data-copiar]"); if (cp) { copiar(cp); return; }
      const vn = e.target.closest("[data-vernotas]"); if (vn) { mostrarNotasDoFornecedor(vn); return; }
      if (e.target.id === "ver-notas" && E.ficha) { e.target.remove(); renderNotasFicha(E.ficha.d.id, E.ficha.ano, E.ficha.rs); return; }
      const fo = e.target.closest("[data-forn]");
      if (fo && !e.target.closest("[data-dep]")) { abrirFornecedor(fo.dataset.forn, fo.dataset.ano || E.resumo.ano); return; }
      if (e.target.id === "card-dep" && E.ficha) { const f = E.ficha;
        abrirCard((fotos) => cardDeputado(f.d, f.ano, f.rs, fotos), `${semAcento(f.d.nome).replace(/\W+/g, "-")}-${f.ano}`, [f.d.id]); return; }
      const dep = e.target.closest("[data-dep]"); if (dep) { abrir(dep.dataset.dep, dep.dataset.ano || E.resumo.ano); return; }
      const tir = e.target.closest("[data-tirar]"); if (tir) { alternarSel(tir.dataset.tirar); renderComparar(); return; }
      const cmp = e.target.closest("[data-comparar]"); if (cmp) { alternarSel(cmp.dataset.comparar); cmp.textContent = E.sel.includes(+cmp.dataset.comparar) ? "Remover da comparação" : "Adicionar à comparação"; return; }
      if (e.target.id === "ir-atual") irAno(E.resumoAtual.ano);
    });
    $("#comp-busca").addEventListener("change", (e) => {
      const nome = e.target.value.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const d = E.resumo.deputados.find((x) => x.nome === nome) || E.resumo.deputados.find((x) => semAcento(x.nome).includes(semAcento(nome)));
      if (d && !E.sel.includes(d.id)) alternarSel(d.id);
      e.target.value = ""; renderComparar();
    });
    // início: estado
    $("#i-uf").addEventListener("change", (e) => escolherUF(e.target.value));
    $("#i-mapa").addEventListener("click", (e) => { const b = e.target.closest("[data-uf-i]"); if (b) escolherUF(b.dataset.ufI); });
    $("#i-uf-ir").addEventListener("click", irParaUF);
    // glossário: mouse, teclado e toque
    document.addEventListener("mouseover", (e) => { const t = e.target.closest(".termo"); if (t) mostrarBalao(t); });
    let toque = 0;
    document.addEventListener("touchstart", () => (toque = Date.now()), { passive: true });
    document.addEventListener("mouseout", (e) => { if (e.target.closest(".termo") && Date.now() - toque > 1500) esconderBalao(); });
    document.addEventListener("focusin", (e) => { const t = e.target.closest(".termo"); if (t) mostrarBalao(t); });
    document.addEventListener("focusout", (e) => { if (e.target.closest(".termo")) esconderBalao(); });
    window.addEventListener("scroll", esconderBalao, { passive: true });
    // cards
    $$("[data-card-ranking]").forEach((b) => b.addEventListener("click", cardDoRanking));
    $$("#dlg-card [data-fmt]").forEach((b) => b.addEventListener("click", () => {
      CARD.fmt = b.dataset.fmt; $$("#dlg-card [data-fmt]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); redesenharCard(); }));
    $("#card-baixar").addEventListener("click", baixarCard);
    $("#card-compartilhar").addEventListener("click", compartilharCard);
    $("#fechar-card").addEventListener("click", () => $("#dlg-card").close());
    $("#dlg-card").addEventListener("click", (e) => { if (e.target.id === "dlg-card") e.target.close(); });
    $("#fechar").addEventListener("click", () => $("#detalhe").close());
    $("#detalhe").addEventListener("click", (e) => { if (e.target.id === "detalhe") e.target.close(); });
    $("#detalhe").addEventListener("close", () => history.replaceState(null, "", location.search));
    const m = location.hash.match(/^#dep-(\d+)/); if (m) abrir(m[1]);
    const mf = location.hash.match(/^#forn-(.+)$/); if (mf) abrirFornecedor(decodeURIComponent(mf[1]));
  }
  function renderInicioSemDados() { $$(".pagina").forEach((s) => s.classList.toggle("ativa", s.dataset.pag === "inicio")); $("#segmentacoes").hidden = true;
    const TX = window.TEXTOS || {}; $("#i-titulo").textContent = TX.projeto?.titulo || ""; }
  iniciar();
})();
