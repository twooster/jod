const Unset: unique symbol = Symbol.for('unset')
type Unset = typeof Unset

interface Equal {
  type: 'equal'
  value: unknown
}

interface Unequal {
  type: 'unequal'
  left: unknown,
  right: unknown
}

interface ObjectDiff {
  type: 'object'
  attributes: Array<Attribute>
}

interface Add {
  type: 'add'
  value: unknown
}

interface Remove {
  type: 'remove'
  value: unknown
}

interface ArrayDiff {
  type: 'array',
  elements: Array<Diff>
}

interface Attribute {
  key: string | symbol,
  diff: Diff
}

//type ArrayElem = Add | Remove | Equal | ArrayDiff | ObjectDiff

type Diff = Add | Remove | Equal | Unequal |  ArrayDiff | ObjectDiff

type Seen = Map<object, Set<object>>


const hop = Object.prototype.hasOwnProperty

function arrayDiff(l: unknown[], r: unknown[], seen: Seen): ArrayDiff | Equal {
  return withRecursionCheck(l, r, seen, () => {
    const max = Math.max(l.length, r.length)
    let anyDiff = false
    const elements: Diff[] = []
    for (let i = 0; i < max; ++i) {
      const elemDiff = innerDiff(
        hop.call(l, i) ? l[i] : Unset,
        hop.call(r, i) ? r[i] : Unset,
        seen
      )
      anyDiff = anyDiff || elemDiff.type !== 'equal'
      elements.push(elemDiff)
    }

    if (!anyDiff) {
      return {
        type: 'equal',
        value: l
      }
    }
    return {
      type: 'array',
      elements,
    }
  })
}

function stringDiff(l: string, r: string): Equal | Unequal {
  if (l === r) {
    return {
      type: 'equal',
      value: l
    }
  }
  return {
    type: 'unequal',
    left: l,
    right: r
  }
}

function withRecursionCheck<T>(l: object, r: object, seen: Seen, fn: () => T): T {
  let seenR = seen.get(l)
  if (seenR === undefined) {
    seenR = new Set()
    seen.set(l, seenR)
  } else {
    if (seenR.has(r)) {
      throw new Error('Circular structure encountered')
    }
    seenR.add(r)
  }

  try {
    return fn()
  } finally {
    seenR.delete(r)
    if (seenR.size === 0) {
      seen.delete(l)
    }
  }
}

function objDiff(l: object, r: object, seen: Seen): ObjectDiff | Equal {
  return withRecursionCheck(l, r, seen, () => {
    const keys = Array.from(new Set([...Object.keys(l), ...Object.keys(r)])).sort()
    let anyDiff = false
    const attributes: Attribute[] = []
    for (const key of keys) {
      const attrDiff = innerDiff(
        hop.call(l, key) ? l[key] : Unset,
        hop.call(r, key) ? r[key] : Unset,
        seen
      )
      anyDiff = anyDiff || attrDiff.type !== 'equal'
      attributes.push({
        key,
        diff: attrDiff
      })
    }
    if (!anyDiff) {
      return {
        type: 'equal',
        value: l
      }
    }
    return {
      type: 'object',
      attributes,
    }
  })
}

function innerDiff(l: unknown | Unset, r: unknown | Unset, seen: Seen): Diff {
  if (l === Unset) {
    if (r === Unset) {
      throw new Error('Cannot compare two unset values')
    }
    return {
      type: 'add',
      value: r
    }
  } else if (r === Unset) {
    return {
      type: 'remove',
      value: l
    }
  }

  if (l === r) {
    return {
      type: 'equal',
      value: l
    }
  }

  if (typeof l === 'string' && typeof r === 'string') {
    return stringDiff(l, r)
  }

  if (typeof l === 'object' && typeof r === 'object') {
    if (Array.isArray(l)) {
      if (Array.isArray(r)) {
        return arrayDiff(l, r, seen)
      }
      return {
        type: 'unequal',
        left: l,
        right: r
      }
    } else if (Array.isArray(r)) {
      return {
        type: 'unequal',
        left: l,
        right: r
      }
    }

    if (l === null || r === null) {
      return {
        type: 'unequal',
        left: l,
        right: r,
      }
    }
    return objDiff(l, r, seen)
  }

  return {
    type: 'unequal',
    left: l,
    right: r
  }
}

