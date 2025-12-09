# Self-Hosted Deployment

Deploy CodeGuard AI on your own infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Infrastructure                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────┐    ┌──────────┐    ┌──────────────────┐ │
│   │ Frontend │───▶│ Backend  │───▶│ PostgreSQL       │ │
│   │ (React)  │    │ (Express)│    │ (Database)       │ │
│   └──────────┘    └────┬─────┘    └──────────────────┘ │
│                        │                                 │
│                        ▼                                 │
│                  ┌───────────┐                          │
│                  │ Anthropic │                          │
│                  │    API    │                          │
│                  └───────────┘                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Requirements

- **Node.js 20+**
- **PostgreSQL 15+**
- **Anthropic API key**
- **Docker** (optional, recommended)

## Docker Deployment

### Using Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./packages/frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://backend:3001
    depends_on:
      - backend

  backend:
    build:
      context: ./packages/backend
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://codeguard:codeguard@db:5432/codeguard
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=codeguard
      - POSTGRES_PASSWORD=codeguard
      - POSTGRES_DB=codeguard
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Running

```bash
# Set your Anthropic API key
export ANTHROPIC_API_KEY="your-key"

# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f backend
```

## Manual Deployment

### 1. Database Setup

```bash
# Install PostgreSQL
sudo apt install postgresql

# Create database
sudo -u postgres psql << EOF
CREATE USER codeguard WITH PASSWORD 'your-password';
CREATE DATABASE codeguard OWNER codeguard;
GRANT ALL PRIVILEGES ON DATABASE codeguard TO codeguard;
EOF
```

### 2. Backend Setup

```bash
cd packages/backend

# Install dependencies
pnpm install

# Create .env file
cat > .env << EOF
DATABASE_URL=postgresql://codeguard:your-password@localhost:5432/codeguard
ANTHROPIC_API_KEY=your-anthropic-key
PORT=3001
EOF

# Run migrations
pnpm db:push

# Build and start
pnpm build
pnpm start
```

### 3. Frontend Setup

```bash
cd packages/frontend

# Install dependencies
pnpm install

# Create .env file
cat > .env << EOF
VITE_API_URL=http://localhost:3001
EOF

# Build
pnpm build

# Serve (use nginx or similar in production)
pnpm preview
```

## Production Configuration

### Environment Variables

#### Backend

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `PORT` | Server port | No (default: 3001) |

#### Frontend

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_URL` | Backend API URL | Yes |

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name codeguard.yourdomain.com;

    # Frontend
    location / {
        root /var/www/codeguard/frontend;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL with Let's Encrypt

```bash
sudo certbot --nginx -d codeguard.yourdomain.com
```

## CLI Configuration

Configure CLI to use your self-hosted instance:

```bash
# Set API URL
export CODEGUARD_API_URL="https://codeguard.yourdomain.com/api"

# Or edit config file
cat > ~/.codeguard.json << EOF
{
  "api_url": "https://codeguard.yourdomain.com/api",
  "api_key": "your-key"
}
EOF
```

## Scaling

### Horizontal Scaling

- Frontend: Serve from CDN or multiple instances behind load balancer
- Backend: Run multiple instances, use Redis for session storage
- Database: Use managed PostgreSQL with read replicas

### Performance Tuning

- Enable PostgreSQL connection pooling (PgBouncer)
- Configure proper indexes on database tables
- Use CDN for frontend assets
- Enable gzip compression

## Monitoring

### Health Checks

```bash
# Backend health
curl http://localhost:3001/health

# Response
{"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

### Logging

Logs are written to stdout. Use your preferred log aggregation:

```bash
# Docker
docker-compose logs -f backend | tee /var/log/codeguard/backend.log

# Systemd
journalctl -u codeguard-backend -f
```

## Backup

### Database Backup

```bash
# Backup
pg_dump -h localhost -U codeguard codeguard > backup.sql

# Restore
psql -h localhost -U codeguard codeguard < backup.sql
```

### Automated Backups

```bash
# Add to crontab
0 0 * * * pg_dump -h localhost -U codeguard codeguard | gzip > /backups/codeguard-$(date +\%Y\%m\%d).sql.gz
```
