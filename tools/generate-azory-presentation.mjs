import fs from "node:fs/promises";
import path from "node:path";

const outputPath = process.argv[2] || "D:/Codex/Azory/Mapa/azory2026-prezentace.html";
const mapDir = "D:/Codex/Azory/Mapa";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(dateValue) {
  if (!dateValue) return "Bez pevného dne";
  const date = new Date(`${dateValue}T12:00:00`);
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatDateShort(dateValue) {
  if (!dateValue) return "Bez pevného dne";
  const [year, month, day] = dateValue.split("-");
  return `${Number(day)}.${Number(month)}.${year}`;
}

function phaseLabel(phase) {
  return String(phase).replace(/^\d+\.\s*/, "");
}

function phaseOrder(phase) {
  const match = String(phase).match(/^(\d+)\./);
  return match ? Number(match[1]) : 999;
}

function phaseFamily(phase) {
  const order = phaseOrder(phase);
  if (order === 2) return "Flores";
  if (order >= 3) return "São Miguel";
  return "Ponta Delgada";
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  throw new Error(`Unsupported image extension: ${ext}`);
}

async function imageToDataUri(absolutePath) {
  const bytes = await fs.readFile(absolutePath);
  return `data:${mimeTypeForFile(absolutePath)};base64,${bytes.toString("base64")}`;
}

function firstSentence(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0].trim() : normalized;
}

const indexHtml = await fs.readFile(path.join(mapDir, "index.html"), "utf8");
const rawPointsMatch = indexHtml.match(/const rawPoints = \[(.*?)\n\s*\];/s);
if (!rawPointsMatch) {
  throw new Error("rawPoints were not found in index.html");
}

const rawPoints = Function(`return [${rawPointsMatch[1]}]`)();

const floresDetailsSource = await fs.readFile(path.join(mapDir, "data", "flores-details.js"), "utf8");
const mapDetailsSource = await fs.readFile(path.join(mapDir, "data", "map-details.js"), "utf8");
const windowScope = {};
Function("window", `${floresDetailsSource}\n${mapDetailsSource}\nreturn window;`)(windowScope);
const mapDetails = windowScope.MAP_DETAILS || {};

const points = rawPoints
  .filter((point) => point.notionUrl)
  .map((point) => {
    const details = mapDetails[point.notionUrl];
    if (!details) {
      throw new Error(`Missing detail entry for ${point.notionUrl}`);
    }

    const primaryImage = path.join(mapDir, details.primaryImage.replaceAll("/", path.sep));
    const title = point.subtitle ? `${point.name} – ${point.subtitle}` : point.name;

    return {
      title,
      name: point.name,
      subtitle: point.subtitle || "",
      phase: point.phase,
      phaseLabel: phaseLabel(point.phase),
      phaseFamily: phaseFamily(point.phase),
      visitDate: point.visitDate || "",
      visitEnd: point.visitEnd || "",
      reserveBy: point.reserveBy || "",
      mapyUrl: point.mapyUrl || "",
      notionUrl: point.notionUrl,
      perex: firstSentence(details.shortDescription || details.detailText || ""),
      imagePath: primaryImage
    };
  });

points.sort((a, b) => {
  const dateCompare = (a.visitDate || "9999-99-99").localeCompare(b.visitDate || "9999-99-99");
  if (dateCompare !== 0) return dateCompare;
  const phaseCompare = phaseOrder(a.phase) - phaseOrder(b.phase);
  if (phaseCompare !== 0) return phaseCompare;
  return a.title.localeCompare(b.title, "cs");
});

const slides = [
  {
    kind: "divider",
    family: "Úvod",
    eyebrow: "Azory 2026",
    title: "Itinerář celé cesty",
    subtitle: "Offline prezentace se všemi kartami z Notionu, seřazená podle data návštěvy.",
    meta: `${points.length} karet · ${points.filter((point) => point.visitDate).length} datovaných zastávek`
  }
];

let currentFamily = "";
let currentPhase = "";

