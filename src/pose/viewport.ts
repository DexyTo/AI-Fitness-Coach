// Same centered contain transform as CSS object-fit: contain, in CSS pixels.
export function containViewport(width: number, height: number, sourceWidth: number, sourceHeight: number) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const contentWidth = Math.min(width, sourceWidth * scale);
  const contentHeight = Math.min(height, sourceHeight * scale);
  return { x: (width - contentWidth) / 2, y: (height - contentHeight) / 2, width: contentWidth, height: contentHeight };
}
