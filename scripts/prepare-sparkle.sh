#!/usr/bin/env bash
set -euo pipefail

version=2.9.6
sha256=52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192
root="$(cd "$(dirname "$0")/.." && pwd)"
archive_dir="$(mktemp -d)"
trap 'rm -rf "$archive_dir"' EXIT

gh release download "$version" --repo sparkle-project/Sparkle \
  --pattern "Sparkle-$version.tar.xz" --dir "$archive_dir"
printf '%s  %s\n' "$sha256" "$archive_dir/Sparkle-$version.tar.xz" | shasum -a 256 -c -
tar -xf "$archive_dir/Sparkle-$version.tar.xz" -C "$archive_dir" \
  ./Sparkle.framework ./bin
rm -rf "$root/src-tauri/Sparkle.framework" "$root/src-tauri/sparkle-bin"
mv "$archive_dir/Sparkle.framework" "$root/src-tauri/Sparkle.framework"
mv "$archive_dir/bin" "$root/src-tauri/sparkle-bin"
