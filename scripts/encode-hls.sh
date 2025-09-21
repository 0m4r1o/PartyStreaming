#!/usr/bin/env bash
set -euo pipefail
IN="$1"; NAME="${2:-family}"
OUT="public/videos/$NAME"; mkdir -p "$OUT"
# Single bitrate copy-fast if compatible; else transcode to H.264 + AAC
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$IN" | grep -qi h264 || NEED_TX=1 || true

if [ "${NEED_TX:-0}" = 1 ]; then
  echo "Transcoding to H.264/AAC..."
  ffmpeg -y -i "$IN" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 160k     -f hls -hls_time 6 -hls_list_size 0 -hls_segment_filename "$OUT/segment%03d.ts" "$OUT/playlist.m3u8"
else
  echo "Stream-copy to HLS..."
  ffmpeg -y -i "$IN" -c copy -f hls -hls_time 6 -hls_list_size 0     -hls_segment_filename "$OUT/segment%03d.ts" "$OUT/playlist.m3u8"
fi

echo "Done: /$OUT/playlist.m3u8"