#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAYER_BIN_DIR="${ROOT_DIR}/layers/ffmpeg/bin"
FFMPEG_BIN="${LAYER_BIN_DIR}/ffmpeg"
DOWNLOAD_URL="${FFMPEG_LAYER_URL:-https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz}"

if [[ -x "${FFMPEG_BIN}" ]]; then
    echo "ffmpeg layer already prepared: ${LAYER_BIN_DIR}"
    exit 0
fi

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "${tmp_dir}"
}
trap cleanup EXIT

mkdir -p "${LAYER_BIN_DIR}"

echo "Downloading static ffmpeg for Lambda x86_64..."
curl --fail --location --silent --show-error "${DOWNLOAD_URL}" --output "${tmp_dir}/ffmpeg.tar.xz"
tar -xJf "${tmp_dir}/ffmpeg.tar.xz" -C "${tmp_dir}"

downloaded_ffmpeg="$(find "${tmp_dir}" -type f -name ffmpeg | head -n 1)"

if [[ -z "${downloaded_ffmpeg}" ]]; then
    echo "Failed to find ffmpeg in downloaded archive" >&2
    exit 1
fi

cp "${downloaded_ffmpeg}" "${FFMPEG_BIN}"
chmod 755 "${FFMPEG_BIN}"

echo "Prepared ffmpeg Lambda layer at ${LAYER_BIN_DIR}"
