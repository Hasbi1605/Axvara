// src/lib/warung-rebahan/sync.ts — thin eager barrel for the WR sync
// engine (3D-7). The engine lives in ./sync/* leaves; this specifier and
// its eager export surface are preserved for callers, mocks, and the
// standalone Workerd bundle.
export * from "./sync/index";
