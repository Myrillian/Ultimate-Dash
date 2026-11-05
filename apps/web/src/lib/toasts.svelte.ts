export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

class Toasts {
  items = $state<Toast[]>([]);
  private next = 1;

  show(message: string, kind: Toast['kind'] = 'success') {
    const id = this.next++;
    this.items = [...this.items, { id, message, kind }];
    setTimeout(() => this.dismiss(id), kind === 'error' ? 6000 : 3000);
  }

  dismiss(id: number) {
    this.items = this.items.filter((toast) => toast.id !== id);
  }
}

export const toasts = new Toasts();
