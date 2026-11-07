import type { DiagramDocument } from '../domain/document';
import type { Edit } from '../domain/history';
import type { DiagramScene, EditTarget, Tool } from '../renderer/scene';
import type { AppState } from './state';

/**
 * What feature modules share: the state, the scene, and the core editor
 * operations. Each module receives this instead of reaching for globals, so
 * its dependencies are visible in one place.
 */
export interface App {
  readonly state: AppState;
  readonly scene: DiagramScene;
  notify(message: string): void;
  /** Apply an undoable edit, reload the board and reselect `ids`. */
  commit(edit: Edit, ids?: readonly string[]): void;
  /** Run one file operation or dialog at a time, reporting its error. */
  action(task: () => Promise<void>): Promise<void>;
  /** Refresh the inspector for the current selection. */
  inspect(): void;
  /** Run selection changes, refreshing the inspector once at the end. */
  deferInspect(task: () => void): void;
  /** Refresh title, save state, counts, layers and breadcrumbs. */
  updateHeader(): void;
  updateLayers(): void;
  showLayers(show: boolean): void;
  showComponents(show: boolean): void;
  selectTool(tool: Tool): void;
  travelHistory(redo: boolean): void;
  deleteSelection(): void;
  openEditor(target: EditTarget, created?: boolean): void;
  closeEditor(save: boolean): void;
  /** Show a project board: the root or a linked detail diagram. */
  navigateDiagram(board: DiagramDocument, returning?: boolean): void;
  /** Open a new project, discarding history. */
  replaceDocument(next: DiagramDocument): void;
  /** Ask to save unsaved changes; false when the user cancels. */
  canReplace(): Promise<boolean>;
  toggleJourney(): void;
}
