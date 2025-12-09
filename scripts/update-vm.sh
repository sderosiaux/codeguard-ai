#!/bin/bash
set -euo pipefail

# =============================================================================
# CodeGuard AI - Update Running VM
# =============================================================================
# Usage: ./update-vm.sh [--name=codeguard-ai] [--zone=us-central1-a]
#
# This script pulls the latest code, rebuilds, and restarts services.
# =============================================================================

VM_NAME="codeguard-ai"
ZONE="us-central1-a"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --name=*)
            VM_NAME="${arg#*=}"
            ;;
        --zone=*)
            ZONE="${arg#*=}"
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --name=NAME    VM name (default: codeguard-ai)"
            echo "  --zone=ZONE    GCP zone (default: us-central1-a)"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

echo "=========================================="
echo "CodeGuard AI - Update VM"
echo "=========================================="
echo "VM Name: $VM_NAME"
echo "Zone:    $ZONE"
echo "=========================================="

# Run update commands on VM
gcloud compute ssh "$VM_NAME" --zone="$ZONE" -- bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

APP_DIR="/opt/codeguard-ai"
APP_USER="codeguard"

echo "Pulling latest code..."
cd "$APP_DIR"
sudo -u "$APP_USER" git fetch --all
sudo -u "$APP_USER" git reset --hard origin/main

echo "Installing dependencies..."
sudo -u "$APP_USER" pnpm install

echo "Building backend..."
cd "$APP_DIR/packages/backend"
sudo -u "$APP_USER" pnpm run build

echo "Building frontend..."
cd "$APP_DIR/packages/frontend"
sudo -u "$APP_USER" pnpm run build

echo "Restarting services..."
sudo systemctl restart codeguard-backend codeguard-frontend

echo "Checking service status..."
sudo systemctl status codeguard-backend --no-pager
sudo systemctl status codeguard-frontend --no-pager

echo ""
echo "Update complete!"
REMOTE_SCRIPT

echo ""
echo "=========================================="
echo "VM Updated Successfully!"
echo "=========================================="
