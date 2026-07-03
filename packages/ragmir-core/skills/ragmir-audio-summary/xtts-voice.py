#!/usr/bin/env python3
"""Render a text file to WAV with Coqui XTTS-v2.

Run with the dedicated venv interpreter:
  ~/.local/share/voice-forge/xtts/bin/python xtts-voice.py <text.txt> <out.wav> [speaker]

Env: XTTS_SPEAKER (preset name), XTTS_LANG (default "fr").
"""
import os
import sys

os.environ.setdefault("COQUI_TOS_AGREED", "1")


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: xtts-voice.py <text.txt> <out.wav> [speaker]")
    text_file, out_wav = sys.argv[1], sys.argv[2]
    speaker = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("XTTS_SPEAKER", "Ana Florence")
    language = os.environ.get("XTTS_LANG", "fr")

    with open(text_file, encoding="utf-8") as handle:
        text = handle.read().strip()
    if not text:
        sys.exit("error: empty text file")

    from TTS.api import TTS

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    speakers = list(getattr(tts, "speakers", None) or [])
    if speakers and speaker not in speakers:
        sys.stderr.write(f"speaker '{speaker}' not found; falling back to '{speakers[0]}'\n")
        speaker = speakers[0]

    tts.tts_to_file(
        text=text,
        speaker=speaker,
        language=language,
        file_path=out_wav,
        split_sentences=True,
    )
    print(out_wav)


if __name__ == "__main__":
    main()
