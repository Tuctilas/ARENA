/* ═══════════════════════════════════════════
   ARENABET – script.js  v4.0
   Full-stack: API + Auth + Live + All Views
═══════════════════════════════════════════ */

// ── PARTICLE CANVAS ───────────────────────
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  const ctx    = canvas.getContext('2d');
  let W, H, pts = [];
  const COLORS = ['#00D9FF','#8B5CF6','#00FF9D','rgba(255,255,255,.8)'];
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function Pt() { this.reset = () => { this.x=Math.random()*W; this.y=Math.random()*H; this.vx=(Math.random()-.5)*.3; this.vy=(Math.random()-.5)*.3-.08; this.r=Math.random()*1.4+.3; this.c=COLORS[Math.floor(Math.random()*COLORS.length)]; this.a=Math.random()*.4+.08; this.life=Math.random()*350+150; this.age=0; }; this.reset(); this.y=Math.random()*H; }
  Pt.prototype.update = function(){ this.x+=this.vx; this.y+=this.vy; this.age++; if(this.age>this.life||this.x<0||this.x>W||this.y<-10) this.reset(); };
  Pt.prototype.draw = function(){ ctx.save(); ctx.globalAlpha=this.a*(1-this.age/this.life); ctx.shadowBlur=5; ctx.shadowColor=this.c; ctx.fillStyle=this.c; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.restore(); };
  function init(){ resize(); pts=Array.from({length:100},()=>new Pt()); loop(); }
  function loop(){ ctx.clearRect(0,0,W,H); pts.forEach(p=>{p.update();p.draw();}); requestAnimationFrame(loop); }
  window.addEventListener('resize', resize);
  window.addEventListener('load', init);
})();

// ════════════════════════════════════════════
//  API CLIENT
// ════════════════════════════════════════════
const API_BASE = '';  // same origin

const api = {
  token: localStorage.getItem('arenaToken') || null,

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    return h;
  },

  async get(path) {
    const r = await fetch(API_BASE + path, { headers: this.headers() });
    return r.json();
  },

  async post(path, body) {
    const r = await fetch(API_BASE + path, { method:'POST', headers: this.headers(), body: JSON.stringify(body) });
    return r.json();
  },

  async put(path, body) {
    const r = await fetch(API_BASE + path, { method:'PUT', headers: this.headers(), body: JSON.stringify(body) });
    return r.json();
  },
};

// ════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════
let betSlip        = [];
let currentUser    = null;
let currentView    = 'home';
let currentFilter  = 'all';
let selectedMatch  = null;
let currentMarket  = 'principal';
let liveGamesData  = [];
let upcomingData   = [];
let liveFilterSport = 'all';
let homeSport   = 'all';   // filtro de esporte na home (barra lateral)
let homeLeague  = 'all';   // filtro de liga na home (barra lateral)
let betHistoryFilter = 'all';

// Liga (chave da barra lateral) → trecho do nome usado nos dados
const LEAGUE_MATCH = {
  brasileirao: 'brasileir', libertadores: 'libertadores', champions: 'champions',
  premier: 'premier', laliga: 'la liga', seriea: 'serie a',
  bundesliga: 'bundesliga', copabrasil: 'copa do brasil',
};
const SPORT_LABELS = {
  futebol:'Futebol', basquete:'Basquete', tenis:'Tênis', volei:'Vôlei',
  mma:'MMA/Lutas', americano:'Futebol Americano', esports:'E-Sports', formula1:'Fórmula 1',
};

// Aplica os filtros da barra lateral sobre uma lista de jogos.
function applyHomeFilters(list) {
  return list.filter(g => {
    if (homeSport !== 'all' && g.sport !== homeSport) return false;
    if (homeLeague !== 'all') {
      const needle = LEAGUE_MATCH[homeLeague];
      if (needle && !g.league.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
}
let pixTimerInterval = null;
let pwaInstallPrompt = null;

// ════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════
const fmt    = v => 'R$ ' + parseFloat(v).toFixed(2).replace('.', ',');
const fmtOdd = v => parseFloat(v).toFixed(2);
const pct    = v => ((1/v)*100).toFixed(1) + '%';
const nudge  = (v, r=.06) => Math.max(1.01, parseFloat((v+(Math.random()-.5)*r).toFixed(2)));

function bookReturn(odds) {
  const valid = odds.filter(Boolean);
  if (!valid.length) return '—';
  return (100 / valid.reduce((s,o) => s + 1/o, 0)).toFixed(1) + '%';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)  return 'agora';
  if (m < 60) return m + 'min atrás';
  const h = Math.floor(m/60);
  if (h < 24) return h + 'h atrás';
  return Math.floor(h/24) + 'd atrás';
}

function showToast(msg, duration=2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), duration);
}

const openModal  = id => document.getElementById(id).classList.add('active');
const closeModal = id => document.getElementById(id).classList.remove('active');
const isSelected = (gameId, label) => betSlip.some(b => b.gameId===gameId && b.label===label);

// ════════════════════════════════════════════
//  PWA
// ════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  pwaInstallPrompt = e;
  const banner = document.getElementById('pwaBanner');
  if (banner) {
    banner.classList.add('visible');
    document.getElementById('pwaInstall').addEventListener('click', () => {
      pwaInstallPrompt.prompt();
      pwaInstallPrompt.userChoice.then(() => banner.classList.remove('visible'));
    });
    document.getElementById('pwaDismiss').addEventListener('click', () => banner.classList.remove('visible'));
  }
});

// ════════════════════════════════════════════
//  ROUTER
// ════════════════════════════════════════════
function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.querySelectorAll('[data-view]').forEach(l => l.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active-view');
  document.querySelectorAll(`[data-view="${view}"]`).forEach(l => l.classList.add('active'));
  currentView = view;
  document.getElementById('mainContent').scrollTo(0, 0);

  // Close dropdowns
  document.querySelectorAll('.user-dropdown').forEach(d => d.style.display='');

  // Protected views
  const protected_views = ['mybets','vip','perfil'];
  if (protected_views.includes(view) && !currentUser) {
    openModal('loginModal');
    return;
  }

  switch(view) {
    case 'live':      renderLiveView(); break;
    case 'casino':    renderCasino(); break;
    case 'promo':     renderPromo(); break;
    case 'virtual':   renderVirtual(); break;
    case 'esports':   renderEsports(); break;
    case 'mybets':    renderMyBets(); break;
    case 'vip':       renderVip(); break;
    case 'afiliados': renderAfiliados(); break;
    case 'perfil':    renderPerfil(); break;
  }
}

// Bind all [data-view] links
document.addEventListener('click', e => {
  const el = e.target.closest('[data-view]');
  if (el) { e.preventDefault(); navigate(el.dataset.view); }
});

// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
document.getElementById('btnLogin').addEventListener('click',    () => openModal('loginModal'));
document.getElementById('btnRegister').addEventListener('click', () => openModal('registerModal'));
document.getElementById('heroCta').addEventListener('click',     () => { if (!currentUser) openModal('registerModal'); });
document.getElementById('heroLive').addEventListener('click',    () => navigate('live'));

document.getElementById('switchToRegister').addEventListener('click', e => { e.preventDefault(); closeModal('loginModal'); openModal('registerModal'); });
document.getElementById('switchToLogin').addEventListener('click',    e => { e.preventDefault(); closeModal('registerModal'); openModal('loginModal'); });

document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.modal)));
document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if(e.target===ov) closeModal(ov.id); }));

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('loginSubmit');
  const err = document.getElementById('loginError');
  btn.classList.add('loading');
  err.classList.remove('show');

  const res = await api.post('/api/auth/login', {
    email: document.getElementById('loginEmail').value,
    password: document.getElementById('loginPassword').value,
  });

  btn.classList.remove('loading');
  if (res.error) { err.textContent = res.error; err.classList.add('show'); return; }

  api.token = res.token;
  localStorage.setItem('arenaToken', res.token);
  onLogin(res.user);
  closeModal('loginModal');
});

document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('registerSubmit');
  const err = document.getElementById('registerError');

  if (document.getElementById('regPassword').value !== document.getElementById('regConfirm').value) {
    err.textContent = 'As senhas não coincidem'; err.classList.add('show'); return;
  }

  btn.classList.add('loading'); err.classList.remove('show');

  const res = await api.post('/api/auth/register', {
    name:      document.getElementById('regName').value,
    last_name: document.getElementById('regLastName').value,
    email:     document.getElementById('regEmail').value,
    cpf:       document.getElementById('regCpf').value,
    password:  document.getElementById('regPassword').value,
  });

  btn.classList.remove('loading');
  if (res.error) { err.textContent = res.error; err.classList.add('show'); return; }

  api.token = res.token;
  localStorage.setItem('arenaToken', res.token);
  onLogin(res.user);
  closeModal('registerModal');
});

function onLogin(user) {
  currentUser = user;
  document.getElementById('btnLogin').style.display    = 'none';
  document.getElementById('btnRegister').style.display = 'none';
  document.getElementById('userMenu').style.display    = 'flex';
  document.getElementById('balanceDisplay').style.display = 'flex';
  document.getElementById('notifWrap').style.display   = 'flex';
  document.getElementById('btnUser').textContent = `◈ ${user.name.toUpperCase().slice(0,10)} ▾`;
  updateBalance(user.balance);
  showToast(`⚡ BEM-VINDO, ${user.name.toUpperCase()}! SALDO: ${fmt(user.balance)}`);
  pollNotifications();
}

function updateBalance(val) {
  if (currentUser) currentUser.balance = val;
  document.getElementById('balanceAmount').textContent = fmt(val);
  document.getElementById('withdrawBalance').textContent = fmt(val);
}

document.getElementById('btnLogout').addEventListener('click', () => {
  currentUser = null;
  api.token   = null;
  localStorage.removeItem('arenaToken');
  document.getElementById('btnLogin').style.display    = 'inline-flex';
  document.getElementById('btnRegister').style.display = 'inline-flex';
  document.getElementById('userMenu').style.display    = 'none';
  document.getElementById('balanceDisplay').style.display = 'none';
  document.getElementById('notifWrap').style.display   = 'none';
  betSlip = [];
  renderBetSlip(); renderAllCards();
  navigate('home');
  showToast('◈ Sessão encerrada');
});

// Auto-login on load
async function autoLogin() {
  if (!api.token) return;
  const user = await api.get('/api/auth/me');
  if (user.id) onLogin(user);
}

// ════════════════════════════════════════════
//  NOTIFICATIONS
// ════════════════════════════════════════════
async function pollNotifications() {
  if (!currentUser) return;
  const data = await api.get('/api/user/notifications');
  if (!data.notifications) return;
  const badge = document.getElementById('notifBadge');
  badge.textContent = data.unread > 0 ? data.unread : '';
  badge.style.display = data.unread > 0 ? 'flex' : 'none';

  const list = document.getElementById('notifList');
  if (!data.notifications.length) {
    list.innerHTML = '<div class="notif-empty">Nenhuma notificação</div>';
    return;
  }
  list.innerHTML = data.notifications.map(n => `
    <div class="notif-item ${n.read?'':'unread'}">
      <span class="notif-item-icon">${n.type==='win'?'🏆':n.type==='loss'?'❌':'ℹ️'}</span>
      <div class="notif-item-body">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-text">${n.body}</div>
        <div class="notif-item-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`).join('');
}

