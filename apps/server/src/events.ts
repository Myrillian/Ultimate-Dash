import type { ServerEvent } from '@ultimate-dash/shared';

/** `userId` ist gesetzt, wenn das Ereignis nur einen Benutzer betrifft (z. B. dessen Dashboard). */
type Listener = (event: ServerEvent, userId?: number) => void;

/** Verteilt Server-Ereignisse an alle verbundenen Browser (Server-Sent Events). */
export class EventHub {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ServerEvent, userId?: number): void {
    for (const listener of this.listeners) listener(event, userId);
  }

  get size(): number {
    return this.listeners.size;
  }
}
