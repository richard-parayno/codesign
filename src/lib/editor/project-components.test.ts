import { describe, expect, it } from 'vitest';
import { blankDocument, defaultStyle, type DesignNode } from '$lib/model/types';
import {
  captureProjectComponent,
  currentProjectComponentTemplate,
  instantiateProjectComponent,
} from './project-components';

function node(id: string, kind: DesignNode['kind'], parentId?: string): DesignNode {
  return {
    id,
    name: id === 'root' ? 'Profile card' : 'Name',
    kind,
    screenId: 'screen-1',
    parentId,
    childIds: id === 'root' ? ['label'] : [],
    bounds:
      id === 'root'
        ? { x: 100, y: 80, width: 240, height: 120 }
        : { x: 120, y: 105, width: 120, height: 24 },
    style: { ...defaultStyle, fill: id === 'root' ? '#fff' : 'transparent' },
    text: id === 'label' ? 'Ada' : undefined,
    provenance: { actor: 'user', operationId: 'seed' },
  };
}

describe('project components', () => {
  it('captures a frame subtree as a project-local component', () => {
    const document = blankDocument();
    document.nodes = { root: node('root', 'frame'), label: node('label', 'text', 'root') };
    const definition = captureProjectComponent(document, 'root', {
      id: 'component-profile',
      name: 'Profile card',
      now: 10,
    });
    expect(definition.nodes.root.projectComponent).toEqual({
      componentId: 'component-profile',
      role: 'main',
    });
    expect(Object.keys(definition.nodes)).toEqual(['root', 'label']);
  });

  it('captures a group subtree as a project-local component', () => {
    const document = blankDocument();
    document.nodes = { root: node('root', 'group'), label: node('label', 'text', 'root') };
    const definition = captureProjectComponent(document, 'root', {
      id: 'component-profile',
      name: 'Profile card',
      now: 10,
    });

    expect(definition.nodes.root).toMatchObject({
      kind: 'group',
      projectComponent: { componentId: 'component-profile', role: 'main' },
    });
    expect(Object.keys(definition.nodes)).toEqual(['root', 'label']);
  });

  it('materializes an independent instance at a new origin', () => {
    const document = blankDocument();
    document.nodes = { root: node('root', 'frame'), label: node('label', 'text', 'root') };
    const definition = captureProjectComponent(document, 'root', {
      id: 'component-profile',
      name: 'Profile card',
      now: 10,
    });
    let nodeId = 0;
    let operationId = 0;
    const instance = instantiateProjectComponent(definition, {
      screenId: 'screen-1',
      origin: { x: 400, y: 300 },
      makeNodeId: () => `copy-${++nodeId}`,
      makeOperationId: () => `op-${++operationId}`,
    });
    expect(instance.rootId).toBe('copy-1');
    expect(instance.nodes[0]).toMatchObject({
      kind: 'instance',
      bounds: { x: 400, y: 300, width: 240, height: 120 },
      childIds: ['copy-2'],
      projectComponent: { componentId: 'component-profile', role: 'instance' },
    });
    expect(instance.nodes[1]).toMatchObject({
      parentId: 'copy-1',
      bounds: { x: 420, y: 325, width: 120, height: 24 },
    });
  });

  it('uses the current main frame for newly inserted instances', () => {
    const document = blankDocument();
    document.nodes = { root: node('root', 'frame'), label: node('label', 'text', 'root') };
    const definition = captureProjectComponent(document, 'root', {
      id: 'component-profile',
      name: 'Profile card',
      now: 10,
    });
    document.nodes.root.projectComponent = { componentId: definition.id, role: 'main' };
    document.nodes.label.text = 'Grace';
    expect(currentProjectComponentTemplate(document, definition).nodes.label.text).toBe('Grace');
  });
});
