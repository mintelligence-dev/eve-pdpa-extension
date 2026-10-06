// Dictionary registry. Empty in 0.1 by design: names and addresses are 0.2, and
// every 0.1 entity is regex + checksum.
//
// This entry point exists from the first commit so the size budget can separate
// "code" from "data". Without it, budget lines 3 and 4 in .size-limit.json
// would silently measure the same thing.
//
// Every dataset added here must have its source and licence recorded in
// data/LICENCES.md. The dictionary ships inside core, so unlike the optional
// NER model it is something every single user installs.

export interface DictionaryEntry {
  readonly id: string
  readonly licence: string
  readonly lookup: (word: string) => boolean
}

export const DICTIONARIES: readonly DictionaryEntry[] = []

export function hasDictionary(id: string): boolean {
  return DICTIONARIES.some((d) => d.id === id)
}
