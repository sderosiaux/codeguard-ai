#!/bin/bash
set -euo pipefail

# =============================================================================
# CodeGuard AI - GCP VM Startup Script
# =============================================================================
# This script runs automatically on first boot via GCP instance metadata.
# It sets up the complete environment for CodeGuard AI.
# =============================================================================

LOG_FILE="/var/log/codeguard-startup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "CodeGuard AI - VM Startup Script"
echo "Started at: $(date)"
echo "=========================================="

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
get_metadata() {
    local key="$1"
    curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$key" \
        -H "Metadata-Flavor: Google" || echo ""
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# -----------------------------------------------------------------------------
# 1. Create Application User
# -----------------------------------------------------------------------------
log "Creating application user..."
APP_USER="codeguard"
APP_DIR="/opt/codeguard-ai"

if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$APP_USER"
    log "Created user: $APP_USER"
else
    log "User $APP_USER already exists"
fi

# -----------------------------------------------------------------------------
# 2. Install System Dependencies
# -----------------------------------------------------------------------------
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq build-essential curl git

# -----------------------------------------------------------------------------
# 3. Install Node.js 22.x
# -----------------------------------------------------------------------------
log "Installing Node.js 22.x..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
log "Node.js version: $(node --version)"
log "npm version: $(npm --version)"

# Install pnpm globally
log "Installing pnpm..."
npm install -g pnpm
log "pnpm version: $(pnpm --version)"

# -----------------------------------------------------------------------------
# 4. Clone Repository
# -----------------------------------------------------------------------------
log "Setting up repository..."
GITHUB_TOKEN=$(get_metadata "github-token")
REPO_URL="https://github.com/sderosiaux/codeguard-ai.git"

if [ -n "$GITHUB_TOKEN" ]; then
    REPO_URL="https://${GITHUB_TOKEN}@github.com/sderosiaux/codeguard-ai.git"
fi

if [ -d "$APP_DIR" ]; then
    log "Updating existing repository..."
    cd "$APP_DIR"
    git fetch --all
    git reset --hard origin/main
else
    log "Cloning repository..."
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# -----------------------------------------------------------------------------
# 5. Configure Environment Variables
# -----------------------------------------------------------------------------
log "Configuring environment..."

DATABASE_URL=$(get_metadata "database-url")
ANTHROPIC_API_KEY=$(get_metadata "anthropic-api-key")
PORT=$(get_metadata "port")
DOMAIN=$(get_metadata "domain")

# Backend .env
cat > "$APP_DIR/packages/backend/.env" <<EOF
DATABASE_URL="${DATABASE_URL}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
PORT=${PORT:-3001}
EOF

chmod 600 "$APP_DIR/packages/backend/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/packages/backend/.env"

log "Environment configured"

# -----------------------------------------------------------------------------
# 6. Install Claude CLI for Autonomous Analysis
# -----------------------------------------------------------------------------
log "Installing Claude CLI..."
npm install -g @anthropic-ai/claude-code

# Configure Claude for autonomous operation
CLAUDE_CONFIG_DIR="/home/$APP_USER/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"

cat > "$CLAUDE_CONFIG_DIR/settings.json" <<EOF
{
  "permissions": {
    "allow_all": true,
    "auto_approve": true
  },
  "preferences": {
    "verbose": false
  }
}
EOF

chown -R "$APP_USER:$APP_USER" "$CLAUDE_CONFIG_DIR"
chmod 700 "$CLAUDE_CONFIG_DIR"
chmod 600 "$CLAUDE_CONFIG_DIR/settings.json"

log "Claude CLI installed: $(claude --version 2>/dev/null || echo 'installed')"

# -----------------------------------------------------------------------------
# 7. Build Application
# -----------------------------------------------------------------------------
log "Building application..."
cd "$APP_DIR"

# Install dependencies
sudo -u "$APP_USER" pnpm install

# Build backend
cd "$APP_DIR/packages/backend"
sudo -u "$APP_USER" pnpm run build

# Build frontend
cd "$APP_DIR/packages/frontend"
sudo -u "$APP_USER" pnpm run build

log "Application built successfully"

# -----------------------------------------------------------------------------
# 8. Create Systemd Services
# -----------------------------------------------------------------------------
log "Creating systemd services..."

# Backend service
cat > /etc/systemd/system/codeguard-backend.service <<EOF
[Unit]
Description=CodeGuard AI Backend
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/packages/backend
EnvironmentFile=$APP_DIR/packages/backend/.env
Environment="PATH=/usr/bin:/usr/local/bin"
Environment="ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Frontend service (serve built files)
cat > /etc/systemd/system/codeguard-frontend.service <<EOF
[Unit]
Description=CodeGuard AI Frontend
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/packages/frontend
ExecStart=/usr/bin/npx serve -s dist -l 5173
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable codeguard-backend codeguard-frontend
systemctl start codeguard-backend codeguard-frontend

log "Services started"

# -----------------------------------------------------------------------------
# 9. Install and Configure Caddy (Reverse Proxy + HTTPS)
# -----------------------------------------------------------------------------
log "Installing Caddy..."
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy

# Configure Caddy
DOMAIN=$(get_metadata "domain")
if [ -n "$DOMAIN" ]; then
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    # API routes to backend
    handle /api/* {
        reverse_proxy localhost:3001
    }

    # Everything else to frontend
    handle {
        reverse_proxy localhost:5173
    }
}
EOF
else
    # Local/IP access only (no HTTPS)
    cat > /etc/caddy/Caddyfile <<EOF
:80 {
    handle /api/* {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:5173
    }
}
EOF
fi

systemctl restart caddy
log "Caddy configured"

# -----------------------------------------------------------------------------
# 10. Final Status
# -----------------------------------------------------------------------------
log "=========================================="
log "CodeGuard AI Setup Complete!"
log "=========================================="
log "Backend:  http://localhost:3001"
log "Frontend: http://localhost:5173"
if [ -n "$DOMAIN" ]; then
    log "Public:   https://$DOMAIN"
fi
log ""
log "Services:"
systemctl status codeguard-backend --no-pager || true
systemctl status codeguard-frontend --no-pager || true
log ""
log "Completed at: $(date)"
