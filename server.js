// ArenaBet – API + motor de odds ao vivo
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
// Use uma pasta persistente (volume) via DATA_DIR; senão, ./data local.
const DB_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// Segredo JWT. Em produção vem de process.env.JWT_SECRET.
// Sem a variável, geramos um segredo e o guardamos em disco — assim os
// tokens continuam válidos após reinícios (não muda a cada boot).
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DB_DIR, '.jwt_secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    console.warn('  ⚠  JWT_SECRET não definido — gerado e guardado em', file, '(defina a variável em produção).');
    return s;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}
const SECRET = resolveSecret();

// Margem da casa (0 = jogo justo · 1 = quase impossível ganhar).
// Fase inicial agressiva = 0.45. Para voltar ao normal, defina a variável
// de ambiente HOUSE_EDGE=0.03 no Render (não precisa mexer no código).
const HOUSE_EDGE = Math.min(0.9, Math.max(0, Number(process.env.HOUSE_EDGE ?? 0.45)));

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '32kb' }));

// Só expõe os arquivos públicos. Sem isso, /data/*.json (senhas, e-mails,
// CPFs) e o próprio server.js ficariam acessíveis pela web.
const PUBLIC_FILES = new Set(['/', '/index.html', '/style.css', '/script.js', '/sw.js', '/manifest.json']);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (PUBLIC_FILES.has(req.path)) return next();
  return res.status(404).send('Not found');
});
app.use(express.static(__dirname, { dotfiles: 'deny' }));

// A raiz sempre devolve o index — não depende do comportamento padrão do static.
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Banco de dados em arquivos JSON ──────────────────────────

const TABLES = ['users', 'bets', 'deposits', 'withdrawals', 'favorites', 'notifications'];
const db = {};

