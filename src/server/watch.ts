import { watch, type FSWatcher } from "node:fs";

/** Watches the vault recursively and notifies subscribers, debounced, when notes change. */
export class VaultWatcher {
  private readonly listeners = new Set<() => void>();
  private readonly watcher: FSWatcher;
  private timer: NodeJS.Timeout | undefined;

  constructor(root: string, debounceMs = 150) {
    this.watcher = watch(root, { recursive: true }, (_event, filename) => {
      // Ignore .obsidian/ (workspace.json changes constantly) and other dot-folders.
      if (filename && filename.split(/[\\/]/).some((part) => part.startsWith("."))) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.listeners.forEach((fn) => fn()), debounceMs);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher.close();
  }
}
