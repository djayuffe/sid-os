/** Share initialization and retire late completions after reset/unmount. */
export class AsyncResource<T> {
    private generation = 0;
    private pending: Promise<T | null> | null = null;
    private current: T | null = null;

    constructor(private readonly dispose: (value: T) => void) {}

    get(create: () => Promise<T>): Promise<T | null> {
        if (this.current !== null) return Promise.resolve(this.current);
        if (this.pending) return this.pending;
        const generation = this.generation;
        // Invoke immediately so browser resource creation remains in the user gesture.
        let created: Promise<T>;
        try { created = create(); } catch (error) { return Promise.reject(error); }
        const pending = created.then(value => {
            if (generation !== this.generation) {
                this.dispose(value);
                return null;
            }
            this.current = value;
            return value;
        }).finally(() => {
            if (this.pending === pending) this.pending = null;
        });
        this.pending = pending;
        return pending;
    }

    reset(): void {
        this.generation++;
        this.pending = null;
        const value = this.current;
        this.current = null;
        if (value !== null) this.dispose(value);
    }
}
