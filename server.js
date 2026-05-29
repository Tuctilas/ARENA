/* ═══════════════════════════════════════════
   ARENABET – server.js  (JSON DB Edition)
   Express + JSON files + JWT + Live Engine
═══════════════════════════════════════════ */
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');

const app    = express();
const SECRET = process.env.JWT_SECRET || 'arenabet_secret_2026_ultra';
const PORT   = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ════════════════════════════════════════════
//  SIMPLE JSON DATABASE
// ════════════════════════════════════════════
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

const TABLES = ['users','bets','deposits','withdrawals','favorites','notifications'];
const db = {};

function loadTable(name) {
  const file = path.join(DB_DIR, name + '.json');
  if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify({ rows: [], nextId: 1 })); }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveTable(name, data) {
  fs.writeFileSync(path.join(DB_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

TABLES.forEach(t => { db[t] = loadTable(t); });

// DB helpers
function dbInsert(table, obj) {
  const row = { id: db[table].nextId++, created_at: new Date().toISOString(), ...obj };
  db[table].rows.push(row);
  saveTable(table, db[table]);
  return row;
}

function dbFind(table, predicate) {
  return db[table].rows.filter(predicate);
}

function dbFindOne(table, predicate) {
  return db[table].rows.find(predicate) || null;
}

function dbUpdate(table, predicate, updates) {
  let count = 0;
  db[table].rows = db[table].rows.map(row => {
    if (predicate(row)) { count++; return { ...row, ...updates, updated_at: new Date().toISOString() }; }
    return row;
  });
  saveTable(table, db[table]);
  return count;
}

function dbDelete(table, predicate) {
  const before = db[table].rows.length;
  db[table].rows = db[table].rows.filter(r => !predicate(r));
  saveTable(table, db[table]);
  return before - db[table].rows.length;
}

function addNotification(userId, title, body, type = 'info') {
  dbInsert('notifications', { user_id: userId, title, body, type, read: false });
}

function updateVipLevel(userId) {
  const user = dbFindOne('users', u => u.id === userId);
  if (!user) return;
  const pts = user.vip_points || 0;
  let level = 1;
  if (pts >= 10000) level = 5;
  else if (pts >= 5000) level = 4;
  else if (pts >= 2000) level = 3;
  else if (pts >= 500)  level = 2;
  dbUpdate('users', u => u.id === userId, { vip_level: level });
}

// ════════════════════════════════════════════
//  LIVE ODDS ENGINE
// ════════════════════════════════════════════
const liveGames = [
  { id:'l1', league:'Brasileirão Série A', flag:'🇧🇷', sport:'futebol',
    home:{ name:'Flamengo',    abbr:'FLA', logo:'🔴', score:2 },
    away:{ name:'Palmeiras',   abbr:'PAL', logo:'💚', score:1 },
    minute:67, period:'2º Tempo',
    odds:{ h:1.45, d:3.80, a:6.20 }, events:[],
    stats:{ possession:[58,42], shots:[12,7], shotsOn:[5,3], corners:[6,3], fouls:[8,11] } },

  { id:'l2', league:'Copa Libertadores', flag:'🏆', sport:'futebol',
    home:{ name:'Boca Juniors', abbr:'BOC', logo:'💛', score:0 },
    away:{ name:'River Plate',  abbr:'RIV', logo:'⬜', score:0 },
    minute:34, period:'1º Tempo',
    odds:{ h:2.10, d:3.20, a:3.40 }, events:[],
    stats:{ possession:[45,55], shots:[4,6], shotsOn:[1,2], corners:[2,4], fouls:[6,7] } },

  { id:'l3', league:'NBB Nacional', flag:'🇧🇷', sport:'basquete',
    home:{ name:'Franca',   abbr:'FRA', logo:'🔵', score:58 },
    away:{ name:'Flamengo', abbr:'FLA', logo:'🔴', score:54 },
    minute:null, period:'Q3',
    odds:{ h:1.72, d:null, a:2.05 }, events:[],
    stats:{ possession:[52,48], shots:[24,21], shotsOn:[24,21], corners:[0,0], fouls:[12,9] } },

  { id:'l4', league:'ATP Masters 1000', flag:'🎾', sport:'tenis',
    home:{ name:'Alcaraz',  abbr:'ALC', logo:'🇪🇸', score:6 },
    away:{ name:'Djokovic', abbr:'DJO', logo:'🇷🇸', score:4 },
    minute:null, period:'2º Set',
    odds:{ h:1.35, d:null, a:3.10 }, events:[],
    stats:{ possession:[50,50], shots:[18,14], shotsOn:[18,14], corners:[0,0], fouls:[2,3] } },

  { id:'l5', league:'Premier League', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', sport:'futebol',
    home:{ name:'Arsenal', abbr:'ARS', logo:'🔴', score:1 },
    away:{ name:'Chelsea', abbr:'CHE', logo:'🔵', score:1 },
    minute:78, period:'2º Tempo',
    odds:{ h:2.40, d:3.00, a:2.80 }, events:[],
    stats:{ possession:[54,46], shots:[10,8], shotsOn:[4,3], corners:[5,4], fouls:[9,13] } },

  { id:'l6', league:'CS2 – ESL Pro League', flag:'🎮', sport:'esports',
    home:{ name:'NAVI', abbr:'NAV', logo:'🇺🇦', score:13 },
    away:{ name:'FaZe', abbr:'FAZ', logo:'💀',  score:11 },
    minute:null, period:'Mapa 2',
    odds:{ h:1.55, d:null, a:2.40 }, events:[],
    stats:{ possession:[52,48], shots:[0,0], shotsOn:[0,0], corners:[0,0], fouls:[0,0] } },
];

const EVENTS_POOL = {
  futebol: [
    { icon:'⚽', desc:'GOL! ',                 prob:.08, isGoal:true  },
    { icon:'🟨', desc:'Cartão amarelo – ',      prob:.12, isGoal:false },
    { icon:'🟥', desc:'CARTÃO VERMELHO! ',      prob:.02, isGoal:false, isRed:true },
    { icon:'🔄', desc:'Substituição – ',        prob:.10, isGoal:false },
    { icon:'⛳', desc:'Escanteio – ',           prob:.18, isGoal:false },
    { icon:'🎯', desc:'Chute na trave – ',      prob:.06, isGoal:false },
    { icon:'🩹', desc:'Falta perigosa – ',      prob:.15, isGoal:false },
    { icon:'🥅', desc:'Defesa do goleiro – ',   prob:.09, isGoal:false },
    { icon:'🚑', desc:'Lesão – ',               prob:.04, isGoal:false },
    { icon:'🏴', desc:'Impedimento anulado – ', prob:.06, isGoal:false },
  ],
  basquete:[
    {icon:'🏀',desc:'Cesta de 3 pontos – ',prob:.25,isGoal:false},
    {icon:'🎯',desc:'Bandeja – ',            prob:.30,isGoal:false},
    {icon:'🆓',desc:'Lance livre – ',        prob:.20,isGoal:false},
    {icon:'🔄',desc:'Substituição – ',       prob:.15,isGoal:false},
    {icon:'⛹',desc:'Falta – ',              prob:.10,isGoal:false},
  ],
  tenis:[
    {icon:'🎾',desc:'Ace – ',          prob:.25,isGoal:false},
    {icon:'💥',desc:'Break point – ',  prob:.20,isGoal:false},
    {icon:'🏆',desc:'Game vencido – ', prob:.35,isGoal:false},
    {icon:'❌',desc:'Dupla falta – ',  prob:.10,isGoal:false},
    {icon:'🎯',desc:'Winner – ',       prob:.10,isGoal:false},
  ],
  esports:[
    {icon:'💥',desc:'Clutch – ',      prob:.30,isGoal:false},
    {icon:'💣',desc:'Defuse – ',      prob:.20,isGoal:false},
    {icon:'🔫',desc:'Ace – ',         prob:.15,isGoal:false},
    {icon:'💰',desc:'Eco round – ',   prob:.20,isGoal:false},
    {icon:'🏆',desc:'Round ganho – ', prob:.15,isGoal:false},
  ],
};

function nudge(v, r = 0.06) {
  if (!v) return null;
  return Math.max(1.01, parseFloat((v + (Math.random() - 0.5) * r).toFixed(2)));
}

// Tick every 5s: evolve live games
setInterval(() => {
  liveGames.forEach(g => {
    // advance clock
    if (g.sport === 'futebol' && g.minute && g.minute < 90) g.minute++;

    // nudge odds
    g.odds.h = nudge(g.odds.h, 0.05);
    g.odds.d = nudge(g.odds.d, 0.05);
    g.odds.a = nudge(g.odds.a, 0.05);

    // random event
    if (Math.random() > 0.82) {
      const pool = EVENTS_POOL[g.sport] || EVENTS_POOL.futebol;
      let cum = 0;
      const rand = Math.random();
      for (const ev of pool) {
        cum += ev.prob;
        if (rand < cum) {
          const isHome = Math.random() > 0.5;
          const team   = isHome ? g.home.name : g.away.name;
          const evObj  = { min: g.minute, icon: ev.icon, desc: ev.desc, team };
          if (ev.isGoal && g.sport === 'futebol') {
            if (isHome) { g.home.score++; g.odds.h = Math.max(1.05, g.odds.h - 0.35); g.odds.a = Math.min(18, g.odds.a + 0.55); }
            else        { g.away.score++; g.odds.a = Math.max(1.05, g.odds.a - 0.35); g.odds.h = Math.min(18, g.odds.h + 0.55); }
            if (g.odds.d) g.odds.d = Math.max(1.5, g.odds.d + (isHome ? 0.1 : -0.1));
          }
          if (ev.isRed) {
            if (isHome) g.odds.h = Math.min(15, g.odds.h + 0.8);
            else        g.odds.a = Math.min(15, g.odds.a + 0.8);
          }
          if (g.sport === 'basquete' && Math.random() > 0.6) {
            const pts = [1,2,2,3][Math.floor(Math.random()*4)];
            if (isHome) g.home.score += pts; else g.away.score += pts;
          }
          g.events.unshift(evObj);
          if (g.events.length > 12) g.events.pop();
          break;
        }
      }
    }

    // update stats
    if (g.stats && g.sport === 'futebol' && Math.random() > 0.7) {
      const side = Math.random() > 0.5 ? 0 : 1;
      if (Math.random() > 0.6) g.stats.shots[side]++;
      if (Math.random() > 0.75) g.stats.corners[side]++;
      if (Math.random() > 0.8)  g.stats.fouls[side]++;
    }
  });

  // settle pending bets older than 5 min
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const pending    = dbFind('bets', b => b.status === 'pending' && b.created_at < fiveMinAgo);

  pending.forEach(bet => {
    const won = Math.random() > 0.52;
    const now = new Date().toISOString();
    dbUpdate('bets', b => b.id === bet.id, { status: won ? 'won' : 'lost', settled_at: now });
    if (won) {
      dbUpdate('users', u => u.id === bet.user_id, (u => ({
        balance:    u.balance + bet.potential,
        vip_points: (u.vip_points || 0) + Math.floor(bet.stake),
      }))(dbFindOne('users', u => u.id === bet.user_id)));
      addNotification(bet.user_id, '🏆 Aposta Ganha!', `${bet.selection} @ ${bet.odd} – Ganho: R$ ${bet.potential.toFixed(2)}`, 'win');
    } else {
      addNotification(bet.user_id, '❌ Aposta Perdida', `${bet.selection} – R$ ${bet.stake.toFixed(2)}`, 'loss');
    }
    updateVipLevel(bet.user_id);
  });

}, 5000);

// helper for won-bet balance update
function addToBalance(userId, amount, pts = 0) {
  const user = dbFindOne('users', u => u.id === userId);
  if (!user) return;
  dbUpdate('users', u => u.id === userId, {
    balance:    user.balance + amount,
    vip_points: (user.vip_points || 0) + pts,
  });
}

// ════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Token requerido' });
  try { req.user = jwt.verify(h.replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, last_name, email, cpf, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Dados obrigatórios' });
    if (dbFindOne('users', u => u.email === email)) return res.status(400).json({ error: 'E-mail já cadastrado' });
    const hash = await bcrypt.hash(password, 10);
    const user = dbInsert('users', { name, last_name: last_name||'', email, cpf: cpf||'', password: hash, balance: 1000.00, vip_level: 1, vip_points: 0 });
    const token = jwt.sign({ id: user.id, email }, SECRET, { expiresIn: '7d' });
    addNotification(user.id, '🎉 Bem-vindo à ArenaBet!', `Olá ${name}! Bônus de R$ 1.000 já disponível na sua conta!`, 'info');
    const { password: _, ...safe } = user;
    res.json({ token, user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = dbFindOne('users', u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Credenciais inválidas' });
    dbUpdate('users', u => u.id === user.id, { last_login: new Date().toISOString() });
    const token = jwt.sign({ id: user.id, email }, SECRET, { expiresIn: '7d' });
    const { password: _, ...safe } = user;
    res.json({ token, user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Não encontrado' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ════════════════════════════════════════════
//  ODDS ROUTES
// ════════════════════════════════════════════
app.get('/api/odds/live',   (_, res) => res.json(liveGames));
app.get('/api/odds/live/:id', (req, res) => {
  const g = liveGames.find(x => x.id === req.params.id);
  g ? res.json(g) : res.status(404).json({ error: 'Não encontrado' });
});

app.get('/api/odds/upcoming', (_, res) => res.json([
  { id:'u1', league:'Brasileirão', flag:'🇧🇷', time:'Hoje 16:00', sport:'futebol', home:{name:'Corinthians',logo:'⬛'}, away:{name:'São Paulo',  logo:'🔴'}, odds:{h:2.30,d:3.10,a:2.90}, filter:'hoje'  },
  { id:'u2', league:'Brasileirão', flag:'🇧🇷', time:'Hoje 19:00', sport:'futebol', home:{name:'Grêmio',     logo:'🔵'}, away:{name:'Atletico MG',logo:'⚫'}, odds:{h:2.70,d:3.00,a:2.50}, filter:'hoje'  },
  { id:'u3', league:'Champions',   flag:'⭐', time:'Hoje 21:00', sport:'futebol', home:{name:'Real Madrid', logo:'⚪'}, away:{name:'Man City',   logo:'🔵'}, odds:{h:1.95,d:3.50,a:3.80}, filter:'hoje'  },
  { id:'u4', league:'Premier',     flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', time:'Amanhã 13:30',sport:'futebol',home:{name:'Arsenal',   logo:'🔴'}, away:{name:'Liverpool',  logo:'🔴'}, odds:{h:2.40,d:3.30,a:2.80}, filter:'amanha'},
  { id:'u5', league:'La Liga',     flag:'🇪🇸', time:'Amanhã 17:00',sport:'futebol',home:{name:'Barcelona', logo:'🔵'}, away:{name:'Atletico',   logo:'🔴'}, odds:{h:1.80,d:3.60,a:4.20}, filter:'amanha'},
  { id:'u6', league:'Libertadores',flag:'🏆', time:'Sáb 21:30', sport:'futebol', home:{name:'Fluminense', logo:'💚'}, away:{name:'Nacional',   logo:'⬜'}, odds:{h:1.60,d:3.80,a:5.50}, filter:'semana'},
  { id:'u7', league:'Bundesliga',  flag:'🇩🇪', time:'Dom 15:30', sport:'futebol', home:{name:'Bayern',     logo:'🔴'}, away:{name:'Dortmund',   logo:'💛'}, odds:{h:1.55,d:4.00,a:5.80}, filter:'semana'},
  { id:'u8', league:'Copa Brasil', flag:'🇧🇷', time:'Dom 16:00', sport:'futebol', home:{name:'Vasco',      logo:'⬛'}, away:{name:'Botafogo',   logo:'⬛'}, odds:{h:2.90,d:3.10,a:2.40}, filter:'semana'},
]));

// ════════════════════════════════════════════
//  BETS ROUTES
// ════════════════════════════════════════════
app.post('/api/bets/place', auth, (req, res) => {
  const { selections, stake } = req.body;
  if (!selections?.length || !stake || stake < 1) return res.status(400).json({ error: 'Dados inválidos' });
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (user.balance < stake) return res.status(400).json({ error: 'Saldo insuficiente' });

  const totalOdd = selections.reduce((a, s) => a * s.odd, 1);
  const potential = parseFloat((stake * totalOdd).toFixed(2));

  dbUpdate('users', u => u.id === user.id, {
    balance:    user.balance - stake,
    vip_points: (user.vip_points || 0) + Math.floor(stake),
  });

  const betIds = selections.map(s => {
    const b = dbInsert('bets', {
      user_id:    user.id,
      match_name: s.matchName,
      market:     s.market,
      selection:  s.label,
      odd:        s.odd,
      stake:      parseFloat(stake),
      potential,
      status:    'pending',
      game_id:   s.gameId || '',
    });
    return b.id;
  });

  addNotification(user.id, '⚡ Aposta Realizada!', `${selections.map(s=>s.label).join(' + ')} – R$ ${parseFloat(stake).toFixed(2)}`, 'info');
  updateVipLevel(user.id);

  const newBalance = dbFindOne('users', u => u.id === user.id).balance;
  res.json({ success: true, betIds, newBalance, potential });
});

app.get('/api/bets/history', auth, (req, res) => {
  const { status, limit=20, offset=0 } = req.query;
  let rows = dbFind('bets', b => b.user_id === req.user.id);
  if (status) rows = rows.filter(b => b.status === status);
  rows.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ bets: rows.slice(parseInt(offset), parseInt(offset)+parseInt(limit)), total: rows.length });
});

app.get('/api/bets/stats', auth, (req, res) => {
  const bets    = dbFind('bets', b => b.user_id === req.user.id);
  const won     = bets.filter(b => b.status === 'won');
  const lost    = bets.filter(b => b.status === 'lost');
  const pending = bets.filter(b => b.status === 'pending');
  const staked  = bets.reduce((s,b) => s + b.stake, 0);
  const gained  = won.reduce((s,b) => s + b.potential, 0);
  res.json({
    total:   bets.length,
    won:     won.length,
    lost:    lost.length,
    pending: pending.length,
    staked, gained,
    winRate: bets.length ? ((won.length / bets.length) * 100).toFixed(1) : 0,
  });
});

app.post('/api/bets/cashout/:id', auth, (req, res) => {
  const bet = dbFindOne('bets', b => b.id === parseInt(req.params.id) && b.user_id === req.user.id);
  if (!bet) return res.status(404).json({ error: 'Aposta não encontrada' });
  if (bet.status !== 'pending') return res.status(400).json({ error: 'Não disponível para cash-out' });

  const pct       = 0.70 + Math.random() * 0.20;
  const cashoutVal = parseFloat((bet.potential * pct).toFixed(2));
  dbUpdate('bets', b => b.id === bet.id, { status: 'cashout', cashout_val: cashoutVal, settled_at: new Date().toISOString() });
  addToBalance(req.user.id, cashoutVal, Math.floor(cashoutVal / 10));
  addNotification(req.user.id, '💰 Cash-Out Realizado', `R$ ${cashoutVal.toFixed(2)} creditado`, 'win');
  const newBalance = dbFindOne('users', u => u.id === req.user.id).balance;
  res.json({ success: true, cashoutVal, newBalance });
});

// ════════════════════════════════════════════
//  USER ROUTES
// ════════════════════════════════════════════
app.get('/api/user/balance', auth, (req, res) => {
  const u = dbFindOne('users', u => u.id === req.user.id);
  res.json({ balance: u?.balance||0, vip_level: u?.vip_level||1, vip_points: u?.vip_points||0 });
});

app.post('/api/user/deposit', auth, (req, res) => {
  const { method, amount } = req.body;
  if (!amount || amount < 10) return res.status(400).json({ error: 'Valor mínimo R$10' });
  dbInsert('deposits', { user_id: req.user.id, method, amount: parseFloat(amount), status: 'completed' });
  addToBalance(req.user.id, parseFloat(amount), Math.floor(amount / 10));
  addNotification(req.user.id, '✅ Depósito Confirmado', `R$ ${parseFloat(amount).toFixed(2)} via ${method}`, 'win');
  updateVipLevel(req.user.id);
  const newBalance = dbFindOne('users', u => u.id === req.user.id).balance;
  res.json({ success: true, newBalance });
});

app.post('/api/user/withdraw', auth, (req, res) => {
  const { method, amount } = req.body;
  if (!amount || amount < 20) return res.status(400).json({ error: 'Mínimo R$20' });
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
  dbUpdate('users', u => u.id === user.id, { balance: user.balance - parseFloat(amount) });
  dbInsert('withdrawals', { user_id: req.user.id, method: method||'pix', amount: parseFloat(amount), status: 'pending' });
  addNotification(req.user.id, '🏦 Saque Solicitado', `R$ ${parseFloat(amount).toFixed(2)} em processamento`, 'info');
  const newBalance = dbFindOne('users', u => u.id === req.user.id).balance;
  res.json({ success: true, newBalance });
});

app.get('/api/user/transactions', auth, (req, res) => {
  const deps = dbFind('deposits', d => d.user_id === req.user.id).map(d => ({ ...d, type: 'deposit' }));
  const wds  = dbFind('withdrawals', w => w.user_id === req.user.id).map(w => ({ ...w, type: 'withdraw' }));
  const all  = [...deps, ...wds].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(all);
});

app.get('/api/user/notifications', auth, (req, res) => {
  const notifs = dbFind('notifications', n => n.user_id === req.user.id)
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20);
  const unread = notifs.filter(n => !n.read).length;
  res.json({ notifications: notifs, unread });
});

app.post('/api/user/notifications/read', auth, (req, res) => {
  dbUpdate('notifications', n => n.user_id === req.user.id, { read: true });
  res.json({ success: true });
});

app.put('/api/user/profile', auth, (req, res) => {
  const { name, last_name } = req.body;
  dbUpdate('users', u => u.id === req.user.id, { name: name||'', last_name: last_name||'' });
  res.json({ success: true });
});

app.put('/api/user/password', auth, async (req, res) => {
  const { current, newPass } = req.body;
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!await bcrypt.compare(current, user.password)) return res.status(400).json({ error: 'Senha atual incorreta' });
  dbUpdate('users', u => u.id === user.id, { password: await bcrypt.hash(newPass, 10) });
  res.json({ success: true });
});

app.post('/api/user/favorite', auth, (req, res) => {
  const { type, ref_id, name } = req.body;
  const existing = dbFindOne('favorites', f => f.user_id === req.user.id && f.ref_id === ref_id);
  if (existing) { dbDelete('favorites', f => f.id === existing.id); res.json({ favorited: false }); }
  else { dbInsert('favorites', { user_id: req.user.id, type, ref_id, name }); res.json({ favorited: true }); }
});

app.get('/api/user/favorites', auth, (req, res) => {
  res.json(dbFind('favorites', f => f.user_id === req.user.id));
});

// ════════════════════════════════════════════
//  SEARCH & VIP
// ════════════════════════════════════════════
app.get('/api/search', (req, res) => {
  const q = (req.query.q||'').toLowerCase();
  if (q.length < 2) return res.json([]);
  const results = liveGames.filter(g =>
    g.home.name.toLowerCase().includes(q) ||
    g.away.name.toLowerCase().includes(q) ||
    g.league.toLowerCase().includes(q)
  ).map(g => ({
    type: 'live', id: g.id,
    label: `${g.home.name} vs ${g.away.name}`,
    sub: `${g.league} · AO VIVO`,
    score: `${g.home.score}–${g.away.score}`,
  }));
  res.json(results.slice(0, 8));
});

app.get('/api/vip/info', auth, (req, res) => {
  const user   = dbFindOne('users', u => u.id === req.user.id);
  const levels = [
    {level:1,name:'Bronze',  minPoints:0,    maxPoints:499,  cashback:2,  oddBonus:0,  color:'#cd7f32'},
    {level:2,name:'Prata',   minPoints:500,  maxPoints:1999, cashback:5,  oddBonus:.5, color:'#c0c0c0'},
    {level:3,name:'Ouro',    minPoints:2000, maxPoints:4999, cashback:8,  oddBonus:1,  color:'#ffd700'},
    {level:4,name:'Platina', minPoints:5000, maxPoints:9999, cashback:12, oddBonus:2,  color:'#e5e4e2'},
    {level:5,name:'Diamante',minPoints:10000,maxPoints:null, cashback:15, oddBonus:3,  color:'#b9f2ff'},
  ];
  const current = levels.find(l => l.level === (user?.vip_level||1)) || levels[0];
  const next    = levels.find(l => l.level === (user?.vip_level||1) + 1);
  res.json({ vip_level: user?.vip_level||1, vip_points: user?.vip_points||0, current, next, levels });
});

// ════════════════════════════════════════════
//  START
// ════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n  ⚡ ArenaBet Server → http://localhost:${PORT}`);
  console.log(`  📁 Data stored in: ${DB_DIR}\n`);
});
