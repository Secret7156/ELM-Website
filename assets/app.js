function parseISO(d){
  const [y,m,day] = d.split("-").map(Number);
  return new Date(y, m-1, day);
}
function daysBetween(a,b){ return Math.round((b-a)/86400000); }

function monthRange(startISO, endISO){
  const s = parseISO(startISO), e = parseISO(endISO);
  const out = [];
  let y = s.getFullYear(), m = s.getMonth()+1;
  const ey = e.getFullYear(), em = e.getMonth()+1;
  while (y < ey || (y===ey && m<=em)){
    out.push({y,m});
    m++; if (m===13){ m=1; y++; }
  }
  return out;
}

function cssNum(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number(v.replace("px",""));
  return Number.isFinite(n) ? n : fallback;
}

async function loadEvents(dataUrl){
  try{
    const res = await fetch(dataUrl);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if(!Array.isArray(data)) return [];
    return data.map(e => ({
      id: e.id,
      date: e.date,
      title: e.title || "",
      text: e.text || "",
      section: e.section || "highlights",
      images: Array.isArray(e.images) ? e.images : [],
      video: e.video ?? null,
      author: e.author ?? null,
      labels: e.labels ?? null,
      _d: parseISO(e.date)
    }));
  }catch(err){
    console.error("Failed to load events:", dataUrl, err);
    return [];
  }
}

// Each slot stores the "next allowed x" where a new card can be placed without overlapping
function pickSlot(laneNextX, x, minGapPx){
  for(let i=0;i<laneNextX.length;i++){
    if(x >= laneNextX[i]){
      // reserve this slot until x + minGapPx
      laneNextX[i] = x + minGapPx;
      return i;
    }
  }
  // no slots available -> create a new one
  laneNextX.push(x + minGapPx);
  return laneNextX.length - 1;
}

// After everything is placed, compute stems so they stop exactly at the dot
function adjustStems(track){
  const lineY = cssNum("--lineY", 250);
  const dotSize = cssNum("--dotSize", 10);
  const dotCenterY = lineY; // because dot is centered on the line

  const trackRect = track.getBoundingClientRect();
  const cards = track.querySelectorAll(".event");

  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const cardTop = rect.top - trackRect.top;
    const cardBottom = rect.bottom - trackRect.top;

    const isTop = card.classList.contains("top");
    let stem = isTop
      ? (dotCenterY - cardBottom)
      : (cardTop - dotCenterY);

    stem = Math.max(12, Math.round(stem));
    card.style.setProperty("--stem", `${stem}px`);
  });
}

async function renderTimeline({ mountId, dataUrl, start, end, pxPerDay=3 }){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  const pad = cssNum("--pad", 90);
  const cardW = cssNum("--cardW", 220);
  const gapX  = cssNum("--gapX", 18);
  const slotStep = cssNum("--slotStep", 56);
  const topBase = cssNum("--topBase", 70);
  const botBase = cssNum("--botBase", 320);

  const startD = parseISO(start);
  const endD = parseISO(end);
  const totalDays = Math.max(1, daysBetween(startD, endD));

  const innerWidth = Math.max(1400, totalDays * pxPerDay);
  const trackWidth = innerWidth + pad*2;

  const scroller = document.createElement("div");
  scroller.className = "scroller";

  const track = document.createElement("div");
  track.className = "track";
  track.style.minWidth = `${trackWidth}px`;

  // month ticks + labels
  for(const {y,m} of monthRange(start, end)){
    const d = new Date(y, m-1, 1);
    const dx = daysBetween(startD, d);
    const x = pad + (dx / totalDays) * innerWidth;

    const tick = document.createElement("div");
    tick.className = "month-tick";
    tick.style.left = `${x}px`;

    const label = document.createElement("div");
    label.className = "month-label";
    label.style.left = `${x}px`;
    label.textContent = d.toLocaleString(undefined, { month:"short", year:"numeric" });

    track.appendChild(tick);
    track.appendChild(label);
  }

const eventsAll = (await loadEvents(dataUrl))
  .filter(e => e._d >= startD && e._d <= endD)
  .sort((a,b)=>a._d-b._d);

// group by date so timeline shows ONE card per day
const byDate = groupByDate(eventsAll);
const datesAsc = Array.from(byDate.keys()).sort((a,b)=> parseISO(a) - parseISO(b));

const minGapPx = cardW + gapX + 20;
const topSlots = [];
const botSlots = [];
const seenDots = new Set();

let flip = false; // alternate by day-card

// render dots + cards (ONE per date)
for (const date of datesAsc) {
  const dayEvents = byDate.get(date);

  // choose a primary event (prefer highlights)
  const primary =
    dayEvents.find(e => e.section === "highlights") || dayEvents[0];

  const dx = daysBetween(startD, parseISO(date));
  const x = pad + (dx / totalDays) * innerWidth;

  // dot
  const dot = document.createElement("div");
  dot.className = "dot";
  dot.style.left = `${x}px`;
  track.appendChild(dot);

  // choose lane + slot
  const laneTop = flip;
  const slot = pickSlot(laneTop ? topSlots : botSlots, x, minGapPx);

  const card = document.createElement("article");
  card.className = `event ${laneTop ? "top" : "bottom"}`;
  card.style.left = `${x}px`;

  const y = laneTop
    ? (topBase - slot * slotStep)
    : (botBase + slot * slotStep);

  card.style.setProperty("--y", `${y}px`);

  const extra =
    dayEvents.length > 1 ? ` (+${dayEvents.length - 1})` : "";

  const href =
    primary.section === "highlights"
      ? `./highlights.html#${dateToAnchor(date)}`
      : `./${primary.section}.html#e-${primary.id}`;

  card.innerHTML = `
    <h4>${escapeHtml(date)}</h4>
    <p>${escapeHtml(primary.title)}${extra}</p>
    <div class="meta">
      <a class="pill-link" href="${href}">
        ${escapeHtml(primary.labels || primary.section)}
      </a>
    </div>
  `;

  track.appendChild(card);
  flip = !flip;
}

scroller.appendChild(track);
mount.innerHTML = "";
mount.appendChild(scroller);

// wait for layout, then adjust stems precisely
requestAnimationFrame(() => adjustStems(track));
}

