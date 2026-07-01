#!/usr/bin/env bash
# Render a Mimir audio-summary text file to MP3. The text is a throwaway intermediate written
# outside the repository by the skill. The final audio should normally be written under .mimir/audio.
#
# Engine via TTS_ENGINE (auto|edge|xtts|say|piper); default "auto" matches the global Voice Forge
# quality path:
#   edge  - edge-tts neural voices, single request (online). Default; clean on normal text.
#           Set TTS_SEGMENT=1 to render sentence-by-sentence for long-text truncation.
#   xtts  - local Coqui XTTS-v2 when installed.
#   say   - macOS built-in, offline, clean but robotic.
#   piper - local neural TTS.
#
# Usage:  forge-voice.sh <text-file> [voice]
# Env:    OUT_MP3                 explicit mp3 output path
#         TTS_ENGINE              force an engine (default: auto)
#         TTS_VOICE               voice/speaker (engine-specific); the [voice] arg overrides it
#         TTS_RATE                edge-tts speed delta, default +0%
#         TTS_SEGMENT=1           edge: render sentence-by-sentence
#         XTTS_SPEAKER            xtts preset speaker (default Ana Florence)
#         PIPER_MODEL             piper onnx model path
#         KEEP_TEXT=1             keep the source text file after a successful render
set -euo pipefail

TXT="${1:?usage: forge-voice.sh <text-file> [voice]}"
[ -f "$TXT" ] || { echo "error: file not found: $TXT" >&2; exit 1; }
VOICE="${2:-${TTS_VOICE:-}}"
ENGINE="${TTS_ENGINE:-auto}"
OUT_FINAL="${OUT_MP3:-${TXT%.txt}.mp3}"
OUTBASE="${OUT_FINAL%.mp3}"

cleanup() {
  [ "${KEEP_TEXT:-0}" = "1" ] || rm -f "$TXT"
  rm -f "${OUTBASE}.wav" "${OUTBASE}.aiff"
}
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XTTS_PY="${XTTS_PY:-$HOME/.local/share/voice-forge/xtts/bin/python}"
XTTS_HELPER="$SCRIPT_DIR/xtts-voice.py"

xtts_ready() { [ -x "$XTTS_PY" ] && [ -f "$XTTS_HELPER" ]; }

finish() {
  echo "$1"
  exit 0
}

to_mp3() {
  local src="$1" out="${OUTBASE}.mp3"
  if ! command -v ffmpeg >/dev/null 2>&1; then
    rm -f "$src"
    echo "error: ffmpeg is required to convert local TTS output to mp3" >&2
    exit 1
  fi
  if ffmpeg -y -loglevel error -i "$src" -ac 1 -c:a libmp3lame -q:a 4 "$out"; then
    rm -f "$src"
    finish "$out"
  fi
  rm -f "$src" "$out"
  echo "error: failed to convert local TTS output to mp3" >&2
  exit 1
}

if [ "$ENGINE" = "edge" ] || [ "$ENGINE" = "auto" ]; then
  if command -v edge-tts >/dev/null 2>&1; then
    OUT="${OUTBASE}.mp3"
    SPLIT="$SCRIPT_DIR/split-lines.py"
    voice="${VOICE:-fr-FR-DeniseNeural}"
    rate="${TTS_RATE:-+0%}"
    if [ "${TTS_SEGMENT:-0}" = "1" ] && [ -f "$SPLIT" ] \
       && command -v ffmpeg >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
      TMP="$(mktemp -d)"
      ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=24000:cl=mono -t 0.28 \
        -c:a libmp3lame -q:a 4 "$TMP/sil.mp3"
      i=0
      : > "$TMP/list.txt"
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        i=$((i + 1))
        if edge-tts --text "$line" --voice "$voice" --rate="$rate" \
          --write-media "$TMP/seg_$i.mp3" >/dev/null 2>&1; then
          printf "file '%s'\n" "$TMP/seg_$i.mp3" >> "$TMP/list.txt"
          printf "file '%s'\n" "$TMP/sil.mp3" >> "$TMP/list.txt"
        else
          echo "warn: edge-tts failed on a sentence, skipping it" >&2
        fi
      done < <(python3 "$SPLIT" "$TXT")
      ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" \
        -ac 1 -c:a libmp3lame -q:a 4 "$OUT"
      rm -rf "$TMP"
      finish "$OUT"
    fi
    edge-tts --file "$TXT" --voice "$voice" --rate="$rate" --write-media "$OUT" >/dev/null
    finish "$OUT"
  fi
  if [ "$ENGINE" = "edge" ]; then
    echo "error: TTS_ENGINE=edge but edge-tts not installed (pipx install edge-tts)" >&2
    exit 1
  fi
fi

if [ "$ENGINE" = "xtts" ] || { [ "$ENGINE" = "auto" ] && xtts_ready; }; then
  if ! xtts_ready; then
    echo "error: TTS_ENGINE=xtts but venv/helper missing ($XTTS_PY)" >&2
    exit 1
  fi
  WAV="${OUTBASE}.wav"
  if [ -n "$VOICE" ]; then
    COQUI_TOS_AGREED=1 "$XTTS_PY" "$XTTS_HELPER" "$TXT" "$WAV" "$VOICE" >&2
  else
    COQUI_TOS_AGREED=1 "$XTTS_PY" "$XTTS_HELPER" "$TXT" "$WAV" >&2
  fi
  to_mp3 "$WAV"
fi

if [ "$ENGINE" = "say" ] || [ "$ENGINE" = "auto" ]; then
  if command -v say >/dev/null 2>&1; then
    AIFF="${OUTBASE}.aiff"
    say -v "${VOICE:-Jacques}" -f "$TXT" -o "$AIFF" 2>/dev/null || say -f "$TXT" -o "$AIFF"
    to_mp3 "$AIFF"
  fi
  if [ "$ENGINE" = "say" ]; then
    echo "error: TTS_ENGINE=say but 'say' not available" >&2
    exit 1
  fi
fi

if [ "$ENGINE" = "piper" ] || [ "$ENGINE" = "auto" ]; then
  if command -v piper >/dev/null 2>&1; then
    WAV="${OUTBASE}.wav"
    piper -m "${PIPER_MODEL:-fr_FR-siwis-medium.onnx}" -f "$WAV" < "$TXT"
    to_mp3 "$WAV"
  fi
  if [ "$ENGINE" = "piper" ]; then
    echo "error: TTS_ENGINE=piper but piper not installed (pip install piper-tts)" >&2
    exit 1
  fi
fi

cat >&2 <<'EOF'
error: no TTS engine available. Install one:
  edge-tts (cleanest, online): pipx install edge-tts
  XTTS-v2 (local):
    uv venv --python 3.11 ~/.local/share/voice-forge/xtts
    uv pip install --python ~/.local/share/voice-forge/xtts/bin/python \
       coqui-tts 'transformers>=4.57,<5' 'torch==2.8.*' 'torchaudio==2.8.*'
  piper (local): pip install piper-tts
  ffmpeg: required for local engine MP3 conversion
EOF
exit 127
