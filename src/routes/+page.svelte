<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { documentStore } from '$lib/model/store';
  import {
    defaultStyle,
    layoutForNode,
    type Bounds,
    type CandidateRevision,
    type CodesignAction,
    type DesignDocument,
    type DesignNode,
    type DesignOperation,
    type Fidelity,
    type GenerationRun,
    type LayoutPatch,
    type ObservationScope,
    type ProcessEvent,
    type StylePatch,
    operationSchema,
  } from '$lib/model/types';
  import {
    acceptCandidateChanges,
    compareWithSource,
    effectiveFidelity,
    recordGenerationOutcome,
    recordReroll,
    rejectCandidate,
    replayCandidate,
    setFrameFidelity,
    setAtomicChangePinned,
    setNodeFidelityOverride,
    setNodePinned,
    stageCandidates,
    stageGenerationRun,
    viewCandidate,
  } from '$lib/model/codesign';
  import type { CandidateDraft } from '$lib/model/codesign';
  import { demoCheckpoint } from '$lib/model/checkpoint';
  import { generateSvelte } from '$lib/model/codegen';
  import {
    containingContainerForBounds,
    descendantNodeIds,
    isComponentTreeNode,
    orderedScreenNodes,
    screenLayerRows,
  } from '$lib/model/layers';
  import {
    createClipboardPayload,
    deserializeClipboardPayload,
    isEligibleClipboardParent,
    materializeClipboard,
    serializeClipboardPayload,
    type CodesignClipboardPayload,
  } from '$lib/editor/clipboard';
  import {
    collectiveSelectionBounds,
    consistentSpacingGuides,
    constrainToDominantAxis,
    FRAME_PRESETS,
    framePresetById,
    framePresetSize,
    marqueeSelectedIds,
    resizeBounds,
    snapBounds,
    type FrameOrientation,
    type ResizeHandle,
    type SmartGuide,
    type SpacingGuide,
  } from '$lib/editor/geometry';
  import {
    groupedCanvasContextTarget,
    groupedCanvasSelectionTarget,
    isAdditiveSelectionModifier,
    isCanvasAdditiveSelectionModifier,
    selectedContainerCanvasTarget,
    selectionWithTarget,
  } from '$lib/editor/selection';
  import {
    constrainSidebarPair,
    constrainSidebarWidth,
    SIDEBAR_LAYOUT,
    type SidebarSide,
  } from '$lib/editor/sidebar-layout';
  import { latestDocumentEditTimestamp, relativeEditLabel } from '$lib/editor/edit-status';
  import { logAction } from '$lib/debug/action-log';
  import {
    deriveCodesignGenerationTarget,
    deriveCodesignScopeOptions,
    inspectCodesignEligibility,
    type CodesignScopeKind,
  } from '$lib/agent/generation-target';
  import { applyOperation, canvasSnapshot } from '$lib/model/operations';
  import {
    codesignTelemetryEventSchema,
    isTerminalTelemetryPhase,
    type CodesignTelemetryEvent,
  } from '$lib/agent/telemetry';
  import {
    componentCatalog,
    getDefaultComponentBlueprint,
    resolveComponent,
    validateComponentChild,
  } from '$lib/design-system/registry';
  import ComponentLibrary from '$lib/codesign/ComponentLibrary.svelte';
  import ComponentCanvasRenderer from '$lib/codesign/ComponentCanvasRenderer.svelte';
  import {
    COMPONENT_DRAG_MIME,
    PROJECT_COMPONENT_DRAG_MIME,
    readDraggedComponent,
    readDraggedProjectComponent,
  } from '$lib/codesign/component-drag';
  import ProjectComponentLibrary from '$lib/codesign/ProjectComponentLibrary.svelte';
  import {
    captureProjectComponent,
    currentProjectComponentTemplate,
    instantiateProjectComponent,
  } from '$lib/editor/project-components';
  import CodesignActivity from '$lib/codesign/CodesignActivity.svelte';
  import CodesignPromptInspector from '$lib/codesign/CodesignPromptInspector.svelte';
  import InlineCodesignToolbar, {
    type CandidateView,
  } from '$lib/codesign/InlineCodesignToolbar.svelte';
  import type { FidelityStopView } from '$lib/codesign/FidelityStops.svelte';
  import { activeCodesignStage, type CodesignStage } from '$lib/codesign/fidelity-navigation';
  import ProcessPanel, { type ProcessEventView } from '$lib/codesign/ProcessPanel.svelte';
  import SettingsDialog, {
    type AiIntegrationView,
    type AiModelOption,
    type AiReasoningEffort,
  } from '$lib/codesign/SettingsDialog.svelte';

  type Tool = 'select' | 'frame' | 'rectangle' | 'text';
  type EditorMode = 'edit' | 'preview';
  // Inter's textarea font box sits one pixel below a 14px SVG text baseline.
  const INTER_TEXTAREA_ASCENT_CORRECTION_EM = 1 / 14;
  const DEFAULT_CANVAS_BACKGROUND = '#edf0f3';
  const CANVAS_BACKGROUND_KEY = 'malleable.canvas-background.v1';
  const FRAME_SIZE_KEY = 'codesign.frame-size.v1';
  const AI_SETTINGS_KEY = 'codesign.ai-settings.v1';
  const SIDEBAR_WIDTHS_KEY = 'codesign.sidebar-widths.v1';
  let tool: Tool = 'select';
  let selection: string[] = [];
  let error = '';
  let errorTitle = 'Couldn’t apply change';
  let notice = '';
  let editorMode: EditorMode = 'edit';
  let preview = false;
  let bottomOpen = false;
  let bottomTab: 'process' | 'activity' | 'prompt' | 'operations' | 'code' = 'process';
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let canvasBackground = DEFAULT_CANVAS_BACKGROUND;
  let contextMenu: { x: number; y: number; nodeId?: string } | null = null;
  let contextMenuElement: HTMLDivElement;
  let shortcutsOpen = false;
  let settingsOpen = false;
  let aiSettingsLoading = false;
  let aiSettingsError = '';
  let selectedAiModel = 'gpt-5.6-luna';
  let selectedAiEffort: AiReasoningEffort = 'high';
  let aiIntegration: AiIntegrationView = { models: [] };
  let draft: Bounds | null = null;
  let marquee: Bounds | null = null;
  let transientBounds: Record<string, Bounds> = {};
  let smartGuides: SmartGuide[] = [];
  let spacingGuides: SpacingGuide[] = [];
  let internalClipboard: CodesignClipboardPayload | null = null;
  let pasteCount = 0;
  let duplicatePreviewOffset = { x: 0, y: 0 };
  let spacePressed = false;
  let editingTextId = '';
  let editingTextDraft = '';
  let inlineTextEditor: HTMLTextAreaElement;
  let framePresetId = 'web-desktop';
  let frameOrientation: FrameOrientation = 'landscape';
  let frameSize = { width: 1440, height: 1024 };
  let commandLabel = 'Ctrl';
  let statusClock = Date.now();
  let persistenceReady = false;
  let leftSidebarWidth: number = SIDEBAR_LAYOUT.left.defaultWidth;
  let rightSidebarWidth: number = SIDEBAR_LAYOUT.right.defaultWidth;
  let sidebarResize: {
    side: SidebarSide;
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null = null;
  let layerDrag: {
    sourceId: string;
    targetId?: string;
    position?: 'before' | 'inside' | 'after';
  } | null = null;
  let collapsedLayerIds = new Set<string>();
  let editingLayerId = '';
  let editingLayerName = '';
  let editingLayerSource: 'layers' | 'canvas' = 'layers';
  let layerNameInput: HTMLInputElement;
  let canvasNameInput: HTMLInputElement;
  type CanvasGesture = {
    mode: 'draw' | 'move' | 'duplicate' | 'resize' | 'pan' | 'marquee' | 'frame-marquee';
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    original?: Bounds;
    originalBounds?: Record<string, Bounds>;
    previewIds?: string[];
    handle?: ResizeHandle;
    additive?: boolean;
    frameId?: string;
    duplicatePayload?: CodesignClipboardPayload;
  };
  let canvasElement: SVGSVGElement;
  let gesture: CanvasGesture | null = null;
  let lastCanvasNodePointerDown = { nodeId: '', timestamp: 0 };
  let componentDropActive = false;
  let agentStatus = 'Checking Codex App Server…';
  let providerConnected = true;
  let providerPlan = '';
  let loadingCandidate = false;
  let generationController: AbortController | null = null;
  let liveCandidateDocument: DesignDocument | null = null;
  let activeGenerationSourceRevisionId = '';
  let codesignTelemetrySource: EventSource | null = null;
  let codesignActivityEvents: CodesignTelemetryEvent[] = [];
  let activeTelemetryRequestId = '';
  let idCounter = 0;
  let viewportLogTimer: ReturnType<typeof setTimeout> | undefined;
  let generationRequestId = 0;
  let observationKind: CodesignScopeKind = 'selection';
  let requestedFidelity: Fidelity = 'wireframe';
  let scopePreviewActive = false;
  let activeCandidateId = '';
  let dismissedCandidateSelectionKey = '';
  let selectedAtomicIds: string[] = [];
  let pinnedAtomicIds: string[] = [];
  let highlightedChangeId = '';
  let compareSourceActive = false;
  let proposedSelectionId = '';
  let fidelityTargetNodeId = '';
  let activeProcessEventId = '';
  let codesignStatus = 'Selection alone never generates or changes anything.';

  $: document = $documentStore.present;
  $: pinnedAtomicIds = derivePinnedAtomicIds(document.processEvents);
  $: projects = $documentStore.projects;
  $: activeProjectId = $documentStore.activeProjectId;
  $: storageWarning = $documentStore.warning;
  $: activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  $: lastEditedAt = latestDocumentEditTimestamp(document);
  $: lastEditedLabel = lastEditedAt ? `Edited ${relativeEditLabel(lastEditedAt, statusClock)}` : '';
  $: saveStatusLabel = storageWarning ? 'Save issue' : 'Saved locally';
  $: documentStatusTitle = lastEditedAt
    ? `Last edited ${new Date(lastEditedAt).toLocaleString()}. ${
        storageWarning
          ? 'The latest changes could not be saved locally.'
          : 'All changes are saved in this browser.'
      }`
    : storageWarning
      ? 'This project could not be saved locally.'
      : 'This project is saved in this browser.';
  $: currentScreen =
    document.screens.find((screen) => screen.id === document.activeScreenId) ?? document.screens[0];
  $: visibleNodes = currentScreen ? orderedScreenNodes(document, currentScreen.id) : [];
  $: projectComponents = Object.values(document.projectComponents ?? {}).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  $: eligibleGenerationSelection = selection.filter(
    (id) => document.nodes[id]?.screenId === document.activeScreenId,
  );
  $: codesignEligibility = inspectCodesignEligibility(document, selection);
  $: codesignSelectionEligible = codesignEligibility.eligible;
  $: strictObservationScopes = deriveCodesignScopeOptions(document, selection);
  $: selectedObservationOption =
    strictObservationScopes.find((option) => option.kind === observationKind && option.scope) ??
    strictObservationScopes.find((option) => option.kind === 'selection' && option.scope);
  $: observationScope =
    selectedObservationOption?.scope ??
    ({
      kind: 'selection',
      nodeIds: [],
    } satisfies ObservationScope);
  $: observationScopes = strictObservationScopes.map((option) => ({
    scope: option.scope ?? {
      kind: option.kind === 'selection' ? 'selection' : 'frame',
      nodeIds: [],
    },
    label: option.label,
    description: option.description,
    disabledReason: option.disabledReason,
  }));
  $: generationTarget = codesignSelectionEligible
    ? deriveCodesignGenerationTarget(
        document,
        eligibleGenerationSelection,
        selectedObservationOption?.kind ?? 'selection',
      )
    : undefined;
  $: generationCanGenerate = Boolean(
    generationTarget &&
    (generationTarget.mutationScope.existingNodeIds.length > 0 ||
      (generationTarget.mutationScope.allowCreate &&
        (generationTarget.mutationScope.insertionParentIds.length > 0 ||
          generationTarget.observationScope.kind === 'screen'))),
  );
  $: layerRows = currentScreen
    ? screenLayerRows(document, currentScreen.id, collapsedLayerIds)
    : [];
  $: selectedNodes = selection.map((id) => document.nodes[id]).filter(Boolean);
  $: selectionBounds = collectiveSelectionBounds(
    selectedNodes.map((node) => transientBounds[node.id] ?? node.bounds),
  );
  $: contextNode = contextMenu?.nodeId ? document.nodes[contextMenu.nodeId] : undefined;
  $: code = generateSvelte(document);
  $: scopePreviewNodeIds = scopePreviewActive
    ? makeScopePreviewNodeIds(observationScope, selection)
    : [];
  $: codesignToolbarStatus =
    selection.length && !codesignSelectionEligible
      ? (codesignEligibility.reason ?? 'Place the selection inside a group or frame.')
      : codesignStatus;
  $: currentSelectionKey = sortedIdKey(eligibleGenerationSelection);
  $: if (dismissedCandidateSelectionKey && dismissedCandidateSelectionKey !== currentSelectionKey)
    dismissedCandidateSelectionKey = '';
  $: selectionRun =
    eligibleGenerationSelection.length && dismissedCandidateSelectionKey !== currentSelectionKey
      ? Object.values(document.generationRuns)
          .filter((run) => sortedIdKey(run.target.focusNodeIds) === currentSelectionKey)
          .sort((a, b) => b.createdAt - a.createdAt)[0]
      : undefined;
  $: if (activeCandidateId && eligibleGenerationSelection.length) {
    const selectedRun =
      document.generationRuns[document.candidates[activeCandidateId]?.generationRunId];
    if (
      !selectedRun ||
      sortedIdKey(selectedRun.target.focusNodeIds) !== sortedIdKey(eligibleGenerationSelection)
    ) {
      activeCandidateId = '';
      selectedAtomicIds = [];
      highlightedChangeId = '';
      compareSourceActive = false;
      proposedSelectionId = '';
    }
  }
  $: latestRun = activeCandidateId
    ? document.generationRuns[document.candidates[activeCandidateId]?.generationRunId]
    : selectionRun;
  $: runCandidates = latestRun
    ? Object.values(document.candidates)
        .filter((candidate) => {
          const run = document.generationRuns[candidate.generationRunId];
          return (
            run?.target.focusNodeIds.slice().sort().join(':') ===
            latestRun.target.focusNodeIds.slice().sort().join(':')
          );
        })
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  $: activeCandidate =
    document.candidates[activeCandidateId] ?? runCandidates[runCandidates.length - 1];
  $: activeCandidateRun = activeCandidate
    ? document.generationRuns[activeCandidate.generationRunId]
    : undefined;
  $: reviewTarget = activeCandidateId ? activeCandidateRun?.target : generationTarget;
  $: reviewObservationScope = activeCandidateId
    ? (activeCandidateRun?.target.observationScope ?? observationScope)
    : observationScope;
  $: activeCandidateSnapshot = activeCandidate
    ? document.revisions[activeCandidate.revisionId]?.snapshot
    : undefined;
  $: sourceSnapshot = activeCandidate
    ? document.revisions[activeCandidate.sourceRevisionId]?.snapshot
    : undefined;
  $: ghostSourceSnapshot = liveCandidateDocument ? canvasSnapshot(document) : sourceSnapshot;
  $: if (
    loadingCandidate &&
    activeGenerationSourceRevisionId &&
    document.currentRevisionId !== activeGenerationSourceRevisionId
  )
    abortGenerationForSourceDrift();
  $: ghostSnapshot = liveCandidateDocument
    ? canvasSnapshot(liveCandidateDocument)
    : activeCandidateSnapshot;
  $: reviewSourceNodes = sourceSnapshot
    ? orderedScreenNodes(sourceSnapshot, document.activeScreenId)
    : visibleNodes;
  $: candidateChangedNodeIds = new Set(
    ghostSnapshot && ghostSourceSnapshot
      ? [
          ...Object.keys(ghostSourceSnapshot.nodes).filter((id) => {
            const candidate = ghostSnapshot?.nodes[id];
            return (
              !candidate ||
              JSON.stringify(ghostSourceSnapshot?.nodes[id]) !== JSON.stringify(candidate)
            );
          }),
          ...Object.keys(ghostSnapshot.nodes).filter((id) => !ghostSourceSnapshot?.nodes[id]),
        ]
      : [],
  );
  $: renderedNodes = codesignReviewActive
    ? compareSourceActive
      ? reviewSourceNodes
      : reviewSourceNodes.filter((node) => !candidateChangedNodeIds.has(node.id))
    : visibleNodes;
  $: ghostNodes = ghostSnapshot
    ? Object.values(ghostSnapshot.nodes).filter((node) => {
        if (node.screenId !== document.activeScreenId) return false;
        const source = ghostSourceSnapshot?.nodes[node.id];
        return !source || JSON.stringify(source) !== JSON.stringify(node);
      })
    : [];
  $: proposedLayerRows = makeProposedLayerRows(ghostNodes, ghostSnapshot);
  $: candidateViews = makeCandidateViews(
    runCandidates,
    document,
    selectedAtomicIds,
    pinnedAtomicIds,
  );
  $: activeFidelityStage = codesignStageForSelection(selectedNodes, document);
  $: fidelityStops = makeFidelityStops(selectedNodes, document, runCandidates);
  $: codesignReviewActive = Boolean(
    (loadingCandidate && generationTarget) ||
    (activeCandidateId && activeCandidate && reviewTarget),
  );
  $: if (selectedNodes[0]?.id !== fidelityTargetNodeId) {
    fidelityTargetNodeId = selectedNodes[0]?.id ?? '';
    if (selectedNodes[0])
      requestedFidelity = codesignFidelity(effectiveFidelity(document, selectedNodes[0].id));
  }
  $: processEventViews = makeProcessEventViews(document.processEvents, document);
  $: aiModelOptions = completeModelOptions(
    aiIntegration.models,
    aiIntegration.configuration,
    selectedAiModel,
  );
  $: latestCodesignActivity = codesignActivityEvents.at(-1);
  $: latestCodesignUsage = [...codesignActivityEvents]
    .reverse()
    .find((event) => event.usage)?.usage;
  $: latestRenderedCodesignPrompt = [...codesignActivityEvents]
    .reverse()
    .find((event) => event.renderedPrompt)?.renderedPrompt;
  $: codesignActivityLabel = latestCodesignActivity
    ? {
        preparing: 'Preparing',
        'prompt-sent': 'Prompt running',
        inspecting: 'Inspecting scene',
        rendering: 'Rendering canvas',
        components: 'Finding components',
        applying: 'Applying changes',
        streaming: 'Receiving proposal',
        validating: 'Validating',
        submitting: 'Submitting',
        completed: 'Complete',
        failed: 'Failed',
        cancelled: 'Cancelled',
      }[latestCodesignActivity.phase]
    : 'Idle';
  $: codesignActivityTabLabel = `Codesign activity · ${codesignActivityLabel} · ${
    latestCodesignUsage
      ? `${new Intl.NumberFormat().format(latestCodesignUsage.totalTokens)} tokens`
      : latestCodesignActivity && ['failed', 'cancelled'].includes(latestCodesignActivity.phase)
        ? 'usage unavailable'
        : latestCodesignActivity
          ? 'usage pending'
          : 'no usage yet'
  }`;

  onMount(() => {
    documentStore.restore();
    persistenceReady = true;
    commandLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
    try {
      const savedBackground = localStorage.getItem(CANVAS_BACKGROUND_KEY);
      if (savedBackground && /^#[0-9a-f]{6}$/i.test(savedBackground))
        canvasBackground = savedBackground;
      const savedFrameSize = JSON.parse(localStorage.getItem(FRAME_SIZE_KEY) ?? 'null') as {
        width?: number;
        height?: number;
        presetId?: string;
        orientation?: FrameOrientation;
      } | null;
      if (
        savedFrameSize &&
        Number.isFinite(savedFrameSize.width) &&
        Number.isFinite(savedFrameSize.height)
      ) {
        frameSize = { width: savedFrameSize.width!, height: savedFrameSize.height! };
        framePresetId = savedFrameSize.presetId ?? 'custom';
        frameOrientation = savedFrameSize.orientation ?? 'landscape';
      }
      const savedAiSettings = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? 'null') as {
        model?: string;
        effort?: AiReasoningEffort;
      } | null;
      if (
        savedAiSettings?.model &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(savedAiSettings.model)
      )
        selectedAiModel = savedAiSettings.model;
      if (['low', 'medium', 'high', 'xhigh', 'max'].includes(savedAiSettings?.effort ?? ''))
        selectedAiEffort = savedAiSettings!.effort!;
      const savedSidebarWidths = JSON.parse(localStorage.getItem(SIDEBAR_WIDTHS_KEY) ?? 'null') as {
        left?: number;
        right?: number;
      } | null;
      if (
        savedSidebarWidths &&
        Number.isFinite(savedSidebarWidths.left) &&
        Number.isFinite(savedSidebarWidths.right)
      ) {
        const widths = constrainSidebarPair(
          savedSidebarWidths.left!,
          savedSidebarWidths.right!,
          window.innerWidth,
        );
        leftSidebarWidth = widths.left;
        rightSidebarWidth = widths.right;
      }
    } catch {
      // The editor still works when browser storage is unavailable.
    }
    void refreshProviderStatus();
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (settingsOpen && event.key === 'Escape') {
        event.preventDefault();
        closeSettings('keyboard');
        return;
      }
      if (
        target?.matches('input, select, textarea, [contenteditable="true"]') ||
        target?.closest('dialog, [role="dialog"]')
      )
        return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (key === '/' && !command && !event.altKey) {
        event.preventDefault();
        shortcutsOpen ? closeShortcuts('keyboard') : openShortcuts('keyboard');
        return;
      }
      if (shortcutsOpen) {
        event.preventDefault();
        if (key === 'escape') closeShortcuts('keyboard');
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        spacePressed = true;
        return;
      }
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
      if (command && key === 'c') {
        event.preventDefault();
        void copySelection(false);
        return;
      }
      if (command && key === 'x') {
        event.preventDefault();
        void copySelection(true);
        return;
      }
      if (command && key === 'v') {
        event.preventDefault();
        void pasteSelection();
        return;
      }
      if (command && key === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (command && event.altKey && key === 'k') {
        event.preventDefault();
        createProjectComponent();
        return;
      }
      if (command && event.altKey && key === 'g') {
        event.preventDefault();
        frameSelection();
        return;
      }
      if (command && key === 'g') {
        event.preventDefault();
        event.shiftKey ? ungroupSelection() : groupSelection();
        return;
      }
      if (command && (event.key === ']' || event.key === '[')) {
        event.preventDefault();
        reorderSelection(
          event.key === ']'
            ? event.shiftKey
              ? 'front'
              : 'forward'
            : event.shiftKey
              ? 'back'
              : 'backward',
        );
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length)
          apply({ id: uid('op'), type: 'delete', actor: 'user', targetIds: selection });
        selection = [];
        return;
      }
      if (key === 'escape') {
        if (gesture || draft || marquee || Object.keys(transientBounds).length) {
          cancelCanvasGesture();
        } else if (contextMenu) contextMenu = null;
        else if (activeCandidateId || runCandidates.length) exitCandidateReview('keyboard');
        else if (tool !== 'select') tool = 'select';
        else if (selection.length) selection = [];
        else setEditorMode('edit');
        logAction('editor.escape', { revision: document.revision });
        return;
      }
      const shortcuts: Record<string, Tool> = {
        v: 'select',
        f: 'frame',
        r: 'rectangle',
        t: 'text',
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
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressed = false;
    };
    const dismissContextMenu = (event: PointerEvent) => {
      if (contextMenu && event.target instanceof Element && !event.target.closest('.context-menu'))
        contextMenu = null;
    };
    const fitSidebarsToViewport = () => {
      const widths = constrainSidebarPair(leftSidebarWidth, rightSidebarWidth, window.innerWidth);
      leftSidebarWidth = widths.left;
      rightSidebarWidth = widths.right;
    };
    const statusClockTimer = window.setInterval(() => {
      statusClock = Date.now();
    }, 30_000);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('pointerdown', dismissContextMenu);
    window.addEventListener('resize', fitSidebarsToViewport);
    return () => {
      if (viewportLogTimer) clearTimeout(viewportLogTimer);
      window.clearInterval(statusClockTimer);
      closeCodesignTelemetry();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('pointerdown', dismissContextMenu);
      window.removeEventListener('resize', fitSidebarsToViewport);
    };
  });

  function uid(prefix: string) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
  }
  function currentSidebarWidth(side: SidebarSide) {
    return side === 'left' ? leftSidebarWidth : rightSidebarWidth;
  }
  function setSidebarWidth(side: SidebarSide, proposedWidth: number) {
    const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const otherWidth = side === 'left' ? rightSidebarWidth : leftSidebarWidth;
    const width = constrainSidebarWidth(side, proposedWidth, viewportWidth, otherWidth);
    if (side === 'left') leftSidebarWidth = width;
    else rightSidebarWidth = width;
    return width;
  }
  function persistSidebarWidths() {
    try {
      localStorage.setItem(
        SIDEBAR_WIDTHS_KEY,
        JSON.stringify({ left: leftSidebarWidth, right: rightSidebarWidth }),
      );
    } catch {
      // Keep the resized layout in memory when browser storage is unavailable.
    }
  }
  function startSidebarResize(event: PointerEvent, side: SidebarSide) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sidebarResize = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentSidebarWidth(side),
    };
  }
  function updateSidebarResize(event: PointerEvent) {
    if (!sidebarResize || sidebarResize.pointerId !== event.pointerId) return;
    const movement = event.clientX - sidebarResize.startX;
    setSidebarWidth(
      sidebarResize.side,
      sidebarResize.startWidth + (sidebarResize.side === 'left' ? movement : -movement),
    );
  }
  function finishSidebarResize(event: PointerEvent) {
    if (!sidebarResize || sidebarResize.pointerId !== event.pointerId) return;
    const side = sidebarResize.side;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    sidebarResize = null;
    persistSidebarWidths();
    logAction('layout.sidebar-resized', {
      side,
      width: currentSidebarWidth(side),
      leftWidth: leftSidebarWidth,
      rightWidth: rightSidebarWidth,
    });
  }
  function resizeSidebarWithKeyboard(event: KeyboardEvent, side: SidebarSide) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const limits = SIDEBAR_LAYOUT[side];
    const physicalDirection = event.key === 'ArrowLeft' ? -1 : 1;
    const widthDirection = side === 'left' ? physicalDirection : -physicalDirection;
    const proposedWidth =
      event.key === 'Home'
        ? limits.minWidth
        : event.key === 'End'
          ? limits.maxWidth
          : currentSidebarWidth(side) +
            widthDirection * SIDEBAR_LAYOUT.keyboardStep * (event.shiftKey ? 3 : 1);
    const width = setSidebarWidth(side, proposedWidth);
    persistSidebarWidths();
    logAction('layout.sidebar-resized', {
      source: 'keyboard',
      side,
      width,
      leftWidth: leftSidebarWidth,
      rightWidth: rightSidebarWidth,
    });
  }
  function showError(message: string, title = 'Couldn’t apply change') {
    errorTitle = title;
    error = message;
  }
  function sortedIdKey(ids: string[]) {
    return [...ids].sort().join(':');
  }
  function exitCandidateReview(source: 'keyboard') {
    const candidateId = activeCandidate?.id ?? activeCandidateId;
    dismissedCandidateSelectionKey = currentSelectionKey;
    activeCandidateId = '';
    selectedAtomicIds = [];
    highlightedChangeId = '';
    compareSourceActive = false;
    proposedSelectionId = '';
    codesignStatus = 'Saved candidate review closed. Your selection is unchanged.';
    logAction('codesign.review-closed', { source, candidateId, focusNodeIds: selection });
  }
  function closeCodesignTelemetry() {
    codesignTelemetrySource?.close();
    codesignTelemetrySource = null;
  }
  function recordCodesignTelemetry(value: unknown) {
    const parsed = codesignTelemetryEventSchema.safeParse(value);
    if (!parsed.success || parsed.data.requestId !== activeTelemetryRequestId) return;
    const event = parsed.data;
    const activity = event.toolActivity;
    if (
      activity?.phase === 'completed' &&
      activity.tool === 'candidate.apply_changes' &&
      liveCandidateDocument
    ) {
      if (document.currentRevisionId !== activeGenerationSourceRevisionId)
        abortGenerationForSourceDrift();
      else {
        const argumentsValue = activity.arguments as { changes?: Array<{ operation?: unknown }> };
        for (const change of argumentsValue?.changes ?? []) {
          const operation = operationSchema.safeParse(change.operation);
          if (operation.success)
            liveCandidateDocument = applyOperation(liveCandidateDocument, operation.data);
        }
      }
    }
    if (!codesignActivityEvents.some((current) => current.sequence === event.sequence))
      codesignActivityEvents = [...codesignActivityEvents, event]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-64);
    if (isTerminalTelemetryPhase(event.phase)) closeCodesignTelemetry();
  }
  function startCodesignTelemetry(requestId: string) {
    closeCodesignTelemetry();
    activeTelemetryRequestId = requestId;
    codesignActivityEvents = [];
    bottomTab = 'activity';
    bottomOpen = true;
    const source = new EventSource(
      `/api/agent/telemetry?requestId=${encodeURIComponent(requestId)}`,
    );
    codesignTelemetrySource = source;
    source.onmessage = (event) => {
      try {
        recordCodesignTelemetry(JSON.parse(event.data) as unknown);
      } catch {
        // Ignore malformed observational events; the generation response remains authoritative.
      }
    };
    source.onerror = () => {
      if (codesignTelemetrySource === source) closeCodesignTelemetry();
    };
  }
  function controlArea(control: Element) {
    if (control.closest('.topbar')) return 'topbar';
    if (control.closest('.projects')) return 'sidebar';
    if (control.closest('.pages')) return 'sidebar';
    if (control.closest('.tools')) return 'tools';
    if (control.closest('.outline')) return 'sidebar';
    if (control.closest('.canvas-toolbar')) return 'canvas-toolbar';
    if (control.closest('.context-menu')) return 'context-menu';
    if (control.closest('.shortcuts-dialog')) return 'shortcuts-overlay';
    if (control.closest('.settings-dialog')) return 'settings';
    if (control.closest('.inline-codesign')) return 'selection-toolbar';
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
  function openShortcuts(source: 'keyboard' | 'toolbar') {
    contextMenu = null;
    shortcutsOpen = true;
    logAction('shortcuts.opened', { source });
  }
  function closeShortcuts(source: 'keyboard' | 'button' | 'backdrop') {
    shortcutsOpen = false;
    logAction('shortcuts.closed', { source });
  }
  function setEditorMode(nextMode: EditorMode) {
    if (editorMode === nextMode) return;
    editorMode = nextMode;
    preview = nextMode === 'preview';
    logAction('mode.changed', { mode: nextMode });
  }
  async function refreshProviderStatus() {
    try {
      const response = await fetch('/api/agent/status');
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Provider status unavailable');
      agentStatus = value.message;
      providerConnected = Boolean(value.connected);
      providerPlan = value.status?.planType ?? '';
    } catch (cause) {
      providerConnected = false;
      agentStatus = cause instanceof Error ? cause.message : 'Provider status unavailable';
    }
  }
  function completeModelOptions(
    reported: AiModelOption[],
    configuration: AiIntegrationView['configuration'],
    selected: string,
  ) {
    const models = new Map(reported.map((option) => [option.model, option]));
    for (const model of [configuration?.model, selected].filter((value): value is string =>
      Boolean(value),
    )) {
      if (models.has(model)) continue;
      models.set(model, {
        id: model,
        model,
        displayName: model,
        description:
          model === configuration?.model
            ? 'Configured by the SvelteKit environment.'
            : 'Saved browser preference.',
        isDefault: model === configuration?.model,
        defaultReasoningEffort: configuration?.effort ?? 'high',
        supportedReasoningEfforts: [],
      });
    }
    return [...models.values()];
  }
  function saveAiSettings() {
    try {
      localStorage.setItem(
        AI_SETTINGS_KEY,
        JSON.stringify({ model: selectedAiModel, effort: selectedAiEffort }),
      );
    } catch {
      aiSettingsError = 'The browser could not persist this AI preference.';
    }
  }
  function selectAiModel(model: string) {
    selectedAiModel = model;
    const option = aiModelOptions.find((item) => item.model === model);
    const supported = option?.supportedReasoningEfforts.map((item) => item.reasoningEffort) ?? [];
    if (supported.length && !supported.includes(selectedAiEffort))
      selectedAiEffort = option?.defaultReasoningEffort ?? supported[0];
    saveAiSettings();
    logAction('codesign.ai-model-selected', { model, effort: selectedAiEffort });
  }
  function selectAiEffort(effort: AiReasoningEffort) {
    selectedAiEffort = effort;
    saveAiSettings();
    logAction('codesign.ai-effort-selected', { model: selectedAiModel, effort });
  }
  function resetAiSettings() {
    selectedAiModel = aiIntegration.configuration?.model ?? 'gpt-5.6-luna';
    selectedAiEffort = aiIntegration.configuration?.effort ?? 'high';
    saveAiSettings();
    logAction('codesign.ai-settings-reset', {
      model: selectedAiModel,
      effort: selectedAiEffort,
    });
  }
  async function refreshAiIntegrationStatus() {
    aiSettingsLoading = true;
    aiSettingsError = '';
    try {
      const response = await fetch('/api/agent/provider/status?provider=codex');
      const value = (await response.json()) as AiIntegrationView & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(value.error?.message ?? 'AI diagnostics unavailable');
      aiIntegration = {
        status: value.status,
        runtime: value.runtime,
        configuration: value.configuration,
        models: value.models ?? [],
        modelsMessage: value.modelsMessage,
        checkedAt: Date.now(),
      };
      if (!selectedAiModel) selectedAiModel = value.configuration?.model ?? 'gpt-5.6-luna';
      logAction('codesign.ai-status-refreshed', {
        runtimeDetected: Boolean(value.runtime?.detected),
        appServerAvailable: Boolean(value.status?.available),
        connected: Boolean(value.status?.connected),
        modelCount: value.models?.length ?? 0,
      });
    } catch (cause) {
      aiSettingsError = cause instanceof Error ? cause.message : 'AI diagnostics unavailable';
      aiIntegration = { ...aiIntegration, checkedAt: Date.now() };
      logAction('codesign.ai-status-failed', { message: aiSettingsError });
    } finally {
      aiSettingsLoading = false;
    }
  }
  async function refreshSettingsDiagnostics() {
    await Promise.all([refreshProviderStatus(), refreshAiIntegrationStatus()]);
  }
  function openSettings() {
    contextMenu = null;
    shortcutsOpen = false;
    settingsOpen = true;
    logAction('settings.opened', { provider: 'codex' });
  }
  function closeSettings(source: 'button' | 'keyboard' | 'backdrop') {
    settingsOpen = false;
    logAction('settings.closed', { source });
  }
  function setFrameOrientation(orientation: FrameOrientation) {
    if (orientation === frameOrientation) return;
    swapFramePresetOrientation();
    logAction('settings.frame-orientation-changed', { orientation, ...frameSize });
  }
  async function signInToCodex() {
    try {
      const response = await fetch('/api/agent/provider/login', { method: 'POST' });
      const value = await response.json();
      if (!response.ok || !value.login?.authUrl)
        throw new Error(value.error?.message ?? 'Codex sign-in could not start');
      const opened = window.open(value.login.authUrl, '_blank', 'noopener,noreferrer');
      notice = opened
        ? 'Complete ChatGPT sign-in in the new tab, then refresh provider status.'
        : `Open this sign-in URL: ${value.login.authUrl}`;
      logAction('codesign.provider-login-started', { provider: 'codex' });
    } catch (cause) {
      showError(
        cause instanceof Error ? cause.message : 'Codex sign-in could not start',
        'Couldn’t update Codex integration',
      );
      logAction('codesign.provider-login-failed', { provider: 'codex', message: error });
    }
  }
  async function signOutOfCodex() {
    try {
      const response = await fetch('/api/agent/provider/logout', { method: 'POST' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Codex sign-out failed');
      await refreshProviderStatus();
      if (settingsOpen) await refreshAiIntegrationStatus();
      notice = 'Signed out of Codex.';
      logAction('codesign.provider-logout', { provider: 'codex' });
    } catch (cause) {
      showError(
        cause instanceof Error ? cause.message : 'Codex sign-out failed',
        'Couldn’t update Codex integration',
      );
    }
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
    cancelCanvasGesture();
    selection = [];
    collapsedLayerIds = new Set();
    editingLayerId = '';
    editingLayerName = '';
    editingLayerSource = 'layers';
    contextMenu = null;
    error = '';
    notice = '';
    loadingCandidate = false;
    generationController?.abort();
    generationController = null;
    generationRequestId += 1;
    closeCodesignTelemetry();
    activeTelemetryRequestId = '';
    codesignActivityEvents = [];
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
      showError('Enter a project name', 'Couldn’t create project');
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
      showError('Enter a project name', 'Couldn’t rename project');
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
      showError(cause instanceof Error ? cause.message : 'That operation could not be applied');
      logAction('operation.failed', {
        type: operation.type,
        actor: operation.actor,
        operationId: operation.id,
        baseRevision,
        message: error,
      });
    }
  }
  function applyBatch(operations: DesignOperation[], label: string) {
    if (!operations.length) return false;
    const baseRevision = document.revision;
    try {
      documentStore.applyBatch(operations, `${label}-${uid('transaction')}`);
      error = '';
      notice = `${label.replaceAll('-', ' ')} applied`;
      logAction('operation.batch-applied', {
        label,
        operationTypes: operations.map((operation) => operation.type),
        operationCount: operations.length,
        baseRevision,
        nextRevision: baseRevision + 1,
      });
      return true;
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : `${label} could not be applied`);
      logAction('operation.failed', { type: label, actor: 'user', baseRevision, message: error });
      return false;
    }
  }
  function duplicateIdMap(payload: CodesignClipboardPayload) {
    return Object.fromEntries(Object.keys(payload.nodes).map((id) => [id, uid('node')]));
  }
  function duplicateSelection(offset = { x: 16, y: 16 }, sourceIds = selection) {
    if (!sourceIds.length) return [];
    const payload = createClipboardPayload(document, sourceIds);
    const idMap = duplicateIdMap(payload);
    apply({
      id: uid('op'),
      type: 'duplicate',
      actor: 'user',
      targetIds: payload.rootIds,
      idMap,
      dx: offset.x,
      dy: offset.y,
    });
    selection = payload.rootIds.map((id) => idMap[id]);
    pasteCount = 0;
    logAction('clipboard.duplicated', { sourceIds: payload.rootIds, createdIds: selection });
    return selection;
  }
  async function copySelection(cut = false) {
    if (!selection.length) return;
    const payload = createClipboardPayload(document, selection);
    internalClipboard = payload;
    pasteCount = 0;
    const serialized = serializeClipboardPayload(payload);
    try {
      await navigator.clipboard.writeText(serialized);
    } catch {
      // The in-memory payload still supports paste when clipboard permission is unavailable.
    }
    logAction(cut ? 'clipboard.cut' : 'clipboard.copied', {
      rootIds: payload.rootIds,
      nodeCount: Object.keys(payload.nodes).length,
    });
    if (cut) {
      apply({ id: uid('op'), type: 'delete', actor: 'user', targetIds: payload.rootIds });
      selection = [];
    }
  }
  async function pasteSelection() {
    let payload = internalClipboard;
    try {
      const serialized = await navigator.clipboard.readText();
      if (serialized) payload = deserializeClipboardPayload(serialized);
    } catch {
      // Fall back to Codesign's session clipboard.
    }
    if (!payload) {
      notice = 'Copy a Codesign layer before pasting.';
      return;
    }
    internalClipboard = payload;
    pasteCount += 1;
    const destinationParent =
      selectedNodes.length === 1 && ['frame', 'group'].includes(selectedNodes[0].kind)
        ? selectedNodes[0].id
        : undefined;
    const destinationParentByRootId = destinationParent
      ? undefined
      : Object.fromEntries(
          payload.rootIds.flatMap((rootId) => {
            const sourceParentId = payload.sourceParentByRootId[rootId];
            return sourceParentId &&
              isEligibleClipboardParent(document, sourceParentId, document.activeScreenId)
              ? [[rootId, sourceParentId]]
              : [];
          }),
        );
    const materialized = materializeClipboard(payload, {
      destination: document,
      destinationScreenId: document.activeScreenId,
      destinationParentId: destinationParent,
      destinationParentByRootId,
      offset: { x: 16 * pasteCount, y: 16 * pasteCount },
      idFactory: (kind) => uid(kind === 'operation' ? 'op' : kind),
    });
    applyBatch(materialized.operations, 'paste');
    selection = materialized.createdRootIds;
    logAction('clipboard.pasted', {
      createdIds: selection,
      destinationParentId: destinationParent ?? null,
      projectId: activeProjectId,
    });
  }
  function groupSelection() {
    const roots = selectionRootIds();
    if (!roots.length) return;
    const rootNodes = roots.map((id) => document.nodes[id]).filter(Boolean);
    if (new Set(rootNodes.map((node) => node.parentId)).size !== 1) {
      showError('Select layers that share the same parent.', 'Couldn’t group selection');
      return;
    }
    const groupId = uid('group');
    const first = rootNodes[0];
    apply({
      id: uid('op'),
      type: 'group',
      actor: 'user',
      targetIds: roots,
      group: {
        id: groupId,
        name: 'Group',
        kind: 'group',
        screenId: document.activeScreenId,
        parentId: first?.parentId,
        childIds: [],
        bounds: selectionBounds ?? { x: 0, y: 0, width: 1, height: 1 },
        style: { ...defaultStyle, fill: 'transparent' },
        provenance: { actor: 'user', operationId: '' },
      },
    });
    selection = [groupId];
  }
  function frameSelection() {
    const roots = selectionRootIds();
    if (!roots.length) return;
    const rootNodes = roots.map((id) => document.nodes[id]).filter(Boolean);
    const parentIds = new Set(rootNodes.map((node) => node.parentId));
    if (parentIds.size !== 1) {
      showError('Select layers that share the same parent.', 'Couldn’t frame selection');
      return;
    }
    const parentId = rootNodes[0]?.parentId;
    const siblingIds = parentId
      ? (document.nodes[parentId]?.childIds ?? [])
      : (currentScreen?.rootIds ?? []);
    const rootSet = new Set(roots);
    const insertionIndex = siblingIds.findIndex((id) => rootSet.has(id));
    const bounds = collectiveSelectionBounds(rootNodes);
    if (!bounds || insertionIndex < 0) return;
    const frameId = uid('node');
    const createOperationId = uid('op');
    const operations: DesignOperation[] = [
      {
        id: createOperationId,
        type: 'create',
        actor: 'user',
        node: {
          id: frameId,
          name: 'Frame',
          kind: 'frame',
          screenId: document.activeScreenId,
          parentId,
          childIds: [],
          bounds,
          style: { ...defaultStyle, fill: 'transparent' },
          provenance: { actor: 'user', operationId: createOperationId },
        },
      },
      {
        id: uid('op'),
        type: 'reparent',
        actor: 'user',
        targetIds: roots,
        parentId: frameId,
      },
      {
        id: uid('op'),
        type: 'reparent',
        actor: 'user',
        targetIds: [frameId],
        parentId,
        index: insertionIndex,
      },
    ];
    if (applyBatch(operations, 'frame-selection')) selection = [frameId];
  }
  function ungroupSelection() {
    const groups = selectedNodes.filter((node) => node.kind === 'group');
    if (!groups.length) return;
    const childIds = groups.flatMap((group) => group.childIds);
    apply({
      id: uid('op'),
      type: 'ungroup',
      actor: 'user',
      targetIds: groups.map((group) => group.id),
    });
    selection = childIds;
  }
  function reorderSelection(direction: 'forward' | 'backward' | 'front' | 'back') {
    if (!selection.length) return;
    apply({ id: uid('op'), type: 'reorder', actor: 'user', targetIds: selection, direction });
  }
  function point(event: PointerEvent) {
    const rect = (event.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }

  function beginCanvasGesture(event: PointerEvent, next: Omit<CanvasGesture, 'pointerId'>) {
    gesture = { ...next, pointerId: event.pointerId };
    try {
      canvasElement.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer was released before this handler completed.
    }
  }

  function releaseCanvasPointer(pointerId: number) {
    try {
      if (canvasElement?.hasPointerCapture(pointerId))
        canvasElement.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released capture after pointerup or pointercancel.
    }
  }

  function cancelCanvasGesture(event?: PointerEvent) {
    if (event && gesture?.pointerId !== event.pointerId) return;
    const pointerId = gesture?.pointerId;
    gesture = null;
    draft = null;
    marquee = null;
    resetGesturePreview();
    if (pointerId !== undefined) releaseCanvasPointer(pointerId);
  }
  function contentInset(node: DesignNode) {
    return Math.max(
      4,
      Math.min(node.style.padding, (node.bounds.width - 8) / 2, (node.bounds.height - 8) / 2),
    );
  }
  function belongsToNativeComponentTree(node: DesignNode, nodes: Record<string, DesignNode>) {
    let current = node.parentId ? nodes[node.parentId] : undefined;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.componentBinding) {
        const resolved = resolveComponent(current.componentBinding.componentId);
        if (resolved && !resolved.part && resolved.root.renderStrategy === 'compound') return true;
      }
      current = current.parentId ? nodes[current.parentId] : undefined;
    }
    return false;
  }
  function makeScopePreviewNodeIds(scope: ObservationScope, mutationIds: string[]) {
    if (scope.kind === 'selection') return mutationIds.filter((id) => scope.nodeIds.includes(id));
    const mutableIds = new Set(descendantNodeIds(document, mutationIds));
    return scope.nodeIds.filter((id) => {
      const node = document.nodes[id];
      return Boolean(
        node &&
        !mutableIds.has(id) &&
        (scope.rootId ? node.parentId === scope.rootId : !node.parentId),
      );
    });
  }
  function changeLabel(type: DesignOperation['type']) {
    const labels: Record<DesignOperation['type'], string> = {
      create: 'Create element',
      move: 'Move element',
      resize: 'Resize element',
      delete: 'Delete element',
      repeat: 'Create repeated pattern',
      bind: 'Assign semantic role',
      promote: 'Resolve to component',
      style: 'Refine appearance',
      generalize: 'Apply shared style',
      'update-node': 'Edit element properties',
      reparent: 'Move in layer hierarchy',
      group: 'Group layers',
      ungroup: 'Ungroup layers',
      reorder: 'Change layer order',
      duplicate: 'Duplicate selection',
      'duplicate-screen': 'Duplicate screen',
      'create-branch': 'Create branch',
      'create-project-component': 'Create reusable component',
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
    const currentStage = codesignStageForSelection(nodes, sourceDocument);
    const entity = selected?.entityId ? sourceDocument.entities[selected.entityId] : undefined;
    const saved = (entity?.representationIds ?? [])
      .map((id) => sourceDocument.representations[id])
      .filter((representation) => representation && representation.origin !== 'human');
    const candidateFidelities = new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.status === 'candidate' &&
            sourceDocument.generationRuns[
              candidate.generationRunId
            ]?.target.mutationScope.existingNodeIds.includes(selected?.id ?? ''),
        )
        .map((candidate) => candidate.fidelity),
    );
    const fidelities: Fidelity[] = ['wireframe', 'component'];
    const inheritedFrom = selected ? fidelityInheritanceLabel(sourceDocument, selected) : undefined;
    return fidelities.map((fidelity) => {
      const representations = saved.filter((item) => item.fidelity === fidelity);
      const representation = representations.at(-1);
      if (candidateFidelities.has(fidelity)) return { fidelity, state: 'candidate' };
      if (fidelity === currentStage) return { fidelity, state: 'current', inheritedFrom };
      if (representations.length > 1)
        return {
          fidelity,
          state: 'versions',
          versionCount: representations.length,
          representationId: representation?.id,
        };
      if (representation) return { fidelity, state: 'saved', representationId: representation.id };
      return { fidelity, state: 'generate' };
    });
  }
  function codesignStageForSelection(
    nodes: DesignNode[],
    sourceDocument: typeof document,
  ): CodesignStage {
    const selected = nodes[0];
    const entity = selected?.entityId ? sourceDocument.entities[selected.entityId] : undefined;
    return activeCodesignStage(
      (entity?.representationIds ?? []).map((id) => sourceDocument.representations[id]),
    );
  }
  function codesignFidelity(fidelity: Fidelity): Fidelity {
    return ['component', 'visual', 'production'].includes(fidelity) ? 'component' : 'wireframe';
  }
  function fidelityInheritanceLabel(sourceDocument: typeof document, node: DesignNode) {
    if (node.kind === 'frame' || sourceDocument.nodeFidelityOverrides[node.id]) return undefined;
    let parentId = node.parentId;
    while (parentId) {
      const parent = sourceDocument.nodes[parentId];
      if (!parent) break;
      if (parent.kind === 'frame' && sourceDocument.frameFidelity[parent.id]) return parent.name;
      parentId = parent.parentId;
    }
    return 'screen';
  }
  function makeProposedLayerRows(
    nodes: DesignNode[],
    snapshot?: { nodes: Record<string, DesignNode> },
  ) {
    const proposedIds = new Set(nodes.map((node) => node.id));
    const depthFor = (node: DesignNode) => {
      let depth = 0;
      let parentId = node.parentId;
      while (parentId && proposedIds.has(parentId)) {
        depth += 1;
        parentId = snapshot?.nodes[parentId]?.parentId;
      }
      return depth;
    };
    return nodes.map((node) => ({ node, depth: depthFor(node) }));
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
    beginCanvasGesture(event, {
      mode: 'draw',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
    });
    draft = { x: p.x, y: p.y, width: 1, height: 1 };
  }
  function persistFrameSize() {
    try {
      localStorage.setItem(
        FRAME_SIZE_KEY,
        JSON.stringify({ ...frameSize, presetId: framePresetId, orientation: frameOrientation }),
      );
    } catch {
      // Keep the frame preset in memory when storage is unavailable.
    }
  }
  function chooseFramePreset(presetId: string) {
    framePresetId = presetId;
    const preset = framePresetById(presetId);
    if (preset) frameSize = framePresetSize(preset, frameOrientation);
    persistFrameSize();
  }
  function swapFramePresetOrientation() {
    frameOrientation = frameOrientation === 'landscape' ? 'portrait' : 'landscape';
    const preset = framePresetById(framePresetId);
    if (preset) frameSize = framePresetSize(preset, frameOrientation);
    else frameSize = { width: frameSize.height, height: frameSize.width };
    persistFrameSize();
  }
  function placePresetFrame() {
    const canvas = window.document.querySelector<SVGSVGElement>('svg.canvas');
    if (!canvas) return;
    const viewport = canvas.getBoundingClientRect();
    const bounds = {
      x: (viewport.width / 2 - pan.x) / zoom - frameSize.width / 2,
      y: (viewport.height / 2 - pan.y) / zoom - frameSize.height / 2,
      width: frameSize.width,
      height: frameSize.height,
    };
    const parentContainer = containingContainerForBounds(visibleNodes, bounds);
    const nodeId = uid('node');
    const operationId = uid('op');
    apply({
      id: operationId,
      type: 'create',
      actor: 'user',
      node: {
        id: nodeId,
        name: framePresetById(framePresetId)?.name ?? 'Custom frame',
        kind: 'frame',
        screenId: document.activeScreenId,
        parentId: parentContainer?.id,
        childIds: [],
        bounds,
        style: { ...defaultStyle, fill: '#f7f8fa' },
        provenance: { actor: 'user', operationId },
      },
    });
    selection = [nodeId];
    tool = 'select';
    persistFrameSize();
  }
  function insertComponent(componentId: string, dropCenter?: { x: number; y: number }) {
    const definition = componentCatalog.find((component) => component.id === componentId);
    const blueprint = getDefaultComponentBlueprint(componentId);
    if (!definition || !blueprint?.length) return;
    const selectedParent = selectedNodes[0];
    const droppedBounds = dropCenter
      ? {
          x: dropCenter.x - definition.defaultSize.width / 2,
          y: dropCenter.y - definition.defaultSize.height / 2,
          ...definition.defaultSize,
        }
      : undefined;
    const parent = dropCenter
      ? containingContainerForBounds(visibleNodes, droppedBounds!)
      : selectedParent &&
          (selectedParent.kind === 'frame' ||
            selectedParent.kind === 'group' ||
            (selectedParent.kind === 'instance' &&
              selectedParent.componentBinding &&
              validateComponentChild(
                selectedParent.componentBinding.componentId,
                componentId,
                'default',
              ).ok))
        ? selectedParent
        : undefined;
    const viewport = canvasElement.getBoundingClientRect();
    const origin = droppedBounds
      ? { x: droppedBounds.x, y: droppedBounds.y }
      : parent
        ? {
            x: parent.bounds.x + Math.max(12, parent.style.padding),
            y: parent.bounds.y + Math.max(12, parent.style.padding),
          }
        : {
            x: (viewport.width / 2 - pan.x) / zoom - definition.defaultSize.width / 2,
            y: (viewport.height / 2 - pan.y) / zoom - definition.defaultSize.height / 2,
          };
    const ids = new Map(blueprint.map((item) => [item.key, uid('node')]));
    const childCount = Math.max(1, blueprint.length - 1);
    const childHeight = Math.max(20, (definition.defaultSize.height - 24) / childCount);
    const operations = blueprint.map((item, index): DesignOperation => {
      const nodeId = ids.get(item.key)!;
      const parentId = item.parentKey ? ids.get(item.parentKey) : parent?.id;
      const operationId = uid('op');
      const resolved = resolveComponent(item.componentId);
      const isRoot = !item.parentKey;
      const bounds = isRoot
        ? { ...origin, ...definition.defaultSize }
        : {
            x: origin.x + 12,
            y: origin.y + 12 + (index - 1) * childHeight,
            width: Math.max(24, definition.defaultSize.width - 24),
            height: Math.min(childHeight - 4, Math.max(20, definition.defaultSize.height - 24)),
          };
      return {
        id: operationId,
        type: 'create',
        actor: 'user',
        node: {
          id: nodeId,
          name: resolved?.part?.displayName ?? resolved?.root.displayName ?? item.componentId,
          kind: 'instance',
          screenId: document.activeScreenId,
          parentId,
          childIds: [],
          bounds,
          style: {
            ...defaultStyle,
            fill: isRoot ? '#ffffff' : 'transparent',
            padding: isRoot ? 12 : 4,
            radius: isRoot ? 8 : 4,
          },
          text: item.content,
          componentBinding: {
            componentId: item.componentId,
            props: item.props,
            slot: item.parentKey ? item.slot : undefined,
          },
          provenance: { actor: 'user', operationId },
        },
      };
    });
    if (!applyBatch(operations, 'insert-component')) return;
    selection = [ids.get('root')!];
    tool = 'select';
    logAction('component.inserted', {
      componentId,
      rootId: ids.get('root')!,
      nodeCount: operations.length,
      parentId: parent?.id ?? '',
      placement: dropCenter ? 'drag-drop' : 'insert-button',
    });
  }
  function canCreateProjectComponent(node: DesignNode | undefined) {
    return Boolean(
      node && (node.kind === 'frame' || node.kind === 'group') && !node.projectComponent,
    );
  }
  function createProjectComponentFrom(source: DesignNode | undefined) {
    if (!canCreateProjectComponent(source) || !source) {
      showError(
        'Select one frame or group to create a reusable project component.',
        'Couldn’t create component',
      );
      return;
    }
    const name = window.prompt('Component name', source.name)?.trim();
    if (!name) return;
    const componentId = uid('project-component');
    const definition = captureProjectComponent(document, source.id, {
      id: componentId,
      name,
    });
    apply({
      id: uid('op'),
      type: 'create-project-component',
      actor: 'user',
      targetId: source.id,
      definition,
    });
    logAction('project-component.created', {
      componentId,
      sourceNodeId: source.id,
      name,
      nodeCount: Object.keys(definition.nodes).length,
      projectId: activeProjectId,
    });
  }
  function createProjectComponent() {
    createProjectComponentFrom(selectedNodes.length === 1 ? selectedNodes[0] : undefined);
  }
  function insertProjectComponent(componentId: string, dropCenter?: { x: number; y: number }) {
    const stored = document.projectComponents?.[componentId];
    if (!stored) return;
    const definition = currentProjectComponentTemplate(document, stored);
    const root = definition.nodes[definition.rootId];
    if (!root) return;
    const viewport = canvasElement.getBoundingClientRect();
    const center = dropCenter ?? {
      x: (viewport.width / 2 - pan.x) / zoom,
      y: (viewport.height / 2 - pan.y) / zoom,
    };
    const bounds = {
      x: center.x - root.bounds.width / 2,
      y: center.y - root.bounds.height / 2,
      width: root.bounds.width,
      height: root.bounds.height,
    };
    const parent = dropCenter ? containingContainerForBounds(visibleNodes, bounds) : undefined;
    const materialized = instantiateProjectComponent(definition, {
      screenId: document.activeScreenId,
      origin: { x: bounds.x, y: bounds.y },
      parentId: parent?.id,
      makeNodeId: () => uid('node'),
      makeOperationId: () => uid('op'),
    });
    const operations = materialized.nodes.map((node): DesignOperation => ({
      id: node.provenance.operationId,
      type: 'create',
      actor: 'user',
      node,
    }));
    if (!applyBatch(operations, 'insert-project-component')) return;
    selection = [materialized.rootId];
    tool = 'select';
    logAction('project-component.inserted', {
      componentId,
      rootId: materialized.rootId,
      nodeCount: operations.length,
      parentId: parent?.id ?? '',
      placement: dropCenter ? 'drag-drop' : 'insert-button',
      projectId: activeProjectId,
    });
  }
  function componentDragOver(event: DragEvent) {
    if (
      !event.dataTransfer?.types.includes(COMPONENT_DRAG_MIME) &&
      !event.dataTransfer?.types.includes(PROJECT_COMPONENT_DRAG_MIME)
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    componentDropActive = true;
  }
  function componentDragLeave(event: DragEvent) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && canvasElement.contains(nextTarget)) return;
    componentDropActive = false;
  }
  function dropComponent(event: DragEvent) {
    const projectComponentId = readDraggedProjectComponent(event.dataTransfer);
    if (projectComponentId && document.projectComponents?.[projectComponentId]) {
      event.preventDefault();
      componentDropActive = false;
      const viewport = canvasElement.getBoundingClientRect();
      const center = {
        x: (event.clientX - viewport.left - pan.x) / zoom,
        y: (event.clientY - viewport.top - pan.y) / zoom,
      };
      insertProjectComponent(projectComponentId, center);
      return;
    }
    const componentId = readDraggedComponent(event.dataTransfer);
    if (!componentCatalog.some((component) => component.id === componentId)) return;
    event.preventDefault();
    componentDropActive = false;
    const viewport = canvasElement.getBoundingClientRect();
    const center = {
      x: (event.clientX - viewport.left - pan.x) / zoom,
      y: (event.clientY - viewport.top - pan.y) / zoom,
    };
    insertComponent(componentId, center);
    logAction('component.dropped', {
      componentId,
      x: Math.round(center.x),
      y: Math.round(center.y),
    });
  }
  function gestureDelta(event: PointerEvent) {
    if (!gesture) return { x: 0, y: 0 };
    const p = point(event);
    const delta = { x: p.x - gesture.startX, y: p.y - gesture.startY };
    return event.shiftKey ? constrainToDominantAxis(delta) : delta;
  }
  function selectionRootIds(ids = selection) {
    if (!ids.length) return [];
    return createClipboardPayload(document, ids).rootIds;
  }
  function snapTargetsFor(rootIds: string[]) {
    const excluded = new Set(descendantNodeIds(document, rootIds));
    const parentIds = new Set(
      rootIds.map((id) => document.nodes[id]?.parentId).filter((id): id is string => Boolean(id)),
    );
    return visibleNodes
      .filter((node) => !excluded.has(node.id))
      .map((node) => ({
        id: node.id,
        bounds: node.bounds,
        kind: parentIds.has(node.id) ? ('parent' as const) : ('sibling' as const),
      }));
  }
  function snappedMoveDelta(rawDelta: { x: number; y: number }, rootIds: string[]) {
    if (!gesture?.original) return rawDelta;
    const moving = {
      ...gesture.original,
      x: gesture.original.x + rawDelta.x,
      y: gesture.original.y + rawDelta.y,
    };
    const snapped = snapBounds(moving, snapTargetsFor(rootIds), { threshold: 6 / zoom });
    smartGuides = snapped.guides;
    spacingGuides = consistentSpacingGuides(
      snapped.bounds,
      snapTargetsFor(rootIds).map((target) => ({ id: target.id, bounds: target.bounds })),
      5 / zoom,
    );
    return { x: rawDelta.x + snapped.delta.x, y: rawDelta.y + snapped.delta.y };
  }
  function resizeSelectionPreview(nextBounds: Bounds) {
    if (!gesture?.original || !gesture.originalBounds) return;
    const original = gesture.original;
    const scaleX = original.width ? nextBounds.width / original.width : 1;
    const scaleY = original.height ? nextBounds.height / original.height : 1;
    transientBounds = Object.fromEntries(
      Object.entries(gesture.originalBounds).map(([id, bounds]) => [
        id,
        {
          x: nextBounds.x + (bounds.x - original.x) * scaleX,
          y: nextBounds.y + (bounds.y - original.y) * scaleY,
          width: Math.max(8, bounds.width * scaleX),
          height: Math.max(8, bounds.height * scaleY),
        },
      ]),
    );
  }
  function containerUnderPoint(p: { x: number; y: number }, excludedIds: string[]) {
    const excluded = new Set(excludedIds);
    return containingContainerForBounds(
      visibleNodes.filter((node) => !excluded.has(node.id)),
      { x: p.x, y: p.y, width: 0.01, height: 0.01 },
    );
  }
  function movementParentForRoots(
    p: { x: number; y: number },
    rootIds: string[],
    excludedIds: string[],
  ) {
    return containerUnderPoint(p, excludedIds);
  }
  function resetGesturePreview() {
    transientBounds = {};
    smartGuides = [];
    spacingGuides = [];
    duplicatePreviewOffset = { x: 0, y: 0 };
  }
  const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function resizeHandlePoint(bounds: Bounds, handle: ResizeHandle) {
    return {
      x: handle.includes('w')
        ? bounds.x
        : handle.includes('e')
          ? bounds.x + bounds.width
          : bounds.x + bounds.width / 2,
      y: handle.includes('n')
        ? bounds.y
        : handle.includes('s')
          ? bounds.y + bounds.height
          : bounds.y + bounds.height / 2,
    };
  }
  function canEditNodeText(node: DesignNode) {
    const component = node.componentBinding
      ? resolveComponent(node.componentBinding.componentId)
      : undefined;
    return Boolean(
      node.kind === 'text' ||
      (component && (component.part?.editableContent || component.root.editableContent)),
    );
  }
  async function beginTextEditing(node: DesignNode) {
    if (!canEditNodeText(node) || preview) return;
    if (gesture) cancelCanvasGesture();
    editingTextId = node.id;
    editingTextDraft = node.text ?? '';
    selection = [node.id];
    logAction('text-editing.started', {
      nodeId: node.id,
      source: 'canvas-content',
    });
    await tick();
    inlineTextEditor?.focus();
    inlineTextEditor?.select();
  }
  function startTextEditing(event: MouseEvent | KeyboardEvent, node: DesignNode) {
    event.preventDefault();
    event.stopPropagation();
    if (editingTextId === node.id) return;
    void beginTextEditing(node);
  }
  function finishTextEditing(commit: boolean) {
    const nodeId = editingTextId;
    const text = editingTextDraft;
    editingTextId = '';
    editingTextDraft = '';
    if (!nodeId) return;
    const changed = document.nodes[nodeId]?.text !== text;
    if (commit && changed)
      apply({
        id: uid('op'),
        type: 'update-node',
        actor: 'user',
        targetIds: [nodeId],
        patch: { text },
      });
    logAction(commit ? 'text-editing.committed' : 'text-editing.cancelled', {
      nodeId,
      changed: commit && changed,
      characterCount: text.length,
    });
  }
  function clippingFrameId(node: DesignNode) {
    let parent = node.parentId ? document.nodes[node.parentId] : undefined;
    const seen = new Set<string>();
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.kind === 'frame' && parent.clipContent) return parent.id;
      parent = parent.parentId ? document.nodes[parent.parentId] : undefined;
    }
  }
  function textPosition(node: DesignNode, bounds: Bounds) {
    if (node.style.textAlign === 'center')
      return { x: bounds.x + bounds.width / 2, anchor: 'middle' as const };
    if (node.style.textAlign === 'right')
      return { x: bounds.x + bounds.width - contentInset(node), anchor: 'end' as const };
    return { x: bounds.x + contentInset(node), anchor: 'start' as const };
  }
  function pointIsInFrameInterior(node: DesignNode, p: { x: number; y: number }) {
    const edgeBand = Math.min(8 / zoom, node.bounds.width / 4, node.bounds.height / 4);
    return (
      p.x > node.bounds.x + edgeBand &&
      p.x < node.bounds.x + node.bounds.width - edgeBand &&
      p.y > node.bounds.y + edgeBand &&
      p.y < node.bounds.y + node.bounds.height - edgeBand
    );
  }
  function beginFrameMarquee(event: PointerEvent, frame: DesignNode) {
    const p = point(event);
    beginCanvasGesture(event, {
      mode: 'frame-marquee',
      frameId: frame.id,
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      additive: event.shiftKey,
    });
    marquee = { x: p.x, y: p.y, width: 1, height: 1 };
  }
  function isCanvasPanPointer(event: PointerEvent) {
    return event.button === 1 || (event.button === 0 && spacePressed);
  }
  function beginCanvasPan(event: PointerEvent) {
    contextMenu = null;
    const p = { x: event.clientX, y: event.clientY };
    beginCanvasGesture(event, {
      mode: 'pan',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
    });
  }
  function captureCanvasPan(event: PointerEvent) {
    if (preview || event.target === event.currentTarget || !isCanvasPanPointer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    beginCanvasPan(event);
  }
  function canvasDown(event: PointerEvent) {
    contextMenu = null;
    if (preview) return;
    if (isCanvasPanPointer(event)) {
      event.preventDefault();
      beginCanvasPan(event);
      return;
    }
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    if (tool === 'frame' || tool === 'rectangle' || tool === 'text') {
      if (selection.length) logAction('selection.cleared', { source: 'canvas' });
      selection = [];
      startDraw(event);
      return;
    }
    if (tool === 'select') {
      const p = point(event);
      beginCanvasGesture(event, {
        mode: 'marquee',
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        additive: event.shiftKey,
      });
      marquee = { x: p.x, y: p.y, width: 1, height: 1 };
    }
  }
  function canvasMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
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
    if (gesture.mode === 'marquee' || gesture.mode === 'frame-marquee') {
      marquee = {
        x: Math.min(gesture.startX, p.x),
        y: Math.min(gesture.startY, p.y),
        width: Math.abs(p.x - gesture.startX),
        height: Math.abs(p.y - gesture.startY),
      };
    }
    if (gesture.mode === 'move' || gesture.mode === 'duplicate') {
      const roots = selectionRootIds();
      const delta = snappedMoveDelta(gestureDelta(event), roots);
      if (gesture.mode === 'duplicate') duplicatePreviewOffset = delta;
      else if (gesture.originalBounds)
        transientBounds = Object.fromEntries(
          Object.entries(gesture.originalBounds).map(([id, bounds]) => [
            id,
            { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y },
          ]),
        );
    }
    if (gesture.mode === 'resize' && gesture.original && gesture.handle) {
      let next = resizeBounds(gesture.original, gesture.handle, gestureDelta(event), {
        lockAspectRatio: event.shiftKey,
        fromCenter: event.altKey,
        minWidth: 8,
        minHeight: 8,
      });
      const snapped = snapBounds(next, snapTargetsFor(selectionRootIds()), {
        threshold: 6 / zoom,
      });
      next = snapped.bounds;
      smartGuides = snapped.guides;
      draft = next;
      resizeSelectionPreview(next);
    }
  }
  function canvasUp(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const completedGesture = gesture.mode;
    let createdTextNode: DesignNode | undefined;
    const p = gesture.mode === 'pan' ? null : point(event);
    const completedGestureDistance = p ? Math.hypot(p.x - gesture.startX, p.y - gesture.startY) : 0;
    if (gesture.mode === 'draw' && draft && draft.width > 8 && draft.height > 8) {
      const nodeId = uid('node');
      const opId = uid('op');
      const parentContainer = containingContainerForBounds(visibleNodes, draft);
      const node: DesignNode = {
        id: nodeId,
        name: tool === 'text' ? 'Text label' : tool === 'frame' ? 'Frame' : 'Rectangle',
        kind: tool as 'frame' | 'rectangle' | 'text',
        screenId: document.activeScreenId,
        parentId: parentContainer?.id,
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
        parentId: parentContainer?.id ?? null,
        screenId: node.screenId,
      });
      if (node.kind === 'frame') {
        frameSize = { width: node.bounds.width, height: node.bounds.height };
        try {
          localStorage.setItem(
            FRAME_SIZE_KEY,
            JSON.stringify({ ...frameSize, presetId: 'custom', orientation: frameOrientation }),
          );
        } catch {
          // Keep the last-used frame size in memory.
        }
      }
      if (node.kind === 'text') createdTextNode = node;
      tool = 'select';
    } else if (gesture.mode === 'marquee') {
      const picked = marquee
        ? marqueeSelectedIds(visibleNodes, marquee, event.altKey ? 'contain' : 'intersect')
        : [];
      selection = gesture.additive ? [...new Set([...selection, ...picked])] : picked;
      logAction('selection.marquee', { nodeIds: selection, additive: Boolean(gesture.additive) });
    } else if (gesture.mode === 'frame-marquee') {
      const distance = p ? Math.hypot(p.x - gesture.startX, p.y - gesture.startY) : 0;
      const dragged = distance >= 3 / zoom;
      const frame = gesture.frameId ? document.nodes[gesture.frameId] : undefined;
      if (!dragged) {
        if (!gesture.additive) selection = [];
        logAction('selection.frame-interior-click', {
          frameId: frame?.id ?? '',
          action: gesture.additive ? 'preserved' : 'cleared',
          nodeIds: selection,
          additive: Boolean(gesture.additive),
        });
      } else {
        const childIds = new Set(frame?.childIds ?? []);
        const picked = marquee
          ? marqueeSelectedIds(
              visibleNodes.filter((node) => childIds.has(node.id)),
              marquee,
              event.altKey ? 'contain' : 'intersect',
            )
          : [];
        selection = gesture.additive ? [...new Set([...selection, ...picked])] : picked;
        logAction('selection.frame-marquee', {
          frameId: frame?.id ?? '',
          nodeIds: selection,
          additive: Boolean(gesture.additive),
        });
      }
    } else if (gesture.mode === 'move' && p) {
      const roots = selectionRootIds();
      const reference = roots[0];
      const original = reference ? gesture.originalBounds?.[reference] : undefined;
      const moved = reference ? transientBounds[reference] : undefined;
      const dx = original && moved ? moved.x - original.x : 0;
      const dy = original && moved ? moved.y - original.y : 0;
      const operations: DesignOperation[] = [];
      if (dx || dy)
        operations.push({ id: uid('op'), type: 'move', actor: 'user', targetIds: roots, dx, dy });
      const excluded = descendantNodeIds(document, roots);
      const parent = movementParentForRoots(p, roots, excluded);
      const currentParents = new Set(roots.map((id) => document.nodes[id]?.parentId));
      if (currentParents.size !== 1 || !currentParents.has(parent?.id))
        operations.push({
          id: uid('op'),
          type: 'reparent',
          actor: 'user',
          targetIds: roots,
          parentId: parent?.id,
        });
      applyBatch(operations, 'move-selection');
    } else if (gesture.mode === 'duplicate' && gesture.duplicatePayload && p) {
      const payload = gesture.duplicatePayload;
      const idMap = duplicateIdMap(payload);
      const duplicate: DesignOperation = {
        id: uid('op'),
        type: 'duplicate',
        actor: 'user',
        targetIds: payload.rootIds,
        idMap,
        dx: duplicatePreviewOffset.x,
        dy: duplicatePreviewOffset.y,
      };
      const createdRoots = payload.rootIds.map((id) => idMap[id]);
      const excluded = descendantNodeIds(document, payload.rootIds);
      const parent = movementParentForRoots(p, payload.rootIds, excluded);
      const operations: DesignOperation[] = [duplicate];
      const currentParents = new Set(payload.rootIds.map((id) => document.nodes[id]?.parentId));
      if (currentParents.size !== 1 || !currentParents.has(parent?.id))
        operations.push({
          id: uid('op'),
          type: 'reparent',
          actor: 'user',
          targetIds: createdRoots,
          parentId: parent?.id,
        });
      applyBatch(operations, 'duplicate-drag');
      selection = createdRoots;
    } else if (gesture.mode === 'resize' && Object.keys(transientBounds).length) {
      applyBatch(
        Object.entries(transientBounds).map(([targetId, bounds]) => ({
          id: uid('op'),
          type: 'resize' as const,
          actor: 'user' as const,
          targetId,
          bounds,
        })),
        'resize-selection',
      );
    }
    const pointerId = gesture.pointerId;
    gesture = null;
    draft = null;
    marquee = null;
    resetGesturePreview();
    releaseCanvasPointer(pointerId);
    if (
      (completedGesture === 'move' || completedGesture === 'duplicate') &&
      completedGestureDistance >= 3 / zoom
    )
      lastCanvasNodePointerDown = { nodeId: '', timestamp: 0 };
    if (completedGesture === 'pan') scheduleViewportLog('middle-drag');
    if (createdTextNode) void beginTextEditing(createdTextNode);
  }
  function repeatedCanvasNodePointerDown(event: PointerEvent, nodeId: string) {
    return (
      lastCanvasNodePointerDown.nodeId === nodeId &&
      event.timeStamp - lastCanvasNodePointerDown.timestamp <= 450
    );
  }
  function rememberCanvasNodePointerDown(event: PointerEvent, nodeId: string) {
    lastCanvasNodePointerDown = { nodeId, timestamp: event.timeStamp };
  }
  function nodeDown(event: PointerEvent, node: DesignNode) {
    event.stopPropagation();
    contextMenu = null;
    if (event.button !== 0) return;
    if (spacePressed) {
      event.preventDefault();
      beginCanvasPan(event);
      return;
    }
    if (preview) return;
    if (tool === 'frame' || tool === 'rectangle' || tool === 'text') {
      startDraw(event);
      return;
    }
    const groupedTarget = groupedCanvasSelectionTarget(document, node.id);
    const repeatedPointerDown = repeatedCanvasNodePointerDown(event, node.id);
    rememberCanvasNodePointerDown(event, node.id);
    if (
      (event.detail >= 2 || repeatedPointerDown) &&
      groupedTarget &&
      groupedTarget.id !== node.id
    ) {
      event.preventDefault();
      lastCanvasNodePointerDown = { nodeId: '', timestamp: 0 };
      selection = [node.id];
      logAction('selection.deep-selected', {
        source: 'canvas-double-click',
        nodeId: node.id,
        groupId: groupedTarget.id,
      });
      return;
    }
    const p = point(event);
    const commandSelection = event.metaKey || event.ctrlKey;
    const selectedContainerTarget = commandSelection
      ? undefined
      : selectedContainerCanvasTarget(document, node.id, selection);
    const preserveDirectSelection =
      !selectedContainerTarget && selection.length === 1 && selection[0] === node.id;
    const additiveSelection = isCanvasAdditiveSelectionModifier(event);
    const deepSelection = commandSelection || preserveDirectSelection;
    const selectionTarget =
      selectedContainerTarget ??
      groupedCanvasSelectionTarget(document, node.id, deepSelection) ??
      node;
    if (
      selectionTarget.id === node.id &&
      node.kind === 'frame' &&
      pointIsInFrameInterior(node, p) &&
      !commandSelection
    ) {
      beginFrameMarquee(event, node);
      return;
    }
    const targetWasSelected = selection.includes(selectionTarget.id);
    selection = selectionWithTarget(selection, selectionTarget.id, additiveSelection);
    logAction('selection.changed', {
      source: 'canvas',
      nodeIds: selection,
      additive: additiveSelection,
      hitNodeId: node.id,
      resolvedNodeId: selectionTarget.id,
      deepSelection: commandSelection,
      preservedDirectSelection: preserveDirectSelection,
    });
    if (!selection.length || (additiveSelection && targetWasSelected)) return;
    const previewIds = descendantNodeIds(document, selectionRootIds());
    const originalBounds = Object.fromEntries(
      previewIds.map((id) => [id, structuredClone(document.nodes[id].bounds)]),
    );
    const selectedBounds = collectiveSelectionBounds(
      selectionRootIds().map((id) => document.nodes[id]),
    );
    beginCanvasGesture(event, {
      mode: event.altKey ? 'duplicate' : 'move',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      original: selectedBounds ?? undefined,
      originalBounds,
      previewIds,
      duplicatePayload: event.altKey ? createClipboardPayload(document, selection) : undefined,
    });
  }
  function textNodeDown(event: PointerEvent, node: DesignNode) {
    event.stopPropagation();
    if (
      event.button === 0 &&
      !preview &&
      !spacePressed &&
      tool === 'select' &&
      repeatedCanvasNodePointerDown(event, node.id)
    ) {
      event.preventDefault();
      lastCanvasNodePointerDown = { nodeId: '', timestamp: 0 };
      void beginTextEditing(node);
      return;
    }
    nodeDown(event, node);
  }
  function nodeDoubleClick(event: MouseEvent, node: DesignNode) {
    if (canEditNodeText(node)) {
      startTextEditing(event, node);
      return;
    }
    const groupedTarget = groupedCanvasSelectionTarget(document, node.id);
    if (!groupedTarget || groupedTarget.id === node.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture) cancelCanvasGesture();
    selection = [node.id];
    logAction('selection.deep-selected', {
      source: 'canvas-double-click',
      nodeId: node.id,
      groupId: groupedTarget.id,
    });
  }
  function resizeDown(event: PointerEvent, handle: ResizeHandle) {
    event.stopPropagation();
    const p = point(event);
    if (!selectionBounds) return;
    beginCanvasGesture(event, {
      mode: 'resize',
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      original: { ...selectionBounds },
      originalBounds: Object.fromEntries(
        selectedNodes.map((node) => [node.id, structuredClone(node.bounds)]),
      ),
      handle,
    });
    draft = { ...selectionBounds };
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
  async function openContextMenu(
    event: MouseEvent,
    node?: DesignNode,
    source: 'canvas' | 'layers' = 'canvas',
  ) {
    event.preventDefault();
    event.stopPropagation();
    const target = node
      ? source === 'layers'
        ? node
        : (groupedCanvasContextTarget(document, node.id, selection) ?? node)
      : undefined;
    if (target && !selection.includes(target.id)) selection = [target.id];
    const width = 236;
    const height = preview ? 110 : target ? 560 : 300;
    contextMenu = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      nodeId: target?.id,
    };
    logAction('context-menu.opened', {
      source,
      target: target ? 'node' : 'canvas',
      hitNodeId: node?.id ?? '',
      nodeId: target?.id ?? '',
      resolvedToGroup: Boolean(node && target && node.id !== target.id),
      selectionCount: selection.length,
    });
    await tick();
    contextMenuElement?.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function deleteFromContext() {
    if (!contextNode) return;
    const targetIds = selection.includes(contextNode.id) ? selection : [contextNode.id];
    contextMenu = null;
    apply({ id: uid('op'), type: 'delete', actor: 'user', targetIds });
    selection = [];
  }
  function duplicateFromContext() {
    contextMenu = null;
    duplicateSelection();
  }
  function groupFromContext() {
    contextMenu = null;
    selectedNodes.some((node) => node.kind === 'group') ? ungroupSelection() : groupSelection();
  }
  function frameFromContext() {
    contextMenu = null;
    frameSelection();
  }
  function reorderFromContext(direction: 'forward' | 'backward' | 'front' | 'back') {
    contextMenu = null;
    reorderSelection(direction);
  }
  function toggleFrameClip(node: DesignNode) {
    contextMenu = null;
    apply({
      id: uid('op'),
      type: 'update-node',
      actor: 'user',
      targetIds: [node.id],
      patch: { clipContent: !node.clipContent },
    });
  }
  function layerCanCollapse(node: DesignNode) {
    return (
      (node.kind === 'frame' || node.kind === 'group' || node.kind === 'instance') &&
      node.childIds.length > 0
    );
  }
  function toggleLayerCollapse(event: MouseEvent, node: DesignNode) {
    event.stopPropagation();
    const next = new Set(collapsedLayerIds);
    const collapsing = !next.has(node.id);
    if (collapsing) next.add(node.id);
    else next.delete(node.id);
    collapsedLayerIds = next;
    logAction(collapsing ? 'layer.collapsed' : 'layer.expanded', {
      nodeId: node.id,
      kind: node.kind,
      childCount: node.childIds.length,
    });
  }
  async function startLayerRename(
    event: MouseEvent | KeyboardEvent,
    node: DesignNode,
    source: 'layers' | 'canvas' = 'layers',
  ) {
    event.preventDefault();
    event.stopPropagation();
    selection = [node.id];
    editingLayerId = node.id;
    editingLayerName = node.name;
    editingLayerSource = source;
    logAction('layer.rename-opened', { nodeId: node.id, name: node.name, source });
    await tick();
    const input = source === 'canvas' ? canvasNameInput : layerNameInput;
    input?.focus();
    input?.select();
  }
  function finishLayerRename(commit: boolean) {
    const nodeId = editingLayerId;
    const previousName = document.nodes[nodeId]?.name;
    const name = editingLayerName.trim();
    editingLayerId = '';
    editingLayerName = '';
    editingLayerSource = 'layers';
    if (!commit || !nodeId) return;
    if (!name) {
      showError('Layer names cannot be empty', 'Couldn’t rename layer');
      logAction('layer.rename-rejected', { nodeId, reason: 'empty-name' });
      return;
    }
    if (name === previousName) return;
    apply({
      id: uid('op'),
      type: 'update-node',
      actor: 'user',
      targetIds: [nodeId],
      patch: { name },
    });
    logAction('layer.renamed', { nodeId, fromName: previousName ?? '', name });
  }
  function showCanvasNodeName(
    node: DesignNode,
    currentZoom: number,
    isPreview: boolean,
    currentSelection: string[],
  ) {
    if (isPreview) return false;
    return (
      node.kind === 'frame' ||
      node.kind === 'group' ||
      !node.parentId ||
      currentSelection.includes(node.id) ||
      currentZoom >= 1.75
    );
  }
  function layerKindLabel(node: DesignNode) {
    if (node.projectComponent)
      return node.projectComponent.role === 'main' ? 'Main component' : 'Instance';
    if (node.componentBinding) return `shadcn · ${node.componentBinding.componentId}`;
    return node.kind === 'rectangle' ? 'Shape' : node.kind;
  }
  function layerDragStart(event: DragEvent, nodeId: string) {
    layerDrag = { sourceId: nodeId };
    event.dataTransfer?.setData('text/plain', nodeId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function layerDragOver(event: DragEvent, target: DesignNode) {
    if (!layerDrag || layerDrag.sourceId === target.id) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const position =
      (target.kind === 'frame' || target.kind === 'group' || target.kind === 'instance') &&
      ratio > 0.28 &&
      ratio < 0.72
        ? 'inside'
        : ratio < 0.5
          ? 'before'
          : 'after';
    layerDrag = { ...layerDrag, targetId: target.id, position };
  }
  function layerDrop(event: DragEvent, target: DesignNode) {
    event.preventDefault();
    if (!layerDrag || layerDrag.sourceId === target.id) {
      layerDrag = null;
      return;
    }
    const sourceId = layerDrag.sourceId;
    const position = layerDrag.position ?? 'after';
    let parentId = position === 'inside' ? target.id : target.parentId;
    const stack = parentId
      ? (document.nodes[parentId]?.childIds ?? [])
      : (currentScreen?.rootIds ?? []);
    let index = position === 'inside' ? stack.length : stack.indexOf(target.id);
    if (position === 'after') index += 1;
    layerDrag = null;
    apply({
      id: uid('op'),
      type: 'reparent',
      actor: 'user',
      targetIds: [sourceId],
      parentId,
      index: Math.max(0, index),
    });
    selection = [sourceId];
  }

  async function generateCandidates(
    action: CodesignAction,
    rerollCandidateId?: string,
    generationFidelity: Fidelity = requestedFidelity,
  ) {
    if (!selection.length) {
      showError(
        'Select a frame or object before generating a candidate',
        'Couldn’t generate proposal',
      );
      logAction('codesign.request-rejected', { action, message: error });
      return;
    }
    if (!codesignSelectionEligible) {
      showError(
        'Place every selected element inside a group or frame before using Codesign',
        'Couldn’t generate proposal',
      );
      logAction('codesign.request-rejected', { action, message: error });
      return;
    }
    if (!generationCanGenerate) {
      showError(
        'The selection is pinned or has no editable insertion region',
        'Couldn’t generate proposal',
      );
      logAction('codesign.request-rejected', { action, message: error });
      return;
    }
    dismissedCandidateSelectionKey = '';
    loadingCandidate = true;
    liveCandidateDocument = structuredClone(document);
    activeGenerationSourceRevisionId = document.currentRevisionId;
    generationController?.abort();
    const controller = new AbortController();
    generationController = controller;
    const requestId = ++generationRequestId;
    const telemetryRequestId = `codesign-${crypto.randomUUID()}`;
    const requestProjectId = activeProjectId;
    error = '';
    codesignStatus = 'Generating a candidate… Your design is unchanged.';
    logAction('codesign.requested', {
      action,
      provider: 'codex',
      mutationScopeIds: selection,
      observationScope: observationScope.kind,
      observationCount: observationScope.nodeIds.length,
      sourceRevisionId: document.currentRevisionId,
      requestedFidelity: generationFidelity,
      model: selectedAiModel,
      reasoningEffort: selectedAiEffort,
      rerollCandidateId: rerollCandidateId ?? '',
    });
    try {
      const target = deriveCodesignGenerationTarget(
        document,
        selection,
        selectedObservationOption?.kind ?? 'selection',
      );
      startCodesignTelemetry(telemetryRequestId);
      const pinnedChanges = rerollCandidateId
        ? pinnedAtomicIds
            .filter((id) => document.candidates[rerollCandidateId]?.atomicChangeIds.includes(id))
            .map((id) => document.atomicChanges[id])
            .filter(Boolean)
        : [];
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-codesign-request-id': telemetryRequestId,
        },
        signal: controller.signal,
        body: JSON.stringify({
          projectId: activeProjectId,
          action,
          requestedFidelity: generationFidelity,
          providerOptions: { model: selectedAiModel, effort: selectedAiEffort },
          target,
          pinnedNodeIds: document.pinnedNodeIds,
          pinnedAtomicChanges: pinnedChanges,
          document: {
            currentRevisionId: document.currentRevisionId,
            activeScreenId: document.activeScreenId,
            screenName: currentScreen?.name ?? 'Screen',
            screenRootIds: currentScreen?.rootIds ?? [],
            knownNodeIds: Object.keys(document.nodes),
            nodes: Object.fromEntries(
              observationScope.nodeIds
                .map((id) => [id, document.nodes[id]])
                .filter(([, node]) => node),
            ),
            frameFidelity: Object.fromEntries(
              observationScope.nodeIds.flatMap((id) =>
                document.frameFidelity[id] ? [[id, document.frameFidelity[id]]] : [],
              ),
            ),
            nodeFidelityOverrides: Object.fromEntries(
              observationScope.nodeIds.flatMap((id) =>
                document.nodeFidelityOverrides[id]
                  ? [[id, document.nodeFidelityOverrides[id]]]
                  : [],
              ),
            ),
          },
        }),
      });
      const value = (await response.json()) as {
        run?: GenerationRun;
        candidates?: CandidateDraft[];
        message?: string;
        telemetry?: CodesignTelemetryEvent;
      };
      if (value.telemetry) recordCodesignTelemetry(value.telemetry);
      if (!response.ok || !value.run || !value.candidates)
        throw new Error(value.message ?? 'Codesign generation failed');
      if (requestId !== generationRequestId || requestProjectId !== activeProjectId) {
        logAction('codesign.discarded', { action, projectId: requestProjectId });
        return;
      }
      if (document.currentRevisionId !== activeGenerationSourceRevisionId)
        throw new Error('The source design changed during generation. Run Codesign again.');
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
      liveCandidateDocument = null;
      activeGenerationSourceRevisionId = '';
      const generatedIds = value.candidates.map((candidate) => candidate.id);
      activeCandidateId = generatedIds[0] ?? '';
      selectedAtomicIds = value.candidates[0]?.atomicChanges.map((change) => change.id) ?? [];
      compareSourceActive = false;
      highlightedChangeId = '';
      bottomOpen = true;
      bottomTab = 'process';
      codesignStatus = `${value.candidates.length} editable ${value.candidates.length === 1 ? 'candidate is' : 'candidates are'} ready for review.`;
      logAction('codesign.ready', {
        action,
        generationRunId: value.run.id,
        candidateIds: generatedIds,
        provider: value.run.provider,
      });
    } catch (cause) {
      if (requestId !== generationRequestId) return;
      if (controller.signal.aborted) return;
      liveCandidateDocument = null;
      activeGenerationSourceRevisionId = '';
      showError(
        cause instanceof Error ? cause.message : 'Codesign generation failed',
        'Couldn’t generate proposal',
      );
      codesignStatus = error;
      documentStore.replaceMetadata(
        recordGenerationOutcome(document, 'generation-failed', { action, message: error }),
      );
      logAction('codesign.failed', {
        action,
        message: error,
      });
    } finally {
      if (requestId === generationRequestId) {
        loadingCandidate = false;
        generationController = null;
      }
    }
  }
  function cancelGeneration() {
    if (!loadingCandidate || !generationController) return;
    const requestId = activeTelemetryRequestId;
    generationController.abort();
    if (requestId)
      void fetch('/api/agent', {
        method: 'DELETE',
        headers: { 'x-codesign-request-id': requestId },
      });
    generationRequestId += 1;
    generationController = null;
    loadingCandidate = false;
    liveCandidateDocument = null;
    activeGenerationSourceRevisionId = '';
    codesignStatus = 'Generation cancelled. Your selection and design are unchanged.';
    documentStore.replaceMetadata(
      recordGenerationOutcome(document, 'generation-cancelled', {
        action: 'complete',
        focusNodeIds: selection,
      }),
    );
    logAction('codesign.cancelled', { focusNodeIds: selection });
  }
  function abortGenerationForSourceDrift() {
    if (!loadingCandidate || !activeGenerationSourceRevisionId) return;
    const requestId = activeTelemetryRequestId;
    if (requestId)
      void fetch('/api/agent', {
        method: 'DELETE',
        headers: { 'x-codesign-request-id': requestId },
      });
    generationController?.abort();
    generationRequestId += 1;
    generationController = null;
    loadingCandidate = false;
    liveCandidateDocument = null;
    activeGenerationSourceRevisionId = '';
    codesignStatus = 'The source design changed. Run Codesign again from the new revision.';
    logAction('codesign.source-drifted', {
      requestId,
      sourceRevisionId: document.currentRevisionId,
    });
  }
  function selectCandidate(candidateId: string) {
    const candidate = document.candidates[candidateId];
    if (!candidate) return;
    dismissedCandidateSelectionKey = '';
    activeCandidateId = candidateId;
    selectedAtomicIds = candidate.atomicChangeIds.filter(
      (id) => candidate.decisions[id] === 'pending',
    );
    compareSourceActive = false;
    proposedSelectionId = '';
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
    let next = document;
    const changedIds: string[] = [];
    const candidate = activeCandidate;
    const visit = (id: string) => {
      const change = next.atomicChanges[id];
      if (!change || changedIds.includes(id)) return;
      if (pinned) change.dependencyIds.forEach(visit);
      else
        candidate?.atomicChangeIds
          .filter((candidateId) => next.atomicChanges[candidateId]?.dependencyIds.includes(id))
          .forEach(visit);
      next = setAtomicChangePinned(next, id, pinned);
      changedIds.push(id);
    };
    visit(changeId);
    documentStore.replaceMetadata(next);
    codesignStatus = pinned
      ? 'Pinned change will be preserved on the next reroll.'
      : 'Change unpinned.';
    logAction('codesign.atomic-pin-changed', { changeId, pinned, changedIds });
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
      proposedSelectionId = '';
      compareSourceActive = false;
      codesignStatus = rejectedIds.length
        ? `Accepted ${acceptedIds.length} and saved ${rejectedIds.length} as rejected.`
        : `Accepted all ${acceptedIds.length} changes in one revision.`;
      logAction('codesign.accepted', { candidateId, acceptedIds, rejectedIds });
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Candidate could not be accepted');
      codesignStatus = error;
    }
  }
  function rejectActiveCandidate(candidateId: string) {
    documentStore.replaceMetadata(rejectCandidate(document, candidateId));
    selectedAtomicIds = [];
    proposedSelectionId = '';
    codesignStatus = 'Candidate rejected and retained in process history.';
    logAction('codesign.rejected', { candidateId });
  }
  function rerollCandidate(candidateId: string) {
    const candidate = document.candidates[candidateId];
    if (!candidate) return;
    const run = document.generationRuns[candidate.generationRunId];
    if (!run) return;
    requestedFidelity = candidate.fidelity;
    documentStore.replaceMetadata(recordReroll(document, candidate.generationRunId));
    void generateCandidates(run.action, candidateId, candidate.fidelity);
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
      showError(cause instanceof Error ? cause.message : 'Recorded changes could not be reapplied');
    }
  }
  function selectObservationScope(scope: ObservationScope) {
    observationKind = scope.kind === 'frame' ? 'same-parent-frame' : 'selection';
    codesignStatus = `Codesign can reference ${scope.nodeIds.length} ${scope.nodeIds.length === 1 ? 'layer' : 'layers'}; only the selection can change.`;
  }
  function stageFidelity(fidelity: Fidelity) {
    requestedFidelity = fidelity;
    if (!generationCanGenerate) {
      codesignStatus = 'Select an editable layer before generating a new representation.';
      return;
    }
    codesignStatus = `${fidelity[0].toUpperCase() + fidelity.slice(1)} is the target. Generating a candidate…`;
    void generateCandidates('complete');
  }
  function inspectFidelityCandidate(fidelity: Fidelity) {
    const candidate = runCandidates.find((item) => item.fidelity === fidelity);
    if (candidate) selectCandidate(candidate.id);
  }
  function setSelectedFidelity(fidelity: Fidelity) {
    const node = selectedNodes[0];
    if (!node) return;
    const next =
      node.kind === 'frame'
        ? setFrameFidelity(document, node.id, fidelity)
        : setNodeFidelityOverride(document, node.id, fidelity);
    documentStore.replaceMetadata(next);
    requestedFidelity = fidelity;
    codesignStatus =
      node.kind === 'frame'
        ? `${node.name} now sets ${fidelity} fidelity for its descendants.`
        : `${node.name} now overrides inherited fidelity with ${fidelity}.`;
    logAction('fidelity.changed', { nodeId: node.id, fidelity, override: node.kind !== 'frame' });
  }
  function clearSelectedFidelityOverride() {
    const node = selectedNodes[0];
    if (!node || node.kind === 'frame') return;
    const next = setNodeFidelityOverride(document, node.id);
    documentStore.replaceMetadata(next);
    requestedFidelity = effectiveFidelity(next, node.id);
    codesignStatus = `${node.name} now inherits fidelity from its containing frame.`;
    logAction('fidelity.override-cleared', { nodeId: node.id });
  }
  function selectProposedLayer(nodeId: string) {
    proposedSelectionId = nodeId;
    const change = activeCandidate?.atomicChangeIds
      .map((id) => document.atomicChanges[id])
      .find((item) => item?.trace.affectedNodeIds.includes(nodeId));
    highlightedChangeId = change?.id ?? '';
    logAction('codesign.proposed-layer-selected', { nodeId, changeId: highlightedChangeId });
  }
  function toggleSelectedNodePin(nodeId: string) {
    const pinned = !document.pinnedNodeIds.includes(nodeId);
    documentStore.replaceMetadata(setNodePinned(document, nodeId, pinned));
    codesignStatus = pinned
      ? 'Element pinned. Future candidates cannot change it.'
      : 'Element unpinned.';
    logAction('codesign.node-pin-changed', { nodeId, pinned });
  }
  function changeStyle(patch: StylePatch) {
    const keys = Object.keys(patch);
    const textOnly = keys.every((key) =>
      ['textColor', 'fontSize', 'fontWeight', 'textAlign', 'lineHeight'].includes(key),
    );
    const targetIds = selectedNodes
      .filter((node) => !node.componentBinding || (textOnly && isEditableContentNode(node)))
      .map((node) => node.id);
    if (targetIds.length)
      apply({
        id: uid('op'),
        type: 'style',
        actor: 'user',
        targetIds,
        patch,
      });
  }
  function enableStroke() {
    changeStyle({ stroke: '#20242b', strokeWidth: 1 });
  }
  function setStrokeColor(stroke: string) {
    const targets = selectedNodes.filter((node) => !node.componentBinding);
    applyBatch(
      targets.map((node) => ({
        id: uid('op'),
        type: 'style' as const,
        actor: 'user' as const,
        targetIds: [node.id],
        patch: {
          stroke,
          ...(node.style.strokeWidth === undefined ? { strokeWidth: 1 } : {}),
        },
      })),
      'stroke-color',
    );
  }
  function setStrokeWidth(strokeWidth: number) {
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0) return;
    const targets = selectedNodes.filter((node) => !node.componentBinding);
    applyBatch(
      targets.map((node) => ({
        id: uid('op'),
        type: 'style' as const,
        actor: 'user' as const,
        targetIds: [node.id],
        patch: {
          strokeWidth,
          ...(node.style.stroke === undefined ? { stroke: '#20242b' } : {}),
        },
      })),
      'stroke-width',
    );
  }
  function removeStroke() {
    changeStyle({ stroke: null, strokeWidth: null });
  }
  function mixedStyleValue<K extends keyof DesignNode['style']>(key: K) {
    const values = selectedNodes.map((node) => node.style[key]);
    return values.every((value) => value === values[0]) ? values[0] : null;
  }
  function changeSelectionGeometry(field: keyof Bounds, value: number) {
    if (!selectionBounds || !Number.isFinite(value)) return;
    const roots = selectionRootIds();
    if (field === 'x' || field === 'y') {
      apply({
        id: uid('op'),
        type: 'move',
        actor: 'user',
        targetIds: roots,
        dx: field === 'x' ? value - selectionBounds.x : 0,
        dy: field === 'y' ? value - selectionBounds.y : 0,
      });
      return;
    }
    const next = { ...selectionBounds, [field]: Math.max(8, value) };
    const scaleX = next.width / selectionBounds.width;
    const scaleY = next.height / selectionBounds.height;
    applyBatch(
      selectedNodes.map((node) => ({
        id: uid('op'),
        type: 'resize' as const,
        actor: 'user' as const,
        targetId: node.id,
        bounds: {
          x: next.x + (node.bounds.x - selectionBounds.x) * scaleX,
          y: next.y + (node.bounds.y - selectionBounds.y) * scaleY,
          width: Math.max(8, node.bounds.width * scaleX),
          height: Math.max(8, node.bounds.height * scaleY),
        },
      })),
      'property-resize',
    );
  }
  function isEditableContentNode(node: DesignNode) {
    if (node.kind === 'text') return true;
    if (!node.componentBinding) return false;
    const component = resolveComponent(node.componentBinding.componentId);
    return Boolean(
      component && (component.part?.editableContent || component.root.editableContent),
    );
  }
  function updateSelectedText(text: string) {
    const targetIds = selectedNodes.filter(isEditableContentNode).map((node) => node.id);
    if (targetIds.length)
      apply({ id: uid('op'), type: 'update-node', actor: 'user', targetIds, patch: { text } });
  }
  function updateSelectedLayout(patch: LayoutPatch) {
    if (!selectedNodes.length) return;
    apply({
      id: uid('op'),
      type: 'update-node',
      actor: 'user',
      targetIds: selectedNodes.map((item) => item.id),
      patch: { layout: patch },
    });
  }
  function setSelectedFrameClipping(clipContent: boolean) {
    const targetIds = selectedNodes.filter((node) => node.kind === 'frame').map((node) => node.id);
    if (targetIds.length)
      apply({
        id: uid('op'),
        type: 'update-node',
        actor: 'user',
        targetIds,
        patch: { clipContent },
      });
  }
  function updateComponentOverride(node: DesignNode, key: string, value: unknown) {
    if (!node.componentBinding) return;
    apply({
      id: uid('op'),
      type: 'promote',
      actor: 'user',
      targetIds: [node.id],
      componentId: node.componentBinding.componentId,
      props: { ...node.componentBinding.props, [key]: value },
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
</script>

<svelte:head
  ><title>Codesign · Visual autocomplete</title><meta
    name="description"
    content="Explore structured visual continuations without changing your source design."
  /></svelte:head
>

<svelte:window onclick={logControlClick} />

<div
  class="app"
  class:preview
  class:resizing-sidebar={Boolean(sidebarResize)}
  style={`--left-sidebar-width:${leftSidebarWidth}px;--right-sidebar-width:${rightSidebarWidth}px`}
>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">C</span><strong>Codesign</strong><span
        class="document-name"
        title={activeProject?.name ?? 'Untitled design'}
        >{activeProject?.name ?? 'Untitled design'}</span
      >
      {#if persistenceReady}
        <span
          class="document-status"
          class:save-issue={Boolean(storageWarning)}
          title={documentStatusTitle}
        >
          {#if lastEditedLabel}<span>{lastEditedLabel}</span><i aria-hidden="true">·</i>{/if}<span
            >{saveStatusLabel}</span
          >
        </span>
      {/if}
    </div>
    <div class="mode-switch" aria-label="Editor mode">
      <button class:active={editorMode === 'edit'} onclick={() => setEditorMode('edit')}
        >Edit</button
      ><button class:active={editorMode === 'preview'} onclick={() => setEditorMode('preview')}
        >Preview</button
      >
    </div>
    <div class="top-actions">
      <span class="status" title={agentStatus}
        ><i aria-hidden="true" class:online={providerConnected}></i>{providerConnected
          ? `Codex${providerPlan ? ` · ${providerPlan}` : ''}`
          : 'Codex · signed out'}</span
      >
      <button title="Open editor and Codesign settings" onclick={openSettings}>Settings</button>
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

  <button
    type="button"
    class="sidebar-resizer left-resizer"
    class:active={sidebarResize?.side === 'left'}
    aria-label={`Resize left sidebar, currently ${leftSidebarWidth} pixels`}
    aria-controls="left-sidebar"
    title="Drag to resize the left sidebar"
    onpointerdown={(event) => startSidebarResize(event, 'left')}
    onpointermove={updateSidebarResize}
    onpointerup={finishSidebarResize}
    onpointercancel={finishSidebarResize}
    onkeydown={(event) => resizeSidebarWithKeyboard(event, 'left')}
    onclick={(event) => event.stopPropagation()}
  ></button>
  <button
    type="button"
    class="sidebar-resizer right-resizer"
    class:active={sidebarResize?.side === 'right'}
    aria-label={`Resize right sidebar, currently ${rightSidebarWidth} pixels`}
    aria-controls="right-sidebar"
    title="Drag to resize the right sidebar"
    onpointerdown={(event) => startSidebarResize(event, 'right')}
    onpointermove={updateSidebarResize}
    onpointerup={finishSidebarResize}
    onpointercancel={finishSidebarResize}
    onkeydown={(event) => resizeSidebarWithKeyboard(event, 'right')}
    onclick={(event) => event.stopPropagation()}
  ></button>

  <aside class="leftbar" id="left-sidebar">
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
    <section class="pages" aria-label="Pages">
      <div class="section-title">
        <span>Pages</span><small
          >{document.screens.filter((screen) => screen.branchId === document.activeBranchId)
            .length}</small
        >
      </div>
      {#each document.screens.filter((screen) => screen.branchId === document.activeBranchId) as screen}
        <div class:active={screen.id === document.activeScreenId} class="screen-row">
          <button
            onclick={() => {
              navigateToScreen(screen.id, screen.branchId);
            }}>{screen.name}</button
          >
        </div>
      {/each}
    </section>
    <nav class="tools" aria-label="Tools">
      {#each [{ id: 'select', label: 'Select', icon: '↖', key: 'V' }, { id: 'frame', label: 'Frame', icon: '▣', key: 'F' }, { id: 'rectangle', label: 'Rectangle', icon: '□', key: 'R' }, { id: 'text', label: 'Text', icon: 'T', key: 'T' }] as item}<button
          class:active={tool === item.id}
          title={`${item.label} tool · ${item.key}`}
          onclick={() => setTool(item.id as Tool, 'toolbar')}
          ><span class="tool-icon" aria-hidden="true">{item.icon}</span><span class="tool-label"
            >{item.label}</span
          ><kbd>{item.key}</kbd></button
        >{/each}
    </nav>
    {#if tool === 'frame'}
      <section class="frame-presets" aria-label="Frame presets">
        <div class="section-title">
          <span>Frame size</span><small>{frameSize.width}×{frameSize.height}</small>
        </div>
        <label
          >Preset<select
            value={framePresetId}
            onchange={(event) => chooseFramePreset(event.currentTarget.value)}
          >
            {#each FRAME_PRESETS as preset}
              <option value={preset.id}>{preset.name} · {preset.width}×{preset.height}</option>
            {/each}
            <option value="custom">Custom size</option>
          </select></label
        >
        <div class="preset-size-grid">
          <label
            >Width<input
              type="number"
              min="8"
              value={frameSize.width}
              onchange={(event) => {
                framePresetId = 'custom';
                frameSize = { ...frameSize, width: Math.max(8, Number(event.currentTarget.value)) };
                persistFrameSize();
              }}
            /></label
          ><label
            >Height<input
              type="number"
              min="8"
              value={frameSize.height}
              onchange={(event) => {
                framePresetId = 'custom';
                frameSize = {
                  ...frameSize,
                  height: Math.max(8, Number(event.currentTarget.value)),
                };
                persistFrameSize();
              }}
            /></label
          >
        </div>
        <div class="preset-actions">
          <button onclick={swapFramePresetOrientation}>Swap orientation</button>
          <button class="primary" onclick={placePresetFrame}>Place frame</button>
        </div>
        <p>Drag for a custom frame, or place this preset at the canvas center.</p>
      </section>
    {/if}
    <ComponentLibrary components={componentCatalog} onInsert={insertComponent} />
    <ProjectComponentLibrary definitions={projectComponents} onInsert={insertProjectComponent} />
    <section class="outline">
      <div class="section-title layers-title">
        <span>Layers</span><small>{visibleNodes.length}</small>
      </div>
      {#if codesignReviewActive && proposedLayerRows.length}
        <div class="proposed-layers" aria-label="Proposed candidate layers">
          <div class="proposed-layers-heading">
            <span><i aria-hidden="true">✦</i> Proposed layers</span><small
              >Candidate {Math.max(1, runCandidates.indexOf(activeCandidate!) + 1)}</small
            >
          </div>
          {#each proposedLayerRows as row (row.node.id)}
            {@const atomicChange = activeCandidate?.atomicChangeIds
              .map((id) => document.atomicChanges[id])
              .find((change) => change?.trace.affectedNodeIds.includes(row.node.id))}
            <div
              class="proposed-layer-row"
              class:selected={proposedSelectionId === row.node.id}
              style={`--layer-indent:${8 + row.depth * 14}px`}
            >
              {#if atomicChange}
                <input
                  type="checkbox"
                  aria-label={`Include proposed ${row.node.name}`}
                  checked={selectedAtomicIds.includes(atomicChange.id)}
                  onchange={(event) =>
                    toggleAtomicChange(atomicChange.id, event.currentTarget.checked)}
                />
              {:else}
                <span class="proposed-checkbox-spacer" aria-hidden="true"></span>
              {/if}
              <button onclick={() => selectProposedLayer(row.node.id)}>
                <span class="layer-kind">Proposed {layerKindLabel(row.node)}</span>
                <span class="layer-name">{row.node.name}</span>
              </button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="layers" role="list" aria-label="Layers">
        {#each layerRows as row (row.node.id)}<div
            class="layer-row"
            role="listitem"
            class:selected={selection.includes(row.node.id)}
            class:child-layer={row.depth > 0}
            class:component-layer={isComponentTreeNode(document, row.node.id)}
            class:drop-before={layerDrag?.targetId === row.node.id &&
              layerDrag.position === 'before'}
            class:drop-inside={layerDrag?.targetId === row.node.id &&
              layerDrag.position === 'inside'}
            class:drop-after={layerDrag?.targetId === row.node.id && layerDrag.position === 'after'}
            style={`--layer-indent:${5 + row.depth * 14}px`}
            draggable={editingLayerId !== row.node.id}
            ondragstart={(event) => layerDragStart(event, row.node.id)}
            ondragover={(event) => layerDragOver(event, row.node)}
            ondrop={(event) => layerDrop(event, row.node)}
            ondragend={() => (layerDrag = null)}
            oncontextmenu={(event) => openContextMenu(event, row.node, 'layers')}
          >
            {#if layerCanCollapse(row.node)}<button
                class="layer-action layer-collapse"
                aria-expanded={!collapsedLayerIds.has(row.node.id)}
                aria-label={`${collapsedLayerIds.has(row.node.id) ? 'Expand' : 'Collapse'} ${row.node.name}`}
                title={collapsedLayerIds.has(row.node.id) ? 'Expand' : 'Collapse'}
                onclick={(event) => toggleLayerCollapse(event, row.node)}
                ><span aria-hidden="true">{collapsedLayerIds.has(row.node.id) ? '▶' : '▼'}</span
                ></button
              >{:else}<span class="layer-disclosure-spacer" aria-hidden="true"
              ></span>{/if}{#if editingLayerId === row.node.id && editingLayerSource === 'layers'}<div
                class="layer-select"
              >
                <span class="layer-kind">{layerKindLabel(row.node)}</span><input
                  class="layer-name-input"
                  bind:this={layerNameInput}
                  bind:value={editingLayerName}
                  maxlength="120"
                  aria-label={`Rename ${row.node.name}`}
                  onclick={(event) => event.stopPropagation()}
                  onblur={() => finishLayerRename(true)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      finishLayerRename(true);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      finishLayerRename(false);
                    }
                  }}
                />
              </div>{:else}<button
                class="layer-select"
                aria-pressed={selection.includes(row.node.id)}
                onclick={(event) => {
                  const additive = isAdditiveSelectionModifier(event);
                  selection = selectionWithTarget(selection, row.node.id, additive);
                  logAction('selection.changed', {
                    source: 'layers',
                    nodeIds: selection,
                    additive,
                  });
                }}
                ondblclick={(event) => startLayerRename(event, row.node)}
                ><span class="layer-kind">{layerKindLabel(row.node)}</span><span class="layer-name"
                  >{row.node.name}</span
                ></button
              >{/if}
          </div>{/each}
      </div>
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
      ><button class="shortcuts-button" onclick={() => openShortcuts('toolbar')}
        >Keyboard shortcuts <kbd>/</kbd></button
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
    <div class="canvas-help" class:component-drop-help={componentDropActive}>
      {componentDropActive
        ? 'Release to place this component on the canvas'
        : preview
          ? 'Preview canvas · Esc to exit'
          : codesignReviewActive
            ? compareSourceActive
              ? 'Source view · Select Show candidate to return to the proposal'
              : 'Candidate view · Proposed changes are shown in place without overlapping the source'
            : tool === 'frame'
              ? `${framePresetById(framePresetId)?.name ?? 'Custom frame'} · ${frameSize.width}×${frameSize.height} · Drag custom or place preset`
              : `${tool[0].toUpperCase() + tool.slice(1)} tool · Scroll to pan · Pinch to zoom · Right-click for actions`}
    </div>
    <svg
      bind:this={canvasElement}
      class="canvas"
      class:component-drop-active={componentDropActive}
      role="application"
      aria-label="Design canvas"
      style={`background-color:${canvasBackground}`}
      onpointerdowncapture={captureCanvasPan}
      onpointerdown={canvasDown}
      onpointermove={canvasMove}
      onpointerup={canvasUp}
      onpointercancel={cancelCanvasGesture}
      onlostpointercapture={(event) => {
        if (gesture?.pointerId === event.pointerId) cancelCanvasGesture(event);
      }}
      onwheel={wheel}
      ondragover={componentDragOver}
      ondragleave={componentDragLeave}
      ondrop={dropComponent}
      oncontextmenu={(event) => openContextMenu(event)}
    >
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        <defs>
          {#each visibleNodes.filter((node) => node.kind === 'frame' && node.clipContent) as frame}
            <clipPath id={`clip-${frame.id}`}>
              <rect
                x={transientBounds[frame.id]?.x ?? frame.bounds.x}
                y={transientBounds[frame.id]?.y ?? frame.bounds.y}
                width={transientBounds[frame.id]?.width ?? frame.bounds.width}
                height={transientBounds[frame.id]?.height ?? frame.bounds.height}
                rx={frame.style.radius}
              />
            </clipPath>
          {/each}
        </defs>
        {#if codesignReviewActive && reviewTarget}
          {#each reviewTarget.mutationScope.regions as region}
            <rect
              class="editable-region-boundary"
              x={region.x}
              y={region.y}
              width={region.width}
              height={region.height}
              rx="3"
            />
          {/each}
          {#each reviewTarget.mutationScope.insertionParentIds as parentId}
            {@const parent = document.nodes[parentId]}
            {#if parent}
              <rect
                class="insertion-parent-boundary"
                x={parent.bounds.x - 3 / zoom}
                y={parent.bounds.y - 3 / zoom}
                width={parent.bounds.width + 6 / zoom}
                height={parent.bounds.height + 6 / zoom}
                rx={Math.max(parent.style.radius, 3)}
              />
            {/if}
          {/each}
        {/if}
        {#each renderedNodes as node (node.id)}
          {@const bounds = transientBounds[node.id] ?? node.bounds}
          {@const textLayout = textPosition(node, bounds)}
          {@const textY =
            bounds.y + Math.min(contentInset(node) + node.style.fontSize, bounds.height - 7)}
          {@const textLineHeight = node.style.fontSize * node.style.lineHeight}
          {@const textEditorY =
            textY -
            node.style.fontSize -
            (textLineHeight - node.style.fontSize) / 2 +
            node.style.fontSize * INTER_TEXTAREA_ASCENT_CORRECTION_EM}
          <g
            id={`node-${node.id}`}
            class:selected={selection.includes(node.id)}
            class:promoted={!!node.componentBinding}
            role="button"
            tabindex="0"
            aria-label={node.name}
            style={`opacity:${node.style.opacity};${clippingFrameId(node) ? `clip-path:url(#clip-${clippingFrameId(node)})` : ''}`}
            onpointerdown={(event) => nodeDown(event, node)}
            ondblclick={(event) => nodeDoubleClick(event, node)}
            oncontextmenu={(event) => openContextMenu(event, node)}
          >
            {#if scopePreviewNodeIds.includes(node.id)}
              <rect
                class="scope-preview-boundary"
                x={bounds.x - 7 / zoom}
                y={bounds.y - 7 / zoom}
                width={bounds.width + 14 / zoom}
                height={bounds.height + 14 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if loadingCandidate && eligibleGenerationSelection.includes(node.id)}
              <rect
                class="generation-active-boundary"
                x={bounds.x - 8 / zoom}
                y={bounds.y - 8 / zoom}
                width={bounds.width + 16 / zoom}
                height={bounds.height + 16 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if codesignReviewActive && reviewObservationScope.nodeIds.includes(node.id) && (reviewObservationScope.rootId === node.id || (!reviewObservationScope.rootId && (!node.parentId || !reviewObservationScope.nodeIds.includes(node.parentId))))}
              <rect
                class="observation-boundary"
                x={bounds.x - 6 / zoom}
                y={bounds.y - 6 / zoom}
                width={bounds.width + 12 / zoom}
                height={bounds.height + 12 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if codesignReviewActive && reviewTarget?.mutationScope.existingNodeIds.includes(node.id)}
              <rect
                class="mutation-boundary"
                x={bounds.x - 9 / zoom}
                y={bounds.y - 9 / zoom}
                width={bounds.width + 18 / zoom}
                height={bounds.height + 18 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {:else if codesignReviewActive && selection.includes(node.id)}
              <rect
                class="focus-boundary"
                x={bounds.x - 9 / zoom}
                y={bounds.y - 9 / zoom}
                width={bounds.width + 18 / zoom}
                height={bounds.height + 18 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if codesignReviewActive && highlightedChangeId && document.atomicChanges[highlightedChangeId]?.trace.evidenceNodeIds.includes(node.id)}
              <rect
                class="evidence-highlight"
                x={bounds.x - 10 / zoom}
                y={bounds.y - 10 / zoom}
                width={bounds.width + 20 / zoom}
                height={bounds.height + 20 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if !node.componentBinding}
              <rect
                class="node"
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
                rx={node.style.radius}
                fill={node.style.fill}
                stroke={node.style.stroke}
                stroke-width={node.style.strokeWidth}
              />
            {/if}
            {#if node.projectComponent && selection.includes(node.id)}
              <rect
                class="project-component-boundary"
                class:main={node.projectComponent.role === 'main'}
                x={bounds.x - 2 / zoom}
                y={bounds.y - 2 / zoom}
                width={bounds.width + 4 / zoom}
                height={bounds.height + 4 / zoom}
                rx={Math.max(node.style.radius, 3)}
              />
            {/if}
            {#if node.componentBinding}
              {#if !preview}
                <rect
                  class="component-hit-target"
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  rx={node.style.radius}
                />
              {/if}
              {#if !belongsToNativeComponentTree(node, document.nodes)}
                <ComponentCanvasRenderer {node} {bounds} nodes={document.nodes} {preview} />
              {/if}
            {/if}
            {#if !node.componentBinding && selection.includes(node.id)}<rect
                class="content-area"
                x={bounds.x + contentInset(node)}
                y={bounds.y + contentInset(node)}
                width={Math.max(0, bounds.width - contentInset(node) * 2)}
                height={Math.max(0, bounds.height - contentInset(node) * 2)}
                rx={Math.max(0, node.style.radius - 2)}
              />{/if}
            {#if !node.componentBinding && (node.text || node.semantics) && editingTextId !== node.id}
              {#if node.kind === 'text'}
                <text
                  class="node-label editable-text"
                  role="button"
                  tabindex="0"
                  aria-label={`Edit ${node.name} text`}
                  x={textLayout.x}
                  text-anchor={textLayout.anchor}
                  y={textY}
                  style={`font-size:${node.style.fontSize}px;font-weight:${node.style.fontWeight};fill:${node.style.textColor}`}
                  onpointerdown={(event) => textNodeDown(event, node)}
                  ondblclick={(event) => startTextEditing(event, node)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' || event.key === 'F2') startTextEditing(event, node);
                  }}>{node.text ?? node.semantics?.role}</text
                >
              {:else}
                <text
                  class="node-label"
                  x={textLayout.x}
                  text-anchor={textLayout.anchor}
                  y={textY}
                  style={`font-size:${node.style.fontSize}px;font-weight:${node.style.fontWeight};fill:${node.style.textColor}`}
                  >{node.text ?? node.semantics?.role}</text
                >
              {/if}
            {/if}
            {#if editingTextId === node.id}
              <rect
                class="text-editing-boundary"
                x={bounds.x - 1 / zoom}
                y={bounds.y - 1 / zoom}
                width={bounds.width + 2 / zoom}
                height={bounds.height + 2 / zoom}
                rx={Math.max(0, node.style.radius)}
              />
              <foreignObject
                class="inline-text-editor-shell"
                x={bounds.x + contentInset(node)}
                y={textEditorY}
                width={Math.max(1, bounds.width - contentInset(node) * 2)}
                height={Math.max(1, bounds.y + bounds.height - contentInset(node) - textEditorY)}
              >
                <textarea
                  bind:this={inlineTextEditor}
                  bind:value={editingTextDraft}
                  class="inline-text-editor"
                  aria-label={`Edit ${node.name} text`}
                  style={`font-size:${node.style.fontSize}px;font-weight:${node.style.fontWeight};line-height:${node.style.lineHeight};text-align:${node.style.textAlign};color:${node.style.textColor}`}
                  onpointerdown={(event) => event.stopPropagation()}
                  onclick={(event) => event.stopPropagation()}
                  ondblclick={(event) => event.stopPropagation()}
                  onblur={() => finishTextEditing(true)}
                  onkeydown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      finishTextEditing(false);
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      finishTextEditing(true);
                    }
                  }}></textarea>
              </foreignObject>
            {/if}
            {#if node.repeaterId}<g class="repeat-badge"
                ><rect
                  x={bounds.x + bounds.width - 62}
                  y={bounds.y + 7}
                  width="54"
                  height="18"
                  rx="3"
                /><text x={bounds.x + bounds.width - 55} y={bounds.y + 20}>REPEAT</text></g
              >{/if}
          </g>
        {/each}
        <g class="canvas-node-names">
          {#each renderedNodes.filter( (node) => showCanvasNodeName(node, zoom, preview, selection) ) as node (node.id)}
            {@const bounds = transientBounds[node.id] ?? node.bounds}
            {#if editingLayerId === node.id && editingLayerSource === 'canvas'}
              <foreignObject
                class="canvas-name-editor"
                x={bounds.x - 2 / zoom}
                y={bounds.y - 25 / zoom}
                width={180 / zoom}
                height={22 / zoom}
              >
                <input
                  bind:this={canvasNameInput}
                  bind:value={editingLayerName}
                  maxlength="120"
                  aria-label={`Rename ${node.name}`}
                  style={`font-size:${11 / zoom}px`}
                  onpointerdown={(event) => event.stopPropagation()}
                  ondblclick={(event) => event.stopPropagation()}
                  onblur={() => finishLayerRename(true)}
                  onkeydown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      finishLayerRename(true);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      finishLayerRename(false);
                    }
                  }}
                />
              </foreignObject>
            {:else}
              <text
                class:selected-name={selection.includes(node.id)}
                class="canvas-node-name"
                role="button"
                tabindex="0"
                aria-label={`Rename ${node.name}`}
                x={bounds.x}
                y={bounds.y - 7 / zoom}
                style={`font-size:${11 / zoom}px;stroke-width:${3 / zoom}px`}
                onpointerdown={(event) => {
                  event.stopPropagation();
                  const additive = isAdditiveSelectionModifier(event);
                  selection = selectionWithTarget(selection, node.id, additive);
                  logAction('selection.changed', {
                    source: 'canvas-name',
                    nodeIds: selection,
                    additive,
                  });
                }}
                ondblclick={(event) => startLayerRename(event, node, 'canvas')}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === 'F2')
                    void startLayerRename(event, node, 'canvas');
                }}>{node.name}</text
              >
            {/if}
          {/each}
        </g>
        {#if selectionBounds && !preview && editingTextId === ''}
          <g
            class="collective-selection"
            class:component-selection={selectedNodes.length === 1 &&
              Boolean(selectedNodes[0]?.projectComponent)}
          >
            <rect
              class="selection-box"
              x={selectionBounds.x - 2 / zoom}
              y={selectionBounds.y - 2 / zoom}
              width={selectionBounds.width + 4 / zoom}
              height={selectionBounds.height + 4 / zoom}
            />
            {#each resizeHandles as handle}
              {@const handlePoint = resizeHandlePoint(selectionBounds, handle)}
              <rect
                class={`handle handle-${handle}`}
                role="button"
                tabindex="0"
                aria-label={`Resize selection from ${handle}`}
                x={handlePoint.x - 5 / zoom}
                y={handlePoint.y - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                onpointerdown={(event) => resizeDown(event, handle)}
                onkeydown={(event) => selectedNodes[0] && resizeKeydown(event, selectedNodes[0])}
              />
            {/each}
          </g>
        {/if}
        {#if gesture?.mode === 'duplicate' && gesture.duplicatePayload}
          <g class="duplicate-preview" aria-hidden="true">
            {#each Object.values(gesture.duplicatePayload.nodes) as node}
              <rect
                x={node.bounds.x + duplicatePreviewOffset.x}
                y={node.bounds.y + duplicatePreviewOffset.y}
                width={node.bounds.width}
                height={node.bounds.height}
                rx={node.style.radius}
                fill={node.style.fill}
                stroke={node.style.stroke}
                stroke-width={node.style.strokeWidth}
              />
            {/each}
          </g>
        {/if}
        {#each smartGuides as guide}
          {#if guide.axis === 'x'}
            <line
              class="smart-guide"
              x1={guide.position}
              x2={guide.position}
              y1="-4000"
              y2="4000"
            />
          {:else}
            <line
              class="smart-guide"
              x1="-4000"
              x2="4000"
              y1={guide.position}
              y2={guide.position}
            />
          {/if}
        {/each}
        {#if selectionBounds}
          {#each spacingGuides as guide}
            {#if guide.axis === 'x'}
              <g class="spacing-guide">
                <line
                  x1={guide.positions[0]}
                  x2={guide.positions[3]}
                  y1={selectionBounds.y - 12 / zoom}
                  y2={selectionBounds.y - 12 / zoom}
                /><text
                  x={(guide.positions[0] + guide.positions[3]) / 2}
                  y={selectionBounds.y - 16 / zoom}>{Math.round(guide.gap)}px</text
                >
              </g>
            {:else}
              <g class="spacing-guide">
                <line
                  x1={selectionBounds.x - 12 / zoom}
                  x2={selectionBounds.x - 12 / zoom}
                  y1={guide.positions[0]}
                  y2={guide.positions[3]}
                /><text
                  x={selectionBounds.x - 16 / zoom}
                  y={(guide.positions[0] + guide.positions[3]) / 2}>{Math.round(guide.gap)}px</text
                >
              </g>
            {/if}
          {/each}
        {/if}
        {#if codesignReviewActive && ghostSnapshot && !compareSourceActive}
          <g class="candidate-preview" aria-hidden="true">
            {#each ghostNodes as node (node.id)}
              {@const candidateHighlighted = Boolean(
                proposedSelectionId === node.id ||
                (highlightedChangeId &&
                  document.atomicChanges[highlightedChangeId]?.trace.affectedNodeIds.includes(
                    node.id,
                  )),
              )}
              <g class:highlighted-candidate={candidateHighlighted}>
                {#if candidateHighlighted}
                  <rect
                    class="candidate-change-boundary"
                    x={node.bounds.x - 3 / zoom}
                    y={node.bounds.y - 3 / zoom}
                    width={node.bounds.width + 6 / zoom}
                    height={node.bounds.height + 6 / zoom}
                    rx={Math.max(node.style.radius, 3)}
                  />
                {/if}
                {#if !node.componentBinding}
                  <rect
                    x={node.bounds.x}
                    y={node.bounds.y}
                    width={node.bounds.width}
                    height={node.bounds.height}
                    rx={node.style.radius}
                    fill={node.style.fill}
                    stroke={node.style.stroke}
                    stroke-width={node.style.strokeWidth}
                  />
                {/if}
                {#if node.componentBinding}
                  {#if !belongsToNativeComponentTree(node, ghostSnapshot.nodes)}
                    <ComponentCanvasRenderer
                      {node}
                      bounds={node.bounds}
                      nodes={ghostSnapshot.nodes}
                    />
                  {/if}
                {/if}
                {#if node.text && !node.componentBinding}
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
        {#if marquee}<rect
            class="marquee"
            x={marquee.x}
            y={marquee.y}
            width={marquee.width}
            height={marquee.height}
          />{/if}
        {#if draft}<rect
            class="draft"
            x={draft.x}
            y={draft.y}
            width={draft.width}
            height={draft.height}
          /><text class="draft-size" x={draft.x} y={draft.y - 8 / zoom}
            >{tool === 'frame' ? 'Custom frame · ' : ''}{Math.round(draft.width)}×{Math.round(
              draft.height,
            )}</text
          >{/if}
      </g>
    </svg>
    {#if (selection.length || codesignReviewActive) && !preview}
      <InlineCodesignToolbar
        selectionLabel={selection.length === 1
          ? (selectedNodes[0]?.name ?? 'Selection')
          : selection.length > 1
            ? `${selection.length} layers selected`
            : 'Saved candidate'}
        canGenerate={generationCanGenerate}
        statusMessage={codesignToolbarStatus}
        busy={loadingCandidate}
        observationScope={reviewObservationScope}
        {observationScopes}
        {fidelityStops}
        fidelityResetKey={`${selection.join(',')}:${document.currentRevisionId}`}
        {activeFidelityStage}
        candidates={candidateViews}
        activeCandidateId={activeCandidate?.id}
        highlightedChangeId={highlightedChangeId || undefined}
        compareSource={compareSourceActive}
        rerollDisabledReason={generationCanGenerate
          ? undefined
          : (codesignEligibility.reason ?? 'The selection has no editable generation target.')}
        onObservationScopeChange={selectObservationScope}
        onScopePreviewChange={(open) => (scopePreviewActive = open)}
        onCancel={cancelGeneration}
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
    {/if}

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
                ? `${selection.length > 1 ? `${selection.length} selected · ` : ''}${layerKindLabel(contextNode)}`
                : 'Canvas actions'}</span
          >
        </div>
        {#if preview}<button
            role="menuitem"
            onclick={() => {
              setEditorMode('edit');
              contextMenu = null;
            }}>Exit preview to edit</button
          >{:else if contextNode}<button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              void copySelection(true);
            }}><span>Cut</span><kbd>{commandLabel}+X</kbd></button
          ><button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              void copySelection(false);
            }}><span>Copy</span><kbd>{commandLabel}+C</kbd></button
          ><button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              void pasteSelection();
            }}><span>Paste</span><kbd>{commandLabel}+V</kbd></button
          ><button role="menuitem" onclick={duplicateFromContext}
            ><span>Duplicate</span><kbd>{commandLabel}+D</kbd></button
          >{#if selection.length}<button role="menuitem" onclick={groupFromContext}
              ><span
                >{selectedNodes.some((node) => node.kind === 'group') ? 'Ungroup' : 'Group'}</span
              ><kbd
                >{commandLabel}+{selectedNodes.some((node) => node.kind === 'group')
                  ? 'Shift+G'
                  : 'G'}</kbd
              ></button
            ><button role="menuitem" onclick={frameFromContext}
              ><span>Frame selection</span><kbd>{commandLabel}+Alt+G</kbd></button
            >{/if}
          <div class="menu-separator"></div>
          <button role="menuitem" onclick={() => reorderFromContext('forward')}
            ><span>Bring forward</span><kbd>{commandLabel}+]</kbd></button
          ><button role="menuitem" onclick={() => reorderFromContext('backward')}
            ><span>Send backward</span><kbd>{commandLabel}+[</kbd></button
          ><button role="menuitem" onclick={() => reorderFromContext('front')}
            ><span>Bring to front</span><kbd>{commandLabel}+Shift+]</kbd></button
          ><button role="menuitem" onclick={() => reorderFromContext('back')}
            ><span>Send to back</span><kbd>{commandLabel}+Shift+[</kbd></button
          >{#if contextNode.kind === 'frame'}<button
              role="menuitem"
              onclick={() => toggleFrameClip(contextNode)}
              >{contextNode.clipContent ? 'Disable Clip content' : 'Enable Clip content'}</button
            >{/if}
          {#if selection.length === 1 && canCreateProjectComponent(contextNode)}<button
              role="menuitem"
              onclick={() => {
                const source = contextNode;
                contextMenu = null;
                createProjectComponentFrom(source);
              }}><span>Create component</span><kbd>{commandLabel}+Alt+K</kbd></button
            >{/if}
          <div class="menu-separator"></div>
          <button class="danger" role="menuitem" onclick={deleteFromContext}
            ><span>Delete {selection.length > 1 ? 'selection' : 'element'}</span><kbd>Delete</kbd
            ></button
          >{:else}<button
            role="menuitem"
            onclick={() => {
              contextMenu = null;
              void pasteSelection();
            }}><span>Paste</span><kbd>{commandLabel}+V</kbd></button
          ><button
            role="menuitem"
            onclick={() => {
              resetViewport('context-menu');
              contextMenu = null;
            }}>Reset canvas view</button
          >{/if}
      </div>{/if}

    {#if shortcutsOpen}
      <div
        class="shortcuts-backdrop"
        role="presentation"
        onclick={(event) => {
          if (event.target === event.currentTarget) closeShortcuts('backdrop');
        }}
      >
        <div
          class="shortcuts-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
        >
          <header>
            <div>
              <span class="eyebrow">Editor reference</span>
              <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            </div>
            <button aria-label="Close keyboard shortcuts" onclick={() => closeShortcuts('button')}
              >Close <kbd>Esc</kbd></button
            >
          </header>
          <div class="shortcut-groups">
            <section>
              <h3>Tools</h3>
              <dl>
                <div>
                  <dt>Select</dt>
                  <dd><kbd>V</kbd></dd>
                </div>
                <div>
                  <dt>Frame</dt>
                  <dd><kbd>F</kbd></dd>
                </div>
                <div>
                  <dt>Rectangle</dt>
                  <dd><kbd>R</kbd></dd>
                </div>
                <div>
                  <dt>Text</dt>
                  <dd><kbd>T</kbd></dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Edit</h3>
              <dl>
                <div>
                  <dt>Undo</dt>
                  <dd><kbd>{commandLabel}+Z</kbd></dd>
                </div>
                <div>
                  <dt>Redo</dt>
                  <dd><kbd>{commandLabel}+Shift+Z</kbd></dd>
                </div>
                <div>
                  <dt>Copy</dt>
                  <dd><kbd>{commandLabel}+C</kbd></dd>
                </div>
                <div>
                  <dt>Cut</dt>
                  <dd><kbd>{commandLabel}+X</kbd></dd>
                </div>
                <div>
                  <dt>Paste</dt>
                  <dd><kbd>{commandLabel}+V</kbd></dd>
                </div>
                <div>
                  <dt>Duplicate</dt>
                  <dd><kbd>{commandLabel}+D</kbd></dd>
                </div>
                <div>
                  <dt>Add or remove from selection</dt>
                  <dd><kbd>{commandLabel}+Click</kbd> or <kbd>Shift+Click</kbd></dd>
                </div>
                <div>
                  <dt>Enter group and select child</dt>
                  <dd><kbd>Double-click</kbd></dd>
                </div>
                <div>
                  <dt>Create component from frame or group</dt>
                  <dd><kbd>{commandLabel}+Alt+K</kbd></dd>
                </div>
                <div>
                  <dt>Delete</dt>
                  <dd><kbd>Delete</kbd></dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Arrange</h3>
              <dl>
                <div>
                  <dt>Group</dt>
                  <dd><kbd>{commandLabel}+G</kbd></dd>
                </div>
                <div>
                  <dt>Ungroup</dt>
                  <dd><kbd>{commandLabel}+Shift+G</kbd></dd>
                </div>
                <div>
                  <dt>Frame selection</dt>
                  <dd><kbd>{commandLabel}+Alt+G</kbd></dd>
                </div>
                <div>
                  <dt>Bring forward</dt>
                  <dd><kbd>{commandLabel}+]</kbd></dd>
                </div>
                <div>
                  <dt>Send backward</dt>
                  <dd><kbd>{commandLabel}+[</kbd></dd>
                </div>
                <div>
                  <dt>Bring to front</dt>
                  <dd><kbd>{commandLabel}+Shift+]</kbd></dd>
                </div>
                <div>
                  <dt>Send to back</dt>
                  <dd><kbd>{commandLabel}+Shift+[</kbd></dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Canvas and selection</h3>
              <dl>
                <div>
                  <dt>Nudge 1 px</dt>
                  <dd><kbd>Arrow keys</kbd></dd>
                </div>
                <div>
                  <dt>Nudge 10 px</dt>
                  <dd><kbd>Shift+Arrow</kbd></dd>
                </div>
                <div>
                  <dt>Pan</dt>
                  <dd><kbd>Scroll</kbd> or <kbd>Space+Drag</kbd></dd>
                </div>
                <div>
                  <dt>Zoom</dt>
                  <dd><kbd>Pinch</kbd></dd>
                </div>
                <div>
                  <dt>Context actions</dt>
                  <dd><kbd>Right-click</kbd></dd>
                </div>
                <div>
                  <dt>Edit text</dt>
                  <dd><kbd>Double-click</kbd></dd>
                </div>
                <div>
                  <dt>Exit candidate review / clear selection</dt>
                  <dd><kbd>Esc</kbd></dd>
                </div>
              </dl>
            </section>
          </div>
          <footer>
            <span>Press <kbd>/</kbd> anywhere outside a text field to toggle this reference.</span>
          </footer>
        </div>
      </div>
    {/if}

    {#if settingsOpen}
      <SettingsDialog
        {canvasBackground}
        defaultCanvasBackground={DEFAULT_CANVAS_BACKGROUND}
        framePresets={[...FRAME_PRESETS]}
        {framePresetId}
        {frameOrientation}
        {frameSize}
        projectSummary={{
          name: activeProject?.name ?? 'Untitled design',
          projectCount: projects.length,
          screenCount: document.screens.length,
          layerCount: Object.keys(document.nodes).length,
          revision: document.revision,
          storageMessage: storageWarning ?? 'Saved locally',
        }}
        integration={{ ...aiIntegration, models: aiModelOptions }}
        selectedModel={selectedAiModel}
        selectedEffort={selectedAiEffort}
        loading={aiSettingsLoading}
        errorMessage={aiSettingsError}
        onClose={closeSettings}
        onCanvasBackgroundChange={(color) => setCanvasBackground(color, 'settings')}
        onResetCanvasBackground={() =>
          setCanvasBackground(DEFAULT_CANVAS_BACKGROUND, 'settings-reset')}
        onFramePresetChange={(presetId) => {
          chooseFramePreset(presetId);
          logAction('settings.frame-preset-changed', { presetId, ...frameSize });
        }}
        onFrameOrientationChange={setFrameOrientation}
        onResetViewport={() => resetViewport('settings')}
        onAiSectionOpen={refreshAiIntegrationStatus}
        onRefresh={refreshSettingsDiagnostics}
        onModelChange={selectAiModel}
        onEffortChange={selectAiEffort}
        onReset={resetAiSettings}
        onSignIn={signInToCodex}
        onSignOut={signOutOfCodex}
      />
    {/if}

    <section class:open={bottomOpen} class="bottom-panel">
      <div class="bottom-tabs">
        {#each ['process', 'activity', 'prompt', 'operations', 'code'] as tab}<button
            class:active={bottomTab === tab}
            onclick={() => {
              bottomTab = tab as typeof bottomTab;
              bottomOpen = true;
            }}
            >{tab === 'process'
              ? 'Process history'
              : tab === 'activity'
                ? codesignActivityTabLabel
                : tab === 'prompt'
                  ? 'Codesign prompt'
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
          {:else if bottomTab === 'activity'}
            <CodesignActivity events={codesignActivityEvents} />
          {:else if bottomTab === 'prompt'}
            <CodesignPromptInspector renderedPrompt={latestRenderedCodesignPrompt} />
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
              <span>Read-only Svelte projection</span><button
                onclick={() => navigator.clipboard.writeText(code)}>Copy code</button
              >
            </div>
            <pre>{code}</pre>{/if}
        </div>{/if}
    </section>
  </main>

  <aside class="inspector" id="right-sidebar">
    <div class="inspector-tabs">
      <span>Properties</span>
    </div>
    {#if selectedNodes[0]}
      {@const node = selectedNodes[0]}
      <div class="selection-summary">
        <span
          class="kind-icon"
          class:project-component={Boolean(node.projectComponent)}
          aria-hidden="true">{node.projectComponent ? '◆' : node.componentBinding ? '◆' : '□'}</span
        >
        <div>
          <strong>{selectedNodes.length > 1 ? `${selectedNodes.length} layers` : node.name}</strong
          ><small
            >{selectedNodes.length > 1
              ? 'Collective selection'
              : `${node.kind} · ${node.id.slice(-8)}`}</small
          >
        </div>
      </div>
      {#if node.projectComponent}
        <section class="project-component-section">
          <h3>Project component</h3>
          <strong
            >{document.projectComponents?.[node.projectComponent.componentId]?.name ??
              node.name}</strong
          >
          <p class="muted">
            {node.projectComponent.role === 'main'
              ? 'Main component. New instances use the current contents of this source layer.'
              : 'Reusable instance from this project.'}
          </p>
        </section>
      {:else if selectedNodes.length === 1 && canCreateProjectComponent(node)}
        <section class="project-component-section">
          <h3>Reusable component</h3>
          <p class="muted">
            Turn this {node.kind} and its layers into a component for this project.
          </p>
          <button class="wide component-action" onclick={createProjectComponent}
            >Create component <kbd>{commandLabel}+Alt+K</kbd></button
          >
        </section>
      {/if}
      <section>
        <h3>Geometry {gesture ? '· Live' : ''}</h3>
        <div class="field-grid">
          {#each ['x', 'y', 'width', 'height'] as field}<label
              >{field[0].toUpperCase()}<input
                type="number"
                value={Math.round(selectionBounds?.[field as keyof Bounds] ?? 0)}
                onchange={(event) =>
                  changeSelectionGeometry(field as keyof Bounds, Number(event.currentTarget.value))}
              /></label
            >{/each}
        </div>
      </section>
      <section>
        <h3>Appearance</h3>
        {#if selectedNodes.some((item) => item.componentBinding)}
          <p class="muted">
            Component instances keep registry-controlled appearance. Use permitted overrides below
            instead of raw fill or typography values.
          </p>
          {#if node.componentBinding}
            {@const resolvedComponent = resolveComponent(node.componentBinding.componentId)}
            {#each Object.entries(resolvedComponent?.part ? {} : (resolvedComponent?.root.props ?? {})) as [key, definition]}
              {#if definition.kind === 'boolean'}
                <label class="checkbox-property">
                  <input
                    type="checkbox"
                    checked={Boolean(node.componentBinding.props[key] ?? definition.default)}
                    onchange={(event) =>
                      updateComponentOverride(node, key, event.currentTarget.checked)}
                  />
                  <span>{key}</span>
                </label>
              {:else if definition.options?.length}
                <label
                  >{key}<select
                    value={String(node.componentBinding.props[key] ?? definition.default ?? '')}
                    onchange={(event) => {
                      const selected = definition.options?.find(
                        (value) => String(value) === event.currentTarget.value,
                      );
                      updateComponentOverride(node, key, selected);
                    }}
                    >{#each definition.options as value}<option value={String(value)}
                        >{String(value)}</option
                      >{/each}</select
                  ></label
                >
              {:else}
                <label
                  >{key}<input
                    type={definition.kind === 'number' ? 'number' : 'text'}
                    value={String(node.componentBinding.props[key] ?? definition.default ?? '')}
                    onchange={(event) =>
                      updateComponentOverride(
                        node,
                        key,
                        definition.kind === 'number'
                          ? Number(event.currentTarget.value)
                          : event.currentTarget.value,
                      )}
                  /></label
                >
              {/if}
            {/each}
          {/if}
        {:else}
          <div class="field-grid">
            <label
              >Fill<input
                type="color"
                value={(mixedStyleValue('fill') as string | null) ?? node.style.fill}
                onchange={(event) => changeStyle({ fill: event.currentTarget.value })}
              /></label
            >
            <div class="stroke-property">
              <span class="property-label">Stroke</span>
              {#if selectedNodes.some((item) => item.style.stroke !== undefined || item.style.strokeWidth !== undefined)}
                <div class="stroke-fields">
                  <label
                    >Color<input
                      type="color"
                      aria-label="Stroke color"
                      value={typeof mixedStyleValue('stroke') === 'string'
                        ? String(mixedStyleValue('stroke'))
                        : '#20242b'}
                      onchange={(event) => setStrokeColor(event.currentTarget.value)}
                    /></label
                  ><label
                    >Width<input
                      type="number"
                      aria-label="Stroke width"
                      min="0"
                      step="0.5"
                      placeholder={mixedStyleValue('strokeWidth') == null ? 'Mixed' : undefined}
                      value={typeof mixedStyleValue('strokeWidth') === 'number'
                        ? Number(mixedStyleValue('strokeWidth'))
                        : ''}
                      onchange={(event) => setStrokeWidth(Number(event.currentTarget.value))}
                    /></label
                  >
                </div>
                <button class="property-action danger-subtle" onclick={removeStroke}
                  >Remove stroke</button
                >
              {:else}
                <span class="property-empty">No stroke</span>
                <button class="property-action" onclick={enableStroke}>Add stroke</button>
              {/if}
            </div>
            <label
              >Opacity %<input
                type="number"
                min="0"
                max="100"
                placeholder={mixedStyleValue('opacity') === null ? 'Mixed' : undefined}
                value={mixedStyleValue('opacity') === null
                  ? ''
                  : Math.round(Number(mixedStyleValue('opacity')) * 100)}
                onchange={(event) =>
                  changeStyle({
                    opacity: Math.min(1, Math.max(0, Number(event.currentTarget.value) / 100)),
                  })}
              /></label
            ><label
              >Corner radius<input
                type="number"
                min="0"
                placeholder={mixedStyleValue('radius') === null ? 'Mixed' : undefined}
                value={(mixedStyleValue('radius') as number | null) ?? ''}
                onchange={(event) => changeStyle({ radius: Number(event.currentTarget.value) })}
              /></label
            ><label
              >Padding<input
                type="number"
                min="0"
                placeholder={mixedStyleValue('padding') === null ? 'Mixed' : undefined}
                value={(mixedStyleValue('padding') as number | null) ?? ''}
                onchange={(event) => changeStyle({ padding: Number(event.currentTarget.value) })}
              /></label
            >
          </div>
        {/if}
        {#if node.componentBinding}<button class="wide" onclick={generalize}
            >Apply style to {node.repeaterId
              ? 'repeater siblings'
              : 'same component on screen'}</button
          >{/if}
      </section>
      {@const nodeLayout = layoutForNode(node)}
      <section>
        <h3>Layout</h3>
        {#if ['frame', 'group', 'instance'].includes(node.kind)}
          <label
            >Direction<select
              value={nodeLayout.mode}
              onchange={(event) =>
                updateSelectedLayout({
                  mode: event.currentTarget.value as LayoutPatch['mode'],
                })}
              ><option value="none">Freeform</option><option value="horizontal">Horizontal</option
              ><option value="vertical">Vertical</option><option value="grid">Grid</option></select
            ></label
          >
          {#if nodeLayout.mode !== 'none'}
            <div class="field-grid">
              <label
                >Gap<input
                  type="number"
                  min="0"
                  value={nodeLayout.gap}
                  onchange={(event) =>
                    updateSelectedLayout({ gap: Math.max(0, Number(event.currentTarget.value)) })}
                /></label
              ><label
                >Padding<input
                  type="number"
                  min="0"
                  value={typeof nodeLayout.padding === 'number' ? nodeLayout.padding : ''}
                  placeholder={typeof nodeLayout.padding === 'number' ? undefined : 'Per side'}
                  onchange={(event) =>
                    updateSelectedLayout({
                      padding: Math.max(0, Number(event.currentTarget.value)),
                    })}
                /></label
              >
              {#if nodeLayout.mode === 'grid'}
                <label
                  >Columns<input
                    type="number"
                    min="1"
                    step="1"
                    value={nodeLayout.gridColumns}
                    onchange={(event) =>
                      updateSelectedLayout({
                        gridColumns: Math.max(1, Math.round(Number(event.currentTarget.value))),
                      })}
                  /></label
                >
              {/if}
            </div>
            <label
              >Align items<select
                value={nodeLayout.align}
                onchange={(event) =>
                  updateSelectedLayout({
                    align: event.currentTarget.value as LayoutPatch['align'],
                  })}
                ><option value="start">Start</option><option value="center">Center</option><option
                  value="end">End</option
                ><option value="stretch">Stretch</option></select
              ></label
            ><label
              >Distribute<select
                value={nodeLayout.justify}
                onchange={(event) =>
                  updateSelectedLayout({
                    justify: event.currentTarget.value as LayoutPatch['justify'],
                  })}
                ><option value="start">Start</option><option value="center">Center</option><option
                  value="end">End</option
                ><option value="space-between">Space between</option></select
              ></label
            >
          {/if}
        {/if}
        <div class="field-grid">
          <label
            >Width<select
              value={nodeLayout.widthMode}
              onchange={(event) =>
                updateSelectedLayout({
                  widthMode: event.currentTarget.value as LayoutPatch['widthMode'],
                })}
              ><option value="fixed">Fixed</option><option value="hug">Hug contents</option><option
                value="fill">Fill container</option
              ></select
            ></label
          ><label
            >Height<select
              value={nodeLayout.heightMode}
              onchange={(event) =>
                updateSelectedLayout({
                  heightMode: event.currentTarget.value as LayoutPatch['heightMode'],
                })}
              ><option value="fixed">Fixed</option><option value="hug">Hug contents</option><option
                value="fill">Fill container</option
              ></select
            ></label
          >
        </div>
      </section>
      {#if selectedNodes.every(isEditableContentNode)}
        <section>
          <h3>Text</h3>
          <label
            >Content<textarea
              rows="3"
              value={editingTextId === node.id
                ? editingTextDraft
                : selectedNodes.every((item) => item.text === node.text)
                  ? node.text
                  : ''}
              placeholder={selectedNodes.every((item) => item.text === node.text)
                ? 'Text content'
                : 'Mixed'}
              onchange={(event) => updateSelectedText(event.currentTarget.value)}></textarea></label
          >
          <div class="field-grid">
            <label
              >Text color<input
                type="color"
                value={(mixedStyleValue('textColor') as string | null) ?? node.style.textColor}
                onchange={(event) => changeStyle({ textColor: event.currentTarget.value })}
              /></label
            ><label
              >Font size<input
                type="number"
                min="1"
                value={(mixedStyleValue('fontSize') as number | null) ?? ''}
                placeholder={mixedStyleValue('fontSize') === null ? 'Mixed' : undefined}
                onchange={(event) => changeStyle({ fontSize: Number(event.currentTarget.value) })}
              /></label
            ><label
              >Weight<input
                type="number"
                min="100"
                max="900"
                step="100"
                value={(mixedStyleValue('fontWeight') as number | null) ?? ''}
                placeholder={mixedStyleValue('fontWeight') === null ? 'Mixed' : undefined}
                onchange={(event) => changeStyle({ fontWeight: Number(event.currentTarget.value) })}
              /></label
            ><label
              >Line height<input
                type="number"
                min="0.5"
                step="0.1"
                value={(mixedStyleValue('lineHeight') as number | null) ?? ''}
                placeholder={mixedStyleValue('lineHeight') === null ? 'Mixed' : undefined}
                onchange={(event) => changeStyle({ lineHeight: Number(event.currentTarget.value) })}
              /></label
            >
          </div>
          <label
            >Alignment<select
              value={(mixedStyleValue('textAlign') as string | null) ?? ''}
              onchange={(event) =>
                changeStyle({
                  textAlign: event.currentTarget.value as 'left' | 'center' | 'right',
                })}
              ><option value="" disabled>Mixed</option><option value="left">Left</option><option
                value="center">Center</option
              ><option value="right">Right</option></select
            ></label
          >
        </section>
      {/if}
      {#if selectedNodes.every((item) => item.kind === 'frame')}
        <section>
          <h3>Frame</h3>
          <label class="checkbox-row"
            ><input
              type="checkbox"
              checked={selectedNodes.every((item) => item.clipContent)}
              onchange={(event) => setSelectedFrameClipping(event.currentTarget.checked)}
            /><span>Clip content outside frame bounds</span></label
          >
        </section>
      {/if}
      <section>
        <h3>Fidelity and origin</h3>
        <dl class="fidelity-summary">
          <dt>Current</dt>
          <dd>{effectiveFidelity(document, node.id)}</dd>
          <dt>Source</dt>
          <dd>
            {node.kind === 'frame'
              ? 'Set by this frame'
              : document.nodeFidelityOverrides[node.id]
                ? 'Element override'
                : `Inherited from ${fidelityInheritanceLabel(document, node) ?? 'screen'}`}
          </dd>
          <dt>Origin</dt>
          <dd>{node.provenance.actor === 'agent' ? 'AI' : 'Human'}</dd>
        </dl>
        {#if node.kind !== 'frame'}
          <label>
            Element fidelity override
            <select
              value={document.nodeFidelityOverrides[node.id] ?? ''}
              onchange={(event) => {
                const fidelity = event.currentTarget.value as Fidelity | '';
                fidelity ? setSelectedFidelity(fidelity) : clearSelectedFidelityOverride();
              }}
            >
              <option value="">Inherit from containing frame</option>
              <option value="wireframe">AI Draft</option>
              <option value="component">AI Hi-Fi</option>
            </select>
          </label>
          {#if document.nodeFidelityOverrides[node.id]}
            <button class="wide" onclick={clearSelectedFidelityOverride}
              >Clear fidelity override</button
            >
          {/if}
        {/if}
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
    {/if}
  </aside>
  <div class="live" aria-live="polite">{error || notice}</div>
  {#if storageWarning}<div class="storage-warning" role="status">
      <strong>Project recovery notice</strong><span>{storageWarning}</span>
    </div>{/if}
  {#if error}<div class="error-toast">
      <strong>{errorTitle}</strong><span>{error}</span><button onclick={() => (error = '')}
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
  :global(select),
  :global(textarea) {
    font: inherit;
  }
  :global(button:not([data-slot])) {
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
    position: relative;
    display: grid;
    grid-template:
      48px minmax(0, 1fr) / var(--left-sidebar-width, 232px) minmax(0, 1fr)
      var(--right-sidebar-width, 390px);
    background: #eef0f3;
    font-size: 13px;
  }
  .sidebar-resizer {
    position: absolute;
    top: 48px;
    bottom: 0;
    z-index: 19;
    width: 9px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }
  .left-resizer {
    left: calc(var(--left-sidebar-width, 232px) - 4px);
  }
  .right-resizer {
    right: calc(var(--right-sidebar-width, 390px) - 4px);
  }
  .sidebar-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: transparent;
    transition:
      width 100ms ease,
      background 100ms ease,
      transform 100ms ease;
  }
  .sidebar-resizer:hover::after,
  .sidebar-resizer:focus-visible::after,
  .sidebar-resizer.active::after {
    width: 2px;
    background: #7c3aed;
    transform: translateX(-0.5px);
  }
  .resizing-sidebar,
  .resizing-sidebar * {
    cursor: col-resize !important;
    user-select: none !important;
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
    width: min(410px, 36vw);
    gap: 9px;
    min-width: 0;
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
    min-width: 0;
    max-width: 160px;
    padding-left: 10px;
    border-left: 1px solid #d7dbe0;
    color: #737984;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .document-status {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    color: #8a919b;
    font-size: 10px;
    white-space: nowrap;
  }
  .document-status i {
    color: #b2b7bf;
    font-style: normal;
  }
  .document-status.save-issue {
    color: #a04b3a;
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
    min-width: 0;
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
  .pages {
    padding: 4px 8px 8px;
    border-bottom: 1px solid #d6dae0;
  }
  .pages .section-title {
    min-height: 30px;
    padding: 0;
  }
  .frame-presets {
    display: grid;
    gap: 7px;
    padding: 6px 8px 10px;
    border-bottom: 1px solid #d6dae0;
    background: #f1f4f7;
  }
  .frame-presets .section-title {
    min-height: 24px;
    padding: 0;
  }
  .frame-presets label {
    display: grid;
    gap: 3px;
    color: #6f7781;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .frame-presets select,
  .frame-presets input {
    width: 100%;
    height: 29px;
    box-sizing: border-box;
    border: 1px solid #bcc4cc;
    border-radius: 3px;
    background: white;
    padding: 0 6px;
    color: #303842;
  }
  .preset-size-grid,
  .preset-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .preset-actions button {
    min-height: 30px;
    border: 1px solid #b9c2cb;
    border-radius: 3px;
    background: white;
    color: #3e4853;
    cursor: pointer;
  }
  .preset-actions button.primary {
    border-color: #276b9f;
    background: #276b9f;
    color: white;
  }
  .frame-presets p {
    margin: 0;
    color: #717983;
    font-size: 9px;
    line-height: 1.4;
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
  .proposed-layers {
    margin: 5px 0 7px;
    padding: 4px;
    border: 1px solid #d6b46f;
    border-radius: 5px;
    background: #fff9e9;
  }
  .proposed-layers-heading {
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 6px;
    color: #795516;
    font-size: 10px;
    font-weight: 700;
  }
  .proposed-layers-heading i {
    color: #b97920;
    font-style: normal;
  }
  .proposed-layers-heading small {
    color: #8b7651;
    font-size: 9px;
    font-weight: 500;
  }
  .proposed-layer-row {
    min-height: 31px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding-left: var(--layer-indent, 8px);
    border-radius: 3px;
  }
  .proposed-layer-row.selected {
    background: #f4dfaa;
    box-shadow: inset 2px 0 #9b6517;
  }
  .proposed-layer-row input {
    flex: none;
    margin: 0;
    accent-color: #9b6517;
  }
  .proposed-checkbox-spacer {
    width: 13px;
  }
  .proposed-layer-row button {
    min-width: 0;
    min-height: 29px;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    padding: 0;
    color: #57482e;
    text-align: left;
    cursor: pointer;
  }
  .proposed-layer-row .layer-kind {
    flex: none;
    border-radius: 3px;
    background: #f1dca7;
    padding: 2px 4px;
    color: #755215;
    font-size: 8px;
    text-transform: capitalize;
  }
  .proposed-layer-row .layer-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .layers {
    display: flex;
    flex-direction: column;
  }
  .layer-row {
    min-height: 34px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 5px 0 var(--layer-indent, 5px);
    color: #676e78;
  }
  .layer-row.child-layer {
    border-left: 1px solid #d7dce2;
  }
  .layer-select,
  .layer-action {
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .layer-select {
    min-width: 0;
    min-height: 32px;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .layer-action {
    flex: none;
    width: 24px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    border-radius: 3px;
    padding: 0;
    color: #4e5965;
    font-size: 11px;
    line-height: 1;
  }
  .layer-disclosure-spacer {
    flex: none;
    width: 24px;
  }
  .layer-action:hover,
  .layer-action:focus-visible {
    background: #d7e0e8;
    color: #174b78;
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
  .layer-name-input {
    min-width: 0;
    width: 100%;
    height: 24px;
    border: 1px solid #2672ad;
    border-radius: 3px;
    padding: 2px 5px;
    background: white;
    color: #202832;
    font: inherit;
  }
  .layer-row.selected {
    background: #e3e9ef;
    color: #1e4d76;
  }
  .layer-row.component-layer {
    color: #6841a5;
  }
  .layer-row.component-layer .layer-kind {
    background: #eee7f8;
    color: #7042ad;
  }
  .layer-row.component-layer .layer-action {
    color: #7042ad;
  }
  .layer-row.component-layer .layer-action:hover,
  .layer-row.component-layer .layer-action:focus-visible {
    background: #e7dcf5;
    color: #55258f;
  }
  .layer-row.component-layer .layer-name-input {
    border-color: #7b4fba;
    color: #55258f;
  }
  .layer-row.component-layer.selected {
    background: #ebe2f6;
    color: #55258f;
  }
  .layer-row.drop-before {
    box-shadow: inset 0 2px #2672ad;
  }
  .layer-row.drop-after {
    box-shadow: inset 0 -2px #2672ad;
  }
  .layer-row.drop-inside {
    outline: 2px solid #2672ad;
    outline-offset: -2px;
    background: #e7f1fa;
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
  .canvas.component-drop-active {
    outline: 2px solid #2672ad;
    outline-offset: -2px;
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
  .canvas-toolbar .shortcuts-button {
    gap: 7px;
    border-left: 1px solid #d4d8dd;
    border-radius: 0;
    margin-left: 2px;
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
  }
  .selected .node {
    filter: brightness(1.01);
  }
  .promoted .node {
    fill: #fff;
  }
  .component-accent {
    fill: #397eb8;
  }
  .component-hit-target {
    fill: transparent;
    pointer-events: all;
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
  .project-component-boundary {
    fill: none;
    stroke: #7655b5;
    stroke-width: 1.5;
    stroke-dasharray: 5 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .project-component-boundary.main {
    stroke-width: 2;
    stroke-dasharray: none;
  }
  .node-label {
    pointer-events: none;
  }
  .node-label.editable-text {
    cursor: text;
    pointer-events: bounding-box;
  }
  .canvas-node-name {
    fill: #505b67;
    stroke: #f7f8fa;
    stroke-linejoin: round;
    paint-order: stroke;
    font-weight: 600;
    cursor: text;
    user-select: none;
  }
  .canvas-node-name.selected-name {
    fill: #176ca8;
  }
  .canvas-name-editor {
    overflow: visible;
  }
  .canvas-name-editor input {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1px solid #2672ad;
    border-radius: 2px;
    background: #fff;
    padding: 0 4px;
    color: #202832;
    font-family: inherit;
    outline: none;
  }
  .selection-box {
    fill: none;
    stroke: #2672ad;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .component-selection .selection-box {
    stroke: #7655b5;
  }
  .mutation-boundary,
  .focus-boundary,
  .observation-boundary,
  .editable-region-boundary,
  .insertion-parent-boundary,
  .scope-preview-boundary,
  .generation-active-boundary {
    fill: none;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .scope-preview-boundary {
    fill: #7a3db80b;
    stroke: #8a4ec2;
    stroke-width: 2;
    stroke-dasharray: 7 5;
  }
  .generation-active-boundary {
    stroke: #4b9bd8;
    stroke-width: 3;
    filter: drop-shadow(0 0 5px #54a9e8aa);
    animation: codesign-generation-glow 1.45s ease-in-out infinite;
  }
  .mutation-boundary {
    stroke: #125f99;
    stroke-width: 3;
  }
  .focus-boundary {
    stroke: #a66008;
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
  }
  .observation-boundary {
    stroke: #667783;
    stroke-width: 1.5;
    stroke-dasharray: 7 5;
  }
  .editable-region-boundary {
    fill: #176b3a12;
    stroke: #176b3a;
    stroke-width: 2;
    stroke-dasharray: 2 3;
  }
  .insertion-parent-boundary {
    stroke: #7a3db8;
    stroke-width: 2;
    stroke-dasharray: 10 4;
  }
  .evidence-highlight {
    fill: #f3b94218;
    stroke: #b96f05;
    stroke-width: 3;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .candidate-preview {
    pointer-events: none;
  }
  .candidate-preview .candidate-change-boundary {
    fill: none;
    stroke: #855e0c;
    stroke-width: 2;
    stroke-dasharray: 7 4;
    vector-effect: non-scaling-stroke;
  }
  .candidate-preview text {
    pointer-events: none;
  }
  .candidate-preview .highlighted-candidate .candidate-change-boundary {
    stroke: #b7472a;
    stroke-width: 4;
  }
  @keyframes codesign-generation-glow {
    0%,
    100% {
      opacity: 0.28;
      stroke-width: 2;
    }
    50% {
      opacity: 0.88;
      stroke-width: 4;
    }
  }
  .handle {
    fill: #fff;
    stroke: #2672ad;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    cursor: nwse-resize;
  }
  .component-selection .handle {
    stroke: #7655b5;
  }
  .handle-n,
  .handle-s {
    cursor: ns-resize;
  }
  .handle-e,
  .handle-w {
    cursor: ew-resize;
  }
  .handle-ne,
  .handle-sw {
    cursor: nesw-resize;
  }
  .duplicate-preview {
    opacity: 0.58;
    pointer-events: none;
  }
  .duplicate-preview rect {
    stroke-dasharray: 5 3;
    vector-effect: non-scaling-stroke;
  }
  .smart-guide {
    stroke: #d73a91;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .spacing-guide {
    pointer-events: none;
  }
  .spacing-guide line {
    stroke: #d73a91;
    stroke-width: 1;
    stroke-dasharray: 2 2;
    vector-effect: non-scaling-stroke;
  }
  .spacing-guide text {
    fill: #b02773;
    font-size: 9px;
    font-weight: 700;
    text-anchor: middle;
  }
  .marquee {
    fill: #2672ad18;
    stroke: #2672ad;
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .inline-text-editor {
    box-sizing: border-box;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    resize: none;
    overflow: hidden;
    border: 0;
    outline: 0;
    padding: 0;
    background: transparent;
    caret-color: #176ca8;
    font-family: inherit;
  }
  .inline-text-editor-shell {
    overflow: visible;
  }
  .text-editing-boundary {
    fill: none;
    stroke: #2672ad;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .draft {
    fill: #b9cbe044;
    stroke: #2672ad;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .draft-size {
    fill: #1d5f91;
    font-size: 10px;
    font-weight: 700;
    pointer-events: none;
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
    max-height: calc(100vh - 16px);
    overflow-y: auto;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .context-menu button kbd {
    color: #7b838d;
    font-size: 9px;
    white-space: nowrap;
  }
  .menu-separator {
    height: 1px;
    margin: 4px 2px;
    background: #dfe3e7;
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
  .shortcuts-backdrop {
    position: fixed;
    z-index: 60;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #17202b66;
    backdrop-filter: blur(2px);
  }
  .shortcuts-dialog {
    width: min(880px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    border: 1px solid #aeb5be;
    border-radius: 8px;
    background: #fbfcfd;
    box-shadow: 0 24px 70px #1018204d;
  }
  .shortcuts-dialog > header {
    position: sticky;
    z-index: 1;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 18px 20px;
    border-bottom: 1px solid #d4d9df;
    background: #fbfcfdf2;
  }
  .shortcuts-dialog .eyebrow {
    color: #69727d;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .shortcuts-dialog h2 {
    margin: 3px 0 0;
    font-size: 21px;
  }
  .shortcuts-dialog > header button {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #bcc3cb;
    border-radius: 4px;
    background: white;
    padding: 0 9px;
    cursor: pointer;
  }
  .shortcut-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: #dfe3e8;
  }
  .shortcut-groups > section {
    padding: 18px 20px;
    background: #f8f9fb;
  }
  .shortcut-groups h3 {
    margin: 0 0 10px;
    color: #5f6873;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .shortcut-groups dl {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }
  .shortcut-groups dl > div {
    min-height: 34px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    border-top: 1px solid #e0e4e8;
  }
  .shortcut-groups dl > div:first-child {
    border-top: 0;
  }
  .shortcut-groups dt {
    color: #353d46;
  }
  .shortcut-groups dd {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    color: #6b737e;
  }
  .shortcuts-dialog > footer {
    padding: 12px 20px;
    border-top: 1px solid #d4d9df;
    color: #6d7580;
    font-size: 11px;
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
    min-width: 0;
    border-left: 1px solid #cdd1d7;
    background: #fafbfc;
    overflow: auto;
  }
  .inspector-tabs {
    height: 41px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-bottom: 1px solid #d5d9de;
    color: #47515d;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
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
  .kind-icon.project-component {
    border-color: #c9b9de;
    background: #f0eafb;
    color: #69479a;
  }
  .project-component-section > strong {
    display: block;
    margin-top: 8px;
    color: #4e376f;
  }
  .component-action {
    border-color: #a991c8 !important;
    background: #f5f0fb !important;
    color: #5f3d8b !important;
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
  .inspector input,
  .inspector select,
  .inspector textarea {
    width: 100%;
    height: 31px;
    border: 1px solid #c4cad1;
    border-radius: 3px;
    background: white;
    padding: 0 7px;
    color: #252b33;
  }
  .inspector textarea {
    min-height: 70px;
    padding: 7px;
    resize: vertical;
  }
  .inspector .checkbox-row {
    flex-direction: row;
    align-items: center;
  }
  .inspector .checkbox-row input {
    width: 16px;
    height: 16px;
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
  .stroke-property {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    padding: 8px;
    border: 1px solid #d3d8de;
    border-radius: 4px;
    background: #f8f9fa;
  }
  .property-label {
    color: #58616b;
    font-size: 11px;
    font-weight: 650;
  }
  .property-empty {
    grid-column: 1;
    color: #818892;
    font-size: 10px;
  }
  .stroke-fields {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
  }
  .stroke-property .property-action {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: stretch;
    border: 1px solid #bcc4cc;
    border-radius: 3px;
    background: white;
    padding: 0 8px;
    color: #3f4852;
    font-size: 10px;
    cursor: pointer;
  }
  .stroke-property .danger-subtle {
    grid-row: 1;
    color: #9b433a;
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
  .preview .tools {
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
    .generation-active-boundary {
      opacity: 0.72;
      animation: none;
    }
  }
</style>