for (const point of points) {
  if (point.phaseFamily !== currentFamily) {
    currentFamily = point.phaseFamily;
    if (currentFamily === "Flores") {
      slides.push({
        kind: "divider",
        family: currentFamily,
        eyebrow: "Hlavní fáze",
        title: "Flores",
        subtitle: "25. 7. až 30. 7. · trek, kempy, Corvo a severní pobřeží ostrova.",
        meta: "První hlavní část cesty"
      });
    } else if (currentFamily === "São Miguel") {
      slides.push({
        kind: "divider",
        family: currentFamily,
        eyebrow: "Hlavní fáze",
        title: "São Miguel",
        subtitle: "30. 7. až 7. 8. · Mosteiros, Furnas a severovýchod ostrova.",
        meta: "Druhá hlavní část cesty"
      });
    }
  }

  if (point.phase !== currentPhase) {
    currentPhase = point.phase;
    slides.push({
      kind: "divider",
      family: point.phaseFamily,
      eyebrow: point.phaseFamily === "Ponta Delgada" ? "Přestupní den" : "Etapa",
      title: phaseLabel(point.phase),
      subtitle: point.visitDate
        ? `${formatDateShort(point.visitDate)}${point.visitEnd ? ` až ${formatDateShort(point.visitEnd)}` : ""}`
        : "Flexibilní místa a doplňkové zastávky v rámci etapy",
      meta: point.phase
    });
  }

  slides.push({
    kind: "card",
    ...point,
    dateLabel: formatDate(point.visitDate),
    rangeLabel: point.visitEnd ? `${formatDateShort(point.visitDate)} až ${formatDateShort(point.visitEnd)}` : formatDateShort(point.visitDate),
    reserveLabel: point.reserveBy ? `Rezervovat do ${formatDateShort(point.reserveBy)}` : "",
    image: await imageToDataUri(point.imagePath)
  });
}

const cardCount = slides.filter((slide) => slide.kind === "card").length;

const slideDataLiteral = JSON.stringify(slides, null, 2);

