// Add-ons index — Community Edition.
//
// This file is INTENTIONALLY EMPTY. CE is the core console with no paid panels
// registered; the commercial build replaces this module with one that imports
// its private panels and calls `registerPanel()` for each:
//
//   import { registerPanel } from './registry';
//   import { LiveAudioTrafficPanel } from '@pushcomm/addons/transcription';
//   registerPanel({ id: 'liveAudio', title: 'Live Audio Traffic', ... });
//
// Do not add core panels here — those are rendered directly by DispatchConsole.
// Imported for side effects by `main.tsx`.

export {};
