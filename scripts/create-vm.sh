#!/bin/bash
set -euo pipefail

# =============================================================================
# CodeGuard AI - Create GCP VM
# =============================================================================
# Usage: ./create-vm.sh \
#   --database-url="postgresql://..." \
#   --anthropic-api-key="sk-ant-..." \
#   --domain="codeguard.example.com" \
#   [--name=codeguard-ai] \
#   [--zone=us-central1-a] \
#   [--machine-type=e2-standard-2]
# =============================================================================

# Default values
VM_NAME="codeguard-ai"
ZONE="us-central1-a"
MACHINE_TYPE="e2-standard-2"
IMAGE_FAMILY="ubuntu-2204-lts"
IMAGE_PROJECT="ubuntu-os-cloud"
BOOT_DISK_SIZE="50GB"
PORT="3001"

# Required variables
DATABASE_URL=""
ANTHROPIC_API_KEY=""
DOMAIN=""
GITHUB_TOKEN=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        --name=*)
            VM_NAME="${arg#*=}"
            ;;
        --zone=*)
            ZONE="${arg#*=}"
            ;;
        --machine-type=*)
            MACHINE_TYPE="${arg#*=}"
            ;;
        --database-url=*)
            DATABASE_URL="${arg#*=}"
            ;;
        --anthropic-api-key=*)
            ANTHROPIC_API_KEY="${arg#*=}"
            ;;
        --domain=*)
            DOMAIN="${arg#*=}"
            ;;
        --github-token=*)
            GITHUB_TOKEN="${arg#*=}"
            ;;
        --port=*)
            PORT="${arg#*=}"
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Required:"
            echo "  --database-url=URL        Neon PostgreSQL connection string"
            echo "  --anthropic-api-key=KEY   Anthropic API key for Claude"
            echo ""
            echo "Optional:"
            echo "  --name=NAME               VM name (default: codeguard-ai)"
            echo "  --zone=ZONE               GCP zone (default: us-central1-a)"
            echo "  --machine-type=TYPE       VM type (default: e2-standard-2)"
            echo "  --domain=DOMAIN           Domain for HTTPS (optional)"
            echo "  --github-token=TOKEN      GitHub token for private repos"
            echo "  --port=PORT               Backend port (default: 3001)"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ -z "$DATABASE_URL" ]; then
    echo "Error: --database-url is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: --anthropic-api-key is required"
    exit 1
fi

echo "=========================================="
echo "CodeGuard AI - Creating GCP VM"
echo "=========================================="
echo "VM Name:      $VM_NAME"
echo "Zone:         $ZONE"
echo "Machine Type: $MACHINE_TYPE"
echo "Domain:       ${DOMAIN:-'(none - HTTP only)'}"
echo "=========================================="

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTUP_SCRIPT="$SCRIPT_DIR/gcp-startup.sh"

if [ ! -f "$STARTUP_SCRIPT" ]; then
    echo "Error: Startup script not found at $STARTUP_SCRIPT"
    exit 1
fi

# Create firewall rules if they don't exist
echo "Checking firewall rules..."

if ! gcloud compute firewall-rules describe codeguard-ssh &>/dev/null; then
    echo "Creating SSH firewall rule..."
    gcloud compute firewall-rules create codeguard-ssh \
        --allow=tcp:22 \
        --target-tags=codeguard \
        --description="Allow SSH to CodeGuard AI VMs"
fi

if ! gcloud compute firewall-rules describe codeguard-http &>/dev/null; then
    echo "Creating HTTP/HTTPS firewall rule..."
    gcloud compute firewall-rules create codeguard-http \
        --allow=tcp:80,tcp:443 \
        --target-tags=codeguard \
        --description="Allow HTTP/HTTPS to CodeGuard AI VMs"
fi

# Build metadata string
METADATA="database-url=${DATABASE_URL}"
METADATA="${METADATA},anthropic-api-key=${ANTHROPIC_API_KEY}"
METADATA="${METADATA},port=${PORT}"

if [ -n "$DOMAIN" ]; then
    METADATA="${METADATA},domain=${DOMAIN}"
fi

if [ -n "$GITHUB_TOKEN" ]; then
    METADATA="${METADATA},github-token=${GITHUB_TOKEN}"
fi

# Create VM
echo "Creating VM..."
gcloud compute instances create "$VM_NAME" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --boot-disk-type=pd-ssd \
    --tags=codeguard \
    --metadata-from-file=startup-script="$STARTUP_SCRIPT" \
    --metadata="$METADATA"

# Get external IP
echo ""
echo "Waiting for VM to get external IP..."
sleep 5

EXTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" \
    --zone="$ZONE" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "=========================================="
echo "VM Created Successfully!"
echo "=========================================="
echo "Name:        $VM_NAME"
echo "External IP: $EXTERNAL_IP"
echo ""
echo "Monitor startup progress:"
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE -- tail -f /var/log/codeguard-startup.log"
echo ""
echo "SSH into VM:"
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE"
echo ""
if [ -n "$DOMAIN" ]; then
    echo "Once startup completes, access at:"
    echo "  https://$DOMAIN"
    echo ""
    echo "Don't forget to point $DOMAIN to $EXTERNAL_IP"
else
    echo "Once startup completes, access at:"
    echo "  http://$EXTERNAL_IP"
fi
echo "=========================================="
