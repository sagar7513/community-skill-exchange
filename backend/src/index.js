const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'skilluser',
  password: process.env.DB_PASS || 'skillpass',
  database: process.env.DB_NAME || 'skilldb',
  port: process.env.DB_PORT || 5432,
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'cache', 
  port: 6379,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS skills (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      offered_skills JSONB DEFAULT '[]',
      wanted_skills JSONB DEFAULT '[]'
    );
  `);

  const res = await pool.query('SELECT COUNT(*)::int AS cnt FROM skills;');
  if (res.rows[0].cnt === 0) {
    const initial = ['Python','Photography','React','Node.js','Guitar','Spanish','Data Analysis'];
    for (let s of initial) {
      await pool.query('INSERT INTO skills(name) VALUES($1) ON CONFLICT (name) DO NOTHING', [s]);
    }
    console.log('Seeded skills');
  }
}

app.get('/health', (req, res) => res.json({ok:true}));

app.get('/skills', async (req, res) => {
  try {
    const cached = await redis.get('skills_all');
    if (cached) return res.json(JSON.parse(cached));
    const result = await pool.query('SELECT * FROM skills ORDER BY name;');
    await redis.set('skills_all', JSON.stringify(result.rows), 'EX', 60);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'server error'});
  }
});

app.post('/skills', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  try {
    const r = await pool.query('INSERT INTO skills(name) VALUES($1) ON CONFLICT (name) DO NOTHING RETURNING *', [name]);
    await redis.del('skills_all');
    res.json(r.rows[0] || {ok:true});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'server error'});
  }
});

app.post('/users', async (req, res) => {
  const { name, offered_skills, wanted_skills } = req.body;
  if (!name) return res.status(400).json({error:'name required'});
  try {
    const result = await pool.query(
      'INSERT INTO users(name, offered_skills, wanted_skills) VALUES($1,$2,$3) RETURNING *',
      [name, JSON.stringify(offered_skills||[]), JSON.stringify(wanted_skills||[])]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'server error'});
  }
});

app.get('/users', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, offered_skills, wanted_skills FROM users ORDER BY id;');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'server error'});
  }
});

app.get('/matches/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({error:'invalid user id'});
  try {
    const u = await pool.query('SELECT * FROM users WHERE id=$1', [userId]);
    if (u.rowCount === 0) return res.status(404).json({error:'user not found'});
    const user = u.rows[0];
    const offered = user.offered_skills || [];
    const wanted = user.wanted_skills || [];

    const all = await pool.query('SELECT id, name, offered_skills, wanted_skills FROM users WHERE id <> $1', [userId]);
    const matches = [];
    for (let other of all.rows) {
      const otherOff = other.offered_skills || [];
      const otherWant = other.wanted_skills || [];

      const offerMatch = offered.some(s => otherWant.includes(s));
      const wantMatch = wanted.some(s => otherOff.includes(s));
      if (offerMatch && wantMatch) {
        matches.push({
          id: other.id,
          name: other.name,
          offered_skills: otherOff,
          wanted_skills: otherWant
        });
      }
    }
    res.json(matches);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'server error'});
  }
});

const port = process.env.PORT || 5000;
initDb().then(() => {
  app.listen(port, () => console.log('Backend running on port', port));
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