function loadTable(name) {
  const file = path.join(DB_DIR, name + '.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ rows: [], nextId: 1 }));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function saveTable(name) {
  fs.writeFileSync(path.join(DB_DIR, name + '.json'), JSON.stringify(db[name], null, 2));
}

TABLES.forEach(t => { db[t] = loadTable(t); });

function dbInsert(table, obj) {
  const row = { id: db[table].nextId++, created_at: new Date().toISOString(), ...obj };
  db[table].rows.push(row);
  saveTable(table);
  return row;
}
const dbFind    = (table, fn) => db[table].rows.filter(fn);
const dbFindOne = (table, fn) => db[table].rows.find(fn) || null;

function dbUpdate(table, fn, updates) {
  let count = 0;
  db[table].rows = db[table].rows.map(row => {
    if (!fn(row)) return row;
    count++;
    return { ...row, ...updates, updated_at: new Date().toISOString() };
  });
  saveTable(table);
  return count;
}
function dbDelete(table, fn) {
  const before = db[table].rows.length;
  db[table].rows = db[table].rows.filter(r => !fn(r));
  saveTable(table);
  return before - db[table].rows.length;
}

// ── Utilitários ──────────────────────────────────────────────
// Remove tags e limita tamanho — evita XSS em campos que o cliente envia.
const clean = (s, max = 120) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function notify(userId, title, body, type = 'info') {
  dbInsert('notifications', { user_id: userId, title: clean(title, 60), body: clean(body, 200), type, read: false });
}

function creditBalance(userId, amount, points = 0) {
  const user = dbFindOne('users', u => u.id === userId);
  if (!user) return;
  dbUpdate('users', u => u.id === userId, {
    balance:    +(user.balance + amount).toFixed(2),
    vip_points: (user.vip_points || 0) + points,
  });
}

function refreshVip(userId) {
  const user = dbFindOne('users', u => u.id === userId);
  if (!user) return;
  const pts = user.vip_points || 0;
  const level = pts >= 10000 ? 5 : pts >= 5000 ? 4 : pts >= 2000 ? 3 : pts >= 500 ? 2 : 1;
  dbUpdate('users', u => u.id === userId, { vip_level: level });
}

// ── Motor de odds ao vivo ────────────────────────────────────
const liveGames = [
  { id:'l1', league:'Moçambola', flag:'🇲🇿', sport:'futebol',
    home:{ name:'Costa do Sol', abbr:'CDS', logo:'🔵', score:2 },
    away:{ name:'Ferroviário Maputo', abbr:'CFM', logo:'🔴', score:1 },
    minute:67, period:'2º Tempo', odds:{ h:1.45, d:3.80, a:6.20 }, events:[],
    stats:{ possession:[58,42], shots:[12,7], shotsOn:[5,3], corners:[6,3], fouls:[8,11] } },

  { id:'l2', league:'CAF Champions League', flag:'🏆', sport:'futebol',
    home:{ name:'Black Bulls', abbr:'BBU', logo:'⚫', score:0 },
    away:{ name:'UD Songo', abbr:'SON', logo:'🟢', score:0 },
    minute:34, period:'1º Tempo', odds:{ h:2.10, d:3.20, a:3.40 }, events:[],
    stats:{ possession:[45,55], shots:[4,6], shotsOn:[1,2], corners:[2,4], fouls:[6,7] } },

  { id:'l3', league:'Liga Moçambicana de Basquete', flag:'🇲🇿', sport:'basquete',
    home:{ name:'Ferroviário Maputo', abbr:'CFM', logo:'🔴', score:58 },
    away:{ name:'Maxaquene', abbr:'MAX', logo:'🟡', score:54 },
    minute:null, period:'Q3', odds:{ h:1.72, d:null, a:2.05 }, events:[],
    stats:{ possession:[52,48], shots:[24,21], shotsOn:[24,21], corners:[0,0], fouls:[12,9] } },

  { id:'l4', league:'ATP Masters 1000', flag:'🎾', sport:'tenis',
    home:{ name:'Alcaraz', abbr:'ALC', logo:'🇪🇸', score:6 },
    away:{ name:'Djokovic', abbr:'DJO', logo:'🇷🇸', score:4 },
    minute:null, period:'2º Set', odds:{ h:1.35, d:null, a:3.10 }, events:[],
    stats:{ possession:[50,50], shots:[18,14], shotsOn:[18,14], corners:[0,0], fouls:[2,3] } },

  { id:'l5', league:'Premier League', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', sport:'futebol',
    home:{ name:'Arsenal', abbr:'ARS', logo:'🔴', score:1 },
    away:{ name:'Chelsea', abbr:'CHE', logo:'🔵', score:1 },
    minute:78, period:'2º Tempo', odds:{ h:2.40, d:3.00, a:2.80 }, events:[],
    stats:{ possession:[54,46], shots:[10,8], shotsOn:[4,3], corners:[5,4], fouls:[9,13] } },

  { id:'l6', league:'CS2 – ESL Pro League', flag:'🎮', sport:'esports',
    home:{ name:'NAVI', abbr:'NAV', logo:'🇺🇦', score:13 },
    away:{ name:'FaZe', abbr:'FAZ', logo:'💀', score:11 },
    minute:null, period:'Mapa 2', odds:{ h:1.55, d:null, a:2.40 }, events:[],
    stats:{ possession:[52,48], shots:[0,0], shotsOn:[0,0], corners:[0,0], fouls:[0,0] } },
];

const EVENTS_POOL = {
  futebol: [
    { icon:'⚽', desc:'GOL! ',                 prob:.08, isGoal:true },
    { icon:'🟨', desc:'Cartão amarelo – ',      prob:.12 },
    { icon:'🟥', desc:'CARTÃO VERMELHO! ',      prob:.02, isRed:true },
    { icon:'🔄', desc:'Substituição – ',        prob:.10 },
    { icon:'⛳', desc:'Escanteio – ',           prob:.18 },
    { icon:'🎯', desc:'Chute na trave – ',      prob:.06 },
    { icon:'🩹', desc:'Falta perigosa – ',      prob:.15 },
    { icon:'🥅', desc:'Defesa do goleiro – ',   prob:.09 },
    { icon:'🚑', desc:'Lesão – ',               prob:.04 },
    { icon:'🏴', desc:'Impedimento anulado – ', prob:.06 },
  ],
  basquete: [
    { icon:'🏀', desc:'Cesta de 3 pontos – ', prob:.25 },
    { icon:'🎯', desc:'Bandeja – ',           prob:.30 },
    { icon:'🆓', desc:'Lance livre – ',       prob:.20 },
    { icon:'🔄', desc:'Substituição – ',      prob:.15 },
    { icon:'⛹', desc:'Falta – ',             prob:.10 },
  ],
  tenis: [
    { icon:'🎾', desc:'Ace – ',          prob:.25 },
    { icon:'💥', desc:'Break point – ',  prob:.20 },
    { icon:'🏆', desc:'Game vencido – ', prob:.35 },
    { icon:'❌', desc:'Dupla falta – ',  prob:.10 },
    { icon:'🎯', desc:'Winner – ',       prob:.10 },
  ],
  esports: [
    { icon:'💥', desc:'Clutch – ',      prob:.30 },
    { icon:'💣', desc:'Defuse – ',      prob:.20 },
    { icon:'🔫', desc:'Ace – ',         prob:.15 },
    { icon:'💰', desc:'Eco round – ',   prob:.20 },
    { icon:'🏆', desc:'Round ganho – ', prob:.15 },
  ],
};

const nudge = (v, r = 0.06) => v ? Math.max(1.01, +(v + (Math.random() - 0.5) * r).toFixed(2)) : null;

// A cada 5s as partidas evoluem: relógio, odds, eventos e estatísticas.
setInterval(() => {
  liveGames.forEach(g => {
    if (g.sport === 'futebol' && g.minute && g.minute < 90) g.minute++;

    g.odds.h = nudge(g.odds.h, 0.05);
    g.odds.d = nudge(g.odds.d, 0.05);
    g.odds.a = nudge(g.odds.a, 0.05);

    if (Math.random() > 0.82) {
      const pool = EVENTS_POOL[g.sport] || EVENTS_POOL.futebol;
      let cum = 0;
      const roll = Math.random();
      for (const ev of pool) {
        cum += ev.prob;
        if (roll >= cum) continue;

        const isHome = Math.random() > 0.5;
        g.events.unshift({ min: g.minute, icon: ev.icon, desc: ev.desc, team: isHome ? g.home.name : g.away.name });
        if (g.events.length > 12) g.events.pop();

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
          const pts = [1, 2, 2, 3][Math.floor(Math.random() * 4)];
          if (isHome) g.home.score += pts; else g.away.score += pts;
        }
        break;
      }
    }

    if (g.sport === 'futebol' && Math.random() > 0.7) {
      const side = Math.random() > 0.5 ? 0 : 1;
      if (Math.random() > 0.6)  g.stats.shots[side]++;
      if (Math.random() > 0.75) g.stats.corners[side]++;
      if (Math.random() > 0.8)  g.stats.fouls[side]++;
    }
  });

  // Resolve apostas pendentes com mais de 5 minutos.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  dbFind('bets', b => b.status === 'pending' && b.created_at < cutoff).forEach(bet => {
    // Chance de vitória cai conforme a margem da casa (0.48 no jogo justo).
    const won = Math.random() > (0.52 + HOUSE_EDGE * 0.4);
    dbUpdate('bets', b => b.id === bet.id, { status: won ? 'won' : 'lost', settled_at: new Date().toISOString() });
    if (won) {
      creditBalance(bet.user_id, bet.potential, Math.floor(bet.stake));
      notify(bet.user_id, '🏆 Aposta Ganha!', `${bet.selection} @ ${bet.odd} – Ganho: R$ ${bet.potential.toFixed(2)}`, 'win');
    } else {
      notify(bet.user_id, '❌ Aposta Perdida', `${bet.selection} – R$ ${bet.stake.toFixed(2)}`, 'loss');
    }
    refreshVip(bet.user_id);
  });
}, 5000);

