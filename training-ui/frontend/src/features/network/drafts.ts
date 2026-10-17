// Keep temporary modes when a tab is unmounted, without adding UI-only fields to TOML.
// Replacing the document on job switch/discard naturally isolates and releases these drafts.
export const adapterDrafts = new WeakMap<object, Record<string, any>>()
export const layerDrafts = new WeakMap<object, { source: string; value: any }>()
export const resumeDrafts = new WeakMap<object, string>()
