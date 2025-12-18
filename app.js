/* OfficinaPlus PWA - app.js
   - Carica procedure da /data/procedures.json
   - Permette override da localStorage (admin)
   - Flow: Cliente -> Analisi -> Causa -> Verifica -> Riparazione -> Report
   - Audio: Web Speech API (TTS)
*/

const $ = (id) => document.getElementById(id);

const state = {
  procedures: [],
  selected: null,      // selected cause object
  selectedProcedure: null,
  tts: { speaking: false, utter: null },
  installPrompt: null
};

const LS_KEY = "officinaplus_procedures_override_v1";

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function loadProcedures() {
  // 1) override from localStorage (admin)
  const override = safeJsonParse(localStorage.getItem(LS_KEY) || "");
  if (override?.procedures?.length) return override.procedures;

  // 2) default from file
  const res = await fetch("data/procedures.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossibile caricare procedures.json");
  const json = await res.json();
  return json.procedures || [];
}

function normalizeText(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function scoreProcedure(proc, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const hay = [
    proc.title,
    ...(proc.keywords || []),
    ...(proc.causes || []).map(c => c.name),
  ].join(" ");
  const h = normalizeText(hay);
  // simple scoring: count keyword matches
  let score = 0;
  for (const token of q.split(/\s+/)) {
    if (token.length < 2) continue;
    if (h.includes(token)) score += 2;
  }
  // bonus if direct phrase in title
  if (normalizeText(proc.title).includes(q)) score += 5;
  return score;
}

function analyzeClientText(text) {
  const q = normalizeText(text);
  const ranked = state.procedures
    .map(p => ({ p, s: scoreProcedure(p, q) }))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .map(x => x.p);

  // fallback: if nothing matched, show all
  return ranked.length ? ranked : state.procedures;
}

function renderCauseList(procedure) {
  const box = $("causeList");
  box.innerHTML = "";
  state.selected = null;
  $("btnToVerify").disabled = true;

  if (!procedure) {
    box.innerHTML = `<div class="item">Nessuna procedura selezionata.</div>`;
    return;
  }

  // order causes by probability desc
  const causes = [...(procedure.causes || [])].sort((a,b) => (b.probability||0) - (a.probability||0));

  for (const cause of causes) {
    const pct = Math.round((cause.probability || 0) * 100);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(cause.name)}</b></div>
          <div class="muted" style="font-size:12px;margin-top:2px">Probabilità stimata: ${pct}%</div>
        </div>
        <span class="badge">${pct}%</span>
      </div>
      <button class="btn ghost" type="button">Seleziona questa causa</button>
    `;
    el.querySelector("button").addEventListener("click", () => {
      state.selected = cause;
      $("btnToVerify").disabled = false;
      // highlight selection
      [...box.querySelectorAll(".item")].forEach(x => x.style.outline = "none");
      el.style.outline = "2px solid rgba(96,165,250,.6)";
      speak(`Causa selezionata: ${cause.name}`);
    });
    box.appendChild(el);
  }
}

function renderVerifyChecklist(cause) {
  const box = $("verifyChecklist");
  box.innerHTML = "";
  $("btnToRepair").disabled = true;

  const items = cause?.verify || [];
  if (!items.length) {
    box.innerHTML = `<div class="item">Nessuna checklist disponibile.</div>`;
    return;
  }

  const checks = new Array(items.length).fill(false);

  items.forEach((it, idx) => {
    const row = document.createElement("label");
    row.className = "chk";
    row.innerHTML = `
      <input type="checkbox" />
      <div>
        <div class="t">${escapeHtml(it.t)}</div>
        <div class="d">${escapeHtml(it.d || "")}</div>
      </div>
    `;
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => {
      checks[idx] = cb.checked;
      const done = checks.every(Boolean);
      $("btnToRepair").disabled = !done;
    });
    box.appendChild(row);
  });
}

function renderRepairSteps(cause) {
  const box = $("repairSteps");
  box.innerHTML = "";

  const steps = cause?.repair || [];
  if (!steps.length) {
    box.innerHTML = `<div class="item">Nessuno step di riparazione disponibile.</div>`;
    return;
  }

  steps.forEach((st, idx) => {
    const el = document.createElement("div");
    el.className = "step";
    el.innerHTML = `
      <div class="n">Step ${idx+1}: ${escapeHtml(st.t)}</div>
      <div class="d">${escapeHtml(st.d || "")}</div>
      <div class="row">
        <button class="btn ghost" type="button">▶ Leggi step</button>
      </div>
    `;
    el.querySelector("button").addEventListener("click", () => {
      speak(`Step ${idx+1}. ${st.t}. ${st.d || ""}`);
    });
    box.appendChild(el);
  });
}

function buildReportText() {
  const clientName = $("clientName").value.trim();
  const vehicleId = $("vehicleId").value.trim();
  const clientSays = $("clientSays").value.trim();

  const confirmedCause = $("confirmedCause").value.trim();
  const actionsDone = $("actionsDone").value.trim();
  const partsUsed = $("partsUsed").value.trim();
  const finalTest = $("finalTest").value.trim();

  const now = new Date();
  const dt = now.toLocaleString("it-IT");

  const selectedCauseName = state.selected?.name || "";
  const procTitle = state.selectedProcedure?.title || "";

  return [
    "OFFICINAPLUS – RELAZIONE TECNICA DI RIPARAZIONE",
    "--------------------------------------------------",
    `Data/Ora: ${dt}`,
    "",
    `Cliente: ${clientName || "-"}`,
    `Veicolo: ${vehicleId || "-"}`,
    "",
    "SEGNALAZIONE CLIENTE (parole sue):",
    clientSays ? clientSays : "-",
    "",
    "PERCORSO SELEZIONATO:",
    procTitle ? `Procedura: ${procTitle}` : "Procedura: -",
    selectedCauseName ? `Causa scelta: ${selectedCauseName}` : "Causa scelta: -",
    "",
    "CAUSA CONFERMATA (a fine diagnosi):",
    confirmedCause ? confirmedCause : "-",
    "",
    "AZIONI ESEGUITE:",
    actionsDone ? actionsDone : "-",
    "",
    "RICAMBI UTILIZZATI:",
    partsUsed ? partsUsed : "-",
    "",
    "TEST FINALE / ESITO:",
    finalTest ? finalTest : "-",
    "",
    "FIRMA OFFICINA: ___________________________",
  ].join("\n");
}

function setTab(tabName) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tabpane").forEach(p => p.classList.remove("active"));
  $("tab-" + tabName).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// TTS
function speak(text) {
  stopSpeak();
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  u.rate = 1.0;
  u.pitch = 1.0;
  state.tts.utter = u;
  state.tts.speaking = true;
  u.onend = () => { state.tts.speaking = false; };
  window.speechSynthesis.speak(u);
}
function stopSpeak() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.tts.speaking = false;
  state.tts.utter = null;
}

// Share & Print
async function shareReport(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "Report OfficinaPlus", text });
      return true;
    } catch { return false; }
  }
  // fallback: copy
  await navigator.clipboard.writeText(text);
  alert("Report copiato negli appunti. Incollalo su WhatsApp/email.");
  return true;
}

function printReport(text) {
  const w = window.open("", "_blank");
  if (!w) { alert("Popup bloccato. Abilita popup per stampare."); return; }
  const html = `
<!doctype html><html><head><meta charset="utf-8">
<title>Report OfficinaPlus</title>
<style>
body{font-family:Arial,system-ui;white-space:pre-wrap;padding:20px}
h1{margin:0 0 10px}
small{color:#555}
</style>
</head><body>
<h1>Report OfficinaPlus</h1>
<small>Stampa o salva in PDF dal menu di stampa</small>
<pre>${escapeHtml(text)}</pre>
<script>window.onload=()=>window.print();</script>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// Install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.installPrompt = e;
  const btn = $("btnInstall");
  btn.hidden = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await state.installPrompt.prompt();
      await state.installPrompt.userChoice;
    } finally {
      state.installPrompt = null;
      btn.hidden = true;
      btn.disabled = false;
    }
  };
});