// ── Autenticação ─────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

const publicUser = u => { const { password, bi, ...safe } = u; return safe; };

app.post('/api/auth/register', async (req, res) => {
  try {
    const name     = clean(req.body.name, 40);
    const lastName = clean(req.body.last_name, 40);
    const email    = clean(req.body.email, 120).toLowerCase();
    const bi       = clean(req.body.bi, 20);
    const phone    = clean(req.body.phone, 20);
    const password = String(req.body.password ?? '');

    if (!name || !email || !password)  return res.status(400).json({ error: 'Dados obrigatórios' });
    if (!isEmail(email))               return res.status(400).json({ error: 'E-mail inválido' });
    if (password.length < 6)           return res.status(400).json({ error: 'A senha precisa de ao menos 6 caracteres' });
    if (dbFindOne('users', u => u.email === email)) return res.status(400).json({ error: 'E-mail já registado' });

    const hash = await bcrypt.hash(password, 10);
    const user = dbInsert('users', {
      name, last_name: lastName, email, bi, phone,
      password: hash, balance: 50, vip_level: 1, vip_points: 0,
    });
    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
    notify(user.id, '🎉 Bem-vindo à ArenaBet!', `Olá ${name}! Bónus de 50,00 MT já disponível.`, 'info');
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('register:', e);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email    = clean(req.body.email, 120).toLowerCase();
    const password = String(req.body.password ?? '');
    const user = dbFindOne('users', u => u.email === email);
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    dbUpdate('users', u => u.id === user.id, { last_login: new Date().toISOString() });
    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('login:', e);
    res.status(500).json({ error: 'Erro ao entrar' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Não encontrado' });
  res.json(publicUser(user));
});

// ── Odds ─────────────────────────────────────────────────────
app.get('/api/odds/live', (_, res) => res.json(liveGames));

app.get('/api/odds/live/:id', (req, res) => {
  const game = liveGames.find(g => g.id === req.params.id);
  game ? res.json(game) : res.status(404).json({ error: 'Não encontrado' });
});

app.get('/api/odds/upcoming', (_, res) => res.json([
  { id:'u1', league:'Moçambola', flag:'🇲🇿', time:'Hoje 15:00', sport:'futebol', home:{name:'Maxaquene',logo:'🟡'}, away:{name:'Liga Desportiva',logo:'🔵'}, odds:{h:2.30,d:3.10,a:2.90}, filter:'hoje'   },
  { id:'u2', league:'Moçambola', flag:'🇲🇿', time:'Hoje 18:00', sport:'futebol', home:{name:'Ferroviário Beira',logo:'🔴'}, away:{name:'Textáfrica',logo:'🟢'}, odds:{h:2.70,d:3.00,a:2.50}, filter:'hoje'   },
  { id:'u3', league:'CAF Champions', flag:'🏆', time:'Hoje 20:00', sport:'futebol', home:{name:'Black Bulls',logo:'⚫'}, away:{name:'Mamelodi Sundowns',logo:'🟡'}, odds:{h:1.95,d:3.50,a:3.80}, filter:'hoje'   },
  { id:'u4', league:'Premier', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', time:'Amanhã 13:30', sport:'futebol', home:{name:'Arsenal',logo:'🔴'}, away:{name:'Liverpool',logo:'🔴'}, odds:{h:2.40,d:3.30,a:2.80}, filter:'amanha' },
  { id:'u5', league:'La Liga', flag:'🇪🇸', time:'Amanhã 17:00', sport:'futebol', home:{name:'Barcelona',logo:'🔵'}, away:{name:'Atletico',logo:'🔴'}, odds:{h:1.80,d:3.60,a:4.20}, filter:'amanha' },
  { id:'u6', league:'Moçambola', flag:'🇲🇿', time:'Sáb 16:00', sport:'futebol', home:{name:'UD Songo',logo:'🟢'}, away:{name:'Costa do Sol',logo:'🔵'}, odds:{h:1.60,d:3.80,a:5.50}, filter:'semana' },
  { id:'u7', league:'Premier', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', time:'Dom 15:30', sport:'futebol', home:{name:'Man City',logo:'🔵'}, away:{name:'Tottenham',logo:'⚪'}, odds:{h:1.55,d:4.00,a:5.80}, filter:'semana' },
  { id:'u8', league:'Taça de Moçambique', flag:'🇲🇿', time:'Dom 16:00', sport:'futebol', home:{name:'Ferroviário Maputo',logo:'🔴'}, away:{name:'Black Bulls',logo:'⚫'}, odds:{h:2.90,d:3.10,a:2.40}, filter:'semana' },
]));

// ── Apostas ──────────────────────────────────────────────────
app.post('/api/bets/place', auth, (req, res) => {
  const { selections } = req.body;
  const stake = Number(req.body.stake);

  // Toda entrada do cliente é validada antes de mexer no saldo.
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 20) {
    return res.status(400).json({ error: 'Seleções inválidas' });
  }
  if (!Number.isFinite(stake) || stake < 1 || stake > 1_000_000) {
    return res.status(400).json({ error: 'Valor de aposta inválido' });
  }
  for (const s of selections) {
    const odd = Number(s.odd);
    if (!Number.isFinite(odd) || odd < 1.01 || odd > 1000) {
      return res.status(400).json({ error: 'Odd inválida' });
    }
  }

  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (user.balance < stake) return res.status(400).json({ error: 'Saldo insuficiente' });

  const totalOdd  = selections.reduce((acc, s) => acc * Number(s.odd), 1);
  const potential = +(stake * totalOdd).toFixed(2);

  dbUpdate('users', u => u.id === user.id, {
    balance:    +(user.balance - stake).toFixed(2),
    vip_points: (user.vip_points || 0) + Math.floor(stake),
  });

  const betIds = selections.map(s => dbInsert('bets', {
    user_id:    user.id,
    match_name: clean(s.matchName, 80),
    market:     clean(s.market, 60),
    selection:  clean(s.label, 60),
    odd:        Number(s.odd),
    stake, potential, status: 'pending',
    game_id:    clean(s.gameId, 20),
  }).id);

  notify(user.id, '⚡ Aposta Realizada!', `${selections.map(s => clean(s.label, 30)).join(' + ')} – R$ ${stake.toFixed(2)}`);
  refreshVip(user.id);

  res.json({ success: true, betIds, newBalance: dbFindOne('users', u => u.id === user.id).balance, potential });
});

app.get('/api/bets/history', auth, (req, res) => {
  const status = clean(req.query.status, 20);
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  let rows = dbFind('bets', b => b.user_id === req.user.id);
  if (status) rows = rows.filter(b => b.status === status);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ bets: rows.slice(offset, offset + limit), total: rows.length });
});

app.get('/api/bets/stats', auth, (req, res) => {
  const bets = dbFind('bets', b => b.user_id === req.user.id);
  const won  = bets.filter(b => b.status === 'won');
  res.json({
    total:   bets.length,
    won:     won.length,
    lost:    bets.filter(b => b.status === 'lost').length,
    pending: bets.filter(b => b.status === 'pending').length,
    staked:  bets.reduce((s, b) => s + b.stake, 0),
    gained:  won.reduce((s, b) => s + b.potential, 0),
    winRate: bets.length ? ((won.length / bets.length) * 100).toFixed(1) : 0,
  });
});

app.post('/api/bets/cashout/:id', auth, (req, res) => {
  const bet = dbFindOne('bets', b => b.id === parseInt(req.params.id) && b.user_id === req.user.id);
  if (!bet) return res.status(404).json({ error: 'Aposta não encontrada' });
  if (bet.status !== 'pending') return res.status(400).json({ error: 'Não disponível para cash-out' });

  const cashoutVal = +(bet.potential * (0.70 + Math.random() * 0.20)).toFixed(2);
  dbUpdate('bets', b => b.id === bet.id, { status: 'cashout', cashout_val: cashoutVal, settled_at: new Date().toISOString() });
  creditBalance(req.user.id, cashoutVal, Math.floor(cashoutVal / 10));
  notify(req.user.id, '💰 Cash-Out Realizado', `R$ ${cashoutVal.toFixed(2)} creditado`, 'win');

  res.json({ success: true, cashoutVal, newBalance: dbFindOne('users', u => u.id === req.user.id).balance });
});

// ── Conta do usuário ─────────────────────────────────────────
app.get('/api/user/balance', auth, (req, res) => {
  const u = dbFindOne('users', u => u.id === req.user.id);
  res.json({ balance: u?.balance || 0, vip_level: u?.vip_level || 1, vip_points: u?.vip_points || 0 });
});

app.post('/api/user/deposit', auth, (req, res) => {
  const method = clean(req.body.method, 20);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 50 || amount > 1_000_000) {
    return res.status(400).json({ error: 'Valor inválido (mín. 50 MT)' });
  }
  dbInsert('deposits', { user_id: req.user.id, method, amount, status: 'completed' });
  creditBalance(req.user.id, amount, Math.floor(amount / 10));
  notify(req.user.id, '✅ Depósito Confirmado', `R$ ${amount.toFixed(2)} via ${method}`, 'win');
  refreshVip(req.user.id);
  res.json({ success: true, newBalance: dbFindOne('users', u => u.id === req.user.id).balance });
});

app.post('/api/user/withdraw', auth, (req, res) => {
  const method = clean(req.body.method, 20) || 'pix';
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: 'Valor inválido (mín. 100 MT)' });

  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });

  dbUpdate('users', u => u.id === user.id, { balance: +(user.balance - amount).toFixed(2) });
  dbInsert('withdrawals', { user_id: req.user.id, method, amount, status: 'pending' });
  notify(req.user.id, '🏦 Saque Solicitado', `R$ ${amount.toFixed(2)} em processamento`);
  res.json({ success: true, newBalance: dbFindOne('users', u => u.id === user.id).balance });
});

