import type { DiagramDocument } from '../domain/document';
import { DocumentHistory } from '../domain/history';

/**
 * Everything the editor knows about the open project, in one place, so the
 * feature modules in src/app and src/ui read and change the same values.
 */
export interface AppState {
  /** The board on screen: the project root or one of its detail diagrams. */
  current: DiagramDocument;
  /** The project root, which owns the detail diagrams. */
  project: DiagramDocument;
  history: DocumentHistory;
  /** Boards to return to with Back, most recent last. */
  diagramTrail: DiagramDocument[];
  /** The primary selected node; the inspector shows it. */
  selected: string | undefined;
  selectedIds: Set<string>;
  selectedEdge: string | undefined;
  /** A reachability result the next journey replays instead of the flow. */
  checkedJourney: { path: string[]; allowed: boolean } | undefined;
  /** Native handle of the file the project was opened from or saved to. */
  fileHandle: number | undefined;
  dirty: boolean;
  /** A file operation or dialog is running; others wait. */
  busy: boolean;
  /** Recovery snapshots start once the startup recovery check is done. */
  recoveryReady: boolean;
  /** A GIF or video recording is running and owns the keyboard. */
  recording: boolean;
  layersVisible: boolean;
  diagramVisible: boolean;
}

export function createAppState(document: DiagramDocument): AppState {
  return {
    current: document,
    project: document,
    history: new DocumentHistory(document),
    diagramTrail: [],
    selected: undefined,
    selectedIds: new Set(),
    selectedEdge: undefined,
    checkedJourney: undefined,
    fileHandle: undefined,
    dirty: false,
    busy: false,
    recoveryReady: false,
    recording: false,
    layersVisible: true,
    diagramVisible: true,
  };
}
