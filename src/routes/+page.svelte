<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { documentStore } from '$lib/model/store';
  import {
    defaultStyle,
    type Bounds,
    type CandidateRevision,
    type CodesignAction,
    type DesignNode,
    type DesignOperation,
    type Fidelity,
    type GenerationRun,
    type ObservationScope,
    type ProcessEvent,
  } from '$lib/model/types';
  import {
    acceptCandidateChanges,
    activateRevision,
    compareWithSource,
    effectiveFidelity,
    recordReroll,
    rejectCandidate,
    replayCandidate,
    setAtomicChangePinned,
    setNodePinned,
    stageCandidates,
    stageGenerationRun,
    viewCandidate,
  } from '$lib/model/codesign';
  import type { CandidateDraft } from '$lib/model/codesign';
  import { demoCheckpoint } from '$lib/model/checkpoint';
  import { generateSvelte } from '$lib/model/codegen';
  import {
    containingFrameForBounds,
    descendantNodeIds,
    orderedScreenNodes,
    screenLayerRows,
  } from '$lib/model/layers';
  import { logAction } from '$lib/debug/action-log';
  import CodesignPanel, {
    type CandidateView,
    type ObservationScopeView,
  } from '$lib/codesign/CodesignPanel.svelte';
  import type { FidelityStopView } from '$lib/codesign/FidelityStops.svelte';
  import ProcessPanel, { type ProcessEventView } from '$lib/codesign/ProcessPanel.svelte';

  type Tool = 'select' | 'frame' | 'rectangle' | 'text' | 'connect';
  type EditorMode = 'edit' | 'codesign' | 'preview';
  const DEFAULT_CANVAS_BACKGROUND = '#edf0f3';
  const CANVAS_BACKGROUND_KEY = 'malleable.canvas-background.v1';
  let tool: Tool = 'select';
  let selection: string[] = [];
  let error = '';
  let notice = '';
  let editorMode: EditorMode = 'edit';
  let preview = false;
  let bottomOpen = false;
  let bottomTab: 'process' | 'operations' | 'code' = 'process';
  let inspectorTab: 'properties' | 'trace' = 'properties';
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let canvasBackground = DEFAULT_CANVAS_BACKGROUND;
  let contextMenu: { x: number; y: number; nodeId?: string } | null = null;
  let contextMenuElement: HTMLDivElement;
  let draft: Bounds | null = null;
  let gesture: {
    mode: 'draw' | 'move' | 'resize' | 'pan';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    original?: Bounds;
    previewIds?: string[];
  } | null = null;
  let connectSource = '';
  let backend: 'local' | 'codex' = 'local';
  let agentStatus = 'Local rules ready';
  let loadingCandidate = false;
  let idCounter = 0;
  let viewportLogTimer: ReturnType<typeof setTimeout> | undefined;
  let generationRequestId = 0;
  let observationKind: ObservationScope['kind'] = 'frame';
  let requestedFidelity: Fidelity = 'wireframe';
  let activeCandidateId = '';
  let selectedAtomicIds: string[] = [];
  let pinnedAtomicIds: string[] = [];
  let highlightedChangeId = '';
  let compareSourceActive = false;
  let activeProcessEventId = '';
  let codesignStatus = 'Entering Co-design does not change your design.';

  $: document = $documentStore.present;
  $: pinnedAtomicIds = derivePinnedAtomicIds(document.processEvents);
  $: projects = $documentStore.projects;
  $: activeProjectId = $documentStore.activeProjectId;
  $: storageWarning = $documentStore.warning;
  $: activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  $: currentScreen =
    document.screens.find((screen) => screen.id === document.activeScreenId) ?? document.screens[0];
  $: visibleNodes = currentScreen ? orderedScreenNodes(document, currentScreen.id) : [];
  $: layerRows = currentScreen ? screenLayerRows(document, currentScreen.id) : [];
  $: selectedNodes = selection.map((id) => document.nodes[id]).filter(Boolean);
  $: contextNode = contextMenu?.nodeId ? document.nodes[contextMenu.nodeId] : undefined;
  $: code = generateSvelte(document);
  $: observationScope = makeObservationScope(
    observationKind,
    selection,
    selectedNodes,
    visibleNodes,
  );
  $: observationScopes = makeObservationScopeOptions(selection, selectedNodes, visibleNodes);
  $: latestRun = activeCandidateId
    ? document.generationRuns[document.candidates[activeCandidateId]?.generationRunId]
    : Object.values(document.generationRuns).sort((a, b) => b.createdAt - a.createdAt)[0];
  $: runCandidates = latestRun
    ? Object.values(document.candidates)
        .filter((candidate) => {
          const run = document.generationRuns[candidate.generationRunId];
          return (
            candidate.sourceRevisionId === latestRun.sourceRevisionId &&
            run?.mutationScopeIds.slice().sort().join(':') ===
              latestRun.mutationScopeIds.slice().sort().join(':') &&
            run?.observationScope.nodeIds.slice().sort().join(':') ===
              latestRun.observationScope.nodeIds.slice().sort().join(':')
          );
        })
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  $: activeCandidate =
    document.candidates[activeCandidateId] ?? runCandidates[runCandidates.length - 1];
  $: activeCandidateSnapshot = activeCandidate
    ? document.revisions[activeCandidate.revisionId]?.snapshot
    : undefined;
  $: sourceSnapshot = activeCandidate
    ? document.revisions[activeCandidate.sourceRevisionId]?.snapshot
    : undefined;
  $: renderedNodes =
    compareSourceActive && sourceSnapshot
      ? orderedScreenNodes(sourceSnapshot, document.activeScreenId)
      : visibleNodes;
  $: ghostSnapshot = activeCandidateSnapshot;
  $: ghostNodes = ghostSnapshot
    ? Object.values(ghostSnapshot.nodes).filter((node) => {
        if (node.screenId !== document.activeScreenId) return false;
        const source = sourceSnapshot?.nodes[node.id];
        return !source || JSON.stringify(source) !== JSON.stringify(node);
      })
    : [];
  $: candidateViews = makeCandidateViews(
    runCandidates,
    document,
    selectedAtomicIds,
    pinnedAtomicIds,
  );
  $: fidelityStops = makeFidelityStops(selectedNodes, document, runCandidates);
  $: processEventViews = makeProcessEventViews(document.processEvents, document);

  onMount(() => {
    documentStore.restore();
    try {
      const savedBackground = localStorage.getItem(CANVAS_BACKGROUND_KEY);
      if (savedBackground && /^#[0-9a-f]{6}$/i.test(savedBackground))
        canvasBackground = savedBackground;
    } catch {
      // The editor still works when browser storage is unavailable.
    }
    fetch('/api/agent/status')
      .then((response) => response.json())
      .then((value) => {
        backend = value.backend;
        agentStatus = value.message;
      })
      .catch(() => {
        agentStatus = 'Local fallback active';
      });
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, select, textarea')) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo('keyboard') : undo('keyboard');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'y') {
        event.preventDefault();
        redo('keyboard');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length)
          apply({ id: uid('op'), type: 'delete', actor: 'user', targetIds: selection });
        selection = [];
        return;
      }
      if (key === 'escape') {
        setEditorMode('edit');
        contextMenu = null;
        draft = null;
        gesture = null;
        logAction('editor.escape', { revision: document.revision });
      }
      const shortcuts: Record<string, Tool> = {
        v: 'select',
        f: 'frame',
        r: 'rectangle',
        t: 'text',
        c: 'connect',
      };
      if (shortcuts[key]) setTool(shortcuts[key], 'keyboard');
      if (event.key.startsWith('Arrow') && selection.length) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        apply({
          id: uid('op'),
          type: 'move',
          actor: 'user',
          targetIds: selection,
          dx: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          dy: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
        });
      }
    };
    const dismissContextMenu = (event: PointerEvent) => {
      if (contextMenu && event.target instanceof Element && !event.target.closest('.context-menu'))
        contextMenu = null;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('pointerdown', dismissContextMenu);
    return () => {
      if (viewportLogTimer) clearTimeout(viewportLogTimer);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('pointerdown', dismissContextMenu);
    };
  });

  function uid(prefix: string) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
  }
  function controlArea(control: Element) {
    if (control.closest('.topbar')) return 'topbar';
    if (control.closest('.projects')) return 'sidebar';
    if (control.closest('.tools')) return 'tools';
    if (control.closest('.outline')) return 'sidebar';
    if (control.closest('.canvas-toolbar')) return 'canvas-toolbar';
    if (control.closest('.context-menu')) return 'context-menu';
    if (control.closest('.context-bar')) return 'selection-toolbar';
    if (control.closest('.codesign-panel')) return 'codesign';
    if (control.closest('.bottom-panel')) return 'bottom-panel';
    if (control.closest('.inspector')) return 'inspector';
    return 'editor';
  }
  function logControlClick(event: MouseEvent) {
    const control = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(control instanceof HTMLButtonElement) || control.disabled) return;
    const label =
      control.getAttribute('aria-label') ||
      control.textContent?.replace(/\s+/g, ' ').trim() ||
      'Unlabelled control';
    logAction('control.clicked', { label, area: controlArea(control) });
  }
  function setTool(nextTool: Tool, source: 'toolbar' | 'keyboard' | 'context-menu') {
    if (tool === nextTool) return;
    tool = nextTool;
    logAction('tool.changed', { tool: nextTool, source });
  }
  function setEditorMode(nextMode: EditorMode) {
    if (editorMode === nextMode) return;
    editorMode = nextMode;
    preview = nextMode === 'preview';
    if (nextMode === 'codesign') {
      bottomTab = 'process';
      inspectorTab = 'trace';
      codesignStatus = selection.length
        ? 'Choose an action to generate a candidate. Your design is unchanged.'
        : 'Select a frame or object to choose where Codesign may propose changes.';
    }
    logAction('mode.changed', { mode: nextMode });
  }
  function undo(source: 'toolbar' | 'keyboard') {
    const revision = document.revision;
    documentStore.undo();
    logAction('history.undo', { source, fromRevision: revision });
  }
  function redo(source: 'toolbar' | 'keyboard') {
    const revision = document.revision;
    documentStore.redo();
    logAction('history.redo', { source, fromRevision: revision });
  }
  function resetDocument() {
    const nodeCount = Object.keys(document.nodes).length;
    documentStore.reset();
    selection = [];
    logAction('document.reset', { fromRevision: document.revision, nodeCount });
  }
  function loadDemoCheckpoint() {
    documentStore.replace(demoCheckpoint());
    selection = [];
    logAction('document.demo-loaded', { fromRevision: document.revision });
  }
  function clearProjectTransientState() {
    selection = [];
    contextMenu = null;
    draft = null;
    gesture = null;
    connectSource = '';
    error = '';
    notice = '';
    loadingCandidate = false;
    generationRequestId += 1;
    activeCandidateId = '';
    selectedAtomicIds = [];
    highlightedChangeId = '';
    compareSourceActive = false;
  }
  function createProject() {
    const fromProjectId = activeProjectId;
    const suggestedName = `Untitled design ${projects.length + 1}`;
    logAction('project.create-opened', {
      fromProjectId,
      suggestedName,
      projectCount: projects.length,
    });
    const name = prompt('Name this project', suggestedName);
    if (name === null) {
      logAction('project.create-cancelled', { fromProjectId });
      return;
    }
    const project = documentStore.createProject(name);
    if (!project) {
      error = 'Enter a project name';
      logAction('project.create-rejected', {
        fromProjectId,
        reason: 'empty-name',
      });
      return;
    }
    clearProjectTransientState();
    logAction('project.created', {
      projectId: project.id,
      name: project.name,
      fromProjectId,
      projectCount: projects.length,
    });
  }
  function renameProject() {
    if (!activeProject) return;
    const name = prompt('Rename this project', activeProject.name);
    if (name === null || name.trim() === activeProject.name) return;
    if (!documentStore.renameProject(activeProject.id, name)) {
      error = 'Enter a project name';
      return;
    }
    logAction('project.renamed', {
      projectId: activeProject.id,
      fromName: activeProject.name,
      name: name.trim().slice(0, 80),
    });
  }
  function switchProject(projectId: string) {
    const fromProjectId = activeProjectId;
    if (!documentStore.switchProject(projectId)) return;
    clearProjectTransientState();
    logAction('project.switched', { fromProjectId, projectId });
  }
  function deleteProject() {
    if (!activeProject) return;
    if (!confirm(`Delete “${activeProject.name}”? This cannot be undone.`)) return;
    const result = documentStore.deleteProject(activeProject.id);
    if (!result) return;
    clearProjectTransientState();
    logAction('project.deleted', {
      projectId: result.removed.id,
      name: result.removed.name,
      activeProjectId: result.activeProjectId,
    });
  }
  function navigateToScreen(screenId: string, branchId?: string, source = 'sidebar') {
    const fromScreenId = document.activeScreenId;
    documentStore.navigate(screenId, branchId);
    selection = [];
    logAction('screen.navigated', { fromScreenId, screenId, branchId: branchId ?? '', source });
  }
  function scheduleViewportLog(source: string) {
    if (viewportLogTimer) clearTimeout(viewportLogTimer);
    viewportLogTimer = setTimeout(() => {
      logAction('viewport.changed', {
        source,
        zoom: Number(zoom.toFixed(3)),
        panX: Math.round(pan.x),
        panY: Math.round(pan.y),
      });
    }, 180);
  }
  function setZoom(nextZoom: number, source: string) {
    zoom = Math.min(2, Math.max(0.35, nextZoom));
    scheduleViewportLog(source);
  }
  function resetViewport(source: string) {
    zoom = 1;
    pan = { x: 0, y: 0 };
    scheduleViewportLog(source);
  }
  function setCanvasBackground(value: string, source = 'picker') {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    canvasBackground = value;
    try {
      localStorage.setItem(CANVAS_BACKGROUND_KEY, value);
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
    logAction('canvas.background-changed', { value, source });
  }
  function apply(operation: DesignOperation) {
    const baseRevision = document.revision;
    const targetIds =
      'targetIds' in operation
        ? operation.targetIds
        : 'targetId' in operation
          ? [operation.targetId]
          : operation.type === 'transition'
            ? [operation.transition.sourceNodeId]
            : [];
    try {
      documentStore.apply(operation);
      error = '';
      notice = operation.type.replaceAll('-', ' ') + ' applied';
      logAction('operation.applied', {
        type: operation.type,
        actor: operation.actor,
        operationId: operation.id,
        baseRevision,
        nextRevision: baseRevision + 1,
        targetIds: targetIds.slice(0, 30),
        targetCount: targetIds.length,
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'That operation could not be applied';
      logAction('operation.failed', {
        type: operation.type,
        actor: operation.actor,
        operationId: operation.id,
        baseRevision,
        message: error,
      });
    }
  }
  function point(event: PointerEvent) {
    const rect = (event.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }
  function contentInset(node: DesignNode) {
    return Math.max(
      4,
      Math.min(node.style.padding, (node.bounds.width - 8) / 2, (node.bounds.height - 8) / 2),
    );
  }
  function contains(outer: DesignNode, inner: DesignNode) {
    return (
      outer.id !== inner.id &&
      outer.bounds.x <= inner.bounds.x &&
      outer.bounds.y <= inner.bounds.y &&
      outer.bounds.x + outer.bounds.width >= inner.bounds.x + inner.bounds.width &&
      outer.bounds.y + outer.bounds.height >= inner.bounds.y + inner.bounds.height
    );
  }
  function containingFrame(node: DesignNode, screenNodes: DesignNode[]) {
    return screenNodes
      .filter((candidate) => candidate.kind === 'frame' && contains(candidate, node))
      .sort(
        (a, b) =>
          a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height ||
          a.id.localeCompare(b.id),
      )[0];
  }
  function uniqueIds(ids: Array<string | undefined>) {
    return [...new Set(ids.filter((id): id is string => Boolean(id)))];
  }
  function belongsToRegion(node: DesignNode, region: DesignNode, screenNodes: DesignNode[]) {
    if (node.id === region.id || contains(region, node)) return true;
    const byId = new Map(screenNodes.map((item) => [item.id, item]));
    let current = node.parentId ? byId.get(node.parentId) : undefined;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === region.id) return true;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  }
  function makeObservationScope(
    kind: ObservationScope['kind'],
    mutationIds: string[],
    nodes: DesignNode[],
    screenNodes: DesignNode[],
  ): ObservationScope {
    if (kind === 'selection') return { kind, nodeIds: uniqueIds(mutationIds) };
    if (kind === 'page')
      return { kind, nodeIds: uniqueIds([...mutationIds, ...screenNodes.map((node) => node.id)]) };
    const regionIds = uniqueIds(
      kind === 'parent'
        ? nodes.map((node) => node.parentId ?? containingFrame(node, screenNodes)?.id)
        : nodes.map((node) =>
            node.kind === 'frame' ? node.id : containingFrame(node, screenNodes)?.id,
          ),
    );
    const regions = regionIds
      .map((id) => screenNodes.find((node) => node.id === id))
      .filter((region): region is DesignNode => Boolean(region));
    const contextIds = screenNodes
      .filter((node) => regions.some((region) => belongsToRegion(node, region, screenNodes)))
      .map((node) => node.id);
    return { kind, nodeIds: uniqueIds([...mutationIds, ...contextIds]) };
  }
  function makeObservationScopeOptions(
    mutationIds: string[],
    nodes: DesignNode[],
    screenNodes: DesignNode[],
  ): ObservationScopeView[] {
    const selectionScope = makeObservationScope('selection', mutationIds, nodes, screenNodes);
    const parentScope = makeObservationScope('parent', mutationIds, nodes, screenNodes);
    const frameScope = makeObservationScope('frame', mutationIds, nodes, screenNodes);
    const pageScope = makeObservationScope('page', mutationIds, nodes, screenNodes);
    return [
      {
        scope: selectionScope,
        label: 'Selection',
        description: 'Reference only the layers Codesign may change.',
      },
      {
        scope: parentScope,
        label: 'Parent',
        description: 'Reference the nearest parent region and the selection.',
        disabledReason:
          parentScope.nodeIds.length === selectionScope.nodeIds.length
            ? 'No parent region is available.'
            : undefined,
      },
      {
        scope: frameScope,
        label: 'Containing frame',
        description: 'Reference the smallest containing frame and the selection.',
        disabledReason:
          frameScope.nodeIds.length === selectionScope.nodeIds.length &&
          !nodes.some((node) => node.kind === 'frame')
            ? 'No containing frame is available.'
            : undefined,
      },
      {
        scope: pageScope,
        label: 'Page',
        description: 'Reference every visible layer on this screen.',
      },
    ];
  }
  function changeLabel(type: DesignOperation['type']) {
    const labels: Record<DesignOperation['type'], string> = {
      create: 'Create element',
      move: 'Move element',
      resize: 'Resize element',
      delete: 'Delete element',
      repeat: 'Create repeated pattern',
      bind: 'Assign semantic role',
      transition: 'Create interaction',
      promote: 'Resolve to component',
      style: 'Refine appearance',
      generalize: 'Apply shared style',
      'duplicate-screen': 'Duplicate screen',
      'create-branch': 'Create branch',
    };
    return labels[type];
  }
  function makeCandidateViews(
    candidates: CandidateRevision[],
    sourceDocument: typeof document,
    selectedIds: string[],
    pinnedIds: string[],
  ): CandidateView[] {
    return candidates.map((candidate, index) => ({
      candidate,
      label: `Candidate ${index + 1}`,
      changes: candidate.atomicChangeIds
        .map((id) => sourceDocument.atomicChanges[id])
        .filter(Boolean)
        .map((change) => ({
          change,
          label: changeLabel(change.operation.type),
          summary: change.trace.proposedChange,
          selected: selectedIds.includes(change.id),
          pinned: pinnedIds.includes(change.id),
          dependencyLabels: change.dependencyIds.map((id) =>
            changeLabel(sourceDocument.atomicChanges[id]?.operation.type ?? 'create'),
          ),
          disabledReason:
            candidate.decisions[change.id] !== 'pending'
              ? `Already ${candidate.decisions[change.id]}.`
              : undefined,
        })),
    }));
  }
  function makeFidelityStops(
    nodes: DesignNode[],
    sourceDocument: typeof document,
    candidates: CandidateRevision[],
  ): FidelityStopView[] {
    const selected = nodes[0];
    const current = selected ? effectiveFidelity(sourceDocument, selected.id) : 'wireframe';
    const entity = selected?.entityId ? sourceDocument.entities[selected.entityId] : undefined;
    const saved = (entity?.representationIds ?? [])
      .map((id) => sourceDocument.representations[id])
      .filter(Boolean);
    const candidateFidelities = new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.status === 'candidate' &&
            sourceDocument.generationRuns[candidate.generationRunId]?.mutationScopeIds.includes(
              selected?.id ?? '',
            ),
        )
        .map((candidate) => candidate.fidelity),
    );
    const fidelities: Fidelity[] = ['structure', 'wireframe', 'component', 'visual', 'production'];
    return fidelities.map((fidelity) => {
      const representations = saved.filter((item) => item.fidelity === fidelity);
      const representation = representations.at(-1);
      if (candidateFidelities.has(fidelity)) return { fidelity, state: 'candidate' };
      if (representations.length > 1)
        return {
          fidelity,
          state: 'versions',
          versionCount: representations.length,
          representationId: representation?.id,
        };
      if (fidelity === current) return { fidelity, state: 'current' };
      if (representation) return { fidelity, state: 'saved', representationId: representation.id };
      if (fidelity === 'wireframe' || fidelity === 'component')
        return { fidelity, state: 'generate' };
      return {
        fidelity,
        state: 'unavailable',
        disabledReason: 'This deterministic prototype does not generate this fidelity yet.',
      };
    });
  }
  function makeProcessEventViews(
    events: ProcessEvent[],
    sourceDocument: typeof document,
  ): ProcessEventView[] {
    return events.map((event) => {
      const candidate = event.candidateId
        ? sourceDocument.candidates[event.candidateId]
        : undefined;
      const accepted = candidate
        ? Object.values(candidate.decisions).filter((decision) => decision === 'accepted').length
        : 0;
      const rejected = candidate
        ? Object.values(candidate.decisions).filter((decision) => decision === 'rejected').length
        : 0;
      const isReplayEvent = ['candidate-accepted', 'candidate-rejected'].includes(event.type);
      return {
        event,
        title:
          event.type === 'candidate-accepted' && candidate?.status === 'partially-accepted'
            ? `Partially accepted · ${accepted} accepted, ${rejected} rejected`
            : event.type.replaceAll('-', ' '),
        summary:
          event.type === 'candidate-rejected'
            ? 'The candidate remains available for review and replay.'
            : event.type === 'candidates-generated'
              ? 'Structured alternatives were saved without changing the design.'
              : event.type === 'generation-requested'
                ? 'Codesign captured an explicit source revision and scope.'
                : 'This decision is retained in the project ledger.',
        canViewCandidate: Boolean(candidate),
        canCompareSource: Boolean(candidate),
        canReplay: Boolean(candidate && candidate.status !== 'candidate' && isReplayEvent),
        replayDisabledReason:
          candidate && candidate.status === 'candidate'
            ? 'Decide this candidate before replaying it.'
            : undefined,
      };
    });
  }
  function derivePinnedAtomicIds(events: ProcessEvent[]) {
    const pins = new Set<string>();
    for (const event of events) {
      if (event.type !== 'pin-changed' || !event.atomicChangeId) continue;
      if (event.details?.pinned === true) pins.add(event.atomicChangeId);
      if (event.details?.pinned === false) pins.delete(event.atomicChangeId);
    }
    return [...pins];
  }
  function startDraw(event: PointerEvent) {
    const p = point(event);
    gesture = { mode: 'draw', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y };
    draft = { x: p.x, y: p.y, width: 1, height: 1 };
  }
  function canvasDown(event: PointerEvent) {
    contextMenu = null;
    if (preview) return;
    if (event.button === 1) {
      const p = { x: event.clientX, y: event.clientY };
      gesture = { mode: 'pan', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y };
      return;
    }
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    if (selection.length) logAction('selection.cleared', { source: 'canvas' });
    selection = [];
    if (tool === 'frame' || tool === 'rectangle' || tool === 'text') startDraw(event);
  }
  function canvasMove(event: PointerEvent) {
    if (!gesture) return;
    if (gesture.mode === 'pan') {
      pan = { x: pan.x + event.clientX - gesture.lastX, y: pan.y + event.clientY - gesture.lastY };
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      return;
    }
    const p = point(event);
    if (gesture.mode === 'draw')
      draft = {
        x: Math.min(gesture.startX, p.x),
        y: Math.min(gesture.startY, p.y),
        width: Math.max(1, Math.abs(p.x - gesture.startX)),
        height: Math.max(1, Math.abs(p.y - gesture.startY)),
      };
    if (gesture.mode === 'move') {
      const dx = p.x - gesture.lastX,
        dy = p.y - gesture.lastY;
      for (const id of gesture.previewIds ?? selection) {
        const element = window.document.getElementById(`node-${id}`);
        if (element) element.setAttribute('transform', `translate(${dx} ${dy})`);
      }
    }
    if (gesture.mode === 'resize' && gesture.original)
      draft = {
        ...gesture.original,
        width: Math.max(20, gesture.original.width + p.x - gesture.startX),
        height: Math.max(20, gesture.original.height + p.y - gesture.startY),
      };
  }
  function canvasUp(event: PointerEvent) {
    if (!gesture) return;
    const completedGesture = gesture.mode;
    const p = gesture.mode === 'pan' ? null : point(event);
    if (gesture.mode === 'draw' && draft && draft.width > 8 && draft.height > 8) {
      const nodeId = uid('node');
      const opId = uid('op');
      const parentFrame = containingFrameForBounds(visibleNodes, draft);
      const node: DesignNode = {
        id: nodeId,
        name: tool === 'text' ? 'Text label' : tool === 'frame' ? 'Frame' : 'Rectangle',
        kind: tool as 'frame' | 'rectangle' | 'text',
        screenId: document.activeScreenId,
        parentId: parentFrame?.id,
        childIds: [],
        bounds: draft,
        style: {
          ...defaultStyle,
          fill: tool === 'frame' ? '#f7f8fa' : tool === 'text' ? 'transparent' : defaultStyle.fill,
        },
        text: tool === 'text' ? 'Text label' : undefined,
        provenance: { actor: 'user', operationId: opId },
      };
      apply({ id: opId, type: 'create', actor: 'user', node });
      selection = [nodeId];
      logAction('layer.created', {
        nodeId,
        kind: node.kind,
        parentId: parentFrame?.id ?? null,
        screenId: node.screenId,
      });
      tool = 'select';
    } else if (gesture.mode === 'move' && p) {
      const dx = p.x - gesture.lastX,
        dy = p.y - gesture.lastY;
      for (const id of gesture.previewIds ?? selection)
        window.document.getElementById(`node-${id}`)?.removeAttribute('transform');
      if (dx || dy)
        apply({ id: uid('op'), type: 'move', actor: 'user', targetIds: selection, dx, dy });
    } else if (gesture.mode === 'resize' && draft && selection[0])
      apply({
        id: uid('op'),
        type: 'resize',
        actor: 'user',
        targetId: selection[0],
        bounds: draft,
      });
    gesture = null;
    draft = null;
    if (completedGesture === 'pan') scheduleViewportLog('middle-drag');
  }
  function nodeDown(event: PointerEvent, node: DesignNode) {
    event.stopPropagation();
    contextMenu = null;
    if (event.button !== 0) return;
    if (preview) {
      const transition = document.transitions.find((item) => item.sourceNodeId === node.id);
      if (transition) navigateToScreen(transition.targetScreenId, undefined, 'preview-transition');
      return;
    }
    if (tool === 'connect') {
      connectSource = node.id;
      notice = `Connection starts at ${node.name}. Choose a destination screen.`;
      logAction('connection.started', { nodeId: node.id, source: 'canvas' });
      return;
    }
    if (tool === 'frame' || tool === 'rectangle' || tool === 'text') {
      startDraw(event);
      return;
    }
    selection = event.shiftKey
      ? selection.includes(node.id)
        ? selection.filter((id) => id !== node.id)
        : [...selection, node.id]
      : [node.id];
    logAction('selection.changed', {
      source: 'canvas',
      nodeIds: selection,
      additive: event.shiftKey,
    });
    const p = point(event);
    gesture = {
      mode: 'move',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      previewIds: descendantNodeIds(document, selection),
    };
  }
  function resizeDown(event: PointerEvent, node: DesignNode) {
    event.stopPropagation();
    const p = point(event);
    gesture = {
      mode: 'resize',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      original: { ...node.bounds },
    };
    draft = { ...node.bounds };
  }
  function resizeKeydown(event: KeyboardEvent, node: DesignNode) {
    const delta = event.shiftKey ? 10 : 1;
    const changes: Partial<Pick<Bounds, 'width' | 'height'>> = {};
    if (event.key === 'ArrowRight') changes.width = node.bounds.width + delta;
    else if (event.key === 'ArrowLeft') changes.width = Math.max(20, node.bounds.width - delta);
    else if (event.key === 'ArrowDown') changes.height = node.bounds.height + delta;
    else if (event.key === 'ArrowUp') changes.height = Math.max(20, node.bounds.height - delta);
    else return;
    event.preventDefault();
    event.stopPropagation();
    apply({
      id: uid('op'),
      type: 'resize',
      actor: 'user',
      targetId: node.id,
      bounds: { ...node.bounds, ...changes },
    });
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    contextMenu = null;
    const canvas = event.currentTarget as SVGSVGElement;
    const rect = canvas.getBoundingClientRect();
    if (event.ctrlKey) {
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const world = { x: (pointer.x - pan.x) / zoom, y: (pointer.y - pan.y) / zoom };
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.01)));
      const nextZoom = Math.min(2, Math.max(0.35, zoom * factor));
      pan = {
        x: pointer.x - world.x * nextZoom,
        y: pointer.y - world.y * nextZoom,
      };
      zoom = nextZoom;
      scheduleViewportLog('pinch');
      return;
    }
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? rect.height
          : 1;
    const horizontal = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    const vertical = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
    pan = { x: pan.x - horizontal * unit, y: pan.y - vertical * unit };
    scheduleViewportLog('scroll');
  }
  async function openContextMenu(event: MouseEvent, node?: DesignNode) {
    event.preventDefault();
    event.stopPropagation();
    if (node && !selection.includes(node.id)) selection = [node.id];
    const width = 236;
    const height = preview ? 110 : node ? 244 : 196;
    contextMenu = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      nodeId: node?.id,
    };
    logAction('context-menu.opened', {
      target: node ? 'node' : 'canvas',
      nodeId: node?.id ?? '',
      selectionCount: selection.length,
    });
    await tick();
    contextMenuElement?.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function startConnectionFromContext() {
    if (!contextNode) return;
    selection = [contextNode.id];
    connectSource = contextNode.id;
    setTool('connect', 'context-menu');
    notice = `Connection starts at ${contextNode.name}. Choose a destination screen.`;
    logAction('connection.started', { nodeId: contextNode.id, source: 'context-menu' });
    contextMenu = null;
  }
  function promoteFromContext() {
    if (!contextNode) return;
    if (!selection.includes(contextNode.id)) selection = [contextNode.id];
    contextMenu = null;
    setEditorMode('codesign');
    requestedFidelity = 'component';
    codesignStatus = 'Choose Resolve to map the selected object to a registered component.';
  }
  function deleteFromContext() {
    if (!contextNode) return;
    const targetIds = selection.includes(contextNode.id) ? selection : [contextNode.id];
    contextMenu = null;
    apply({ id: uid('op'), type: 'delete', actor: 'user', targetIds });
    selection = [];
  }

  async function generateCandidates(action: CodesignAction, rerollCandidateId?: string) {
    if (!selection.length) {
      error = 'Select a frame or object before generating a candidate';
      logAction('codesign.request-rejected', { action, message: error });
      return;
    }
    loadingCandidate = true;
    const requestId = ++generationRequestId;
    const requestProjectId = activeProjectId;
    error = '';
    codesignStatus = 'Generating a candidate… Your design is unchanged.';
    logAction('codesign.requested', {
      action,
      backend,
      mutationScopeIds: selection,
      observationScope: observationScope.kind,
      observationCount: observationScope.nodeIds.length,
      sourceRevisionId: document.currentRevisionId,
      requestedFidelity,
      rerollCandidateId: rerollCandidateId ?? '',
    });
    try {
      const pinnedChanges = rerollCandidateId
        ? pinnedAtomicIds
            .filter((id) => document.candidates[rerollCandidateId]?.atomicChangeIds.includes(id))
            .map((id) => document.atomicChanges[id])
            .filter(Boolean)
        : [];
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          requestedFidelity,
          observationScope,
          mutationScopeIds: selection,
          pinnedNodeIds: document.pinnedNodeIds,
          pinnedAtomicChanges: pinnedChanges,
          document: {
            currentRevisionId: document.currentRevisionId,
            activeScreenId: document.activeScreenId,
            knownNodeIds: Object.keys(document.nodes),
            nodes: Object.fromEntries(
              observationScope.nodeIds
                .map((id) => [id, document.nodes[id]])
                .filter(([, node]) => node),
            ),
          },
        }),
      });
      const value = (await response.json()) as {
        run?: GenerationRun;
        candidates?: CandidateDraft[];
        fallback?: boolean;
        message?: string;
      };
      if (!response.ok || !value.run || !value.candidates)
        throw new Error(value.message ?? 'Codesign generation failed');
      if (requestId !== generationRequestId || requestProjectId !== activeProjectId) {
        logAction('codesign.discarded', { action, projectId: requestProjectId });
        return;
      }
      let next = stageGenerationRun(document, value.run);
      next = stageCandidates(next, value.run.id, value.candidates);
      for (const candidate of value.candidates) {
        for (const change of candidate.atomicChanges) {
          if (
            change.preservedFromAtomicChangeId &&
            pinnedAtomicIds.includes(change.preservedFromAtomicChangeId)
          ) {
            next = setAtomicChangePinned(next, change.id, true);
          }
        }
      }
      documentStore.replaceMetadata(next);
      const generatedIds = value.candidates.map((candidate) => candidate.id);
      activeCandidateId = generatedIds[0] ?? '';
      selectedAtomicIds = value.candidates[0]?.atomicChanges.map((change) => change.id) ?? [];
      compareSourceActive = false;
      highlightedChangeId = '';
      bottomOpen = true;
      bottomTab = 'process';
      agentStatus = value.fallback ? 'Codex unavailable · local fallback' : agentStatus;
      codesignStatus = `${value.candidates.length} structured ${value.candidates.length === 1 ? 'candidate is' : 'candidates are'} ready for review.`;
      logAction('codesign.ready', {
        action,
        generationRunId: value.run.id,
        candidateIds: generatedIds,
        backend: value.run.backend,
        fallback: Boolean(value.fallback),
      });
    } catch (cause) {
      if (requestId !== generationRequestId) return;
      error = cause instanceof Error ? cause.message : 'Codesign generation failed';
      codesignStatus = error;
      logAction('codesign.failed', {
        action,
        message: error,
      });
    } finally {
      if (requestId === generationRequestId) loadingCandidate = false;
    }
  }
  function selectCandidate(candidateId: string) {
    const candidate = document.candidates[candidateId];
    if (!candidate) return;
    activeCandidateId = candidateId;
    selectedAtomicIds = candidate.atomicChangeIds.filter(
      (id) => candidate.decisions[id] === 'pending',
    );
    compareSourceActive = false;
    documentStore.replaceMetadata(viewCandidate(document, candidateId));
    codesignStatus = 'Candidate selected. Your design is unchanged.';
    logAction('codesign.candidate-viewed', { candidateId });
  }
  function toggleAtomicChange(changeId: string, selected: boolean) {
    const candidate = activeCandidate;
    if (!candidate) return;
    const next = new Set(selectedAtomicIds);
    const includeDependencies = (id: string) => {
      next.add(id);
      document.atomicChanges[id]?.dependencyIds.forEach(includeDependencies);
    };
    const removeDependents = (id: string) => {
      next.delete(id);
      candidate.atomicChangeIds
        .filter((candidateId) => document.atomicChanges[candidateId]?.dependencyIds.includes(id))
        .forEach(removeDependents);
    };
    if (selected) includeDependencies(changeId);
    else removeDependents(changeId);
    selectedAtomicIds = [...next];
    highlightedChangeId = changeId;
    logAction('codesign.atomic-toggled', { changeId, selected });
  }
  function toggleAtomicPin(changeId: string, pinned: boolean) {
    documentStore.replaceMetadata(setAtomicChangePinned(document, changeId, pinned));
    codesignStatus = pinned
      ? 'Pinned change will be preserved on the next reroll.'
      : 'Change unpinned.';
    logAction('codesign.atomic-pin-changed', { changeId, pinned });
  }
  function acceptCandidate(candidateId: string, acceptAll: boolean) {
    const candidate = document.candidates[candidateId];
    if (!candidate) return;
    const pending = candidate.atomicChangeIds.filter((id) => candidate.decisions[id] === 'pending');
    const acceptedIds = acceptAll
      ? pending
      : pending.filter((id) => selectedAtomicIds.includes(id));
    const rejectedIds = pending.filter((id) => !acceptedIds.includes(id));
    try {
      documentStore.commitRevision(
        acceptCandidateChanges(document, candidateId, acceptedIds, rejectedIds),
      );
      selectedAtomicIds = [];
      compareSourceActive = false;
      codesignStatus = rejectedIds.length
        ? `Accepted ${acceptedIds.length} and saved ${rejectedIds.length} as rejected.`
        : `Accepted all ${acceptedIds.length} changes in one revision.`;
      logAction('codesign.accepted', { candidateId, acceptedIds, rejectedIds });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Candidate could not be accepted';
      codesignStatus = error;
    }
  }
  function rejectActiveCandidate(candidateId: string) {
    documentStore.replaceMetadata(rejectCandidate(document, candidateId));
    selectedAtomicIds = [];
    codesignStatus = 'Candidate rejected and retained in process history.';
    logAction('codesign.rejected', { candidateId });
  }
  function rerollCandidate(candidateId: string) {
    const candidate = document.candidates[candidateId];
    if (!candidate) return;
    documentStore.replaceMetadata(recordReroll(document, candidate.generationRunId));
    void generateCandidates(document.generationRuns[candidate.generationRunId].action, candidateId);
  }
  function toggleSourceComparison(compare: boolean) {
    if (!activeCandidate) return;
    compareSourceActive = compare;
    const result = compareWithSource(document, activeCandidate.id);
    documentStore.replaceMetadata(result.document);
    codesignStatus = compare ? 'Showing the captured source revision.' : 'Showing the candidate.';
  }
  function replayRecordedCandidate(candidateId: string) {
    try {
      const candidate = document.candidates[candidateId];
      if (!candidate) return;
      const acceptedIds = candidate.atomicChangeIds.filter(
        (id) => candidate.decisions[id] === 'accepted',
      );
      documentStore.commitRevision(
        replayCandidate(
          document,
          candidateId,
          acceptedIds.length ? acceptedIds : candidate.atomicChangeIds,
        ),
      );
      codesignStatus = 'Recorded changes reapplied from their source revision.';
      logAction('codesign.replayed', { candidateId });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Recorded changes could not be reapplied';
    }
  }
  function selectObservationScope(scope: ObservationScope) {
    observationKind = scope.kind;
    codesignStatus = `Codesign can reference ${scope.nodeIds.length} ${scope.nodeIds.length === 1 ? 'layer' : 'layers'}; only the selection can change.`;
  }
  function stageFidelity(fidelity: Fidelity) {
    requestedFidelity = fidelity;
    codesignStatus = `${fidelity[0].toUpperCase() + fidelity.slice(1)} is staged as the target. Choose Complete to generate.`;
  }
  function inspectFidelityCandidate(fidelity: Fidelity) {
    const candidate = runCandidates.find((item) => item.fidelity === fidelity);
    if (candidate) selectCandidate(candidate.id);
  }
  function navigateRepresentation(fidelity: Fidelity, representationId: string) {
    requestedFidelity = fidelity;
    const representation = document.representations[representationId];
    if (!representation) return;
    documentStore.replaceMetadata(activateRevision(document, representation.revisionId));
    if (representation.rootNodeIds[0]) selection = [representation.rootNodeIds[0]];
    codesignStatus = `${fidelity[0].toUpperCase() + fidelity.slice(1)} representation selected.`;
    logAction('fidelity.navigated', { fidelity, representationId });
  }
  function toggleSelectedNodePin(nodeId: string) {
    const pinned = !document.pinnedNodeIds.includes(nodeId);
    documentStore.replaceMetadata(setNodePinned(document, nodeId, pinned));
    codesignStatus = pinned
      ? 'Element pinned. Future candidates cannot change it.'
      : 'Element unpinned.';
    logAction('codesign.node-pin-changed', { nodeId, pinned });
  }
  function duplicateScreen() {
    apply({
      id: uid('op'),
      type: 'duplicate-screen',
      actor: 'user',
      sourceScreenId: document.activeScreenId,
      screenId: uid('screen'),
    });
    selection = [];
  }
  function connectTo(targetScreenId: string) {
    if (!connectSource) return;
    apply({
      id: uid('op'),
      type: 'transition',
      actor: 'user',
      transition: {
        id: uid('transition'),
        sourceNodeId: connectSource,
        targetScreenId,
        label: 'Open details',
      },
    });
    connectSource = '';
    tool = 'select';
  }
  function changeStyle(patch: Partial<DesignNode['style']>) {
    if (selection.length)
      apply({
        id: uid('op'),
        type: 'style',
        actor: 'user',
        targetIds: selection.slice(0, 1),
        patch,
      });
  }
  function generalize() {
    const source = selectedNodes[0];
    if (!source) return;
    const targets = source.repeaterId
      ? visibleNodes.filter((node) => node.repeaterId === source.repeaterId).map((node) => node.id)
      : source.componentBinding
        ? visibleNodes
            .filter(
              (node) => node.componentBinding?.componentId === source.componentBinding?.componentId,
            )
            .map((node) => node.id)
        : [source.id];
    apply({
      id: uid('op'),
      type: 'generalize',
      actor: 'user',
      sourceId: source.id,
      targetIds: targets,
      scope: source.repeaterId ? 'repeater-siblings' : 'component-on-screen',
      patch: {
        density: source.style.density,
        padding: source.style.padding,
        radius: source.style.radius,
      },
    });
  }
  function branch() {
    apply({
      id: uid('op'),
      type: 'create-branch',
      actor: 'user',
      sourceScreenId: document.activeScreenId,
      branchId: uid('branch'),
    });
    selection = [];
  }
