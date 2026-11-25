import * as THREE from "three";
import "./menu.css";
import { mountKeybindEditor } from "../shared/keybindEditor";

// Menu principal : profil, mode classé, salles, maps, menu latéral et décor 3D.
// Les données (adversaires, classements, temps) sont des exemples tant que le serveur n'existe pas.
(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  const MAPS = [
    "Le Grand Saut", "Spirale", "Fil du Rasoir", "Double Boucle", "La Chute",
    "Serpentin", "Pont Cassé", "Tremplin", "L'Épingle", "Vertige",
    "Les Marches", "Grand Huit", "Ricochet", "Le Tunnel", "Zigzag",
    "Plongeon", "La Vague", "Montagnes Russes", "Coupe-Gorge", "Dernier Virage"
  ];
  const OPPONENTS = ["Lucas_77", "Ines.rs", "kaiZen", "TomDrift", "Yasmine", "nono_speed", "Rayan42", "LéaFlash"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Pseudo
  let name = store.get("pseudo", "Joueur");
  const applyName = () => { $("playerName").textContent = name; $("vsMe").textContent = name; $("nameInput").value = name; document.querySelectorAll(".bname").forEach((b) => b.textContent = name); };
  applyName();

  // Fenêtres
  let lastFocus = null;
  function open(id) { lastFocus = document.activeElement; $(id).hidden = false; const f = $(id).querySelector("button, input"); if (f) f.focus(); }
  function close(id) { $(id).hidden = true; if (lastFocus) lastFocus.focus(); }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ["settingsOverlay", "joinOverlay"].forEach((id) => { if (!$(id).hidden) close(id); });
    if ($("searchOverlay").hidden && $("roomOverlay").hidden && !$("ranksPage").hidden) $("closeRanks").click();
    if (!$("searchOverlay").hidden) stopSearch();
    if (!$("roomOverlay").hidden) leaveRoom();
  });

  // Page du mode classé : frise des rangs
  // ---------- Battle cards (SVG, style cartoon) ----------
  const OUT = "#14101f";
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const CARD = {
    Bronze:   { top: "#e08a3c", bot: "#8c3c14", crust: "#c86a2a", crustHi: "#f2a65a", star: "#ffe2b8", emb: "#f0a050", tex: "#5a2208" },
    Argent:   { top: "#8f98e8", bot: "#3c3f9e", crust: "#b9c2ec", crustHi: "#eef2ff", star: "#ffffff", emb: "#d9e0f2", tex: "#2a2c7a" },
    Or:       { top: "#f5c23a", bot: "#a66a0a", crust: "#f2b52a", crustHi: "#fff0a0", star: "#fff6c8", emb: "#ffd34d", tex: "#7a4a00" },
    Diamant:  { top: "#6fd4ff", bot: "#1d5fc0", crust: "#4fb6f0", crustHi: "#c8f0ff", star: "#e8fbff", emb: "#8fe0ff", tex: "#0d3a80" },
    "Émeraude": { top: "#3fae4a", bot: "#123d1c", crust: "#58c85a", crustHi: "#b8f59a", star: "#eaffd8", emb: "#7ee07a", tex: "#0a2810" },
    Master:   { top: "#a04bf0", bot: "#3e0f85", crust: "#8f3be0", crustHi: "#e0a8ff", star: "#ffffff", emb: "#c58bff", tex: "#2a0860" },
    Pro:      { top: "#e63a3a", bot: "#5e0a12", crust: "#ffc23a", crustHi: "#fff2a8", star: "#fff3c4", emb: "#ff5a4a", tex: "#3a0408" }
  };
  const sparkle = (x, y, r, fill) => {
    const k = r * 0.32;
    return '<path class="twinkle" style="transform-origin:' + x + 'px ' + y + 'px" d="M' + x + ' ' + (y - r) + ' Q' + (x + k) + ' ' + (y - k) + ' ' + (x + r) + ' ' + y + ' Q' + (x + k) + ' ' + (y + k) + ' ' + x + ' ' + (y + r) + ' Q' + (x - k) + ' ' + (y + k) + ' ' + (x - r) + ' ' + y + ' Q' + (x - k) + ' ' + (y - k) + ' ' + x + ' ' + (y - r) + 'Z" fill="' + fill + '" stroke="' + OUT + '" stroke-width="2.2" stroke-linejoin="round"/>';
  };
  // Flamme de base (0..100), posée avec une transformation
  const FLAME = "M8 100 C-4 72 14 58 18 36 C26 50 28 56 33 60 C34 38 44 18 60 0 C60 24 70 38 72 58 C78 50 82 44 84 34 C98 58 104 82 92 100 Z";
  const flame = (x, y, s, fill, stroke) => '<path d="' + FLAME + '" transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '"' + (stroke ? ' stroke="' + OUT + '" stroke-width="' + (5 / s).toFixed(2) + '" stroke-linejoin="round"' : "") + "/>";
  function burst(cx, cy, n, r1, r2, seed, rot) {
    const R = rng(seed); let d = "";
    for (let i = 0; i <= n * 2; i++) {
      const a = rot + (i / (n * 2)) * Math.PI * 0.62;
      const r = i % 2 ? r1 * (0.55 + R() * 0.25) : r2 * (0.75 + R() * 0.4);
      d += (i ? "L" : "M") + (cx + Math.cos(a) * r).toFixed(1) + " " + (cy + Math.sin(a) * r).toFixed(1);
    }
    return d + "L" + cx + " " + cy + "Z";
  }
  function art(name, c) {
    switch (name) {
      case "Bronze": // traces de pneus et cône sur l'asphalte
        return '<g opacity=".55">' +
          '<path d="M-10 190 C40 150 70 150 120 175 S180 200 215 160" fill="none" stroke="' + c.tex + '" stroke-width="16" stroke-dasharray="7 5"/>' +
          '<path d="M-10 214 C45 172 75 172 125 197 S185 222 215 182" fill="none" stroke="' + c.tex + '" stroke-width="16" stroke-dasharray="7 5"/></g>' +
          '<g transform="translate(118 104) rotate(14)"><path d="M18 0 L30 0 L48 66 L0 66 Z" fill="#b8501a" stroke="' + OUT + '" stroke-width="4.5" stroke-linejoin="round"/>' +
          '<path d="M10 22 L38 22 L42 36 L6 36 Z" fill="#f6c08a"/><rect x="-6" y="62" width="60" height="12" rx="3" fill="#a3410f" stroke="' + OUT + '" stroke-width="4.5"/></g>' +
          '<g transform="translate(26 118) rotate(-24)" opacity=".7"><path d="M16 0 L28 0 L44 58 L0 58 Z" fill="' + c.tex + '"/><rect x="-5" y="55" width="54" height="10" rx="3" fill="' + c.tex + '"/></g>';
      case "Argent": { // nuage de fumée de drift
        const pts = [[-4, 196, 34], [34, 176, 30], [70, 186, 34], [106, 168, 30], [142, 182, 34], [180, 170, 32], [214, 190, 34], [20, 214, 30], [90, 214, 34], [160, 214, 34]];
        const o = pts.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[2] + 4) + '" fill="' + OUT + '"/>').join("");
        const f = pts.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '" fill="#f4f6ff"/>').join("");
        const s = pts.map((p) => '<circle cx="' + (p[0] + 6) + '" cy="' + (p[1] + 10) + '" r="' + (p[2] * 0.72) + '" fill="#c9d2f5"/>').join("");
        const w = '<path d="M30 96 h40 M44 110 h46 M120 84 h50 M134 98 h36" stroke="#d9defa" stroke-width="6" stroke-linecap="round" opacity=".5"/>';
        return w + o + f + s + pts.slice(0, 5).map((p) => '<circle cx="' + (p[0] - 8) + '" cy="' + (p[1] - 12) + '" r="' + (p[2] * 0.35) + '" fill="#fff"/>').join("");
      }
      case "Or": // éclair de boost
        return '<path d="' + burst(-6, 214, 7, 120, 230, 3, -1.15) + '" fill="#ffb21e" stroke="' + OUT + '" stroke-width="4.5" stroke-linejoin="round"/>' +
          '<path d="' + burst(-6, 214, 7, 80, 170, 9, -1.1) + '" fill="#ffe14a"/>' +
          '<path d="' + burst(-6, 214, 6, 50, 110, 5, -1.05) + '" fill="#fff8d0"/>' +
          '<path d="M150 60 L124 118 L146 118 L128 170 L178 102 L154 102 L172 60 Z" fill="#fff3a0" stroke="' + OUT + '" stroke-width="4.5" stroke-linejoin="round"/>';
      case "Diamant": { // cristaux de glace
        const R = rng(42); let tri = "";
        for (let i = 0; i < 16; i++) {
          const x = R() * 200, y = 60 + R() * 150, s = 22 + R() * 40;
          const col = ["#bdeeff", "#8fd8ff", "#5fbaf2", "#e8fbff"][i % 4];
          tri += '<path d="M' + x.toFixed(0) + " " + y.toFixed(0) + " l" + (s * 0.6).toFixed(0) + " " + (-s * 0.8).toFixed(0) + " l" + (s * 0.5).toFixed(0) + " " + (s * 0.9).toFixed(0) + 'Z" fill="' + col + '" opacity=".55"/>';
        }
        return tri +
          '<path d="M100 70 L136 92 L150 140 L118 186 L74 178 L52 130 L66 86 Z" fill="#8fe0ff" stroke="' + OUT + '" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="M100 70 L108 128 L66 86 Z" fill="#e8fbff"/><path d="M108 128 L150 140 L136 92 Z" fill="#5fbaf2"/>' +
          '<path d="M108 128 L118 186 L74 178 Z" fill="#3a90e0"/><path d="M108 128 L52 130 L74 178 Z" fill="#6fc6f6"/>' +
          '<path d="M82 92 l10 -6" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M-10 170 C40 150 60 196 110 200 S180 170 220 186 V230 H-10 Z" fill="#bdeeff" stroke="' + OUT + '" stroke-width="4.5"/>';
      }
      case "Émeraude": // flèche de vitesse
        return '<path d="M-10 196 C30 150 70 160 100 130 S150 80 160 60" fill="none" stroke="#0e3a16" stroke-width="40" stroke-linecap="round" opacity=".35"/>' +
          '<path d="M-14 214 C34 166 82 176 112 140 S146 96 150 84 L128 82 L176 40 L188 104 L168 92 C160 122 140 160 116 182 S40 210 10 236 Z" fill="#3ee06a" stroke="' + OUT + '" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="M0 214 C40 176 86 186 116 150 S150 104 156 92" fill="none" stroke="#b8ffb0" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M30 120 h30 M18 136 h26 M150 150 h34 M160 166 h26" stroke="#7ee07a" stroke-width="6" stroke-linecap="round" opacity=".6"/>';
      case "Master": // flammes violettes et roses
        return flame(-30, 96, 1.3, "#d14cff", true) + flame(70, 76, 1.5, "#ff6fd8", true) + flame(130, 110, 1.1, "#d14cff", true) +
          flame(-10, 130, 0.9, "#ffc2f0") + flame(92, 118, 1.0, "#ffd6f6") + flame(146, 146, 0.7, "#ffc2f0");
      case "Pro": // feu rouge et or + drapeau à damier
        return flame(-24, 90, 1.35, "#ff3b1f", true) + flame(80, 70, 1.5, "#ff6a1a", true) + flame(140, 104, 1.1, "#ff3b1f", true) +
          flame(-4, 126, 0.95, "#ffb21e") + flame(100, 112, 1.0, "#ffd34d") + flame(152, 142, 0.7, "#ffb21e") +
          flame(20, 160, 0.5, "#fff3c4") + flame(116, 158, 0.55, "#fff3c4") +
          '<g transform="translate(118 58) rotate(12)"><rect x="-4" y="0" width="7" height="74" rx="3" fill="#2a1a10" stroke="' + OUT + '" stroke-width="3"/>' +
          '<path d="M3 2 h56 v36 h-56 Z" fill="#fff" stroke="' + OUT + '" stroke-width="4" stroke-linejoin="round"/>' +
          [0, 1, 2, 3, 4, 5, 6].map((k) => [0, 1, 2].map((j) => (k + j) % 2 ? "" : '<rect x="' + (3 + k * 8) + '" y="' + (2 + j * 12) + '" width="8" height="12" fill="' + OUT + '"/>').join("")).join("") + "</g>";
    }
    return "";
  }
  function emblemIcon(name, c) {
    if (name === "Pro") return '<path d="M-11 5 L-12 -6 L-5 -1 L0 -9 L5 -1 L12 -6 L11 5 Z" fill="' + OUT + '"/>';
    if (name === "Master") return '<path d="M-9 -8 L-5 2 M9 -8 L5 2" stroke="' + OUT + '" stroke-width="3.5" stroke-linecap="round"/><circle r="6" cy="3" fill="' + OUT + '"/>';
    // volant
    return '<circle r="9" fill="none" stroke="' + OUT + '" stroke-width="3.5"/><circle r="2.8" fill="' + OUT + '"/><path d="M-9 0 H9 M0 2.5 V9" stroke="' + OUT + '" stroke-width="3.5"/>';
  }
  function battleCard(name) {
    const c = CARD[name], id = "bc" + name.replace(/\W/g, "");
    const crustPts = []; const R = rng(name.length * 77);
    for (let x = 18; x <= 182; x += 11) crustPts.push([x, 19 + R() * 6, 9 + R() * 4]);
    const crustOut = crustPts.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1].toFixed(1) + '" r="' + (p[2] + 3).toFixed(1) + '" fill="' + OUT + '"/>').join("");
    const crustIn = crustPts.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1].toFixed(1) + '" r="' + p[2].toFixed(1) + '" fill="' + c.crust + '"/>').join("");
    const crustHi = crustPts.map((p, i) => i % 2 ? "" : '<circle cx="' + (p[0] - 3) + '" cy="' + (p[1] - 3).toFixed(1) + '" r="' + (p[2] * 0.38).toFixed(1) + '" fill="' + c.crustHi + '"/>').join("");
    const stars = [26, 48, 70, 130, 152, 174].map((x, i) => sparkle(x, 22, i === 2 || i === 3 ? 9 : 8, c.star)).join("");
    return '<svg class="bc-svg" viewBox="-4 0 212 222" role="img" aria-label="Battle card ' + name + '">' +
      '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="' + c.top + '"/><stop offset="1" stop-color="' + c.bot + '"/></linearGradient>' +
      '<clipPath id="' + id + 'c"><rect x="8" y="22" width="184" height="190" rx="12"/></clipPath>' +
      '<pattern id="' + id + 'p" width="40" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)"><path d="M0 0 H40 M0 13 H40 M10 0 V13 M30 13 V26" stroke="' + c.tex + '" stroke-width="2" fill="none"/></pattern></defs>' +
      '<rect x="14" y="30" width="184" height="190" rx="12" fill="rgba(0,0,0,.45)"/>' +
      '<rect x="8" y="22" width="184" height="190" rx="12" fill="url(#' + id + 'g)"/>' +
      '<g clip-path="url(#' + id + 'c)"><rect x="0" y="0" width="210" height="230" fill="url(#' + id + 'p)" opacity=".18"/>' +
      '<path d="M8 40 L192 40 L192 70 C140 60 60 80 8 64 Z" fill="#000" opacity=".12"/>' + art(name, c) +
      '<rect class="bc-shine" x="-120" y="0" width="60" height="230" fill="url(#shineG)" transform="skewX(-18)"/></g>' +
      '<rect x="8" y="22" width="184" height="190" rx="12" fill="none" stroke="' + OUT + '" stroke-width="6"/>' +
      crustOut + crustIn + crustHi + stars +
      '<g transform="translate(100 20)"><circle r="19" fill="' + OUT + '"/><circle r="15.5" fill="' + c.emb + '"/><circle r="15.5" cx="-2" cy="-3" fill="#fff" opacity=".25"/>' + emblemIcon(name, c) + "</g>" +
      "</svg>";
  }

  const PLAYER_PTS = 850;
  const RANKS = [
    { name: "Bronze",   c1: "#e09a5e", c2: "#7a4522", min: 0,    divs: true },
    { name: "Argent",   c1: "#dfe5ee", c2: "#7d8896", min: 1000, divs: true },
    { name: "Or",       c1: "#ffd34d", c2: "#b9821a", min: 1300, divs: true },
    { name: "Diamant",  c1: "#8fd8ff", c2: "#3a7bd5", min: 1600, divs: true },
    { name: "Émeraude", c1: "#4fe3a0", c2: "#138a5a", min: 1900, divs: true },
    { name: "Master",   c1: "#c58bff", c2: "#6a2fc0", min: 2200, divs: false },
    { name: "Pro",      c1: "#ff6b7a", c2: "#8a1430", min: null, divs: false }
  ];
  const fmt = (n) => n.toLocaleString("fr-FR");
  const ROMAN = ["III", "II", "I"];
  const curIdx = RANKS.findIndex((r, i) => r.min !== null && PLAYER_PTS >= r.min && (RANKS[i + 1].min === null || PLAYER_PTS < RANKS[i + 1].min));
  const frise = $("frise"), dots = $("dots");
  RANKS.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "tier " + (i < curIdx ? "done" : i === curIdx ? "current done" : "locked");
    el.style.setProperty("--c1", r.c1); el.style.setProperty("--c2", r.c2);
    const next = RANKS[i + 1];
    let pts = r.min === null ? "Top 100 mondial" : next && next.min !== null ? fmt(r.min) + " à " + fmt(next.min - 1) + " pts" : fmt(r.min) + " pts et plus";
    let divHtml = "";
    if (r.divs) {
      const span = (next.min - r.min) / 3;
      const here = i === curIdx ? Math.min(2, Math.floor((PLAYER_PTS - r.min) / span)) : -1;
      divHtml = '<div class="divs">' + ROMAN.map((d, k) => {
        const cls = i < curIdx || (i === curIdx && k < here) ? "done" : k === here ? "here" : "";
        return '<span class="div-chip ' + cls + '">' + d + "</span>";
      }).join("") + "</div>";
    }
    let extra = "";
    if (i === curIdx) {
      const pct = Math.round(((PLAYER_PTS - r.min) / (next.min - r.min)) * 100);
      extra = '<span class="here-tag">Tu es ici</span><div class="progress"><div class="bar"><i style="width:' + pct + '%"></i></div><span>' + fmt(PLAYER_PTS) + " / " + fmt(next.min) + " pts</span></div>";
    }
    el.innerHTML = '<div class="glow"></div><div class="tier-in"><div class="emblem"><div class="emblem-inner">' + r.name[0] + "</div></div>" +
      '<div class="tier-name">' + r.name + "</div>" + divHtml + '<div class="tier-pts">' + pts + "</div>" + extra +
      '<div class="bcard-label">Battle card</div>' +
      '<div class="bcard">' + battleCard(r.name) +
      (i > curIdx ? '<div class="bcard-lock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>' : "") +
      "</div></div>";
    frise.appendChild(el);
    const d = document.createElement("button");
    d.setAttribute("aria-label", r.name);
    d.addEventListener("click", () => goTo(i));
    dots.appendChild(d);
  });
  applyName();
  const tiers = () => Array.from(frise.children);
  const maxScroll = () => frise.scrollWidth - frise.clientWidth;
  const posOf = (i) => { const t = tiers()[i]; return t.offsetLeft - (frise.clientWidth - t.offsetWidth) / 2; };
  const clampIdx = (i) => Math.max(0, Math.min(RANKS.length - 1, i));
  let target = null, anim = 0, last = 0, sel = curIdx, touching = false, idleTO = 0;
  function step(now) {
    const dt = Math.min((now - last) / 16.67, 3); last = now;
    const cur = frise.scrollLeft, diff = target - cur;
    if (Math.abs(diff) < 0.6) { frise.scrollLeft = target; anim = 0; target = null; return; }
    frise.scrollLeft = cur + diff * (1 - Math.pow(0.84, dt));
    anim = requestAnimationFrame(step);
  }
  function animateTo(x) {
    target = Math.max(0, Math.min(maxScroll(), x));
    if (!anim) { last = performance.now(); anim = requestAnimationFrame(step); }
  }
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = 0; target = null; }
  function goTo(i, instant) {
    sel = clampIdx(i);
    if (instant) { stopAnim(); frise.scrollLeft = posOf(sel); return; }
    animateTo(posOf(sel));
  }
  function activeIdx(x) {
    const mid = (x === undefined ? frise.scrollLeft : x) + frise.clientWidth / 2;
    let best = 0, bd = Infinity;
    tiers().forEach((t, i) => { const d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // Effet de profondeur : le rang au centre est net, les autres s'estompent
  function paint() {
    const mid = frise.scrollLeft + frise.clientWidth / 2;
    tiers().forEach((t) => {
      const d = Math.min(Math.abs(t.offsetLeft + t.offsetWidth / 2 - mid) / t.offsetWidth, 1.4);
      const inner = t.querySelector(".tier-in");
      inner.style.transform = "scale(" + (1 - d * 0.12).toFixed(3) + ")";
      inner.style.opacity = (1 - d * 0.45).toFixed(3);
    });
    const a = activeIdx();
    Array.from(dots.children).forEach((d, i) => d.classList.toggle("on", i === a));
    $("friseLeft").disabled = a === 0;
    $("friseRight").disabled = a === RANKS.length - 1;
  }
  let painting = false;
  frise.addEventListener("scroll", () => {
    if (!painting) { painting = true; requestAnimationFrame(() => { painting = false; paint(); }); }
    if (!anim && !touching) {
      clearTimeout(idleTO);
      idleTO = setTimeout(() => goTo(activeIdx()), 140);
    }
  }, { passive: true });
  frise.addEventListener("touchstart", () => { touching = true; stopAnim(); clearTimeout(idleTO); }, { passive: true });
  frise.addEventListener("touchend", () => { touching = false; clearTimeout(idleTO); idleTO = setTimeout(() => goTo(activeIdx()), 140); }, { passive: true });
  frise.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") stopAnim(); });
  $("friseLeft").addEventListener("click", () => goTo(sel - 1));
  $("friseRight").addEventListener("click", () => goTo(sel + 1));
  frise.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(sel + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); goTo(sel - 1); }
  });
  // Molette : défilement doux, puis on se cale sur le rang le plus proche
  frise.addEventListener("wheel", (e) => {
    const raw = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!raw) return;
    e.preventDefault();
    const delta = raw * (e.deltaMode === 1 ? 40 : 1) * 1.1;
    animateTo((target === null ? frise.scrollLeft : target) + delta);
    clearTimeout(idleTO);
    idleTO = setTimeout(() => goTo(activeIdx(target === null ? frise.scrollLeft : target)), 160);
  }, { passive: false });
  window.addEventListener("resize", () => { if (!$("ranksPage").hidden) { goTo(sel, true); paint(); } });
  $("rankedBtn").addEventListener("click", () => {
    $("ranksPage").hidden = false;
    requestAnimationFrame(() => { goTo(curIdx, true); paint(); });
    $("closeRanks").focus();
  });
  $("closeRanks").addEventListener("click", () => { $("ranksPage").hidden = true; $("rankedBtn").focus(); });

  // Jouer en classé
  let searchInt = null, searchTO = null;
  $("playBtn").addEventListener("click", () => {
    $("searchPhase").hidden = false; $("foundPhase").hidden = true;
    open("searchOverlay");
    const t0 = Date.now();
    $("searchTimer").textContent = "0:00";
    searchInt = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $("searchTimer").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }, 250);
    searchTO = setTimeout(() => {
      clearInterval(searchInt);
      $("vsOpp").textContent = pick(OPPONENTS);
      $("vsOppRank").textContent = pick(["Bronze I", "Bronze II", "Argent III"]);
      $("foundMap").textContent = pick(MAPS);
      $("searchPhase").hidden = true; $("foundPhase").hidden = false;
      $("closeFound").focus();
    }, 2500 + Math.random() * 2000);
  });
  function stopSearch() { clearInterval(searchInt); clearTimeout(searchTO); close("searchOverlay"); }
  $("cancelSearch").addEventListener("click", stopSearch);
  $("closeFound").addEventListener("click", stopSearch);

  // Créer une salle
  let roomTO = null;
  function renderPlayers(list) {
    const ul = $("roomPlayers"); ul.innerHTML = "";
    list.forEach((p) => {
      const li = document.createElement("li");
      const n = document.createElement("span"); n.textContent = p.name;
      li.appendChild(n);
      if (p.host) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Hôte"; li.appendChild(t); }
      ul.appendChild(li);
    });
    const w = document.createElement("li"); w.className = "waiting"; w.textContent = "En attente…"; ul.appendChild(w);
    const ok = list.length >= 2;
    const sb = $("startRoom"); sb.disabled = !ok; sb.style.opacity = ok ? "1" : ".5"; sb.style.cursor = ok ? "pointer" : "not-allowed";
  }
  $("createBtn").addEventListener("click", () => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let c = ""; for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    $("roomCode").textContent = c;
    const players = [{ name, host: true }];
    renderPlayers(players);
    open("roomOverlay");
    // Démo : un pote arrive au bout de 3 secondes
    roomTO = setTimeout(() => { players.push({ name: pick(OPPONENTS) }); renderPlayers(players); }, 3000);
  });
  function leaveRoom() { clearTimeout(roomTO); close("roomOverlay"); }
  $("leaveRoom").addEventListener("click", leaveRoom);
  $("startRoom").addEventListener("click", () => {
    if ($("startRoom").disabled) return;
    leaveRoom();
    $("vsOpp").textContent = "Ta salle"; $("vsOppRank").textContent = "Amicale";
    $("foundMap").textContent = pick(MAPS);
    $("searchPhase").hidden = true; $("foundPhase").hidden = false;
    open("searchOverlay");
  });

  // Rejoindre
  const joinInput = $("joinCode");
  joinInput.addEventListener("input", () => { joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); });
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = joinInput.value;
    if (c.length !== 4) { joinInput.focus(); joinInput.style.borderColor = "var(--bad)"; setTimeout(() => joinInput.style.borderColor = "", 900); return; }
    $("joinedCode").textContent = c;
    open("joinOverlay");
  });
  $("closeJoin").addEventListener("click", () => close("joinOverlay"));

  // Menu latéral
  const drawer = $("drawer"), shade = $("drawerShade");
  function openDrawer() {
    shade.hidden = false; requestAnimationFrame(() => shade.classList.add("show"));
    drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    $("menuBtn").setAttribute("aria-expanded", "true");
    setTimeout(() => drawer.querySelector(".drawer-item").focus(), 60);
  }
  function closeDrawer(noFocus) {
    shade.classList.remove("show"); setTimeout(() => { shade.hidden = true; }, 250);
    drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    $("menuBtn").setAttribute("aria-expanded", "false");
    if (!noFocus) $("menuBtn").focus();
  }
  $("menuBtn").addEventListener("click", openDrawer);
  $("drawerClose").addEventListener("click", () => closeDrawer());
  shade.addEventListener("click", () => closeDrawer());
  drawer.querySelectorAll(".drawer-item").forEach((b) => b.addEventListener("click", () => {
    closeDrawer(true);
    if (b.dataset.href) { location.href = b.dataset.href; return; }
    if (b.dataset.open) open(b.dataset.open);
    if (b.dataset.page) { $(b.dataset.page).hidden = false; $(b.dataset.page).querySelector(".page-close").focus(); }
  }));
  document.querySelectorAll(".page-close").forEach((b) => b.addEventListener("click", () => {
    b.closest(".sub-page").hidden = true; $("menuBtn").focus();
  }));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (drawer.classList.contains("open")) { closeDrawer(); return; }
    const sp = Array.from(document.querySelectorAll(".sub-page")).find((p) => !p.hidden);
    if (sp) { sp.hidden = true; $("menuBtn").focus(); }
  });

  // Classement (données d'exemple)
  const rankOf = (pts) => RANKS[Math.max(0, RANKS.findIndex((r, i) => r.min !== null && pts >= r.min && (RANKS[i + 1].min === null || pts < RANKS[i + 1].min)))];
  const WORLD = [["Zephyr", 3120, 6], ["kaiZen", 3054, 6], ["Ines.rs", 2987, 6], ["NightOwl", 2930, 6], ["TomDrift", 2875, 6], ["Akira_v", 2811, 6], ["Rayan42", 2760, 6], ["LéaFlash", 2702, 6], ["nono_speed", 2655, 6], ["Yasmine", 2601, 6]];
  const FRIENDS = [["Lucas_77", 1180], ["Ines.rs", 1040], [null, PLAYER_PTS], ["Mehdi", 790], ["Clara", 640]];
  function renderBoard(kind) {
    const ol = $("board"); ol.innerHTML = "";
    const add = (pos, who, pts, me) => {
      const r = pts >= 2600 && kind === "world" ? RANKS[6] : rankOf(pts);
      const li = document.createElement("li"); if (me) li.className = "me";
      li.style.setProperty("--c1", r.c1); li.style.setProperty("--c2", r.c2);
      li.innerHTML = '<span class="pos">' + pos + '</span><span class="mini">' + r.name[0] + '</span><span class="who"></span><span class="pts">' + fmt(pts) + "</span>";
      li.querySelector(".who").textContent = who;
      ol.appendChild(li);
    };
    if (kind === "world") {
      WORLD.forEach((p, i) => add(i + 1, p[0], p[1]));
      const sep = document.createElement("li"); sep.className = "sep"; sep.textContent = "⋯"; ol.appendChild(sep);
      add("48 213", name, PLAYER_PTS, true);
    } else {
      FRIENDS.forEach((p, i) => add(i + 1, p[0] || name, p[1], !p[0]));
    }
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => { x.classList.toggle("on", x === t); x.setAttribute("aria-selected", x === t); });
    renderBoard(t.dataset.board);
  }));
  renderBoard("world");

  // TV League (matchs d'exemple)
  const TV = [["Vertige", ["Zephyr", "kaiZen"], 2140], ["Double Boucle", ["Ines.rs", "NightOwl", "Akira_v"], 980], ["Le Grand Saut", ["TomDrift", "Rayan42"], 412], ["Spirale", ["LéaFlash", "Yasmine", "Mehdi", "Clara"], 97]];
  TV.forEach(([map, players, viewers]) => {
    const c = document.createElement("div"); c.className = "tv-card";
    c.innerHTML = '<div class="tv-top"><span class="tv-map">' + map + '</span><span class="tv-viewers">' + fmt(viewers) + '</span></div><div class="tv-players">' +
      players.map((p) => "<span>" + p + "</span>").join("") + '</div><button class="btn">Regarder</button>';
    $("tvList").appendChild(c);
  });


  // ---------- Maps ----------
  const DIFF = ["Facile", "Moyen", "Difficile"];
  const MAPDATA = MAPS.map((m, i) => {
    const R = rng(1000 + i * 31);
    const diff = Math.min(2, Math.floor(i / 7));
    const base = 24 + diff * 8 + R() * 10; // temps de référence en secondes
    return { name: m, num: i + 1, diff, seed: 1000 + i * 31, auteur: base, or: base * 1.06, argent: base * 1.14, bronze: base * 1.28,
      mine: R() < 0.75 ? base * (1.08 + R() * 0.3) : null };
  });
  // Map 1 : vraies médailles et vrai record enregistré par l'écran de course
  {
    let pb = null;
    try { const v = localStorage.getItem("raceleague.best.grand-saut"); pb = v ? Number(v) : null; } catch (e) { pb = null; }
    Object.assign(MAPDATA[0], { auteur: 10.8, or: 11.4, argent: 12.5, bronze: 14.5, mine: pb });
  }
  const ftime = (t) => { if (t == null) return "—"; const m = Math.floor(t / 60), sec = t - m * 60; return m + ":" + sec.toFixed(3).padStart(6, "0").replace(".", ","); };
  const medalOf = (d, t) => t == null ? null : t <= d.auteur ? "auteur" : t <= d.or ? "or" : t <= d.argent ? "argent" : t <= d.bronze ? "bronze" : null;
  function trackSVG(seed, big) {
    const R = rng(seed), n = 9, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 0.55 + R() * 0.4;
      pts.push([100 + Math.cos(a) * r * 78, 75 + Math.sin(a) * r * 56]);
    }
    let d = "";
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      if (!i) d += "M" + p1[0].toFixed(1) + " " + p1[1].toFixed(1);
      d += "C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    const hue = Math.floor(R() * 360);
    const s = pts[0];
    return '<svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tg' + seed + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(' + hue + ' 45% 30%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ' 50% 16%)"/></linearGradient></defs>' +
      '<rect width="200" height="150" fill="url(#tg' + seed + ')"/>' +
      (big ? '<g opacity=".12" stroke="#fff">' + Array.from({ length: 9 }, (_, k) => '<path d="M0 ' + (k * 18) + ' H200"/>').join("") + "</g>" : "") +
      '<path d="' + d + 'Z" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="' + (big ? 16 : 18) + '" transform="translate(3 6)"/>' +
      '<path d="' + d + 'Z" fill="none" stroke="#14101f" stroke-width="' + (big ? 15 : 17) + '" stroke-linejoin="round"/>' +
      '<path d="' + d + 'Z" fill="none" stroke="#d9cfc6" stroke-width="' + (big ? 10 : 11) + '" stroke-linejoin="round"/>' +
      '<path d="' + d + 'Z" fill="none" stroke="#ffb23e" stroke-width="1.6" stroke-dasharray="6 6"/>' +
      '<g transform="translate(' + s[0].toFixed(1) + " " + s[1].toFixed(1) + ')"><rect x="-6" y="-6" width="12" height="12" fill="#fff" stroke="#14101f" stroke-width="2"/><rect x="-6" y="-6" width="6" height="6" fill="#14101f"/><rect x="0" y="0" width="6" height="6" fill="#14101f"/></g></svg>';
  }
  const mapList = $("mapList");
  MAPDATA.forEach((m, i) => {
    const b = document.createElement("button"); b.className = "map-item";
    const md = medalOf(m, m.mine);
    b.innerHTML = '<span class="map-thumb">' + trackSVG(m.seed) + '</span><span><span class="mi-name">' + m.name + '</span><span class="mi-meta"><span class="dots3">' +
      [0, 1, 2].map((k) => '<i class="' + (k <= m.diff ? "on" : "") + '"></i>').join("") + "</span>" + ftime(m.mine) + "</span></span>" +
      '<span class="medal ' + (md || "none") + '">' + (md ? (md === "auteur" ? "★" : md[0].toUpperCase()) : "") + "</span>";
    b.addEventListener("click", () => { closeMaps(true); openMap(i); });
    mapList.appendChild(b);
  });
  const mapsDrawer = $("mapsDrawer"), mapsShade = $("mapsShade");
  function openMaps() {
    mapsShade.hidden = false; requestAnimationFrame(() => mapsShade.classList.add("show"));
    mapsDrawer.classList.add("open"); mapsDrawer.setAttribute("aria-hidden", "false"); $("mapsBtn").setAttribute("aria-expanded", "true");
    setTimeout(() => mapList.querySelector(".map-item").focus(), 60);
  }
  function closeMaps(noFocus) {
    mapsShade.classList.remove("show"); setTimeout(() => { mapsShade.hidden = true; }, 250);
    mapsDrawer.classList.remove("open"); mapsDrawer.setAttribute("aria-hidden", "true"); $("mapsBtn").setAttribute("aria-expanded", "false");
    if (!noFocus) $("mapsBtn").focus();
  }
  $("mapsBtn").addEventListener("click", openMaps);
  $("mapsClose").addEventListener("click", () => closeMaps());
  mapsShade.addEventListener("click", () => closeMaps());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && mapsDrawer.classList.contains("open")) closeMaps(); });

  const PLAYERS = ["Zephyr", "kaiZen", "Ines.rs", "NightOwl", "TomDrift", "Akira_v", "Rayan42", "LéaFlash", "nono_speed", "Yasmine", "Lucas_77", "Mehdi", "Clara", "Sacha", "Noa"];
  let curMap = 0;
  function renderMapBoard(kind) {
    const m = MAPDATA[curMap], R = rng(m.seed + (kind === "world" ? 7 : 99)), ol = $("mapBoard"); ol.innerHTML = "";
    const add = (pos, who, t, me, pts) => {
      const r = rankOf(pts);
      const li = document.createElement("li"); if (me) li.className = "me";
      li.style.setProperty("--c1", r.c1); li.style.setProperty("--c2", r.c2);
      li.innerHTML = '<span class="pos">' + pos + '</span><span class="mini">' + r.name[0] + '</span><span class="who"></span><span class="pts">' + ftime(t) + "</span>";
      li.querySelector(".who").textContent = who; ol.appendChild(li);
    };
    if (kind === "world") {
      let t = m.auteur * 0.97;
      const names = PLAYERS.slice().sort(() => R() - 0.5);
      for (let k = 0; k < 10; k++) { t += 0.05 + R() * 0.25; add(k + 1, names[k], t, false, 2400 + Math.floor(R() * 700)); }
      if (m.mine) { const sep = document.createElement("li"); sep.className = "sep"; sep.textContent = "⋯"; ol.appendChild(sep); add(fmt(1200 + Math.floor((m.mine / m.auteur - 1) * 90000)), name, m.mine, true, PLAYER_PTS); }
    } else {
      const fr = [["Lucas_77", 1180], ["Ines.rs", 1040], ["Mehdi", 790], ["Clara", 640]].map(([n, p]) => [n, m.auteur * (1.04 + R() * 0.35), p]);
      if (m.mine) fr.push([name, m.mine, PLAYER_PTS, true]);
      fr.sort((a, b) => a[1] - b[1]).forEach((f, k) => add(k + 1, f[0], f[1], !!f[3], f[2]));
    }
  }
  function openMap(i) {
    curMap = i; const m = MAPDATA[i];
    $("mapTitle").textContent = m.name;
    $("mapNum").textContent = "#" + m.num;
    $("mapDiff").textContent = DIFF[m.diff];
    $("mapPreview").innerHTML = trackSVG(m.seed, true);
    $("mapRecord").textContent = ftime(m.mine);
    $("mapRecPos").textContent = m.mine ? "#" + fmt(1200 + Math.floor((m.mine / m.auteur - 1) * 90000)) + " mondial" : "";
    $("mapMedals").innerHTML = [["auteur", "Auteur"], ["or", "Or"], ["argent", "Argent"], ["bronze", "Bronze"]].map(([k, l]) =>
      '<div class="' + (m.mine && m.mine <= m[k] ? "got" : "") + '"><span class="medal ' + k + '">' + (k === "auteur" ? "★" : l[0]) + "</span><b>" + l + "</b>" + ftime(m[k]) + "</div>").join("");
    document.querySelectorAll("[data-mboard]").forEach((x) => { x.classList.toggle("on", x.dataset.mboard === "world"); x.setAttribute("aria-selected", x.dataset.mboard === "world"); });
    renderMapBoard("world");
    $("mapPage").hidden = false; $("mapPage").querySelector(".map-body").scrollTop = 0; $("soloBtn").focus();
  }
  document.querySelectorAll("[data-mboard]").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll("[data-mboard]").forEach((x) => { x.classList.toggle("on", x === t); x.setAttribute("aria-selected", x === t); });
    renderMapBoard(t.dataset.mboard);
  }));
  $("mapBack").addEventListener("click", () => { $("mapPage").hidden = true; openMaps(); });
  let toastTO = 0;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTO); toastTO = setTimeout(() => { t.hidden = true; }, 2200); }
  // Seule la première map est jouable pour l'instant : elle ouvre la course.
  const PLAYABLE = { 0: "grand-saut" };
  $("soloBtn").addEventListener("click", () => {
    const id = PLAYABLE[curMap];
    if (id) location.href = "./race.html?map=" + id;
    else toast("Bientôt disponible");
  });

  // Paramètres
  mountKeybindEditor($("keybinds"));
  $("closeSettings").addEventListener("click", () => {
    const v = $("nameInput").value.trim();
    if (v) { name = v.slice(0, 16); store.set("pseudo", name); applyName(); renderBoard(document.querySelector(".tab.on").dataset.board); }
    close("settingsOverlay");
  });

  // ---------- Scène 3D de fond ----------
  const canvas = $("scene");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x6b3a5a, 60, 170);

  // Ciel en dégradé
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x1c1438) }, mid: { value: new THREE.Color(0x8a3d6a) }, low: { value: new THREE.Color(0xf08a3c) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.08 ? mix(mid, top, smoothstep(0.08,0.6,h)) : mix(low, mid, smoothstep(-0.25,0.08,h)); gl_FragColor=vec4(c,1.0); }"
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  scene.add(new THREE.HemisphereLight(0xffd6b0, 0x3a2050, 0.75));
  const sun = new THREE.DirectionalLight(0xffb070, 0.9);
  sun.position.set(-40, 30, -20); scene.add(sun);

  // Circuit : boucle en 8 suspendue, faite de dalles
  const track = new THREE.Group(); scene.add(track);
  const pathPts = [];
  const N = 160;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = Math.sin(t) * 34;
    const z = Math.sin(t) * Math.cos(t) * 26;
    const y = Math.sin(t * 2) * 4 + Math.cos(t) * 3;
    pathPts.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pathPts, true);
  const slabGeo = new THREE.BoxGeometry(1, 0.6, 7);
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xc9b6a6, flatShading: true });
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xffb23e, emissive: 0x5a2a00 });
  const edgeGeo = new THREE.BoxGeometry(1, 0.9, 0.35);
  const segs = 220;
  for (let i = 0; i < segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
    const m = new THREE.Object3D();
    m.position.copy(p); m.lookAt(p.clone().add(tan)); m.rotateY(Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.copy(m.position); slab.quaternion.copy(m.quaternion); slab.scale.x = 1.15;
    track.add(slab);
    if (i % 2 === 0) {
      [-3.6, 3.6].forEach((off) => {
        const e = new THREE.Mesh(edgeGeo, i % 8 < 4 ? edgeMat : slabMat);
        e.position.copy(m.position); e.quaternion.copy(m.quaternion); e.translateZ(off); e.translateY(0.3);
        track.add(e);
      });
    }
  }

  // Rochers flottants
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9a5a48, flatShading: true });
  const rockTop = new THREE.MeshLambertMaterial({ color: 0xd98a5a, flatShading: true });
  const rocks = [];
  for (let i = 0; i < 26; i++) {
    const r = 2 + Math.random() * 6;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.2, 6), rockMat);
    body.rotation.x = Math.PI; body.position.y = -r * 1.1;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, r * 0.4, 6), rockTop);
    g.add(body, top);
    const a = Math.random() * Math.PI * 2, d = 55 + Math.random() * 70;
    g.position.set(Math.cos(a) * d, -18 + Math.random() * 30, Math.sin(a) * d);
    g.rotation.y = Math.random() * 6;
    g.userData.phase = Math.random() * 6;
    scene.add(g); rocks.push(g);
  }

  // Voiture low-poly
  function makeCar(color) {
    const car = new THREE.Group();
    const bodyM = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1430 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 2.2), bodyM); b.position.y = 0.9; car.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.8), dark); c.position.set(-0.3, 1.7, 0); car.add(c);
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 2.4), bodyM); sp.position.set(-2, 1.75, 0); car.add(sp);
    const wg = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8);
    [[1.4, 1.1], [1.4, -1.1], [-1.4, 1.1], [-1.4, -1.1]].forEach(([x, z]) => {
      const w = new THREE.Mesh(wg, dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.5, z); car.add(w);
    });
    return car;
  }
  const car1 = makeCar(0xffb23e); scene.add(car1);
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.35 });
  const car2 = makeCar(0x9fe0ff); car2.traverse((o) => { if (o.isMesh) o.material = ghostMat; }); scene.add(car2);

  function placeCar(car, u) {
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    car.position.copy(p); car.position.y += 0.3;
    car.lookAt(p.clone().add(t)); car.rotateY(-Math.PI / 2);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 600 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let low = false;
  $("lowGfx").addEventListener("change", (e) => {
    low = e.target.checked;
    renderer.setPixelRatio(low ? 0.6 : Math.min(window.devicePixelRatio || 1, 2)); resize();
  });

  const clock = new THREE.Clock();
  let u = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const speed = reduce ? 0.006 : 0.045;
    u = (u + dt * speed) % 1;
    placeCar(car1, u);
    placeCar(car2, (u + 0.985) % 1);
    rocks.forEach((r) => { r.position.y += Math.sin(t * 0.5 + r.userData.phase) * 0.006; });
    const a = t * (reduce ? 0.01 : 0.06);
    camera.position.set(Math.cos(a) * 70, 26, Math.sin(a) * 70);
    camera.lookAt(0, -4, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
})();