async function init() {
  // Service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

  state.procedures = await loadProcedures();

  // Tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  $("btnStopAudio").addEventListener("click", stopSpeak);

  $("btnClear").addEventListener("click", () => {
    stopSpeak();
    $("clientName").value = "";
    $("vehicleId").value = "";
    $("clientSays").value = "";
    $("searchAll").value = "";
    $("confirmedCause").value = "";
    $("actionsDone").value = "";
    $("partsUsed").value = "";
    $("finalTest").value = "";
    $("reportOut").textContent = "";
    state.selected = null;
    state.selectedProcedure = null;
    $("btnToVerify").disabled = true;
    $("btnToRepair").disabled = true;
    renderCauseList(null);
    setTab("cause");
  });

  $("btnAnalyze").addEventListener("click", () => {
    stopSpeak();
    const text = $("clientSays").value.trim();
    const candidates = analyzeClientText(text);
    const best = candidates[0] || null;
    state.selectedProcedure = best;
    renderCauseList(best);
    if (best) speak(`Procedura proposta: ${best.title}. Seleziona una causa.`);
    setTab("cause");
  });

  $("searchAll").addEventListener("input", () => {
    const q = $("searchAll").value.trim();
    const candidates = analyzeClientText(q);
    const best = candidates[0] || null;
    state.selectedProcedure = best;
    renderCauseList(best);
  });

  $("btnToVerify").addEventListener("click", () => {
    if (!state.selected) return;
    renderVerifyChecklist(state.selected);
    setTab("verify");
    speak("Passa alla verifica. Completa tutti i controlli in checklist.");
  });

  $("btnBackToCause").addEventListener("click", () => setTab("cause"));

  $("btnToRepair").addEventListener("click", () => {
    if (!state.selected) return;
    renderRepairSteps(state.selected);
    setTab("repair");
    speak("Passa alla riparazione. Segui gli step.");
  });

  $("btnBackToVerify").addEventListener("click", () => setTab("verify"));

  $("btnToReport").addEventListener("click", () => setTab("report"));

  $("btnBuildReport").addEventListener("click", () => {
    const text = buildReportText();
    $("reportOut").textContent = text;
    speak("Report generato.");
  });

  $("btnShare").addEventListener("click", async () => {
    const text = $("reportOut").textContent.trim() || buildReportText();
    $("reportOut").textContent = text;
    await shareReport(text);
  });

  $("btnPrint").addEventListener("click", () => {
    const text = $("reportOut").textContent.trim() || buildReportText();
    $("reportOut").textContent = text;
    printReport(text);
  });

  // Initial state
  renderCauseList(null);
}

init().catch(err => {
  console.error(err);
  alert("Errore inizializzazione app: " + (err?.message || err));
});
