#!/bin/bash
# Generates llms-full.txt by compiling existing markdown files
# Run this script after modifying README.md or CONTRIBUTING.md
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DOCS_DIR="$ROOT_DIR/docs"
OUTPUT="$DOCS_DIR/llms-full.txt"

cat > "$OUTPUT" << 'HEADER'
# Tambourine - Complete Documentation

> Open-source AI voice dictation platform. Real-time speech-to-text with AI formatting,
> multi-provider support (Groq, Deepgram, Whisper, etc.), cross-platform desktop app.

HEADER

# Append README (skip image badges and HTML at the top)
echo "## Project Overview" >> "$OUTPUT"
echo "" >> "$OUTPUT"
sed -n '/^## Why/,$p' "$ROOT_DIR/README.md" >> "$OUTPUT"

# Append Contributing guide
echo -e "\n---\n\n## Contributing Guide\n" >> "$OUTPUT"
cat "$ROOT_DIR/CONTRIBUTING.md" >> "$OUTPUT"

echo "Generated: $OUTPUT"