export function diff(l: unknown | Unset, r: unknown | Unset) {
  return innerDiff(l, r, new Map())
}

function defaultStringify(o: unknown, indent: number): Array<string> {
  return JSON.stringify(o, null, indent).split('\n')
}

enum LineAction {
  Add,
  Remove,
  Keep,
}

function * indentIterable(indent: number, iter: Iterable<[LineAction, string]>): Iterable<[LineAction, string]> {
  const indentWs = ' '.repeat(indent)
  for (const [action, line] of iter) {
    yield [action, indentWs + line]
  }
}

function * prefixFirst(key: string, iter: Iterable<[LineAction, string]>): Iterable<[LineAction, string]> {
  let added = false
  for (const res of iter) {
    if (!added) {
      yield [res[0], key + res[1]]
      added = true
    } else {
      yield res
    }
  }
}

function * asList<T>(items: Iterable<T>, indent: number, fn: (t: T, suffix: string) => Iterable<[LineAction, string]>): Iterable<[LineAction, string]> {
  let last: undefined | T
  for (const cur of items) {
    if (last) {
      yield * indentIterable(indent, fn(last, ','))
    }
    last = cur
  }
  if (last) {
    yield * indentIterable(indent, fn(last, ''))
  }
}

function * mapIter<T, U>(iter: Iterable<T>, fn: (t: T) => U): Iterable<U> {
  for (const t of iter) {
    yield fn(t)
  }
}

function * innerLineDiff(d: Diff, indent: number, key: string | symbol | undefined, suffix: string, stringify: Stringifier): Iterable<[LineAction, string]> {
  const prefix =
    typeof key === 'string'
      ? `${JSON.stringify(key)}: `
      : typeof key === 'symbol'
        ? `[${key.toString}]: `
        : ''

  switch(d.type) {
    case 'equal':
      yield * prefixFirst(prefix, mapIter(stringify(d.value, indent), line => [LineAction.Keep, line + suffix]))
      break
    case 'add':
      yield * prefixFirst(prefix, mapIter(stringify(d.value, indent), line => [LineAction.Add, line + suffix]))
      break
    case 'remove':
      yield * prefixFirst(prefix, mapIter(stringify(d.value, indent), line => [LineAction.Remove, line + suffix]))
      break
    case 'unequal':
      yield * prefixFirst(prefix, mapIter(stringify(d.left, indent), line => [LineAction.Remove, line + suffix]))
      yield * prefixFirst(prefix, mapIter(stringify(d.right, indent), line => [LineAction.Add, line + suffix]))
      break
    case 'object':
      yield [LineAction.Keep, prefix + '{']
      yield * asList(d.attributes, indent, (attr, suffix) => innerLineDiff(attr.diff, indent, attr.key, suffix, stringify))
      yield [LineAction.Keep, '}' + suffix]
      break
    case 'array':
      yield [LineAction.Keep, prefix + '[']
      yield * asList(d.elements, indent, (elem, suffix) => innerLineDiff(elem, indent, undefined, suffix, stringify))
      yield [LineAction.Keep, ']' + suffix]
      break
  }
}

type Stringifier = (o: unknown, indent: number) => Iterable<string>

export function lineDiff(l: unknown | Unset, r: unknown | Unset, indent: number = 2, stringify: Stringifier = defaultStringify) {
  if (indent < 1) {
    throw new Error('Indent must be >= 1')
  }
  for (const [action, line] of innerLineDiff(diff(l, r), indent, undefined, '', stringify)) {
    const fullLine = charPrefixFor(action) + line
    console.log(fullLine)
  }
}

function charPrefixFor(action: LineAction): string {
  if (action === LineAction.Keep) {
    return ' '
  } else if (action === LineAction.Add) {
    return '+'
  } else if (action === LineAction.Remove) {
    return '-'
  }
}
