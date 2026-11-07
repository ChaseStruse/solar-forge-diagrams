/** Serializes recovery writes so an old snapshot cannot overtake a later clear. */
export class RecoveryWriter {
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly snapshot: () => string | null,
    private readonly write: (content: string | null) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly delay = 750,
    private readonly maxWait = 5000,
  ) {}
  public schedule(): void {
    this.pending = true;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(
      () => void this.flush().catch(() => {}),
      this.delay,
    );
    this.deadline ??= setTimeout(
      () => void this.flush().catch(() => {}),
      this.maxWait,
    );
  }
  public flush(): Promise<void> {
    clearTimeout(this.debounce);
    clearTimeout(this.deadline);
    this.debounce = undefined;
    this.deadline = undefined;
    if (this.pending) {
      this.pending = false;
      const content = this.snapshot();
      this.queue = this.queue
        .then(() => this.write(content))
        .catch((error) => {
          this.pending = true;
          this.onError(error);
          throw error;
        });
      // Keep a handled queue for subsequent attempts while returning failures to callers.
      const result = this.queue;
      this.queue = result.catch(() => {});
      return result;
    }
    return this.queue;
  }
  public dispose(): void {
    clearTimeout(this.debounce);
    clearTimeout(this.deadline);
  }
}