const html = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Azory 2026 – prezentace</title>
  <style>
    :root {
      --bg: #04101d;
      --bg-soft: #0b1c2e;
      --bg-deep: #020913;
      --panel: rgba(6, 17, 29, 0.84);
      --panel-soft: rgba(10, 25, 41, 0.92);
      --line: rgba(111, 220, 255, 0.22);
      --teal: #35e0c5;
      --aqua: #6fdcff;
      --navy: #103252;
      --white: #eef8ff;
      --muted: rgba(238, 248, 255, 0.72);
      --faint: rgba(238, 248, 255, 0.46);
      --shadow: 0 20px 90px rgba(0, 0, 0, 0.42);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      color: var(--white);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 0% 0%, rgba(53, 224, 197, 0.16), transparent 28%),
        radial-gradient(circle at 100% 0%, rgba(111, 220, 255, 0.16), transparent 26%),
        linear-gradient(180deg, #04101d 0%, #071524 38%, #030a12 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
      background-size: 56px 56px;
      opacity: 0.22;
      pointer-events: none;
    }

    .presentation, .slides {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .slide {
      position: absolute;
      inset: 0;
      display: grid;
      opacity: 0;
      pointer-events: none;
      transform: translateX(18px) scale(0.986);
      transition: opacity 260ms ease, transform 260ms ease;
    }

    .slide.is-active {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0) scale(1);
    }

    .slide--divider {
      place-items: center;
      padding: clamp(1.5rem, 3vw, 3.2rem);
    }

    .divider-card {
      width: min(92vw, 1080px);
      padding: clamp(2.2rem, 6vw, 4.8rem);
      border-radius: 34px;
      border: 1px solid var(--line);
      background:
        linear-gradient(140deg, rgba(16, 50, 82, 0.92), rgba(3, 10, 18, 0.95)),
        linear-gradient(180deg, rgba(53, 224, 197, 0.08), transparent);
      box-shadow: var(--shadow);
      text-align: center;
    }

    .eyebrow,
    .meta-pill,
    .date-label,
    .phase-badge,
    .counter,
    .control-note,
    .subtitle-line {
      font-family: "Segoe UI", Arial, sans-serif;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .eyebrow {
      color: var(--aqua);
      font-size: 0.82rem;
      margin-bottom: 1rem;
      font-weight: 700;
    }

    .divider-title {
      margin: 0;
      font-size: clamp(2.6rem, 8vw, 6.3rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
    }

    .divider-subtitle {
      margin: 1.3rem auto 0;
      max-width: 38rem;
      color: var(--muted);
      font-size: clamp(1.04rem, 2.5vw, 1.45rem);
      line-height: 1.62;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 1.8rem;
      padding: 0.86rem 1.2rem;
      border-radius: 999px;
      color: var(--teal);
      background: rgba(4, 15, 27, 0.64);
      border: 1px solid rgba(111, 220, 255, 0.18);
      font-size: 0.76rem;
      font-weight: 700;
    }

    .slide--card {
      grid-template-rows: minmax(0, 56vh) minmax(0, 44vh);
    }

    .media {
      position: relative;
      overflow: hidden;
      background: linear-gradient(135deg, #0c2b48, #07111b);
    }

    .media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: saturate(1.05) contrast(1.03);
    }

    .media::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(4, 16, 29, 0.04) 0%, rgba(4, 16, 29, 0.18) 48%, rgba(4, 16, 29, 0.9) 100%),
        linear-gradient(90deg, rgba(4, 16, 29, 0.28), transparent 20%, transparent 80%, rgba(4, 16, 29, 0.28));
    }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      padding: clamp(1rem, 2.2vw, 1.55rem);
    }

    .phase-badge,
    .counter {
      border-radius: 999px;
      border: 1px solid rgba(111, 220, 255, 0.24);
      background: rgba(5, 18, 32, 0.52);
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
    }

    .phase-badge {
      padding: 0.76rem 1rem;
      color: var(--teal);
      font-size: 0.76rem;
      font-weight: 700;
    }

    .counter {
      padding: 0.72rem 0.96rem;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 700;
    }

    .copy {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
      padding: clamp(1.25rem, 2.6vw, 2.1rem) clamp(1.2rem, 3vw, 2.8rem) clamp(1.2rem, 3vw, 2.3rem);
      background:
        linear-gradient(180deg, rgba(4, 16, 29, 0.94), rgba(3, 12, 22, 0.99)),
        radial-gradient(circle at top center, rgba(53, 224, 197, 0.08), transparent 36%);
      border-top: 1px solid rgba(111, 220, 255, 0.14);
    }

    .date-label {
      color: var(--aqua);
      font-size: 0.78rem;
      font-weight: 700;
    }

    .slide-title {
      margin: 0;
      font-size: clamp(1.7rem, 4.1vw, 3.25rem);
      line-height: 1.03;
      letter-spacing: -0.028em;
      max-width: 19ch;
    }

    .subtitle-line {
      color: var(--faint);
      font-size: 0.72rem;
      font-weight: 700;
    }

    .perex {
      margin: 0;
      max-width: 54rem;
      color: var(--muted);
      font-size: clamp(0.98rem, 2vw, 1.2rem);
      line-height: 1.68;
    }

    .aux {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      margin-top: 0.15rem;
    }

    .tag {
      padding: 0.48rem 0.72rem;
      border-radius: 999px;
      background: rgba(10, 27, 44, 0.9);
      border: 1px solid rgba(111, 220, 255, 0.15);
      color: var(--muted);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem;
      margin-top: auto;
    }

    .button {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.9rem 1.28rem;
      border-radius: 999px;
      text-decoration: none;
      border: 1px solid rgba(111, 220, 255, 0.34);
      background: linear-gradient(135deg, rgba(16, 50, 82, 0.92), rgba(7, 20, 33, 0.96));
      color: var(--white);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 0.9rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
      box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
      transition: transform 160ms ease, border-color 160ms ease;
    }

    .button:hover,
    .button:focus-visible {
      transform: translateY(-1px);
      border-color: rgba(53, 224, 197, 0.62);
    }

    .button::before {
      content: "";
      width: 0.68rem;
      height: 0.68rem;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--teal), var(--aqua));
      box-shadow: 0 0 16px rgba(53, 224, 197, 0.58);
      flex: 0 0 auto;
    }

    .controls {
      position: fixed;
      inset-inline: 0;
      bottom: clamp(0.8rem, 2.4vw, 1.4rem);
      z-index: 10;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 0 1rem;
    }

    .controls-shell {
      display: flex;
      align-items: center;
      gap: 0.72rem;
      padding: 0.72rem 0.85rem;
      border-radius: 999px;
      background: rgba(5, 16, 29, 0.78);
      border: 1px solid rgba(111, 220, 255, 0.15);
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
    }

    .nav-button {
      width: 3.15rem;
      height: 3.15rem;
      border-radius: 50%;
      border: 1px solid rgba(111, 220, 255, 0.26);
      background: linear-gradient(135deg, rgba(16, 50, 82, 0.82), rgba(7, 20, 33, 0.9));
      color: var(--white);
      font-size: 1.18rem;
      cursor: pointer;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    .nav-button:hover,
    .nav-button:focus-visible { transform: scale(1.03); }
    .nav-button:disabled { opacity: 0.28; cursor: default; transform: none; }

    .dots {
      display: flex;
      align-items: center;
      gap: 0.44rem;
      max-width: min(56vw, 780px);
      overflow: hidden;
    }

    .dot {
      width: 0.64rem;
      height: 0.64rem;
      border-radius: 50%;
      border: none;
      padding: 0;
      background: rgba(238, 248, 255, 0.2);
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease;
    }

    .dot.is-active {
      background: linear-gradient(135deg, var(--teal), var(--aqua));
      transform: scale(1.22);
    }

    .control-note {
      color: var(--faint);
      font-size: 0.68rem;
      white-space: nowrap;
    }

    @media (max-width: 900px) {
      .slide--card { grid-template-rows: minmax(0, 50vh) minmax(0, 50vh); }
      .slide-title { max-width: none; }
    }

    @media (max-width: 640px) {
      .slide--card { grid-template-rows: minmax(0, 47vh) minmax(0, 53vh); }
      .controls-shell { gap: 0.55rem; padding: 0.58rem 0.68rem; }
      .nav-button { width: 2.9rem; height: 2.9rem; }
      .control-note { display: none; }
    }
  </style>
</head>
<body>
  <main class="presentation" aria-label="Prezentace itineráře Azory 2026">
    <section class="slides" id="slides"></section>
    <div class="controls" aria-label="Navigace prezentace">
      <div class="controls-shell">
        <button class="nav-button" id="prevButton" type="button" aria-label="Předchozí slide">&#8592;</button>
        <div class="dots" id="dots" aria-label="Přehled slidů"></div>
        <button class="nav-button" id="nextButton" type="button" aria-label="Další slide">&#8594;</button>
        <span class="control-note">Swipe nebo šipky</span>
      </div>
    </div>
  </main>

  <script>
    const slides = ${slideDataLiteral};
    const totalCards = ${cardCount};

    const slidesContainer = document.getElementById("slides");
    const dotsContainer = document.getElementById("dots");
    const prevButton = document.getElementById("prevButton");
    const nextButton = document.getElementById("nextButton");

    let currentIndex = 0;
    let touchStartX = null;

    function renderSlides() {
      let cardIndex = 0;

      slidesContainer.innerHTML = slides.map((slide, index) => {
        if (slide.kind === "divider") {
          return \`
            <article class="slide slide--divider\${index === 0 ? " is-active" : ""}" data-index="\${index}">
              <div class="divider-card">
                <div class="eyebrow">\${slide.eyebrow}</div>
                <h1 class="divider-title">\${slide.title}</h1>
                <p class="divider-subtitle">\${slide.subtitle}</p>
                <div class="meta-pill">\${slide.meta}</div>
              </div>
            </article>
          \`;
        }

        cardIndex += 1;
        const dateTag = slide.visitDate ? slide.rangeLabel : "";
        const reserveTag = slide.reserveLabel || "";
        const subtitleLine = slide.subtitle ? \`<div class="subtitle-line">\${slide.subtitle}</div>\` : "";
        const auxTags = [dateTag, reserveTag].filter(Boolean).map((value) => \`<span class="tag">\${value}</span>\`).join("");

        return \`
          <article class="slide slide--card\${index === 0 ? " is-active" : ""}" data-index="\${index}">
            <div class="media">
              <img src="\${slide.image}" alt="\${slide.title}">
              <div class="overlay">
                <div class="phase-badge">\${slide.phaseLabel}</div>
                <div class="counter">\${cardIndex} / \${totalCards}</div>
              </div>
            </div>
            <div class="copy">
              <div class="date-label">\${slide.dateLabel}</div>
              <h2 class="slide-title">\${slide.title}</h2>
              \${subtitleLine}
              <p class="perex">\${slide.perex}</p>
              <div class="aux">\${auxTags}</div>
              <div class="actions">
                <a class="button" href="\${slide.mapyUrl}" target="_blank" rel="noopener noreferrer">Mapy.cz</a>
                <a class="button" href="\${slide.notionUrl}" target="_blank" rel="noopener noreferrer">Notion karta</a>
              </div>
            </div>
          </article>
        \`;
      }).join("");

      dotsContainer.innerHTML = slides.map((slide, index) => \`
        <button
          class="dot\${index === 0 ? " is-active" : ""}"
          type="button"
          data-index="\${index}"
          aria-label="\${slide.kind === "divider" ? slide.title : "Slide: " + slide.title}"
        ></button>
      \`).join("");

      dotsContainer.querySelectorAll(".dot").forEach((dot) => {
        dot.addEventListener("click", () => setActiveSlide(Number(dot.dataset.index)));
      });
    }

    function setActiveSlide(index) {
      currentIndex = Math.max(0, Math.min(index, slides.length - 1));

      document.querySelectorAll(".slide").forEach((slide, slideIndex) => {
        slide.classList.toggle("is-active", slideIndex === currentIndex);
      });

      document.querySelectorAll(".dot").forEach((dot, dotIndex) => {
        dot.classList.toggle("is-active", dotIndex === currentIndex);
      });

      prevButton.disabled = currentIndex === 0;
      nextButton.disabled = currentIndex === slides.length - 1;
    }

    function stepSlide(direction) {
      setActiveSlide(currentIndex + direction);
    }

    prevButton.addEventListener("click", () => stepSlide(-1));
    nextButton.addEventListener("click", () => stepSlide(1));

    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") stepSlide(-1);
      if (event.key === "ArrowRight") stepSlide(1);
    });

    window.addEventListener("touchstart", (event) => {
      touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });

    window.addEventListener("touchend", (event) => {
      if (touchStartX === null) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      touchStartX = null;
      if (Math.abs(deltaX) < 45) return;
      stepSlide(deltaX > 0 ? -1 : 1);
    }, { passive: true });

    renderSlides();
    setActiveSlide(0);
  </script>
</body>
</html>`;

await fs.writeFile(outputPath, html, "utf8");
console.log(outputPath);