app.get('/api/user/transactions', auth, (req, res) => {
  const deps = dbFind('deposits',    d => d.user_id === req.user.id).map(d => ({ ...d, type: 'deposit'  }));
  const wds  = dbFind('withdrawals', w => w.user_id === req.user.id).map(w => ({ ...w, type: 'withdraw' }));
  res.json([...deps, ...wds].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get('/api/user/notifications', auth, (req, res) => {
  const notifs = dbFind('notifications', n => n.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20);
  res.json({ notifications: notifs, unread: notifs.filter(n => !n.read).length });
});

app.post('/api/user/notifications/read', auth, (req, res) => {
  dbUpdate('notifications', n => n.user_id === req.user.id, { read: true });
  res.json({ success: true });
});

app.put('/api/user/profile', auth, (req, res) => {
  dbUpdate('users', u => u.id === req.user.id, {
    name:      clean(req.body.name, 40),
    last_name: clean(req.body.last_name, 40),
  });
  res.json({ success: true });
});

app.put('/api/user/password', auth, async (req, res) => {
  const current = String(req.body.current ?? '');
  const newPass = String(req.body.newPass ?? '');
  if (newPass.length < 6) return res.status(400).json({ error: 'A nova senha precisa de ao menos 6 caracteres' });

  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user || !await bcrypt.compare(current, user.password)) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }
  dbUpdate('users', u => u.id === user.id, { password: await bcrypt.hash(newPass, 10) });
  res.json({ success: true });
});

app.post('/api/user/favorite', auth, (req, res) => {
  const type   = clean(req.body.type, 20);
  const ref_id = clean(req.body.ref_id, 40);
  const name   = clean(req.body.name, 80);
  const existing = dbFindOne('favorites', f => f.user_id === req.user.id && f.ref_id === ref_id);
  if (existing) {
    dbDelete('favorites', f => f.id === existing.id);
    return res.json({ favorited: false });
  }
  dbInsert('favorites', { user_id: req.user.id, type, ref_id, name });
  res.json({ favorited: true });
});

app.get('/api/user/favorites', auth, (req, res) => {
  res.json(dbFind('favorites', f => f.user_id === req.user.id));
});

// ── Busca e VIP ──────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = clean(req.query.q, 40).toLowerCase();
  if (q.length < 2) return res.json([]);
  const results = liveGames
    .filter(g => g.home.name.toLowerCase().includes(q) || g.away.name.toLowerCase().includes(q) || g.league.toLowerCase().includes(q))
    .slice(0, 8)
    .map(g => ({
      type: 'live', id: g.id,
      label: `${g.home.name} vs ${g.away.name}`,
      sub:   `${g.league} · AO VIVO`,
      score: `${g.home.score}–${g.away.score}`,
    }));
  res.json(results);
});