async function renderSectionList({ mountId, dataUrl, section }){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  const events = (await loadEvents(dataUrl))
    .filter(e => e.section === section)
    .sort((a,b)=>a._d-b._d);

  const wrap = document.createElement("div");
  wrap.className = "list";

  if(events.length === 0){
    wrap.innerHTML = `<div class="item"><p>No entries yet.</p></div>`;
    mount.innerHTML = "";
    mount.appendChild(wrap);
    return;
  }

  for(const e of events){
    const card = document.createElement("article");
    card.className = "item";
    card.id = `e-${e.id}`;
    card.innerHTML = `
      <h3>${e.date} — ${escapeHtml(e.title)}</h3>
      <p>${escapeHtml(e.text)}</p>
    `;
    wrap.appendChild(card);
  }

  mount.innerHTML = "";
  mount.appendChild(wrap);
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getAuthorName(author){
  if(!author) return "";
  if(typeof author === "string") return author;
  if(typeof author === "object" && author.name) return author.name;
  return "";
}

function getAuthorId(author){
  if(!author) return "";
  if(typeof author === "object" && author.id) return String(author.id);
  return "";
}

function authorBylineHtml(author){
  const name = getAuthorName(author);
  if(!name) return "";

  const id = getAuthorId(author);
  if(id){
    return `<a class="byline-link" href="./roster.html#${encodeURIComponent(id)}">By ${escapeHtml(name)}</a>`;
  }
  return `<span class="byline">By ${escapeHtml(name)}</span>`;
}

function groupByDate(events){
  const map = new Map();
  for(const e of events){
    if(!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  // ensure deterministic order inside a date
  for(const [date, arr] of map.entries()){
    arr.sort((a,b) => (a._d - b._d) || a.id.localeCompare(b.id));
  }
  return map;
}

function dateToAnchor(dateISO){
  return `d-${dateISO}`; // e.g. d-2026-01-05
}


// ===== Highlights Hub =====
async function renderHighlightsHub({ mountId, dataUrl, section = "highlights" }) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const events = (await loadEvents(dataUrl)).filter(e => e.section === section);
  const byDate = groupByDate(events);

  const datesDesc = Array.from(byDate.keys()).sort((a,b) => parseISO(b) - parseISO(a));

  const wrap = document.createElement("div");
  wrap.className = "list";

  if (datesDesc.length === 0) {
    wrap.innerHTML = `<div class="item"><p>No entries yet.</p></div>`;
    mount.innerHTML = "";
    mount.appendChild(wrap);
    return;
  }

  for (const date of datesDesc) {
    const dayEvents = byDate.get(date);

    const dayCard = document.createElement("article");
    dayCard.className = "entry";
    dayCard.id = dateToAnchor(date);

    dayCard.innerHTML = `
      <div class="entry-body">
        <h3>${escapeHtml(date)} — ${dayEvents.length} entr${dayEvents.length === 1 ? "y" : "ies"}</h3>
        <p class="sub2">Swipe through this day’s entries.</p>
      </div>
    `;

    dayCard.appendChild(buildDayEntrySwiper(date, dayEvents));
    wrap.appendChild(dayCard);
  }

  mount.innerHTML = "";
  mount.appendChild(wrap);

  // Deep-link from Timeline: highlights.html#d-YYYY-MM-DD
  const hash = location.hash.slice(1); // remove '#'
  if(hash){
    const target = document.getElementById(hash);
    if(target){
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("entry-focus");
      setTimeout(() => target.classList.remove("entry-focus"), 2000);
    }
  }
}

// Swiper: one “day card” contains multiple entries
function buildDayEntrySwiper(date, entries){
  const shell = document.createElement("div");
  shell.className = "day-swipe";

  let idx = 0;

  const viewport = document.createElement("div");
  viewport.className = "day-swipe-viewport";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "day-swipe-btn day-swipe-prev";
  prev.textContent = "‹";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "day-swipe-btn day-swipe-next";
  next.textContent = "›";

  const counter = document.createElement("div");
  counter.className = "day-swipe-counter";

  function render(){
    const e = entries[idx];
    viewport.innerHTML = "";

    const slide = document.createElement("div");
    slide.className = "day-swipe-slide";
    slide.id = `e-${e.id}`; // keep per-entry anchors too

    // each entry can have its own image carousel (autoplay if >1 image)
    const imgs = Array.isArray(e.images) ? e.images : [];
    if(imgs.length){
      slide.appendChild(buildCarousel(imgs, `${e.date} ${e.title}`, { autoplay:true, intervalMs: 3500 }));
    }

    const body = document.createElement("div");
    body.className = "entry-body";
    body.innerHTML = `
      <h3>${escapeHtml(e.date)} — ${escapeHtml(e.title)}</h3>
      ${authorBylineHtml(e.author)}
      ${renderVideoEmbed(e.video)}
      <p>${escapeHtml(e.text)}</p>
      <div class="meta">
        <span class="pill">${escapeHtml(e.labels || e.section)}</span>
      </div>
    `;

    slide.appendChild(body);
    viewport.appendChild(slide);

    counter.textContent = `${idx+1} / ${entries.length}`;
    prev.disabled = entries.length <= 1;
    next.disabled = entries.length <= 1;
  }

  function go(d){
    idx = (idx + d + entries.length) % entries.length;
    render();
  }

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(+1));

  // keyboard
  shell.tabIndex = 0;
  shell.addEventListener("keydown", (ev) => {
    if(ev.key === "ArrowLeft") go(-1);
    if(ev.key === "ArrowRight") go(+1);
  });

  shell.appendChild(prev);
  shell.appendChild(viewport);
  shell.appendChild(next);
  shell.appendChild(counter);

  render();
  return shell;
}


function buildCarousel(images, altText = "Entry image", opts = {}) {
  const media = document.createElement("div");
  media.className = "entry-media";

  let idx = 0;

  const img = document.createElement("img");
  img.src = images[idx];
  img.alt = altText;
  media.appendChild(img);

  // If only one image: no controls
  if (images.length === 1) return media;

  const prev = document.createElement("button");
  prev.className = "carousel-btn carousel-prev";
  prev.type = "button";
  prev.textContent = "‹";

  const next = document.createElement("button");
  next.className = "carousel-btn carousel-next";
  next.type = "button";
  next.textContent = "›";

  const dots = document.createElement("div");
  dots.className = "carousel-dots";

  const dotEls = images.map((_, i) => {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "carousel-dot" + (i === idx ? " active" : "");
    d.addEventListener("click", () => setIndex(i));
    dots.appendChild(d);
    return d;
  });

  function setIndex(newIdx) {
    idx = (newIdx + images.length) % images.length;
    img.src = images[idx];
    dotEls.forEach((d, i) => d.classList.toggle("active", i === idx));
  }

  prev.addEventListener("click", () => setIndex(idx - 1));
  next.addEventListener("click", () => setIndex(idx + 1));

  // optional: keyboard support when focused
  media.tabIndex = 0;
  media.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") setIndex(idx - 1);
    if (ev.key === "ArrowRight") setIndex(idx + 1);
  });

  media.appendChild(prev);
  media.appendChild(next);
  media.appendChild(dots);

  // OPTIONAL: auto-play
  const autoplay = opts.autoplay === true;
  const intervalMs = Number(opts.intervalMs || 3500);

  let timer = null;
  function start(){
    if(!autoplay || images.length <= 1) return;
    stop();
    timer = setInterval(() => setIndex(idx + 1), intervalMs);
  }
  function stop(){
    if(timer) clearInterval(timer);
    timer = null;
  }

  media.addEventListener("mouseenter", stop);
  media.addEventListener("mouseleave", start);
  media.addEventListener("focusin", stop);
  media.addEventListener("focusout", start);

  start();

  return media;
}

