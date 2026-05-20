#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${1:-${STAGE:-local}}"
LAYER_BIN_DIR="${ROOT_DIR}/layers/ffmpeg/bin"
FFMPEG_BIN="${LAYER_BIN_DIR}/ffmpeg"
FFPROBE_BIN="${LAYER_BIN_DIR}/ffprobe"
LEGACY_LAYER_URL="${FFMPEG_LAYER_URL:-}"
FFMPEG_PACKAGE_URL="${FFMPEG_LAYER_FFMPEG_URL:-https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz}"
FFPROBE_PACKAGE_URL="${FFMPEG_LAYER_FFPROBE_URL:-https://registry.npmjs.org/@ffprobe-installer/linux-x64/-/linux-x64-5.2.0.tgz}"

is_deploy_stage=false
if [[ "${STAGE}" != "local" && "${STAGE}" != "offline" ]]; then
    is_deploy_stage=true
fi

if [[ "${is_deploy_stage}" == "true" && "${SHORTS_FFMPEG_OVERLAY:-all}" == "off" && "${ALLOW_SHORTS_OVERLAY_OFF:-false}" != "true" ]]; then
    echo "SHORTS_FFMPEG_OVERLAY=off is blocked for stage ${STAGE}." >&2
    echo "Text overlay must be enabled for deployed Shorts composition. Set ALLOW_SHORTS_OVERLAY_OFF=true only for an intentional debug deployment." >&2
    exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "${tmp_dir}"
}
trap cleanup EXIT

run_overlay_smoke() {
    local ffmpeg_bin="$1"
    local smoke_dir="$2"
    local font_file="${ROOT_DIR}/assets/fonts/Jalnan2.otf"
    local drawtext_output="${smoke_dir}/overlay-drawtext.mp4"
    local ass_file="${smoke_dir}/overlay.ass"
    local ass_output="${smoke_dir}/overlay-ass.mp4"

    if [[ ! -f "${font_file}" ]]; then
        echo "Overlay smoke font missing: ${font_file}" >&2
        return 1
    fi

    if "${ffmpeg_bin}" -hide_banner -loglevel error -y \
        -f lavfi -i color=c=black:s=320x180:d=1 \
        -vf "drawtext=fontfile='${font_file}':text='TEST':x=12:y=12:fontsize=24:fontcolor=white" \
        -t 1 -c:v libx264 -pix_fmt yuv420p "${drawtext_output}" >/dev/null 2>&1; then
        echo "ffmpeg overlay smoke passed with drawtext"
        return 0
    fi

    cat >"${ass_file}" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Jalnan 2,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,TEST
ASS

    if [[ "${is_deploy_stage}" != "true" ]] && "${ffmpeg_bin}" -hide_banner -loglevel error -y \
        -f lavfi -i color=c=black:s=320x180:d=1 \
        -vf "subtitles=filename='${ass_file}':fontsdir='${ROOT_DIR}/assets/fonts'" \
        -t 1 -c:v libx264 -pix_fmt yuv420p "${ass_output}" >/dev/null 2>&1; then
        echo "ffmpeg overlay smoke passed with subtitles/libass"
        return 0
    fi

    echo "Prepared ffmpeg cannot render Shorts text overlays with drawtext." >&2
    echo "Deployed stages require drawtext because the subtitles/libass path has proven unsafe in Lambda runtime smoke." >&2
    return 1
}

run_overlay_smoke_with_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        return 2
    fi
    if ! docker info >/dev/null 2>&1; then
        return 2
    fi

    if docker run --rm --platform linux/amd64 \
        -v "${ROOT_DIR}:/work" \
        -w /work \
        --entrypoint /bin/bash \
        public.ecr.aws/lambda/nodejs:20 \
        -lc "mkdir -p /tmp/ffmpeg-smoke && scripts/prepare-ffmpeg-layer.sh local >/tmp/prepare.log && ./layers/ffmpeg/bin/ffmpeg -hide_banner -loglevel error -y -f lavfi -i color=c=black:s=320x180:d=1 -vf \"drawtext=fontfile='/work/assets/fonts/Jalnan2.otf':text='TEST':x=12:y=12:fontsize=24:fontcolor=white\" -t 1 -c:v libx264 -pix_fmt yuv420p /tmp/ffmpeg-smoke/drawtext.mp4" >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

