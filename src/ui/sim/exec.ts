import { getHost, type CommandInput } from './host';
import { toast } from '../state/ui';
import { newNonce } from '../components/common';
import type { CommandResult } from '../../engine/index';

type Cmd = CommandInput;

/** Submit a validated command; toast the outcome. Every Build/Apply/Send button goes through here. */
export async function exec<P = unknown>(cmd: Cmd, okText?: string): Promise<CommandResult<P>> {
  try {
    const res = await getHost().command<P>({ nonce: newNonce(), ...cmd } as Cmd);
    if (res.ok) {
      if (okText) toast({ text: okText, node: null, kind: `cmd_${cmd.type}`, level: 'success' });
    } else toast({ text: `${res.reason}`, node: null, kind: `cmd_${cmd.type}_rejected`, level: 'warn' });
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    toast({ text: `Command failed: ${msg}`, node: null, kind: 'cmd_error', level: 'alert' });
    return { ok: false, code: 'error', reason: msg };
  }
}
