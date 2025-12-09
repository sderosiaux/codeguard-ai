// Load environment variables FIRST (before any imports that use them)
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import reposRouter from './routes/repos.js';
import filesRouter from './routes/files.js';
import issuesRouter from './routes/issues.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/repos', reposRouter);
app.use('/api/repos', filesRouter);
app.use('/api/repos', issuesRouter);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Database: ${process.env.DATABASE_URL || 'postgresql://codeguard:codeguard@localhost:5432/codeguard'}`);
});
