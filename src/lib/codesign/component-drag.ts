export const COMPONENT_DRAG_MIME = 'application/x-codesign-component';

export function readDraggedComponent(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return '';
  return (dataTransfer.getData(COMPONENT_DRAG_MIME) || dataTransfer.getData('text/plain')).trim();
}
