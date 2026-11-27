#!/bin/sh
# Builds public/js/native/imgkit.wasm (needs clang with the wasm32 target and wasm-ld; no Emscripten).
set -e; cd "$(dirname "$0")"
clang++ --target=wasm32 -O3 -msimd128 -nostdlib -fno-exceptions -fno-rtti -ffreestanding -fno-builtin -mbulk-memory \
  -Wl,--no-entry -Wl,--export=__heap_base -Wl,--initial-memory=1048576 -Wl,--max-memory=1073741824 -Wl,--strip-all \
  -o ../../public/js/native/imgkit.wasm imgkit.cpp
ls -la ../../public/js/native/imgkit.wasm
