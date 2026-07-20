import {
  defaultStyle,
  type Bounds,
  type CanvasSnapshot,
  type DesignNode,
  type NodeKind,
} from '../../model/types';

type NodeSpec = {
  id: string;
  name: string;
  kind: NodeKind;
  bounds: Bounds;
  parentId?: string;
  text?: string;
  componentId?: string;
};

export type GenericSceneFixture = {
  id: 'dashboard' | 'profile-card' | 'form-settings' | 'table-filter' | 'card-grid-onboarding';
  snapshot: CanvasSnapshot;
  focusNodeIds: string[];
  observationNodeIds: string[];
  mutationTargetIds: string[];
};

function fixtureSnapshot(name: string, specs: NodeSpec[]): CanvasSnapshot {
  const nodes: Record<string, DesignNode> = {};
  for (const spec of specs) {
    nodes[spec.id] = {
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      screenId: 'screen-fixture',
      parentId: spec.parentId,
      childIds: [],
      bounds: { ...spec.bounds },
      style: {
        ...defaultStyle,
        fill: spec.kind === 'frame' ? '#ffffff' : defaultStyle.fill,
      },
      ...(spec.text ? { text: spec.text } : {}),
      ...(spec.componentId
        ? { componentBinding: { componentId: spec.componentId, props: {} } }
        : {}),
      provenance: { actor: 'user', operationId: `fixture-create-${spec.id}` },
    };
  }
  for (const node of Object.values(nodes))
    if (node.parentId && nodes[node.parentId]) nodes[node.parentId].childIds.push(node.id);
  const rootIds = specs.filter((spec) => !spec.parentId).map((spec) => spec.id);
  return {
    screens: [{ id: 'screen-fixture', name, rootIds, branchId: 'branch-fixture' }],
    nodes,
    transitions: [],
    branches: [{ id: 'branch-fixture', name: 'Fixture', screenIds: ['screen-fixture'] }],
    activeBranchId: 'branch-fixture',
    activeScreenId: 'screen-fixture',
    entities: {},
    representations: {},
    pinnedNodeIds: [],
    frameFidelity: {},
    nodeFidelityOverrides: {},
  };
}

const frame = (id: string, name: string, bounds: Bounds, parentId?: string): NodeSpec => ({
  id,
  name,
  kind: 'frame',
  bounds,
  parentId,
});
const rectangle = (id: string, name: string, bounds: Bounds, parentId: string): NodeSpec => ({
  id,
  name,
  kind: 'rectangle',
  bounds,
  parentId,
});
const text = (
  id: string,
  name: string,
  value: string,
  bounds: Bounds,
  parentId: string,
): NodeSpec => ({ id, name, text: value, kind: 'text', bounds, parentId });
const instance = (
  id: string,
  name: string,
  componentId: string,
  bounds: Bounds,
  parentId: string,
): NodeSpec => ({ id, name, componentId, kind: 'instance', bounds, parentId });

const dashboard = fixtureSnapshot('Analytics dashboard', [
  frame('dashboard-root', 'Dashboard', { x: 80, y: 60, width: 1200, height: 800 }),
  instance(
    'dashboard-sidebar',
    'Primary navigation',
    'Sidebar',
    { x: 80, y: 60, width: 220, height: 800 },
    'dashboard-root',
  ),
  text(
    'dashboard-title',
    'Page title',
    'Overview',
    { x: 340, y: 100, width: 300, height: 44 },
    'dashboard-root',
  ),
  frame(
    'dashboard-metrics',
    'Metric cards',
    { x: 340, y: 180, width: 880, height: 180 },
    'dashboard-root',
  ),
  instance(
    'dashboard-card-1',
    'Revenue card',
    'Card',
    { x: 340, y: 180, width: 280, height: 180 },
    'dashboard-metrics',
  ),
  instance(
    'dashboard-card-2',
    'Conversion card',
    'Card',
    { x: 640, y: 180, width: 280, height: 180 },
    'dashboard-metrics',
  ),
]);

const profileCard = fixtureSnapshot('Profile card', [
  frame('profile-root', 'Profile page', { x: 100, y: 80, width: 760, height: 620 }),
  frame(
    'profile-card',
    'Profile card',
    { x: 250, y: 160, width: 460, height: 420 },
    'profile-root',
  ),
  rectangle(
    'profile-avatar',
    'Avatar',
    { x: 410, y: 200, width: 140, height: 140 },
    'profile-card',
  ),
  text(
    'profile-name',
    'Display name',
    'Ada Lovelace',
    { x: 330, y: 370, width: 300, height: 40 },
    'profile-card',
  ),
  instance(
    'profile-action',
    'Edit profile',
    'Button',
    { x: 390, y: 470, width: 180, height: 48 },
    'profile-card',
  ),
]);

