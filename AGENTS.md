# Project rules

- Focus UI design, implementation, and verification on desktop screens.
- Ignore mobile screens. Do not add mobile-specific styling, mobile layout refinements, or mobile testing unless the user explicitly requests it.
- Verify code changes with `npm run typecheck` and `npm run lint` (ESLint). Skip `npm run build` unless the user explicitly requests a build.
