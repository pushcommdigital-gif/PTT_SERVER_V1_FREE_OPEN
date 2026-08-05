// Add-ons index — Community Edition.
//
// This file is INTENTIONALLY EMPTY. CE is the core dashboard with no paid pages
// registered; the commercial build replaces this module with one that imports
// its private pages and calls `registerRoute()` for each:
//
//   import { registerRoute } from './registry';
//   import { BackupsPage } from '@pushcomm/addons/backups';
//   registerRoute({ path: 'backups', component: BackupsPage, nav: { ... } });
//
// Do not add core pages here — those are declared directly in App.tsx.
// Imported for side effects by `main.tsx`.

export {};
