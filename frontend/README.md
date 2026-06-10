# Frontend Sandbox

This folder is an isolated React + TypeScript + Tailwind sandbox for shadcn-style UI work.

The production LAN Hub UI still lives in `../web/` and is served by the Go app. Nothing in this folder is wired into `main.go` or `internal/server` yet.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
```

## Structure

- `src/components/ui/` contains reusable shadcn-style components.
- `src/components/demo/` contains demo-only usage examples.
- `src/lib/utils.ts` contains the shadcn-compatible `cn()` helper.
- `components.json` defines shadcn aliases for future CLI use.

## Integration Note

Before using this in the real app, decide whether the project will migrate from `web/` to React or keep this as a separate demo environment.