document.getElementById('markAllRead').addEventListener('click', async () => {
  if (!currentUser) return;
  await api.post('/api/user/notifications/read', {});
  document.getElementById('notifBadge').style.display = 'none';
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
});

setInterval(() => { if (currentUser) pollNotifications(); }, 10000);

// ════════════════════════════════════════════
//  LIVE ODDS FROM SERVER
// ════════════════════════════════════════════
async function fetchLiveOdds() {
  const data = await api.get('/api/odds/live');
  if (Array.isArray(data)) { liveGamesData = data; }
}

async function fetchUpcoming() {
  const data = await api.get('/api/odds/upcoming');
  if (Array.isArray(data)) { upcomingData = data; }
}

// Poll live odds every 5s
setInterval(async () => {
  await fetchLiveOdds();
  renderAllCards();
  document.getElementById('liveCountBadge').textContent = liveGamesData.length;
  document.getElementById('liveCountLive').textContent  = liveGamesData.length;
  document.getElementById('liveCountSidebar').textContent = liveGamesData.length;
  document.getElementById('tickerLiveCount').textContent = liveGamesData.length;

  // update hero panel odds animation
  document.querySelectorAll('.live-odd').forEach(el => {
    const n = nudge(parseFloat(el.dataset.base), .04);
    el.dataset.base = n; el.textContent = fmtOdd(n);
    el.style.color = '#fff'; setTimeout(()=>{ el.style.color=''; }, 400);
  });

  const hTime = document.getElementById('heroTime');
  if (hTime) { const t = parseInt(hTime.textContent)||67; if(t<90) hTime.textContent=(t+1)+"'"; }

  if (currentView === 'live') { renderLiveEventsList(); }
  if (selectedMatch && currentView === 'live') {
    const g = liveGamesData.find(x=>x.id===selectedMatch);
    if (g) {
      const scoreEl = document.getElementById(`msb-score-${g.id}`);
      const timeEl  = document.getElementById(`msb-time-${g.id}`);
      if (scoreEl) scoreEl.textContent = `${g.home.score} — ${g.away.score}`;
      if (timeEl && g.minute) timeEl.textContent = g.minute+"'";
      // refresh events
      const evContainer = document.getElementById(`match-events-${g.id}`);
      if (evContainer && g.events.length) {
        evContainer.innerHTML = g.events.map(ev=>`
          <div class="event-item">
            <span class="event-time">${ev.min!=null?ev.min+"'":''}</span>
            <span class="event-icon">${ev.icon}</span>
            <span class="event-desc">${ev.desc}<span class="event-team">${ev.team}</span></span>
          </div>`).join('');
      }
    }
  }
}, 5000);

function renderAllCards() {
  renderLiveCards();
  if (currentView === 'esports') renderEsports();
}

