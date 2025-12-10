#!/bin/bash
set -euo pipefail

# =============================================================================
# CodeGuard AI - Update Running VM (Backend Only)
# =============================================================================
# Usage: ./update-vm.sh [--name=codeguard-ai] [--zone=us-central1-a]
#
# This script pulls the latest code, rebuilds, and restarts the backend.
# Note: Frontend is deployed on Vercel, not on the VM.
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
echo "CodeGuard AI - Update VM (Backend)"
echo "=========================================="
echo "VM Name: $VM_NAME"
echo "Zone:    $ZONE"
echo "=========================================="

# Run update commands on VM
gcloud compute ssh "$VM_NAME" --zone="$ZONE" -- bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

APP_DIR="/opt/codeguard-ai"

echo "Pulling latest code..."
cd "$APP_DIR"
git fetch --all
git reset --hard origin/main

echo "Installing dependencies..."
CI=true pnpm install

echo "Building backend..."
cd "$APP_DIR/packages/backend"
pnpm run build

echo "Restarting backend service..."
sudo systemctl restart codeguard-backend

echo "Checking service status..."
sleep 2
sudo systemctl status codeguard-backend --no-pager

echo ""
echo "Update complete!"
REMOTE_SCRIPT

echo ""
echo "=========================================="
echo "VM Backend Updated Successfully!"
echo "=========================================="
