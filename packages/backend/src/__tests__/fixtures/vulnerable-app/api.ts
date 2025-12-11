import express from 'express';
import { exec } from 'child_process';

const app = express();
app.use(express.json());

// VULNERABILITY: SQL Injection - string concatenation in query
app.get('/users', async (req, res) => {
  const { name } = req.query;
  const query = `SELECT * FROM users WHERE name = '${name}'`; // SQL INJECTION!
  // Would execute malicious SQL if name = "'; DROP TABLE users; --"
  res.json({ query });
});

// VULNERABILITY: Command Injection - unsanitized user input in shell
app.post('/ping', (req, res) => {
  const { host } = req.body;
  exec(`ping -c 1 ${host}`, (error, stdout) => { // COMMAND INJECTION!
    // Would execute arbitrary commands if host = "localhost; rm -rf /"
    res.json({ output: stdout });
  });
});

// VULNERABILITY: Hardcoded secret
const API_KEY = 'sk-1234567890abcdef'; // HARDCODED SECRET!

// VULNERABILITY: Empty catch block - swallowed exception
app.get('/data', async (req, res) => {
  try {
    const data = await fetch('https://api.example.com/data');
    res.json(await data.json());
  } catch (e) {
    // SWALLOWED EXCEPTION - no logging, no error response
  }
});

// VULNERABILITY: No error handling on async operation
app.post('/process', (req, res) => {
  fetch('https://api.example.com/process', {
    method: 'POST',
    body: JSON.stringify(req.body),
  }); // FIRE AND FORGET - no await, no error handling!
  res.json({ status: 'processing' });
});

// VULNERABILITY: Race condition - check-then-act
let balance = 1000;
app.post('/withdraw', async (req, res) => {
  const { amount } = req.body;
  if (balance >= amount) { // CHECK
    await new Promise(r => setTimeout(r, 100)); // Simulate async
    balance -= amount; // ACT - race condition!
    res.json({ balance });
  } else {
    res.status(400).json({ error: 'Insufficient funds' });
  }
});

export default app;
