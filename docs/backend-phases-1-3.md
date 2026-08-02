# Backend Phases 1-3

Implemented: 2026-08-02

## Phase 1: Regression Coverage

- Added `httptest` coverage for public SPA assets, protected APIs, upload limits, ZIP output, and cross-origin mutations.
- Added path-resolution tests for traversal, absolute paths, and symlink escapes.
- Added configuration and filename-sanitization tests, including long Unicode names and extensions.

Run the standard backend checks:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
go mod tidy -diff
```

FFmpeg integration tests remain opt-in:

```sh
TEST_VIDEO_PATH=/path/to/video.mkv \
  go test ./internal/embed -run 'Test(Probe|Extract)_RealFile' -v
```

## Phase 2: Runtime and Access Control

- The SPA shell and its CSS/JavaScript are public so a fresh PIN-protected browser can render the existing login screen.
- All content APIs, including subtitle routes, remain protected when PIN mode is enabled.
- `config.json` validates ports, upload limits, and a configured `ffmpeg_path` plus sibling `ffprobe`.
- The configured FFmpeg and FFprobe paths are used by probing, playback, and embedded subtitles.
- Probe timeouts derive from the HTTP request context.
- Application cache and watch history now use the OS user cache directory (`<user-cache>/lan-hub`) rather than the shared folder.

## Phase 3: File Operations

- Client paths reject absolute paths and symlink escapes even when the requested child does not exist yet.
- Uploads use unique temporary files and atomically publish with a hard link, so concurrent same-name uploads receive distinct suffixes without replacing existing files.
- Uploads enforce per-file, total-request, and file-count limits. The defaults are 5 GiB per file and 32 files per request; set `upload_max_bytes` and `upload_max_files` in `config.json` to change them.
- ZIP creation aborts on read, walk, write, or client-cancellation errors instead of silently skipping failed files.
- Mutating routes reject browser requests whose `Origin` does not match the service host. Command-line clients without an `Origin` header remain supported.

## Remaining Ceiling

`files.ResolveSafe` now rejects known traversal and symlink escapes, but filesystem operations still resolve a string path after validation. A future `os.Root` migration can close local symlink race windows across every read/write/ZIP operation. It is intentionally separate because it changes all shared-file handlers at once.
