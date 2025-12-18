const LS_KEY = "officinaplus_procedures_override_v1";
const $ = (id) => document.getElementById(id);

async function loadDefault() {
  const res = await fetch("data/procedures.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossibile caricare procedures.json");
  return await res.json();
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

$("btnLoadDefault").addEventListener("click", async () => {
  const json = await loadDefault();
  $("jsonEditor").value = JSON.stringify(json, null, 2);
});

$("btnLoadLocal").addEventListener("click", () => {
  const j = localStorage.getItem(LS_KEY);
  if (!j) { alert("Nessun override local trovato."); return; }
  $("jsonEditor").value = j;
});

$("btnSaveLocal").addEventListener("click", () => {
  const txt = $("jsonEditor").value.trim();
  const parsed = safeParse(txt);
  if (!parsed || !Array.isArray(parsed.procedures)) {
    alert("JSON non valido. Deve contenere { \"procedures\": [...] }");
    return;
  }
  localStorage.setItem(LS_KEY, JSON.stringify(parsed));
  alert("Salvato in localStorage. Apri l’app e prova.");
});

$("btnClearLocal").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
  alert("Override local rimosso.");
});

// load something on start
(async () => {
  try {
    const json = await loadDefault();
    $("jsonEditor").value = JSON.stringify(json, null, 2);
  } catch (e) {
    $("jsonEditor").value = "{\n  \"procedures\": []\n}";
  }
})();