// ===== Roster (click tile -> bio panel) =====
function renderRoster({ gridId, panelId }){
  const grid = document.getElementById(gridId);
  const panel = document.getElementById(panelId);
  if(!grid || !panel) return;

  // EDIT THIS LIST with your classmates
  const people = [
    {
      id: "001",
      name: "Isabel Alba",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "002",
      name: "Elisha Alexander",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "003",
      name: "Marissa Almaguer",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
        {
      id: "004",
      name: "Zara Batac-Bhatti",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "005",
      name: "Deone Gipson",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "005",
      name: "Kevin Jacinto",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "007",
      name: "Dominique Jenkins",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "008",
      name: "Kellyann Jimenez",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "009",
      name: "Cassidy Kingston",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "010",
      name: "Christen Lee",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "011",
      name: "Rocio Lopez",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "012",
      name: "Darlene Martinez",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "013",
      name: "Maricruz Martinez",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "014",
      name: "Elitia Matthews",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "015",
      name: "Asia Mitchell",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "016",
      name: "Kristine Ocana",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "017",
      name: "Kaitlin Ochoa",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "018",
      name: "Rayleen Pinones",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "019",
      name: "Kimberly Rodriguez",
      img: "../assets/images/roster/default.png",
      role: "Pending",
      tagline: "Pending",
      bio: "Pending",
      tags: ["Pending", "Pending"]
    },
    {
      id: "020",
      name: "Ric Jameson Sabellon",
      img: "../assets/images/roster/default.png",
      role: "BS. Biology",
      tagline: "Nature Lover",
      bio: "Ric is a lifelong student driven by curiosity, discipline, and a quiet determination to grow -- seeking not just to understand the world, but to serve it with thoughtfulness and care.",
      tags: ["Pending", "Pending"]
    },
  ];

  // Build grid
  grid.innerHTML = "";
  people.forEach((p, idx) => {
    const btn = document.createElement("button");
    btn.className = "roster-tile";
    btn.type = "button";
    btn.dataset.id = p.id;
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("aria-label", `Open bio for ${p.name}`);

    btn.innerHTML = `
      <img class="roster-img" src="${p.img}" alt="${p.name}" loading="lazy" />
      <div class="roster-name">${escapeHtml(p.name)}</div>
    `;

    btn.addEventListener("click", () => selectPerson(p.id));
    btn.addEventListener("keydown", (ev) => {
      if(ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectPerson(p.id);
      }
    });
    
  // Auto-open from URL hash: roster.html#003
    const hash = (location.hash || "").replace("#", "");
    if(hash){
    const exists = people.some(p => String(p.id) === hash);
    if(exists) selectPerson(hash);
    }

    grid.appendChild(btn);

    // Optional: auto-select first person
    if(idx === 0) {
      // selectPerson(p.id);
    }
  });

  function selectPerson(id){
    const p = people.find(x => x.id === id);
    if(!p) return;

    history.replaceState(null, "", `#${encodeURIComponent(id)}`);

    // highlight active tile
    grid.querySelectorAll(".roster-tile").forEach(el => {
      el.classList.toggle("is-active", el.dataset.id === id);
    });

    // render bio
    panel.innerHTML = `
      <div class="bio">
        <div class="bio-media">
          <img src="${p.img}" alt="${escapeHtml(p.name)}" />
        </div>
        <div class="bio-content">
          <h3 class="bio-title">${escapeHtml(p.name)}</h3>
          <p class="bio-sub">${escapeHtml(p.role)} • ${escapeHtml(p.tagline)}</p>
          <p class="bio-text">${escapeHtml(p.bio)}</p>
          ${Array.isArray(p.tags) && p.tags.length
            ? `<div class="bio-tags">${p.tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("")}</div>`
            : ""
          }
        </div>
      </div>
    `;

    // scroll bio panel into view nicely (optional)
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// ===== Video Embed =====
function renderVideoEmbed(url) {
  if (!url) return "";

  // YouTube
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    const id = url.includes("v=")
      ? url.split("v=")[1].split("&")[0]
      : url.split("/").pop();

    return `
      <div class="video-wrap">
        <iframe
          src="https://www.youtube.com/embed/${id}"
          frameborder="0"
          allowfullscreen>
        </iframe>
      </div>`;
  }

  // Vimeo
  if (url.includes("vimeo.com")) {
    const id = url.split("/").pop();
    return `
      <div class="video-wrap">
        <iframe
          src="https://player.vimeo.com/video/${id}"
          frameborder="0"
          allowfullscreen>
        </iframe>
      </div>`;
  }

  // Direct video file
  return `
    <div class="video-wrap">
      <video controls>
        <source src="${url}">
      </video>
    </div>`;
}