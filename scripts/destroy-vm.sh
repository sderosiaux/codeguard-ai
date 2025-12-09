#!/bin/bash
set -euo pipefail

# =============================================================================
# CodeGuard AI - Destroy GCP VM
# =============================================================================
# Usage: ./destroy-vm.sh [--name=codeguard-ai] [--zone=us-central1-a]
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
echo "CodeGuard AI - Destroy VM"
echo "=========================================="
echo "VM Name: $VM_NAME"
echo "Zone:    $ZONE"
echo "=========================================="

# Check if VM exists
if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" &>/dev/null; then
    echo "VM '$VM_NAME' does not exist in zone '$ZONE'"
    exit 0
fi

# Confirm deletion
read -p "Are you sure you want to delete VM '$VM_NAME'? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Delete VM
echo "Deleting VM..."
gcloud compute instances delete "$VM_NAME" \
    --zone="$ZONE" \
    --quiet

echo ""
echo "=========================================="
echo "VM Deleted Successfully!"
echo "=========================================="
echo ""
echo "Note: Firewall rules were kept for reuse."
echo "To delete firewall rules:"
echo "  gcloud compute firewall-rules delete codeguard-ssh codeguard-http"
