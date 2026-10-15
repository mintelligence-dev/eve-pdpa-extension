// A small JSON Schema 2020-12 validator — only the keywords the two shipped schemas use.
// No dependencies are allowed here, so this is written from the spec. An unknown keyword
// throws, so a schema that grows a keyword cannot be "validated" by silently skipping it.

const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  'examples',
  '$defs',
])
const KNOWN = new Set([
  ...ANNOTATIONS,
  '$ref',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'minItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
])

export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function typeOk(t, v) {
  switch (t) {
    case 'null':
      return v === null
    case 'boolean':
      return typeof v === 'boolean'
    case 'string':
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'integer':
      return Number.isInteger(v)
    case 'array':
      return Array.isArray(v)
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    default:
      throw new Error(`unknown type ${t}`)
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new Error(`only local $ref supported: ${ref}`)
  let node = root
  for (const part of ref.slice(1).split('/').filter(Boolean)) {
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (node === undefined) throw new Error(`$ref not found: ${ref}`)
  }
  return node
}

function regexOk(source) {
  for (const flags of ['u', '']) {
    try {
      new RegExp(source, flags)
      return true
    } catch {}
  }
  return false
}

/** Returns a list of error strings; empty means valid. */
export function validate(schema, value, root = schema, path = '$') {
  if (schema === true) return []
  if (schema === false) return [`${path}: schema false`]
  const errors = []
  const err = (msg) => errors.push(`${path}: ${msg}`)
  for (const k of Object.keys(schema))
    if (!KNOWN.has(k)) throw new Error(`schema keyword not supported by this validator: ${k}`)

  if (schema.$ref) errors.push(...validate(resolveRef(root, schema.$ref), value, root, path))
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => typeOk(t, value)))
      err(`type ${JSON.stringify(schema.type)} expected, got ${JSON.stringify(value)}`)
  }
  if ('const' in schema && !deepEqual(schema.const, value))
    err(`const ${JSON.stringify(schema.const)} expected, got ${JSON.stringify(value)}`)
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value)))
    err(`one of ${JSON.stringify(schema.enum)} expected, got ${JSON.stringify(value)}`)

  if (typeof value === 'string') {
    const len = [...value].length
    if (schema.minLength !== undefined && len < schema.minLength)
      err(`shorter than ${schema.minLength}`)
    if (schema.maxLength !== undefined && len > schema.maxLength)
      err(`longer than ${schema.maxLength} (${len})`)
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      err(`does not match ${schema.pattern}: ${JSON.stringify(value)}`)
    if (
      schema.format === 'date-time' &&
      (Number.isNaN(Date.parse(value)) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value))
    )
      err(`not a date-time: ${value}`)
    if (schema.format === 'regex' && !regexOk(value)) err(`not a valid regex: ${value}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      err(`below minimum ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      err(`above maximum ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      err(`fewer than ${schema.minItems} items`)
    if (schema.uniqueItems && value.some((x, i) => value.findIndex((y) => deepEqual(x, y)) !== i))
      err('items not unique')
    if (schema.items !== undefined)
      value.forEach((x, i) => errors.push(...validate(schema.items, x, root, `${path}[${i}]`)))
  }
  if (typeOk('object', value)) {
    const props = schema.properties ?? {}
    for (const r of schema.required ?? [])
      if (!Object.hasOwn(value, r)) err(`missing required ${r}`)
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) errors.push(...validate(props[k], v, root, `${path}.${k}`))
      else if (schema.additionalProperties === false) err(`unexpected property ${k}`)
      else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true)
        errors.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`))
      if (schema.propertyNames)
        errors.push(...validate(schema.propertyNames, k, root, `${path}{${k}}`))
    }
    for (const [k, deps] of Object.entries(schema.dependentRequired ?? {})) {
      if (Object.hasOwn(value, k))
        for (const d of deps) if (!Object.hasOwn(value, d)) err(`${k} requires ${d}`)
    }
    for (const [k, sub] of Object.entries(schema.dependentSchemas ?? {})) {
      if (Object.hasOwn(value, k))
        errors.push(...validate(sub, value, root, path).map((e) => `${e} (dependentSchemas ${k})`))
    }
  }
  for (const sub of schema.allOf ?? []) errors.push(...validate(sub, value, root, path))
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, root, path).length === 0))
    err('matches none of anyOf')
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validate(s, value, root, path).length === 0).length
    if (n !== 1) err(`matches ${n} of oneOf (exactly 1 required)`)
  }
  if (schema.not && validate(schema.not, value, root, path).length === 0)
    err('matches a schema under not')
  if (schema.if !== undefined) {
    const passes = validate(schema.if, value, root, path).length === 0
    if (passes && schema.then !== undefined)
      errors.push(...validate(schema.then, value, root, path))
    if (!passes && schema.else !== undefined)
      errors.push(...validate(schema.else, value, root, path))
  }
  return errors
}