const formSettings = fixtureSnapshot('Account settings form', [
  frame('settings-root', 'Settings', { x: 120, y: 80, width: 900, height: 760 }),
  text(
    'settings-title',
    'Settings title',
    'Account settings',
    { x: 180, y: 130, width: 420, height: 48 },
    'settings-root',
  ),
  frame(
    'settings-form',
    'Settings form',
    { x: 180, y: 220, width: 620, height: 480 },
    'settings-root',
  ),
  instance(
    'settings-email',
    'Email input',
    'Input',
    { x: 220, y: 280, width: 540, height: 52 },
    'settings-form',
  ),
  instance(
    'settings-name',
    'Name input',
    'Input',
    { x: 220, y: 360, width: 540, height: 52 },
    'settings-form',
  ),
  instance(
    'settings-save',
    'Save changes',
    'Button',
    { x: 580, y: 620, width: 180, height: 48 },
    'settings-form',
  ),
]);

const tableFilter = fixtureSnapshot('Filtered customer table', [
  frame('table-root', 'Customers', { x: 80, y: 70, width: 1180, height: 760 }),
  frame('filter-bar', 'Filters', { x: 130, y: 120, width: 1080, height: 80 }, 'table-root'),
  instance(
    'filter-input',
    'Search customers',
    'Input',
    { x: 150, y: 134, width: 340, height: 48 },
    'filter-bar',
  ),
  instance(
    'filter-badge',
    'Active filter',
    'Badge',
    { x: 520, y: 140, width: 150, height: 36 },
    'filter-bar',
  ),
  instance(
    'customer-table',
    'Customer table',
    'DataTable',
    { x: 130, y: 230, width: 1080, height: 520 },
    'table-root',
  ),
  instance(
    'customer-row',
    'Customer row',
    'DataRow',
    { x: 150, y: 290, width: 1040, height: 56 },
    'customer-table',
  ),
]);

const onboarding = fixtureSnapshot('Onboarding card grid', [
  frame('onboarding-root', 'Onboarding', { x: 90, y: 60, width: 1100, height: 780 }),
  text(
    'onboarding-title',
    'Welcome title',
    'Set up your workspace',
    { x: 150, y: 120, width: 620, height: 52 },
    'onboarding-root',
  ),
  frame(
    'onboarding-grid',
    'Onboarding steps',
    { x: 150, y: 220, width: 980, height: 440 },
    'onboarding-root',
  ),
  instance(
    'onboarding-card-1',
    'Invite teammates',
    'Card',
    { x: 150, y: 220, width: 300, height: 210 },
    'onboarding-grid',
  ),
  instance(
    'onboarding-card-2',
    'Connect data',
    'Card',
    { x: 490, y: 220, width: 300, height: 210 },
    'onboarding-grid',
  ),
  instance(
    'onboarding-card-3',
    'Publish project',
    'Card',
    { x: 830, y: 220, width: 300, height: 210 },
    'onboarding-grid',
  ),
]);

export const SCENE_CONTEXT_FIXTURES: readonly GenericSceneFixture[] = [
  {
    id: 'dashboard',
    snapshot: dashboard,
    focusNodeIds: ['dashboard-metrics'],
    observationNodeIds: ['dashboard-root'],
    mutationTargetIds: ['dashboard-metrics'],
  },
  {
    id: 'profile-card',
    snapshot: profileCard,
    focusNodeIds: ['profile-card'],
    observationNodeIds: ['profile-root'],
    mutationTargetIds: ['profile-card'],
  },
  {
    id: 'form-settings',
    snapshot: formSettings,
    focusNodeIds: ['settings-form'],
    observationNodeIds: ['settings-root'],
    mutationTargetIds: ['settings-form'],
  },
  {
    id: 'table-filter',
    snapshot: tableFilter,
    focusNodeIds: ['customer-table'],
    observationNodeIds: ['table-root'],
    mutationTargetIds: ['customer-table'],
  },
  {
    id: 'card-grid-onboarding',
    snapshot: onboarding,
    focusNodeIds: ['onboarding-grid'],
    observationNodeIds: ['onboarding-root'],
    mutationTargetIds: ['onboarding-grid'],
  },
];
