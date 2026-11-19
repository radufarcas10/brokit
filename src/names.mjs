/**
 * A safe file name for a screenshot: letters, digits, "-", "_", "." (not leading), and
 * ".png" added if it has no extension. Throws on anything that could leave its folder.
 */
export function imageName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][\w.-]{0,99}$/.test(name) || name.includes('..')) {
    throw new Error(`screenshot name: letters, digits, "-", "_" and "." (not first, no ".."), up to 100; got ${JSON.stringify(name)}`);
  }
  return /\.png$/i.test(name) ? name : `${name}.png`;
}
