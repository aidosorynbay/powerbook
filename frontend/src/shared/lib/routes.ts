/**
 * The book reader (/library/<book id>) takes the whole screen and wants nothing
 * on top of it: no tab bar, no pop-up notices. The reading hall (/library/hall)
 * is a page like any other and is not matched.
 */
const READER = /^\/library\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

export const isReaderPath = (pathname: string): boolean => READER.test(pathname);
