#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "----------------------------------------------------------------------"
echo "Checking Prerequisites..."
echo "----------------------------------------------------------------------"

if ! command -v node &> /dev/null; then
    echo ""
    echo "[INFO] Node.js is not installed. Attempting automatic installation..."
    echo ""

    if ! command -v curl &> /dev/null; then
        echo "[ERROR] curl is required for automatic Node.js installation but was not found."
        echo "Please install curl (e.g. sudo apt install curl) or install Node.js manually from: https://nodejs.org/"
        echo ""
        exit 1
    fi

    NODE_INSTALLED=0

    # Fetch the latest Node.js major version number from the release index
    NODE_MAJOR=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9]*' | head -1 | grep -o '[0-9]*$')
    if [ -z "$NODE_MAJOR" ]; then
        echo "[WARN] Could not determine latest Node.js version. Defaulting to current channel."
        NODE_MAJOR="current"
    fi
    echo "Latest Node.js major version: $NODE_MAJOR"

    # Try package managers in order of preference
    if command -v apt-get &> /dev/null; then
        echo "Detected apt-get (Debian/Ubuntu). Installing Node.js..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - && \
        sudo apt-get install -y nodejs && NODE_INSTALLED=1

    elif command -v dnf &> /dev/null; then
        echo "Detected dnf (Fedora/RHEL). Installing Node.js..."
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo bash - && \
        sudo dnf install -y nodejs && NODE_INSTALLED=1

    elif command -v yum &> /dev/null; then
        echo "Detected yum (CentOS/RHEL). Installing Node.js..."
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo bash - && \
        sudo yum install -y nodejs && NODE_INSTALLED=1

    elif command -v pacman &> /dev/null; then
        echo "Detected pacman (Arch Linux). Installing Node.js..."
        sudo pacman -Sy --noconfirm nodejs npm && NODE_INSTALLED=1

    elif command -v zypper &> /dev/null; then
        echo "Detected zypper (openSUSE). Installing Node.js..."
        sudo zypper install -y nodejs npm && NODE_INSTALLED=1

    elif command -v brew &> /dev/null; then
        echo "Detected Homebrew. Installing Node.js..."
        brew install node && NODE_INSTALLED=1

    else
        echo "[ERROR] No supported package manager found (apt, dnf, yum, pacman, zypper, brew)."
        echo "Please install Node.js manually from: https://nodejs.org/"
        echo ""
        exit 1
    fi

    if [ "$NODE_INSTALLED" -ne 1 ]; then
        echo ""
        echo "[ERROR] Node.js installation failed."
        echo "Please install Node.js manually from: https://nodejs.org/"
        echo ""
        exit 1
    fi

    if ! command -v node &> /dev/null; then
        echo ""
        echo "[ERROR] Node.js still not found after installation."
        echo "Try opening a new terminal and running this script again."
        echo ""
        exit 1
    fi
fi

echo "Node.js detected."
echo ""

# Detect Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
else
    echo ""
    echo "[ERROR] Python is not installed!"
    echo "Please install Python 3.10 or newer."
    echo ""
    exit 1
fi

PY_MAJOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.major)")
PY_MINOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.minor)")
PY_VER="$PY_MAJOR.$PY_MINOR"

if [ "$PY_MAJOR" -ne 3 ] || [ "$PY_MINOR" -lt 10 ]; then
    echo ""
    echo "[ERROR] Python $PY_VER is too old. Minimum required: Python 3.10."
    echo "Please install Python 3.10 - 3.13 from: https://www.python.org/downloads/"
    echo ""
    exit 1
fi


node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)" || {
    echo "[ERROR] Node.js 20.19 or 22.12 and newer is required for the UI build."
    exit 1
}
"$PYTHON_CMD" scripts/bootstrap_environment.py || exit 1
cd training-ui
npm ci && npm --prefix frontend ci && npm --prefix frontend run build || exit 1
echo "Main control environment and UI ready. Install models from Global Settings."
