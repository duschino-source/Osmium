import { describe, it, expect } from 'vitest';
import { CommandRegistry, IPC_CHANNELS } from '../index.js';

describe('@osmium/ide-core IPC channels & CommandRegistry', () => {
  it('defines all required IPC channels for cli, session, checkpoint, project, teamwork, and ide', () => {
    expect(IPC_CHANNELS.CLI_DETECT_ALL).toBe('cli:detectAll');
    expect(IPC_CHANNELS.SESSION_START).toBe('session:start');
    expect(IPC_CHANNELS.CHECKPOINT_UNDO).toBe('checkpoint:undo');
    expect(IPC_CHANNELS.PROJECT_SAVE_CONFIG).toBe('project:saveConfig');
    expect(IPC_CHANNELS.TEAMWORK_START_RUN).toBe('teamwork:startRun');
    expect(IPC_CHANNELS.IDE_GIT_HUNK_ACTION).toBe('ide:gitHunkAction');
    expect(IPC_CHANNELS.IDE_EXECUTE_COMMAND).toBe('ide:executeCommand');
  });

  it('registers, lists, executes, and unregisters commands in CommandRegistry', async () => {
    const registry = new CommandRegistry();
    registry.register(
      {
        id: 'osmium.toggleAgentPanel',
        title: 'Toggle Agent Panel',
        category: 'Agent',
        keybinding: 'Ctrl+L',
      },
      (visible: unknown) => ({ visible: Boolean(visible) }),
    );

    expect(registry.has('osmium.toggleAgentPanel')).toBe(true);
    expect(registry.list()).toHaveLength(1);

    const res = await registry.execute<{ visible: boolean }>('osmium.toggleAgentPanel', true);
    expect(res).toEqual({ visible: true });

    registry.unregister('osmium.toggleAgentPanel');
    expect(registry.has('osmium.toggleAgentPanel')).toBe(false);
    await expect(registry.execute('osmium.toggleAgentPanel')).rejects.toThrow(/Command not found/);
  });
});
