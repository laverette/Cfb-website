const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Allow all origins
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Open (or create) the database file
const db = new sqlite3.Database('./predictions.db');

// Create table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT,
  game1 TEXT, score1 TEXT,
  game2 TEXT, score2 TEXT,
  game3 TEXT, score3 TEXT,
  game4 TEXT, score4 TEXT,
  game5 TEXT, score5 TEXT,
  game6 TEXT, score6 TEXT,
  game7 TEXT, score7 TEXT,
  game8 TEXT, score8 TEXT,
  game9 TEXT, score9 TEXT,
  game10 TEXT, score10 TEXT,
  game11 TEXT, score11 TEXT,
  game12 TEXT, score12 TEXT,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.post('/submit-predictions', (req, res) => {
  const { user } = req.body;
  const values = [user];
  for (let i = 1; i <= 12; i++) {
    values.push(req.body[`game${i}`] || '');
    values.push(req.body[`score${i}`] || '');
  }
  const sql = `INSERT INTO predictions (
    user, game1, score1, game2, score2, game3, score3, game4, score4, game5, score5, game6, score6,
    game7, score7, game8, score8, game9, score9, game10, score10, game11, score11, game12, score12
  ) VALUES (${Array(25).fill('?').join(',')})`;
  db.run(sql, values, function(err) {
    if (err) return res.status(500).send('Database error');
    res.send('Prediction saved!');
  });
});
// ...existing code...
app.get('/submit-predictions', (req, res) => {
  res.send('This endpoint only accepts POST requests.');
});
// ...existing code...

app.listen(3000, () => console.log('Server running on port 3000'));