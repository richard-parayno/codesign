export const COMPONENT_DRAG_MIME = 'application/x-codesign-component';
export const PROJECT_COMPONENT_DRAG_MIME = 'application/x-codesign-project-component';

export function readDraggedComponent(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return '';
  return (dataTransfer.getData(COMPONENT_DRAG_MIME) || dataTransfer.getData('text/plain')).trim();
}

export function readDraggedProjectComponent(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return '';
  return dataTransfer.getData(PROJECT_COMPONENT_DRAG_MIME).trim();
}
