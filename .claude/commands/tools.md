# List Built-in Tools

- function shell(command: string[], workdir: string, timeoutMs?: number): Promise<ShellResult>
- function updatePlan(plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[], explanation?: string): Promise<void>
- function viewImage(path: string): Promise<void>
