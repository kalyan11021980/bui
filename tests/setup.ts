import '@testing-library/jest-dom/vitest'

// jsdom implements no scrolling. Tests that assert on scrolling replace this
// with their own spy.
Element.prototype.scrollIntoView = () => undefined