app.get('/api/vip/info', auth, (req, res) => {
  const user = dbFindOne('users', u => u.id === req.user.id);
  const levels = [
    { level:1, name:'Bronze',   minPoints:0,     maxPoints:499,   cashback:2,  oddBonus:0,  color:'#cd7f32' },
    { level:2, name:'Prata',    minPoints:500,   maxPoints:1999,  cashback:5,  oddBonus:.5, color:'#c0c0c0' },
    { level:3, name:'Ouro',     minPoints:2000,  maxPoints:4999,  cashback:8,  oddBonus:1,  color:'#ffd700' },
    { level:4, name:'Platina',  minPoints:5000,  maxPoints:9999,  cashback:12, oddBonus:2,  color:'#e5e4e2' },
    { level:5, name:'Diamante', minPoints:10000, maxPoints:null,  cashback:15, oddBonus:3,  color:'#b9f2ff' },
  ];
  const lvl = user?.vip_level || 1;
  res.json({
    vip_level: lvl,
    vip_points: user?.vip_points || 0,
    current: levels.find(l => l.level === lvl) || levels[0],
    next:    levels.find(l => l.level === lvl + 1) || null,
    levels,
  });
});

// ── Cassino (RNG no servidor — resultado decidido aqui, não dá pra trapacear) ──
const rng = () => crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF; // 0..1 uniforme

