# Phase 5: Backend Cleanup

- Corrupt watch history is preserved with a timestamped `.corrupt-*` name.
- Unreadable or incompatible history falls back to an explicit in-memory store instead of risking a nil handler dependency.
- Cache/history remains outside the shared folder as documented in phases 1-3.

Remaining: migrate every shared-file operation to `os.Root` to eliminate local symlink TOCTOU windows.