// ════════════════════════════════════════════
//  RENDER: HOME LIVE CARDS
// ════════════════════════════════════════════
function renderLiveCards() {
  if (!liveGamesData.length) return;
  const el = document.getElementById('liveCards');
  const filtered = applyHomeFilters(liveGamesData);

  if (!filtered.length) {
    const nome = homeSport !== 'all' ? (SPORT_LABELS[homeSport] || homeSport) : 'esta seleção';
    el.innerHTML = `<div class="empty-filter">⚡ Nenhum evento ao vivo de <strong>${nome}</strong> no momento.<br><span>Veja os próximos jogos abaixo ou escolha outro esporte.</span></div>`;
    return;
  }

  const toShow = filtered.slice(0, 6);
  el.innerHTML = toShow.map(g => {
    const oddVals = [g.odds.h, g.odds.d, g.odds.a].filter(Boolean);
    const book    = oddVals.reduce((s,o)=>s+1/o, 0);
    const ret     = (100/book).toFixed(1);
    const oddsArr = g.odds.d
      ? [{l:'1',v:g.odds.h},{l:'X',v:g.odds.d},{l:'2',v:g.odds.a}]
      : [{l:'1',v:g.odds.h},{l:'2',v:g.odds.a}];
    const time = g.minute ? g.minute+"'" : g.period;
    return `
    <div class="live-card" onclick="openMatchDetail('${g.id}')">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span class="live-badge"><span class="live-pulse"></span>AO VIVO</span>
        <span class="live-league">${g.flag} ${g.league}</span>
      </div>
      <div class="live-teams">
        <div class="live-team"><span class="live-team-logo">${teamBadge(g.home.name)}</span><span class="live-team-name">${g.home.name}</span></div>
        <div class="live-score"><span class="live-score-value">${g.home.score} — ${g.away.score}</span><span class="live-time">${time}</span></div>
        <div class="live-team"><span class="live-team-logo">${teamBadge(g.away.name)}</span><span class="live-team-name">${g.away.name}</span></div>
      </div>
      <div class="market-payout">◈ Retorno: ${ret}%</div>
      <div class="live-odds ${oddsArr.length===2?'two-col':''}">
        ${oddsArr.map(o => {
          const ip  = ((1/o.v)/book*100).toFixed(1);
          const sel = isSelected(g.id, o.l);
          return `<button class="odd-btn ${sel?'selected':''}"
            onclick="event.stopPropagation();toggleBet('${g.id}','${g.home.name} vs ${g.away.name}','${o.l}','Resultado',${o.v})">
            <span class="odd-label">${o.l}</span>
            <span class="odd-value">${fmtOdd(o.v)}</span>
            <span class="odd-pct">${ip}%</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
//  RENDER: UPCOMING TABLE
// ════════════════════════════════════════════
function renderMatchTable(filter='all') {
  if (!upcomingData.length) return;
  let games = filter==='all' ? upcomingData : upcomingData.filter(g=>g.filter===filter);
  games = applyHomeFilters(games);
  const el = document.getElementById('matchTable');

  if (!games.length) {
    el.innerHTML = `<div class="empty-filter">📅 Nenhum jogo agendado para este filtro.</div>`;
    return;
  }

  el.innerHTML = games.map(g => {
    const od  = [g.odds.h, g.odds.d, g.odds.a].filter(Boolean);
    const bk  = od.reduce((s,o)=>s+1/o, 0);
    const ret = (100/bk).toFixed(1);
    return `<div class="match-row">
      <div class="match-meta">
        <span class="match-league">${g.flag} ${g.league}</span>
        <span class="match-time">◷ ${g.time}</span>
        <span style="font-family:var(--font-hud);font-size:8px;color:rgba(0,255,157,.55);margin-top:2px;">↩ ${ret}%</span>
      </div>
      <div class="match-teams">
        <div class="match-team"><span class="match-team-logo">${teamBadge(g.home.name)}</span>${g.home.name}</div>
        <div class="match-team"><span class="match-team-logo">${teamBadge(g.away.name)}</span>${g.away.name}</div>
      </div>
      <div class="match-odds">
        ${[{l:'1',v:g.odds.h},{l:'X',v:g.odds.d},{l:'2',v:g.odds.a}].map(o => {
          if(!o.v) return '';
          const ip = ((1/o.v)/bk*100).toFixed(1);
          return `<button class="odd-btn ${isSelected(g.id,o.l)?'selected':''}"
            onclick="toggleBet('${g.id}','${g.home.name} vs ${g.away.name}','${o.l}','Resultado',${o.v})">
            <span class="odd-label">${o.l}</span>
            <span class="odd-value">${fmtOdd(o.v)}</span>
            <span class="odd-pct">${ip}%</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
//  RENDER: POPULAR
// ════════════════════════════════════════════
const POPULAR = [
  {id:'p1',match:'Flamengo vs Palmeiras',  market:'Resultado – Flamengo Vence',    odd:1.45},
  {id:'p2',match:'Real Madrid vs Man City',market:'Ambos Marcam – Sim',            odd:1.72},
  {id:'p3',match:'Corinthians vs SP',      market:'Total Gols – Acima 2.5',        odd:1.90},
  {id:'p4',match:'Barcelona vs Atletico',  market:'Barcelona + Acima 1.5 Gols',   odd:1.63},
  {id:'p5',match:'Fluminense vs Nacional', market:'Resultado – Fluminense Vence',  odd:1.60},
  {id:'p6',match:'Bayern vs Dortmund',     market:'Handicap Bayern -1',            odd:1.85},
];

function renderPopular() {
  document.getElementById('popularGrid').innerHTML = POPULAR.map((b,i)=>`
    <div class="popular-card" onclick="toggleBet('${b.id}','${b.match}','Seleção','${b.market}',${b.odd})">
      <div class="popular-rank">${String(i+1).padStart(2,'0')}</div>
      <div class="popular-info">
        <div class="popular-match">${b.match}</div>
        <div class="popular-market">${b.market}</div>
        <div style="font-family:var(--font-hud);font-size:8px;color:rgba(0,255,157,.5);margin-top:3px;">↩ ${((1/b.odd)*100).toFixed(1)}% implícito</div>
      </div>
      <div class="popular-odd ${isSelected(b.id,'Seleção')?'selected':''}">${fmtOdd(b.odd)}</div>
    </div>`).join('');
}

// ════════════════════════════════════════════
//  VIEW: AO VIVO
// ════════════════════════════════════════════
function renderLiveView() { renderLiveEventsList(); if(selectedMatch) renderMatchDetail(selectedMatch); }

function renderLiveEventsList() {
  const games = liveFilterSport==='all' ? liveGamesData : liveGamesData.filter(g=>g.sport===liveFilterSport);
  document.getElementById('liveEventsList').innerHTML = games.map(g => {
    const bk  = [g.odds.h, g.odds.d, g.odds.a].filter(Boolean).reduce((s,o)=>s+1/o, 0);
    const ret = (100/bk).toFixed(1);
    const time = g.minute ? g.minute+"'" : g.period;
    const oddsArr = g.odds.d
      ? [{l:'1',v:g.odds.h},{l:'X',v:g.odds.d},{l:'2',v:g.odds.a}]
      : [{l:'1',v:g.odds.h},{l:'2',v:g.odds.a}];
    return `
    <div class="live-event-item ${selectedMatch===g.id?'active-event':''}" onclick="openMatchDetail('${g.id}')">
      <div class="lei-header"><span class="lei-league">${g.flag} ${g.league}</span><span class="lei-time">${time}</span></div>
      <div class="lei-teams">
        <div class="lei-team"><span class="lei-team-logo">${teamBadge(g.home.name)}</span><span class="lei-team-name">${g.home.name}</span></div>
        <span class="lei-score">${g.home.score}–${g.away.score}</span>
        <div class="lei-team"><span class="lei-team-logo">${teamBadge(g.away.name)}</span><span class="lei-team-name">${g.away.name}</span></div>
      </div>
      <div style="font-family:var(--font-hud);font-size:7px;color:rgba(0,255,157,.45);text-align:right;margin-bottom:4px;">↩ ${ret}%</div>
      <div class="lei-quick-odds">
        ${oddsArr.map(o=>{
          const ip = ((1/o.v)/bk*100).toFixed(0);
          return `<div class="lei-odd ${isSelected(g.id,o.l)?'selected':''}"
            onclick="event.stopPropagation();toggleBet('${g.id}','${g.home.name} vs ${g.away.name}','${o.l}','Resultado',${o.v})">
            <span class="lei-odd-label">${o.l}</span>
            <span class="lei-odd-val">${fmtOdd(o.v)}</span>
            <span class="lei-odd-pct">${ip}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function openMatchDetail(id) {
  selectedMatch = id;
  currentMarket = 'principal';
  if (currentView !== 'live') navigate('live');
  else renderMatchDetail(id);
  renderLiveEventsList();
}

function renderMatchDetail(id) {
  const g = liveGamesData.find(x=>x.id===id);
  if (!g) return;
  const time = g.minute ? g.minute+"'" : g.period;
  const hasStats = g.stats && g.stats.possession;

  document.getElementById('liveMatchDetail').innerHTML = `
    <div class="match-scoreboard">
      <div class="msb-league"><span>${g.flag} ${g.league}</span><span class="msb-badge">● AO VIVO</span></div>
      <div class="msb-main">
        <div class="msb-team"><span class="msb-logo">${teamBadge(g.home.name)}</span><span class="msb-name">${g.home.name}</span></div>
        <div class="msb-center">
          <div class="msb-score" id="msb-score-${id}">${g.home.score} — ${g.away.score}</div>
          <div class="msb-time"  id="msb-time-${id}">${time}</div>
          <div class="msb-period">${g.period}</div>
        </div>
        <div class="msb-team"><span class="msb-logo">${teamBadge(g.away.name)}</span><span class="msb-name">${g.away.name}</span></div>
      </div>
    </div>

    ${hasStats ? buildStatsBar(g) : ''}

    <div class="match-events" id="match-events-${id}">
      ${(g.events||[]).map(ev=>`
        <div class="event-item">
          <span class="event-time">${ev.min!=null?ev.min+"'":''}</span>
          <span class="event-icon">${ev.icon}</span>
          <span class="event-desc">${ev.desc}<span class="event-team">${ev.team||''}</span></span>
        </div>`).join('') || '<div style="padding:8px 0;font-size:11px;color:rgba(234,234,234,.3)">Aguardando eventos...</div>'}
    </div>

    <div class="market-tabs">
      <button class="mkt-tab ${currentMarket==='principal'?'active':''}" onclick="switchMarket('${id}','principal')">PRINCIPAL</button>
      <button class="mkt-tab ${currentMarket==='gols'?'active':''}"      onclick="switchMarket('${id}','gols')">TOTAL GOLS</button>
      <button class="mkt-tab ${currentMarket==='handicap'?'active':''}"  onclick="switchMarket('${id}','handicap')">HANDICAP</button>
      <button class="mkt-tab ${currentMarket==='placar'?'active':''}"    onclick="switchMarket('${id}','placar')">PLACAR CORRETO</button>
      <button class="mkt-tab ${currentMarket==='ambos'?'active':''}"     onclick="switchMarket('${id}','ambos')">AMBOS MARCAM</button>
      <button class="mkt-tab ${currentMarket==='proximo'?'active':''}"   onclick="switchMarket('${id}','proximo')">PRÓXIMO GOL</button>
    </div>
    <div class="market-panels" id="market-panels-${id}">${buildMarkets(g)}</div>
  `;
}

function buildStatsBar(g) {
  const s = g.stats;
  if (!s) return '';
  const statsRows = [
    { name:'POSSE DE BOLA', h:s.possession[0], a:s.possession[1], unit:'%' },
    { name:'CHUTES',        h:s.shots[0],      a:s.shots[1],      unit:'' },
    { name:'NO ALVO',       h:s.shotsOn[0],    a:s.shotsOn[1],    unit:'' },
    { name:'ESCANTEIOS',    h:s.corners[0],    a:s.corners[1],    unit:'' },
    { name:'FALTAS',        h:s.fouls[0],      a:s.fouls[1],      unit:'' },
  ];
  return `
  <div class="match-stats">
    <div class="match-stats-title">◈ ESTATÍSTICAS DA PARTIDA</div>
    ${statsRows.map(row => {
      const total = row.h + row.a || 1;
      const hPct  = Math.round(row.h/total*100);
      const aPct  = 100 - hPct;
      return `<div class="stat-bar-row">
        <div class="stat-bar-labels">
          <span class="stat-bar-home">${row.h}${row.unit}</span>
          <span class="stat-bar-name">${row.name}</span>
          <span class="stat-bar-away">${row.a}${row.unit}</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill-h" style="width:${hPct}%"></div>
          <div class="stat-bar-fill-a" style="width:${aPct}%"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function switchMarket(id, market) {
  currentMarket = market;
  const g = liveGamesData.find(x=>x.id===id);
  if (!g) return;
  document.querySelectorAll('.mkt-tab').forEach(t => t.classList.toggle('active', t.getAttribute('onclick').includes(`'${market}'`)));
  document.getElementById(`market-panels-${id}`).innerHTML = buildMarkets(g);
}

function buildMarkets(g) {
  const mkt  = currentMarket;
  const home = g.home.name, away = g.away.name;
  const mkCell = (gid, label, val, pool) => {
    const bk   = pool.filter(Boolean).reduce((s,o)=>s+1/o, 0);
    const ip   = ((1/val)/bk*100).toFixed(1);
    const sel  = isSelected(gid, label);
    const arr  = Math.random()>.5 ? '<span class="oc-arrow up">▲</span>' : '<span class="oc-arrow down">▼</span>';
    return `<div class="odd-cell ${sel?'selected':''}" onclick="toggleBet('${gid}','${home} vs ${away}','${label}','Mercado',${val})">
      ${arr}<span class="oc-label">${label}</span><span class="oc-val">${fmtOdd(val)}</span><span class="oc-pct">${ip}%</span>
    </div>`;
  };

  if (mkt === 'principal') {
    if (!g.odds.d) {
      const od = [g.odds.h, g.odds.a];
      return `<div class="market-section">
        <div class="market-section-title">MONEYLINE<span class="market-return">↩ ${bookReturn(od)} retorno</span></div>
        <div class="odds-grid odds-grid-2">${mkCell(g.id,home+' Vence',g.odds.h,od)}${mkCell(g.id,away+' Vence',g.odds.a,od)}</div>
      </div>`;
    }
    const od = [g.odds.h, g.odds.d, g.odds.a];
    const dc = [nudge(1.15,.05), nudge(1.45,.05), nudge(2.20,.05)];
    const cs = [nudge(2.80,.1), nudge(3.60,.1)];
    return `
    <div class="market-section">
      <div class="market-section-title">RESULTADO FINAL (1X2)<span class="market-return">↩ ${bookReturn(od)} retorno</span></div>
      <div class="odds-grid odds-grid-3">${mkCell(g.id,home+' Vence',g.odds.h,od)}${mkCell(g.id,'Empate',g.odds.d,od)}${mkCell(g.id,away+' Vence',g.odds.a,od)}</div>
    </div>
    <div class="market-section">
      <div class="market-section-title">DUPLA CHANCE<span class="market-return">↩ ${bookReturn(dc)} retorno</span></div>
      <div class="odds-grid odds-grid-3">${mkCell(g.id+'dc','1X – '+home+' ou Empate',dc[0],dc)}${mkCell(g.id+'dc','12 – Sem Empate',dc[1],dc)}${mkCell(g.id+'dc','X2 – '+away+' ou Empate',dc[2],dc)}</div>
    </div>
    <div class="market-section">
      <div class="market-section-title">CLEAN SHEET</div>
      <div class="odds-grid odds-grid-2">${mkCell(g.id+'cs',home+' Clean Sheet',cs[0],cs)}${mkCell(g.id+'cs',away+' Clean Sheet',cs[1],cs)}</div>
    </div>`;
  }

  if (mkt === 'gols') {
    const ov = [nudge(1.35,.05),nudge(2.90,.1),nudge(1.80,.07),nudge(2.00,.07),nudge(2.90,.1),nudge(1.42,.05),nudge(4.50,.2),nudge(1.18,.03)];
    const ol = ['Acima 1.5','Abaixo 1.5','Acima 2.5','Abaixo 2.5','Acima 3.5','Abaixo 3.5','Acima 4.5','Abaixo 4.5'];
    return `<div class="market-section">
      <div class="market-section-title">TOTAL DE GOLS<span class="market-return">↩ ${bookReturn(ov.filter((_,i)=>i%2===0))} retorno</span></div>
      <div class="odds-grid odds-grid-2">${ol.map((l,i)=>mkCell(g.id+'ov',l,ov[i],ov.filter((_,j)=>j%2===i%2))).join('')}</div>
    </div>`;
  }

  if (mkt === 'handicap') {
    const hl = [home+' -1',away+' +1',home+' -2',away+' +2',home+' +1',away+' -1'];
    const hv = hl.map(()=>nudge(2.0,.3));
    return `<div class="market-section">
      <div class="market-section-title">HANDICAP EUROPEU<span class="market-return">↩ ${bookReturn(hv.filter((_,i)=>i%2===0))} retorno</span></div>
      <div class="odds-grid odds-grid-2">${hl.map((l,i)=>mkCell(g.id+'hcp',l,hv[i],hv.filter((_,j)=>j%2===i%2))).join('')}</div>
    </div>`;
  }

  if (mkt === 'placar') {
    const sl = ['1-0','2-0','2-1','3-0','0-0','1-1','2-2','0-1','0-2','1-2','3-1','Outro'];
    const sv = [5.5,8.0,7.0,14,6.5,5.8,16,9.0,13,10,18,9.0].map(v=>nudge(v,.5));
    return `<div class="market-section">
      <div class="market-section-title">PLACAR EXATO<span class="market-return">↩ ${bookReturn(sv)} retorno</span></div>
      <div class="odds-grid odds-grid-4">${sl.map((l,i)=>mkCell(g.id+'sc',l,sv[i],sv)).join('')}</div>
    </div>`;
  }

  if (mkt === 'ambos') {
    const sim = nudge(1.75,.07), nao = nudge(2.05,.08);
    return `<div class="market-section">
      <div class="market-section-title">AMBAS MARCAM<span class="market-return">↩ ${bookReturn([sim,nao])} retorno</span></div>
      <div class="odds-grid odds-grid-2">${mkCell(g.id+'btts','Sim',sim,[sim,nao])}${mkCell(g.id+'btts','Não',nao,[sim,nao])}</div>
    </div>`;
  }

  if (mkt === 'proximo') {
    const pv = [nudge(1.60,.07), nudge(2.40,.1), nudge(3.80,.2)];
    const pl = [home+' marca próximo', away+' marca próximo', 'Sem mais gols'];
    return `<div class="market-section">
      <div class="market-section-title">PRÓXIMO GOL<span class="market-return">↩ ${bookReturn(pv)} retorno</span></div>
      <div class="odds-grid odds-grid-3">${pl.map((l,i)=>mkCell(g.id+'ng',l,pv[i],pv)).join('')}</div>
    </div>`;
  }
  return '';
}

// Live sport tabs
document.getElementById('liveSportTabs').addEventListener('click', e => {
  const tab = e.target.closest('.lsp-tab');
  if (!tab) return;
  document.querySelectorAll('.lsp-tab').forEach(t=>t.classList.remove('active'));
  tab.classList.add('active');
  liveFilterSport = tab.dataset.sport;
  renderLiveEventsList();
});

// ════════════════════════════════════════════
//  BET SLIP
// ════════════════════════════════════════════
function toggleBet(gameId, matchName, label, market, odd) {
  const idx = betSlip.findIndex(b=>b.gameId===gameId && b.label===label);
  if (idx > -1) {
    betSlip.splice(idx, 1);
    showToast('◈ Seleção removida');
  } else {
    betSlip = betSlip.filter(b=>b.gameId!==gameId);
    betSlip.push({ gameId, matchName, label, market, odd });
    showToast(`⚡ ${label} adicionado! (${fmtOdd(odd)})`);
  }
  renderBetSlip();
  renderAllCards();
  renderMatchTable(currentFilter);
  renderPopular();
  if (currentView==='live') { renderLiveEventsList(); if(selectedMatch) renderMatchDetail(selectedMatch); }
  updateBetCount();
}

function renderBetSlip() {
  const empty  = document.getElementById('betslipEmpty');
  const items  = document.getElementById('betslipItems');
  const footer = document.getElementById('betslipFooter');
  if (!betSlip.length) { empty.style.display='flex'; items.innerHTML=''; footer.style.display='none'; return; }
  empty.style.display = 'none'; footer.style.display = 'block';
  items.innerHTML = betSlip.map((b,i)=>`
    <div class="bet-item">
      <button class="bet-item-remove" onclick="removeBet(${i})">✕</button>
      <div class="bet-item-match">${b.matchName}</div>
      <div class="bet-item-selection">${b.label}</div>
      <div class="bet-item-market">${b.market}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="bet-item-odd">${fmtOdd(b.odd)}</div>
        <div style="font-family:var(--font-hud);font-size:9px;color:rgba(0,255,157,.6);">${pct(b.odd)}</div>
      </div>
    </div>`).join('');
  calcPotential();
}

function removeBet(i) {
  betSlip.splice(i, 1);
  renderBetSlip(); renderAllCards(); renderMatchTable(currentFilter); renderPopular();
  if (currentView==='live') { renderLiveEventsList(); if(selectedMatch) renderMatchDetail(selectedMatch); }
  updateBetCount();
}

function updateBetCount() {
  const b = document.getElementById('betCountBadge');
  b.textContent = betSlip.length; b.style.display = betSlip.length ? 'inline' : 'none';
}

function calcPotential() {
  const stake = parseFloat(document.getElementById('stakeInput').value) || 0;
  const tot   = betSlip.reduce((a,b)=>a*b.odd, 1);
  document.getElementById('winValue').textContent = fmt(stake * tot);
  document.getElementById('payoutInfo').textContent = betSlip.length>1
    ? `Odd combinada: ${fmtOdd(tot)}` : betSlip.length ? `Retorno implícito: ${pct(betSlip[0].odd)}` : '';
}

document.getElementById('stakeInput').addEventListener('input', calcPotential);

document.querySelectorAll('.stake-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stake-preset').forEach(b=>b.classList.remove('active-preset'));
    btn.classList.add('active-preset');
    document.getElementById('stakeInput').value = btn.dataset.val;
    calcPotential();
  });
});

document.getElementById('clearBets').addEventListener('click', () => {
  betSlip = []; renderBetSlip(); renderAllCards(); renderMatchTable(currentFilter); renderPopular();
  if(currentView==='live'&&selectedMatch) renderMatchDetail(selectedMatch);
  updateBetCount(); showToast('◈ Cupom limpo');
});

document.getElementById('placeBetBtn').addEventListener('click', async () => {
  if (!currentUser) { showToast('⚡ Faça login para apostar'); openModal('loginModal'); return; }
  const stake = parseFloat(document.getElementById('stakeInput').value);
  if (!stake || stake < 1) { showToast('Digite um valor mínimo de R$ 1,00'); return; }

  const btn = document.getElementById('placeBetBtn');
  btn.disabled = true;
  const res = await api.post('/api/bets/place', { selections: betSlip, stake });
  btn.disabled = false;

  if (res.error) { showToast('❌ ' + res.error); return; }

  const tot = betSlip.reduce((a,b)=>a*b.odd, 1);
  updateBalance(res.newBalance);
  document.getElementById('betConfirmText').innerHTML =
    `Aposta de <strong>${fmt(stake)}</strong> realizada!<br>
     Odd: <strong style="color:var(--neon-gold)">${fmtOdd(tot)}</strong><br>
     Potencial: <strong style="color:var(--neon-green)">${fmt(res.potential)}</strong>`;
  openModal('betModal');

  betSlip = []; document.getElementById('stakeInput').value = '';
  document.querySelectorAll('.stake-preset').forEach(b=>b.classList.remove('active-preset'));
  renderBetSlip(); renderAllCards(); renderMatchTable(currentFilter); renderPopular();
  if(currentView==='live'&&selectedMatch) renderMatchDetail(selectedMatch);
  updateBetCount();
});

// Filter tabs
document.getElementById('filterTabs').addEventListener('click', e => {
  const tab = e.target.closest('.filter-tab');
  if (!tab || !tab.dataset.filter) return;
  document.querySelectorAll('#filterTabs .filter-tab').forEach(t=>t.classList.remove('active'));
  tab.classList.add('active');
  currentFilter = tab.dataset.filter;
  renderMatchTable(currentFilter);
});

// Barra lateral – filtro por esporte
document.querySelectorAll('.sport-item').forEach(item => item.addEventListener('click', () => {
  document.querySelectorAll('.sport-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  homeSport  = item.dataset.sport || 'all';
  homeLeague = 'all';   // limpa filtro de liga ao trocar de esporte
  document.querySelectorAll('.league-item').forEach(i => i.classList.remove('active-league'));
  if (currentView !== 'home') navigate('home');
  refreshHome();
  showToast(`◈ ${SPORT_LABELS[homeSport] || 'Todos'}`);
}));

// Barra lateral – filtro por liga
document.querySelectorAll('.league-item').forEach(item => item.addEventListener('click', () => {
  document.querySelectorAll('.league-item').forEach(i => i.classList.remove('active-league'));
  item.classList.add('active-league');
  homeLeague = item.dataset.league || 'all';
  if (currentView !== 'home') navigate('home');
  refreshHome();
  showToast(`◈ ${item.textContent.trim()}`);
  document.getElementById('sidebarLeft').classList.remove('open'); // fecha menu no mobile
}));

// Re-renderiza as seções da home aplicando os filtros atuais.
function refreshHome() {
  renderLiveCards();
  renderMatchTable(currentFilter);
  document.getElementById('liveCards')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Bet slip tabs
document.querySelectorAll('.bstab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.bstab').forEach(t=>t.classList.remove('active'));
  tab.classList.add('active');
}));

// ════════════════════════════════════════════
//  VIEW: MINHAS APOSTAS
// ════════════════════════════════════════════
async function renderMyBets() {
  if (!currentUser) return;
  const detail = document.getElementById('mybetsList');
  const statsEl = document.getElementById('mybetsStats');
  detail.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>CARREGANDO APOSTAS...</p></div>';

  const [histData, statsData] = await Promise.all([
    api.get(`/api/bets/history?status=${betHistoryFilter==='all'?'':betHistoryFilter}&limit=50`),
    api.get('/api/bets/stats'),
  ]);

  if (statsData && !statsData.error) {
    statsEl.innerHTML = `
      <div class="mybet-stat-card"><span class="stat-val neon-blue">${statsData.total}</span><span class="stat-lbl">TOTAL</span></div>
      <div class="mybet-stat-card"><span class="stat-val neon-green">${statsData.won}</span><span class="stat-lbl">GANHAS</span></div>
      <div class="mybet-stat-card"><span class="stat-val neon-red">${statsData.lost}</span><span class="stat-lbl">PERDIDAS</span></div>
      <div class="mybet-stat-card"><span class="stat-val neon-blue">${statsData.pending}</span><span class="stat-lbl">EM ABERTO</span></div>
      <div class="mybet-stat-card"><span class="stat-val neon-gold">${statsData.winRate}%</span><span class="stat-lbl">WIN RATE</span></div>
      <div class="mybet-stat-card"><span class="stat-val neon-purple">${fmt(statsData.gained)}</span><span class="stat-lbl">TOTAL GANHO</span></div>
    `;
  }

  if (!histData.bets?.length) {
    detail.innerHTML = `<div class="mybets-empty"><div class="mybets-empty-icon">🎟️</div><p>Nenhuma aposta encontrada</p></div>`;
    return;
  }

  detail.innerHTML = histData.bets.map(b => {
    const statusLabels = { pending:'EM ABERTO', won:'GANHA', lost:'PERDIDA', cashout:'CASH-OUT' };
    const potLabel = b.status==='won' ? fmt(b.potential) : b.status==='cashout' ? fmt(b.cashout_val) : fmt(b.potential);
    const potColor = b.status==='won'||b.status==='cashout' ? 'neon-green' : b.status==='lost' ? 'neon-red' : 'neon-blue';
    return `
    <div class="mybet-card status-${b.status}">
      <div class="mybet-header">
        <div>
          <div class="mybet-match">${b.match_name}</div>
          <div class="mybet-time">${timeAgo(b.created_at)}</div>
        </div>
        <span class="status-badge ${b.status}">${statusLabels[b.status]||b.status}</span>
      </div>
      <div class="mybet-selection">${b.market} → <strong>${b.selection}</strong></div>
      <div class="mybet-footer">
        <span class="mybet-odd">@${fmtOdd(b.odd)}</span>
        <span class="mybet-stake">Apostado: ${fmt(b.stake)}</span>
        <span class="mybet-pot ${potColor}">${b.status==='won'?'✅ Ganho:':b.status==='cashout'?'💰 Cash-out:':'Potencial:'} ${potLabel}</span>
        ${b.status==='pending' ? `<button class="btn-cashout" onclick="doCashout(${b.id})">CASH-OUT</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function doCashout(betId) {
  const res = await api.post(`/api/bets/cashout/${betId}`, {});
  if (res.error) { showToast('❌ ' + res.error); return; }
  updateBalance(res.newBalance);
  showToast(`💰 Cash-out realizado! ${fmt(res.cashoutVal)} creditado`);
  renderMyBets();
}

// Bet history filters
document.querySelectorAll('.mybets-filters .filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mybets-filters .filter-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    betHistoryFilter = btn.dataset.betfilter || 'all';
    renderMyBets();
  });
});

// ════════════════════════════════════════════
//  VIEW: VIP
// ════════════════════════════════════════════
async function renderVip() {
  if (!currentUser) return;
  const el = document.getElementById('vipContent');
  el.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>CARREGANDO...</p></div>';
  const data = await api.get('/api/vip/info');
  if (!data.current) { el.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(234,234,234,.3)">Erro ao carregar VIP</div>'; return; }

  const icons = ['🥉','🥈','🥇','⚪','💎'];
  const colors = ['#cd7f32','#c0c0c0','#ffd700','#e5e4e2','#b9f2ff'];
  const lvl     = data.vip_level;
  const cur     = data.current;
  const next    = data.next;
  const pts     = data.vip_points;
  const ptsToNext = next ? next.minPoints - pts : 0;
  const progress  = next ? Math.min(100, ((pts - cur.minPoints) / (next.minPoints - cur.minPoints)) * 100) : 100;

  el.innerHTML = `
    <div class="vip-hero">
      <span class="vip-level-icon">${icons[lvl-1]}</span>
      <div class="vip-level-name" style="color:${colors[lvl-1]}">${cur.name}</div>
      <div class="vip-points-info">${pts.toLocaleString()} pontos VIP${next ? ` · ${ptsToNext.toLocaleString()} para ${next.name}` : ' · Nível máximo!'}</div>
      ${next ? `<div class="vip-progress-wrap">
        <div class="vip-progress-bar"><div class="vip-progress-fill" style="width:${progress}%"></div></div>
        <div class="vip-progress-labels"><span>${cur.name}</span><span>${next.name}</span></div>
      </div>` : ''}
    </div>

    <div class="vip-perks">
      <div class="vip-perk"><span class="vip-perk-icon">💰</span><div class="vip-perk-title">CASHBACK</div><div class="vip-perk-val">${cur.cashback}% semanal</div></div>
      <div class="vip-perk"><span class="vip-perk-icon">📈</span><div class="vip-perk-title">BÔNUS DE ODDS</div><div class="vip-perk-val">+${cur.oddBonus}% nas odds</div></div>
      <div class="vip-perk"><span class="vip-perk-icon">⚡</span><div class="vip-perk-title">SAQUE RÁPIDO</div><div class="vip-perk-val">${lvl>=3?'Prioritário':'Padrão'}</div></div>
      <div class="vip-perk"><span class="vip-perk-icon">🎁</span><div class="vip-perk-title">FREEBETS</div><div class="vip-perk-val">${lvl>=2?'R$ '+lvl*10+'/semana':'Não disponível'}</div></div>
      <div class="vip-perk"><span class="vip-perk-icon">📞</span><div class="vip-perk-title">SUPORTE</div><div class="vip-perk-val">${lvl>=4?'Gerente VIP':lvl>=2?'Prioritário':'Padrão'}</div></div>
      <div class="vip-perk"><span class="vip-perk-icon">🏆</span><div class="vip-perk-title">TORNEIOS</div><div class="vip-perk-val">${lvl>=3?'Acesso exclusivo':'Abertos'}</div></div>
    </div>

    <div class="vip-levels-table">
      <div class="vlt-header">
        <span>NÍVEL</span><span>PONTOS</span><span>CASHBACK</span><span>BÔNUS ODDS</span><span>FREEBETS</span>
      </div>
      ${data.levels.map(l=>`
      <div class="vlt-row ${l.level===lvl?'current-level':''}">
        <span class="level-name" style="color:${colors[l.level-1]}">${icons[l.level-1]} ${l.name}</span>
        <span>${l.minPoints.toLocaleString()}${l.maxPoints?'–'+l.maxPoints.toLocaleString():'+'}pts</span>
        <span>${l.cashback}%</span>
        <span>+${l.oddBonus}%</span>
        <span>R$ ${l.level*10}/sem</span>
      </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════
//  VIEW: AFILIADOS
// ════════════════════════════════════════════
function renderAfiliados() {
  const code = currentUser ? 'ARENA' + currentUser.id.toString().padStart(5,'0') : 'ARENA00000';
  document.getElementById('afiliadosContent').innerHTML = `
    <div class="afil-hero">
      <h2>GANHE COMISSÃO</h2>
      <span class="afil-commission">30% de comissão</span>
      <p>Indique amigos para a ArenaBet e ganhe 30% da receita gerada por cada apostador indicado, para sempre.</p>
      ${!currentUser ? `<button class="btn-submit" style="max-width:200px;margin:16px auto 0;" onclick="openModal('registerModal')">CRIAR CONTA GRÁTIS</button>` : ''}
    </div>

    <div class="afil-stats">
      <div class="afil-stat"><strong>0</strong><span>Indicados</span></div>
      <div class="afil-stat"><strong>R$ 0,00</strong><span>Comissão Total</span></div>
      <div class="afil-stat"><strong>R$ 0,00</strong><span>Este Mês</span></div>
      <div class="afil-stat"><strong>30%</strong><span>Minha Taxa</span></div>
    </div>

    ${currentUser ? `
    <div class="afil-link-box">
      <label>SEU LINK DE AFILIADO</label>
      <div class="afil-link-row">
        <input type="text" value="https://arenabet.com.br/r/${code}" readonly/>
        <button class="copy-btn" onclick="copyText('https://arenabet.com.br/r/${code}','Link copiado!')">COPIAR</button>
      </div>
    </div>` : ''}

    <div class="afil-how">
      <h3>◈ COMO FUNCIONA</h3>
      <div class="afil-step">
        <span class="afil-step-num">01</span>
        <div class="afil-step-info"><strong>Compartilhe seu link</strong><p>Envie seu link único para amigos, redes sociais ou canais.</p></div>
      </div>
      <div class="afil-step">
        <span class="afil-step-num">02</span>
        <div class="afil-step-info"><strong>Eles se registram</strong><p>Novos usuários que criarem conta pelo seu link ficam vinculados a você.</p></div>
      </div>
      <div class="afil-step">
        <span class="afil-step-num">03</span>
        <div class="afil-step-info"><strong>Você recebe comissão</strong><p>30% da margem da casa em cada aposta feita pelos seus indicados, para sempre.</p></div>
      </div>
      <div class="afil-step">
        <span class="afil-step-num">04</span>
        <div class="afil-step-info"><strong>Saque quando quiser</strong><p>Saldo de comissão disponível para saque via PIX a qualquer momento.</p></div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════
//  VIEW: PERFIL
// ════════════════════════════════════════════
async function renderPerfil() {
  if (!currentUser) return;
  const el = document.getElementById('perfilContent');
  el.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>CARREGANDO...</p></div>';

  const [user, txData] = await Promise.all([
    api.get('/api/auth/me'),
    api.get('/api/user/transactions'),
  ]);

  const vipNames  = ['','Bronze','Prata','Ouro','Platina','Diamante'];
  const vipColors = ['','#cd7f32','#c0c0c0','#ffd700','#e5e4e2','#b9f2ff'];

  el.innerHTML = `
    <div class="perfil-section" style="text-align:center;">
      <div class="perfil-avatar">👤</div>
      <div class="perfil-name">${user.name} ${user.last_name||''}</div>
      <div class="perfil-email">${user.email}</div>
      <span class="perfil-vip-badge" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:${vipColors[user.vip_level]};">
        ${vipNames[user.vip_level]} · ${user.vip_points} pts
      </span>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;">
        <button class="btn-cashout" onclick="openModal('depositModal')">+ DEPOSITAR</button>
        <button class="btn-cashout" onclick="openModal('withdrawModal')">SACAR</button>
      </div>
    </div>

    <div class="perfil-section">
      <div class="perfil-section-title">◈ INFORMAÇÕES DA CONTA</div>
      <div class="form-row-2">
        <div class="form-group"><label>NOME</label><input type="text" id="pName" value="${user.name}" /></div>
        <div class="form-group"><label>SOBRENOME</label><input type="text" id="pLast" value="${user.last_name||''}" /></div>
      </div>
      <div class="form-group"><label>E-MAIL</label><input type="email" value="${user.email}" readonly style="opacity:.5;" /></div>
      <div class="form-group"><label>MEMBRO DESDE</label><input type="text" value="${new Date(user.created_at).toLocaleDateString('pt-BR')}" readonly style="opacity:.5;" /></div>
      <button class="btn-submit" style="margin-top:8px;" onclick="saveProfile()">SALVAR ALTERAÇÕES</button>
    </div>

    <div class="perfil-section">
      <div class="perfil-section-title">◈ ALTERAR SENHA</div>
      <div class="form-group"><label>SENHA ATUAL</label><input type="password" id="pCurrPass" placeholder="••••••••" /></div>
      <div class="form-group"><label>NOVA SENHA</label><input type="password" id="pNewPass" placeholder="••••••••" /></div>
      <button class="btn-submit" style="margin-top:4px;" onclick="changePassword()">ALTERAR SENHA</button>
    </div>

    <div class="perfil-section">
      <div class="perfil-section-title">◈ HISTÓRICO DE TRANSAÇÕES</div>
      <div class="perfil-transactions">
        ${!txData.length ? '<div style="text-align:center;padding:20px;color:rgba(234,234,234,.3);font-size:12px;">Nenhuma transação ainda</div>' :
          txData.map(tx=>`
          <div class="tx-item">
            <span class="tx-icon">${tx.type==='deposit'?'📥':'📤'}</span>
            <div class="tx-info">
              <div class="tx-type">${tx.type==='deposit'?'Depósito':'Saque'}</div>
              <div class="tx-method">${tx.method.toUpperCase()}</div>
            </div>
            <span class="tx-time">${timeAgo(tx.created_at)}</span>
            <span class="tx-amount ${tx.type==='deposit'?'tx-deposit':'tx-withdraw'}">${tx.type==='deposit'?'+':'-'}${fmt(tx.amount)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

async function saveProfile() {
  const res = await api.put('/api/user/profile', {
    name: document.getElementById('pName').value,
    last_name: document.getElementById('pLast').value,
  });
  if (res.success) { showToast('✅ Perfil atualizado!'); }
}

async function changePassword() {
  const curr = document.getElementById('pCurrPass').value;
  const np   = document.getElementById('pNewPass').value;
  if (!curr || !np) { showToast('Preencha os campos de senha'); return; }
  const res = await api.put('/api/user/password', { current: curr, newPass: np });
  if (res.error) { showToast('❌ ' + res.error); return; }
  showToast('✅ Senha alterada com sucesso!');
  document.getElementById('pCurrPass').value = '';
  document.getElementById('pNewPass').value  = '';
}

// ════════════════════════════════════════════
//  VIEW: CASINO, PROMO, VIRTUAL, ESPORTS
// ════════════════════════════════════════════
// RTPs exibidos batem com a margem atual da casa (fase inicial agressiva).
const CASINO_GAMES = [
  {icon:'🎯',name:'Aviator',            type:'Crash · Spribe',       rtp:'55%',live:false,game:'crash'},
  {icon:'🃏',name:'Lightning Roulette', type:'Roleta · Evolution',   rtp:'56%',live:true, game:'roleta'},
  {icon:'🎰',name:'Gates of Olympus',  type:'Slot · Pragmatic',     rtp:'68%',live:false,game:'slots'},
  {icon:'🐉',name:'Dragon Tiger',       type:'Cassino · Evolution',  rtp:'63%',live:true, game:'double'},
  {icon:'🍀',name:'Sweet Bonanza',      type:'Slot · Pragmatic',     rtp:'68%',live:false,game:'slots'},
  {icon:'🎡',name:'Crazy Time',         type:'Game Show · Evolution',rtp:'56%',live:true, game:'roleta'},
  {icon:'🌙',name:'Starlight Princess', type:'Slot · Pragmatic',     rtp:'68%',live:false,game:'slots'},
  {icon:'🎲',name:'Blackjack VIP',      type:'Blackjack · Evolution',rtp:'63%',live:true, game:'double'},
  {icon:'🃏',name:'Baccarat Ao Vivo',   type:'Bacará · Evolution',   rtp:'63%',live:true, game:'double'},
  {icon:'🎡',name:'Monopoly Live',      type:'Game Show · Evolution',rtp:'56%',live:true, game:'roleta'},
  {icon:'🔥',name:'The Dog House',      type:'Slot · Pragmatic',     rtp:'68%',live:false,game:'slots'},
  {icon:'⚡',name:'Money Train 3',      type:'Slot · Relax Gaming',  rtp:'68%',live:false,game:'slots'},
];
function renderCasino() {
  document.getElementById('casinoGrid').innerHTML = CASINO_GAMES.map((g,i)=>`
    <div class="casino-card" onclick="openCasinoGame(${i})">
      <div class="casino-thumb">${g.icon}</div>
      <div class="casino-info">
        <div class="casino-name">${g.name}${g.live?'<span class="casino-live-badge">LIVE</span>':''}</div>
        <div class="casino-type">${g.type}</div>
        <div class="casino-rtp">RTP: ${g.rtp}</div>
      </div>
      <div class="casino-play">▶ JOGAR</div>
    </div>`).join('');
}

const PROMOS = [
  {icon:'🎁',title:'BÔNUS DE BOAS-VINDAS', val:'100% até R$ 500',  desc:'Dobre seu primeiro depósito. Rollover 5x com odds ≥ 1.50.'},
  {icon:'💰',title:'CASHBACK SEMANAL',      val:'10% toda semana',  desc:'10% de volta em perdas semanais, creditado toda segunda-feira.'},
  {icon:'⚽',title:'SUPER ODDS',            val:'Odds turbinadas',  desc:'Um jogo por dia com odds especialmente aumentadas.'},
  {icon:'🏆',title:'ACUMULADOR PREMIADO',   val:'Bônus até 100%',   desc:'Múltiplas com 3+ seleções recebem bônus progressivo.'},
  {icon:'⚡',title:'FREEBET SEMANAL',       val:'R$ 20 grátis',     desc:'Faça 5 apostas de R$ 20+ e ganhe freebet de R$ 20.'},
  {icon:'🎮',title:'PROMO E-SPORTS',        val:'Odds +15%',        desc:'CS2, Dota 2 e LoL com 15% acima da média do mercado.'},
];
function renderPromo() {
  document.getElementById('promoGrid').innerHTML = PROMOS.map(p=>`
    <div class="promo-card">
      <div class="promo-card-header">
        <span class="promo-card-icon">${p.icon}</span>
        <div class="promo-card-title">${p.title}</div>
        <div class="promo-card-val">${p.val}</div>
      </div>
      <div class="promo-card-body">
        <p>${p.desc}</p>
        <span class="promo-card-cta" onclick="${currentUser?'showToast(\"✅ Promoção ativada!\")':'openModal(\"registerModal\")'}">RESGATAR →</span>
      </div>
    </div>`).join('');
}

const VIRTUAL_SPORTS = [
  {icon:'⚽',name:'Futebol Virtual',    next:'Próxima: 2min'},
  {icon:'🐎',name:'Corrida de Cavalos', next:'Próxima: 45s'},
  {icon:'🐕',name:'Corrida de Galgos',  next:'Próxima: 1min'},
  {icon:'🏎️',name:'Fórmula Virtual',    next:'Próxima: 3min'},
  {icon:'🏀',name:'Basquete Virtual',   next:'Próximo: 5min'},
  {icon:'🎾',name:'Tênis Virtual',      next:'Próximo: 2min'},
];
function renderVirtual() {
  document.getElementById('virtualGrid').innerHTML = VIRTUAL_SPORTS.map(v=>`
    <div class="virtual-card">
      <span class="virtual-icon">${v.icon}</span>
      <div class="virtual-name">${v.name}</div>
      <div class="virtual-next">⏱ ${v.next}</div>
      <div class="virtual-odds">
        ${[nudge(2.1,.1),nudge(3.2,.12),nudge(3.4,.15)].map((o,i)=>`
          <button class="odd-btn" style="min-width:52px;" onclick="toggleBet('virt_${i}','${v.name}','Opção ${i+1}','Virtual',${o})">
            <span class="odd-label">${i+1}</span><span class="odd-value">${fmtOdd(o)}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function renderEsports() {
  const games = liveGamesData.filter(g=>g.sport==='esports');
  document.getElementById('esportsCards').innerHTML = games.length
    ? games.map(g=>{
      const od = [g.odds.h, g.odds.a];
      const bk = od.reduce((s,o)=>s+1/o,0);
      return `<div class="live-card" onclick="openMatchDetail('${g.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span class="live-badge"><span class="live-pulse"></span>AO VIVO</span>
          <span class="live-league">${g.flag} ${g.league}</span>
        </div>
        <div class="live-teams">
          <div class="live-team"><span class="live-team-logo">${teamBadge(g.home.name)}</span><span class="live-team-name">${g.home.name}</span></div>
          <div class="live-score"><span class="live-score-value">${g.home.score}–${g.away.score}</span><span class="live-time">${g.period}</span></div>
          <div class="live-team"><span class="live-team-logo">${teamBadge(g.away.name)}</span><span class="live-team-name">${g.away.name}</span></div>
        </div>
        <div class="market-payout">↩ ${(100/bk).toFixed(1)}% retorno</div>
        <div class="live-odds two-col">
          ${od.map((v,i)=>`<button class="odd-btn ${isSelected(g.id,String(i+1))?'selected':''}"
            onclick="event.stopPropagation();toggleBet('${g.id}','${g.home.name} vs ${g.away.name}','${i+1}','Moneyline',${v})">
            <span class="odd-label">${i+1}</span><span class="odd-value">${fmtOdd(v)}</span>
            <span class="odd-pct">${((1/v)/bk*100).toFixed(1)}%</span>
          </button>`).join('')}
        </div>
      </div>`;
    }).join('')
    : '<div style="padding:40px;text-align:center;color:rgba(234,234,234,.3);font-family:var(--font-hud);font-size:11px;letter-spacing:2px;">CARREGANDO EVENTOS E-SPORTS...</div>';
}

// ════════════════════════════════════════════
//  DEPOSIT MODAL
// ════════════════════════════════════════════
function openDeposit() {
  if (!currentUser) { openModal('loginModal'); return; }
  openModal('depositModal');
}
document.getElementById('btnDeposit').addEventListener('click', openDeposit);

document.getElementById('paymentMethods').addEventListener('click', e => {
  const btn = e.target.closest('.pay-method');
  if (!btn) return;
  document.querySelectorAll('.pay-method').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.pay-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById('panel-'+btn.dataset.method);
  if (panel) panel.classList.add('active');
});

document.querySelectorAll('.pay-amount-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.closest('.pay-panel-inner');
    parent.querySelectorAll('.pay-amount-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const inp = parent.querySelector('input[type="number"]');
    if (inp) inp.value = btn.dataset.amount;
  });
});

document.querySelectorAll('.crypto-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.crypto-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}));

// PIX QR
document.getElementById('pixConfirmBtn').addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('pixAmount').value) || 50;
  if (val < 10) { showToast('Valor mínimo: R$ 10'); return; }
  generatePixQR();
  document.getElementById('pixQr').style.display = 'block';
  document.getElementById('pixConfirmBtn').style.display = 'none';
  startPixTimer();
  if (currentUser) {
    const res = await api.post('/api/user/deposit', { method:'pix', amount:val });
    if (res.newBalance) {
      updateBalance(res.newBalance);
      showToast(`✅ Depósito de ${fmt(val)} confirmado!`);
    }
  }
});

// Other deposit buttons
['card','boleto','crypto','picpay','bank'].forEach(m => {
  const btn = document.getElementById(m+'ConfirmBtn');
  if (btn) btn.addEventListener('click', async () => {
    const inp = document.getElementById(m+'Amount') || document.getElementById('pixAmount');
    const val = inp ? parseFloat(inp.value) || 100 : 100;
    if (currentUser) {
      const res = await api.post('/api/user/deposit', { method:m, amount:val });
      if (res.newBalance) { updateBalance(res.newBalance); showToast(`✅ Depósito de ${fmt(val)} processado!`); closeModal('depositModal'); }
    }
  });
});

function generatePixQR() {
  const grid = document.getElementById('qrGrid');
  grid.innerHTML = '';
  for (let i=0; i<441; i++) {
    const cell = document.createElement('div');
    const r=Math.floor(i/21), c=i%21;
    const black = (r<7&&c<7)||(r<7&&c>13)||(r>13&&c<7)||((r>1&&r<5)&&(c>1&&c<5))||((r>1&&r<5)&&(c>14&&c<18))||((r>14&&r<18)&&(c>1&&c<5))||((r+c+r*c)%3===0);
    cell.className='qr-cell '+(black?'qr-black':'qr-white');
    grid.appendChild(cell);
  }
}

function startPixTimer() {
  clearInterval(pixTimerInterval);
  let secs = 899;
  pixTimerInterval = setInterval(() => {
    const el = document.getElementById('pixTimerVal');
    if (!el) { clearInterval(pixTimerInterval); return; }
    const m=Math.floor(secs/60), s=secs%60;
    el.textContent = m+':'+(s<10?'0':'')+s;
    if (--secs < 0) clearInterval(pixTimerInterval);
  }, 1000);
}

document.getElementById('copyPix').addEventListener('click', () => {
  const code = document.getElementById('pixCode').textContent;
  navigator.clipboard.writeText(code).catch(()=>{});
  showToast('✅ Código PIX copiado!');
  document.getElementById('copyPix').textContent = '✓ COPIADO';
  setTimeout(()=>{ const b=document.getElementById('copyPix'); if(b) b.textContent='COPIAR'; },2000);
});

// ════════════════════════════════════════════
//  WITHDRAW MODAL
// ════════════════════════════════════════════
document.getElementById('withdrawLink').addEventListener('click', e => { e.preventDefault(); if (!currentUser){openModal('loginModal');return;} openModal('withdrawModal'); });

document.getElementById('withdrawConfirmBtn').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const method = document.getElementById('withdrawMethod').value;
  if (!amount || amount < 20) { showToast('Valor mínimo: R$ 20'); return; }
  const res = await api.post('/api/user/withdraw', { method, amount });
  if (res.error) { showToast('❌ ' + res.error); return; }
  updateBalance(res.newBalance);
  showToast(`✅ Saque de ${fmt(amount)} solicitado! Em processamento.`);
  closeModal('withdrawModal');
  document.getElementById('withdrawAmount').value = '';
});

// ════════════════════════════════════════════
//  SEARCH
// ════════════════════════════════════════════
document.getElementById('searchBtn').addEventListener('click', () => openModal('searchModal'));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); openModal('searchModal'); setTimeout(()=>document.getElementById('searchInput').focus(),100); }
  if (e.key==='Escape') { closeModal('searchModal'); closeModal('loginModal'); closeModal('registerModal'); }
});

document.getElementById('searchInput').addEventListener('input', async function() {
  const q = this.value.trim();
  const res = document.getElementById('searchResults');
  if (q.length < 2) { res.innerHTML='<div class="search-hint">Digite para buscar jogos, times ou ligas</div>'; return; }

  const data = await api.get('/api/search?q='+encodeURIComponent(q));
  if (!data.length) { res.innerHTML='<div class="search-hint">Nenhum resultado para "'+q+'"</div>'; return; }

  res.innerHTML = data.map(r=>`
    <div class="search-result-item" onclick="closeModal('searchModal');openMatchDetail('${r.id}');">
      <span class="sri-icon">🔴</span>
      <div class="sri-info">
        <div class="sri-label">${r.label}</div>
        <div class="sri-sub">${r.sub}</div>
      </div>
      ${r.score ? `<span class="sri-score">${r.score}</span>` : ''}
    </div>`).join('');
});

// ════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════
function copyText(text, msg) {
  navigator.clipboard.writeText(text).catch(()=>{});
  showToast(msg || '✅ Copiado!');
}

// CPF mask
document.getElementById('regCpf').addEventListener('input', function() {
  let v = this.value.replace(/\D/g,'').slice(0,11);
  if(v.length>9)      v=v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  else if(v.length>6) v=v.replace(/(\d{3})(\d{3})(\d{3})/,'$1.$2.$3');
  else if(v.length>3) v=v.replace(/(\d{3})(\d{3})/,'$1.$2');
  this.value=v;
});
document.getElementById('cardNumber')?.addEventListener('input', function() {
  this.value = this.value.replace(/\D/g,'').slice(0,16).replace(/(\d{4})/g,'$1 ').trim();
});
document.getElementById('cardExpiry')?.addEventListener('input', function() {
  let v=this.value.replace(/\D/g,'').slice(0,4);
  if(v.length>2) v=v.slice(0,2)+'/'+v.slice(2);
  this.value=v;
});

// Mobile menu
document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebarLeft').classList.toggle('open'));

// ════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════
async function init() {
  await Promise.all([fetchLiveOdds(), fetchUpcoming()]);
  renderAllCards();
  renderMatchTable();
  renderPopular();
  navigate('home');
  await autoLogin();
}

init();

// ════════════════════════════════════════════
//  🔊 SOUND ENGINE (Web Audio API — sem arquivos)
// ════════════════════════════════════════════
let audioCtx  = null;
let soundMuted = localStorage.getItem('arenaMuted') === 'true';

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTick() {
  if (soundMuted) return;
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.06);
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    o.start(); o.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

function playGoalSound() {
  if (soundMuted) return;
  try {
    const ctx = getAudioCtx();
    // Crowd roar: burst of noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i/data.length, 0.6);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 400; filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start();

    // Celebração: acorde
    [523, 659, 784, 1047].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g2 = ctx.createGain();
      o.connect(g2); g2.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.08;
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.15, t + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.start(t); o.stop(t + 0.7);
    });
  } catch(e) {}
}

function playWinSound() {
  if (soundMuted) return;
  try {
    const ctx = getAudioCtx();
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'triangle'; o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
    });
  } catch(e) {}
}

function playOddClick() {
  if (soundMuted) return;
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(660, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.05);
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    o.start(); o.stop(ctx.currentTime + 0.1);
  } catch(e) {}
}

// Mute button
const muteBtn = document.createElement('button');
muteBtn.className = 'mute-btn';
muteBtn.id = 'muteBtn';
muteBtn.title = 'Som';
muteBtn.textContent = soundMuted ? '🔇' : '🔊';
document.body.appendChild(muteBtn);
muteBtn.addEventListener('click', () => {
  soundMuted = !soundMuted;
  muteBtn.textContent = soundMuted ? '🔇' : '🔊';
  localStorage.setItem('arenaMuted', soundMuted);
  if (!soundMuted) playTick();
});

// Patch toggleBet to play sound
const _origToggleBet = toggleBet;
window.toggleBet = function(gameId, matchName, label, market, odd) {
  playOddClick();
  addRippleToClicked();
  _origToggleBet(gameId, matchName, label, market, odd);
};

function addRippleToClicked() {
  // find hovered odd-btn and add ripple
  document.querySelectorAll('.odd-btn:hover, .odd-cell:hover, .lei-odd:hover').forEach(btn => {
    const ripple = document.createElement('span');
    ripple.className = 'odd-ripple';
    ripple.style.cssText = 'left:50%;top:50%;';
    btn.style.position = 'relative';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  });
}

// ════════════════════════════════════════════
//  ⚽ GOAL OVERLAY
// ════════════════════════════════════════════
let goalOverlayActive = false;

function showGoalOverlay(scorerTeam, scoreHome, scoreAway) {
  if (goalOverlayActive) return;
  goalOverlayActive = true;

  playGoalSound();

  const overlay = document.createElement('div');
  overlay.className = 'goal-overlay';

  // particles
  const particles = document.createElement('div');
  particles.className = 'goal-particles';
  const colors = ['#00FF9D','#00D9FF','#FFD700','#8B5CF6','#FF2D55','#fff'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'goal-particle';
    const angle  = (Math.PI * 2 * i) / 40;
    const dist   = 200 + Math.random() * 300;
    p.style.cssText = `
      left:50%; top:50%;
      background:${colors[i % colors.length]};
      --tx:${Math.cos(angle)*dist}px;
      --ty:${Math.sin(angle)*dist}px;
      animation-delay:${Math.random()*0.3}s;
      box-shadow:0 0 6px ${colors[i%colors.length]};
    `;
    particles.appendChild(p);
  }

  const bg   = document.createElement('div'); bg.className = 'goal-overlay-bg';
  const text = document.createElement('div'); text.className = 'goal-text';
  text.innerHTML = `
    <span class="goal-word">GOOOL!</span>
    <span class="goal-scorer">${scorerTeam}</span>
    <span class="goal-score-badge">${scoreHome} — ${scoreAway}</span>
  `;

  overlay.appendChild(particles);
  overlay.appendChild(bg);
  overlay.appendChild(text);
  document.body.appendChild(overlay);

  setTimeout(() => { overlay.remove(); goalOverlayActive = false; }, 3000);
}

// Hook into liveGames polling: detect score changes
const prevScores = {};
const _origFetchLive = fetchLiveOdds;
window.fetchLiveOdds = async function() {
  // snapshot before
  const before = {};
  if (window.liveGamesData) {
    liveGamesData.forEach(g => { before[g.id] = { h: g.home.score, a: g.away.score }; });
  }

  await _origFetchLive();

  // compare after
  liveGamesData.forEach(g => {
    const prev = before[g.id];
    if (!prev) return;
    if (g.home.score > prev.h) showGoalOverlay(g.home.name, g.home.score, g.away.score);
    else if (g.away.score > prev.a) showGoalOverlay(g.away.name, g.home.score, g.away.score);
  });
};

// ════════════════════════════════════════════
//  📈 ODDS FLASH UP / DOWN
// ════════════════════════════════════════════
const prevOdds = {};

function flashChangedOdds() {
  liveGamesData.forEach(g => {
    const prev = prevOdds[g.id];
    if (!prev) { prevOdds[g.id] = { h: g.odds.h, d: g.odds.d, a: g.odds.a }; return; }

    [['h','1'],['d','X'],['a','2']].forEach(([key, label]) => {
      const newVal = g.odds[key], oldVal = prev[key];
      if (!newVal || !oldVal || newVal === oldVal) return;
      const dir = newVal > oldVal ? 'up' : 'down';

      // flash in live event list
      document.querySelectorAll(`.lei-odd[onclick*="${g.id}"][onclick*="'${label}'"]`).forEach(el => {
        el.classList.remove('odd-flash-up','odd-flash-down');
        void el.offsetWidth; // reflow
        el.classList.add(`odd-flash-${dir}`);
      });

      // flash in live cards
      document.querySelectorAll(`.odd-btn[onclick*="${g.id}"][onclick*="'${label}'"]`).forEach(el => {
        el.classList.remove('odd-flash-up','odd-flash-down');
        void el.offsetWidth;
        el.classList.add(`odd-flash-${dir}`);
      });
    });

    prevOdds[g.id] = { h: g.odds.h, d: g.odds.d, a: g.odds.a };
  });
}

// Run flash check after every live update
const _origRenderAllCards = renderAllCards;
window.renderAllCards = function() {
  _origRenderAllCards();
  setTimeout(flashChangedOdds, 50);
};

// ════════════════════════════════════════════
//  🔢 HERO COUNTER ANIMATION
// ════════════════════════════════════════════
function animateCounter(el, target, suffix = '', duration = 1800) {
  const isFloat   = typeof target === 'string' && target.includes('B');
  const isMonetary = suffix.includes('B');
  let start = null;
  const numVal = parseFloat(target.replace(/[^0-9.]/g, ''));

  function step(ts) {
    if (!start) start = ts;
    const prog  = Math.min((ts - start) / duration, 1);
    const eased = 1 - Math.pow(1 - prog, 3);
    const cur   = eased * numVal;

    if (target.includes('M')) el.textContent = (cur / 1000000).toFixed(1) + 'M' + suffix;
    else if (target.includes('B')) el.textContent = 'R$ ' + cur.toFixed(1) + 'B' + suffix;
    else if (target.includes('K')) el.textContent = Math.round(cur / 1000) + 'K' + suffix;
    else el.textContent = Math.round(cur) + suffix;

    if (prog < 1) requestAnimationFrame(step);
    else el.textContent = target; // final exact value
  }
  requestAnimationFrame(step);
}

// Trigger when hero is visible
const heroObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const stats = document.querySelectorAll('.hero-stat strong');
    const targets = ['2.4M+', '50K+', 'R$ 5B+'];
    stats.forEach((el, i) => {
      const raw = targets[i];
      if (!raw) return;
      setTimeout(() => animateCounter(el, raw, '+', 1800 + i * 200), i * 150);
    });
    heroObserver.disconnect();
  });
}, { threshold: 0.4 });

const heroSection = document.querySelector('.hero');
if (heroSection) heroObserver.observe(heroSection);

// ════════════════════════════════════════════
//  🏆 WIN NOTIFICATION SOUND
// ════════════════════════════════════════════
const _origShowToast = showToast;
window.showToast = function(msg, duration) {
  _origShowToast(msg, duration);
  if (msg.includes('CONFIRMADA') || msg.includes('Ganha') || msg.includes('✅')) playWinSound();
};

// ════════════════════════════════════════════
//  🎨 TEAM BADGE COLORS
// ════════════════════════════════════════════
const TEAM_COLORS = {
  'Flamengo':    ['#C80000','#000'],
  'Palmeiras':   ['#006437','#fff'],
  'Boca Juniors':['#003DA5','#FFD700'],
  'River Plate': ['#C80000','#fff'],
  'Franca':      ['#004B9E','#fff'],
  'Alcaraz':     ['#AA151B','#F1BF00'],
  'Djokovic':    ['#0C4076','#fff'],
  'Arsenal':     ['#EF0107','#fff'],
  'Chelsea':     ['#034694','#fff'],
  'NAVI':        ['#F5A623','#000'],
  'FaZe':        ['#FF0000','#fff'],
  'Real Madrid': ['#FEBE10','#fff'],
  'Man City':    ['#6CABDD','#fff'],
  'Barcelona':   ['#004D98','#A50044'],
  'Bayern':      ['#DC052D','#fff'],
  'Dortmund':    ['#FDE100','#000'],
  'Fluminense':  ['#6B0027','#fff'],
  'Corinthians': ['#111','#fff'],
  'São Paulo':   ['#E20613','#fff'],
  'Grêmio':      ['#3776BB','#fff'],
  'Atletico MG': ['#111','#fff'],
  'Vasco':       ['#000','#fff'],
  'Botafogo':    ['#111','#fff'],
  'Liverpool':   ['#C8102E','#fff'],
  'Atletico':    ['#CB3524','#fff'],
  'Nacional':    ['#fff','#0038A8'],
  'Crazy Time':  ['#8B5CF6','#fff'],
};

// Iniciais do time (até 2 letras) para o escudo.
function teamInitials(name) {
  const w = (name || '?').trim().split(/\s+/);
  return (w.length === 1 ? name.slice(0, 3) : w.slice(0, 2).map(p => p[0]).join('')).toUpperCase();
}

// Escudo do time: círculo com as cores oficiais e as iniciais.
function teamBadge(name) {
  const c = TEAM_COLORS[name] || ['#1b2235', '#9fd8ff'];
  return `<span class="team-badge" style="background:${c[0]};color:${c[1]}">${teamInitials(name)}</span>`;
}

// ════════════════════════════════════════════
//  🎰 CASSINO — jogos com RNG no servidor
// ════════════════════════════════════════════
let casinoGame = null;
let casinoBusy = false;

function openCasinoGame(i) {
  if (!currentUser) { openModal('loginModal'); return; }
  casinoGame = CASINO_GAMES[i];
  document.getElementById('casinoGameIcon').textContent  = casinoGame.icon;
  document.getElementById('casinoGameTitle').textContent = casinoGame.name;
  document.getElementById('casinoGameSub').textContent   = `${casinoGame.type} · RTP ${casinoGame.rtp}`;
  buildCasinoUI(casinoGame.game);
  openModal('casinoModal');
}

const casinoStake = () => Math.max(0, Number(document.getElementById('casinoStakeInput')?.value) || 0);

function stakeControls(label) {
  return `
    <div class="casino-stake-row">
      <button class="casino-chip" data-amt="5">5</button>
      <button class="casino-chip" data-amt="10">10</button>
      <button class="casino-chip" data-amt="25">25</button>
      <button class="casino-chip" data-amt="50">50</button>
      <input type="number" id="casinoStakeInput" class="casino-stake-input" value="10" min="1" />
    </div>
    <button class="btn-place-bet casino-go" id="casinoGoBtn"><span class="btn-glow-fx"></span>${label}</button>`;
}

function bindChips() {
  document.querySelectorAll('.casino-chip').forEach(c => c.addEventListener('click', () => {
    document.getElementById('casinoStakeInput').value = c.dataset.amt;
  }));
}

function buildCasinoUI(type) {
  const stage = document.getElementById('casinoStage');
  const ctrl  = document.getElementById('casinoControls');

  if (type === 'crash') {
    stage.innerHTML = `<div class="crash-stage"><div class="crash-rocket" id="crashRocket">🚀</div><div class="crash-mult" id="crashMult">1.00x</div></div>`;
    ctrl.innerHTML = `
      <div class="casino-field"><label>RETIRAR AUTOMÁTICO EM</label>
        <div class="crash-target-row">
          <button class="crash-tbtn" data-t="1.5">1.5x</button>
          <button class="crash-tbtn active" data-t="2">2.0x</button>
          <button class="crash-tbtn" data-t="3">3.0x</button>
          <button class="crash-tbtn" data-t="5">5.0x</button>
          <input type="number" id="crashTarget" value="2.0" step="0.1" min="1.01" class="casino-stake-input" style="max-width:80px;">
        </div>
      </div>
      ${stakeControls('🚀 LANÇAR')}`;
    bindChips();
    document.querySelectorAll('.crash-tbtn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.crash-tbtn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('crashTarget').value = b.dataset.t;
    }));
    document.getElementById('casinoGoBtn').addEventListener('click', playCrash);

  } else if (type === 'roleta') {
    stage.innerHTML = `<div class="roleta-stage"><div class="roleta-wheel" id="roletaWheel">🎡</div><div class="roleta-result" id="roletaResult">Faça sua aposta</div></div>`;
    ctrl.innerHTML = `
      <div class="casino-field"><label>ESCOLHA</label>
        <div class="roleta-picks" id="roletaPicks">
          <button class="rpick active" data-pick="red" style="--c:#e63946">VERMELHO 2x</button>
          <button class="rpick" data-pick="black" style="--c:#222">PRETO 2x</button>
          <button class="rpick" data-pick="green" style="--c:#1a7a2e">VERDE 14x</button>
        </div>
      </div>
      ${stakeControls('🎡 GIRAR')}`;
    bindChips();
    document.querySelectorAll('#roletaPicks .rpick').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#roletaPicks .rpick').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    document.getElementById('casinoGoBtn').addEventListener('click', playRoleta);

  } else if (type === 'slots') {
    stage.innerHTML = `<div class="slots-stage"><div class="slot-reel" id="r0">🎰</div><div class="slot-reel" id="r1">🎰</div><div class="slot-reel" id="r2">🎰</div></div><div class="slots-msg" id="slotsMsg">Combine 3 e ganhe até 100x!</div>`;
    ctrl.innerHTML = stakeControls('🎰 GIRAR');
    bindChips();
    document.getElementById('casinoGoBtn').addEventListener('click', playSlots);

  } else if (type === 'double') {
    stage.innerHTML = `<div class="double-stage"><div class="double-card" id="doubleCard">🂠</div><div class="double-result" id="doubleResult">Escolha um lado</div></div>`;
    ctrl.innerHTML = `
      <div class="casino-field"><label>APOSTE EM</label>
        <div class="roleta-picks" id="doublePicks">
          <button class="rpick active" data-pick="a" style="--c:#00D9FF">DRAGÃO 1.96x</button>
          <button class="rpick" data-pick="b" style="--c:#FF2D55">TIGRE 1.96x</button>
          <button class="rpick" data-pick="tie" style="--c:#FFD700">EMPATE 14x</button>
        </div>
      </div>
      ${stakeControls('🐉 APOSTAR')}`;
    bindChips();
    document.querySelectorAll('#doublePicks .rpick').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#doublePicks .rpick').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    document.getElementById('casinoGoBtn').addEventListener('click', playDouble);
  }
}

async function casinoPlay(pick) {
  if (casinoBusy) return null;
  const stake = casinoStake();
  if (stake < 1) { showToast('Valor mínimo R$ 1'); return null; }
  if (currentUser && stake > currentUser.balance) { showToast('◈ Saldo insuficiente'); return null; }
  casinoBusy = true;
  document.getElementById('casinoGoBtn').disabled = true;
  const res = await api.post('/api/casino/play', { game: casinoGame.game, stake, pick });
  if (res.error) {
    showToast('❌ ' + res.error);
    casinoBusy = false;
    document.getElementById('casinoGoBtn').disabled = false;
    return null;
  }
  updateBalance(res.newBalance);
  return { ...res, stake };
}

function casinoDone(res, winMsg, loseMsg) {
  casinoBusy = false;
  const btn = document.getElementById('casinoGoBtn');
  if (btn) btn.disabled = false;
  if (res.win) { playWinSound(); showToast(`🏆 ${winMsg} +${fmt(res.winnings)}`); }
  else         { showToast(`💥 ${loseMsg}`); }
}

async function playCrash() {
  const target = Math.max(1.01, Number(document.getElementById('crashTarget').value) || 2);
  const res = await casinoPlay(target);
  if (!res) return;
  const crash  = res.detail.crash;
  const multEl = document.getElementById('crashMult');
  const rocket = document.getElementById('crashRocket');
  rocket.className = 'crash-rocket flying';
  let cur = 1.00;
  const peak = res.win ? target : crash;
  const timer = setInterval(() => {
    cur = +(cur + Math.max(0.02, cur * 0.04)).toFixed(2);
    if (cur >= peak) {
      cur = peak;
      multEl.textContent = cur.toFixed(2) + 'x';
      clearInterval(timer);
      if (res.win) { multEl.className = 'crash-mult win'; rocket.textContent = '💰'; }
      else         { multEl.className = 'crash-mult bust'; rocket.textContent = '💥'; rocket.className = 'crash-rocket'; }
      setTimeout(() => { multEl.className = 'crash-mult'; rocket.textContent = '🚀'; rocket.className = 'crash-rocket'; }, 2500);
      casinoDone(res, `Retirou em ${target.toFixed(2)}x!`, `Explodiu em ${crash.toFixed(2)}x`);
    } else {
      multEl.textContent = cur.toFixed(2) + 'x';
    }
  }, 60);
}

async function playRoleta() {
  const pick = document.querySelector('#roletaPicks .rpick.active').dataset.pick;
  const res = await casinoPlay(pick);
  if (!res) return;
  const wheel = document.getElementById('roletaWheel');
  const out   = document.getElementById('roletaResult');
  wheel.className = 'roleta-wheel spinning';
  out.textContent = 'Girando...';
  setTimeout(() => {
    wheel.className = 'roleta-wheel';
    const { number, color } = res.detail;
    const cl = color === 'red' ? '#e63946' : color === 'green' ? '#1a7a2e' : '#888';
    out.innerHTML = `<span style="color:${cl};font-weight:800">${number} ${color.toUpperCase()}</span>`;
    casinoDone(res, `Caiu ${color}!`, `Caiu ${number} ${color}`);
  }, 1400);
}

async function playSlots() {
  const res = await casinoPlay(null);
  if (!res) return;
  const reels = ['r0','r1','r2'].map(id => document.getElementById(id));
  const msg   = document.getElementById('slotsMsg');
  const sym   = ['🍒','🍋','🔔','⭐','💎','7️⃣'];
  reels.forEach(r => r.classList.add('spinning'));
  msg.textContent = 'Girando...';
  const spinners = reels.map(r => setInterval(() => { r.textContent = sym[Math.floor(Math.random() * sym.length)]; }, 80));
  reels.forEach((r, i) => setTimeout(() => {
    clearInterval(spinners[i]);
    r.classList.remove('spinning');
    r.textContent = res.detail.reels[i];
    if (i === 2) {
      msg.textContent = res.win ? `🎉 ${res.multiplier}x!` : 'Tente de novo!';
      casinoDone(res, `${res.multiplier}x!`, 'Sem combinação');
    }
  }, 700 + i * 500));
}

async function playDouble() {
  const pick = document.querySelector('#doublePicks .rpick.active').dataset.pick;
  const res = await casinoPlay(pick);
  if (!res) return;
  const card = document.getElementById('doubleCard');
  const out  = document.getElementById('doubleResult');
  card.className = 'double-card flip';
  out.textContent = 'Virando...';
  setTimeout(() => {
    card.className = 'double-card';
    const map = { a:'🐉 DRAGÃO', b:'🐯 TIGRE', tie:'🟰 EMPATE' };
    card.textContent = res.detail.result === 'a' ? '🐉' : res.detail.result === 'b' ? '🐯' : '🟰';
    out.textContent = map[res.detail.result];
    casinoDone(res, `${map[res.detail.result]}!`, `Saiu ${map[res.detail.result]}`);
  }, 900);
}