validate_layer_static() {
    if ! command -v strings >/dev/null 2>&1; then
        echo "Cannot inspect Lambda ffmpeg binary statically because 'strings' is unavailable." >&2
        return 1
    fi

    local metadata
    metadata="$(strings "${FFMPEG_BIN}" 2>/dev/null || true)"

    if ! grep -Eq 'libx264|h264' <<<"${metadata}"; then
        echo "Prepared ffmpeg binary does not appear to include H.264 encoding support." >&2
        return 1
    fi
    if ! grep -Eq 'drawtext|Draw text on top of video frames' <<<"${metadata}"; then
        echo "Prepared ffmpeg binary does not appear to include drawtext support." >&2
        return 1
    fi

    echo "ffmpeg static capability check passed; executable smoke was skipped on this host."
    return 0
}

validate_layer() {
    local smoke_dir="${tmp_dir}/smoke"
    mkdir -p "${smoke_dir}"

    if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
        run_overlay_smoke "${FFMPEG_BIN}" "${smoke_dir}"
        return
    fi

    local docker_status=0
    run_overlay_smoke_with_docker || docker_status=$?
    if [[ "${docker_status}" == "0" ]]; then
        echo "ffmpeg overlay smoke passed in linux/amd64 Docker"
        return
    fi
    if [[ "${docker_status}" == "1" ]]; then
        echo "Lambda ffmpeg overlay smoke failed in linux/amd64 Docker." >&2
        echo "If Docker ran the container successfully, replace the ffmpeg layer with a build that can render drawtext overlays. If Docker/image pull failed, fix Docker and rerun this check." >&2
        return 1
    fi

    validate_layer_static
}

download_legacy_layer() {
    echo "Downloading static ffmpeg for Lambda x86_64 from FFMPEG_LAYER_URL..."
    curl --fail --location --silent --show-error "${LEGACY_LAYER_URL}" --output "${tmp_dir}/ffmpeg.tar.xz"
    tar -xJf "${tmp_dir}/ffmpeg.tar.xz" -C "${tmp_dir}"

    downloaded_ffmpeg="$(find "${tmp_dir}" -type f -name ffmpeg | head -n 1)"
    downloaded_ffprobe="$(find "${tmp_dir}" -type f -name ffprobe | head -n 1)"
}

download_default_layer() {
    local ffmpeg_dir="${tmp_dir}/ffmpeg-package"
    local ffprobe_dir="${tmp_dir}/ffprobe-package"
    mkdir -p "${ffmpeg_dir}" "${ffprobe_dir}"

    echo "Downloading drawtext-capable ffmpeg for Lambda x86_64..."
    curl --fail --location --silent --show-error "${FFMPEG_PACKAGE_URL}" --output "${tmp_dir}/ffmpeg.tgz"
    tar -xzf "${tmp_dir}/ffmpeg.tgz" -C "${ffmpeg_dir}"

    echo "Downloading ffprobe for Lambda x86_64..."
    curl --fail --location --silent --show-error "${FFPROBE_PACKAGE_URL}" --output "${tmp_dir}/ffprobe.tgz"
    tar -xzf "${tmp_dir}/ffprobe.tgz" -C "${ffprobe_dir}"

    downloaded_ffmpeg="$(find "${ffmpeg_dir}" -type f -name ffmpeg | head -n 1)"
    downloaded_ffprobe="$(find "${ffprobe_dir}" -type f -name ffprobe | head -n 1)"
}

if [[ -x "${FFMPEG_BIN}" && -x "${FFPROBE_BIN}" ]]; then
    echo "ffmpeg layer already prepared: ${LAYER_BIN_DIR}"
    if validate_layer; then
        exit 0
    fi
    if [[ -n "${LEGACY_LAYER_URL}" ]]; then
        exit 1
    fi
    echo "Existing ffmpeg layer failed validation; rebuilding with the default drawtext-capable layer."
    rm -f "${FFMPEG_BIN}" "${FFPROBE_BIN}"
fi

mkdir -p "${LAYER_BIN_DIR}"

downloaded_ffmpeg=""
downloaded_ffprobe=""
if [[ -n "${LEGACY_LAYER_URL}" ]]; then
    download_legacy_layer
else
    download_default_layer
fi

if [[ -z "${downloaded_ffmpeg}" ]]; then
    echo "Failed to find ffmpeg in downloaded archive" >&2
    exit 1
fi
if [[ -z "${downloaded_ffprobe}" ]]; then
    echo "Failed to find ffprobe in downloaded archive" >&2
    exit 1
fi

cp "${downloaded_ffmpeg}" "${FFMPEG_BIN}"
cp "${downloaded_ffprobe}" "${FFPROBE_BIN}"
chmod 755 "${FFMPEG_BIN}" "${FFPROBE_BIN}"

validate_layer

echo "Prepared ffmpeg Lambda layer at ${LAYER_BIN_DIR}"