</script>

<svelte:head
  ><title>Codesign · Visual autocomplete</title><meta
    name="description"
    content="Explore structured visual continuations without changing your source design."
  /></svelte:head
>

<svelte:window onclick={logControlClick} />

<div class="app" class:preview>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">C</span><strong>Codesign</strong><span class="document-name"
        >{activeProject?.name ?? 'Untitled design'}</span
      >
    </div>
    <div class="mode-switch" aria-label="Editor mode">
      <button class:active={editorMode === 'edit'} onclick={() => setEditorMode('edit')}
        >Edit</button
      ><button class:active={editorMode === 'codesign'} onclick={() => setEditorMode('codesign')}
        >Co-design</button
      ><button class:active={editorMode === 'preview'} onclick={() => setEditorMode('preview')}
        >Preview</button
      >
    </div>
    <div class="top-actions">
      <span class="status" title={agentStatus}
        ><i aria-hidden="true" class:online={backend === 'codex'}></i>{backend === 'codex'
          ? 'Codex'
          : 'Local'}</span
      >
      <button title="Undo · Ctrl/⌘ Z" onclick={() => undo('toolbar')}
        ><span class="button-icon" aria-hidden="true">↶</span>Undo</button
      ><button title="Redo · Ctrl/⌘ Shift Z" onclick={() => redo('toolbar')}
        ><span class="button-icon" aria-hidden="true">↷</span>Redo</button
      >
      <button
        onclick={() => {
          if (confirm('Reset the design to a blank canvas?')) {
            resetDocument();
          }
        }}>Reset to blank</button
      >
      <button class="checkpoint" onclick={loadDemoCheckpoint}>Load demo checkpoint</button>
    </div>
  </header>

  <aside class="leftbar">
    <section class="projects" aria-label="Projects">
      <label for="project-picker">Project</label>
      <select
        id="project-picker"
        value={activeProjectId}
        onchange={(event) => switchProject(event.currentTarget.value)}
      >
        {#each projects as project (project.id)}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
      <div class="project-actions">
        <button onclick={createProject}>New project</button>
        <button onclick={renameProject}>Rename</button>
        <button onclick={deleteProject}>Delete</button>
      </div>
    </section>
    <nav class="tools" aria-label="Tools">
      {#each [{ id: 'select', label: 'Select', icon: '↖', key: 'V' }, { id: 'frame', label: 'Frame', icon: '▣', key: 'F' }, { id: 'rectangle', label: 'Rectangle', icon: '□', key: 'R' }, { id: 'text', label: 'Text', icon: 'T', key: 'T' }, { id: 'connect', label: 'Connect', icon: '↗', key: 'C' }] as item}<button
          class:active={tool === item.id}
          title={`${item.label} tool · ${item.key}`}
          onclick={() => setTool(item.id as Tool, 'toolbar')}
          ><span class="tool-icon" aria-hidden="true">{item.icon}</span><span class="tool-label"
            >{item.label}</span
          ><kbd>{item.key}</kbd></button
        >{/each}
    </nav>
    <section class="outline">
      <div class="section-title">
        <span>Screens</span><button title="Duplicate screen" onclick={duplicateScreen}
          ><span aria-hidden="true">＋</span>Duplicate screen</button
        >
      </div>
      {#each document.branches as branchItem}
        <div class="branch-label"><span aria-hidden="true">◇</span> Branch: {branchItem.name}</div>
        {#each document.screens.filter((screen) => screen.branchId === branchItem.id) as screen}
          <div class:active={screen.id === document.activeScreenId} class="screen-row">
            <button
              onclick={() => {
                navigateToScreen(screen.id, branchItem.id);
              }}>{screen.name}</button
            >{#if connectSource && screen.id !== document.activeScreenId}<button
                class="connect-dest"
                onclick={() => connectTo(screen.id)}>Connect</button
              >{/if}
          </div>
        {/each}
      {/each}
      <div class="section-title layers-title">
        <span>Layers</span><small>{visibleNodes.length}</small>
      </div>
      <div class="layers">
        {#each layerRows as row (row.node.id)}<button
            class:selected={selection.includes(row.node.id)}
            class:child-layer={row.depth > 0}
            style={`--layer-indent:${5 + row.depth * 14}px`}
            onclick={(event) => {
              selection = event.shiftKey
                ? [...new Set([...selection, row.node.id])]
                : [row.node.id];
              logAction('selection.changed', {
                source: 'layers',
                nodeIds: selection,
                additive: event.shiftKey,
              });
            }}
            ><span class="layer-kind"
              >{row.node.componentBinding
                ? 'Component'
                : row.node.kind === 'rectangle'
                  ? 'Shape'
                  : row.node.kind}</span
            ><span class="layer-name">{row.node.name}</span></button
          >{/each}
      </div>
      <button class="branch-action" onclick={branch}
        ><span aria-hidden="true">◇</span>Branch current screen</button
      >
    </section>
  </aside>

  <main class="workspace">
    <div class="canvas-toolbar">
      <button onclick={() => setZoom(zoom - 0.1, 'zoom-out-button')}
        ><span aria-hidden="true">−</span>Zoom out</button
      ><button onclick={() => resetViewport('reset-zoom-button')}
        >Reset zoom <span class="zoom-value">{Math.round(zoom * 100)}%</span></button
      ><button onclick={() => setZoom(zoom + 0.1, 'zoom-in-button')}
        ><span aria-hidden="true">＋</span>Zoom in</button
      ><label class="canvas-color-control"
        ><span>Canvas color</span><input
          type="color"
          aria-label="Canvas color"
          value={canvasBackground}
          oninput={(event) => setCanvasBackground(event.currentTarget.value)}
        /></label
      ><button
        class="reset-canvas-color"
        disabled={canvasBackground === DEFAULT_CANVAS_BACKGROUND}
        onclick={() => setCanvasBackground(DEFAULT_CANVAS_BACKGROUND, 'reset-button')}
        >Reset color</button
      >
    </div>
    <div class="canvas-help">
      {preview
        ? 'Click a connected object to navigate · Esc to exit'
        : editorMode === 'codesign'
          ? 'Solid outline: can change · Dashed outline: can reference · Candidate ghosts never block the canvas'
          : `${tool[0].toUpperCase() + tool.slice(1)} tool · Scroll to pan · Pinch to zoom · Right-click for actions`}
    </div>
    <svg
      class="canvas"
      role="application"
      aria-label="Design canvas"
      style={`background-color:${canvasBackground}`}
      onpointerdown={canvasDown}
      onpointermove={canvasMove}
      onpointerup={canvasUp}
      onpointercancel={() => {
        gesture = null;
        draft = null;
      }}
      onwheel={wheel}
      oncontextmenu={(event) => openContextMenu(event)}
    >
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {#each document.transitions.filter((item) => document.nodes[item.sourceNodeId]?.screenId === document.activeScreenId) as transition}<path
            class="transition"
            d={`M ${document.nodes[transition.sourceNodeId].bounds.x + document.nodes[transition.sourceNodeId].bounds.width} ${document.nodes[transition.sourceNodeId].bounds.y + document.nodes[transition.sourceNodeId].bounds.height / 2} l 46 0`}
          /><text
            class="transition-label"
            x={document.nodes[transition.sourceNodeId].bounds.x +
              document.nodes[transition.sourceNodeId].bounds.width +
              8}
            y={document.nodes[transition.sourceNodeId].bounds.y +
              document.nodes[transition.sourceNodeId].bounds.height / 2 -
              7}>→ state</text
          >{/each}
        {#each renderedNodes as node (node.id)}
          <g
            id={`node-${node.id}`}
            class:selected={selection.includes(node.id)}
            class:promoted={!!node.componentBinding}
            class:clickable={preview &&
              document.transitions.some((item) => item.sourceNodeId === node.id)}
            role="button"
            tabindex="0"
            aria-label={node.name}
            onpointerdown={(event) => nodeDown(event, node)}
            oncontextmenu={(event) => openContextMenu(event, node)}
          >
            {#if editorMode === 'codesign' && observationScope.nodeIds.includes(node.id)}
              <rect
                class:mutation-boundary={selection.includes(node.id)}
                class:observation-boundary={!selection.includes(node.id)}
                x={node.bounds.x - 6 / zoom}
                y={node.bounds.y - 6 / zoom}
                width={node.bounds.width + 12 / zoom}
                height={node.bounds.height + 12 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if editorMode === 'codesign' && highlightedChangeId && document.atomicChanges[highlightedChangeId]?.trace.evidenceNodeIds.includes(node.id)}
              <rect
                class="evidence-highlight"
                x={node.bounds.x - 10 / zoom}
                y={node.bounds.y - 10 / zoom}
                width={node.bounds.width + 20 / zoom}
                height={node.bounds.height + 20 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            <rect
              class="node"
              x={node.bounds.x}
              y={node.bounds.y}
              width={node.bounds.width}
              height={node.bounds.height}
              rx={node.style.radius}
              fill={node.style.fill}
              stroke={node.style.stroke}
            />
            {#if node.componentBinding || selection.includes(node.id)}<rect
                class="content-area"
                x={node.bounds.x + contentInset(node)}
                y={node.bounds.y + contentInset(node)}
                width={Math.max(0, node.bounds.width - contentInset(node) * 2)}
                height={Math.max(0, node.bounds.height - contentInset(node) * 2)}
                rx={Math.max(0, node.style.radius - 2)}
              />{/if}
            {#if node.componentBinding}<rect
                class="component-accent"
                x={node.bounds.x}
                y={node.bounds.y}
                width="4"
                height={node.bounds.height}
                rx="2"
              /><text
                class="component-name"
                x={node.bounds.x + contentInset(node)}
                y={node.bounds.y + Math.min(contentInset(node) + 11, node.bounds.height - 8)}
                >{node.componentBinding.componentId} · {node.style.density ?? 'comfortable'}</text
              >{/if}
            {#if node.text || node.semantics}<text
                class="node-label"
                x={node.bounds.x + contentInset(node)}
                y={node.bounds.y +
                  Math.min(
                    contentInset(node) + (node.componentBinding ? 28 : node.style.fontSize),
                    node.bounds.height - 7,
                  )}
                style={`font-size:${node.style.fontSize}px;fill:${node.style.textColor}`}
                >{node.text ?? node.semantics?.role}</text
              >{/if}
            {#if node.repeaterId}<g class="repeat-badge"
                ><rect
                  x={node.bounds.x + node.bounds.width - 62}
                  y={node.bounds.y + 7}
                  width="54"
                  height="18"
                  rx="3"
                /><text x={node.bounds.x + node.bounds.width - 55} y={node.bounds.y + 20}
                  >REPEAT</text
                ></g
              >{/if}
            {#if selection.includes(node.id) && !preview}<rect
                class="selection-box"
                x={node.bounds.x - 2 / zoom}
                y={node.bounds.y - 2 / zoom}
                width={node.bounds.width + 4 / zoom}
                height={node.bounds.height + 4 / zoom}
              /><rect
                class="handle"
                role="button"
                tabindex="0"
                aria-label={`Resize ${node.name}`}
                x={node.bounds.x + node.bounds.width - 5 / zoom}
                y={node.bounds.y + node.bounds.height - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                onpointerdown={(event) => resizeDown(event, node)}
                onkeydown={(event) => resizeKeydown(event, node)}
              />{/if}
          </g>
        {/each}
        {#if editorMode === 'codesign' && ghostSnapshot}
          <g
            class:source-comparison={compareSourceActive}
            class="candidate-ghost"
            aria-hidden="true"
          >
            {#each ghostNodes as node (node.id)}
              <g
                class:highlighted-ghost={Boolean(
                  highlightedChangeId &&
                  document.atomicChanges[highlightedChangeId]?.trace.affectedNodeIds.includes(
                    node.id,
                  ),
                )}
              >
                <rect
                  x={node.bounds.x}
                  y={node.bounds.y}
                  width={node.bounds.width}
                  height={node.bounds.height}
                  rx={node.style.radius}
                  fill={node.style.fill}
                  stroke={node.style.stroke}
                />
                {#if node.text}
                  <text
                    x={node.bounds.x + contentInset(node)}
                    y={node.bounds.y +
                      Math.min(contentInset(node) + node.style.fontSize, node.bounds.height - 7)}
                    style={`font-size:${node.style.fontSize}px;fill:${node.style.textColor}`}
                    >{node.text}</text
                  >
                {/if}
              </g>
            {/each}
          </g>
        {/if}
        {#if draft}<rect
            class="draft"
            x={draft.x}
            y={draft.y}
            width={draft.width}
            height={draft.height}
          />{/if}
      </g>
    </svg>
    {#if selection.length && !preview}<div class="context-bar">
        <span>{selection.length} selected</span><button onclick={() => setEditorMode('codesign')}
          >Open in Co-design</button
        >{#if selectedNodes[0]?.componentBinding}<button onclick={generalize}
            >Apply style to matching components</button
          >{/if}
      </div>{/if}

    {#if contextMenu}<div
        class="context-menu"
        role="menu"
        aria-label={contextNode ? `${contextNode.name} actions` : 'Canvas actions'}
        style={`left:${contextMenu.x}px;top:${contextMenu.y}px`}
        bind:this={contextMenuElement}
      >
        <div class="context-menu-header">
          <strong>{contextNode?.name ?? 'Canvas'}</strong><span
            >{preview
              ? 'Preview actions'
              : contextNode
                ? `${selection.length > 1 ? `${selection.length} selected · ` : ''}${contextNode.componentBinding ? 'Component' : contextNode.kind}`
                : 'Canvas actions'}</span
          >
        </div>
        {#if preview}<button
            role="menuitem"
            onclick={() => {
              setEditorMode('edit');
              contextMenu = null;
            }}>Exit preview to edit</button
          >{:else if contextNode}<button role="menuitem" onclick={promoteFromContext}
            >Open in Co-design</button
          ><button role="menuitem" onclick={startConnectionFromContext}>Start connection</button
          ><button class="danger" role="menuitem" onclick={deleteFromContext}
            >Delete {selection.length > 1 ? 'selection' : 'element'}</button
          >{:else}<button
            role="menuitem"
            onclick={() => {
              resetViewport('context-menu');
              contextMenu = null;
            }}>Reset canvas view</button
          ><button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              duplicateScreen();
            }}>Duplicate screen</button
          ><button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              branch();
            }}>Branch current screen</button
          >{/if}
      </div>{/if}

    <section class:open={bottomOpen} class="bottom-panel">
      <div class="bottom-tabs">
        {#each ['process', 'operations', 'code'] as tab}<button
            class:active={bottomTab === tab}
            onclick={() => {
              bottomTab = tab as typeof bottomTab;
              bottomOpen = true;
            }}
            >{tab === 'process'
              ? 'Process history'
              : tab === 'operations'
                ? 'Applied operations'
                : 'Svelte projection'}</button
          >{/each}<button class="panel-toggle" onclick={() => (bottomOpen = !bottomOpen)}
          >{bottomOpen ? 'Hide panel' : 'Show panel'}
          <span aria-hidden="true">{bottomOpen ? '⌄' : '⌃'}</span></button
        >
      </div>
      {#if bottomOpen}<div class="panel-body">
          {#if bottomTab === 'process'}
            <ProcessPanel
              events={processEventViews}
              activeEventId={activeProcessEventId}
              onInspectEvent={(eventId) => (activeProcessEventId = eventId)}
              onViewCandidate={selectCandidate}
              onCompareSource={(candidateId) => {
                selectCandidate(candidateId);
                toggleSourceComparison(true);
              }}
              onReplay={replayRecordedCandidate}
            />
          {:else if bottomTab === 'operations'}<div class="history">
              {#each [...document.operations].reverse() as operation}<div>
                  <i class:agent={operation.actor === 'agent'}
                    >{operation.actor === 'agent' ? 'CODESIGN' : 'YOU'}</i
                  ><span>{operation.summary}</span><time
                    >{new Date(operation.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}</time
                  >
                </div>{/each}{#if !document.operations.length}<p>No applied operations yet.</p>{/if}
            </div>{:else}<div class="code-header">
              <span>Read-only deterministic export</span><button
                onclick={() => navigator.clipboard.writeText(code)}>Copy code</button
              >
            </div>
            <pre>{code}</pre>{/if}
        </div>{/if}
    </section>
  </main>

  <aside class="inspector">
    <div class="inspector-tabs">
      <button
        class:active={inspectorTab === 'properties'}
        onclick={() => (inspectorTab = 'properties')}>Properties</button
      ><button class:active={inspectorTab === 'trace'} onclick={() => (inspectorTab = 'trace')}
        >Trace</button
      >
    </div>
    {#if inspectorTab === 'trace'}
      <CodesignPanel
        mutationLabels={selectedNodes.map((node) => node.name)}
        observationSummary={observationScopes.find(
          (item) => item.scope.kind === observationScope.kind,
        )?.label ?? 'Selection'}
        {observationScope}
        {observationScopes}
        supportedActions={[{ action: 'complete' }]}
        {fidelityStops}
        run={latestRun}
        candidates={candidateViews}
        activeCandidateId={activeCandidate?.id}
        highlightedChangeId={highlightedChangeId || undefined}
        compareSource={compareSourceActive}
        busy={loadingCandidate}
        statusMessage={codesignStatus}
        rerollDisabledReason={activeCandidate?.status === 'accepted' ||
        activeCandidate?.status === 'partially-accepted'
          ? 'Applied candidates cannot be rerolled.'
          : undefined}
        onObservationScopeChange={selectObservationScope}
        onGenerate={generateCandidates}
        onNavigateFidelity={navigateRepresentation}
        onStageFidelity={stageFidelity}
        onInspectFidelityCandidate={inspectFidelityCandidate}
        onSelectCandidate={selectCandidate}
        onToggleAtomicChange={toggleAtomicChange}
        onTogglePin={toggleAtomicPin}
        onHighlightChange={(changeId) => (highlightedChangeId = changeId ?? '')}
        onCompareSource={toggleSourceComparison}
        onAcceptAll={(candidateId) => acceptCandidate(candidateId, true)}
        onAcceptSelected={(candidateId) => acceptCandidate(candidateId, false)}
        onRejectCandidate={rejectActiveCandidate}
        onReroll={rerollCandidate}
      />
    {:else if selectedNodes[0]}
      {@const node = selectedNodes[0]}
      <div class="selection-summary">
        <span class="kind-icon" aria-hidden="true">{node.componentBinding ? '◆' : '□'}</span>
        <div><strong>{node.name}</strong><small>{node.kind} · {node.id.slice(-8)}</small></div>
      </div>
      <section>
        <h3>Geometry</h3>
        <div class="field-grid">
          {#each ['x', 'y', 'width', 'height'] as field}<label
              >{field[0].toUpperCase()}<input
                type="number"
                value={Math.round(node.bounds[field as keyof Bounds])}
                onchange={(event) =>
                  apply({
                    id: uid('op'),
                    type: 'resize',
                    actor: 'user',
                    targetId: node.id,
                    bounds: { ...node.bounds, [field]: Number(event.currentTarget.value) },
                  })}
              /></label
            >{/each}
        </div>
      </section>
      <section>
        <h3>Appearance</h3>
        <label
          >Density<select
            value={node.style.density}
            onchange={(event) =>
              changeStyle({
                density: event.currentTarget.value as 'compact' | 'comfortable',
                padding: event.currentTarget.value === 'compact' ? 8 : 16,
              })}
            ><option value="compact">Compact</option><option value="comfortable">Comfortable</option
            ></select
          ></label
        ><label
          ><span class="control-label"
            ><span>Corner radius</span><output>{node.style.radius}px</output></span
          ><input
            type="range"
            aria-label="Corner radius"
            min="0"
            max="12"
            step="4"
            value={node.style.radius}
            oninput={(event) => changeStyle({ radius: Number(event.currentTarget.value) })}
          /></label
        ><label
          ><span class="control-label"
            ><span>Padding</span><output>{node.style.padding}px</output></span
          ><input
            type="range"
            aria-label="Padding"
            min="4"
            max="24"
            step="4"
            value={node.style.padding}
            oninput={(event) => changeStyle({ padding: Number(event.currentTarget.value) })}
          /></label
        >{#if node.componentBinding}<button class="wide" onclick={generalize}
            >Apply style to {node.repeaterId
              ? 'repeater siblings'
              : 'same component on screen'}</button
          >{/if}
      </section>
      <section>
        <h3>Fidelity and origin</h3>
        <dl>
          <dt>Fidelity</dt>
          <dd>{effectiveFidelity(document, node.id)}</dd>
          <dt>Origin</dt>
          <dd>{node.provenance.actor === 'agent' ? 'AI' : 'Human'}</dd>
        </dl>
        <button class="wide" onclick={() => toggleSelectedNodePin(node.id)}
          >{document.pinnedNodeIds.includes(node.id)
            ? 'Unpin element'
            : 'Pin element for future candidates'}</button
        >
      </section>
    {:else}
      <div class="no-selection">
        <span aria-hidden="true">◎</span><strong>No selection</strong>
        <p>Select an object to inspect its geometry, appearance, fidelity, and origin.</p>
      </div>
      <section>
        <h3>Co-design starts from selection</h3>
        <p class="muted">
          Select a frame or object, switch to Co-design, then choose a visible generation action.
          Selection alone never generates or changes anything.
        </p>
      </section>
      <section>
        <h3>Generator boundary</h3>
        <p class="muted">
          {agentStatus}. Candidates are structured, scoped, and applied only after your decision.
        </p>
      </section>
    {/if}
  </aside>
  <div class="live" aria-live="polite">{error || notice}</div>
  {#if storageWarning}<div class="storage-warning" role="status">
      <strong>Project recovery notice</strong><span>{storageWarning}</span>
    </div>{/if}
  {#if error}<div class="error-toast">
      <strong>Couldn’t apply change</strong><span>{error}</span><button onclick={() => (error = '')}
        >Dismiss</button
      >
    </div>{/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif;
    color: #20242b;
    background: #eef0f3;
  }
  :global(button),
  :global(input),
  :global(select) {
    font: inherit;
  }
  :global(button) {
    color: inherit;
  }
  :global(kbd) {
    min-width: 18px;
    padding: 1px 4px;
    border: 1px solid #c7ccd2;
    border-radius: 3px;
    background: #f2f4f6;
    color: #69717c;
    font:
      9px/1.35 ui-monospace,
      SFMono-Regular,
      monospace;
    text-align: center;
  }
  .app {
    height: 100vh;
    display: grid;
    grid-template: 48px minmax(0, 1fr) / 232px minmax(0, 1fr) 390px;
    background: #eef0f3;
    font-size: 13px;
  }
  .topbar {
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border-bottom: 1px solid #cdd1d7;
    background: #f9fafb;
    z-index: 20;
  }
  .brand,
  .top-actions,
  .mode-switch {
    display: flex;
    align-items: center;
  }
  .brand {
    width: 310px;
    gap: 9px;
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    background: #20242b;
    color: white;
    font-weight: 800;
  }
  .document-name {
    padding-left: 10px;
    border-left: 1px solid #d7dbe0;
    color: #737984;
  }
  .topbar button {
    border: 1px solid transparent;
    background: transparent;
    height: 30px;
    padding: 0 9px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .topbar button:hover {
    background: #eceef1;
  }
  .mode-switch {
    border: 1px solid #cdd1d7;
    border-radius: 5px;
    padding: 2px;
    background: #f0f2f4;
  }
  .mode-switch button {
    height: 25px;
  }
  .mode-switch .active {
    background: white;
    border-color: #d4d8dd;
    box-shadow: 0 1px 2px #0001;
  }
  .top-actions {
    gap: 4px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
  }
  .status i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6b7280;
  }
  .status i.online {
    background: #1c9464;
  }
  .checkpoint {
    color: #285e8f !important;
    border-color: #b7cadc !important;
  }
  .button-icon {
    font-size: 15px;
    line-height: 1;
  }
  .leftbar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid #cdd1d7;
    background: #f7f8fa;
    min-height: 0;
  }
  .projects {
    display: grid;
    gap: 6px;
    padding: 9px 8px;
    border-bottom: 1px solid #d6dae0;
  }
  .projects label {
    color: #747b85;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .projects select {
    width: 100%;
    height: 32px;
    border: 1px solid #bdc4cc;
    border-radius: 4px;
    background: white;
    padding: 0 7px;
    color: #313841;
  }
  .project-actions {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 4px;
  }
  .project-actions button {
    min-width: 0;
    min-height: 29px;
    border: 1px solid #c5cbd2;
    border-radius: 4px;
    background: white;
    padding: 0 7px;
    color: #3f4853;
    font-size: 10px;
    cursor: pointer;
  }
  .project-actions button:hover {
    background: #edf2f6;
    border-color: #aab6c2;
  }
  .tools {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    padding: 8px;
    gap: 4px;
    border-bottom: 1px solid #d6dae0;
  }
  .tools button {
    min-width: 0;
    height: 34px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 4px;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    text-align: left;
    cursor: pointer;
  }
  .tools .tool-icon {
    font-size: 15px;
    text-align: center;
  }
  .tools .tool-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tools button.active {
    background: #e1e7ef;
    border-color: #a9b9cb;
    color: #174b78;
  }
  .outline {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }
  .section-title {
    min-height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10px;
    font-weight: 700;
    color: #747b85;
  }
  .section-title button {
    min-height: 27px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid #c5cbd2;
    border-radius: 4px;
    background: white;
    padding: 0 7px;
    color: #3f4853;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .section-title button:hover {
    background: #edf2f6;
    border-color: #aab6c2;
  }
  .branch-label {
    padding: 8px 6px 3px;
    color: #7b828c;
    font-size: 10px;
    text-transform: uppercase;
  }
  .screen-row {
    display: flex;
    align-items: center;
    border-radius: 4px;
  }
  .screen-row > button:first-child {
    flex: 1;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 7px 8px;
    cursor: pointer;
  }
  .screen-row.active {
    background: #dfe8f2;
    color: #174b78;
  }
  .connect-dest {
    font-size: 10px;
    border: 1px solid #6b91b4;
    background: white;
    border-radius: 3px;
    padding: 3px;
  }
  .layers-title {
    margin-top: 10px;
    border-top: 1px solid #d6dae0;
  }
  .layers {
    display: flex;
    flex-direction: column;
  }
  .layers button {
    min-height: 34px;
    border: 0;
    background: transparent;
    border-radius: 3px;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 5px 0 var(--layer-indent, 5px);
    color: #676e78;
    cursor: pointer;
  }
  .layers button.child-layer {
    border-left: 1px solid #d7dce2;
  }
  .layers .layer-kind {
    flex: none;
    border-radius: 3px;
    padding: 2px 4px;
    background: #e8ebef;
    color: #6f7781;
    font-size: 8px;
    line-height: 1.2;
    text-transform: capitalize;
  }
  .layers .layer-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .layers button.selected {
    background: #e3e9ef;
    color: #1e4d76;
  }
  .branch-action {
    width: 100%;
    margin-top: 12px;
    border: 1px solid #c9ced5;
    background: white;
    border-radius: 4px;
    padding: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    cursor: pointer;
  }
  .workspace {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .canvas {
    display: block;
    width: 100%;
    height: calc(100% - 42px);
    touch-action: none;
    transition: background-color 0.12s ease;
  }
  .canvas-toolbar {
    position: absolute;
    z-index: 4;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    min-height: 34px;
    max-width: calc(100% - 16px);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid #cbd0d6;
    border-radius: 4px;
    background: #f9fafbef;
    box-shadow: 0 2px 8px #1f293716;
    white-space: nowrap;
  }
  .canvas-toolbar button {
    height: 26px;
    border: 0;
    background: transparent;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    cursor: pointer;
  }
  .canvas-toolbar button:hover {
    background: #e8ebef;
  }
  .canvas-toolbar span {
    padding: 0 6px;
    font-size: 11px;
  }
  .canvas-toolbar button > span {
    padding: 0;
  }
  .canvas-toolbar .zoom-value {
    color: #727a84;
    font-variant-numeric: tabular-nums;
  }
  .canvas-color-control {
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding-left: 6px;
    border-left: 1px solid #d4d8dd;
    color: #4f5761;
    font-size: 11px;
    cursor: pointer;
  }
  .canvas-color-control > span {
    padding: 0;
  }
  .canvas-color-control input {
    width: 26px;
    height: 22px;
    border: 1px solid #bfc5cc;
    border-radius: 4px;
    background: white;
    padding: 2px;
    cursor: pointer;
  }
  .canvas-color-control input::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  .canvas-color-control input::-webkit-color-swatch {
    border: 0;
    border-radius: 2px;
  }
  .canvas-toolbar .reset-canvas-color {
    color: #616974;
    font-size: 11px;
  }
  .canvas-toolbar .reset-canvas-color:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .canvas-help {
    position: absolute;
    z-index: 4;
    right: 12px;
    bottom: 54px;
    max-width: calc(100% - 24px);
    padding: 6px 9px;
    border: 1px solid #cbd0d6;
    border-radius: 4px;
    background: #f9fafbef;
    color: #787f89;
    box-shadow: 0 2px 8px #1f293710;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  .node {
    vector-effect: non-scaling-stroke;
    stroke-width: 1;
  }
  .selected .node {
    filter: brightness(1.01);
  }
  .promoted .node {
    fill: #fff;
    stroke: #9ca7b4;
  }
  .component-accent {
    fill: #397eb8;
  }
  .component-name {
    font-size: 11px;
    font-weight: 700;
    fill: #285e8f;
  }
  .content-area {
    fill: #397eb808;
    stroke: #397eb855;
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .node-label {
    pointer-events: none;
  }
  .selection-box {
    fill: none;
    stroke: #2672ad;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .mutation-boundary,
  .observation-boundary {
    fill: none;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .mutation-boundary {
    stroke: #125f99;
    stroke-width: 3;
  }
  .observation-boundary {
    stroke: #667783;
    stroke-width: 1.5;
    stroke-dasharray: 7 5;
  }
  .evidence-highlight {
    fill: #f3b94218;
    stroke: #b96f05;
    stroke-width: 3;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .candidate-ghost {
    opacity: 0.72;
    pointer-events: none;
  }
  .candidate-ghost rect {
    stroke: #855e0c;
    stroke-width: 2;
    stroke-dasharray: 7 4;
    vector-effect: non-scaling-stroke;
  }
  .candidate-ghost text {
    font-weight: 650;
    pointer-events: none;
  }
  .candidate-ghost .highlighted-ghost rect {
    stroke: #b7472a;
    stroke-width: 4;
  }
  .candidate-ghost.source-comparison {
    opacity: 0.42;
  }
  .candidate-ghost.source-comparison rect {
    fill: transparent;
    stroke: #5f6872;
    stroke-dasharray: 3 4;
  }
  .candidate-ghost.source-comparison text {
    opacity: 0.35;
  }
  .handle {
    fill: #fff;
    stroke: #2672ad;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    cursor: nwse-resize;
  }
  .draft {
    fill: #b9cbe044;
    stroke: #2672ad;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .repeat-badge rect {
    fill: #2e596f;
  }
  .repeat-badge text {
    fill: white;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.06em;
  }
  .transition {
    stroke: #4382b6;
    fill: none;
    stroke-width: 2;
    stroke-dasharray: 4 3;
  }
  .transition-label {
    fill: #356687;
    font-size: 10px;
  }
  .clickable {
    cursor: pointer;
  }
  .context-bar {
    position: absolute;
    z-index: 5;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    background: #202731;
    color: white;
    border-radius: 5px;
    box-shadow: 0 4px 14px #11182730;
  }
  .context-bar span {
    padding: 0 7px;
    color: #c9d0d9;
  }
  .context-bar button {
    height: 27px;
    border: 0;
    border-radius: 3px;
    background: #394452;
    color: white;
    cursor: pointer;
  }
  .context-bar button:hover {
    background: #4a596b;
  }
  .context-menu {
    position: fixed;
    z-index: 40;
    width: 236px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid #bfc5cc;
    border-radius: 6px;
    background: #fbfcfd;
    box-shadow: 0 12px 32px #17202b30;
  }
  .context-menu-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: -6px -6px 4px;
    padding: 9px 11px;
    border-bottom: 1px solid #d7dbe0;
    background: #f2f4f6;
    border-radius: 6px 6px 0 0;
  }
  .context-menu-header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .context-menu-header span {
    color: #737b85;
    font-size: 10px;
    text-transform: capitalize;
  }
  .context-menu button {
    width: 100%;
    min-height: 32px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    padding: 0 8px;
    text-align: left;
    cursor: pointer;
  }
  .context-menu button:hover,
  .context-menu button:focus-visible {
    background: #e7edf3;
  }
  .context-menu button.danger {
    margin-top: 3px;
    border-top: 1px solid #e0d2d0;
    border-radius: 0 0 4px 4px;
    color: #98453d;
  }
  .bottom-panel {
    position: absolute;
    z-index: 6;
    left: 0;
    right: 0;
    bottom: 0;
    height: 42px;
    border-top: 1px solid #cbd0d6;
    background: #f8f9fa;
    transition: height 0.16s ease;
  }
  .bottom-panel.open {
    height: 252px;
  }
  .bottom-tabs {
    height: 41px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-bottom: 1px solid #d4d8dd;
  }
  .bottom-tabs button {
    height: 100%;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    padding: 0 14px;
    text-transform: capitalize;
    cursor: pointer;
  }
  .bottom-tabs button.active {
    border-bottom-color: #286b9e;
    color: #1f5d8d;
  }
  .bottom-tabs .panel-toggle {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    white-space: nowrap;
  }
  .bottom-tabs .panel-toggle span {
    font-size: 16px;
  }
  .panel-body {
    height: 210px;
    overflow: auto;
    background: #f3f5f7;
  }
  .history {
    padding: 8px 14px;
  }
  .history > div {
    display: grid;
    grid-template-columns: 42px 1fr auto;
    align-items: center;
    height: 31px;
    border-bottom: 1px solid #dfe2e6;
  }
  .history i {
    font-style: normal;
    font-size: 8px;
    font-weight: 800;
    color: #5b6775;
  }
  .history i.agent {
    color: #256a9e;
  }
  .history time {
    color: #858b94;
    font-size: 10px;
  }
  .code-header {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: space-between;
    padding: 7px 12px;
    background: #e9edf1;
    border-bottom: 1px solid #d4d8dd;
  }
  .code-header button {
    border: 1px solid #bdc5ce;
    background: white;
    border-radius: 3px;
  }
  .panel-body pre {
    margin: 0;
    padding: 14px 18px;
    font:
      12px/1.55 ui-monospace,
      SFMono-Regular,
      monospace;
    color: #263746;
    white-space: pre;
    overflow: auto;
  }
  .inspector {
    border-left: 1px solid #cdd1d7;
    background: #fafbfc;
    overflow: auto;
  }
  .inspector :global(.codesign-panel) {
    padding: 14px;
  }
  .inspector-tabs {
    height: 41px;
    display: flex;
    border-bottom: 1px solid #d5d9de;
  }
  .inspector-tabs button {
    flex: 1;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    cursor: pointer;
  }
  .inspector-tabs button.active {
    border-bottom-color: #286b9e;
    color: #1f5d8d;
  }
  .selection-summary {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 14px;
    border-bottom: 1px solid #d8dce1;
  }
  .kind-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    background: #e3e9ef;
    border-radius: 4px;
  }
  .selection-summary div {
    display: flex;
    flex-direction: column;
  }
  .selection-summary small {
    color: #7e858e;
    margin-top: 2px;
  }
  .inspector section {
    padding: 13px 14px;
    border-bottom: 1px solid #d8dce1;
  }
  .inspector h3 {
    margin: 0 0 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10px;
    color: #6d747d;
  }
  .inspector label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #636b75;
    margin: 9px 0;
  }
  .control-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .control-label output {
    color: #303944;
    font-variant-numeric: tabular-nums;
  }
  .inspector input,
  .inspector select {
    width: 100%;
    height: 31px;
    border: 1px solid #c4cad1;
    border-radius: 3px;
    background: white;
    padding: 0 7px;
    color: #252b33;
  }
  .muted {
    color: #737a84;
    line-height: 1.45;
  }
  .wide {
    width: 100%;
    border: 1px solid #aebcc9;
    background: white;
    border-radius: 4px;
    padding: 7px;
    cursor: pointer;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin: 0;
    gap: 7px;
    font-size: 11px;
  }
  dt {
    color: #777e87;
  }
  dd {
    margin: 0;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
  }
  .field-grid label {
    margin: 0;
  }
  .no-selection {
    padding: 38px 28px;
    text-align: center;
    color: #777f89;
  }
  .no-selection > span {
    font-size: 25px;
  }
  .no-selection strong {
    display: block;
    margin: 10px;
    color: #454d57;
  }
  .no-selection p {
    line-height: 1.5;
  }
  .live {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .error-toast {
    position: fixed;
    z-index: 30;
    right: 320px;
    bottom: 58px;
    width: 320px;
    display: grid;
    grid-template-columns: 1fr auto;
    padding: 11px 12px;
    background: #fff4f2;
    border: 1px solid #d49b92;
    box-shadow: 0 7px 24px #35161122;
  }
  .error-toast strong,
  .error-toast span {
    grid-column: 1;
  }
  .error-toast span {
    color: #7b4b44;
    margin-top: 3px;
  }
  .error-toast button {
    grid-column: 2;
    grid-row: 1/3;
    align-self: center;
    border: 1px solid #cfa8a1;
    border-radius: 3px;
    background: white;
    padding: 5px 7px;
    font-size: 11px;
    cursor: pointer;
  }
  .storage-warning {
    position: fixed;
    z-index: 29;
    right: 404px;
    bottom: 58px;
    width: min(420px, calc(100vw - 32px));
    display: grid;
    gap: 3px;
    padding: 11px 12px;
    border: 1px solid #c8a562;
    background: #fff8e8;
    box-shadow: 0 7px 24px #35161118;
  }
  .storage-warning span {
    color: #705a31;
  }
  .preview .tools,
  .preview .context-bar {
    opacity: 0.35;
    pointer-events: none;
  }
  .preview .selection-box,
  .preview .handle {
    display: none;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid #246da5 !important;
    outline-offset: 2px;
  }
  @media (max-width: 1200px) {
    .app {
      grid-template-columns: 205px minmax(0, 1fr) 340px;
    }
    .brand {
      width: auto;
    }
    .document-name {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
