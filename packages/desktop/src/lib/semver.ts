/** Parse a semver string "major.minor.patch" into a numeric tuple. */
export function parseSemver(v: string): [number, number, number] {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map(Number)
  return [maj, min, pat]
}

/** Returns true if version `a` is strictly greater than version `b`. */
export function semverGt(a: string, b: string): boolean {
  const [a0, a1, a2] = parseSemver(a)
  const [b0, b1, b2] = parseSemver(b)
  if (a0 !== b0) return a0 > b0
  if (a1 !== b1) return a1 > b1
  return a2 > b2
}