app.post('/api/casino/play', auth, (req, res) => {
  const game  = clean(req.body.game, 20);
  const stake = Number(req.body.stake);
  const pick  = req.body.pick;

  if (!Number.isFinite(stake) || stake < 1 || stake > 100000) return res.status(400).json({ error: 'Valor inválido' });
  const user = dbFindOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (user.balance < stake) return res.status(400).json({ error: 'Saldo insuficiente' });

  // Debita a aposta antes de resolver.
  dbUpdate('users', u => u.id === user.id, {
    balance:    +(user.balance - stake).toFixed(2),
    vip_points: (user.vip_points || 0) + Math.floor(stake),
  });

  let multiplier = 0, detail = {};

  if (game === 'crash') {
    const target = Math.max(1.01, Math.min(50, Number(pick) || 2));
    // Quanto maior o HOUSE_EDGE, mais cedo o foguete explode.
    const crash  = Math.max(1, +((1 - HOUSE_EDGE) / (1 - rng())).toFixed(2));
    if (target <= crash) multiplier = target;
    detail = { crash, target };

  } else if (game === 'roleta') {
    const n = Math.floor(rng() * 37); // 0..36
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const color = n === 0 ? 'green' : reds.includes(n) ? 'red' : 'black';
    detail = { number: n, color };
    if (pick === 'red' || pick === 'black') multiplier = pick === color ? 2 : 0;
    else if (pick === 'green')               multiplier = color === 'green' ? 14 : 0;
    else                                     multiplier = parseInt(pick) === n ? 36 : 0;

  } else if (game === 'slots') {
    const sym = ['🍒','🍋','🔔','⭐','💎','7️⃣'];
    const reels = [0,0,0].map(() => sym[Math.floor(rng() * sym.length)]);
    detail = { reels };
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      multiplier = { '🍒':5, '🍋':8, '🔔':12, '⭐':20, '💎':50, '7️⃣':100 }[reels[0]];
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      multiplier = 1.5;
    }

  } else if (game === 'double') {
    const r = rng();
    const result = r < 0.49 ? 'a' : r < 0.98 ? 'b' : 'tie';
    detail = { result };
    multiplier = pick === result ? (result === 'tie' ? 14 : 1.96) : 0;

  } else {
    return res.status(400).json({ error: 'Jogo inválido' });
  }

  // Margem da casa nos jogos sem crash: chance de anular o prêmio.
  // (No crash a margem já está embutida no ponto de explosão.)
  if (game !== 'crash' && multiplier > 0 && rng() < HOUSE_EDGE) multiplier = 0;

  const winnings = +(stake * multiplier).toFixed(2);
  if (winnings > 0) creditBalance(req.user.id, winnings);

  res.json({
    win: winnings > 0,
    multiplier, winnings, detail,
    newBalance: dbFindOne('users', u => u.id === req.user.id).balance,
  });
});

app.listen(PORT, () => {
  console.log(`\n  ⚡ ArenaBet → http://localhost:${PORT}\n`);
});
